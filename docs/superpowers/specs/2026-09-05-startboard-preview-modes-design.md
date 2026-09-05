# StartBoard Preview Modes Redesign

Date: 2026-09-05

## Goal

Correct the preview-mode mapping introduced after StartBoard 2.2.6 while preserving StartBoard's existing visual language, card layout, drag behavior, and arbitrary card resizing.

The three display types keep their existing labels and UI positions but have distinct responsibilities:

- `preview` (`预览（截图）`): a real screenshot of the rendered website.
- `icon` (`仅图标`): a YASD-style representative site thumbnail obtained from page metadata, with favicon fallback.
- `custom` (`自定义图片`): the user-provided image, unchanged.

## Constraints

- Do not copy YASD source code. Its public repository is all-rights-reserved. Reimplement the observed behavior independently.
- Do not change StartBoard's card chrome, information area, controls, workspace UI, layout model, or resize limits.
- A card may be resized freely from 150px to 600px in either dimension. Thumbnail cache dimensions must not dictate card dimensions.
- No continuously running timer and no recurring Chrome alarm.
- Scheduled screenshot refresh applies only to `preview` bookmarks.

## YASD Findings Applied

YASD uses a bounded thumbnail cache rather than a fixed display size. Its current implementation processes images against a 440x248 target, but its cards independently support multiple sizes and wide/square ratios. The rendered image is a CSS background whose scaling follows the current card.

YASD also distinguishes between images close to the target aspect ratio and images far from it:

- images close to the dial ratio may be center-cropped;
- logos, portrait images, and other distant aspect ratios retain their aspect ratio;
- the image is shown over a color derived from its edge pixels;
- small images are rejected in favor of later candidates.

The Chronicle example works because `https://ampcode.com/chronicle` publishes `https://ampcode.com/og-chronicle.jpg` as both its Open Graph and Twitter image. The extension selects that authored social image; it does not synthesize the artwork.

## Storage Model

Actual screenshots, representative thumbnails, and custom images must be stored separately.

### IndexedDB stores

- Existing `screenshots`: real screenshots for `preview`.
- New `thumbnails`: processed representative images for `icon`, including image blob, sampled plate color, source URL, and timestamp.
- Existing `customImages`: unchanged.

Increase the IndexedDB schema version and create `thumbnails` during upgrade. Add matching methods through `HybridStorageManager` and `StorageManager`.

### Bookmark metadata

Use mode-specific metadata rather than the ambiguous existing `previewUpdatedAt` fields:

- `screenshotUpdatedAt`
- `screenshotSource`: `initial`, `transition`, `manual`, `visit`, or `scheduled`
- `screenshotRefreshInterval`: `off`, `daily`, or `weekly`
- `thumbnailUpdatedAt`
- `thumbnailSourceUrl`
- `thumbnailSource`: `metadata`, `rendered-metadata`, or `manual`

The default value of `screenshotRefreshInterval` is `off`.

### Upgrade handling

Do not delete user images during migration.

- If a legacy image has `previewSource: metadata`, copy it to the new thumbnail store when it belongs to an `icon` bookmark.
- A `preview` bookmark whose only stored image came from metadata is treated as missing a real screenshot and receives an automatic real capture.
- Existing `manual` and `visit` screenshots remain in the screenshot store.
- Existing custom images remain untouched.

## `icon`: Representative Thumbnail Pipeline

### Candidate discovery

Use this ordered candidate list:

1. Open Graph image (`og:image` and secure variant)
2. Twitter image
3. Schema.org image metadata
4. `link[rel=image_src]`
5. Web app manifest icons, largest first
6. Apple touch icons and regular page icons, largest first
7. First meaningful page content images
8. favicon fallback

Reject malformed URLs, duplicate candidates, non-image responses, oversized downloads, and raster images below the minimum useful dimensions.

### Image processing

The cache uses a maximum processing box of 1200x675 WebP at approximately 0.86 quality. This is a quality cap chosen for StartBoard's 600px maximum card dimension and high-density screens; it is not a card size.

- If the source aspect ratio is close to 16:9, crop minimally toward 16:9.
- If the aspect ratio differs materially, preserve it and fit it within the processing box.
- Sample the outer image edges to compute a stable plate color.
- Store the processed image and plate color together.

### Rendering

Render the representative thumbnail inside the existing `.bookmark-preview` area without altering the surrounding card.

- Use `background-size: contain`, centered and not repeated.
- Use the sampled color as the preview-area background.
- The thumbnail automatically follows arbitrary card resizing; resizing does not cause network requests or regenerate the cache.
- If no acceptable representative image exists, render the existing favicon/material-icon fallback.

### Refresh triggers

- Creating an `icon` bookmark fetches a representative thumbnail once.
- Changing another display type to `icon` fetches once.
- Manual refresh refreshes the representative thumbnail and keeps the bookmark in `icon` mode.
- When an exact bookmarked URL finishes loading in a normal active tab, route 3 extracts candidates from the rendered DOM and refreshes the representative thumbnail at most once per day.

Rendered-DOM extraction is performed on demand with `chrome.scripting.executeScript`; no always-injected content script is added. Image decoding, resizing, and color sampling run in a minimal extension offscreen document so the service worker can update thumbnails even when the StartBoard page is closed.

## `preview`: Real Screenshot Pipeline

### Initial and transition capture

- Creating a `preview` bookmark automatically queues one popup capture.
- Changing another display type to `preview` automatically queues one popup capture.
- These captures happen regardless of the scheduled-refresh setting.
- Missing screenshots discovered while rendering also queue a capture, with in-flight deduplication so a save and render cannot create two popup windows for the same bookmark.

Popup captures use the existing StartBoard screenshot mechanism: an unfocused temporary popup loads the page, waits for completion and a short settle period, captures the rendered tab, stores the image, and closes the popup.

### Manual refresh

Manual refresh captures a fresh real screenshot and never changes the bookmark's display type.

### Route 3 visit refresh

When an exact bookmarked URL finishes loading in a focused normal Chrome window, capture the visible rendered tab for every matching `preview` bookmark, at most once per day. This opportunistic update remains active even when scheduled refresh is `off`.

## Scheduled Screenshot Refresh

### UI

Add one select control to the existing bookmark form, using existing form styles and spacing:

- `关闭` / `Off`
- `每天` / `Daily`
- `每周` / `Weekly`

The control is visible only while `preview` is selected. It is hidden for `icon` and `custom`. New bookmarks default to `off`; editing loads the bookmark's saved value.

### Due calculation

- `off`: never due.
- `daily`: due 24 hours after `screenshotUpdatedAt`.
- `weekly`: due 7 days after `screenshotUpdatedAt`.
- A missing or invalid screenshot timestamp is immediately due.

### Single checker and missed-run catch-up

Implement one idempotent `checkDueScreenshotRefreshes()` operation. It has two event entry points but only one body of scheduling logic:

1. when StartBoard opens;
2. when Chrome fires `chrome.runtime.onStartup`.

There is no background interval and no recurring alarm. If Chrome was closed when a daily or weekly deadline passed, the `onStartup` invocation sees that the bookmark is overdue and immediately queues the missed capture. If startup is followed by opening StartBoard, a shared in-flight lock and a persisted short-lived claim prevent duplicate captures.

Due captures run sequentially through the existing screenshot queue to avoid opening multiple popup windows at once. A failed capture does not advance `screenshotUpdatedAt`, so it remains due and can retry at the next StartBoard open or Chrome startup. The checker must continue to later bookmarks after a failure.

## Coordination and Concurrency

- Maintain per-bookmark in-flight sets for screenshot and representative-thumbnail work.
- Re-read the current bookmark before committing a result; discard a result if the bookmark was deleted, its URL changed, or its display type changed while work was running.
- Route 3, manual refresh, initial capture, and scheduled refresh all use the same per-mode write functions and timestamps.
- Screenshot work is serialized. Thumbnail metadata work may be limited to a small concurrency count but must not block rendering the board.

## Permissions

Add only the permissions required by the selected architecture:

- `scripting` for on-demand extraction from the exact visited page.
- `offscreen` for background DOM/image processing.

Retain the existing host permissions needed to fetch page metadata and images. Do not add remote services, analytics, or third-party thumbnail APIs.

## Error Behavior

- Failure to obtain an `icon` thumbnail falls back to favicon/material icon without changing the display type.
- Failure to capture a `preview` screenshot leaves the previous screenshot in place; if none exists, show the existing retry state.
- A scheduled failure remains overdue for a future trigger.
- Restricted pages such as `chrome://` are skipped without repeated visible errors.

## Verification

Automated tests must cover:

- mode-specific refresh policy and exact-URL matching;
- daily/weekly due calculation, including a deadline missed while Chrome was closed;
- startup and StartBoard-open triggers sharing one deduplicated checker;
- initial `preview` capture and transition-to-`preview` capture;
- initial `icon` metadata fetch and transition-to-`icon` fetch;
- manual refresh preserving the current display type;
- candidate ordering and rendered-DOM extraction;
- near-16:9 crop versus distant-ratio contain behavior;
- sampled plate-color persistence;
- independent screenshot and thumbnail stores plus schema upgrade;
- arbitrary card resizing changing only presentation, not cached image dimensions;
- stale async results not overwriting a changed or deleted bookmark.

Manual Chrome verification must confirm:

- Chronicle selects its Open Graph artwork;
- a logo-like site is centered over a matching plate color without destructive cropping;
- a `preview` bookmark opens a temporary popup and stores a real screenshot automatically;
- the schedule control appears only for `preview`;
- an overdue scheduled capture is performed on Chrome startup;
- cards remain freely resizable and retain the original StartBoard UI.

## Non-goals

- Exact-time execution while Chrome is closed.
- Cloud screenshot services or third-party thumbnail APIs.
- AI-generated thumbnails.
- Changing StartBoard card geometry or recreating YASD's overall UI.
- Per-resize thumbnail regeneration.

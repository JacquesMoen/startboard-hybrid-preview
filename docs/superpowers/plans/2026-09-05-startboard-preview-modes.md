# StartBoard Preview Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `预览（截图）` store real website screenshots, make `仅图标` display responsive YASD-style representative thumbnails, and add off/daily/weekly screenshot refresh with Chrome-startup catch-up.

**Architecture:** Route all visual refresh requests through the background service worker so startup, board-open, visit, initial, transition, and manual triggers share locks and queues. Keep real screenshots and representative thumbnails in separate IndexedDB stores; use an offscreen extension document for HTML parsing, image resizing, and plate-color sampling. Keep presentation responsive by treating 1200x675 as a cache-quality bound and rendering icon thumbnails with `contain` inside the existing freely resizable preview area.

**Tech Stack:** Chrome Extension Manifest V3, JavaScript, Chrome tabs/windows/scripting/offscreen/storage APIs, IndexedDB, DOM canvas, Node's built-in test runner.

**Spec:** `docs/superpowers/specs/2026-09-05-startboard-preview-modes-design.md`

## Global Constraints

- Do not copy source code from Yet Another Speed Dial; independently implement only the observed behavior.
- Do not change StartBoard's card geometry, workspace layout, drag/resize limits, or existing art direction.
- Do not add recurring alarms, remote thumbnail services, analytics, AI generation, or per-resize regeneration.
- Schedule values are exactly `off`, `daily`, and `weekly`; default is `off`.
- Missed scheduled work is checked on both StartBoard open and `chrome.runtime.onStartup` through one idempotent checker.
- Write a failing test and observe the expected failure before every production behavior change.

---

### Task 1: Define mode-specific policy and due calculations

**Files:**
- Modify: `js/preview-policy.js`
- Replace: `tests/preview-policy.test.js`

**Interfaces:**
- Produces: `DAY_MS`, `WEEK_MS`, `DEFAULT_BOOKMARK_DISPLAY_TYPE`, `normalizeComparableUrl(value)`, `isScreenshotBookmark(bookmark)`, `isThumbnailBookmark(bookmark)`, `shouldCaptureScreenshotVisit(bookmark, tabUrl, now)`, `shouldRefreshThumbnailVisit(bookmark, tabUrl, now)`, `isScheduledScreenshotDue(bookmark, now)`, `markScreenshot(bookmark, source, now)`, `markThumbnail(bookmark, details, now)`, and `selectPreviewCandidates(groups, baseUrl)`.
- Consumes: bookmark metadata fields defined in the approved spec.

- [ ] **Step 1: Write failing policy tests**

```js
test('daily and weekly screenshot schedules become due after Chrome was closed', () => {
    assert.equal(isScheduledScreenshotDue({
        displayType: 'preview', url: 'https://example.com',
        screenshotRefreshInterval: 'daily', screenshotUpdatedAt: NOW - DAY_MS
    }, NOW), true);
    assert.equal(isScheduledScreenshotDue({
        displayType: 'preview', url: 'https://example.com',
        screenshotRefreshInterval: 'weekly', screenshotUpdatedAt: NOW - WEEK_MS + 1
    }, NOW), false);
});

test('visit routes are exact-url and mode specific', () => {
    assert.equal(shouldCaptureScreenshotVisit(
        { displayType: 'preview', url: 'https://example.com/a' },
        'https://example.com/a#section', NOW), true);
    assert.equal(shouldRefreshThumbnailVisit(
        { displayType: 'icon', url: 'https://example.com/a' },
        'https://example.com/a', NOW), true);
});
```

- [ ] **Step 2: Run the policy tests and verify they fail because the new exports do not exist**

Run: `node --test tests/preview-policy.test.js`

Expected: FAIL on missing `isScheduledScreenshotDue` and mode-specific visit functions.

- [ ] **Step 3: Implement the minimum pure policy**

Implement schedule interval lookup, exact normalized URL matching, daily visit throttling using `screenshotVisitCapturedAt`/`thumbnailVisitRefreshedAt`, and independent timestamp markers. Preserve candidate ordering with `manifest` before `icons`.

- [ ] **Step 4: Run the policy tests and full tests**

Run: `node --test tests/preview-policy.test.js && npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/preview-policy.js tests/preview-policy.test.js
git commit -m "refactor: separate screenshot and thumbnail policy"
```

---

### Task 2: Implement YASD-style bounded thumbnail processing

**Files:**
- Modify: `js/preview-metadata.js`
- Replace: `tests/preview-metadata.test.js`

**Interfaces:**
- Consumes: `PreviewPolicy.selectPreviewCandidates(groups, pageUrl)`.
- Produces: `extractCandidateGroups(document)`, `calculateThumbnailPlan(sourceWidth, sourceHeight)`, `sampleEdgeColor(pixelData, width, height)`, `resizeToThumbnail(imageDataUrl, options) -> { imageDataUrl, plateColor }`, `refreshBookmarkMetadata(bookmark, options)`, and `refreshBookmarkFromCandidateGroups(bookmark, groups, pageUrl, options)`.
- Calls: `storage.saveThumbnail(bookmarkId, imageDataUrl, { plateColor, sourceUrl, source, timestamp })`.

- [ ] **Step 1: Write failing geometry and persistence tests**

```js
test('near-wide images crop to 16:9 while portrait logos retain their ratio', () => {
    assert.deepEqual(calculateThumbnailPlan(1200, 630), {
        canvasWidth: 1200, canvasHeight: 675,
        sourceX: 40, sourceY: 0, sourceWidth: 1120, sourceHeight: 630
    });
    assert.deepEqual(calculateThumbnailPlan(600, 900), {
        canvasWidth: 450, canvasHeight: 675,
        sourceX: 0, sourceY: 0, sourceWidth: 600, sourceHeight: 900
    });
});

test('representative metadata is saved to thumbnail storage with source URL and plate color', async () => {
    const saves = [];
    const document = {
        querySelectorAll: selector => selector.startsWith('meta[property="og:image"')
            ? [{ getAttribute: name => name === 'content' ? '/chronicle.jpg' : null }]
            : []
    };
    await refreshBookmarkMetadata(
        { id: 'chronicle', url: 'https://ampcode.com/chronicle', displayType: 'icon' },
        {
            force: true,
            parser: { parseFromString: () => document },
            fetchImpl: async url => url.endsWith('/chronicle')
                ? { ok: true, text: async () => '<html></html>' }
                : { ok: true, headers: new Headers({ 'content-type': 'image/jpeg' }), blob: async () => new Blob(['x'], { type: 'image/jpeg' }) },
            thumbnailer: async () => ({ imageDataUrl: 'data:image/webp;base64,eA==', plateColor: 'rgb(12, 34, 56)' }),
            storage: { saveThumbnail: async (...args) => saves.push(args) }
        }
    );
    assert.equal(saves[0][0], 'chronicle');
    assert.equal(saves[0][2].sourceUrl, 'https://ampcode.com/chronicle.jpg');
    assert.equal(saves[0][2].plateColor, 'rgb(12, 34, 56)');
});
```

- [ ] **Step 2: Run metadata tests and verify the expected failures**

Run: `node --test tests/preview-metadata.test.js`

Expected: FAIL because `calculateThumbnailPlan` and `saveThumbnail` routing do not exist.

- [ ] **Step 3: Implement bounded processing**

Use a 1200x675 maximum processing box. Crop only ratios within 0.25 of 16:9; otherwise preserve ratio. Reject decoded raster images below 96px in both useful dimensions. Sample top, bottom, left, and right edge pixels and return a stable CSS `rgb(r, g, b)` plate color. Keep WebP quality at 0.86.

- [ ] **Step 4: Run metadata and full tests**

Run: `node --test tests/preview-metadata.test.js && npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/preview-metadata.js tests/preview-metadata.test.js
git commit -m "feat: process responsive representative thumbnails"
```

---

### Task 3: Separate screenshots and thumbnail storage

**Files:**
- Modify: `js/indexeddb-storage.js`
- Modify: `js/hybrid-storage.js`
- Modify: `js/storage.js`
- Create: `tests/storage-routing.test.js`

**Interfaces:**
- Produces from `IndexedDBStorage`: `saveThumbnail`, `getThumbnail`, `deleteThumbnail`, `getScreenshotRecord`, schema version `2`.
- Produces from `HybridStorageManager` and `StorageManager`: matching thumbnail methods and `saveScreenshotResult(bookmarkId, imageDataUrl, source, timestamp)`.
- Thumbnail return type: `{ imageDataUrl, plateColor, sourceUrl, source, timestamp } | null`.

- [ ] **Step 1: Write failing storage-routing tests**

```js
test('hybrid storage routes screenshots and thumbnails to independent stores', async () => {
    const calls = [];
    const manager = new HybridStorageManager();
    manager.initialized = true;
    manager.idb = {
        saveScreenshot: async (...args) => calls.push(['screenshot', ...args]),
        saveThumbnail: async (...args) => calls.push(['thumbnail', ...args])
    };
    await manager.saveScreenshot('a', 'data:screenshot');
    await manager.saveThumbnail('a', 'data:thumbnail', { plateColor: '#123456' });
    assert.deepEqual(calls.map(call => call[0]), ['screenshot', 'thumbnail']);
});
```

- [ ] **Step 2: Run the storage test and verify failure on the missing thumbnail method/export**

Run: `node --test tests/storage-routing.test.js`

Expected: FAIL.

- [ ] **Step 3: Implement the new IndexedDB store and routing methods**

Upgrade `VisualBookmarksDB` from version 1 to 2 and create a `thumbnails` object store keyed by `thumbnail-${bookmarkId}`. Store the processed blob plus plate/source metadata. Export storage classes for Node tests without changing browser globals. Ensure bookmark deletion and reset clear both visual stores.

- [ ] **Step 4: Run storage and full tests**

Run: `node --test tests/storage-routing.test.js && npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/indexeddb-storage.js js/hybrid-storage.js js/storage.js tests/storage-routing.test.js
git commit -m "feat: store thumbnails separately from screenshots"
```

---

### Task 4: Add the single scheduler, startup catch-up, and background visual coordinator

**Files:**
- Modify: `background.js`
- Create: `js/refresh-coordinator.js`
- Create: `tests/refresh-coordinator.test.js`

**Interfaces:**
- Produces: `createRefreshCoordinator(dependencies)` with methods `checkDueScreenshotRefreshes(trigger)`, `refreshBookmarkVisual(bookmarkId, source)`, `captureVisitedBookmarkVisuals(tab)`, and `migrateLegacyVisuals()`.
- Consumes: `StorageManager`, `PreviewPolicy`, a screenshot capture function, and a thumbnail refresh function.
- Runtime messages: `visual:refresh`, `visual:check-due`, and `visual:updated`.

- [ ] **Step 1: Write failing scheduler tests**

```js
test('startup catches up overdue captures sequentially and continues after failure', async () => {
    const calls = [];
    const overdueA = { id: 'a', url: 'https://a.example', displayType: 'preview', screenshotRefreshInterval: 'daily' };
    const overdueB = { id: 'b', url: 'https://b.example', displayType: 'preview', screenshotRefreshInterval: 'weekly' };
    const coordinator = createRefreshCoordinator({
        now: () => NOW,
        getBookmarks: async () => [overdueA, overdueB],
        captureScreenshot: async (bookmark) => {
            calls.push(bookmark.id);
            if (bookmark.id === 'a') throw new Error('blocked');
        },
        getBookmark: async id => [overdueA, overdueB].find(bookmark => bookmark.id === id),
        claimStore: {
            claim: async () => true,
            release: async () => true
        }
    });
    await coordinator.checkDueScreenshotRefreshes('startup');
    assert.deepEqual(calls, ['a', 'b']);
});

test('startup and board-open calls share claims and do not capture twice', async () => {
    let captureCount = 0;
    const bookmark = { id: 'a', url: 'https://a.example', displayType: 'preview', screenshotRefreshInterval: 'daily' };
    const coordinator = createRefreshCoordinator({
        now: () => NOW,
        getBookmarks: async () => [bookmark],
        getBookmark: async () => bookmark,
        captureScreenshot: async () => { captureCount += 1; },
        claimStore: { claim: async () => true, release: async () => true }
    });
    await Promise.all([
        coordinator.checkDueScreenshotRefreshes('startup'),
        coordinator.checkDueScreenshotRefreshes('board-open')
    ]);
    assert.equal(captureCount, 1);
});
```

- [ ] **Step 2: Run coordinator tests and verify failure because the module does not exist**

Run: `node --test tests/refresh-coordinator.test.js`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the coordinator and wire background triggers**

Use one checker body, an in-memory running promise, per-bookmark in-flight sets, and persisted claims in `chrome.storage.local` with a short expiry. Invoke it from both `chrome.runtime.onStartup` and the `visual:check-due` message. Serialize screenshots through the existing queue. Re-read the bookmark before persisting every result. Replace the current preview-only visit handler with mode-specific screenshot and thumbnail visit paths.

- [ ] **Step 4: Run coordinator and full tests**

Run: `node --test tests/refresh-coordinator.test.js && npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add background.js js/refresh-coordinator.js tests/refresh-coordinator.test.js
git commit -m "feat: coordinate startup screenshot catch-up"
```

---

### Task 5: Add offscreen representative-thumbnail work

**Files:**
- Create: `offscreen/offscreen.html`
- Create: `offscreen/offscreen.js`
- Modify: `background.js`
- Modify: `manifest.json`
- Create: `tests/offscreen-contract.test.js`

**Interfaces:**
- Background helper: `refreshThumbnail(bookmark, source, candidateContext?)`.
- Offscreen request: `{ type: 'offscreen:thumbnail-refresh', requestId, bookmark, candidateGroups?, pageUrl? }`.
- Offscreen reply: `{ type: 'offscreen:thumbnail-result', requestId, success, error? }`.

- [ ] **Step 1: Write a failing contract test**

```js
test('manifest permits scripting and offscreen work', () => {
    const manifest = require('../manifest.json');
    assert.ok(manifest.permissions.includes('scripting'));
    assert.ok(manifest.permissions.includes('offscreen'));
});
```

Also test that the offscreen HTML loads policy, storage, metadata, and its message handler in dependency order.

- [ ] **Step 2: Run the contract test and verify it fails on missing permissions/files**

Run: `node --test tests/offscreen-contract.test.js`

Expected: FAIL.

- [ ] **Step 3: Implement the offscreen request bridge**

Create the document lazily with `chrome.offscreen.createDocument`, reuse it, correlate responses by request ID, and close it only when no work remains. For exact visited icon URLs, use `chrome.scripting.executeScript` to extract the rendered document's candidate groups and pass them to the offscreen processor. Do not inject a persistent content script.

- [ ] **Step 4: Run contract and full tests**

Run: `node --test tests/offscreen-contract.test.js && npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add offscreen/offscreen.html offscreen/offscreen.js background.js manifest.json tests/offscreen-contract.test.js
git commit -m "feat: refresh thumbnails through offscreen processing"
```

---

### Task 6: Correct card rendering and manual refresh behavior

**Files:**
- Modify: `js/bookmarks.js`
- Modify: `css/styles.css`
- Create: `tests/bookmark-rendering-contract.test.js`

**Interfaces:**
- `renderIconPreview(preview, bookmark)` reads `StorageManager.getThumbnail(bookmark.id)` and applies its image/plate color.
- `renderScreenshotPreview(preview, bookmark)` reads only real screenshots and requests a background capture when missing.
- `refreshBookmarkVisual(bookmark)` sends `visual:refresh` without changing `displayType`.

- [ ] **Step 1: Write failing rendering-contract tests**

```js
test('icon thumbnails use contain while real screenshots use cover', () => {
    const css = readFileSync('css/styles.css', 'utf8');
    assert.match(css, /\.bookmark-preview\.representative-thumbnail[\s\S]*background-size:\s*contain/);
    assert.match(css, /\.bookmark-preview img\.screenshot[\s\S]*object-fit:\s*cover/);
});
```

Add a source contract assertion that manual refresh no longer assigns `displayType = 'preview'`.

- [ ] **Step 2: Run the rendering test and verify it fails**

Run: `node --test tests/bookmark-rendering-contract.test.js`

Expected: FAIL on missing classes and legacy type-switch code.

- [ ] **Step 3: Implement responsive rendering in the existing preview area**

For `icon`, set the processed thumbnail as a centered, non-repeating background with the saved plate color and `contain`; fall back to the existing favicon. For `preview`, add a `screenshot` class and keep `cover`. Replace direct popup/metadata calls with background coordinator messages and update only the card whose result arrives.

- [ ] **Step 4: Run rendering and full tests**

Run: `node --test tests/bookmark-rendering-contract.test.js && npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/bookmarks.js css/styles.css tests/bookmark-rendering-contract.test.js
git commit -m "fix: map visual modes to the correct renderers"
```

---

### Task 7: Add the conditional screenshot schedule UI and transition triggers

**Files:**
- Modify: `newtab/newtab.html`
- Modify: `newtab/newtab.js`
- Modify: `js/bookmarks.js`
- Modify: `_locales/en/messages.json`
- Modify: `_locales/zh_CN/messages.json`
- Modify: `_locales/zh_TW/messages.json`
- Create: `tests/bookmark-form-contract.test.js`

**Interfaces:**
- Form element: `#screenshotRefreshGroup` containing `#screenshotRefreshInterval`.
- Helper: `toggleDisplayTypeFields(displayType)` controls custom-image and schedule visibility.
- Save metadata: `screenshotRefreshInterval` with default `off`.
- After a successful save, send `visual:refresh` only for new bookmarks or actual mode/URL transitions that require a new visual.

- [ ] **Step 1: Write failing form-contract tests**

```js
test('bookmark form provides only off daily weekly screenshot intervals', () => {
    const html = readFileSync('newtab/newtab.html', 'utf8');
    assert.match(html, /id="screenshotRefreshGroup"/);
    assert.deepEqual([...html.matchAll(/option value="(off|daily|weekly)"/g)].map(m => m[1]),
        ['off', 'daily', 'weekly']);
});
```

Add assertions for the default `off`, conditional visibility handler, persisted edit value, and board-open `visual:check-due` message.

- [ ] **Step 2: Run the form test and verify it fails on missing schedule controls**

Run: `node --test tests/bookmark-form-contract.test.js`

Expected: FAIL.

- [ ] **Step 3: Implement the form and transition workflow**

Use the existing `.form-group` and `<select>` styles. Show the schedule group only for `preview`. Preserve `off` while hidden for other modes. Capture the previous bookmark before saving so a new bookmark, URL change, or display-type change can enqueue exactly one appropriate refresh. Send the board-open due-check message during StartBoard initialization.

- [ ] **Step 4: Run form and full tests**

Run: `node --test tests/bookmark-form-contract.test.js && npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add newtab/newtab.html newtab/newtab.js js/bookmarks.js _locales/en/messages.json _locales/zh_CN/messages.json _locales/zh_TW/messages.json tests/bookmark-form-contract.test.js
git commit -m "feat: configure screenshot refresh per bookmark"
```

---

### Task 8: Migrate legacy visuals, update version, and verify the packaged extension

**Files:**
- Modify: `js/refresh-coordinator.js`
- Modify: `background.js`
- Modify: `newtab/newtab.js`
- Modify: `manifest.json`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `tests/refresh-coordinator.test.js`

**Interfaces:**
- Migration marker: `previewModeStorageMigrationV1` in `chrome.storage.local`.
- Version: `2.4.0` in both manifest and package metadata.

- [ ] **Step 1: Write the failing migration test**

```js
test('legacy metadata previews migrate to icon thumbnails but preview bookmarks recapture', async () => {
    const copiedThumbnailIds = [];
    const queuedScreenshotIds = [];
    let customImageWrites = 0;
    const coordinator = createRefreshCoordinator({
        getBookmarks: async () => [
            { id: 'icon-1', url: 'https://icon.example', displayType: 'icon', previewSource: 'metadata' },
            { id: 'preview-1', url: 'https://preview.example', displayType: 'preview', previewSource: 'metadata' },
            { id: 'custom-1', url: 'https://custom.example', displayType: 'custom' }
        ],
        getScreenshotRecord: async id => id === 'icon-1' ? { imageDataUrl: 'data:image/webp;base64,eA==' } : null,
        saveThumbnail: async id => copiedThumbnailIds.push(id),
        captureScreenshot: async bookmark => queuedScreenshotIds.push(bookmark.id),
        saveCustomImage: async () => { customImageWrites += 1; },
        migrationStore: { get: async () => false, set: async () => true },
        claimStore: { claim: async () => true, release: async () => true }
    });
    await coordinator.migrateLegacyVisuals();
    assert.deepEqual(copiedThumbnailIds, ['icon-1']);
    assert.deepEqual(queuedScreenshotIds, ['preview-1']);
    assert.equal(customImageWrites, 0);
});
```

- [ ] **Step 2: Run the migration test and verify failure**

Run: `node --test tests/refresh-coordinator.test.js`

Expected: FAIL because migration is not yet implemented.

- [ ] **Step 3: Implement one-time non-destructive migration and documentation**

Copy legacy metadata-generated screenshot records to thumbnail storage for `icon` bookmarks, leave their original records intact, queue real captures for `preview` bookmarks whose image source was metadata, and set the marker only after traversal completes. Update README behavior/install notes and bump both versions to 2.4.0.

- [ ] **Step 4: Run complete automated verification**

Run: `npm test`

Expected: all tests PASS with no unhandled rejection or warning.

Run: `node -e "JSON.parse(require('fs').readFileSync('manifest.json')); for (const p of require('./manifest.json').background ? ['background.js'] : []) new Function(require('fs').readFileSync(p, 'utf8')); console.log('manifest and background parse')"`

Expected: `manifest and background parse`.

- [ ] **Step 5: Inspect the final diff and run repository hygiene checks**

Run: `git diff --check && git status --short && git diff --stat`

Expected: no whitespace errors; only planned files changed.

- [ ] **Step 6: Commit**

```bash
git add js/refresh-coordinator.js background.js newtab/newtab.js manifest.json package.json README.md tests/refresh-coordinator.test.js
git commit -m "release: prepare StartBoard hybrid preview 2.4.0"
```

- [ ] **Step 7: Manual Chrome acceptance**

Load the repository directory as an unpacked extension and verify:

1. Chronicle in `icon` mode selects its Open Graph artwork and remains visually correct at 150x600, 600x150, and 600x600.
2. A portrait/logo candidate is contained over its sampled plate color.
3. New and transitioned `preview` bookmarks automatically open one temporary popup and store a real screenshot.
4. Manual refresh preserves the selected display type.
5. The schedule selector appears only for `preview` and defaults to off.
6. A deliberately overdue daily bookmark is caught up on Chrome restart and is not repeated when StartBoard opens immediately afterward.

- [ ] **Step 8: Push**

```bash
git push origin main
```

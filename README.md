# StartBoard Visual Bookmarks [SVB] - new tab - Chrome Extension

Beautiful visual bookmarks with drag & drop support for your new tab page.

![Version](https://img.shields.io/badge/version-2.4.2-blue)
![Manifest](https://img.shields.io/badge/manifest-v3-green)
![Storage](https://img.shields.io/badge/storage-hybrid-orange)

## ⭐ What's New in 2.4.2

- Rebuilt the Icon Only processor result path to match the proven speed-dial
  pattern: the offscreen page now sends a separate correlated completion
  message and the background service worker validates and stores the image.
- Representative images such as Chronicle's Open Graph banner no longer fall
  back to a favicon when the long-lived response channel closes early.

## What's New in 2.4.1

- Waits for the offscreen thumbnail processor to finish loading before sending
  the first automatic Icon Only request, preventing a new bookmark from getting
  stuck on its favicon fallback.

## What's New in 2.4.0

### 🔄 Two Correctly Separated Visual Modes

- **Preview (Screenshot)** stores a real page screenshot. Creating a bookmark,
  changing its URL, or switching to this mode automatically performs one popup
  capture; the refresh button remains available as a manual fallback.
- **Icon Only** uses a speed-dial-style representative site thumbnail. It ranks
  Open Graph, Twitter Card, schema.org, `image_src`, manifest, icon and rendered
  page candidates, then fits the result responsively inside any card size.
- **Visit refresh** opportunistically improves both modes when the exact saved
  URL is opened, with independent once-per-day throttles.
- **Optional screenshot schedule** is shown only in Screenshot mode and offers
  Off, Daily and Weekly. It defaults to Off.
- **Missed schedule catch-up** runs from one checker when StartBoard or Chrome
  next opens, so a deadline missed while Chrome was closed is not lost.
- **Safe upgrade** separates screenshots and representative thumbnails without
  deleting legacy image data, and rejects stale async results after URL or mode
  changes.
- **Original visual style preserved**: the StartBoard 2.2.6 card layout, colors,
  typography and interactions remain unchanged.

This repository is an independent derivative of StartBoard Visual Bookmarks
2.2.6. See [NOTICE.md](NOTICE.md) for attribution.

## Previous 2.0 changes

### 🚀 Hybrid Storage System
- **IndexedDB for Images** - Unlimited storage for screenshots and backgrounds
- **Auto-Migration** - Seamlessly upgrade from v1.0 with zero data loss
- **Storage Monitor** - Real-time usage tracking with visual indicators
- **Better Performance** - 3-4x faster image loading

### 🔐 Security Improvements
- **Content Security Policy** - Protection against code injection
- **Secure Storage** - All data encrypted by Chrome

---

## Features

✨ **Drag & Drop** - Rearrange bookmarks like desktop icons with smooth animations
🎨 **Material Design** - Modern, clean interface following Material Design principles
🌓 **Dark/Light Themes** - Automatic theme switching based on system preferences
📱 **Touch Support** - Full drag & drop support on touch devices
📸 **Real Website Screenshots** - Automatic initial capture, visit refresh, manual fallback, and optional schedule
🖼️ **Multiple Display Modes** - Screenshot previews, representative site thumbnails, or custom images
📁 **Workspaces & Folders** - Organize bookmarks into separate workspaces and folders
🔄 **Screenshot Refresh** - Update screenshots individually or all at once
⚙️ **Customizable** - Extensive settings for visual customization
🔍 **Search** - Quick search across all bookmarks
📥 **Import/Export** - Import from Chrome bookmarks or export your configuration
💾 **Unlimited Storage** - Store hundreds of bookmarks with screenshots (NEW!)
📊 **Storage Monitoring** - Track storage usage in real-time (NEW!)

## Installation

### Install in Chrome (Developer Mode)

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **Load unpacked**
4. Select the `startboard-hybrid-preview` folder
5. Done! Open a new tab to see your visual bookmarks

## Usage

### Adding Bookmarks

1. Click the **"Add Bookmark"** button
2. Enter the title and URL
3. Choose display type:
   - **Preview (Screenshot)** - Captures the actual website in a temporary popup
   - **Icon Only** - Builds a responsive representative thumbnail from site metadata
   - **Custom Image** - Upload your own image
4. For Screenshot mode, optionally choose Off, Daily, or Weekly refresh
5. Select a preset size or resize the card directly on the board
6. Click **Save**

### Dragging & Dropping

- **Desktop**: Click and drag any bookmark to rearrange
- **Mobile/Touch**: Long press and drag to rearrange
- Visual feedback shows where the bookmark will be placed
- Release to drop in the new position

### Customization

Click the ⚙️ **Settings** button to access:

**Visual Settings:**
- Theme (Light/Dark/Auto)
- Grid columns (3-8 columns)
- Default card size
- Display mode
- Background type and color
- Show/hide labels
- Enable/disable animations

**Screenshot Management:**
- **Capture All Screenshots** - Automatically capture screenshots for all bookmarks
- **Refresh All Screenshots** - Update all existing screenshots
- **Individual Refresh** - Hover over any bookmark and click refresh button
- **Auto-Refresh** - Per-bookmark Off/Daily/Weekly screenshot schedule; overdue
  work is checked on Chrome startup and when StartBoard opens
- **Visit Refresh** - Opening the exact saved URL can refresh its screenshot or
  representative thumbnail at most once per day
- Real-time progress indicator during bulk operations

**Data Management:**
- Import from Chrome bookmarks
- Export bookmarks as JSON
- Reset all data

### Keyboard Shortcuts

- `Ctrl/Cmd + K` - Focus search bar (coming soon)
- `Esc` - Close modals and panels

## Project Structure

```
startboard-hybrid-preview/
├── manifest.json           # Extension manifest
├── background.js          # Background service worker (screenshot capture)
├── newtab/
│   ├── newtab.html        # New tab page HTML
│   └── newtab.js          # Main application logic
├── js/
│   ├── storage.js         # Chrome storage management
│   ├── preview-policy.js  # Mode routing, schedules, and throttling
│   ├── preview-metadata.js# Representative image discovery
│   ├── refresh-coordinator.js # Startup, visit, and manual refresh coordination
│   ├── offscreen-bridge.js# Background/offscreen thumbnail processing
│   ├── dragdrop.js        # Drag & drop functionality
│   └── bookmarks.js       # Bookmark management
├── offscreen/             # DOM/canvas processing outside the service worker
├── css/
│   └── styles.css         # All styles with theme support
└── icons/
    ├── icon16.png         # 16x16 icon
    ├── icon48.png         # 48x48 icon
    └── icon128.png        # 128x128 icon
```

## Technical Details

### Technologies Used

- **Vanilla JavaScript** - No frameworks, pure JS
- **Chrome Extension Manifest V3** - Latest extension API
- **Chrome Storage API** - For saving bookmarks and settings
- **HTML5 Drag & Drop API** - For desktop drag & drop
- **Touch Events API** - For mobile drag & drop
- **Material Icons** - Google Material Icons
- **CSS Grid** - Flexible grid layout
- **CSS Variables** - Theme customization

### Browser Compatibility

- A current Chrome or Chromium-based browser with Manifest V3 offscreen document support

### Permissions

The extension requires these permissions:

- `storage` - Save bookmarks and settings
- `unlimitedStorage` - Store screenshot and thumbnail image data locally
- `tabs` - Capture website screenshots
- `scripting` - Read image metadata from the exact page you visit
- `offscreen` - Decode, resize, crop and compress representative thumbnails
- `contextMenus` - Add bookmarks from the page context menu
- `bookmarks` - Import Chrome bookmarks (optional)
- `<all_urls>` - Access websites to capture screenshots

### Data Storage (Hybrid System - NEW in 2.0!)

**Architecture:**
```
┌─────────────────────┐
│ chrome.storage.sync │  → Settings (100KB, synced across devices)
├─────────────────────┤
│chrome.storage.local │  → Metadata (10MB, fast access)
├─────────────────────┤
│     IndexedDB       │  → Images (500MB+, unlimited)
└─────────────────────┘
```

**What goes where:**
- **Settings** - `chrome.storage.sync` (synced across devices)
- **Bookmarks** - `chrome.storage.local` (metadata only, no images)
- **Folders** - `chrome.storage.local` (organizational data)
- **Screenshots** - `IndexedDB` (stored as Blob, efficient)
- **Representative Thumbnails** - separate `IndexedDB` store (stored as Blob)
- **Custom Images** - `IndexedDB` (stored as Blob)
- **Workspace Backgrounds** - `IndexedDB` (stored as Blob)

**Benefits:**
- ✅ Store 1000+ bookmarks (vs 50-100 in v1.0)
- ✅ 3-4x faster image loading
- ✅ Settings sync across devices
- ✅ No more storage limit errors

**Upgrading from v1.0?**
See [UPGRADE_GUIDE.md](UPGRADE_GUIDE.md) for automatic migration instructions.

## Development

### Prerequisites

- Chrome/Chromium browser
- Basic text editor or IDE

### Making Changes

1. Edit files in the project
2. Go to `chrome://extensions/`
3. Click the reload icon on the extension card
4. Open a new tab to see changes

### Adding New Features

The codebase is modular and easy to extend:

- **New bookmark types**: Modify `bookmarks.js` → `createBookmarkCard()`
- **New settings**: Add to `storage.js` → `defaultSettings`
- **New themes**: Add CSS variables in `styles.css`
- **New layouts**: Modify grid settings in `styles.css`

## Roadmap

Future features planned:

- [ ] Keyboard shortcuts
- [ ] Bookmark search with filters
- [ ] Cloud sync (Google Drive, Dropbox)
- [ ] Background image library
- [ ] Widget support (weather, clock, etc.)
- [ ] Bookmark statistics and analytics

## Troubleshooting

**Bookmarks not saving:**
- Check if Chrome storage quota is full
- Try exporting and resetting data

**Drag & drop not working:**
- Ensure animations are enabled in settings
- Check browser console for errors

**Icons not loading:**
- Some websites block favicon access
- Try using custom images instead

## Contributing

This is a personal project, but suggestions are welcome!

## License

MIT License - Feel free to use and modify.

## Credits

- Icons: Google Material Icons
- Fonts: Google Fonts (Roboto)
- Inspiration: Speed Dial extensions and Windows 11 Start Menu

---

Made with ❤️ for better browsing experience

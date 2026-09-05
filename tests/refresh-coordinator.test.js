const test = require('node:test');
const assert = require('node:assert/strict');

const {
    createRefreshCoordinator,
    registerRefreshCoordinatorEvents
} = require('../js/refresh-coordinator.js');

const NOW = Date.UTC(2026, 8, 5, 12, 0, 0);

function claimStore() {
    const claims = new Set();
    return {
        async claim(id) {
            if (claims.has(id)) return false;
            claims.add(id);
            return true;
        },
        async release(id) {
            claims.delete(id);
        }
    };
}

test('startup catches up overdue screenshots sequentially and continues after a failure', async () => {
    const bookmarks = [
        { id: 'a', url: 'https://a.example', displayType: 'preview', screenshotRefreshInterval: 'daily' },
        { id: 'b', url: 'https://b.example', displayType: 'preview', screenshotRefreshInterval: 'weekly' }
    ];
    const calls = [];
    let activeCaptures = 0;
    let maxActiveCaptures = 0;
    const coordinator = createRefreshCoordinator({
        now: () => NOW,
        getBookmarks: async () => bookmarks,
        getBookmark: async id => bookmarks.find(bookmark => bookmark.id === id),
        captureScreenshot: async bookmark => {
            activeCaptures += 1;
            maxActiveCaptures = Math.max(maxActiveCaptures, activeCaptures);
            calls.push(bookmark.id);
            activeCaptures -= 1;
            if (bookmark.id === 'a') throw new Error('blocked');
        },
        refreshThumbnail: async () => assert.fail('scheduled refresh must not update thumbnails'),
        claimStore: claimStore()
    });

    const result = await coordinator.checkDueScreenshotRefreshes('startup');

    assert.deepEqual(calls, ['a', 'b']);
    assert.equal(maxActiveCaptures, 1);
    assert.deepEqual(result.updatedIds, ['b']);
    assert.deepEqual(result.failedIds, ['a']);
});

test('startup and board-open triggers share one running due check', async () => {
    const bookmark = {
        id: 'a',
        url: 'https://a.example',
        displayType: 'preview',
        screenshotRefreshInterval: 'daily'
    };
    let captureCount = 0;
    let releaseCapture;
    const captureGate = new Promise(resolve => { releaseCapture = resolve; });
    const coordinator = createRefreshCoordinator({
        now: () => NOW,
        getBookmarks: async () => [bookmark],
        getBookmark: async () => bookmark,
        captureScreenshot: async () => {
            captureCount += 1;
            await captureGate;
        },
        refreshThumbnail: async () => {},
        claimStore: claimStore()
    });

    const startup = coordinator.checkDueScreenshotRefreshes('startup');
    const boardOpen = coordinator.checkDueScreenshotRefreshes('board-open');
    await new Promise(resolve => setImmediate(resolve));
    releaseCapture();
    await Promise.all([startup, boardOpen]);

    assert.equal(captureCount, 1);
});

test('manual visual refresh preserves the mode-specific pipeline', async () => {
    const bookmarks = [
        { id: 'screen', url: 'https://screen.example', displayType: 'preview' },
        { id: 'thumb', url: 'https://thumb.example', displayType: 'icon' }
    ];
    const calls = [];
    const coordinator = createRefreshCoordinator({
        getBookmarks: async () => bookmarks,
        getBookmark: async id => bookmarks.find(bookmark => bookmark.id === id),
        captureScreenshot: async (bookmark, source) => calls.push(['screenshot', bookmark.id, source]),
        refreshThumbnail: async (bookmark, source) => calls.push(['thumbnail', bookmark.id, source]),
        claimStore: claimStore()
    });

    await coordinator.refreshBookmarkVisual('screen', 'manual');
    await coordinator.refreshBookmarkVisual('thumb', 'manual');

    assert.deepEqual(calls, [
        ['screenshot', 'screen', 'manual'],
        ['thumbnail', 'thumb', 'manual']
    ]);
});

test('visit refresh uses exact URL matches for both visual modes', async () => {
    const bookmarks = [
        { id: 'screen', url: 'https://example.com/page', displayType: 'preview' },
        { id: 'thumb', url: 'https://example.com/page', displayType: 'icon' },
        { id: 'other', url: 'https://example.com/other', displayType: 'icon' }
    ];
    const calls = [];
    const coordinator = createRefreshCoordinator({
        now: () => NOW,
        getBookmarks: async () => bookmarks,
        getBookmark: async id => bookmarks.find(bookmark => bookmark.id === id),
        captureScreenshot: async () => {},
        captureVisitedScreenshots: async (targets, tab) => calls.push([
            'visited-screenshots', targets.map(target => target.id), tab.id
        ]),
        refreshThumbnail: async (bookmark, source, context) => calls.push([
            'thumbnail', bookmark.id, source, context.pageUrl
        ]),
        claimStore: claimStore()
    });

    const result = await coordinator.captureVisitedBookmarkVisuals(
        { id: 7, url: 'https://example.com/page#section', active: true, status: 'complete' },
        { openGraph: ['/rendered.jpg'] }
    );

    assert.deepEqual(calls, [
        ['visited-screenshots', ['screen'], 7],
        ['thumbnail', 'thumb', 'rendered-metadata', 'https://example.com/page#section']
    ]);
    assert.deepEqual(result.updatedIds.sort(), ['screen', 'thumb']);
});

test('Chrome startup and board-open messages invoke the same due checker', async () => {
    let startupListener;
    let messageListener;
    const calls = [];
    const chromeApi = {
        runtime: {
            onStartup: { addListener: listener => { startupListener = listener; } },
            onMessage: { addListener: listener => { messageListener = listener; } }
        }
    };
    const coordinator = {
        checkDueScreenshotRefreshes: async trigger => calls.push(trigger),
        refreshBookmarkVisual: async () => true
    };

    registerRefreshCoordinatorEvents(chromeApi, coordinator);
    await startupListener();
    const response = await new Promise(resolve => {
        const keepChannelOpen = messageListener(
            { type: 'visual:check-due' },
            {},
            resolve
        );
        assert.equal(keepChannelOpen, true);
    });

    assert.deepEqual(calls, ['startup', 'board-open']);
    assert.deepEqual(response, { success: true });
});

test('legacy metadata images migrate once without deleting the old screenshot records', async () => {
    const bookmarks = [
        { id: 'icon', url: 'https://icon.example', displayType: 'icon', previewSource: 'metadata' },
        { id: 'screen', url: 'https://screen.example', displayType: 'preview', previewSource: 'metadata' },
        { id: 'custom', url: 'https://custom.example', displayType: 'custom', previewSource: 'metadata' }
    ];
    const screenshots = {
        icon: {
            imageDataUrl: 'data:image/webp;base64,aWNvbg==',
            source: 'metadata',
            timestamp: NOW - 1000
        },
        screen: {
            imageDataUrl: 'data:image/webp;base64,c2NyZWVu',
            source: 'metadata',
            timestamp: NOW - 2000
        },
        custom: {
            imageDataUrl: 'data:image/webp;base64,Y3VzdG9t',
            source: 'metadata',
            timestamp: NOW - 3000
        }
    };
    const calls = [];
    let completed = false;
    const coordinator = createRefreshCoordinator({
        now: () => NOW,
        getBookmarks: async () => bookmarks,
        getBookmark: async id => bookmarks.find(bookmark => bookmark.id === id),
        getScreenshotRecord: async id => screenshots[id],
        saveThumbnail: async (...args) => calls.push(['thumbnail', ...args]),
        captureScreenshot: async (bookmark, source) => calls.push(['screenshot', bookmark.id, source]),
        refreshThumbnail: async () => {},
        migrationStore: {
            hasCompleted: async () => completed,
            markCompleted: async () => { completed = true; }
        },
        claimStore: claimStore()
    });

    const first = await coordinator.migrateLegacyVisuals();
    const second = await coordinator.migrateLegacyVisuals();

    assert.deepEqual(calls, [
        ['thumbnail', 'icon', screenshots.icon.imageDataUrl, {
            plateColor: null,
            sourceUrl: null,
            source: 'migration',
            timestamp: screenshots.icon.timestamp,
            expectedUrl: 'https://icon.example'
        }],
        ['screenshot', 'screen', 'migration']
    ]);
    assert.deepEqual(first, { migratedThumbnailIds: ['icon'], recapturedScreenshotIds: ['screen'], failedIds: [] });
    assert.deepEqual(second, { skipped: true });
    assert.equal(completed, true);
});

test('legacy migration also recognizes metadata from the stored image record', async () => {
    const bookmark = { id: 'icon', url: 'https://icon.example', displayType: 'icon' };
    const writes = [];
    const coordinator = createRefreshCoordinator({
        getBookmarks: async () => [bookmark],
        getBookmark: async () => bookmark,
        getScreenshotRecord: async () => ({
            imageDataUrl: 'data:image/webp;base64,aWNvbg==',
            source: 'metadata',
            timestamp: NOW
        }),
        saveThumbnail: async (...args) => writes.push(args),
        captureScreenshot: async () => {},
        refreshThumbnail: async () => {},
        migrationStore: {
            hasCompleted: async () => false,
            markCompleted: async () => {}
        },
        claimStore: claimStore()
    });

    await coordinator.migrateLegacyVisuals();

    assert.equal(writes.length, 1);
});

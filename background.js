// Background service worker for context menu bookmark capture
/* global PreviewPolicy, StorageManager, RefreshCoordinator, OffscreenBridge, RenderedMetadata */

// Load shared storage utilities (order matters)
importScripts(
    'js/preview-policy.js',
    'js/indexeddb-storage.js',
    'js/hybrid-storage.js',
    'js/storage.js',
    'js/refresh-coordinator.js',
    'js/offscreen-bridge.js',
    'js/rendered-metadata.js'
);

const ROOT_MENU_ID = 'startboard_add_bookmark';
const SCHEDULE_CLAIMS_KEY = 'scheduledScreenshotRefreshClaims';
const VISUAL_STORAGE_MIGRATION_KEY = 'previewModeStorageMigrationV1';
const CLAIM_LIFETIME_MS = 5 * 60 * 1000;

function readLocalStorage(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function writeLocalStorage(values) {
    return new Promise((resolve) => chrome.storage.local.set(values, resolve));
}

const claimStore = {
    async claim(bookmarkId, now) {
        const result = await readLocalStorage([SCHEDULE_CLAIMS_KEY]);
        const claims = result[SCHEDULE_CLAIMS_KEY] || {};
        for (const [id, expiresAt] of Object.entries(claims)) {
            if (!Number.isFinite(expiresAt) || expiresAt <= now) delete claims[id];
        }
        if (claims[bookmarkId]) return false;
        claims[bookmarkId] = now + CLAIM_LIFETIME_MS;
        await writeLocalStorage({ [SCHEDULE_CLAIMS_KEY]: claims });
        return true;
    },

    async release(bookmarkId) {
        const result = await readLocalStorage([SCHEDULE_CLAIMS_KEY]);
        const claims = result[SCHEDULE_CLAIMS_KEY] || {};
        delete claims[bookmarkId];
        await writeLocalStorage({ [SCHEDULE_CLAIMS_KEY]: claims });
    }
};

const migrationStore = {
    async hasCompleted() {
        const result = await readLocalStorage([VISUAL_STORAGE_MIGRATION_KEY]);
        return result[VISUAL_STORAGE_MIGRATION_KEY] === true;
    },

    async markCompleted() {
        await writeLocalStorage({ [VISUAL_STORAGE_MIGRATION_KEY]: true });
    }
};

const offscreenBridge = OffscreenBridge.createOffscreenBridge(chrome);

async function refreshRepresentativeThumbnail(bookmark, source, context = {}) {
    return offscreenBridge.refreshThumbnail({
        bookmarkId: bookmark.id,
        expectedUrl: bookmark.url,
        source: source === 'rendered-metadata' ? source : (source || 'metadata'),
        candidateGroups: context.candidateGroups,
        pageUrl: context.pageUrl
    });
}

async function captureVisitedScreenshots(targets, tab) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const currentTab = await chrome.tabs.get(tab.id);
    if (!currentTab.active ||
        PreviewPolicy.normalizeComparableUrl(currentTab.url) !==
        PreviewPolicy.normalizeComparableUrl(tab.url)) {
        throw new Error('Visited tab changed before screenshot capture');
    }

    const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: 'jpeg',
        quality: 85
    });
    const timestamp = Date.now();

    for (const target of targets) {
        const current = await StorageManager.getBookmarkById(target.id);
        if (!PreviewPolicy.shouldCaptureScreenshotVisit(current, tab.url, timestamp)) continue;
        await StorageManager.saveScreenshotResult(
            current.id,
            screenshot,
            'visit',
            timestamp,
            tab.url
        );
    }
}

async function notifyVisualUpdated(bookmarkIds) {
    try {
        await chrome.runtime.sendMessage({ type: 'visual:updated', bookmarkIds });
    } catch (error) {
        // StartBoard may be closed; stored visuals will render next time it opens.
    }
}

const visualCoordinator = RefreshCoordinator.createRefreshCoordinator({
    getBookmarks: () => StorageManager.getBookmarks(),
    getBookmark: (bookmarkId) => StorageManager.getBookmarkById(bookmarkId),
    captureScreenshot: (bookmark, source) =>
        StorageManager.captureScreenshot(bookmark.url, bookmark.id, source),
    captureVisitedScreenshots,
    refreshThumbnail: refreshRepresentativeThumbnail,
    getScreenshotRecord: (bookmarkId) => StorageManager.getScreenshotRecord(bookmarkId),
    saveThumbnail: (bookmarkId, imageDataUrl, metadata) =>
        StorageManager.saveThumbnail(bookmarkId, imageDataUrl, metadata),
    notifyUpdated: notifyVisualUpdated,
    claimStore,
    migrationStore
});

RefreshCoordinator.registerRefreshCoordinatorEvents(chrome, visualCoordinator);
visualCoordinator.migrateLegacyVisuals().catch((error) =>
    console.debug('Legacy visual migration skipped:', error.message));

// Create/refresh the context menu based on current workspaces
async function refreshContextMenu() {
    return new Promise((resolve) => {
        chrome.contextMenus.removeAll(async () => {
            const title = chrome.i18n.getMessage('addBookmarkToStartBoard') || 'Add bookmark to StartBoard';

            chrome.contextMenus.create({
                id: ROOT_MENU_ID,
                title,
                contexts: ['page', 'link']
            });

            const workspaces = await StorageManager.getWorkspaces();
            workspaces.forEach((workspace) => {
                chrome.contextMenus.create({
                    id: `${ROOT_MENU_ID}:${workspace.id}`,
                    parentId: ROOT_MENU_ID,
                    title: workspace.name,
                    contexts: ['page', 'link']
                });
            });

            resolve(true);
        });
    });
}

// Compute a simple free position on a virtual grid
async function getNextPosition(workspaceId) {
    const perRow = 4;
    const spacing = 220;
    const start = 50;

    const bookmarks = await StorageManager.getBookmarksByWorkspace(workspaceId);
    const index = bookmarks.length;

    return {
        x: start + (index % perRow) * spacing,
        y: start + Math.floor(index / perRow) * spacing
    };
}

async function handleAddBookmark(workspaceId, info, tab) {
    const url = info.linkUrl || info.pageUrl || (tab && tab.url);
    if (!url) return;

    const title = (info.selectionText && info.selectionText.trim()) || (tab && tab.title) || url;
    const position = await getNextPosition(workspaceId);

    const newBookmark = {
        id: `cm-${Date.now()}`,
        title: title,
        url: url,
        displayType: 'icon',
        workspace: workspaceId,
        x: position.x,
        y: position.y,
        width: 200,
        height: 200
    };

    // Persist
    const bookmarks = await StorageManager.getBookmarks();
    bookmarks.push(newBookmark);
    await StorageManager.saveBookmarks(bookmarks);
    visualCoordinator.refreshBookmarkVisual(newBookmark.id, 'initial').catch((error) =>
        console.debug('Initial bookmark thumbnail unavailable:', error.message));
}

chrome.runtime.onInstalled.addListener(() => {
    refreshContextMenu();
});

// Rebuild menu on service worker start
refreshContextMenu();

// Rebuild menu if workspaces change
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.settings) {
        refreshContextMenu();
    }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (!info.menuItemId || typeof info.menuItemId !== 'string') return;
    if (!info.menuItemId.startsWith(`${ROOT_MENU_ID}:`)) return;

    const workspaceId = info.menuItemId.split(':')[1];
    if (!workspaceId) return;

    try {
        await handleAddBookmark(workspaceId, info, tab);
    } catch (err) {
        console.error('Failed to add bookmark from context menu:', err);
    }
});

async function captureVisitedBookmarkVisuals(tab) {
    if (!tab || !tab.id || !tab.active || tab.status !== 'complete' ||
        !PreviewPolicy.normalizeComparableUrl(tab.url)) return;

    const currentWindow = await chrome.windows.get(tab.windowId);
    if (!currentWindow.focused || currentWindow.type !== 'normal') return;

    const bookmarks = await StorageManager.getBookmarks();
    const needsRenderedMetadata = bookmarks.some((bookmark) =>
        PreviewPolicy.shouldRefreshThumbnailVisit(bookmark, tab.url));
    let candidateGroups;

    if (needsRenderedMetadata) {
        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: RenderedMetadata.extractRenderedCandidateGroups
            });
            candidateGroups = results[0] && results[0].result && results[0].result.candidateGroups;
        } catch (error) {
            // Restricted pages and pages that disappear during extraction fall back to server metadata.
        }
    }

    await visualCoordinator.captureVisitedBookmarkVisuals(tab, candidateGroups);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete') {
        captureVisitedBookmarkVisuals(tab).catch((error) =>
            console.debug('Visited-page visual refresh skipped:', error.message));
    }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    try {
        await captureVisitedBookmarkVisuals(await chrome.tabs.get(tabId));
    } catch (error) {
        // The tab may have closed before it could be queried.
    }
});

// Background service worker for context menu bookmark capture
/* global PreviewPolicy, StorageManager */

// Load shared storage utilities (order matters)
importScripts('js/preview-policy.js', 'js/indexeddb-storage.js', 'js/hybrid-storage.js', 'js/storage.js');

const ROOT_MENU_ID = 'startboard_add_bookmark';
const visitCapturesInFlight = new Set();

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

async function captureVisitedBookmarkPreviews(tab) {
    if (!tab || !tab.id || !tab.active || tab.status !== 'complete' ||
        !PreviewPolicy.normalizeComparableUrl(tab.url)) return;

    const currentWindow = await chrome.windows.get(tab.windowId);
    if (!currentWindow.focused || currentWindow.type !== 'normal') return;

    const bookmarks = await StorageManager.getBookmarks();
    const targets = bookmarks.filter((bookmark) =>
        !visitCapturesInFlight.has(bookmark.id) &&
        PreviewPolicy.shouldCaptureVisit(bookmark, tab.url));
    if (!targets.length) return;

    targets.forEach((bookmark) => visitCapturesInFlight.add(bookmark.id));

    try {
        // Give late-loading page content a brief chance to settle.
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const currentTab = await chrome.tabs.get(tab.id);
        if (!currentTab.active ||
            PreviewPolicy.normalizeComparableUrl(currentTab.url) !== PreviewPolicy.normalizeComparableUrl(tab.url)) return;

        const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 85 });
        const capturedAt = Date.now();
        await Promise.all(targets.map((bookmark) =>
            StorageManager.savePreview(bookmark.id, screenshot, 'visit', capturedAt)));

        chrome.runtime.sendMessage({
            type: 'preview-updated',
            bookmarkIds: targets.map((bookmark) => bookmark.id)
        }).catch(() => {});
    } catch (error) {
        console.debug('Visited-page preview capture skipped:', error.message);
    } finally {
        targets.forEach((bookmark) => visitCapturesInFlight.delete(bookmark.id));
    }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete') {
        captureVisitedBookmarkPreviews(tab).catch((error) =>
            console.debug('Visited-page preview capture skipped:', error.message));
    }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    try {
        await captureVisitedBookmarkPreviews(await chrome.tabs.get(tabId));
    } catch (error) {
        // The tab may have closed before it could be queried.
    }
});

// Background service worker for context menu bookmark capture
/* global StorageManager */

// Load shared storage utilities (order matters)
importScripts('js/indexeddb-storage.js', 'js/hybrid-storage.js', 'js/storage.js');

const ROOT_MENU_ID = 'startboard_add_bookmark';

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

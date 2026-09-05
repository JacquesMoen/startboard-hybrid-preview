/* global OffscreenHandler, PreviewMetadata, StorageManager */

const handleOffscreenMessage = OffscreenHandler.createOffscreenMessageHandler({
    getBookmark: (bookmarkId) => StorageManager.getBookmarkById(bookmarkId),
    refreshMetadata: (bookmark, options) =>
        PreviewMetadata.refreshBookmarkMetadata(bookmark, options),
    refreshFromCandidateGroups: (bookmark, groups, pageUrl, options) =>
        PreviewMetadata.refreshBookmarkFromCandidateGroups(bookmark, groups, pageUrl, options)
});

chrome.runtime.onMessage.addListener(handleOffscreenMessage);

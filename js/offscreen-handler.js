(function (root, factory) {
    const policy = root && root.PreviewPolicy ? root.PreviewPolicy : require('./preview-policy.js');
    const api = factory(policy);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.OffscreenHandler = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (PreviewPolicy) {
    function createOffscreenMessageHandler(dependencies) {
        return function onMessage(message, sender, sendResponse) {
            if (!message || message.type !== 'offscreen:thumbnail-refresh') return false;

            Promise.resolve().then(async () => {
                const bookmark = await dependencies.getBookmark(message.bookmarkId);
                if (!PreviewPolicy.isThumbnailBookmark(bookmark)) {
                    throw new Error('Bookmark is no longer in icon mode');
                }
                if (message.expectedUrl &&
                    PreviewPolicy.normalizeComparableUrl(bookmark.url) !==
                    PreviewPolicy.normalizeComparableUrl(message.expectedUrl)) {
                    throw new Error('Bookmark URL changed during refresh');
                }

                if (message.candidateGroups) {
                    await dependencies.refreshFromCandidateGroups(
                        bookmark,
                        message.candidateGroups,
                        message.pageUrl || bookmark.url,
                        { force: true, source: message.source || 'rendered-metadata' }
                    );
                } else {
                    await dependencies.refreshMetadata(bookmark, {
                        force: true,
                        source: message.source || 'metadata'
                    });
                }
                sendResponse({ success: true, bookmarkId: bookmark.id });
            }).catch((error) => {
                sendResponse({
                    success: false,
                    bookmarkId: message.bookmarkId,
                    error: error.message
                });
            });
            return true;
        };
    }

    return { createOffscreenMessageHandler };
});

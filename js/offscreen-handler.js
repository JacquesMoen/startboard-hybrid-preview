(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.OffscreenHandler = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function createOffscreenMessageHandler(dependencies) {
        return function onMessage(message, sender, sendResponse) {
            if (message && message.type === 'offscreen:ping') {
                sendResponse({ ready: true });
                return false;
            }
            if (!message || message.type !== 'offscreen:thumbnail-refresh') return false;

            Promise.resolve().then(async () => {
                let processed;
                if (message.candidateGroups) {
                    processed = await dependencies.processCandidates(
                        message.candidateGroups,
                        message.pageUrl || message.expectedUrl
                    );
                } else {
                    processed = await dependencies.findRepresentativeImage(message.expectedUrl);
                }
                await dependencies.publishResult({
                    type: 'offscreen:thumbnail-result',
                    requestId: message.requestId,
                    success: true,
                    bookmarkId: message.bookmarkId,
                    processed
                });
            }).catch((error) => {
                dependencies.publishResult({
                    type: 'offscreen:thumbnail-result',
                    requestId: message.requestId,
                    success: false,
                    bookmarkId: message.bookmarkId,
                    error: error.message
                });
            });
            return false;
        };
    }

    return { createOffscreenMessageHandler };
});

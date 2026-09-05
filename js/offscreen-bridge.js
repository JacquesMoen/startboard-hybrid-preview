(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.OffscreenBridge = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function createOffscreenBridge(chromeApi) {
        let creatingDocument = null;

        async function ensureDocument() {
            if (await chromeApi.offscreen.hasDocument()) return;
            if (!creatingDocument) {
                creatingDocument = chromeApi.offscreen.createDocument({
                    url: 'offscreen/offscreen.html',
                    reasons: ['DOM_PARSER'],
                    justification: 'Parse website metadata and prepare representative bookmark thumbnails'
                }).finally(() => {
                    creatingDocument = null;
                });
            }
            await creatingDocument;
        }

        async function refreshThumbnail(request) {
            await ensureDocument();
            const response = await chromeApi.runtime.sendMessage({
                type: 'offscreen:thumbnail-refresh',
                ...request
            });
            if (!response || !response.success) {
                throw new Error(response && response.error || 'Offscreen thumbnail refresh failed');
            }
            return response;
        }

        return { ensureDocument, refreshThumbnail };
    }

    return { createOffscreenBridge };
});

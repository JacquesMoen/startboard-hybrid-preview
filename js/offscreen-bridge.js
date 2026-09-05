(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.OffscreenBridge = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function createOffscreenBridge(chromeApi) {
        let creatingDocument = null;
        let documentReady = false;

        async function waitUntilReady() {
            if (documentReady) return;

            for (let attempt = 0; attempt < 20; attempt += 1) {
                try {
                    const response = await chromeApi.runtime.sendMessage({ type: 'offscreen:ping' });
                    if (response && response.ready) {
                        documentReady = true;
                        return;
                    }
                } catch (error) {
                    // The document exists before its scripts necessarily register listeners.
                }
                await new Promise(resolve => setTimeout(resolve, 50));
            }

            throw new Error('Offscreen thumbnail processor did not become ready');
        }

        async function ensureDocument() {
            if (!await chromeApi.offscreen.hasDocument()) {
                documentReady = false;
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
            await waitUntilReady();
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

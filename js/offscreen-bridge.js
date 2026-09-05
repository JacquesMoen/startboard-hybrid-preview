(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.OffscreenBridge = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function createOffscreenBridge(chromeApi) {
        let creatingDocument = null;
        let documentReady = false;
        let requestSequence = 0;
        const pendingRequests = new Map();
        const RESULT_TIMEOUT_MS = 60 * 1000;

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
            const requestId = `thumbnail-${Date.now()}-${++requestSequence}`;
            const completion = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    pendingRequests.delete(requestId);
                    reject(new Error('Offscreen thumbnail refresh timed out'));
                }, RESULT_TIMEOUT_MS);
                pendingRequests.set(requestId, { resolve, reject, timeout });
            });

            try {
                await chromeApi.runtime.sendMessage({
                    type: 'offscreen:thumbnail-refresh',
                    requestId,
                    ...request
                });
            } catch (error) {
                const pending = pendingRequests.get(requestId);
                if (pending) {
                    clearTimeout(pending.timeout);
                    pendingRequests.delete(requestId);
                }
                throw error;
            }

            return completion;
        }

        function handleMessage(message) {
            if (!message || message.type !== 'offscreen:thumbnail-result') return false;
            const pending = pendingRequests.get(message.requestId);
            if (!pending) return false;

            clearTimeout(pending.timeout);
            pendingRequests.delete(message.requestId);
            if (message.success) pending.resolve(message);
            else pending.reject(new Error(message.error || 'Offscreen thumbnail refresh failed'));
            return false;
        }

        return { ensureDocument, refreshThumbnail, handleMessage };
    }

    return { createOffscreenBridge };
});

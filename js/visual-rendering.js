(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.VisualRendering = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function resetVisualPresentation(preview) {
        preview.classList.remove('representative-thumbnail', 'screenshot-preview');
        preview.style.backgroundImage = '';
        preview.style.backgroundColor = '';
        if (preview.parentElement) {
            preview.parentElement.classList.remove('transparent-thumbnail-card');
        }
    }

    function applyRepresentativeThumbnail(preview, thumbnail) {
        preview.innerHTML = '';
        resetVisualPresentation(preview);
        preview.classList.add('representative-thumbnail');
        preview.style.backgroundColor = thumbnail.plateColor || 'var(--bg-tertiary)';
        preview.style.backgroundImage = `url("${thumbnail.imageDataUrl}")`;
        if (thumbnail.plateColor === 'transparent' && preview.parentElement) {
            preview.parentElement.classList.add('transparent-thumbnail-card');
        }
    }

    function applyScreenshot(preview, imageDataUrl, title, createElement) {
        preview.innerHTML = '';
        resetVisualPresentation(preview);
        preview.classList.add('screenshot-preview');
        const makeElement = createElement || ((tagName) => document.createElement(tagName));
        const image = makeElement('img');
        image.className = 'screenshot';
        image.src = imageDataUrl;
        image.alt = title || '';
        preview.appendChild(image);
    }

    function applyBookmarkFrameSetting(body, showFrames) {
        body.classList.toggle('bookmark-frames-hidden', showFrames === false);
    }

    async function requestVisualRefresh(chromeApi, bookmarkId, source) {
        const response = await chromeApi.runtime.sendMessage({
            type: 'visual:refresh',
            bookmarkId,
            source
        });
        if (!response || !response.success) {
            throw new Error(response && response.error || 'Visual refresh failed');
        }
        return true;
    }

    return {
        applyRepresentativeThumbnail,
        applyScreenshot,
        applyBookmarkFrameSetting,
        requestVisualRefresh
    };
});

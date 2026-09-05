(function (root, factory) {
    const policy = root && root.PreviewPolicy ? root.PreviewPolicy : require('./preview-policy.js');
    const api = factory(policy, root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.PreviewMetadata = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (PreviewPolicy, runtime) {
    const REQUEST_TIMEOUT_MS = 8000;
    const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
    const MAX_CONTENT_IMAGES = 12;
    const THUMBNAIL_WIDTH = 440;
    const THUMBNAIL_HEIGHT = 248;
    const inFlight = new Map();

    function getStorageManager(override) {
        if (override) return override;
        if (runtime.StorageManager) return runtime.StorageManager;
        if (typeof StorageManager !== 'undefined') return StorageManager;
        throw new Error('StorageManager is unavailable');
    }

    function values(document, selector, attributes) {
        return Array.from(document.querySelectorAll(selector))
            .map((element) => attributes.map((name) => element.getAttribute(name)).find(Boolean))
            .filter(Boolean);
    }

    function documentIconCandidates(document) {
        return Array.from(document.querySelectorAll('link[rel~="apple-touch-icon"], link[rel~="icon"]'))
            .map((element, index) => ({
                src: element.getAttribute('href'),
                sizes: element.getAttribute('sizes'),
                index
            }))
            .filter((icon) => icon.src)
            .sort((a, b) => iconArea(b) - iconArea(a) || a.index - b.index)
            .map((icon) => icon.src);
    }

    function extractCandidateGroups(document) {
        return {
            openGraph: values(document,
                'meta[property="og:image"], meta[property="og:image:secure_url"]', ['content']),
            twitter: values(document,
                'meta[name="twitter:image"], meta[name="twitter:image:src"]', ['content']),
            schema: values(document,
                'meta[itemprop="image"], link[itemprop="image"], img[itemprop="image"]', ['content', 'href', 'src']),
            imageSrc: values(document, 'link[rel="image_src"]', ['href']),
            icons: documentIconCandidates(document),
            manifestUrls: values(document, 'link[rel~="manifest"]', ['href']),
            content: values(document, 'img[src], img[data-src]', ['src', 'data-src']).slice(0, MAX_CONTENT_IMAGES)
        };
    }

    function iconArea(icon) {
        const sizes = String(icon && icon.sizes || '').toLowerCase();
        if (sizes.includes('any')) return 256 * 256;
        return sizes.split(/\s+/).reduce((largest, size) => {
            const match = size.match(/^(\d+)x(\d+)$/);
            return match ? Math.max(largest, Number(match[1]) * Number(match[2])) : largest;
        }, 0);
    }

    function sortManifestIcons(icons) {
        return (Array.isArray(icons) ? icons : [])
            .filter((icon) => icon && icon.src)
            .slice()
            .sort((a, b) => iconArea(b) - iconArea(a))
            .map((icon) => icon.src);
    }

    async function fetchWithTimeout(url, options = {}, fetchImpl = runtime.fetch.bind(runtime)) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            return await fetchImpl(url, { ...options, signal: controller.signal });
        } finally {
            clearTimeout(timeout);
        }
    }

    function blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error || new Error('Unable to read preview image'));
            reader.readAsDataURL(blob);
        });
    }

    function calculateCoverCrop(sourceWidth, sourceHeight, targetWidth, targetHeight) {
        const sourceRatio = sourceWidth / sourceHeight;
        const targetRatio = targetWidth / targetHeight;

        if (sourceRatio > targetRatio) {
            const sourceWidthCropped = sourceHeight * targetRatio;
            return {
                sourceX: (sourceWidth - sourceWidthCropped) / 2,
                sourceY: 0,
                sourceWidth: sourceWidthCropped,
                sourceHeight
            };
        }

        const sourceHeightCropped = sourceWidth / targetRatio;
        return {
            sourceX: 0,
            sourceY: (sourceHeight - sourceHeightCropped) / 2,
            sourceWidth,
            sourceHeight: sourceHeightCropped
        };
    }

    function resizeToThumbnail(imageDataUrl, options = {}) {
        return new Promise((resolve, reject) => {
            const image = options.createImage ? options.createImage() : new Image();
            image.onload = () => {
                try {
                    const canvas = options.createCanvas
                        ? options.createCanvas()
                        : document.createElement('canvas');
                    canvas.width = THUMBNAIL_WIDTH;
                    canvas.height = THUMBNAIL_HEIGHT;
                    const context = canvas.getContext('2d');
                    const crop = calculateCoverCrop(
                        image.naturalWidth || image.width,
                        image.naturalHeight || image.height,
                        THUMBNAIL_WIDTH,
                        THUMBNAIL_HEIGHT
                    );
                    context.drawImage(
                        image,
                        crop.sourceX,
                        crop.sourceY,
                        crop.sourceWidth,
                        crop.sourceHeight,
                        0,
                        0,
                        THUMBNAIL_WIDTH,
                        THUMBNAIL_HEIGHT
                    );
                    resolve(canvas.toDataURL('image/webp', 0.86));
                } catch (error) {
                    reject(error);
                }
            };
            image.onerror = () => reject(new Error('Unable to decode preview image'));
            image.src = imageDataUrl;
        });
    }

    async function manifestCandidates(manifestUrls, pageUrl, fetchImpl) {
        for (const rawUrl of manifestUrls) {
            try {
                const manifestUrl = new URL(rawUrl, pageUrl).href;
                const response = await fetchWithTimeout(manifestUrl, {}, fetchImpl);
                if (!response.ok) continue;
                const manifest = await response.json();
                return sortManifestIcons(manifest.icons);
            } catch (error) {
                // Try the next manifest, if present.
            }
        }
        return [];
    }

    async function downloadImage(candidateUrl, fetchImpl) {
        const response = await fetchWithTimeout(candidateUrl, {}, fetchImpl);
        if (!response.ok) throw new Error(`Preview image request failed: ${response.status}`);

        const declaredType = response.headers.get('content-type') || '';
        const declaredLength = Number(response.headers.get('content-length') || 0);
        if (declaredType && !declaredType.startsWith('image/')) throw new Error('Preview candidate is not an image');
        if (declaredLength > MAX_IMAGE_BYTES) throw new Error('Preview candidate is too large');

        const blob = await response.blob();
        if (blob.size > MAX_IMAGE_BYTES || (blob.type && !blob.type.startsWith('image/'))) {
            throw new Error('Preview candidate is invalid');
        }
        return blobToDataUrl(blob);
    }

    async function findRepresentativeImage(pageUrl, options = {}) {
        const fetchImpl = options.fetchImpl || runtime.fetch.bind(runtime);
        const parser = options.parser || new DOMParser();
        const pageResponse = await fetchWithTimeout(pageUrl, {
            headers: { Accept: 'text/html,application/xhtml+xml' }
        }, fetchImpl);
        if (!pageResponse.ok) throw new Error(`Page request failed: ${pageResponse.status}`);

        const document = parser.parseFromString(await pageResponse.text(), 'text/html');
        const groups = extractCandidateGroups(document);
        groups.manifest = await manifestCandidates(groups.manifestUrls, pageUrl, fetchImpl);
        const candidates = PreviewPolicy.selectPreviewCandidates(groups, pageUrl);
        const thumbnailer = options.thumbnailer || resizeToThumbnail;

        for (const candidate of candidates) {
            try {
                return await thumbnailer(await downloadImage(candidate, fetchImpl));
            } catch (error) {
                // Candidate URLs are best-effort; continue in ranked order.
            }
        }
        throw new Error('No usable preview image found');
    }

    async function refreshBookmarkMetadata(bookmark, options = {}) {
        if (!bookmark || !bookmark.id) return false;
        if (!options.force && !PreviewPolicy.shouldRefreshMetadata(bookmark)) return false;
        if (inFlight.has(bookmark.id)) return inFlight.get(bookmark.id);

        const task = (async () => {
            const checkedAt = Date.now();
            const storage = getStorageManager(options.storage);
            try {
                const imageDataUrl = await findRepresentativeImage(bookmark.url, options);
                await storage.savePreview(bookmark.id, imageDataUrl, 'metadata', checkedAt);
                return true;
            } catch (error) {
                await storage.markPreviewMetadataChecked(bookmark.id, checkedAt);
                throw error;
            } finally {
                inFlight.delete(bookmark.id);
            }
        })();

        inFlight.set(bookmark.id, task);
        return task;
    }

    async function refreshStalePreviews(onUpdated) {
        const storage = getStorageManager();
        const bookmarks = await storage.getBookmarks();
        const queue = bookmarks.filter((bookmark) => PreviewPolicy.shouldRefreshMetadata(bookmark));
        const updatedIds = [];
        let nextIndex = 0;

        async function worker() {
            while (nextIndex < queue.length) {
                const bookmark = queue[nextIndex++];
                try {
                    if (await refreshBookmarkMetadata(bookmark)) updatedIds.push(bookmark.id);
                } catch (error) {
                    console.debug(`Metadata preview unavailable for ${bookmark.url}`);
                }
            }
        }

        await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker));
        if (updatedIds.length && onUpdated) await onUpdated(updatedIds);
        return updatedIds;
    }

    return {
        extractCandidateGroups,
        sortManifestIcons,
        calculateCoverCrop,
        resizeToThumbnail,
        findRepresentativeImage,
        refreshBookmarkMetadata,
        refreshStalePreviews
    };
});

(function (root, factory) {
    const policy = root && root.PreviewPolicy ? root.PreviewPolicy : require('./preview-policy.js');
    const api = factory(policy, root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.PreviewMetadata = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (PreviewPolicy, runtime) {
    const REQUEST_TIMEOUT_MS = 8000;
    const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
    const MAX_CONTENT_IMAGES = 12;
    const MAX_THUMBNAIL_WIDTH = 1200;
    const MAX_THUMBNAIL_HEIGHT = 675;
    const TARGET_RATIO = MAX_THUMBNAIL_WIDTH / MAX_THUMBNAIL_HEIGHT;
    const RATIO_TOLERANCE = 0.25;
    const MIN_USEFUL_IMAGE_SIZE = 96;
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

    function iconArea(icon) {
        const sizes = String(icon && icon.sizes || '').toLowerCase();
        if (sizes.includes('any')) return 256 * 256;
        return sizes.split(/\s+/).reduce((largest, size) => {
            const match = size.match(/^(\d+)x(\d+)$/);
            return match ? Math.max(largest, Number(match[1]) * Number(match[2])) : largest;
        }, 0);
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

    function sortManifestIcons(icons) {
        return (Array.isArray(icons) ? icons : [])
            .filter((icon) => icon && icon.src)
            .slice()
            .sort((a, b) => iconArea(b) - iconArea(a))
            .map((icon) => icon.src);
    }

    function fetchWithTimeout(url, options = {}, fetchImpl = runtime.fetch.bind(runtime)) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        return Promise.resolve(fetchImpl(url, { ...options, signal: controller.signal }))
            .finally(() => clearTimeout(timeout));
    }

    function blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error || new Error('Unable to read thumbnail image'));
            reader.readAsDataURL(blob);
        });
    }

    function calculateThumbnailPlan(sourceWidth, sourceHeight) {
        if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) ||
            sourceWidth <= 0 || sourceHeight <= 0) {
            throw new Error('Invalid image dimensions');
        }

        const sourceRatio = sourceWidth / sourceHeight;
        const closeToTarget = Math.abs(sourceRatio - TARGET_RATIO) <= RATIO_TOLERANCE;
        let sourceX = 0;
        let sourceY = 0;
        let croppedWidth = sourceWidth;
        let croppedHeight = sourceHeight;

        if (closeToTarget) {
            if (sourceRatio > TARGET_RATIO) {
                croppedWidth = sourceHeight * TARGET_RATIO;
                sourceX = (sourceWidth - croppedWidth) / 2;
            } else {
                croppedHeight = sourceWidth / TARGET_RATIO;
                sourceY = (sourceHeight - croppedHeight) / 2;
            }
        }

        const shouldFillTarget = closeToTarget &&
            (sourceWidth >= MAX_THUMBNAIL_WIDTH || sourceHeight >= MAX_THUMBNAIL_HEIGHT);
        const scale = shouldFillTarget
            ? Math.min(MAX_THUMBNAIL_WIDTH / croppedWidth, MAX_THUMBNAIL_HEIGHT / croppedHeight)
            : Math.min(1, MAX_THUMBNAIL_WIDTH / croppedWidth, MAX_THUMBNAIL_HEIGHT / croppedHeight);

        return {
            canvasWidth: Math.max(1, Math.round(croppedWidth * scale)),
            canvasHeight: Math.max(1, Math.round(croppedHeight * scale)),
            sourceX,
            sourceY,
            sourceWidth: croppedWidth,
            sourceHeight: croppedHeight
        };
    }

    function sampleEdgeColor(pixelData, width, height) {
        if (!pixelData || !width || !height) return 'rgb(255, 255, 255)';
        const step = Math.max(1, Math.floor(Math.min(width, height) / 64));
        let red = 0;
        let green = 0;
        let blue = 0;
        let count = 0;

        function addPixel(x, y) {
            const index = (y * width + x) * 4;
            const alpha = pixelData[index + 3];
            if (!alpha) return;
            red += pixelData[index];
            green += pixelData[index + 1];
            blue += pixelData[index + 2];
            count += 1;
        }

        for (let x = 0; x < width; x += step) {
            addPixel(x, 0);
            if (height > 1) addPixel(x, height - 1);
        }
        for (let y = step; y < height - 1; y += step) {
            addPixel(0, y);
            if (width > 1) addPixel(width - 1, y);
        }

        if (!count) return 'rgb(255, 255, 255)';
        return `rgb(${Math.round(red / count)}, ${Math.round(green / count)}, ${Math.round(blue / count)})`;
    }

    function resizeToThumbnail(imageDataUrl, options = {}) {
        return new Promise((resolve, reject) => {
            const image = options.createImage ? options.createImage() : new Image();
            image.onload = () => {
                try {
                    const width = image.naturalWidth || image.width;
                    const height = image.naturalHeight || image.height;
                    if (width < MIN_USEFUL_IMAGE_SIZE && height < MIN_USEFUL_IMAGE_SIZE) {
                        throw new Error('Representative image is too small');
                    }

                    const plan = calculateThumbnailPlan(width, height);
                    const canvas = options.createCanvas
                        ? options.createCanvas()
                        : document.createElement('canvas');
                    canvas.width = plan.canvasWidth;
                    canvas.height = plan.canvasHeight;
                    const context = canvas.getContext('2d', { willReadFrequently: true });
                    context.imageSmoothingEnabled = true;
                    context.imageSmoothingQuality = 'high';
                    context.drawImage(
                        image,
                        plan.sourceX,
                        plan.sourceY,
                        plan.sourceWidth,
                        plan.sourceHeight,
                        0,
                        0,
                        plan.canvasWidth,
                        plan.canvasHeight
                    );
                    const pixels = context.getImageData(0, 0, plan.canvasWidth, plan.canvasHeight).data;
                    resolve({
                        imageDataUrl: canvas.toDataURL('image/webp', 0.86),
                        plateColor: sampleEdgeColor(pixels, plan.canvasWidth, plan.canvasHeight)
                    });
                } catch (error) {
                    reject(error);
                }
            };
            image.onerror = () => reject(new Error('Unable to decode representative image'));
            image.src = imageDataUrl;
        });
    }

    async function manifestCandidates(manifestUrls, pageUrl, fetchImpl) {
        for (const rawUrl of manifestUrls || []) {
            try {
                const manifestUrl = new URL(rawUrl, pageUrl).href;
                const response = await fetchWithTimeout(manifestUrl, {}, fetchImpl);
                if (!response.ok) continue;
                const manifest = await response.json();
                return sortManifestIcons(manifest.icons);
            } catch (error) {
                // Try the next manifest.
            }
        }
        return [];
    }

    async function downloadImage(candidateUrl, fetchImpl) {
        const response = await fetchWithTimeout(candidateUrl, {}, fetchImpl);
        if (!response.ok) throw new Error(`Thumbnail request failed: ${response.status}`);

        const declaredType = response.headers.get('content-type') || '';
        const declaredLength = Number(response.headers.get('content-length') || 0);
        if (declaredType && !declaredType.startsWith('image/')) throw new Error('Candidate is not an image');
        if (declaredLength > MAX_IMAGE_BYTES) throw new Error('Candidate is too large');

        const blob = await response.blob();
        if (blob.size > MAX_IMAGE_BYTES || (blob.type && !blob.type.startsWith('image/'))) {
            throw new Error('Candidate is invalid');
        }
        return blobToDataUrl(blob);
    }

    async function collectCandidates(groups, pageUrl, fetchImpl) {
        const completeGroups = { ...groups };
        completeGroups.manifest = await manifestCandidates(groups.manifestUrls, pageUrl, fetchImpl);
        return PreviewPolicy.selectPreviewCandidates(completeGroups, pageUrl);
    }

    async function processCandidates(groups, pageUrl, options = {}) {
        const fetchImpl = options.fetchImpl || runtime.fetch.bind(runtime);
        const thumbnailer = options.thumbnailer || resizeToThumbnail;
        const candidates = await collectCandidates(groups, pageUrl, fetchImpl);

        for (const sourceUrl of candidates) {
            try {
                const processed = await thumbnailer(await downloadImage(sourceUrl, fetchImpl));
                return { ...processed, sourceUrl };
            } catch (error) {
                // Candidate URLs are best-effort; continue in ranked order.
            }
        }
        throw new Error('No usable representative image found');
    }

    async function findRepresentativeImage(pageUrl, options = {}) {
        const fetchImpl = options.fetchImpl || runtime.fetch.bind(runtime);
        const parser = options.parser || new DOMParser();
        const pageResponse = await fetchWithTimeout(pageUrl, {
            headers: { Accept: 'text/html,application/xhtml+xml' }
        }, fetchImpl);
        if (!pageResponse.ok) throw new Error(`Page request failed: ${pageResponse.status}`);

        const document = parser.parseFromString(await pageResponse.text(), 'text/html');
        return processCandidates(extractCandidateGroups(document), pageUrl, options);
    }

    async function saveProcessedThumbnail(bookmark, processed, options) {
        const timestamp = options.now ? options.now() : Date.now();
        const storage = getStorageManager(options.storage);
        await storage.saveThumbnail(bookmark.id, processed.imageDataUrl, {
            plateColor: processed.plateColor,
            sourceUrl: processed.sourceUrl,
            source: options.source || 'metadata',
            timestamp,
            expectedUrl: bookmark.url
        });
    }

    async function withBookmarkLock(bookmark, work) {
        if (!bookmark || !bookmark.id || !PreviewPolicy.isThumbnailBookmark(bookmark)) return false;
        if (inFlight.has(bookmark.id)) return inFlight.get(bookmark.id);

        const task = Promise.resolve()
            .then(work)
            .finally(() => inFlight.delete(bookmark.id));
        inFlight.set(bookmark.id, task);
        return task;
    }

    async function refreshBookmarkMetadata(bookmark, options = {}) {
        if (!options.force && !PreviewPolicy.shouldRefreshMetadata(bookmark)) return false;
        return withBookmarkLock(bookmark, async () => {
            const processed = await findRepresentativeImage(bookmark.url, options);
            await saveProcessedThumbnail(bookmark, processed, { ...options, source: options.source || 'metadata' });
            return true;
        });
    }

    async function refreshBookmarkFromCandidateGroups(bookmark, groups, pageUrl, options = {}) {
        return withBookmarkLock(bookmark, async () => {
            const processed = await processCandidates(groups, pageUrl || bookmark.url, options);
            await saveProcessedThumbnail(bookmark, processed, {
                ...options,
                source: options.source || 'rendered-metadata'
            });
            return true;
        });
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
                    console.debug(`Representative thumbnail unavailable for ${bookmark.url}`);
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
        calculateThumbnailPlan,
        sampleEdgeColor,
        resizeToThumbnail,
        processCandidates,
        findRepresentativeImage,
        refreshBookmarkMetadata,
        refreshBookmarkFromCandidateGroups,
        refreshStalePreviews
    };
});

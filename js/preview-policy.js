(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.PreviewPolicy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const DAY_MS = 24 * 60 * 60 * 1000;

    function isPreviewBookmark(bookmark) {
        return Boolean(bookmark) &&
            (bookmark.displayType === 'preview' || !bookmark.displayType) &&
            Boolean(normalizeComparableUrl(bookmark.url));
    }

    function normalizeComparableUrl(value) {
        try {
            const url = new URL(value);
            if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
            url.hash = '';
            if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
            return url.href.replace(/\/$/, '');
        } catch (error) {
            return null;
        }
    }

    function isStale(timestamp, now, intervalMs) {
        return !Number.isFinite(timestamp) || now - timestamp >= intervalMs;
    }

    function shouldRefreshMetadata(bookmark, now = Date.now()) {
        if (!isPreviewBookmark(bookmark)) return false;
        if (bookmark.previewSource === 'visit' || bookmark.previewSource === 'manual') return false;
        return isStale(bookmark.previewMetadataCheckedAt, now, DAY_MS);
    }

    function shouldCaptureVisit(bookmark, tabUrl, now = Date.now()) {
        if (!isPreviewBookmark(bookmark)) return false;
        if (normalizeComparableUrl(bookmark.url) !== normalizeComparableUrl(tabUrl)) return false;
        return isStale(bookmark.previewVisitCapturedAt, now, DAY_MS);
    }

    function markPreview(bookmark, source, now = Date.now()) {
        const updated = {
            ...bookmark,
            previewSource: source,
            previewUpdatedAt: now
        };

        if (source === 'metadata') updated.previewMetadataCheckedAt = now;
        if (source === 'visit') updated.previewVisitCapturedAt = now;
        return updated;
    }

    function selectPreviewCandidates(groups, baseUrl) {
        const orderedGroups = ['openGraph', 'twitter', 'schema', 'imageSrc', 'manifest', 'content'];
        const seen = new Set();
        const candidates = [];

        for (const group of orderedGroups) {
            for (const candidate of groups[group] || []) {
                try {
                    const url = new URL(candidate, baseUrl);
                    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || seen.has(url.href)) continue;
                    seen.add(url.href);
                    candidates.push(url.href);
                } catch (error) {
                    // Ignore malformed image URLs.
                }
            }
        }

        return candidates;
    }

    return {
        DAY_MS,
        normalizeComparableUrl,
        shouldRefreshMetadata,
        shouldCaptureVisit,
        markPreview,
        selectPreviewCandidates
    };
});

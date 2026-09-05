(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.PreviewPolicy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const WEEK_MS = 7 * DAY_MS;
    const DEFAULT_BOOKMARK_DISPLAY_TYPE = 'preview';

    function isScreenshotBookmark(bookmark) {
        return Boolean(bookmark) &&
            (bookmark.displayType === 'preview' || !bookmark.displayType) &&
            Boolean(normalizeComparableUrl(bookmark.url));
    }

    function isThumbnailBookmark(bookmark) {
        return Boolean(bookmark) &&
            bookmark.displayType === 'icon' &&
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

    function exactBookmarkUrlMatches(bookmark, tabUrl) {
        return normalizeComparableUrl(bookmark && bookmark.url) === normalizeComparableUrl(tabUrl);
    }

    function isVisualRequestCurrent(bookmark, expectedUrl, displayType) {
        if (!exactBookmarkUrlMatches(bookmark, expectedUrl)) return false;
        if (displayType === 'preview') return isScreenshotBookmark(bookmark);
        if (displayType === 'icon') return isThumbnailBookmark(bookmark);
        return false;
    }

    function shouldCaptureScreenshotVisit(bookmark, tabUrl, now = Date.now()) {
        if (!isScreenshotBookmark(bookmark) || !exactBookmarkUrlMatches(bookmark, tabUrl)) return false;
        return isStale(bookmark.screenshotVisitCapturedAt, now, DAY_MS);
    }

    function shouldRefreshThumbnailVisit(bookmark, tabUrl, now = Date.now()) {
        if (!isThumbnailBookmark(bookmark) || !exactBookmarkUrlMatches(bookmark, tabUrl)) return false;
        return isStale(bookmark.thumbnailVisitRefreshedAt, now, DAY_MS);
    }

    function isScheduledScreenshotDue(bookmark, now = Date.now()) {
        if (!isScreenshotBookmark(bookmark)) return false;
        const interval = bookmark.screenshotRefreshInterval;
        if (interval !== 'daily' && interval !== 'weekly') return false;
        return isStale(bookmark.screenshotUpdatedAt, now, interval === 'daily' ? DAY_MS : WEEK_MS);
    }

    function markScreenshot(bookmark, source, now = Date.now()) {
        const updated = {
            ...bookmark,
            screenshotSource: source,
            screenshotUpdatedAt: now
        };

        if (source === 'visit') updated.screenshotVisitCapturedAt = now;
        return updated;
    }

    function markThumbnail(bookmark, details = {}, now = Date.now()) {
        const updated = {
            ...bookmark,
            thumbnailSource: details.source || 'metadata',
            thumbnailSourceUrl: details.sourceUrl || null,
            thumbnailPlateColor: details.plateColor || null,
            thumbnailUpdatedAt: now
        };

        if (details.source === 'rendered-metadata') updated.thumbnailVisitRefreshedAt = now;
        return updated;
    }

    function selectPreviewCandidates(groups, baseUrl) {
        const orderedGroups = ['openGraph', 'twitter', 'schema', 'imageSrc', 'manifest', 'icons', 'content'];
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
        WEEK_MS,
        DEFAULT_BOOKMARK_DISPLAY_TYPE,
        normalizeComparableUrl,
        isScreenshotBookmark,
        isThumbnailBookmark,
        shouldCaptureScreenshotVisit,
        shouldRefreshThumbnailVisit,
        isScheduledScreenshotDue,
        isVisualRequestCurrent,
        markScreenshot,
        markThumbnail,
        // Temporary compatibility aliases while older call sites migrate.
        shouldRefreshMetadata: (bookmark, now) =>
            isThumbnailBookmark(bookmark) && isStale(bookmark.thumbnailUpdatedAt, now || Date.now(), DAY_MS),
        shouldCaptureVisit: shouldCaptureScreenshotVisit,
        markPreview: (bookmark, source, now) => source === 'metadata'
            ? markThumbnail(bookmark, { source }, now)
            : markScreenshot(bookmark, source, now),
        selectPreviewCandidates
    };
});

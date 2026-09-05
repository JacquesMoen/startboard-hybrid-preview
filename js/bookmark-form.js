(function (root, factory) {
    const policy = root && root.PreviewPolicy ? root.PreviewPolicy : require('./preview-policy.js');
    const api = factory(policy);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.BookmarkFormPolicy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (PreviewPolicy) {
    const SCREENSHOT_REFRESH_INTERVALS = new Set(['off', 'daily', 'weekly']);

    function normalizeScreenshotRefreshInterval(value) {
        return SCREENSHOT_REFRESH_INTERVALS.has(value) ? value : 'off';
    }

    function getDisplayFieldVisibility(displayType) {
        return {
            showScreenshotSchedule: displayType === 'preview',
            showCustomImage: displayType === 'custom'
        };
    }

    function getVisualRefreshSource(previousBookmark, nextBookmark) {
        if (!nextBookmark || (nextBookmark.displayType !== 'preview' && nextBookmark.displayType !== 'icon')) {
            return null;
        }
        if (!previousBookmark) return 'initial';

        const previousUrl = PreviewPolicy.normalizeComparableUrl(previousBookmark.url);
        const nextUrl = PreviewPolicy.normalizeComparableUrl(nextBookmark.url);
        if (previousBookmark.displayType !== nextBookmark.displayType || previousUrl !== nextUrl) {
            return 'transition';
        }
        return null;
    }

    return {
        normalizeScreenshotRefreshInterval,
        getDisplayFieldVisibility,
        getVisualRefreshSource
    };
});

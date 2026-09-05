const test = require('node:test');
const assert = require('node:assert/strict');

const {
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
    selectPreviewCandidates
} = require('../js/preview-policy.js');

const NOW = Date.UTC(2026, 8, 5, 12, 0, 0);

test('normalizes only web URLs and ignores hashes and trailing slashes', () => {
    assert.equal(normalizeComparableUrl('https://example.com/path/#news'), 'https://example.com/path');
    assert.equal(normalizeComparableUrl('chrome://extensions'), null);
});

test('keeps the existing default display type', () => {
    assert.equal(DEFAULT_BOOKMARK_DISPLAY_TYPE, 'preview');
});

test('identifies screenshot and representative-thumbnail modes independently', () => {
    assert.equal(isScreenshotBookmark({ url: 'https://example.com', displayType: 'preview' }), true);
    assert.equal(isScreenshotBookmark({ url: 'https://example.com', displayType: 'icon' }), false);
    assert.equal(isThumbnailBookmark({ url: 'https://example.com', displayType: 'icon' }), true);
    assert.equal(isThumbnailBookmark({ url: 'https://example.com', displayType: 'preview' }), false);
});

test('daily and weekly schedules become due after a deadline missed while Chrome was closed', () => {
    const daily = {
        url: 'https://example.com/daily',
        displayType: 'preview',
        screenshotRefreshInterval: 'daily',
        screenshotUpdatedAt: NOW - DAY_MS
    };
    const weekly = {
        url: 'https://example.com/weekly',
        displayType: 'preview',
        screenshotRefreshInterval: 'weekly',
        screenshotUpdatedAt: NOW - WEEK_MS
    };

    assert.equal(isScheduledScreenshotDue(daily, NOW), true);
    assert.equal(isScheduledScreenshotDue({ ...daily, screenshotUpdatedAt: NOW - DAY_MS + 1 }, NOW), false);
    assert.equal(isScheduledScreenshotDue(weekly, NOW), true);
    assert.equal(isScheduledScreenshotDue({ ...weekly, screenshotUpdatedAt: NOW - WEEK_MS + 1 }, NOW), false);
    assert.equal(isScheduledScreenshotDue({ ...daily, screenshotRefreshInterval: 'off' }, NOW), false);
    assert.equal(isScheduledScreenshotDue({ ...daily, displayType: 'icon' }, NOW), false);
});

test('a scheduled screenshot with no valid timestamp is immediately due', () => {
    assert.equal(isScheduledScreenshotDue({
        url: 'https://example.com',
        displayType: 'preview',
        screenshotRefreshInterval: 'daily'
    }, NOW), true);
});

test('visit refresh routes require an exact normalized URL and their own mode', () => {
    const screenshot = { url: 'https://example.com/news/', displayType: 'preview' };
    const thumbnail = { url: 'https://example.com/news/', displayType: 'icon' };

    assert.equal(shouldCaptureScreenshotVisit(screenshot, 'https://example.com/news#latest', NOW), true);
    assert.equal(shouldCaptureScreenshotVisit(screenshot, 'https://example.com/other', NOW), false);
    assert.equal(shouldCaptureScreenshotVisit({ ...screenshot, displayType: 'icon' }, screenshot.url, NOW), false);
    assert.equal(shouldCaptureScreenshotVisit({ ...screenshot, screenshotVisitCapturedAt: NOW - DAY_MS + 1 }, screenshot.url, NOW), false);

    assert.equal(shouldRefreshThumbnailVisit(thumbnail, 'https://example.com/news#latest', NOW), true);
    assert.equal(shouldRefreshThumbnailVisit(thumbnail, 'https://example.com/other', NOW), false);
    assert.equal(shouldRefreshThumbnailVisit({ ...thumbnail, displayType: 'preview' }, thumbnail.url, NOW), false);
    assert.equal(shouldRefreshThumbnailVisit({ ...thumbnail, thumbnailVisitRefreshedAt: NOW - DAY_MS + 1 }, thumbnail.url, NOW), false);
});

test('async visual results remain valid only while URL and display mode are unchanged', () => {
    const screenshot = { url: 'https://example.com/page/', displayType: 'preview' };
    const thumbnail = { url: 'https://example.com/page/', displayType: 'icon' };

    assert.equal(isVisualRequestCurrent(screenshot, 'https://example.com/page#top', 'preview'), true);
    assert.equal(isVisualRequestCurrent(thumbnail, 'https://example.com/page#top', 'icon'), true);
    assert.equal(isVisualRequestCurrent(screenshot, 'https://example.com/other', 'preview'), false);
    assert.equal(isVisualRequestCurrent({ ...screenshot, displayType: 'icon' }, screenshot.url, 'preview'), false);
    assert.equal(isVisualRequestCurrent({ ...thumbnail, displayType: 'custom' }, thumbnail.url, 'icon'), false);
});

test('screenshot metadata records the source and visit throttle separately', () => {
    assert.deepEqual(markScreenshot({}, 'manual', NOW), {
        screenshotSource: 'manual',
        screenshotUpdatedAt: NOW
    });
    assert.deepEqual(markScreenshot({}, 'visit', NOW), {
        screenshotSource: 'visit',
        screenshotUpdatedAt: NOW,
        screenshotVisitCapturedAt: NOW
    });
});

test('thumbnail metadata records source URL, plate color, and visit throttle separately', () => {
    assert.deepEqual(markThumbnail({}, {
        source: 'rendered-metadata',
        sourceUrl: 'https://cdn.example.com/og.jpg',
        plateColor: 'rgb(10, 20, 30)'
    }, NOW), {
        thumbnailSource: 'rendered-metadata',
        thumbnailSourceUrl: 'https://cdn.example.com/og.jpg',
        thumbnailPlateColor: 'rgb(10, 20, 30)',
        thumbnailUpdatedAt: NOW,
        thumbnailVisitRefreshedAt: NOW
    });
});

test('candidate selection prioritizes social images and resolves relative URLs', () => {
    const candidates = selectPreviewCandidates({
        openGraph: ['/og.jpg'],
        twitter: ['https://cdn.example.com/twitter.jpg'],
        schema: ['/schema.jpg'],
        imageSrc: ['/image-src.jpg'],
        manifest: ['/icon-512.png'],
        icons: ['/apple-touch.png'],
        content: ['/first.jpg', 'data:image/png;base64,ignored']
    }, 'https://example.com/articles/page');

    assert.deepEqual(candidates, [
        'https://example.com/og.jpg',
        'https://cdn.example.com/twitter.jpg',
        'https://example.com/schema.jpg',
        'https://example.com/image-src.jpg',
        'https://example.com/icon-512.png',
        'https://example.com/apple-touch.png',
        'https://example.com/first.jpg'
    ]);
});

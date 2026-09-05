const test = require('node:test');
const assert = require('node:assert/strict');

const {
    DAY_MS,
    normalizeComparableUrl,
    shouldRefreshMetadata,
    shouldCaptureVisit,
    markPreview,
    selectPreviewCandidates
} = require('../js/preview-policy.js');

const NOW = Date.UTC(2026, 8, 5, 12, 0, 0);

test('normalizes only safe web URLs and ignores hash and trailing slash', () => {
    assert.equal(normalizeComparableUrl('https://example.com/path/#news'), 'https://example.com/path');
    assert.equal(normalizeComparableUrl('chrome://extensions'), null);
});

test('metadata refresh runs for stale preview bookmarks but not fresh or high-quality previews', () => {
    const bookmark = { url: 'https://example.com', displayType: 'preview' };

    assert.equal(shouldRefreshMetadata(bookmark, NOW), true);
    assert.equal(shouldRefreshMetadata({ ...bookmark, previewMetadataCheckedAt: NOW - DAY_MS + 1 }, NOW), false);
    assert.equal(shouldRefreshMetadata({ ...bookmark, previewSource: 'visit' }, NOW), false);
    assert.equal(shouldRefreshMetadata({ ...bookmark, previewSource: 'manual' }, NOW), false);
    assert.equal(shouldRefreshMetadata({ ...bookmark, displayType: 'icon' }, NOW), false);
});

test('visit capture requires the exact normalized bookmarked page and is throttled for 24 hours', () => {
    const bookmark = { url: 'https://example.com/news/', displayType: 'preview' };

    assert.equal(shouldCaptureVisit(bookmark, 'https://example.com/news#latest', NOW), true);
    assert.equal(shouldCaptureVisit(bookmark, 'https://example.com/other', NOW), false);
    assert.equal(shouldCaptureVisit({ ...bookmark, previewVisitCapturedAt: NOW - DAY_MS + 1 }, bookmark.url, NOW), false);
    assert.equal(shouldCaptureVisit({ ...bookmark, displayType: 'icon' }, bookmark.url, NOW), false);
});

test('preview metadata records source and source-specific timestamps', () => {
    assert.deepEqual(markPreview({}, 'metadata', NOW), {
        previewSource: 'metadata',
        previewUpdatedAt: NOW,
        previewMetadataCheckedAt: NOW
    });
    assert.deepEqual(markPreview({}, 'visit', NOW), {
        previewSource: 'visit',
        previewUpdatedAt: NOW,
        previewVisitCapturedAt: NOW
    });
    assert.deepEqual(markPreview({}, 'manual', NOW), {
        previewSource: 'manual',
        previewUpdatedAt: NOW
    });
});

test('candidate selection prioritizes social preview images and resolves relative URLs', () => {
    const candidates = selectPreviewCandidates({
        openGraph: ['/og.jpg'],
        twitter: ['https://cdn.example.com/twitter.jpg'],
        schema: ['/schema.jpg'],
        imageSrc: ['/image-src.jpg'],
        manifest: ['/icon-512.png'],
        content: ['/first.jpg', 'data:image/png;base64,ignored']
    }, 'https://example.com/articles/page');

    assert.deepEqual(candidates, [
        'https://example.com/og.jpg',
        'https://cdn.example.com/twitter.jpg',
        'https://example.com/schema.jpg',
        'https://example.com/image-src.jpg',
        'https://example.com/icon-512.png',
        'https://example.com/first.jpg'
    ]);
});

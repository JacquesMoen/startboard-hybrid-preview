const test = require('node:test');
const assert = require('node:assert/strict');

const {
    normalizeScreenshotRefreshInterval,
    getDisplayFieldVisibility,
    getVisualRefreshSource
} = require('../js/bookmark-form.js');

test('screenshot schedule accepts only off, daily, and weekly', () => {
    assert.equal(normalizeScreenshotRefreshInterval('off'), 'off');
    assert.equal(normalizeScreenshotRefreshInterval('daily'), 'daily');
    assert.equal(normalizeScreenshotRefreshInterval('weekly'), 'weekly');
    assert.equal(normalizeScreenshotRefreshInterval('hourly'), 'off');
    assert.equal(normalizeScreenshotRefreshInterval(undefined), 'off');
});

test('schedule is visible only for screenshot mode and custom upload only for custom mode', () => {
    assert.deepEqual(getDisplayFieldVisibility('preview'), {
        showScreenshotSchedule: true,
        showCustomImage: false
    });
    assert.deepEqual(getDisplayFieldVisibility('icon'), {
        showScreenshotSchedule: false,
        showCustomImage: false
    });
    assert.deepEqual(getDisplayFieldVisibility('custom'), {
        showScreenshotSchedule: false,
        showCustomImage: true
    });
});

test('new screenshot and icon bookmarks request an initial visual but custom bookmarks do not', () => {
    assert.equal(getVisualRefreshSource(null, {
        url: 'https://example.com', displayType: 'preview'
    }), 'initial');
    assert.equal(getVisualRefreshSource(null, {
        url: 'https://example.com', displayType: 'icon'
    }), 'initial');
    assert.equal(getVisualRefreshSource(null, {
        url: 'https://example.com', displayType: 'custom'
    }), null);
});

test('mode or URL transitions request one replacement visual while size-only edits do not', () => {
    const original = {
        url: 'https://example.com/page',
        displayType: 'icon',
        width: 200,
        height: 200
    };

    assert.equal(getVisualRefreshSource(original, { ...original, displayType: 'preview' }), 'transition');
    assert.equal(getVisualRefreshSource(original, { ...original, url: 'https://example.com/other' }), 'transition');
    assert.equal(getVisualRefreshSource(original, { ...original, width: 400, height: 350 }), null);
});

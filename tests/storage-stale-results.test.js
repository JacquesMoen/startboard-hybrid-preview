const test = require('node:test');
const assert = require('node:assert/strict');

global.PreviewPolicy = require('../js/preview-policy.js');
const StorageManager = require('../js/storage.js');

function resetStorageManager(bookmark) {
    const writes = [];
    StorageManager._initialized = true;
    StorageManager._screenshotQueue = [];
    StorageManager._isProcessingScreenshots = false;
    StorageManager._hybrid = {
        saveScreenshot: async (...args) => writes.push(['screenshot', ...args]),
        saveThumbnail: async (...args) => writes.push(['thumbnail', ...args])
    };
    StorageManager.getBookmarkById = async () => bookmark;
    return writes;
}

test('a thumbnail fetched for an old URL is discarded', async () => {
    const writes = resetStorageManager({
        id: 'bookmark-1',
        url: 'https://new.example',
        displayType: 'icon'
    });

    await assert.rejects(
        StorageManager.saveThumbnail(
            'bookmark-1',
            'data:image/webp;base64,dGh1bWI=',
            { expectedUrl: 'https://old.example' }
        ),
        /Bookmark changed/
    );
    assert.deepEqual(writes, []);
});

test('a popup screenshot is discarded after its bookmark leaves screenshot mode', async () => {
    const writes = resetStorageManager({
        id: 'bookmark-1',
        url: 'https://example.com',
        displayType: 'icon'
    });
    StorageManager._captureScreenshotInternal = async () => ({
        imageDataUrl: 'data:image/jpeg;base64,c2NyZWVu',
        timestamp: 1234
    });

    await assert.rejects(
        StorageManager.captureScreenshot('https://example.com', 'bookmark-1', 'initial'),
        /Bookmark changed/
    );
    assert.deepEqual(writes, []);
});

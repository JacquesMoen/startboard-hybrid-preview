const test = require('node:test');
const assert = require('node:assert/strict');

const IndexedDBStorage = require('../js/indexeddb-storage.js');
global.IndexedDBStorage = IndexedDBStorage;
const HybridStorageManager = require('../js/hybrid-storage.js');

test('IndexedDB upgrade creates an independent thumbnails store', async () => {
    const createdStores = [];
    const request = {};
    const originalIndexedDB = global.indexedDB;
    global.indexedDB = {
        open(name, version) {
            assert.equal(name, 'VisualBookmarksDB');
            assert.equal(version, 2);
            queueMicrotask(() => {
                const db = {
                    objectStoreNames: { contains: () => false },
                    createObjectStore(storeName) {
                        createdStores.push(storeName);
                        return { createIndex: () => {} };
                    }
                };
                request.result = db;
                request.onupgradeneeded({ target: { result: db } });
                request.onsuccess();
            });
            return request;
        }
    };

    try {
        const storage = new IndexedDBStorage();
        await storage.init();
        assert.ok(createdStores.includes('screenshots'));
        assert.ok(createdStores.includes('thumbnails'));
        assert.ok(createdStores.includes('customImages'));
    } finally {
        global.indexedDB = originalIndexedDB;
    }
});

test('hybrid storage routes screenshots and thumbnails to independent methods', async () => {
    const calls = [];
    const manager = new HybridStorageManager();
    manager.initialized = true;
    manager.idb = {
        saveScreenshot: async (...args) => calls.push(['screenshot', ...args]),
        saveThumbnail: async (...args) => calls.push(['thumbnail', ...args])
    };

    await manager.saveScreenshot('bookmark-1', 'data:image/jpeg;base64,c2NyZWVu');
    await manager.saveThumbnail('bookmark-1', 'data:image/webp;base64,dGh1bWI=', {
        plateColor: 'rgb(1, 2, 3)',
        sourceUrl: 'https://example.com/og.jpg'
    });

    assert.deepEqual(calls, [
        ['screenshot', 'bookmark-1', 'data:image/jpeg;base64,c2NyZWVu', {}],
        ['thumbnail', 'bookmark-1', 'data:image/webp;base64,dGh1bWI=', {
            plateColor: 'rgb(1, 2, 3)',
            sourceUrl: 'https://example.com/og.jpg'
        }]
    ]);
});

test('thumbnail reads return image data and presentation metadata together', async () => {
    const manager = new HybridStorageManager();
    manager.initialized = true;
    manager.idb = {
        getThumbnail: async () => ({
            imageDataUrl: 'data:image/webp;base64,dGh1bWI=',
            plateColor: 'rgb(10, 20, 30)',
            sourceUrl: 'https://example.com/og.jpg',
            source: 'metadata',
            timestamp: 1234
        })
    };

    assert.deepEqual(await manager.getThumbnail('bookmark-1'), {
        imageDataUrl: 'data:image/webp;base64,dGh1bWI=',
        plateColor: 'rgb(10, 20, 30)',
        sourceUrl: 'https://example.com/og.jpg',
        source: 'metadata',
        timestamp: 1234
    });
});

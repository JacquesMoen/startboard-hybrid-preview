// IndexedDB Storage Manager - Better alternative to chrome.storage.local
// Handles unlimited storage for screenshots and large data

class IndexedDBStorage {
    constructor() {
        this.dbName = 'VisualBookmarksDB';
        this.version = 1;
        this.db = null;
    }

    // Initialize database
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Store for screenshots (large images)
                if (!db.objectStoreNames.contains('screenshots')) {
                    const screenshotStore = db.createObjectStore('screenshots', { keyPath: 'id' });
                    screenshotStore.createIndex('bookmarkId', 'bookmarkId', { unique: true });
                }

                // Store for custom images
                if (!db.objectStoreNames.contains('customImages')) {
                    const imagesStore = db.createObjectStore('customImages', { keyPath: 'id' });
                    imagesStore.createIndex('bookmarkId', 'bookmarkId', { unique: true });
                }

                // Store for workspace backgrounds
                if (!db.objectStoreNames.contains('workspaceBackgrounds')) {
                    const bgStore = db.createObjectStore('workspaceBackgrounds', { keyPath: 'id' });
                    bgStore.createIndex('workspaceId', 'workspaceId', { unique: true });
                }

                // Store for bookmarks (metadata only, no images)
                if (!db.objectStoreNames.contains('bookmarks')) {
                    db.createObjectStore('bookmarks', { keyPath: 'id' });
                }

                // Store for folders
                if (!db.objectStoreNames.contains('folders')) {
                    db.createObjectStore('folders', { keyPath: 'id' });
                }
            };
        });
    }

    // Save screenshot (as Blob, more efficient than base64)
    async saveScreenshot(bookmarkId, imageDataUrl) {
        if (!this.db) {
            throw new Error('IndexedDB not initialized. Call init() first.');
        }

        // Convert base64 to Blob for better storage
        const blob = await this._dataUrlToBlob(imageDataUrl);

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['screenshots'], 'readwrite');
            const store = transaction.objectStore('screenshots');

            const data = {
                id: `screenshot-${bookmarkId}`,
                bookmarkId: bookmarkId,
                image: blob,
                timestamp: Date.now()
            };

            const request = store.put(data);
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    // Get screenshot
    async getScreenshot(bookmarkId) {
        if (!this.db) {
            throw new Error('IndexedDB not initialized. Call init() first.');
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['screenshots'], 'readonly');
            const store = transaction.objectStore('screenshots');
            const request = store.get(`screenshot-${bookmarkId}`);

            request.onsuccess = async () => {
                if (request.result && request.result.image) {
                    // Convert Blob back to data URL for <img> src
                    const dataUrl = await this._blobToDataUrl(request.result.image);
                    resolve(dataUrl);
                } else {
                    resolve(null);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    // Delete screenshot
    async deleteScreenshot(bookmarkId) {
        if (!this.db) {
            throw new Error('IndexedDB not initialized. Call init() first.');
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['screenshots'], 'readwrite');
            const store = transaction.objectStore('screenshots');
            const request = store.delete(`screenshot-${bookmarkId}`);

            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    // Save custom image
    async saveCustomImage(bookmarkId, imageDataUrl) {
        if (!this.db) {
            throw new Error('IndexedDB not initialized. Call init() first.');
        }

        const blob = await this._dataUrlToBlob(imageDataUrl);

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['customImages'], 'readwrite');
            const store = transaction.objectStore('customImages');

            const data = {
                id: `image-${bookmarkId}`,
                bookmarkId: bookmarkId,
                image: blob,
                timestamp: Date.now()
            };

            const request = store.put(data);
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    // Get custom image
    async getCustomImage(bookmarkId) {
        if (!this.db) {
            throw new Error('IndexedDB not initialized. Call init() first.');
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['customImages'], 'readonly');
            const store = transaction.objectStore('customImages');
            const request = store.get(`image-${bookmarkId}`);

            request.onsuccess = async () => {
                if (request.result && request.result.image) {
                    const dataUrl = await this._blobToDataUrl(request.result.image);
                    resolve(dataUrl);
                } else {
                    resolve(null);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    // Delete custom image
    async deleteCustomImage(bookmarkId) {
        if (!this.db) {
            throw new Error('IndexedDB not initialized. Call init() first.');
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['customImages'], 'readwrite');
            const store = transaction.objectStore('customImages');
            const request = store.delete(`image-${bookmarkId}`);

            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    // Save workspace background
    async saveWorkspaceBackground(workspaceId, imageDataUrl) {
        if (!this.db) {
            throw new Error('IndexedDB not initialized. Call init() first.');
        }

        const blob = await this._dataUrlToBlob(imageDataUrl);

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['workspaceBackgrounds'], 'readwrite');
            const store = transaction.objectStore('workspaceBackgrounds');

            const data = {
                id: `workspace-bg-${workspaceId}`,
                workspaceId: workspaceId,
                image: blob,
                timestamp: Date.now()
            };

            const request = store.put(data);
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    // Get workspace background
    async getWorkspaceBackground(workspaceId) {
        if (!this.db) {
            throw new Error('IndexedDB not initialized. Call init() first.');
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['workspaceBackgrounds'], 'readonly');
            const store = transaction.objectStore('workspaceBackgrounds');
            const request = store.get(`workspace-bg-${workspaceId}`);

            request.onsuccess = async () => {
                if (request.result && request.result.image) {
                    const dataUrl = await this._blobToDataUrl(request.result.image);
                    resolve(dataUrl);
                } else {
                    resolve(null);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    // Delete workspace background
    async deleteWorkspaceBackground(workspaceId) {
        if (!this.db) {
            throw new Error('IndexedDB not initialized. Call init() first.');
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['workspaceBackgrounds'], 'readwrite');
            const store = transaction.objectStore('workspaceBackgrounds');
            const request = store.delete(`workspace-bg-${workspaceId}`);

            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    // Save bookmarks (metadata only)
    async saveBookmarks(bookmarks) {
        if (!this.db) {
            throw new Error('IndexedDB not initialized. Call init() first.');
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['bookmarks'], 'readwrite');
            const store = transaction.objectStore('bookmarks');

            // Clear existing
            store.clear();

            // Add all bookmarks
            bookmarks.forEach(bookmark => {
                store.put(bookmark);
            });

            transaction.oncomplete = () => resolve(true);
            transaction.onerror = () => reject(transaction.error);
        });
    }

    // Get all bookmarks
    async getBookmarks() {
        if (!this.db) {
            throw new Error('IndexedDB not initialized. Call init() first.');
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['bookmarks'], 'readonly');
            const store = transaction.objectStore('bookmarks');
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    // Get storage usage estimate
    async getStorageEstimate() {
        if ('storage' in navigator && 'estimate' in navigator.storage) {
            const estimate = await navigator.storage.estimate();
            return {
                usage: estimate.usage,
                quota: estimate.quota,
                usageMB: (estimate.usage / (1024 * 1024)).toFixed(2),
                quotaMB: (estimate.quota / (1024 * 1024)).toFixed(2),
                percentUsed: ((estimate.usage / estimate.quota) * 100).toFixed(2)
            };
        }
        return null;
    }

    // Clear all data
    async clearAll() {
        if (!this.db) {
            throw new Error('IndexedDB not initialized. Call init() first.');
        }

        const storeNames = ['screenshots', 'customImages', 'workspaceBackgrounds', 'bookmarks', 'folders'];

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(storeNames, 'readwrite');

            storeNames.forEach(storeName => {
                transaction.objectStore(storeName).clear();
            });

            transaction.oncomplete = () => resolve(true);
            transaction.onerror = () => reject(transaction.error);
        });
    }

    // Helper: Convert data URL to Blob
    async _dataUrlToBlob(dataUrl) {
        const response = await fetch(dataUrl);
        return await response.blob();
    }

    // Helper: Convert Blob to data URL
    async _blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
    }

    // Export all data for backup
    async exportAllData() {
        if (!this.db) {
            throw new Error('IndexedDB not initialized. Call init() first.');
        }

        const bookmarks = await this.getBookmarks();

        // Get all screenshots
        const screenshots = await new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['screenshots'], 'readonly');
            const store = transaction.objectStore('screenshots');
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        return {
            bookmarks,
            screenshotCount: screenshots.length,
            exportDate: new Date().toISOString()
        };
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = IndexedDBStorage;
}

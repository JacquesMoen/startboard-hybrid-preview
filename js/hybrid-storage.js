// Hybrid Storage Manager - Best of both worlds
// Uses chrome.storage for metadata and IndexedDB for images

class HybridStorageManager {
    constructor() {
        this.idb = new IndexedDBStorage();
        this.initialized = false;
    }

    async init() {
        if (!this.initialized) {
            await this.idb.init();
            this.initialized = true;
            console.log('✅ Hybrid Storage initialized');
        }
    }

    // ========== BOOKMARKS ==========
    // Metadata in chrome.storage.local (fast, synced with Chrome)
    // Images in IndexedDB (unlimited space)

    async getBookmarks() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['bookmarks'], (result) => {
                resolve(result.bookmarks || []);
            });
        });
    }

    async saveBookmarks(bookmarks) {
        // Save metadata to chrome.storage
        return new Promise((resolve) => {
            chrome.storage.local.set({ bookmarks }, () => {
                resolve(true);
            });
        });
    }

    async addBookmark(bookmark) {
        const bookmarks = await this.getBookmarks();
        bookmark.id = 'bookmark-' + Date.now();
        bookmarks.push(bookmark);
        await this.saveBookmarks(bookmarks);
        return bookmark;
    }

    // ========== SCREENSHOTS ==========
    // Store in IndexedDB (efficient for large images)

    async saveScreenshot(bookmarkId, imageDataUrl) {
        await this.init();
        return await this.idb.saveScreenshot(bookmarkId, imageDataUrl);
    }

    async getScreenshot(bookmarkId) {
        await this.init();
        return await this.idb.getScreenshot(bookmarkId);
    }

    async deleteScreenshot(bookmarkId) {
        await this.init();
        return await this.idb.deleteScreenshot(bookmarkId);
    }

    // ========== CUSTOM IMAGES ==========

    async saveCustomImage(bookmarkId, imageDataUrl) {
        await this.init();
        return await this.idb.saveCustomImage(bookmarkId, imageDataUrl);
    }

    async getCustomImage(bookmarkId) {
        await this.init();
        return await this.idb.getCustomImage(bookmarkId);
    }

    async deleteCustomImage(bookmarkId) {
        await this.init();
        return await this.idb.deleteCustomImage(bookmarkId);
    }

    // ========== WORKSPACE BACKGROUNDS ==========

    async saveWorkspaceBackground(workspaceId, imageDataUrl) {
        await this.init();
        return await this.idb.saveWorkspaceBackground(workspaceId, imageDataUrl);
    }

    async getWorkspaceBackground(workspaceId) {
        await this.init();
        return await this.idb.getWorkspaceBackground(workspaceId);
    }

    async deleteWorkspaceBackground(workspaceId) {
        await this.init();
        return await this.idb.deleteWorkspaceBackground(workspaceId);
    }

    // ========== SETTINGS ==========
    // Use chrome.storage.sync for settings (synced across devices)

    async getSettings() {
        return new Promise((resolve) => {
            chrome.storage.sync.get(['settings'], (result) => {
                resolve(result.settings || {
                    theme: 'light',
                    showLabels: true,
                    animationsEnabled: true,
                    linkOpenBehavior: 'newWindow',
                    cleanMode: false
                });
            });
        });
    }

    async saveSettings(settings) {
        return new Promise((resolve) => {
            chrome.storage.sync.set({ settings }, () => {
                resolve(true);
            });
        });
    }

    async updateSetting(key, value) {
        const settings = await this.getSettings();
        settings[key] = value;
        await this.saveSettings(settings);
        return settings;
    }

    // ========== FOLDERS ==========

    async getFolders() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['folders'], (result) => {
                resolve(result.folders || []);
            });
        });
    }

    async saveFolders(folders) {
        return new Promise((resolve) => {
            chrome.storage.local.set({ folders }, () => {
                resolve(true);
            });
        });
    }

    // ========== WORKSPACES ==========

    async getWorkspaces() {
        const settings = await this.getSettings();
        return settings.workspaces || [
            { id: 'work', name: 'Work', icon: 'work' },
            { id: 'chill', name: 'Chill', icon: 'sports_esports' }
        ];
    }

    // ========== STORAGE MONITORING ==========

    async getStorageInfo() {
        await this.init();

        // Get chrome.storage usage
        const chromeUsage = await new Promise((resolve) => {
            chrome.storage.local.getBytesInUse(null, (bytes) => {
                resolve({
                    bytes,
                    mb: (bytes / (1024 * 1024)).toFixed(2),
                    limit: '~10 MB'
                });
            });
        });

        // Get IndexedDB usage
        const idbEstimate = await this.idb.getStorageEstimate();

        return {
            chrome: chromeUsage,
            indexedDB: idbEstimate,
            recommendation: chromeUsage.mb > 5
                ? '⚠️ Chrome storage getting full! Images are now in IndexedDB.'
                : '✅ Storage healthy'
        };
    }

    // Display storage info in console
    async logStorageInfo() {
        const info = await this.getStorageInfo();
        console.log('📦 Storage Info:');
        console.log(`   Chrome storage: ${info.chrome.mb} MB / ${info.chrome.limit}`);
        if (info.indexedDB) {
            console.log(`   IndexedDB: ${info.indexedDB.usageMB} MB / ${info.indexedDB.quotaMB} MB (${info.indexedDB.percentUsed}%)`);
        }
        console.log(`   ${info.recommendation}`);
    }

    // ========== MIGRATION FROM OLD STORAGE ==========

    async migrateFromOldStorage() {
        await this.init();
        console.log('🔄 Starting migration from chrome.storage to hybrid storage...');

        // Migrate screenshots
        const bookmarks = await this.getBookmarks();
        let migratedCount = 0;

        for (const bookmark of bookmarks) {
            try {
                // Check if screenshot exists in old chrome.storage
                const oldScreenshot = await new Promise((resolve) => {
                    chrome.storage.local.get([`screenshot-${bookmark.id}`], (result) => {
                        resolve(result[`screenshot-${bookmark.id}`]);
                    });
                });

                if (oldScreenshot) {
                    // Move to IndexedDB
                    await this.idb.saveScreenshot(bookmark.id, oldScreenshot);

                    // Remove from chrome.storage
                    await new Promise((resolve) => {
                        chrome.storage.local.remove([`screenshot-${bookmark.id}`], resolve);
                    });

                    migratedCount++;
                    console.log(`✅ Migrated screenshot for: ${bookmark.title}`);
                }
            } catch (error) {
                console.error(`❌ Failed to migrate screenshot for ${bookmark.title}:`, error);
            }
        }

        console.log(`✅ Migration complete! Migrated ${migratedCount} screenshots to IndexedDB`);
        await this.logStorageInfo();

        return { migratedCount };
    }

    // ========== CLEANUP ==========

    async clearAll() {
        await this.init();

        // Clear chrome.storage
        await new Promise((resolve) => {
            chrome.storage.local.clear(() => {
                chrome.storage.sync.clear(resolve);
            });
        });

        // Clear IndexedDB
        await this.idb.clearAll();

        console.log('🗑️ All data cleared');
    }

    // ========== EXPORT/BACKUP ==========

    async exportAllData() {
        const bookmarks = await this.getBookmarks();
        const folders = await this.getFolders();
        const settings = await this.getSettings();
        const storageInfo = await this.getStorageInfo();

        return {
            version: '2.0',
            exportDate: new Date().toISOString(),
            bookmarks,
            folders,
            settings,
            storageInfo,
            note: 'Screenshots are stored separately in IndexedDB'
        };
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = HybridStorageManager;
}

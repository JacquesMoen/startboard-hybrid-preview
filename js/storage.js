// Storage management for Visual Bookmarks
// Now using HybridStorageManager (chrome.storage + IndexedDB)

const StorageManager = {
    // Hybrid storage instance
    _hybrid: null,
    _initialized: false,

    // Bookmarks cache for data recovery
    _bookmarksCache: null,
    _lastSuccessfulBookmarksCount: 0,

    // Screenshot queue to prevent multiple windows opening at once
    _screenshotQueue: [],
    _isProcessingScreenshots: false,

    // Default settings
    defaultSettings: {
        theme: 'light',
        backgroundType: 'solid',
        backgroundColor: '#f5f5f5',
        showLabels: true,
        animationsEnabled: true,
        linkOpenBehavior: 'newWindow',
        cleanMode: false,
        currentWorkspace: 'work',
        workspaces: [
            { id: 'work', name: 'Work', icon: 'work', locked: false },
            { id: 'chill', name: 'Chill', icon: 'sports_esports', locked: false }
        ]
    },

    // Default bookmarks (for first-time users)
    defaultBookmarks: [
        // Work workspace
        {
            id: 'work-1',
            title: 'Gmail',
            url: 'https://mail.google.com',
            displayType: 'icon',
            workspace: 'work',
            x: 50,
            y: 50,
            width: 200,
            height: 200
        },
        {
            id: 'work-2',
            title: 'GitHub',
            url: 'https://github.com',
            displayType: 'icon',
            workspace: 'work',
            x: 270,
            y: 50,
            width: 200,
            height: 200
        },
        {
            id: 'work-3',
            title: 'LinkedIn',
            url: 'https://www.linkedin.com',
            displayType: 'icon',
            workspace: 'work',
            x: 490,
            y: 50,
            width: 200,
            height: 200
        },
        // Chill workspace
        {
            id: 'chill-1',
            title: 'YouTube',
            url: 'https://www.youtube.com',
            displayType: 'icon',
            workspace: 'chill',
            x: 50,
            y: 50,
            width: 200,
            height: 200
        },
        {
            id: 'chill-2',
            title: 'Netflix',
            url: 'https://www.netflix.com',
            displayType: 'icon',
            workspace: 'chill',
            x: 270,
            y: 50,
            width: 200,
            height: 200
        },
        {
            id: 'chill-3',
            title: 'Spotify',
            url: 'https://open.spotify.com',
            displayType: 'icon',
            workspace: 'chill',
            x: 490,
            y: 50,
            width: 200,
            height: 200
        }
    ],

    // Initialize hybrid storage
    async _initHybrid() {
        if (!this._initialized) {
            this._hybrid = new HybridStorageManager();
            await this._hybrid.init();
            this._initialized = true;
            console.log('✅ Hybrid Storage initialized');

            // Auto-migrate old data if exists
            await this._autoMigrate();
        }
    },

    // Auto-migrate from old chrome.storage to IndexedDB
    async _autoMigrate() {
        try {
            const bookmarks = await this.getBookmarks();
            let migratedCount = 0;

            for (const bookmark of bookmarks) {
                // Check if screenshot exists in old chrome.storage
                const oldScreenshot = await new Promise((resolve) => {
                    chrome.storage.local.get([`screenshot-${bookmark.id}`], (result) => {
                        resolve(result[`screenshot-${bookmark.id}`]);
                    });
                });

                if (oldScreenshot) {
                    // Check if already in IndexedDB
                    const inIDB = await this._hybrid.getScreenshot(bookmark.id);
                    if (!inIDB) {
                        // Move to IndexedDB
                        await this._hybrid.saveScreenshot(bookmark.id, oldScreenshot);
                        // Remove from chrome.storage
                        await new Promise((resolve) => {
                            chrome.storage.local.remove([`screenshot-${bookmark.id}`], resolve);
                        });
                        migratedCount++;
                    }
                }
            }

            if (migratedCount > 0) {
                console.log(`✅ Auto-migrated ${migratedCount} screenshots to IndexedDB`);
            }
        } catch (error) {
            console.error('Auto-migration error:', error);
        }
    },

    // Initialize default workspace backgrounds
    async initializeDefaultWorkspaceBackgrounds() {
        await this._initHybrid();
        const workspaces = await this.getWorkspaces();

        for (const workspace of workspaces) {
            const workspaceData = await this.getWorkspaceData(workspace.id);

            // If workspace doesn't have background set, set Aurora as default
            if (!workspaceData || !workspaceData.background) {
                await this.updateWorkspaceBackground(workspace.id, {
                    type: 'preset',
                    preset: 'aurora'
                });
            }
        }
    },

    // Get raw bookmarks from storage without initialization logic (for internal use)
    async _getRawBookmarks() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['bookmarks'], (result) => {
                if (chrome.runtime.lastError) {
                    console.error('❌ Storage read error:', chrome.runtime.lastError);
                    resolve(null);
                    return;
                }
                resolve(result.bookmarks || null);
            });
        });
    },

    // Get all bookmarks
    async getBookmarks() {
        await this._initHybrid();
        return new Promise(async (resolve) => {
            chrome.storage.local.get(['bookmarks', 'initialized'], async (result) => {
                // Check for storage errors
                if (chrome.runtime.lastError) {
                    console.error('❌ CRITICAL: Storage read error in getBookmarks:', chrome.runtime.lastError);
                    // Return cached data if available
                    if (this._bookmarksCache && this._bookmarksCache.length > 0) {
                        console.warn('⚠️ Returning cached bookmarks due to storage error');
                        resolve(this._bookmarksCache);
                        return;
                    }
                    // Last resort - return empty array but log critical error
                    console.error('❌ CRITICAL: No cache available, returning empty array');
                    resolve([]);
                    return;
                }

                let bookmarks = result.bookmarks;
                const initialized = result.initialized;

                // First time only - use default bookmarks
                if (!initialized && (!bookmarks || bookmarks.length === 0)) {
                    bookmarks = [...this.defaultBookmarks];
                    await this.saveBookmarks(bookmarks);
                    await this.initializeDefaultWorkspaceBackgrounds();
                    // Mark as initialized so we don't add defaults again
                    await chrome.storage.local.set({ initialized: true });
                } else if (!bookmarks) {
                    // CRITICAL: initialized=true but bookmarks is missing!
                    console.error('❌ CRITICAL: Bookmarks data is missing but initialized=true');

                    // Try to recover from cache
                    if (this._bookmarksCache && this._bookmarksCache.length > 0) {
                        console.warn('⚠️ Recovering from cache, found', this._bookmarksCache.length, 'bookmarks');
                        bookmarks = this._bookmarksCache;
                        // Save recovered data back to storage
                        await this.saveBookmarks(bookmarks);
                    } else {
                        console.error('❌ CRITICAL: No cache available for recovery');
                        // Don't return empty array - this would cause data loss
                        // Instead, keep empty but log the issue
                        bookmarks = [];
                    }
                } else {
                    // Check if user has any bookmarks with workspace field
                    const hasWorkspaceBookmarks = bookmarks.some(b => b.workspace);

                    // Only migrate if there are bookmarks and they don't have workspace field
                    if (bookmarks.length > 0 && !hasWorkspaceBookmarks) {
                        // Migrate old bookmarks to 'work' workspace
                        bookmarks = bookmarks.map(bookmark => {
                            if (!bookmark.workspace) {
                                bookmark.workspace = 'work';
                            }
                            return bookmark;
                        });

                        // Add default bookmarks if they don't exist (only during migration)
                        this.defaultBookmarks.forEach(defaultBookmark => {
                            const exists = bookmarks.some(b => b.id === defaultBookmark.id);
                            if (!exists) {
                                bookmarks.push({...defaultBookmark});
                            }
                        });

                        await this.saveBookmarks(bookmarks);
                        await this.initializeDefaultWorkspaceBackgrounds();
                    } else {
                        // Migrate any remaining bookmarks without workspace
                        let needsSave = false;
                        bookmarks = bookmarks.map(bookmark => {
                            if (!bookmark.workspace) {
                                bookmark.workspace = 'work';
                                needsSave = true;
                            }
                            return bookmark;
                        });

                        if (needsSave) {
                            await this.saveBookmarks(bookmarks);
                        }
                    }
                }

                // Cache the bookmarks for recovery
                if (bookmarks && bookmarks.length > 0) {
                    this._bookmarksCache = [...bookmarks]; // Deep copy
                    this._lastSuccessfulBookmarksCount = bookmarks.length;
                    console.log('✅ Cached', bookmarks.length, 'bookmarks');
                }

                resolve(bookmarks);
            });
        });
    },

    // Save bookmarks
    async saveBookmarks(bookmarks) {
        // Validation
        if (!Array.isArray(bookmarks)) {
            console.error('❌ CRITICAL: Invalid bookmarks data (not an array)');
            return Promise.reject(new Error('Invalid bookmarks data'));
        }

        // CRITICAL PROTECTION: Prevent saving empty array if there were bookmarks before
        if (bookmarks.length === 0 && this._lastSuccessfulBookmarksCount > 0) {
            console.error('❌ CRITICAL: Attempting to delete all bookmarks!');
            console.error('   Previous count:', this._lastSuccessfulBookmarksCount);
            console.error('   New count:', bookmarks.length);
            console.error('   🛡️ SAVE BLOCKED to prevent data loss!');

            // Create a backup alert in console
            console.error('🚨 DATA LOSS PREVENTED! Check the code that called saveBookmarks()');
            console.trace(); // Show stack trace to see where this was called from

            return Promise.reject(new Error('Cannot save empty bookmarks - data loss prevention'));
        }

        return new Promise((resolve, reject) => {
            chrome.storage.local.set({ bookmarks }, () => {
                if (chrome.runtime.lastError) {
                    console.error('❌ Storage write error in saveBookmarks:', chrome.runtime.lastError);
                    reject(chrome.runtime.lastError);
                    return;
                }

                // Update cache after successful save
                if (bookmarks.length > 0) {
                    this._bookmarksCache = [...bookmarks];
                    this._lastSuccessfulBookmarksCount = bookmarks.length;
                    console.log('✅ Saved and cached', bookmarks.length, 'bookmarks');
                }

                resolve(true);
            });
        });
    },

    // Add a bookmark
    async addBookmark(bookmark) {
        const bookmarks = await this.getBookmarks();
        bookmark.id = 'bookmark-' + Date.now();
        bookmark.position = bookmarks.length;

        // Set workspace to current if not specified
        if (!bookmark.workspace) {
            bookmark.workspace = await this.getCurrentWorkspace();
        }

        bookmarks.push(bookmark);
        await this.saveBookmarks(bookmarks);
        return bookmark;
    },

    // Get a bookmark by ID
    async getBookmarkById(id) {
        const bookmarks = await this.getBookmarks();
        return bookmarks.find(b => b.id === id) || null;
    },

    // Update a bookmark
    async updateBookmark(id, updates) {
        const bookmarks = await this.getBookmarks();
        const index = bookmarks.findIndex(b => b.id === id);
        if (index !== -1) {
            bookmarks[index] = { ...bookmarks[index], ...updates };
            await this.saveBookmarks(bookmarks);
            return bookmarks[index];
        }
        return null;
    },

    // Delete a bookmark
    async deleteBookmark(id) {
        const bookmarks = await this.getBookmarks();
        const filtered = bookmarks.filter(b => b.id !== id);
        await this.saveBookmarks(filtered);

        // Delete screenshot from IndexedDB
        await this._initHybrid();
        await this._hybrid.deleteScreenshot(id);
        await this._hybrid.deleteCustomImage(id);

        return true;
    },

    // Reorder bookmarks
    async reorderBookmarks(fromIndex, toIndex) {
        const bookmarks = await this.getBookmarks();
        const [removed] = bookmarks.splice(fromIndex, 1);
        bookmarks.splice(toIndex, 0, removed);

        // Update positions
        bookmarks.forEach((bookmark, index) => {
            bookmark.position = index;
        });

        await this.saveBookmarks(bookmarks);
        return bookmarks;
    },

    // Get settings
    async getSettings() {
        return new Promise((resolve) => {
            chrome.storage.sync.get(['settings'], (result) => {
                resolve(result.settings || this.defaultSettings);
            });
        });
    },

    // Save settings
    async saveSettings(settings) {
        return new Promise((resolve) => {
            chrome.storage.sync.set({ settings }, () => {
                resolve(true);
            });
        });
    },

    // Update a single setting
    async updateSetting(key, value) {
        const settings = await this.getSettings();
        settings[key] = value;
        await this.saveSettings(settings);
        return settings;
    },

    // Get custom image for bookmark (FROM INDEXEDDB NOW!)
    async getCustomImage(bookmarkId) {
        await this._initHybrid();
        return await this._hybrid.getCustomImage(bookmarkId);
    },

    // Save custom image for bookmark (TO INDEXEDDB NOW!)
    async saveCustomImage(bookmarkId, imageData) {
        await this._initHybrid();
        return await this._hybrid.saveCustomImage(bookmarkId, imageData);
    },

    // Delete custom image for bookmark
    async deleteCustomImage(bookmarkId) {
        await this._initHybrid();
        return await this._hybrid.deleteCustomImage(bookmarkId);
    },

    // Import Chrome bookmarks
    async importChromeBookmarks() {
        return new Promise((resolve) => {
            chrome.bookmarks.getTree((bookmarkTree) => {
                const bookmarks = [];
                let position = 0;

                // Recursive function to extract bookmarks
                const extractBookmarks = (nodes) => {
                    for (const node of nodes) {
                        if (node.url) {
                            bookmarks.push({
                                id: 'imported-' + Date.now() + '-' + position,
                                title: node.title || 'Untitled',
                                url: node.url,
                                displayType: 'icon',
                                size: '1x1',
                                position: position++
                            });
                        }
                        if (node.children) {
                            extractBookmarks(node.children);
                        }
                    }
                };

                extractBookmarks(bookmarkTree);
                resolve(bookmarks);
            });
        });
    },

    // Export bookmarks as JSON
    async exportBookmarks() {
        const bookmarks = await this.getBookmarks();
        const settings = await this.getSettings();

        const data = {
            version: '2.0',
            bookmarks,
            settings,
            exportDate: new Date().toISOString(),
            note: 'Screenshots are stored separately in IndexedDB'
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `visual-bookmarks-${Date.now()}.json`;
        a.click();

        URL.revokeObjectURL(url);
        return true;
    },

    // Reset all data
    async resetAllData() {
        return new Promise(async (resolve) => {
            chrome.storage.local.clear(() => {
                chrome.storage.sync.clear(async () => {
                    // Also clear IndexedDB
                    await this._initHybrid();
                    await this._hybrid.clearAll();
                    resolve(true);
                });
            });
        });
    },

    // Process screenshot queue
    async _processScreenshotQueue() {
        if (this._isProcessingScreenshots || this._screenshotQueue.length === 0) {
            return;
        }

        this._isProcessingScreenshots = true;

        while (this._screenshotQueue.length > 0) {
            const { url, bookmarkId, resolve, reject } = this._screenshotQueue.shift();

            try {
                const screenshot = await this._captureScreenshotInternal(url, bookmarkId);
                resolve(screenshot);
            } catch (error) {
                reject(error);
            }
        }

        this._isProcessingScreenshots = false;
    },

    // Capture screenshot of a URL directly (in background window)
    async captureScreenshot(url, bookmarkId) {
        return new Promise((resolve, reject) => {
            // Add to queue
            this._screenshotQueue.push({ url, bookmarkId, resolve, reject });
            // Process queue
            this._processScreenshotQueue();
        });
    },

    // Internal method for actual screenshot capture
    async _captureScreenshotInternal(url, bookmarkId) {
        await this._initHybrid();

        return new Promise(async (resolve, reject) => {
            let bgWindow = null;

            try {
                // Create a small popup window in corner for screenshot
                bgWindow = await chrome.windows.create({
                    url: url,
                    type: 'popup',
                    focused: false,
                    state: 'normal',
                    width: 800,
                    height: 600,
                    left: 0,
                    top: 0
                });

                const tab = bgWindow.tabs[0];

                // Wait for page to load
                const loadListener = async (tabId, changeInfo) => {
                    if (tabId === tab.id && changeInfo.status === 'complete') {
                        chrome.tabs.onUpdated.removeListener(loadListener);

                        // Wait for images and dynamic content
                        await new Promise(r => setTimeout(r, 2000));

                        try {
                            // Activate the tab in background window
                            await chrome.tabs.update(tab.id, { active: true });
                            await new Promise(r => setTimeout(r, 100));

                            // Capture screenshot
                            const screenshot = await chrome.tabs.captureVisibleTab(
                                bgWindow.id,
                                { format: 'jpeg', quality: 85 }
                            );

                            // Save to IndexedDB (not chrome.storage!)
                            await this._hybrid.saveScreenshot(bookmarkId, screenshot);

                            // Close background window
                            await chrome.windows.remove(bgWindow.id);

                            resolve(screenshot);
                        } catch (error) {
                            try {
                                await chrome.windows.remove(bgWindow.id);
                            } catch (e) {}
                            reject(error);
                        }
                    }
                };

                chrome.tabs.onUpdated.addListener(loadListener);

                // Timeout after 30 seconds
                setTimeout(async () => {
                    chrome.tabs.onUpdated.removeListener(loadListener);
                    try {
                        if (bgWindow) {
                            await chrome.windows.remove(bgWindow.id);
                        }
                    } catch (e) {}
                    reject(new Error('Screenshot capture timeout'));
                }, 30000);

            } catch (error) {
                try {
                    if (bgWindow) {
                        await chrome.windows.remove(bgWindow.id);
                    }
                } catch (e) {}
                reject(error);
            }
        });
    },

    // Capture multiple screenshots (one by one)
    async captureMultipleScreenshots(bookmarks) {
        const results = [];

        for (const bookmark of bookmarks) {
            try {
                const screenshot = await this.captureScreenshot(bookmark.url, bookmark.id);
                results.push({
                    bookmarkId: bookmark.id,
                    success: true,
                    screenshot
                });

                // Wait between captures
                await new Promise(r => setTimeout(r, 1000));
            } catch (error) {
                results.push({
                    bookmarkId: bookmark.id,
                    success: false,
                    error: error.message
                });
            }
        }

        return results;
    },

    // Refresh screenshot for a bookmark
    async refreshScreenshot(bookmarkId, url) {
        return await this.captureScreenshot(url, bookmarkId);
    },

    // Get screenshot from storage (FROM INDEXEDDB NOW!)
    async getScreenshot(bookmarkId) {
        await this._initHybrid();
        return await this._hybrid.getScreenshot(bookmarkId);
    },

    // Delete screenshot from storage
    async deleteScreenshot(bookmarkId) {
        await this._initHybrid();
        return await this._hybrid.deleteScreenshot(bookmarkId);
    },

    // Get favicon URL
    getFaviconUrl(url) {
        try {
            const domain = new URL(url).hostname;
            return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
        } catch (e) {
            return null;
        }
    },

    // Enable auto screenshot refresh (placeholder)
    async enableAutoRefresh(intervalHours = 24) {
        console.log('Auto-refresh not available without background service worker');
        return false;
    },

    // Disable auto screenshot refresh (placeholder)
    async disableAutoRefresh() {
        console.log('Auto-refresh not available without background service worker');
        return false;
    },

    // Get bookmarks filtered by workspace
    async getBookmarksByWorkspace(workspaceId) {
        const allBookmarks = await this.getBookmarks();
        return allBookmarks.filter(b => b.workspace === workspaceId);
    },

    // Get current workspace
    async getCurrentWorkspace() {
        const settings = await this.getSettings();
        return settings.currentWorkspace || 'work';
    },

    // Set current workspace
    async setCurrentWorkspace(workspaceId) {
        return await this.updateSetting('currentWorkspace', workspaceId);
    },

    // Get all workspaces
    async getWorkspaces() {
        const settings = await this.getSettings();
        return settings.workspaces || this.defaultSettings.workspaces;
    },

    // Add new workspace
    async addWorkspace(workspace) {
        const settings = await this.getSettings();
        const workspaces = settings.workspaces || this.defaultSettings.workspaces;

        // Generate ID from name
        workspace.id = workspace.name.toLowerCase().replace(/\s+/g, '-');
        if (typeof workspace.locked !== 'boolean') {
            workspace.locked = false;
        }

        workspaces.push(workspace);
        await this.updateSetting('workspaces', workspaces);
        return workspace;
    },

    // Update workspace
    async updateWorkspace(workspaceId, updates) {
        const settings = await this.getSettings();
        const workspaces = settings.workspaces || this.defaultSettings.workspaces;

        const index = workspaces.findIndex(w => w.id === workspaceId);
        if (index !== -1) {
            // If name changed, update ID and migrate bookmarks
            if (updates.name && updates.name !== workspaces[index].name) {
                const oldId = workspaceId;
                const newId = updates.name.toLowerCase().replace(/\s+/g, '-');

                // CRITICAL CHECK: Prevent ID collision
                const idExists = workspaces.some(w => w.id === newId && w.id !== oldId);
                if (idExists) {
                    throw new Error(`A workspace with ID "${newId}" already exists. Please choose a different name.`);
                }

                // Validate new ID
                if (!newId || newId.length === 0) {
                    throw new Error('Workspace name cannot be empty or contain only spaces.');
                }

                updates.id = newId;

                console.log('🔄 Renaming workspace:', oldId, '→', newId);

                // Backup current state for rollback
                const backupBookmarks = await this._getRawBookmarks();
                const backupFolders = await this.getFolders();
                const backupSettings = { ...settings };

                try {
                    // Update all bookmarks with this workspace
                    const bookmarks = await this.getBookmarks();

                    // CRITICAL CHECK: Verify we got valid bookmarks data
                    if (!bookmarks || !Array.isArray(bookmarks)) {
                        throw new Error('Failed to retrieve bookmarks - invalid data');
                    }

                    // Count bookmarks in this workspace before update
                    const bookmarksInWorkspace = bookmarks.filter(b => b.workspace === oldId).length;
                    console.log('📊 Found', bookmarksInWorkspace, 'bookmarks in workspace', oldId);

                    const updatedBookmarks = bookmarks.map(b => {
                        if (b.workspace === oldId) {
                            b.workspace = newId;
                        }
                        return b;
                    });

                    // Verify the update didn't lose data
                    if (updatedBookmarks.length !== bookmarks.length) {
                        throw new Error(`Bookmark count mismatch! Before: ${bookmarks.length}, After: ${updatedBookmarks.length}`);
                    }

                    await this.saveBookmarks(updatedBookmarks);
                    console.log('✅ Bookmarks updated successfully');

                    // Update all folders with this workspace
                    const folders = await this.getFolders();
                    const foldersInWorkspace = folders.filter(f => f.workspace === oldId).length;
                    console.log('📊 Found', foldersInWorkspace, 'folders in workspace', oldId);

                    const updatedFolders = folders.map(f => {
                        if (f.workspace === oldId) {
                            f.workspace = newId;
                        }
                        return f;
                    });

                    // Verify the update didn't lose data
                    if (updatedFolders.length !== folders.length) {
                        throw new Error(`Folder count mismatch! Before: ${folders.length}, After: ${updatedFolders.length}`);
                    }

                    await this.saveFolders(updatedFolders);
                    console.log('✅ Folders updated successfully');

                    // Migrate workspace background data
                    const workspaceData = await this.getWorkspaceData(oldId);
                    if (workspaceData) {
                        // Save to new ID
                        await new Promise((resolve, reject) => {
                            chrome.storage.local.set({ [`workspace-${newId}`]: workspaceData }, () => {
                                if (chrome.runtime.lastError) {
                                    reject(chrome.runtime.lastError);
                                } else {
                                    resolve();
                                }
                            });
                        });

                        // If custom background, migrate image from IndexedDB
                        if (workspaceData.background && workspaceData.background.type === 'custom') {
                            const imageData = await this.getWorkspaceBackground(oldId);
                            if (imageData) {
                                await this.saveWorkspaceBackground(newId, imageData);
                            }
                        }

                        // Delete old workspace data
                        await new Promise((resolve) => {
                            chrome.storage.local.remove([`workspace-${oldId}`], () => {
                                resolve();
                            });
                        });

                        // Delete old image from IndexedDB if exists
                        await this._initHybrid();
                        await this._hybrid.deleteWorkspaceBackground(oldId);
                    }

                    console.log('✅ Workspace renamed successfully:', oldId, '→', newId);

                } catch (error) {
                    console.error('❌ CRITICAL: Error during workspace rename:', error);
                    console.error('🔄 Rolling back changes...');

                    // Rollback: Restore bookmarks
                    if (backupBookmarks) {
                        try {
                            await new Promise((resolve) => {
                                chrome.storage.local.set({ bookmarks: backupBookmarks }, () => {
                                    if (!chrome.runtime.lastError) {
                                        console.log('✅ Bookmarks restored from backup');
                                    }
                                    resolve();
                                });
                            });
                        } catch (e) {
                            console.error('❌ Failed to restore bookmarks:', e);
                        }
                    }

                    // Rollback: Restore folders
                    if (backupFolders) {
                        try {
                            await this.saveFolders(backupFolders);
                            console.log('✅ Folders restored from backup');
                        } catch (e) {
                            console.error('❌ Failed to restore folders:', e);
                        }
                    }

                    // Show error to user
                    throw new Error(`Failed to rename workspace: ${error.message}`);
                }
            }

            workspaces[index] = { ...workspaces[index], ...updates };
            await this.updateSetting('workspaces', workspaces);

            // CRITICAL: Update currentWorkspace AFTER successful workspace update
            // This ensures atomic operation - both workspace and currentWorkspace updated together
            if (updates.id) {
                const currentWorkspace = await this.getCurrentWorkspace();
                if (currentWorkspace === workspaceId) {
                    // Old workspace ID was current, update to new ID
                    await this.setCurrentWorkspace(updates.id);
                    console.log('✅ Updated currentWorkspace:', workspaceId, '→', updates.id);
                }
            }

            return workspaces[index];
        }
        return null;
    },

    // Delete workspace
    async deleteWorkspace(workspaceId) {
        const settings = await this.getSettings();
        const workspaces = settings.workspaces || this.defaultSettings.workspaces;

        // Can't delete if only one workspace left
        if (workspaces.length <= 1) {
            return false;
        }

        const filtered = workspaces.filter(w => w.id !== workspaceId);

        // Delete all bookmarks in this workspace
        const bookmarks = await this.getBookmarks();
        const filteredBookmarks = bookmarks.filter(b => b.workspace !== workspaceId);
        await this.saveBookmarks(filteredBookmarks);

        // If current workspace was deleted, switch to first workspace
        const currentWorkspace = await this.getCurrentWorkspace();
        if (currentWorkspace === workspaceId) {
            await this.setCurrentWorkspace(filtered[0].id);
        }

        await this.updateSetting('workspaces', filtered);
        return true;
    },

    // Reorder workspaces
    async reorderWorkspaces(newOrder) {
        await this.updateSetting('workspaces', newOrder);
        return true;
    },

    // Save custom background (DEPRECATED - use workspace backgrounds)
    async saveCustomBackground(imageData) {
        return new Promise((resolve) => {
            chrome.storage.local.set({ customBackground: imageData }, () => {
                resolve(true);
            });
        });
    },

    // Get custom background (DEPRECATED)
    async getCustomBackground() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['customBackground'], (result) => {
                resolve(result.customBackground || null);
            });
        });
    },

    // Remove custom background (DEPRECATED)
    async removeCustomBackground() {
        return new Promise((resolve) => {
            chrome.storage.local.remove(['customBackground'], () => {
                resolve(true);
            });
        });
    },

    // Get workspace data (including background settings)
    async getWorkspaceData(workspaceId) {
        return new Promise((resolve) => {
            chrome.storage.local.get([`workspace-${workspaceId}`], (result) => {
                resolve(result[`workspace-${workspaceId}`] || null);
            });
        });
    },

    // Update workspace background settings
    async updateWorkspaceBackground(workspaceId, backgroundData) {
        const workspaceData = await this.getWorkspaceData(workspaceId) || {};
        workspaceData.background = backgroundData;

        return new Promise((resolve) => {
            chrome.storage.local.set({ [`workspace-${workspaceId}`]: workspaceData }, () => {
                resolve(true);
            });
        });
    },

    // Save workspace custom background image (TO INDEXEDDB NOW!)
    async saveWorkspaceBackground(workspaceId, imageData) {
        await this._initHybrid();
        return await this._hybrid.saveWorkspaceBackground(workspaceId, imageData);
    },

    // Get workspace custom background image (FROM INDEXEDDB NOW!)
    async getWorkspaceBackground(workspaceId) {
        await this._initHybrid();
        return await this._hybrid.getWorkspaceBackground(workspaceId);
    },

    // Remove workspace background
    async removeWorkspaceBackground(workspaceId) {
        await this._initHybrid();
        return new Promise(async (resolve) => {
            chrome.storage.local.remove([`workspace-${workspaceId}`], async () => {
                // Also remove from IndexedDB
                // Note: IndexedDB doesn't have a remove method in our implementation
                // So we'll just leave it - it won't be used if workspace data is cleared
                resolve(true);
            });
        });
    },

    // ========== FOLDERS ==========
    // Get all folders
    async getFolders() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['folders'], (result) => {
                resolve(result.folders || []);
            });
        });
    },

    // Save folders
    async saveFolders(folders) {
        return new Promise((resolve) => {
            chrome.storage.local.set({ folders }, () => {
                resolve(true);
            });
        });
    },

    // Add folder
    async addFolder(folder) {
        const folders = await this.getFolders();
        folders.push(folder);
        await this.saveFolders(folders);
        return folder;
    },

    // Update folder
    async updateFolder(folderId, updates) {
        const folders = await this.getFolders();
        const index = folders.findIndex(f => f.id === folderId);
        if (index !== -1) {
            folders[index] = { ...folders[index], ...updates };
            await this.saveFolders(folders);
            return folders[index];
        }
        return null;
    },

    // Delete folder
    async deleteFolder(folderId) {
        const folders = await this.getFolders();
        const filtered = folders.filter(f => f.id !== folderId);
        await this.saveFolders(filtered);

        // Remove bookmarks inside the folder
        const bookmarks = await this.getBookmarks();
        const removedBookmarks = bookmarks.filter(b => b.folderId === folderId);
        const remainingBookmarks = bookmarks.filter(b => b.folderId !== folderId);
        await this.saveBookmarks(remainingBookmarks);

        if (removedBookmarks.length > 0) {
            await this._initHybrid();
            for (const bookmark of removedBookmarks) {
                await this._hybrid.deleteScreenshot(bookmark.id);
                await this._hybrid.deleteCustomImage(bookmark.id);
            }
        }

        return true;
    },

    // Get folders by workspace
    async getFoldersByWorkspace(workspaceId) {
        const folders = await this.getFolders();
        return folders.filter(f => f.workspace === workspaceId);
    },

    // Get storage info (NEW!)
    async getStorageInfo() {
        await this._initHybrid();
        return await this._hybrid.getStorageInfo();
    },

    // Log storage info to console (NEW!)
    async logStorageInfo() {
        await this._initHybrid();
        return await this._hybrid.logStorageInfo();
    }
};

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = StorageManager;
}

// Bookmark management functionality

class BookmarkManager {
    constructor() {
        this.bookmarks = [];
        this.allBookmarks = [];
        this.settings = {};
        this.currentEditingId = null;
        this.currentWorkspace = 'work';
    }

    async init() {
        await this.loadSettings();
        await this.loadBookmarks();
    }

    async loadBookmarks() {
        this.allBookmarks = await StorageManager.getBookmarks();
        this.currentWorkspace = await StorageManager.getCurrentWorkspace();

        // CRITICAL FIX: Validate currentWorkspace exists
        const workspaces = await StorageManager.getWorkspaces();
        const workspaceExists = workspaces.some(w => w.id === this.currentWorkspace);

        if (!workspaceExists) {
            console.error('❌ CRITICAL: Current workspace ID not found:', this.currentWorkspace);
            console.error('   Available workspaces:', workspaces.map(w => w.id));

            // Try to recover: find workspace that has bookmarks
            const bookmarkWorkspaces = [...new Set(this.allBookmarks.map(b => b.workspace))];
            console.log('   Workspaces with bookmarks:', bookmarkWorkspaces);

            // Find first valid workspace that has bookmarks
            let recoveredWorkspace = null;
            for (const wsId of bookmarkWorkspaces) {
                if (workspaces.some(w => w.id === wsId)) {
                    recoveredWorkspace = wsId;
                    break;
                }
            }

            // If no workspace with bookmarks found, use first available workspace
            if (!recoveredWorkspace && workspaces.length > 0) {
                recoveredWorkspace = workspaces[0].id;
            }

            if (recoveredWorkspace) {
                console.warn('⚠️ Auto-recovering: switching to workspace:', recoveredWorkspace);
                this.currentWorkspace = recoveredWorkspace;
                await StorageManager.setCurrentWorkspace(recoveredWorkspace);
            } else {
                console.error('❌ CRITICAL: No valid workspace found!');
            }
        }

        this.filterBookmarksByWorkspace();
    }

    async loadSettings() {
        this.settings = await StorageManager.getSettings();
    }

    filterBookmarksByWorkspace() {
        this.bookmarks = this.allBookmarks.filter(b => {
            // Show only bookmarks that match current workspace
            return b.workspace === this.currentWorkspace;
        });
    }

    async setCurrentWorkspace(workspaceId) {
        this.currentWorkspace = workspaceId;
        await StorageManager.setCurrentWorkspace(workspaceId);
        this.filterBookmarksByWorkspace();
    }

    async renderBookmarks(container) {
        container.innerHTML = '';

        // Get folders for current workspace
        const folders = await StorageManager.getFoldersByWorkspace(this.currentWorkspace);

        // Count bookmarks in each folder
        const bookmarksInFolders = {};
        const bookmarksWithoutFolder = [];

        this.bookmarks.forEach(bookmark => {
            if (bookmark.folderId) {
                if (!bookmarksInFolders[bookmark.folderId]) {
                    bookmarksInFolders[bookmark.folderId] = [];
                }
                bookmarksInFolders[bookmark.folderId].push(bookmark);
            } else {
                bookmarksWithoutFolder.push(bookmark);
            }
        });

        // Render folder cards (like Windows folders)
        folders.forEach(folder => {
            const folderCard = this.createFolderCard(folder, bookmarksInFolders[folder.id]?.length || 0);
            container.appendChild(folderCard);
        });

        // Render bookmarks without folder (free positioning)
        bookmarksWithoutFolder.forEach(bookmark => {
            const card = this.createBookmarkCard(bookmark);
            container.appendChild(card);
        });

        if (folders.length === 0 && bookmarksWithoutFolder.length === 0) {
            this.renderEmptyState(container);
        }
    }

    createFolderCard(folder, bookmarkCount) {
        const card = document.createElement('div');
        card.className = `folder-card${folder.color && folder.color !== 'default' ? ` folder-${folder.color}` : ''}`;
        card.dataset.folderId = folder.id;

        // Set position
        card.style.left = (folder.x || 50) + 'px';
        card.style.top = (folder.y || 50) + 'px';

        // Folder icon
        const iconWrapper = document.createElement('div');
        iconWrapper.className = 'folder-icon-wrapper';

        const icon = document.createElement('span');
        icon.className = 'material-icons folder-icon';
        icon.textContent = 'folder';
        iconWrapper.appendChild(icon);

        if (folder.icon) {
            const badge = document.createElement('span');
            badge.className = 'material-icons folder-icon-badge';
            badge.textContent = folder.icon;
            iconWrapper.appendChild(badge);
        }

        // Folder name
        const name = document.createElement('div');
        name.className = 'folder-name';
        name.textContent = folder.name;

        // Bookmark count
        const count = document.createElement('div');
        count.className = 'folder-count';
        count.textContent = i18n('folderItemCount', [bookmarkCount]);

        card.appendChild(iconWrapper);
        card.appendChild(name);
        card.appendChild(count);

        // Add resize handle
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'bookmark-resize-handle';
        card.appendChild(resizeHandle);

        // Set custom size if exists
        if (folder.width) card.style.width = folder.width + 'px';
        if (folder.height) card.style.height = folder.height + 'px';

        // Open folder on click
        card.addEventListener('click', (e) => {
            if (card.dataset.wasDragging === 'true') return;
            if (e.target.classList.contains('bookmark-resize-handle')) return;
            openFolderModal(folder.id);
        });

        // Context menu
        card.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showFolderContextMenu(e, folder.id);
        });

        return card;
    }


    createBookmarkCard(bookmark) {
        const card = document.createElement('div');
        const size = bookmark.size || 'medium';
        card.className = `bookmark-card size-${size}`;
        card.dataset.id = bookmark.id;
        card.dataset.url = bookmark.url;

        // Apply color if set
        if (bookmark.color) {
            card.classList.add(`bookmark-${bookmark.color}`);
        }

        // For bookmarks in folders - use grid layout (no absolute positioning)
        if (bookmark.folderId) {
            // Grid layout - no position, no size overrides
            // CSS will handle everything
        } else {
            // Desktop - absolute positioning
            card.style.left = (bookmark.x || 50) + 'px';
            card.style.top = (bookmark.y || 50) + 'px';

            // Set custom dimensions if provided
            if (bookmark.width) card.style.width = bookmark.width + 'px';
            if (bookmark.height) card.style.height = bookmark.height + 'px';
        }

        // Preview section
        const preview = document.createElement('div');
        preview.className = 'bookmark-preview';

        // Determine what to show in preview
        switch (bookmark.displayType) {
            case 'icon':
                this.renderIconPreview(preview, bookmark);
                break;
            case 'custom':
                this.renderCustomPreview(preview, bookmark);
                break;
            case 'preview':
            default:
                this.renderScreenshotPreview(preview, bookmark);
                break;
        }

        card.appendChild(preview);

        // Info section (title and URL)
        if (this.settings.showLabels !== false) {
            const info = document.createElement('div');
            info.className = 'bookmark-info';

            const title = document.createElement('div');
            title.className = 'bookmark-title';
            title.textContent = bookmark.title;

            const url = document.createElement('div');
            url.className = 'bookmark-url';
            try {
                url.textContent = new URL(bookmark.url).hostname;
            } catch (e) {
                url.textContent = bookmark.url;
            }

            info.appendChild(title);
            info.appendChild(url);
            card.appendChild(info);
        }

        // Actions (edit, delete, refresh)
        const actions = document.createElement('div');
        actions.className = 'bookmark-actions';

        // Refresh button (always available)
        const refreshBtn = document.createElement('button');
        refreshBtn.className = 'icon-btn';
        refreshBtn.innerHTML = '<span class="material-icons">refresh</span>';
        refreshBtn.title = i18n('refreshScreenshotTooltip');
        refreshBtn.onclick = async (e) => {
            e.stopPropagation();
            await this.refreshBookmarkScreenshot(bookmark, preview, refreshBtn);
        };
        actions.appendChild(refreshBtn);

        // Move to desktop button (only for bookmarks in folders)
        if (bookmark.folderId) {
            const moveToDesktopBtn = document.createElement('button');
            moveToDesktopBtn.className = 'icon-btn';
            moveToDesktopBtn.innerHTML = '<span class="material-icons">drive_file_move</span>';
            moveToDesktopBtn.title = i18n('moveToDesktopTooltip');
            moveToDesktopBtn.onclick = async (e) => {
                e.stopPropagation();
                await this.moveBookmarkToDesktop(bookmark.id);
            };
            actions.appendChild(moveToDesktopBtn);

            // Move to folder button (move to another folder)
            const moveToFolderBtn = document.createElement('button');
            moveToFolderBtn.className = 'icon-btn';
            moveToFolderBtn.innerHTML = '<span class="material-icons">folder_open</span>';
            moveToFolderBtn.title = i18n('moveToFolderTooltip');
            moveToFolderBtn.onclick = async (e) => {
                e.stopPropagation();
                await this.moveBookmarkToFolder(bookmark.id);
            };
            actions.appendChild(moveToFolderBtn);
        }

        const editBtn = document.createElement('button');
        editBtn.className = 'icon-btn';
        editBtn.innerHTML = '<span class="material-icons">edit</span>';
        editBtn.onclick = (e) => {
            e.stopPropagation();
            this.editBookmark(bookmark.id);
        };

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'icon-btn';
        deleteBtn.innerHTML = '<span class="material-icons">delete</span>';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            this.deleteBookmark(bookmark.id);
        };

        actions.appendChild(editBtn);
        actions.appendChild(deleteBtn);
        card.appendChild(actions);

        // Add resize handle
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'bookmark-resize-handle';
        card.appendChild(resizeHandle);

        // Click to open URL (with resize and drag prevention)
        let wasResizing = false;
        card.addEventListener('click', (e) => {
            // Don't open if was just resizing
            if (wasResizing) {
                wasResizing = false;
                return;
            }
            // Don't open if was just dragging
            if (card.dataset.wasDragging) {
                return;
            }
            const openBehavior = this.settings.linkOpenBehavior || 'newWindow';
            if (openBehavior === 'sameTab') {
                if (typeof chrome !== 'undefined' && chrome.tabs) {
                    chrome.tabs.update({ url: bookmark.url });
                } else {
                    window.location.href = bookmark.url;
                }
                return;
            }

            if (typeof chrome !== 'undefined' && chrome.tabs) {
                chrome.tabs.create({ url: bookmark.url, active: true });
            } else {
                window.open(bookmark.url, '_blank');
            }
        });

        // Middle mouse button click (wheel click) to open URL in background tab
        card.addEventListener('mousedown', (e) => {
            // Check for middle button (button === 1)
            if (e.button === 1) {
                e.preventDefault(); // Prevent default scroll behavior
                // Don't open if was just dragging
                if (card.dataset.wasDragging) {
                    return;
                }
                // Open in background tab using Chrome API
                if (typeof chrome !== 'undefined' && chrome.tabs) {
                    chrome.tabs.create({ url: bookmark.url, active: false });
                } else {
                    // Fallback for non-extension environment
                    window.open(bookmark.url, '_blank');
                }
            }
        });

        // Listen for resize end
        document.addEventListener('bookmark-resized', (e) => {
            if (e.detail.bookmarkId === bookmark.id) {
                wasResizing = true;
                // Reset after short delay
                setTimeout(() => {
                    wasResizing = false;
                }, 300);
            }
        });

        return card;
    }

    renderFaviconPreview(preview, bookmark) {
        preview.classList.remove('representative-thumbnail', 'screenshot-preview');
        if (preview.parentElement) {
            preview.parentElement.classList.remove('transparent-thumbnail-card');
        }
        preview.style.backgroundImage = '';
        preview.style.backgroundColor = '';
        preview.innerHTML = '';
        const favicon = document.createElement('img');
        favicon.className = 'favicon';
        favicon.src = StorageManager.getFaviconUrl(bookmark.url);
        favicon.onerror = () => {
            // Fallback to material icon
            preview.innerHTML = '<span class="material-icons">language</span>';
        };
        preview.appendChild(favicon);
    }

    async renderIconPreview(preview, bookmark) {
        this.renderFaviconPreview(preview, bookmark);
        const thumbnail = await StorageManager.getThumbnail(bookmark.id);
        if (thumbnail) {
            VisualRendering.applyRepresentativeThumbnail(preview, thumbnail);
            return;
        }

        try {
            await VisualRendering.requestVisualRefresh(chrome, bookmark.id, 'initial');
            const refreshed = await StorageManager.getThumbnail(bookmark.id);
            if (refreshed) VisualRendering.applyRepresentativeThumbnail(preview, refreshed);
        } catch (error) {
            // The favicon already shown is the intended final fallback.
        }
    }

    async renderCustomPreview(preview, bookmark) {
        const customImage = await StorageManager.getCustomImage(bookmark.id);
        if (customImage) {
            const img = document.createElement('img');
            img.src = customImage;
            preview.appendChild(img);
        } else {
            // Fallback
            this.renderFaviconPreview(preview, bookmark);
        }
    }

    async renderScreenshotPreview(preview, bookmark) {
        // Show loading state
        preview.innerHTML = '<div class="loading-preview"><span class="material-icons rotating">refresh</span></div>';

        // Try to load existing screenshot
        const screenshot = await StorageManager.getScreenshot(bookmark.id);

        if (screenshot) {
            VisualRendering.applyScreenshot(preview, screenshot, bookmark.title);
        } else {
            // No real screenshot yet: queue the initial temporary-window capture.
            this.captureAndDisplayScreenshot(preview, bookmark);
        }
    }

    async captureAndDisplayScreenshot(preview, bookmark) {
        // Show loading with favicon as fallback
        const faviconUrl = StorageManager.getFaviconUrl(bookmark.url);
        const color = this.getColorFromUrl(bookmark.url);

        preview.style.background = `linear-gradient(135deg, ${color}22, ${color}44)`;
        preview.innerHTML = `
            <div class="screenshot-loading">
                <img src="${faviconUrl}" class="favicon" onerror="this.style.display='none'">
                <div class="loading-spinner">
                    <span class="material-icons rotating">camera_alt</span>
                    <p style="font-size: 12px; margin-top: 8px; color: var(--text-secondary);">${i18n('screenshotCapturing')}</p>
                </div>
            </div>
        `;

        try {
            await VisualRendering.requestVisualRefresh(chrome, bookmark.id, 'initial');
            const screenshot = await StorageManager.getScreenshot(bookmark.id);
            if (!screenshot) throw new Error('No screenshot available');
            VisualRendering.applyScreenshot(preview, screenshot, bookmark.title);

        } catch (error) {
            console.error('Failed to capture screenshot:', error);

            // Show error state with favicon fallback
            preview.innerHTML = '';
            preview.style.background = `linear-gradient(135deg, ${color}22, ${color}44)`;

            const fallback = document.createElement('div');
            fallback.style.display = 'flex';
            fallback.style.flexDirection = 'column';
            fallback.style.alignItems = 'center';
            fallback.style.justifyContent = 'center';
            fallback.style.height = '100%';
            fallback.innerHTML = `
                <img src="${faviconUrl}" class="favicon" onerror="this.style.display='none'">
                <span class="material-icons" style="font-size: 48px; color: var(--text-secondary); margin-top: 8px;">broken_image</span>
                <p style="font-size: 12px; margin-top: 8px; color: var(--text-secondary);">${i18n('screenshotRetry')}</p>
            `;

            preview.appendChild(fallback);
        }
    }

    async refreshBookmarkScreenshot(bookmark, preview, refreshBtn) {
        // Show loading
        const refreshIcon = refreshBtn.querySelector('.material-icons');
        if (refreshIcon) {
            refreshIcon.classList.add('rotating');
        }

        try {
            await VisualRendering.requestVisualRefresh(chrome, bookmark.id, 'manual');

            if (bookmark.displayType === 'preview' || !bookmark.displayType) {
                const screenshot = await StorageManager.getScreenshot(bookmark.id);
                if (screenshot) VisualRendering.applyScreenshot(preview, screenshot, bookmark.title);
            } else if (bookmark.displayType === 'icon') {
                const thumbnail = await StorageManager.getThumbnail(bookmark.id);
                if (thumbnail) {
                    VisualRendering.applyRepresentativeThumbnail(preview, thumbnail);
                } else {
                    this.renderFaviconPreview(preview, bookmark);
                }
            } else {
                await this.renderCustomPreview(preview, bookmark);
            }
        } catch (error) {
            console.error('Failed to refresh screenshot:', error);
            alert(i18n('refreshScreenshotFailed', [error.message]));
        } finally {
            if (refreshIcon) {
                refreshIcon.classList.remove('rotating');
            }
        }
    }

    getColorFromUrl(url) {
        // Generate a consistent color based on URL
        let hash = 0;
        for (let i = 0; i < url.length; i++) {
            hash = url.charCodeAt(i) + ((hash << 5) - hash);
        }

        const colors = [
            '#1976d2', '#388e3c', '#d32f2f', '#f57c00',
            '#7b1fa2', '#0097a7', '#c2185b', '#5d4037'
        ];

        return colors[Math.abs(hash) % colors.length];
    }

    renderEmptyState(container) {
        const empty = document.createElement('div');
        empty.style.textAlign = 'center';
        empty.style.padding = '60px 20px';
        empty.style.color = 'var(--text-secondary)';

        const emptyTitle = i18n('emptyStateTitle');
        const emptySubtitle = i18n('emptyStateSubtitle', [i18n('addBookmark')]);

        empty.innerHTML = `
            <span class="material-icons" style="font-size: 64px; opacity: 0.3;">bookmarks</span>
            <h2 style="margin-top: 16px; font-weight: 400;">${emptyTitle}</h2>
            <p style="margin-top: 8px;">${emptySubtitle}</p>
        `;

        container.appendChild(empty);
    }

    async addBookmark(bookmarkData) {
        const bookmark = await StorageManager.addBookmark(bookmarkData);
        this.allBookmarks.push(bookmark);
        this.filterBookmarksByWorkspace();
        return bookmark;
    }

    async updateBookmark(id, updates) {
        const bookmark = await StorageManager.updateBookmark(id, updates);
        const allIndex = this.allBookmarks.findIndex(b => b.id === id);
        if (allIndex !== -1) {
            this.allBookmarks[allIndex] = bookmark;
        }
        this.filterBookmarksByWorkspace();
        return bookmark;
    }

    async deleteBookmark(id) {
        if (confirm(i18n('deleteBookmarkConfirm'))) {
            await StorageManager.deleteBookmark(id);
            this.allBookmarks = this.allBookmarks.filter(b => b.id !== id);
            this.filterBookmarksByWorkspace();

            // Re-render desktop
            const container = document.getElementById('bookmarksGrid');
            await this.renderBookmarks(container);

            // Re-enable drag & drop
            const dragDropManager = window.dragDropManager;
            if (dragDropManager) {
                dragDropManager.enableDragDrop(container);
            }

            // If folder modal is open, refresh it
            const folderModal = document.getElementById('openFolderModal');
            if (folderModal && folderModal.classList.contains('open') && window.currentOpenFolder) {
                await window.openFolderModal(window.currentOpenFolder);
            }
        }
    }

    async editBookmark(id) {
        const bookmark = this.bookmarks.find(b => b.id === id);
        if (!bookmark) return;

        this.currentEditingId = id;

        // Fill modal with bookmark data
        document.getElementById('modalTitle').textContent = i18n('modalEditBookmark');
        document.getElementById('bookmarkTitle').value = bookmark.title;
        document.getElementById('bookmarkUrl').value = bookmark.url;

        // Set size (use width if available, otherwise default to 200)
        const size = bookmark.width || 200;
        document.getElementById('bookmarkSize').value = size.toString();

        // Set display type
        const displayType = bookmark.displayType || PreviewPolicy.DEFAULT_BOOKMARK_DISPLAY_TYPE;
        const displayTypeRadio = document.querySelector(`input[name="displayType"][value="${displayType}"]`);
        if (displayTypeRadio) {
            displayTypeRadio.checked = true;
            this.toggleDisplayTypeFields(displayType);
        }
        document.getElementById('screenshotRefreshInterval').value =
            BookmarkFormPolicy.normalizeScreenshotRefreshInterval(bookmark.screenshotRefreshInterval);

        // Load folders and set current folder
        if (typeof loadFoldersIntoDropdown === 'function') {
            await loadFoldersIntoDropdown();
            const folderSelect = document.getElementById('bookmarkFolder');
            if (folderSelect && bookmark.folderId) {
                folderSelect.value = bookmark.folderId;
            }
        }

        // Show modal
        document.getElementById('bookmarkModal').classList.add('open');
    }

    async updateBookmarkPosition(bookmarkId, x, y) {
        const bookmark = this.allBookmarks.find(b => b.id === bookmarkId);
        if (!bookmark) {
            console.error('❌ Bookmark not found:', bookmarkId);
            return;
        }

        bookmark.x = x;
        bookmark.y = y;

        try {
            await StorageManager.saveBookmarks(this.allBookmarks);
        } catch (error) {
            console.error('❌ Failed to save bookmark position:', error);
            // Reload bookmarks to sync state
            await this.loadBookmarks();
            throw error;
        }
    }

    async updateBookmarkSize(bookmarkId, width, height) {
        const bookmark = this.allBookmarks.find(b => b.id === bookmarkId);
        if (!bookmark) {
            console.error('❌ Bookmark not found:', bookmarkId);
            return;
        }

        bookmark.width = width;
        bookmark.height = height;

        try {
            await StorageManager.saveBookmarks(this.allBookmarks);
        } catch (error) {
            console.error('❌ Failed to save bookmark size:', error);
            // Reload bookmarks to sync state
            await this.loadBookmarks();
            throw error;
        }
    }

    async reorderBookmarks(fromIndex, toIndex) {
        await StorageManager.reorderBookmarks(fromIndex, toIndex);
        this.allBookmarks = await StorageManager.getBookmarks();
        this.filterBookmarksByWorkspace();

        // Re-render
        const container = document.getElementById('bookmarksGrid');
        await this.renderBookmarks(container);

        // Re-enable drag & drop
        const dragDropManager = window.dragDropManager;
        if (dragDropManager) {
            dragDropManager.enableDragDrop(container);
            dragDropManager.enableTouchDragDrop(container);
        }
    }

    toggleDisplayTypeFields(displayType) {
        const visibility = BookmarkFormPolicy.getDisplayFieldVisibility(displayType);
        const customImageGroup = document.getElementById('customImageGroup');
        const screenshotRefreshGroup = document.getElementById('screenshotRefreshGroup');
        customImageGroup.style.display = visibility.showCustomImage ? 'block' : 'none';
        screenshotRefreshGroup.style.display = visibility.showScreenshotSchedule ? 'block' : 'none';
    }

    toggleCustomImageField(displayType) {
        this.toggleDisplayTypeFields(displayType);
    }

    async searchBookmarks(query) {
        const workspaceBookmarks = this.bookmarks;

        if (!query) {
            return workspaceBookmarks;
        }

        const lowerQuery = query.toLowerCase();
        return workspaceBookmarks.filter(bookmark => {
            return bookmark.title.toLowerCase().includes(lowerQuery) ||
                   bookmark.url.toLowerCase().includes(lowerQuery);
        });
    }

    async importFromChrome() {
        const imported = await StorageManager.importChromeBookmarks();

        if (imported.length === 0) {
            alert(i18n('importChromeNone'));
            return;
        }

        const confirmMsg = i18n('importChromeConfirm', [imported.length]);
        if (confirm(confirmMsg)) {
            // Add to existing bookmarks
            for (const bookmark of imported) {
                await this.addBookmark(bookmark);
            }

            // Re-render
            const container = document.getElementById('bookmarksGrid');
            await this.renderBookmarks(container);

            // Re-enable drag & drop
            const dragDropManager = window.dragDropManager;
            if (dragDropManager) {
                dragDropManager.enableDragDrop(container);
            }

            alert(i18n('importChromeSuccess', [imported.length]));
        }
    }

    async moveBookmarkToDesktop(bookmarkId) {
        const bookmark = this.allBookmarks.find(b => b.id === bookmarkId);
        if (!bookmark) return;

        // Remove from folder
        delete bookmark.folderId;

        // Find free position on desktop
        const freePos = await this.findFreePosition(bookmark.width || 200, bookmark.height || 200);
        bookmark.x = freePos.x;
        bookmark.y = freePos.y;

        // Save changes
        await StorageManager.saveBookmarks(this.allBookmarks);

        // Refresh desktop
        const container = document.getElementById('bookmarksGrid');
        await this.renderBookmarks(container);

        // Re-enable drag & drop
        const dragDropManager = window.dragDropManager;
        if (dragDropManager) {
            dragDropManager.enableDragDrop(container);
        }

        // Close folder modal and refresh it
        const folderModal = document.getElementById('openFolderModal');
        if (folderModal && folderModal.classList.contains('open')) {
            folderModal.classList.remove('open');
        }
    }

    async moveBookmarkToFolder(bookmarkId) {
        const bookmark = this.allBookmarks.find(b => b.id === bookmarkId);
        if (!bookmark) return;

        // Get all folders in current workspace
        const folders = await StorageManager.getFoldersByWorkspace(this.currentWorkspace);

        // Filter out current folder
        const otherFolders = folders.filter(f => f.id !== bookmark.folderId);

        if (otherFolders.length === 0) {
            alert(i18n('noOtherFoldersAvailable'));
            return;
        }

        // Create selection dialog
        const numberedList = otherFolders.map((f, i) => `${i + 1}. ${f.name}`).join('\n');
        const selectedFolder = prompt(i18n('moveBookmarkSelectFolderPrompt', [numberedList]));

        if (selectedFolder === null) return; // Cancelled

        const folderIndex = parseInt(selectedFolder) - 1;
        if (isNaN(folderIndex) || folderIndex < 0 || folderIndex >= otherFolders.length) {
            alert(i18n('invalidSelection'));
            return;
        }

        const targetFolder = otherFolders[folderIndex];

        // Update bookmark - just set folderId (grid layout handles positioning)
        bookmark.folderId = targetFolder.id;
        // Remove position data - not needed in grid layout
        delete bookmark.x;
        delete bookmark.y;

        // Save changes
        await StorageManager.saveBookmarks(this.allBookmarks);

        // Refresh desktop
        const container = document.getElementById('bookmarksGrid');
        await this.renderBookmarks(container);

        // Re-enable drag & drop
        const dragDropManager = window.dragDropManager;
        if (dragDropManager) {
            dragDropManager.enableDragDrop(container);
        }

        // Close current folder modal
        const folderModal = document.getElementById('openFolderModal');
        if (folderModal && folderModal.classList.contains('open')) {
            folderModal.classList.remove('open');
        }

        alert(i18n('bookmarkMovedToFolder', [targetFolder.name]));
    }

    async findFreePosition(width = 200, height = 200) {
        const allBookmarks = await StorageManager.getBookmarks();
        const currentWorkspace = await StorageManager.getCurrentWorkspace();
        const allFolders = await StorageManager.getFolders();

        // Get all items on current workspace
        const workspaceBookmarks = allBookmarks.filter(b =>
            b.workspace === currentWorkspace && !b.folderId
        );
        const workspaceFolders = allFolders.filter(f =>
            f.workspace === currentWorkspace
        );

        const gridStep = 50;
        const padding = 20;
        let x = padding;
        let y = padding;

        const maxAttempts = 1000;
        let attempts = 0;

        while (attempts < maxAttempts) {
            let collision = false;

            // Check collision with bookmarks
            for (const bookmark of workspaceBookmarks) {
                const bx = bookmark.x || 50;
                const by = bookmark.y || 50;
                const bw = bookmark.width || 200;
                const bh = bookmark.height || 200;

                if (!(x + width < bx || x > bx + bw || y + height < by || y > by + bh)) {
                    collision = true;
                    break;
                }
            }

            // Check collision with folders
            if (!collision) {
                for (const folder of workspaceFolders) {
                    const fx = folder.x || 50;
                    const fy = folder.y || 50;
                    const fw = folder.width || 200;
                    const fh = folder.height || 200;

                    if (!(x + width < fx || x > fx + fw || y + height < fy || y > fy + fh)) {
                        collision = true;
                        break;
                    }
                }
            }

            if (!collision) {
                return { x, y };
            }

            // Move to next position
            x += gridStep;
            if (x > window.innerWidth - width - padding) {
                x = padding;
                y += gridStep;
            }

            attempts++;
        }

        // Fallback to random position if no free space found
        return {
            x: Math.random() * (window.innerWidth - width - 100) + 50,
            y: Math.random() * (window.innerHeight - height - 100) + 50
        };
    }

}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BookmarkManager;
}

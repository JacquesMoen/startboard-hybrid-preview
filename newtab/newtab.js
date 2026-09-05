// Main application logic for Visual Bookmarks

// Global instances
let bookmarkManager;
let dragDropManager;
let currentSettings = {};
let activeSettingsTab = 'visual';
let currentWorkspaceLocked = false;
let currentContextWorkspaceLocked = false;
const MAX_BACKGROUND_MEDIA_BYTES = 25 * 1024 * 1024;

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    await initializeApp();
});

async function initializeApp() {
    // Initialize managers
    bookmarkManager = new BookmarkManager();
    dragDropManager = new DragDropManager();
    document.documentElement.style.setProperty('--grid-size', `${dragDropManager.snapGridSize}px`);

    // Make dragDropManager globally accessible
    window.dragDropManager = dragDropManager;

    // Load data
    await bookmarkManager.init();
    currentSettings = bookmarkManager.settings;

    // Apply theme
    applyTheme(currentSettings.theme);

    // Apply settings
    applySettings(currentSettings);
    await refreshWorkspaceLockState();

    // Render workspace switcher
    await renderWorkspaceSwitcher();

    // Render bookmarks
    const container = document.getElementById('bookmarksGrid');
    await bookmarkManager.renderBookmarks(container);

    // Enable drag & drop
    dragDropManager.enableDragDrop(container);

    // Setup event listeners
    setupEventListeners();
    setupSelectionToolbar();
    setupHybridPreviewRefresh();

    // Setup external drag and drop (from Chrome bookmarks bar)
    setupExternalDragDrop(container);

    // Listen for bookmark moved events (free positioning on desktop only)
    document.addEventListener('bookmark-moved', async (e) => {
        const { bookmarkId, x, y, insideFolder } = e.detail;
        if (currentWorkspaceLocked) {
            return;
        }

        // Ignore events from inside folder (grid layout, no drag)
        if (insideFolder) {
            return;
        }

        try {
            // If bookmark was in a folder and moved to empty space, remove from folder
            const bookmarks = await StorageManager.getBookmarks();

            // CRITICAL CHECK: Verify we got valid data
            if (!bookmarks || !Array.isArray(bookmarks)) {
                console.error('❌ CRITICAL: Failed to get bookmarks in bookmark-moved handler');
                alert(i18n('moveBookmarkFailedRetry'));
                return;
            }

            const bookmark = bookmarks.find(b => b.id === bookmarkId);

            if (bookmark && bookmark.folderId) {
                // Remove from folder
                delete bookmark.folderId;
                bookmark.x = x;
                bookmark.y = y;
                await StorageManager.saveBookmarks(bookmarks);
                await refreshBookmarks();
            } else {
                // Normal position update on desktop
                await bookmarkManager.updateBookmarkPosition(bookmarkId, x, y);
            }
        } catch (error) {
            console.error('❌ Error in bookmark-moved handler:', error);
            alert(i18n('moveBookmarkFailed', [error.message]));
        }
    });

    // Listen for bookmark resized events
    document.addEventListener('bookmark-resized', async (e) => {
        const { bookmarkId, width, height } = e.detail;
        if (currentWorkspaceLocked) {
            return;
        }
        await bookmarkManager.updateBookmarkSize(bookmarkId, width, height);
    });

    // Listen for bookmark dropped on folder events
    document.addEventListener('bookmark-dropped-on-folder', async (e) => {
        const { bookmarkId, folderId, x, y } = e.detail;
        if (currentWorkspaceLocked) {
            return;
        }

        try {
            // Update bookmark with folder and position
            const bookmarks = await StorageManager.getBookmarks();

            // CRITICAL CHECK: Verify we got valid data
            if (!bookmarks || !Array.isArray(bookmarks)) {
                console.error('❌ CRITICAL: Failed to get bookmarks in bookmark-dropped-on-folder handler');
                alert(i18n('moveBookmarkToFolderFailedRetry'));
                return;
            }

            const bookmark = bookmarks.find(b => b.id === bookmarkId);

            if (bookmark) {
                bookmark.folderId = folderId;
                bookmark.x = x;
                bookmark.y = y;
                await StorageManager.saveBookmarks(bookmarks);

                // Refresh the display
                await refreshBookmarks();
            } else {
                console.error('❌ Bookmark not found:', bookmarkId);
            }
        } catch (error) {
            console.error('❌ Error in bookmark-dropped-on-folder handler:', error);
            alert(i18n('moveBookmarkToFolderFailed', [error.message]));
        }
    });

    // Listen for folder moved events
    document.addEventListener('folder-moved', async (e) => {
        const { folderId, x, y } = e.detail;
        if (currentWorkspaceLocked) {
            return;
        }
        await StorageManager.updateFolder(folderId, { x, y });
    });

    // Listen for folder resized events
    document.addEventListener('folder-resized', async (e) => {
        const { folderId, width, height } = e.detail;
        if (currentWorkspaceLocked) {
            return;
        }
        await StorageManager.updateFolder(folderId, { width, height });
    });

    // Listen for bookmarks reordered in folder (grid sorting)
    document.addEventListener('bookmarks-reordered-in-folder', async (e) => {
        const { bookmarkIds } = e.detail;
        if (currentWorkspaceLocked) {
            return;
        }

        // Get all bookmarks
        const allBookmarks = await StorageManager.getBookmarks();

        // Create a map for quick lookup
        const bookmarkMap = {};
        allBookmarks.forEach(b => {
            bookmarkMap[b.id] = b;
        });

        // Reorder the bookmarks in the folder according to new order
        const reorderedBookmarks = [];
        const otherBookmarks = [];

        // First, collect bookmarks that are being reordered
        bookmarkIds.forEach(id => {
            if (bookmarkMap[id]) {
                reorderedBookmarks.push(bookmarkMap[id]);
            }
        });

        // Then collect all other bookmarks
        allBookmarks.forEach(b => {
            if (!bookmarkIds.includes(b.id)) {
                otherBookmarks.push(b);
            }
        });

        // Combine: other bookmarks first, then reordered ones
        const newBookmarksList = [...otherBookmarks, ...reorderedBookmarks];

        // Save new order
        await StorageManager.saveBookmarks(newBookmarksList);
    });
}

function setupHybridPreviewRefresh() {
    chrome.runtime.onMessage.addListener((message) => {
        if (message && message.type === 'preview-updated') refreshBookmarks();
    });

    // Keep startup fast: refresh stale representative images after the board is usable.
    setTimeout(() => {
        PreviewMetadata.refreshStalePreviews(async () => {
            await refreshBookmarks();
        }).catch((error) => console.debug('Automatic preview refresh skipped:', error.message));
    }, 0);
}

function setupEventListeners() {
    // Settings button
    document.getElementById('settingsBtn').addEventListener('click', async () => {
        document.getElementById('settingsPanel').classList.add('open');
        await loadSettingsToPanel();
        activateSettingsTab(activeSettingsTab);
    });

    // Close settings
    document.getElementById('closeSettings').addEventListener('click', () => {
        document.getElementById('settingsPanel').classList.remove('open');
    });

    // Add bookmark button
    document.getElementById('addBookmarkBtn').addEventListener('click', async () => {
        await openAddBookmarkModal();
    });

    // Add folder button
    document.getElementById('addFolderBtn').addEventListener('click', openAddFolderModal);

    // Modal close
    document.getElementById('closeModal').addEventListener('click', closeBookmarkModal);
    document.getElementById('cancelModal').addEventListener('click', closeBookmarkModal);

    // Save bookmark
    document.getElementById('saveBookmark').addEventListener('click', saveBookmark);

    // Display type radio change
    document.querySelectorAll('input[name="displayType"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            bookmarkManager.toggleCustomImageField(e.target.value);
        });
    });

    // Custom image upload
    document.getElementById('customImage').addEventListener('change', handleCustomImageUpload);

    // Settings tabs
    setupSettingsTabs();

    // Settings changes
    setupSettingsListeners();

    // Click outside modal to close - DISABLED for bookmark modal
    // Users can only close via X button or Cancel/Save buttons
    /*
    document.getElementById('bookmarkModal').addEventListener('click', (e) => {
        if (e.target.id === 'bookmarkModal') {
            closeBookmarkModal();
        }
    });
    */

    document.getElementById('settingsPanel').addEventListener('click', (e) => {
        if (e.target.id === 'settingsPanel') {
            document.getElementById('settingsPanel').classList.remove('open');
        }
    });

    // Context menu
    setupContextMenu();

    // Workspace management
    document.getElementById('workspaceAddBtn').addEventListener('click', openAddWorkspace);
    document.getElementById('closeEditWorkspaceModal').addEventListener('click', closeEditWorkspace);
    document.getElementById('cancelEditWorkspace').addEventListener('click', closeEditWorkspace);
    document.getElementById('saveWorkspace').addEventListener('click', saveWorkspaceChanges);

    // Icon picker
    document.querySelectorAll('.icon-option').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            document.querySelectorAll('.icon-option').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
        });
    });

    // Workspace background picker
    document.querySelectorAll('#workspaceBackgroundPicker .preset-bg-item').forEach(item => {
        item.addEventListener('click', () => {
            document.querySelectorAll('#workspaceBackgroundPicker .preset-bg-item').forEach(i => i.classList.remove('selected'));
            item.classList.add('selected');

            // If custom option clicked, open file picker
            if (item.id === 'customBackgroundOption') {
                document.getElementById('workspaceCustomBackground').click();
            }
        });
    });

    // Handle custom background file selection
    document.getElementById('workspaceCustomBackground').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (file.size > MAX_BACKGROUND_MEDIA_BYTES) {
            alert(i18n('backgroundMediaTooLarge'));
            e.target.value = '';
            resetWorkspaceCustomPreview();
            return;
        }

        const mediaType = getBackgroundMediaType(file);
        if (!mediaType) {
            alert(i18n('backgroundMediaUnsupported'));
            e.target.value = '';
            resetWorkspaceCustomPreview();
            return;
        }

        try {
            const dataUrl = await readFileAsDataUrl(file);
            updateWorkspaceCustomPreview(mediaType, dataUrl);
        } catch (error) {
            console.error('Error loading workspace background preview:', error);
            alert(i18n('backgroundMediaFailed'));
            e.target.value = '';
            resetWorkspaceCustomPreview();
        }
    });

    // Close edit workspace modal on background click
    document.getElementById('editWorkspaceModal').addEventListener('click', (e) => {
        if (e.target.id === 'editWorkspaceModal') {
            // Don't close if user is selecting text
            const selection = window.getSelection();
            if (selection && selection.toString().length > 0) {
                return;
            }
            closeEditWorkspace();
        }
    });

    // Setup workspace context menu
    setupWorkspaceContextMenu();

    // Setup folder context menu
    setupFolderContextMenu();

    // Setup edit folder modal (one-time initialization)
    setupEditFolderModal();
}

function setupContextMenu() {
    const contextMenu = document.getElementById('bookmarkContextMenu');
    let currentBookmarkCard = null;
    let menuJustOpened = false;

    // Show context menu on right click
    document.addEventListener('contextmenu', (e) => {
        const bookmarkCard = e.target.closest('.bookmark-card');
        const folderCard = e.target.closest('.folder-card');
        const workspaceTab = e.target.closest('.workspace-tab');
        const workspaceSwitcher = e.target.closest('.workspace-switcher');
        const fabContainer = e.target.closest('.fab-container');
        const modal = e.target.closest('.modal');
        const settingsPanel = e.target.closest('.settings-panel');
        const bookmarksGrid = e.target.closest('#bookmarksGrid');

        if (bookmarkCard) {
            // Right click on bookmark
            if (currentWorkspaceLocked) {
                return;
            }
            e.preventDefault();
            currentBookmarkCard = bookmarkCard;

            // Close all other context menus first
            document.querySelectorAll('.context-menu').forEach(menu => {
                menu.classList.remove('show');
            });

            // Smart positioning for bookmark context menu
            menuJustOpened = true;
            contextMenu.classList.add('show');
            positionContextMenu(contextMenu, e.clientX, e.clientY);

            // Reset flag after a short delay
            setTimeout(() => {
                menuJustOpened = false;
            }, 100);
        } else if (folderCard) {
            // Right click on folder
            if (currentWorkspaceLocked) {
                return;
            }
            e.preventDefault();
            const folderId = folderCard.dataset.folderId;
            if (folderId) {
                showFolderContextMenu(e, folderId);
            }
        } else if (bookmarksGrid && !workspaceTab && !workspaceSwitcher && !fabContainer && !modal && !settingsPanel) {
            // Right click on empty desktop area -> workspace context menu
            e.preventDefault();
            StorageManager.getCurrentWorkspace().then((workspaceId) => {
                showWorkspaceContextMenu(e, workspaceId);
            });
        }
    });

    // Global handler to close all context menus on click outside
    document.addEventListener('click', (e) => {
        // Ignore clicks immediately after opening menu
        if (menuJustOpened || workspaceMenuJustOpened || folderMenuJustOpened) {
            return;
        }

        // Check if click is inside any context menu
        const clickedInsideMenu = e.target.closest('.context-menu');

        if (!clickedInsideMenu) {
            // Close all context menus
            document.querySelectorAll('.context-menu').forEach(menu => {
                menu.classList.remove('show');
                // Force hide with inline style
                menu.style.display = 'none';
            });
        }
    });

    // Close context menus on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.context-menu').forEach(menu => {
                menu.classList.remove('show');
                menu.style.display = 'none';
            });
        }
    });

    // Prevent clicks inside context menus from bubbling up
    document.querySelectorAll('.context-menu').forEach(menu => {
        menu.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    });

    // Handle menu item clicks
    contextMenu.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', async (e) => {
            // Stop propagation to prevent global handler from closing menu prematurely
            e.stopPropagation();
            if (currentWorkspaceLocked) {
                return;
            }

            if (item.id === 'moveBookmarkToWorkspace') {
                // Move bookmark to another workspace
                if (currentBookmarkCard) {
                    await showWorkspaceSelectionModal('bookmark', currentBookmarkCard.dataset.id);
                }
            } else if (item.dataset.action === 'color') {
                // Open color picker
                if (currentBookmarkCard) {
                    openBookmarkColorModal(currentBookmarkCard.dataset.id);
                }
            } else if (item.dataset.size) {
                // Handle size selection
                const size = parseInt(item.dataset.size);
                if (currentBookmarkCard) {
                    const bookmarkId = currentBookmarkCard.dataset.id;

                    // Save current position first
                    const currentX = parseInt(currentBookmarkCard.style.left) || 50;
                    const currentY = parseInt(currentBookmarkCard.style.top) || 50;
                    await bookmarkManager.updateBookmarkPosition(bookmarkId, currentX, currentY);

                    // Update card size
                    currentBookmarkCard.style.width = size + 'px';
                    currentBookmarkCard.style.height = size + 'px';

                    // Save to storage
                    await bookmarkManager.updateBookmarkSize(bookmarkId, size, size);
                }
            }

            // Hide menu
            contextMenu.classList.remove('show');
            contextMenu.style.display = 'none';
            currentBookmarkCard = null;
        });
    });
}

function setupSettingsTabs() {
    const tabs = Array.from(document.querySelectorAll('.settings-tab'));
    const panels = Array.from(document.querySelectorAll('.settings-tab-panel'));

    if (!tabs.length || !panels.length) {
        return;
    }

    tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            const tabId = tab.dataset.tab;
            if (!tabId) {
                return;
            }
            activeSettingsTab = tabId;
            activateSettingsTab(tabId);
        });
    });

    activateSettingsTab(activeSettingsTab);
}

function activateSettingsTab(tabId) {
    const tabs = document.querySelectorAll('.settings-tab');
    const panels = document.querySelectorAll('.settings-tab-panel');

    tabs.forEach((tab) => {
        const isActive = tab.dataset.tab === tabId;
        tab.classList.toggle('active', isActive);
        tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
        tab.setAttribute('tabindex', isActive ? '0' : '-1');
    });

    panels.forEach((panel) => {
        const isActive = panel.dataset.tab === tabId;
        panel.classList.toggle('active', isActive);
        panel.hidden = !isActive;
    });
}

function setupSettingsListeners() {
    // Language select
    document.getElementById('languageSelect').addEventListener('change', async (e) => {
        const newLanguage = e.target.value;
        await updateSetting('language', newLanguage);

        // Load new locale and re-localize page
        await loadLocale(newLanguage);
        localizeHtmlPage();

        // Refresh bookmarks to update any localized content
        await refreshBookmarks();
        updateSelectionToolbar();
    });

    // Theme select
    document.getElementById('themeSelect').addEventListener('change', async (e) => {
        await updateSetting('theme', e.target.value);
        applyTheme(e.target.value);
    });

    // Link open behavior
    document.getElementById('linkOpenBehavior').addEventListener('change', async (e) => {
        await updateSetting('linkOpenBehavior', e.target.value);
    });

    // Show labels
    document.getElementById('showLabels').addEventListener('change', async (e) => {
        await updateSetting('showLabels', e.target.checked);
        await refreshBookmarks();
    });

    // Animations enabled
    document.getElementById('animationsEnabled').addEventListener('change', async (e) => {
        await updateSetting('animationsEnabled', e.target.checked);
        dragDropManager.setAnimationsEnabled(e.target.checked);
        document.body.style.setProperty('--transition-normal', e.target.checked ? '0.3s ease' : '0s');
    });

    // Clean mode
    document.getElementById('cleanMode').addEventListener('change', async (e) => {
        await updateSetting('cleanMode', e.target.checked);
        applyCleanMode(e.target.checked);
    });

    // Auto-arrange bookmarks
    document.getElementById('autoArrangeBookmarks').addEventListener('click', async () => {
        await autoArrangeBookmarks();
    });

    // Export all data
    document.getElementById('exportData').addEventListener('click', async () => {
        await exportAllData();
    });

    // Import data
    document.getElementById('importData').addEventListener('click', async () => {
        await importAllData();
    });

    // Reset data
    document.getElementById('resetData').addEventListener('click', async () => {
        if (confirm(i18n('resetAllConfirm'))) {
            if (confirm(i18n('resetAllConfirmFinal'))) {
                await StorageManager.resetAllData();
                location.reload();
            }
        }
    });

    // Rate extension
    document.getElementById('rateExtension').addEventListener('click', () => {
        chrome.tabs.create({
            url: 'https://chromewebstore.google.com/detail/kehalcfmekcecdjnkplkmkdhikifjbml'
        });
    });
}

function setupSelectionToolbar() {
    const toolbar = document.getElementById('selectionToolbar');
    if (!toolbar) return;

    const deleteBtn = document.getElementById('deleteSelectedItems');
    const sizeSlider = document.getElementById('selectionSize');
    const sizeValue = document.getElementById('selectionSizeValue');

    const updateSizeValue = (value) => {
        if (sizeValue) {
            sizeValue.textContent = `${value}px`;
        }
    };

    updateSizeValue(sizeSlider.value);

    deleteBtn.addEventListener('click', async () => {
        await deleteSelectedItems();
    });

    sizeSlider.addEventListener('input', (e) => {
        const value = parseInt(e.target.value, 10);
        updateSelectionSizePreview(value);
        updateSizeValue(value);
    });

    sizeSlider.addEventListener('change', async (e) => {
        const value = parseInt(e.target.value, 10);
        await saveSelectionSize(value);
    });

    document.addEventListener('selection-changed', () => {
        updateSelectionToolbar();
    });

    updateSelectionToolbar();
}

async function updateSetting(key, value) {
    currentSettings[key] = value;
    if (bookmarkManager) {
        bookmarkManager.settings[key] = value;
    }
    await StorageManager.updateSetting(key, value);
}

async function loadSettingsToPanel() {
    // Get current language
    const currentLanguage = await getCurrentLocale();
    document.getElementById('languageSelect').value = currentLanguage || 'en';

    document.getElementById('themeSelect').value = currentSettings.theme || 'light';
    document.getElementById('linkOpenBehavior').value = currentSettings.linkOpenBehavior || 'newWindow';
    document.getElementById('showLabels').checked = currentSettings.showLabels !== false;
    document.getElementById('animationsEnabled').checked = currentSettings.animationsEnabled !== false;
    document.getElementById('cleanMode').checked = currentSettings.cleanMode === true;
}

async function applySettings(settings) {
    applyTheme(settings.theme);
    await applyWorkspaceBackground();
    applyCleanMode(settings.cleanMode === true);

    if (!settings.animationsEnabled) {
        document.body.style.setProperty('--transition-normal', '0s');
    }
}

function applyTheme(theme) {
    const actualTheme = theme === 'auto' ? getSystemTheme() : theme;
    document.documentElement.setAttribute('data-theme', actualTheme);
}

function applyCleanMode(enabled) {
    document.body.classList.toggle('clean-mode', enabled);
}

async function refreshWorkspaceLockState(workspaceId) {
    const resolvedWorkspaceId = workspaceId || await StorageManager.getCurrentWorkspace();
    const workspaces = await StorageManager.getWorkspaces();
    const workspace = workspaces.find(w => w.id === resolvedWorkspaceId);
    const locked = !!(workspace && workspace.locked);
    applyWorkspaceLockState(locked);
    return locked;
}

function applyWorkspaceLockState(locked) {
    currentWorkspaceLocked = locked;
    document.body.classList.toggle('workspace-locked', locked);

    if (window.dragDropManager) {
        window.dragDropManager.setWorkspaceLocked(locked);
        if (locked) {
            window.dragDropManager.clearSelection();
            window.dragDropManager.clearGridHighlights();
        }
    }

    updateWorkspaceActionAvailability(locked);
    updateSelectionToolbar();
}

function updateWorkspaceActionAvailability(locked) {
    const controls = [
        document.getElementById('addBookmarkBtn'),
        document.getElementById('addFolderBtn'),
        document.getElementById('addBookmarkToFolderBtn'),
        document.getElementById('autoArrangeBookmarks')
    ];

    controls.forEach((control) => {
        if (!control) return;
        control.disabled = locked;
        control.setAttribute('aria-disabled', locked ? 'true' : 'false');
    });
}

async function getWorkspaceLockState(workspaceId) {
    const workspaces = await StorageManager.getWorkspaces();
    const workspace = workspaces.find(w => w.id === workspaceId);
    return !!(workspace && workspace.locked);
}

function setWorkspaceContextMenuLocked(locked) {
    ['editWorkspaceContext', 'changeBackgroundContext', 'deleteWorkspaceContext'].forEach((id) => {
        const item = document.getElementById(id);
        if (item) {
            item.classList.toggle('disabled', locked);
        }
    });
}

async function updateWorkspaceLockContextItem(workspaceId) {
    const lockItem = document.getElementById('toggleWorkspaceLockContext');
    const lockIcon = document.getElementById('workspaceLockIcon');
    const lockLabel = document.getElementById('workspaceLockLabel');

    if (!lockItem || !lockIcon || !lockLabel) return;

    const locked = await getWorkspaceLockState(workspaceId);
    currentContextWorkspaceLocked = locked;
    lockIcon.textContent = locked ? 'lock' : 'lock_open';
    lockLabel.textContent = i18n(locked ? 'unlockWorkspace' : 'lockWorkspace');
    lockItem.dataset.locked = locked ? 'true' : 'false';

    setWorkspaceContextMenuLocked(locked);
}

async function toggleWorkspaceLock(workspaceId) {
    const locked = await getWorkspaceLockState(workspaceId);
    await StorageManager.updateWorkspace(workspaceId, { locked: !locked });
    await updateWorkspaceLockContextItem(workspaceId);
    await renderWorkspaceSwitcher();

    const currentWorkspace = await StorageManager.getCurrentWorkspace();
    if (currentWorkspace === workspaceId) {
        applyWorkspaceLockState(!locked);
    }
}

function getSelectionElements() {
    const container = document.getElementById('bookmarksGrid');
    if (!container) {
        return { bookmarks: [], folders: [] };
    }
    const bookmarks = Array.from(container.querySelectorAll('.bookmark-card.selected'));
    const folders = Array.from(container.querySelectorAll('.folder-card.selected'));
    return { bookmarks, folders };
}

function getSelectionGridSize() {
    return window.dragDropManager && window.dragDropManager.snapGridSize
        ? window.dragDropManager.snapGridSize
        : 10;
}

function getSelectionStepSize() {
    const gridSize = getSelectionGridSize();
    const step = gridSize / 2;
    return step >= 1 ? step : gridSize;
}

function getElementBox(element) {
    const width = element.offsetWidth || parseInt(element.style.width, 10) || 0;
    const height = element.offsetHeight || parseInt(element.style.height, 10) || 0;
    const left = parseInt(element.style.left, 10);
    const top = parseInt(element.style.top, 10);
    return {
        x: Number.isFinite(left) ? left : element.offsetLeft || 0,
        y: Number.isFinite(top) ? top : element.offsetTop || 0,
        width,
        height
    };
}

function snapToGrid(value, gridSize) {
    return Math.round(value / gridSize) * gridSize;
}

function clampValue(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function boxesOverlap(a, b) {
    return !(
        a.x + a.width <= b.x ||
        a.x >= b.x + b.width ||
        a.y + a.height <= b.y ||
        a.y >= b.y + b.height
    );
}

function findFreePosition(startX, startY, size, container, obstacles, stepSize, maxY) {
    const maxX = Math.max(0, container.clientWidth - size);
    const boundedMaxY = Math.max(0, maxY);
    const initialX = clampValue(startX, 0, maxX);
    const initialY = clampValue(startY, 0, boundedMaxY);

    const isFree = (x, y) => {
        const testBox = { x, y, width: size, height: size };
        return !obstacles.some((obstacle) => boxesOverlap(testBox, obstacle));
    };

    if (isFree(initialX, initialY)) {
        return { x: initialX, y: initialY };
    }

    const maxRadius = Math.ceil(Math.max(container.clientWidth, boundedMaxY + size) / stepSize);
    for (let radius = 1; radius <= maxRadius; radius++) {
        const offset = radius * stepSize;
        for (let dx = -radius; dx <= radius; dx++) {
            const candidateX = initialX + dx * stepSize;
            const topY = initialY - offset;
            const bottomY = initialY + offset;
            if (candidateX >= 0 && candidateX <= maxX) {
                if (topY >= 0 && topY <= boundedMaxY && isFree(candidateX, topY)) {
                    return { x: candidateX, y: topY };
                }
                if (bottomY >= 0 && bottomY <= boundedMaxY && isFree(candidateX, bottomY)) {
                    return { x: candidateX, y: bottomY };
                }
            }
        }

        for (let dy = -radius + 1; dy <= radius - 1; dy++) {
            const candidateY = initialY + dy * stepSize;
            const leftX = initialX - offset;
            const rightX = initialX + offset;
            if (candidateY >= 0 && candidateY <= boundedMaxY) {
                if (leftX >= 0 && leftX <= maxX && isFree(leftX, candidateY)) {
                    return { x: leftX, y: candidateY };
                }
                if (rightX >= 0 && rightX <= maxX && isFree(rightX, candidateY)) {
                    return { x: rightX, y: candidateY };
                }
            }
        }
    }

    return { x: initialX, y: initialY };
}

function applySelectionSize(size) {
    const container = document.getElementById('bookmarksGrid');
    if (!container) return;

    const { bookmarks, folders } = getSelectionElements();
    const selectedElements = [...bookmarks, ...folders];
    if (selectedElements.length === 0) return;

    const gridSize = getSelectionGridSize();
    const stepSize = getSelectionStepSize();
    const baseHeight = Math.max(container.clientHeight, container.scrollHeight);
    const extraHeight = size * selectedElements.length;
    const maxY = Math.max(0, baseHeight + extraHeight - size);
    const selectedSet = new Set(selectedElements);
    const allElements = Array.from(container.querySelectorAll('.bookmark-card, .folder-card'));
    const obstacles = allElements
        .filter((element) => !selectedSet.has(element))
        .map((element) => getElementBox(element));

    const placed = [];
    const orderedElements = selectedElements
        .map((element) => ({ element, box: getElementBox(element) }))
        .sort((a, b) => (a.box.y - b.box.y) || (a.box.x - b.box.x));

    orderedElements.forEach(({ element, box }) => {
        const centerX = box.x + box.width / 2;
        const centerY = box.y + box.height / 2;
        let targetX = centerX - size / 2;
        let targetY = centerY - size / 2;
        targetX = snapToGrid(targetX, stepSize);
        targetY = snapToGrid(targetY, stepSize);

        const { x, y } = findFreePosition(
            targetX,
            targetY,
            size,
            container,
            obstacles.concat(placed),
            stepSize,
            maxY
        );

        element.style.width = `${size}px`;
        element.style.height = `${size}px`;
        element.style.left = `${x}px`;
        element.style.top = `${y}px`;

        placed.push({ x, y, width: size, height: size });

        const neededHeight = y + size + 120;
        if (neededHeight > container.offsetHeight) {
            container.style.minHeight = `${neededHeight}px`;
        }
    });
}

function updateSelectionToolbar() {
    const toolbar = document.getElementById('selectionToolbar');
    const countText = document.getElementById('selectionCountText');
    const sizeSlider = document.getElementById('selectionSize');
    const sizeValue = document.getElementById('selectionSizeValue');
    const deleteBtn = document.getElementById('deleteSelectedItems');

    if (!toolbar || !countText || !sizeSlider || !sizeValue || !deleteBtn) return;
    if (currentWorkspaceLocked) {
        toolbar.classList.remove('visible');
        toolbar.setAttribute('aria-hidden', 'true');
        deleteBtn.disabled = true;
        sizeSlider.disabled = true;
        countText.textContent = i18n('selectedItems');
        return;
    }

    const { bookmarks, folders } = getSelectionElements();
    const count = bookmarks.length + folders.length;
    const hasSelection = count > 0;

    toolbar.classList.toggle('visible', hasSelection);
    toolbar.setAttribute('aria-hidden', hasSelection ? 'false' : 'true');
    deleteBtn.disabled = !hasSelection;
    sizeSlider.disabled = !hasSelection;

    if (!hasSelection) {
        countText.textContent = i18n('selectedItems');
        return;
    }

    countText.textContent = `${i18n('selectedItems')} ${count}`;

    const sizes = [...bookmarks, ...folders].map((element) => element.offsetWidth).filter(Boolean);
    if (sizes.length > 0) {
        const targetSize = Math.max(150, Math.min(600, sizes[0]));
        sizeSlider.value = targetSize;
        sizeValue.textContent = `${targetSize}px`;
    }
}

function updateSelectionSizePreview(value) {
    if (currentWorkspaceLocked) {
        return;
    }
    const size = Math.max(150, Math.min(600, value));
    applySelectionSize(size);
}

async function saveSelectionSize(value) {
    if (currentWorkspaceLocked) {
        return;
    }
    const size = Math.max(150, Math.min(600, value));
    applySelectionSize(size);
    const { bookmarks, folders } = getSelectionElements();
    const bookmarkIds = new Set(bookmarks.map((element) => element.dataset.id));
    const folderIds = new Set(folders.map((element) => element.dataset.folderId));

    if (bookmarkIds.size === 0 && folderIds.size === 0) return;

    if (bookmarkIds.size > 0) {
        const allBookmarks = await StorageManager.getBookmarks();
        let updated = false;

        allBookmarks.forEach((bookmark) => {
            if (bookmarkIds.has(bookmark.id)) {
                const element = bookmarks.find((item) => item.dataset.id === bookmark.id);
                if (element) {
                    const box = getElementBox(element);
                    bookmark.x = box.x;
                    bookmark.y = box.y;
                }
                bookmark.width = size;
                bookmark.height = size;
                updated = true;
            }
        });

        if (updated) {
            await StorageManager.saveBookmarks(allBookmarks);
            if (bookmarkManager && bookmarkManager.allBookmarks) {
                bookmarkManager.allBookmarks.forEach((bookmark) => {
                    if (bookmarkIds.has(bookmark.id)) {
                        const element = bookmarks.find((item) => item.dataset.id === bookmark.id);
                        if (element) {
                            const box = getElementBox(element);
                            bookmark.x = box.x;
                            bookmark.y = box.y;
                        }
                        bookmark.width = size;
                        bookmark.height = size;
                    }
                });
            }
        }
    }

    if (folderIds.size > 0) {
        const allFolders = await StorageManager.getFolders();
        let updated = false;

        allFolders.forEach((folder) => {
            if (folderIds.has(folder.id)) {
                const element = folders.find((item) => item.dataset.folderId === folder.id);
                if (element) {
                    const box = getElementBox(element);
                    folder.x = box.x;
                    folder.y = box.y;
                }
                folder.width = size;
                folder.height = size;
                updated = true;
            }
        });

        if (updated) {
            await StorageManager.saveFolders(allFolders);
        }
    }
}

async function deleteSelectedItems() {
    if (currentWorkspaceLocked) {
        return;
    }
    const { bookmarks, folders } = getSelectionElements();
    const bookmarkIds = bookmarks.map((element) => element.dataset.id).filter(Boolean);
    const folderIds = folders.map((element) => element.dataset.folderId).filter(Boolean);

    if (bookmarkIds.length === 0 && folderIds.length === 0) return;

    if (!confirm(i18n('deleteSelectedConfirm'))) {
        return;
    }

    for (const bookmarkId of bookmarkIds) {
        await StorageManager.deleteBookmark(bookmarkId);
    }

    for (const folderId of folderIds) {
        await StorageManager.deleteFolder(folderId);
    }

    if (window.dragDropManager) {
        window.dragDropManager.clearSelection();
    }

    await refreshBookmarks();
}

function getSystemTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

async function applyWorkspaceBackground() {
    const currentWorkspace = await StorageManager.getCurrentWorkspace();
    const workspaceData = await StorageManager.getWorkspaceData(currentWorkspace);

    // Remove all preset background classes
    document.body.classList.remove(
        'bg-light-waves', 'bg-soft-gradient', 'bg-dark-space', 'bg-night-sky',
        'bg-aurora', 'bg-sunset', 'bg-ocean', 'bg-forest', 'bg-lavender', 'bg-midnight'
    );

    // Clear all inline background styles
    document.body.style.backgroundImage = '';
    document.body.style.backgroundSize = '';
    document.body.style.backgroundPosition = '';
    document.body.style.backgroundAttachment = '';
    document.body.style.backgroundRepeat = '';
    document.body.style.backgroundColor = '';
    removeVideoBackground();

    if (!workspaceData || !workspaceData.background) {
        // Default background
        document.body.style.backgroundColor = '#f5f5f5';
        return;
    }

    const bgType = workspaceData.background.type;

    if (bgType === 'preset') {
        const preset = workspaceData.background.preset;
        document.body.classList.add(`bg-${preset}`);
    } else if (bgType === 'custom') {
        const mediaType = workspaceData.background.mediaType || 'image';
        const mediaData = await StorageManager.getWorkspaceBackground(currentWorkspace);
        const isVideo = mediaType === 'video' || (mediaData && mediaData.startsWith('data:video'));
        if (mediaData && isVideo) {
            applyVideoBackground(mediaData);
            document.body.style.backgroundColor = 'transparent';
        } else if (mediaData) {
            document.body.style.backgroundImage = `url(${mediaData})`;
            document.body.style.backgroundSize = 'cover';
            document.body.style.backgroundPosition = 'center';
            document.body.style.backgroundAttachment = 'fixed';
            document.body.style.backgroundRepeat = 'no-repeat';
            document.body.style.backgroundColor = '#f5f5f5';
        } else {
            document.body.style.backgroundColor = '#f5f5f5';
        }
    }
}

function adjustColor(color, amount) {
    // Simple color adjustment
    const num = parseInt(color.replace('#', ''), 16);
    const r = Math.min(255, Math.max(0, (num >> 16) + amount));
    const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + amount));
    const b = Math.min(255, Math.max(0, (num & 0x0000FF) + amount));
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

async function loadFoldersIntoDropdown() {
    const select = document.getElementById('bookmarkFolder');
    const currentWorkspace = await StorageManager.getCurrentWorkspace();
    const folders = await StorageManager.getFoldersByWorkspace(currentWorkspace);

    select.innerHTML = `<option value="">${i18n('noFolder')}</option>`;

    folders.forEach(folder => {
        const option = document.createElement('option');
        option.value = folder.id;
        option.textContent = folder.name;
        select.appendChild(option);
    });
}

async function openAddBookmarkModal() {
    if (currentWorkspaceLocked) {
        return;
    }
    bookmarkManager.currentEditingId = null;

    // Clear form
    document.getElementById('modalTitle').textContent = chrome.i18n.getMessage('modalAddBookmark');
    document.getElementById('bookmarkTitle').value = '';
    document.getElementById('bookmarkUrl').value = '';
    document.getElementById('bookmarkSize').value = '200';
    document.querySelector(
        `input[name="displayType"][value="${PreviewPolicy.DEFAULT_BOOKMARK_DISPLAY_TYPE}"]`
    ).checked = true;
    document.getElementById('customImageGroup').style.display = 'none';
    document.getElementById('imagePreview').innerHTML = '';

    // Load folders into dropdown
    await loadFoldersIntoDropdown();

    // Show modal
    document.getElementById('bookmarkModal').classList.add('open');
}

// Open add bookmark modal with pre-selected folder
async function openAddBookmarkModalInFolder(folderId) {
    if (currentWorkspaceLocked) {
        return;
    }
    bookmarkManager.currentEditingId = null;

    // Clear form
    document.getElementById('modalTitle').textContent = chrome.i18n.getMessage('modalAddBookmark');
    document.getElementById('bookmarkTitle').value = '';
    document.getElementById('bookmarkUrl').value = '';
    document.getElementById('bookmarkSize').value = '200';
    document.querySelector(
        `input[name="displayType"][value="${PreviewPolicy.DEFAULT_BOOKMARK_DISPLAY_TYPE}"]`
    ).checked = true;
    document.getElementById('customImageGroup').style.display = 'none';
    document.getElementById('imagePreview').innerHTML = '';

    // Load folders into dropdown
    await loadFoldersIntoDropdown();

    // Pre-select the current folder
    const folderSelect = document.getElementById('bookmarkFolder');
    if (folderSelect && folderId) {
        folderSelect.value = folderId;
    }

    // Show modal
    document.getElementById('bookmarkModal').classList.add('open');
}

function closeBookmarkModal() {
    document.getElementById('bookmarkModal').classList.remove('open');
    bookmarkManager.currentEditingId = null;
}

async function saveBookmark() {
    if (currentWorkspaceLocked) {
        return;
    }
    const title = document.getElementById('bookmarkTitle').value.trim();
    const url = document.getElementById('bookmarkUrl').value.trim();
    const sizeValue = parseInt(document.getElementById('bookmarkSize').value);
    const displayType = document.querySelector('input[name="displayType"]:checked').value;
    const folderId = document.getElementById('bookmarkFolder').value;

    if (!title || !url) {
        alert(i18n('fillRequiredFields'));
        return;
    }

    // Validate URL
    try {
        new URL(url);
    } catch (e) {
        alert(i18n('invalidUrl'));
        return;
    }

    const bookmarkData = {
        title,
        url,
        width: sizeValue,
        height: sizeValue,
        displayType
    };

    // Add folder if selected
    if (folderId) {
        bookmarkData.folderId = folderId;
    } else if (!bookmarkManager.currentEditingId) {
        // Only set position for NEW bookmarks (not when editing existing ones)
        // Find free position for new bookmark on desktop
        const freePos = await findFreePosition(sizeValue, sizeValue);
        bookmarkData.x = freePos.x;
        bookmarkData.y = freePos.y;
    } else {
        // Editing existing bookmark - preserve current position from storage
        const currentBookmark = await StorageManager.getBookmarkById(bookmarkManager.currentEditingId);
        if (currentBookmark) {
            bookmarkData.x = currentBookmark.x;
            bookmarkData.y = currentBookmark.y;
            // Also preserve folderId if it was set
            if (currentBookmark.folderId) {
                bookmarkData.folderId = currentBookmark.folderId;
            }
        }
    }

    // Handle custom image
    if (displayType === 'custom') {
        const imageInput = document.getElementById('customImage');
        if (imageInput.files && imageInput.files[0]) {
            const reader = new FileReader();
            reader.onload = async (e) => {
                const imageData = e.target.result;

                if (bookmarkManager.currentEditingId) {
                    // Update existing
                    await StorageManager.saveCustomImage(bookmarkManager.currentEditingId, imageData);
                    await bookmarkManager.updateBookmark(bookmarkManager.currentEditingId, bookmarkData);
                } else {
                    // Add new
                    const bookmark = await bookmarkManager.addBookmark(bookmarkData);
                    await StorageManager.saveCustomImage(bookmark.id, imageData);
                }

                closeBookmarkModal();
                await refreshBookmarks();

                // If folder modal is open, refresh it
                const folderModal = document.getElementById('openFolderModal');
                if (folderModal && folderModal.classList.contains('open') && window.currentOpenFolder) {
                    await window.openFolderModal(window.currentOpenFolder);
                }
            };
            reader.readAsDataURL(imageInput.files[0]);
            return;
        }
    }

    if (bookmarkManager.currentEditingId) {
        // Update existing bookmark
        await bookmarkManager.updateBookmark(bookmarkManager.currentEditingId, bookmarkData);
    } else {
        // Add new bookmark
        await bookmarkManager.addBookmark(bookmarkData);
    }

    closeBookmarkModal();
    await refreshBookmarks();

    // If folder modal is open, refresh it to show updated bookmark
    const folderModal = document.getElementById('openFolderModal');
    if (folderModal && folderModal.classList.contains('open') && window.currentOpenFolder) {
        await window.openFolderModal(window.currentOpenFolder);
    }
}

function handleCustomImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        const preview = document.getElementById('imagePreview');
        preview.innerHTML = `<img src="${event.target.result}" style="max-width: 100%; max-height: 200px; margin-top: 10px; border-radius: 8px;">`;
    };
    reader.readAsDataURL(file);
}

// Find free position on desktop for new items
async function findFreePosition(width = 200, height = 200) {
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

async function refreshBookmarks() {
    await bookmarkManager.loadBookmarks();
    const container = document.getElementById('bookmarksGrid');
    await bookmarkManager.renderBookmarks(container);
    dragDropManager.enableDragDrop(container);
}

// Capture all screenshots
async function captureAllScreenshots() {
    const bookmarksToCapture = bookmarkManager.bookmarks.filter(b =>
        b.displayType === 'preview' || !b.displayType
    );

    if (bookmarksToCapture.length === 0) {
        alert(i18n('noPreviewBookmarks'));
        return;
    }

    const confirmMsg = i18n('captureScreenshotsConfirm', [bookmarksToCapture.length]);
    if (!confirm(confirmMsg)) return;

    // Show progress UI
    const progressDiv = document.getElementById('screenshotProgress');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    const progressCount = document.getElementById('progressCount');
    const captureBtn = document.getElementById('captureAllScreenshots');

    progressDiv.style.display = 'block';
    captureBtn.disabled = true;
    captureBtn.style.opacity = '0.5';

    let completed = 0;
    const total = bookmarksToCapture.length;

    try {
        // Capture screenshots one by one
        for (const bookmark of bookmarksToCapture) {
            progressText.textContent = i18n('captureProgress', [bookmark.title]);
            progressCount.textContent = `${completed}/${total}`;
            progressBar.style.width = `${(completed / total) * 100}%`;

            try {
                await StorageManager.captureScreenshot(bookmark.url, bookmark.id);
                completed++;
            } catch (error) {
                console.error(`Failed to capture ${bookmark.title}:`, error);
                // Continue with next bookmark
                completed++;
            }
        }

        progressText.textContent = i18n('progressComplete');
        progressCount.textContent = `${completed}/${total}`;
        progressBar.style.width = '100%';

        // Refresh bookmarks display
        setTimeout(async () => {
            await refreshBookmarks();
            progressDiv.style.display = 'none';
            captureBtn.disabled = false;
            captureBtn.style.opacity = '1';
        }, 1500);

    } catch (error) {
        console.error('Screenshot capture failed:', error);
        alert(i18n('captureScreenshotsFailedRetry'));
        progressDiv.style.display = 'none';
        captureBtn.disabled = false;
        captureBtn.style.opacity = '1';
    }
}

// Refresh all screenshots
async function refreshAllScreenshots() {
    const bookmarksToRefresh = bookmarkManager.bookmarks.filter(b =>
        b.displayType === 'preview' || !b.displayType
    );

    if (bookmarksToRefresh.length === 0) {
        alert(i18n('noPreviewBookmarks'));
        return;
    }

    const confirmMsg = i18n('refreshScreenshotsConfirm', [bookmarksToRefresh.length]);
    if (!confirm(confirmMsg)) return;

    // Show progress UI
    const progressDiv = document.getElementById('screenshotProgress');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    const progressCount = document.getElementById('progressCount');
    const refreshBtn = document.getElementById('refreshAllScreenshots');

    progressDiv.style.display = 'block';
    refreshBtn.disabled = true;
    refreshBtn.style.opacity = '0.5';

    let completed = 0;
    const total = bookmarksToRefresh.length;

    try {
        for (const bookmark of bookmarksToRefresh) {
            progressText.textContent = i18n('refreshProgress', [bookmark.title]);
            progressCount.textContent = `${completed}/${total}`;
            progressBar.style.width = `${(completed / total) * 100}%`;

            try {
                await StorageManager.refreshScreenshot(bookmark.id, bookmark.url);
                completed++;
            } catch (error) {
                console.error(`Failed to refresh ${bookmark.title}:`, error);
                completed++;
            }
        }

        progressText.textContent = i18n('progressComplete');
        progressCount.textContent = `${completed}/${total}`;
        progressBar.style.width = '100%';

        setTimeout(async () => {
            await refreshBookmarks();
            progressDiv.style.display = 'none';
            refreshBtn.disabled = false;
            refreshBtn.style.opacity = '1';
        }, 1500);

    } catch (error) {
        console.error('Screenshot refresh failed:', error);
        alert(i18n('refreshScreenshotsFailedRetry'));
        progressDiv.style.display = 'none';
        refreshBtn.disabled = false;
        refreshBtn.style.opacity = '1';
    }
}

// Render workspace switcher
async function renderWorkspaceSwitcher() {
    const workspaces = await StorageManager.getWorkspaces();
    const currentWorkspace = await StorageManager.getCurrentWorkspace();
    const tabsContainer = document.getElementById('workspaceTabs');

    tabsContainer.innerHTML = '';

    workspaces.forEach(workspace => {
        const tab = document.createElement('button');
        tab.className = 'workspace-tab';
        const isLocked = !!workspace.locked;
        if (workspace.id === currentWorkspace) {
            tab.classList.add('active');
        }
        if (isLocked) {
            tab.classList.add('locked');
        }
        tab.dataset.workspaceId = workspace.id;
        tab.draggable = true;

        const lockIcon = isLocked
            ? '<span class="material-icons workspace-lock" aria-hidden="true">lock</span>'
            : '';

        tab.innerHTML = `
            <span class="material-icons">${workspace.icon}</span>
            <span class="workspace-name">${workspace.name}</span>
            ${lockIcon}
        `;

        // Click to switch workspace
        tab.addEventListener('click', () => switchWorkspace(workspace.id));

        // Drag & drop for reordering
        tab.addEventListener('dragstart', handleWorkspaceTabDragStart);
        tab.addEventListener('dragend', handleWorkspaceTabDragEnd);
        tab.addEventListener('dragenter', handleWorkspaceTabDragEnter);
        tab.addEventListener('dragover', handleWorkspaceTabDragOver);

        // Right-click context menu
        tab.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showWorkspaceContextMenu(e, workspace.id);
        });

        tabsContainer.appendChild(tab);
    });
}

// Switch workspace
async function switchWorkspace(workspaceId) {
    await bookmarkManager.setCurrentWorkspace(workspaceId);

    // Update active tab
    document.querySelectorAll('.workspace-tab').forEach(tab => {
        if (tab.dataset.workspaceId === workspaceId) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });

    // Apply workspace background
    await applyWorkspaceBackground();
    await refreshWorkspaceLockState(workspaceId);

    // Re-render bookmarks
    await refreshBookmarks();
}

// Workspace management
let currentEditingWorkspace = null;
let draggedWorkspaceTab = null;

// Drag & drop for workspace tabs
function handleWorkspaceTabDragStart(e) {
    draggedWorkspaceTab = this;
    this.classList.add('dragging');
    document.body.classList.add('workspace-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', this.innerHTML);
}

function handleWorkspaceTabDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    return false;
}

function handleWorkspaceTabDragEnter(e) {
    const target = e.currentTarget;

    // Don't do anything if dragging over self
    if (draggedWorkspaceTab === target) {
        return;
    }

    // Get all tabs
    const allTabs = [...document.querySelectorAll('.workspace-tab')];
    const draggedIndex = allTabs.indexOf(draggedWorkspaceTab);
    const targetIndex = allTabs.indexOf(target);

    // Insert dragged tab before or after target
    if (draggedIndex < targetIndex) {
        // Dragging right - insert after target
        target.parentNode.insertBefore(draggedWorkspaceTab, target.nextSibling);
    } else {
        // Dragging left - insert before target
        target.parentNode.insertBefore(draggedWorkspaceTab, target);
    }
}

async function handleWorkspaceTabDragEnd(e) {
    this.classList.remove('dragging');
    document.body.classList.remove('workspace-dragging');

    // Get new order from DOM
    const tabs = document.querySelectorAll('.workspace-tab');
    const workspaces = await StorageManager.getWorkspaces();

    const newOrder = Array.from(tabs).map(tab => {
        const id = tab.dataset.workspaceId;
        return workspaces.find(w => w.id === id);
    });

    // Save new order
    await StorageManager.reorderWorkspaces(newOrder);

    draggedWorkspaceTab = null;
}

// Workspace context menu
let currentContextWorkspaceId = null;
let workspaceMenuJustOpened = false;

function setupWorkspaceContextMenu() {
    const workspaceContextMenu = document.getElementById('workspaceContextMenu');

    // Edit workspace
    document.getElementById('editWorkspaceContext').addEventListener('click', (e) => {
        e.stopPropagation();
        if (currentContextWorkspaceLocked) {
            return;
        }
        if (currentContextWorkspaceId) {
            editWorkspace(currentContextWorkspaceId);
            workspaceContextMenu.classList.remove('show');
            workspaceContextMenu.style.display = 'none';
        }
    });

    // Change background
    document.getElementById('changeBackgroundContext').addEventListener('click', (e) => {
        e.stopPropagation();
        if (currentContextWorkspaceLocked) {
            return;
        }
        if (currentContextWorkspaceId) {
            openWorkspaceBackgroundModal(currentContextWorkspaceId);
            workspaceContextMenu.classList.remove('show');
            workspaceContextMenu.style.display = 'none';
        }
    });

    // Toggle workspace lock
    document.getElementById('toggleWorkspaceLockContext').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (currentContextWorkspaceId) {
            await toggleWorkspaceLock(currentContextWorkspaceId);
            workspaceContextMenu.classList.remove('show');
            workspaceContextMenu.style.display = 'none';
        }
    });

    // Delete workspace
    document.getElementById('deleteWorkspaceContext').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (currentContextWorkspaceLocked) {
            return;
        }
        if (currentContextWorkspaceId) {
            await deleteWorkspace(currentContextWorkspaceId);
            workspaceContextMenu.classList.remove('show');
            workspaceContextMenu.style.display = 'none';
        }
    });
}

function setupFolderContextMenu() {
    const folderContextMenu = document.getElementById('folderContextMenu');

    // Rename folder
    document.getElementById('renameFolderContext').addEventListener('click', (e) => {
        e.stopPropagation();
        if (currentWorkspaceLocked) {
            return;
        }
        if (currentContextFolderId) {
            openEditFolderModal(currentContextFolderId);
            folderContextMenu.classList.remove('show');
            folderContextMenu.style.display = 'none';
        }
    });

    // Change folder color
    document.getElementById('changeFolderColorContext').addEventListener('click', (e) => {
        e.stopPropagation();
        if (currentWorkspaceLocked) {
            return;
        }
        if (currentContextFolderId) {
            openEditFolderModal(currentContextFolderId);
            folderContextMenu.classList.remove('show');
            folderContextMenu.style.display = 'none';
        }
    });

    // Change folder icon
    document.getElementById('changeFolderIconContext').addEventListener('click', (e) => {
        e.stopPropagation();
        if (currentWorkspaceLocked) {
            return;
        }
        if (currentContextFolderId) {
            openEditFolderModal(currentContextFolderId);
            folderContextMenu.classList.remove('show');
            folderContextMenu.style.display = 'none';
        }
    });

    // Move folder to workspace
    document.getElementById('moveFolderToWorkspace').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (currentWorkspaceLocked) {
            return;
        }
        if (currentContextFolderId) {
            await showWorkspaceSelectionModal('folder', currentContextFolderId);
            folderContextMenu.classList.remove('show');
            folderContextMenu.style.display = 'none';
        }
    });

    // Delete folder
    document.getElementById('deleteFolderContext').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (currentWorkspaceLocked) {
            return;
        }
        if (currentContextFolderId) {
            await deleteFolderHandler(currentContextFolderId);
            folderContextMenu.classList.remove('show');
            folderContextMenu.style.display = 'none';
        }
    });
}

// Setup edit folder modal handlers (one-time initialization)
function setupEditFolderModal() {
    // Close buttons
    document.getElementById('closeEditFolderModal').addEventListener('click', closeEditFolderModal);
    document.getElementById('cancelEditFolderModal').addEventListener('click', closeEditFolderModal);

    // Save button
    document.getElementById('saveEditFolder').addEventListener('click', saveEditFolder);

    // Edit folder color picker
    document.querySelectorAll('#editFolderColorPicker .color-option').forEach(option => {
        option.addEventListener('click', () => {
            document.querySelectorAll('#editFolderColorPicker .color-option').forEach(opt => opt.classList.remove('selected'));
            option.classList.add('selected');
        });
    });

    // Edit folder icon picker
    setupFolderIconPicker('#editFolderIconPicker', (icon) => {
        currentEditingFolderIcon = icon;
    });

    // Click outside to close edit folder modal
    document.getElementById('editFolderModal').addEventListener('click', (e) => {
        if (e.target.id === 'editFolderModal') {
            // Don't close if user is selecting text
            const selection = window.getSelection();
            if (selection && selection.toString().length > 0) {
                return;
            }
            closeEditFolderModal();
        }
    });
}

// Smart positioning for context menu to keep it within viewport
function positionContextMenu(menu, mouseX, mouseY) {
    // First, position at mouse to measure
    menu.style.left = mouseX + 'px';
    menu.style.top = mouseY + 'px';
    menu.style.display = 'block';

    const rect = menu.getBoundingClientRect();
    let finalX = mouseX;
    let finalY = mouseY;

    // Check if menu goes beyond right edge
    if (rect.right > window.innerWidth) {
        finalX = mouseX - rect.width;
    }

    // Check if menu goes beyond bottom edge
    if (rect.bottom > window.innerHeight) {
        finalY = mouseY - rect.height;
    }

    // Check if menu goes beyond left edge
    if (finalX < 0) {
        finalX = 10;
    }

    // Check if menu goes beyond top edge
    if (finalY < 0) {
        finalY = 10;
    }

    menu.style.left = finalX + 'px';
    menu.style.top = finalY + 'px';
}

async function updateWorkspaceContextHeader(workspaceId) {
    const workspaces = await StorageManager.getWorkspaces();
    const workspace = workspaces.find(w => w.id === workspaceId);
    const header = document.getElementById('workspaceContextHeader');

    if (workspace && header) {
        header.textContent = i18n('workspaceContextLabel', [workspace.name]);
    }
}

function showWorkspaceContextMenu(e, workspaceId) {
    // Close all other context menus first
    document.querySelectorAll('.context-menu').forEach(menu => {
        menu.classList.remove('show');
        menu.style.display = 'none';
    });

    const contextMenu = document.getElementById('workspaceContextMenu');
    currentContextWorkspaceId = workspaceId;

    // Update header with workspace name
    updateWorkspaceContextHeader(workspaceId);
    updateWorkspaceLockContextItem(workspaceId);

    // Smart positioning to keep menu within viewport
    workspaceMenuJustOpened = true;

    // Clear any inline display styles
    contextMenu.style.display = '';

    contextMenu.classList.add('show');
    positionContextMenu(contextMenu, e.clientX, e.clientY);

    // Reset flag after a short delay
    setTimeout(() => {
        workspaceMenuJustOpened = false;
    }, 100);
}

function openAddWorkspace() {
    currentEditingWorkspace = null;
    document.getElementById('editWorkspaceTitle').textContent = chrome.i18n.getMessage('addNewWorkspace');
    document.getElementById('workspaceName').value = '';

    // Select first icon
    document.querySelectorAll('.icon-option').forEach(btn => btn.classList.remove('selected'));
    document.querySelectorAll('.icon-option')[0].classList.add('selected');

    // Select Aurora background by default
    document.querySelectorAll('#workspaceBackgroundPicker .preset-bg-item').forEach(item => item.classList.remove('selected'));
    document.querySelector('#workspaceBackgroundPicker .preset-bg-item[data-preset="aurora"]').classList.add('selected');

    // Reset custom background preview
    resetWorkspaceCustomPreview();
    document.getElementById('workspaceCustomBackground').value = '';

    document.getElementById('editWorkspaceModal').classList.add('open');
}

async function editWorkspace(workspaceId) {
    if (await getWorkspaceLockState(workspaceId)) {
        return;
    }
    const workspaces = await StorageManager.getWorkspaces();
    const workspace = workspaces.find(w => w.id === workspaceId);
    if (!workspace) return;

    currentEditingWorkspace = workspace;
    document.getElementById('editWorkspaceTitle').textContent = chrome.i18n.getMessage('editWorkspace');
    document.getElementById('workspaceName').value = workspace.name;

    document.querySelectorAll('.icon-option').forEach(btn => {
        btn.classList.remove('selected');
        if (btn.dataset.icon === workspace.icon) {
            btn.classList.add('selected');
        }
    });

    document.getElementById('editWorkspaceModal').classList.add('open');
}

async function deleteWorkspace(workspaceId) {
    if (await getWorkspaceLockState(workspaceId)) {
        return;
    }
    const workspaces = await StorageManager.getWorkspaces();
    const workspace = workspaces.find(w => w.id === workspaceId);
    if (!workspace) return;

    if (workspaces.length <= 1) {
        alert(i18n('cannotDeleteLastWorkspace'));
        return;
    }

    if (!confirm(i18n('deleteWorkspaceConfirm', [workspace.name]))) {
        return;
    }

    await StorageManager.deleteWorkspace(workspaceId);
    await renderWorkspaceSwitcher();
    await refreshWorkspaceLockState();

    // Reload bookmarks if current workspace was deleted
    const currentWorkspace = await StorageManager.getCurrentWorkspace();
    if (bookmarkManager.currentWorkspace !== currentWorkspace) {
        await bookmarkManager.setCurrentWorkspace(currentWorkspace);
        await refreshWorkspaceLockState(currentWorkspace);
        await refreshBookmarks();
    }
}

function closeEditWorkspace() {
    document.getElementById('editWorkspaceModal').classList.remove('open');
    currentEditingWorkspace = null;
}

async function saveWorkspaceChanges() {
    const name = document.getElementById('workspaceName').value.trim();
    const selectedIcon = document.querySelector('.icon-option.selected');
    const selectedBackground = document.querySelector('#workspaceBackgroundPicker .preset-bg-item.selected');

    if (currentEditingWorkspace && await getWorkspaceLockState(currentEditingWorkspace.id)) {
        return;
    }

    if (!name) {
        alert(i18n('enterWorkspaceName'));
        return;
    }

    if (!selectedIcon) {
        alert(i18n('selectWorkspaceIcon'));
        return;
    }

    const icon = selectedIcon.dataset.icon;
    const backgroundPreset = selectedBackground ? selectedBackground.dataset.preset : 'aurora';

    // Declare these variables outside to make them accessible in finally block
    let workspaceIdChanged = false;
    let wasCurrentWorkspace = false;
    let updatedWorkspace = null;

    if (currentEditingWorkspace) {
        // Update existing workspace
        try {
            updatedWorkspace = await StorageManager.updateWorkspace(currentEditingWorkspace.id, { name, icon });
        } catch (error) {
            console.error('❌ Failed to update workspace:', error);
            alert(i18n('updateWorkspaceFailed', [error.message]));
            return;
        }

        // CRITICAL FIX: If workspace ID changed (due to rename), update UI
        workspaceIdChanged = updatedWorkspace && updatedWorkspace.id !== currentEditingWorkspace.id;
        wasCurrentWorkspace = bookmarkManager.currentWorkspace === currentEditingWorkspace.id;

        // Update background for existing workspace
        // CRITICAL: Use NEW workspace ID (in case it was renamed)
        const workspaceIdToUse = updatedWorkspace.id;

        if (backgroundPreset === 'custom') {
            // Get custom background image
            const fileInput = document.getElementById('workspaceCustomBackground');
            if (fileInput.files && fileInput.files[0]) {
                const file = fileInput.files[0];
                if (file.size > MAX_BACKGROUND_MEDIA_BYTES) {
                    alert(i18n('backgroundMediaTooLarge'));
                    return;
                }

                const mediaType = getBackgroundMediaType(file);
                if (!mediaType) {
                    alert(i18n('backgroundMediaUnsupported'));
                    return;
                }

                const reader = new FileReader();
                reader.onload = async (e) => {
                    try {
                        await StorageManager.updateWorkspaceBackground(workspaceIdToUse, {
                            type: 'custom',
                            mediaType
                        });
                        await StorageManager.saveWorkspaceBackground(workspaceIdToUse, e.target.result);

                        // Apply background if this is current workspace
                        const currentWorkspace = await StorageManager.getCurrentWorkspace();
                        if (currentWorkspace === workspaceIdToUse) {
                            await applyWorkspaceBackground();
                        }

                        await renderWorkspaceSwitcher();

                        // Switch to new ID if workspace was renamed and current
                        if (workspaceIdChanged && wasCurrentWorkspace) {
                            await switchWorkspace(updatedWorkspace.id);
                        } else {
                            await refreshBookmarks();
                        }

                        closeEditWorkspace();
                    } catch (error) {
                        console.error('❌ Failed to save workspace background:', error);
                        alert(i18n('backgroundMediaFailed'));
                        closeEditWorkspace();
                    }
                };
                reader.onerror = () => {
                    console.error('❌ Failed to read workspace background');
                    alert(i18n('backgroundMediaFailed'));
                    closeEditWorkspace();
                };
                reader.readAsDataURL(file);
                return; // Exit early, will close modal in reader.onload
            }
        } else {
            try {
                await StorageManager.updateWorkspaceBackground(workspaceIdToUse, {
                    type: 'preset',
                    preset: backgroundPreset
                });

                // Apply background if this is current workspace
                const currentWorkspace = await StorageManager.getCurrentWorkspace();
                if (currentWorkspace === workspaceIdToUse) {
                    await applyWorkspaceBackground();
                }
            } catch (error) {
                console.error('❌ Failed to update workspace background:', error);
                // Don't block closing, just log error
            }
        }
    } else {
        // Add new workspace
        const newWorkspace = await StorageManager.addWorkspace({ name, icon });

        // Set background for new workspace
        if (backgroundPreset === 'custom') {
            // Get custom background image
            const fileInput = document.getElementById('workspaceCustomBackground');
            if (fileInput.files && fileInput.files[0]) {
                const file = fileInput.files[0];
                if (file.size > MAX_BACKGROUND_MEDIA_BYTES) {
                    alert(i18n('backgroundMediaTooLarge'));
                    return;
                }

                const mediaType = getBackgroundMediaType(file);
                if (!mediaType) {
                    alert(i18n('backgroundMediaUnsupported'));
                    return;
                }

                const reader = new FileReader();
                reader.onload = async (e) => {
                    try {
                        await StorageManager.updateWorkspaceBackground(newWorkspace.id, {
                            type: 'custom',
                            mediaType
                        });
                        await StorageManager.saveWorkspaceBackground(newWorkspace.id, e.target.result);
                        await renderWorkspaceSwitcher();
                        await switchWorkspace(newWorkspace.id);
                        closeEditWorkspace();
                    } catch (error) {
                        console.error('❌ Failed to save workspace background:', error);
                        alert(i18n('backgroundMediaFailed'));
                        closeEditWorkspace();
                    }
                };
                reader.onerror = () => {
                    console.error('❌ Failed to read workspace background');
                    alert(i18n('backgroundMediaFailed'));
                    closeEditWorkspace();
                };
                reader.readAsDataURL(file);
                return; // Exit early, will close modal in reader.onload
            }
        } else {
            await StorageManager.updateWorkspaceBackground(newWorkspace.id, {
                type: 'preset',
                preset: backgroundPreset
            });
        }

        // Switch to new workspace
        await renderWorkspaceSwitcher();
        await switchWorkspace(newWorkspace.id);
        closeEditWorkspace();
        return;
    }

    try {
        await renderWorkspaceSwitcher();

        // CRITICAL FIX: If workspace was renamed and it was current workspace, switch to new ID
        if (currentEditingWorkspace && workspaceIdChanged && wasCurrentWorkspace) {
            console.log('🔄 Workspace ID changed, switching to new ID:', updatedWorkspace.id);
            await switchWorkspace(updatedWorkspace.id);
        } else {
            // Just refresh bookmarks if it wasn't current workspace
            await refreshBookmarks();
        }
    } catch (error) {
        console.error('❌ Error during workspace save finalization:', error);
        // Don't show alert, just log - workspace was already saved successfully
    } finally {
        // ALWAYS close modal, even if there were errors
        closeEditWorkspace();
    }
}

// Listen for system theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (currentSettings.theme === 'auto') {
        applyTheme('auto');
    }
});

// ========== FOLDERS & COLORS ==========
let currentEditingFolder = null;
let selectedFolderColor = 'default';
let selectedFolderIcon = null;
let currentBookmarkForColor = null;
let selectedBookmarkColor = 'none';
let currentOpenFolder = null;
let currentEditingFolderIcon = null;

// Open folder modal to show bookmarks inside
async function openFolderModal(folderId) {
    currentOpenFolder = folderId;
    window.currentOpenFolder = folderId; // Make it globally accessible
    const folders = await StorageManager.getFolders();
    const folder = folders.find(f => f.id === folderId);

    if (!folder) return;

    // Set folder title
    document.getElementById('openFolderTitle').textContent = folder.name;

    // Get bookmarks in this folder
    const allBookmarks = await StorageManager.getBookmarks();
    const folderBookmarks = allBookmarks.filter(b => b.folderId === folderId);

    // Render bookmarks
    const grid = document.getElementById('folderBookmarksGrid');
    grid.innerHTML = '';

    if (folderBookmarks.length === 0) {
        grid.innerHTML = `<p style="text-align: center; color: var(--text-secondary); padding: 40px;">${i18n('noBookmarksInFolder')}</p>`;
    } else {
        folderBookmarks.forEach(bookmark => {
            const card = bookmarkManager.createBookmarkCard(bookmark);
            grid.appendChild(card);
        });

        // Enable drag & drop for bookmarks inside folder
        dragDropManager.enableDragDrop(grid);
    }

    document.getElementById('openFolderModal').classList.add('open');
}

// Make openFolderModal globally accessible for bookmarks.js
window.openFolderModal = openFolderModal;

// Setup folder modal close handlers (run once on init)
function setupFolderModalCloseHandlers() {
    document.getElementById('closeOpenFolderModal').addEventListener('click', closeFolderModal);
    document.getElementById('openFolderModal').addEventListener('click', (e) => {
        if (e.target.id === 'openFolderModal') {
            // Don't close if user is selecting text
            const selection = window.getSelection();
            if (selection && selection.toString().length > 0) {
                return;
            }
            closeFolderModal();
        }
    });

    // Add bookmark to current folder button
    document.getElementById('addBookmarkToFolderBtn').addEventListener('click', async () => {
        if (currentWorkspaceLocked) {
            return;
        }
        await openAddBookmarkModalInFolder(currentOpenFolder);
    });
}

// Call on init
setTimeout(() => {
    if (document.getElementById('closeOpenFolderModal')) {
        setupFolderModalCloseHandlers();
    }
}, 100);

function closeFolderModal() {
    document.getElementById('openFolderModal').classList.remove('open');
    currentOpenFolder = null;
    window.currentOpenFolder = null;
}

// Folder context menu
let currentContextFolderId = null;
let folderMenuJustOpened = false;

function showFolderContextMenu(e, folderId) {
    if (currentWorkspaceLocked) {
        return;
    }
    // Close all other context menus first
    document.querySelectorAll('.context-menu').forEach(menu => {
        menu.classList.remove('show');
        menu.style.display = 'none';
    });

    const contextMenu = document.getElementById('folderContextMenu');
    currentContextFolderId = folderId;

    // Update header with folder name
    updateFolderContextHeader(folderId);

    // Smart positioning to keep menu within viewport
    folderMenuJustOpened = true;

    // Clear any inline display styles
    contextMenu.style.display = '';

    contextMenu.classList.add('show');
    positionContextMenu(contextMenu, e.clientX, e.clientY);

    // Reset flag after a short delay
    setTimeout(() => {
        folderMenuJustOpened = false;
    }, 100);
}

async function updateFolderContextHeader(folderId) {
    const folders = await StorageManager.getFolders();
    const folder = folders.find(f => f.id === folderId);
    const header = document.getElementById('folderContextHeader');

    if (folder && header) {
        header.textContent = i18n('folderContextLabel', [folder.name]);
    }
}

// Edit folder modal
let currentEditingFolderId = null;

async function openEditFolderModal(folderId) {
    if (currentWorkspaceLocked) {
        return;
    }
    currentEditingFolderId = folderId;

    const folders = await StorageManager.getFolders();
    const folder = folders.find(f => f.id === folderId);

    if (!folder) return;

    document.getElementById('editFolderModalTitle').textContent = chrome.i18n.getMessage('editFolder');
    document.getElementById('editFolderName').value = folder.name;

    // Set color selection
    document.querySelectorAll('#editFolderColorPicker .color-option').forEach(opt => {
        opt.classList.remove('selected');
        if (opt.dataset.color === (folder.color || 'default')) {
            opt.classList.add('selected');
        }
    });

    // Set icon selection
    currentEditingFolderIcon = folder.icon || null;
    setIconPickerSelection('#editFolderIconPicker', currentEditingFolderIcon);

    document.getElementById('editFolderModal').classList.add('open');
}

function closeEditFolderModal() {
    document.getElementById('editFolderModal').classList.remove('open');
    currentEditingFolderId = null;
    currentEditingFolderIcon = null;
}

async function saveEditFolder() {
    if (currentWorkspaceLocked) {
        return;
    }
    if (!currentEditingFolderId) return;

    const name = document.getElementById('editFolderName').value.trim();
    const selectedColor = document.querySelector('#editFolderColorPicker .color-option.selected');
    const color = selectedColor ? selectedColor.dataset.color : 'default';
    const icon = currentEditingFolderIcon;

    if (!name) {
        alert(i18n('enterFolderName'));
        return;
    }

    await StorageManager.updateFolder(currentEditingFolderId, {
        name,
        color,
        icon
    });

    closeEditFolderModal();
    await refreshBookmarks();
}

async function deleteFolderHandler(folderId) {
    if (currentWorkspaceLocked) {
        return;
    }
    if (!confirm(i18n('deleteFolderConfirm'))) {
        return;
    }

    await StorageManager.deleteFolder(folderId);
    await refreshBookmarks();
}

// Open folder modal
function openAddFolderModal() {
    if (currentWorkspaceLocked) {
        return;
    }
    currentEditingFolder = null;
    document.getElementById('folderModalTitle').textContent = chrome.i18n.getMessage('createFolder');
    document.getElementById('folderName').value = '';

    // Reset color selection
    document.querySelectorAll('.color-option').forEach(opt => opt.classList.remove('selected'));
    document.querySelector('.color-option[data-color="default"]').classList.add('selected');
    selectedFolderColor = 'default';

    // Setup listeners
    setupFolderModalListeners();

    document.getElementById('folderModal').classList.add('open');
}

function setupFolderModalListeners() {
    // Remove existing listeners to prevent duplicates
    const closeFolderModalBtn = document.getElementById('closeFolderModal');
    const cancelFolderModalBtn = document.getElementById('cancelFolderModal');
    const saveFolderBtn = document.getElementById('saveFolder');
    const folderModal = document.getElementById('folderModal');

    // Clone and replace to remove old listeners
    const closeFolderModalNew = closeFolderModalBtn.cloneNode(true);
    const cancelFolderModalNew = cancelFolderModalBtn.cloneNode(true);
    const saveFolderNew = saveFolderBtn.cloneNode(true);

    closeFolderModalBtn.parentNode.replaceChild(closeFolderModalNew, closeFolderModalBtn);
    cancelFolderModalBtn.parentNode.replaceChild(cancelFolderModalNew, cancelFolderModalBtn);
    saveFolderBtn.parentNode.replaceChild(saveFolderNew, saveFolderBtn);

    // Color selection
    document.querySelectorAll('.color-option').forEach(option => {
        // Remove old listeners by cloning
        const newOption = option.cloneNode(true);
        option.parentNode.replaceChild(newOption, option);

        newOption.addEventListener('click', () => {
            document.querySelectorAll('.color-option').forEach(opt => opt.classList.remove('selected'));
            newOption.classList.add('selected');
            selectedFolderColor = newOption.dataset.color;
        });
    });

    // Icon selection
    setupFolderIconPicker('#folderIconPicker', (icon) => {
        selectedFolderIcon = icon;
    });

    // Close buttons
    document.getElementById('closeFolderModal').addEventListener('click', closeAddFolderModal);
    document.getElementById('cancelFolderModal').addEventListener('click', closeAddFolderModal);

    // Save button
    document.getElementById('saveFolder').addEventListener('click', saveFolderHandler);

    // Click outside to close (use once to prevent duplicates)
    folderModal.addEventListener('click', (e) => {
        if (e.target.id === 'folderModal') {
            // Don't close if user is selecting text
            const selection = window.getSelection();
            if (selection && selection.toString().length > 0) {
                return;
            }
            closeAddFolderModal();
        }
    }, { once: true });
}

function setupFolderIconPicker(selector, onChange) {
    const picker = document.querySelector(selector);
    if (!picker) return;

    picker.querySelectorAll('.icon-option').forEach(option => {
        const newOption = option.cloneNode(true);
        const iconValue = newOption.dataset.icon;

        newOption.addEventListener('click', () => {
            picker.querySelectorAll('.icon-option').forEach(opt => opt.classList.remove('selected'));
            newOption.classList.add('selected');
            onChange(iconValue === 'none' ? null : iconValue);
        });

        option.parentNode.replaceChild(newOption, option);

        // Preserve initial selection state and notify consumer
        if (newOption.classList.contains('selected')) {
            onChange(iconValue === 'none' ? null : iconValue);
        }
    });
}

function setIconPickerSelection(selector, iconValue) {
    const picker = document.querySelector(selector);
    if (!picker) return;

    let applied = false;
    picker.querySelectorAll('.icon-option').forEach(option => {
        const optionValue = option.dataset.icon === 'none' ? null : option.dataset.icon;
        if (optionValue === iconValue) {
            option.classList.add('selected');
            applied = true;
        } else {
            option.classList.remove('selected');
        }
    });

    // Default to "none" if nothing matched
    if (!applied) {
        const noneOption = picker.querySelector('.icon-option[data-icon=\"none\"]');
        if (noneOption) {
            picker.querySelectorAll('.icon-option').forEach(opt => opt.classList.remove('selected'));
            noneOption.classList.add('selected');
        }
    }
}

function closeAddFolderModal() {
    document.getElementById('folderModal').classList.remove('open');
    currentEditingFolder = null;
}

async function saveFolderHandler() {
    if (currentWorkspaceLocked) {
        return;
    }
    const name = document.getElementById('folderName').value.trim();

    if (!name) {
        alert(i18n('enterFolderName'));
        return;
    }

    const currentWorkspace = await StorageManager.getCurrentWorkspace();

    // Find free position for new folder
    const freePos = await findFreePosition(200, 200);

    const folderData = {
        id: 'folder-' + Date.now(),
        name: name,
        color: selectedFolderColor,
        icon: selectedFolderIcon,
        workspace: currentWorkspace,
        collapsed: false,
        x: freePos.x,
        y: freePos.y
    };

    await StorageManager.addFolder(folderData);
    closeAddFolderModal();
    await refreshBookmarks();
}

// Bookmark color modal
function openBookmarkColorModal(bookmarkId) {
    if (currentWorkspaceLocked) {
        return;
    }
    currentBookmarkForColor = bookmarkId;

    // Get current color
    const bookmarks = bookmarkManager.bookmarks;
    const bookmark = bookmarks.find(b => b.id === bookmarkId);
    selectedBookmarkColor = bookmark?.color || 'none';

    // Highlight selected color
    document.querySelectorAll('.bookmark-color-option').forEach(opt => {
        opt.classList.remove('selected');
        if (opt.dataset.color === selectedBookmarkColor) {
            opt.classList.add('selected');
        }
    });

    setupBookmarkColorModalListeners();
    document.getElementById('bookmarkColorModal').classList.add('open');
}

function setupBookmarkColorModalListeners() {
    // Color selection
    document.querySelectorAll('.bookmark-color-option').forEach(option => {
        option.addEventListener('click', () => {
            document.querySelectorAll('.bookmark-color-option').forEach(opt => {
                opt.classList.remove('selected');
            });
            option.classList.add('selected');
            selectedBookmarkColor = option.dataset.color;
        });
    });

    // Close buttons
    document.getElementById('closeColorModal').addEventListener('click', closeBookmarkColorModal);
    document.getElementById('cancelColorModal').addEventListener('click', closeBookmarkColorModal);

    // Save button
    document.getElementById('saveBookmarkColor').addEventListener('click', saveBookmarkColorHandler);

    // Click outside to close
    document.getElementById('bookmarkColorModal').addEventListener('click', (e) => {
        if (e.target.id === 'bookmarkColorModal') {
            // Don't close if user is selecting text
            const selection = window.getSelection();
            if (selection && selection.toString().length > 0) {
                return;
            }
            closeBookmarkColorModal();
        }
    });
}

function closeBookmarkColorModal() {
    document.getElementById('bookmarkColorModal').classList.remove('open');
    currentBookmarkForColor = null;
}

async function saveBookmarkColorHandler() {
    if (currentWorkspaceLocked) {
        return;
    }
    if (!currentBookmarkForColor) return;

    // Get current card element and save position
    const card = document.querySelector(`.bookmark-card[data-id="${currentBookmarkForColor}"]`);
    if (card && card.style.left && card.style.top) {
        const currentX = parseInt(card.style.left) || 50;
        const currentY = parseInt(card.style.top) || 50;
        await bookmarkManager.updateBookmarkPosition(currentBookmarkForColor, currentX, currentY);
    }

    // Update bookmark color
    await bookmarkManager.updateBookmark(currentBookmarkForColor, {
        color: selectedBookmarkColor === 'none' ? null : selectedBookmarkColor
    });

    closeBookmarkColorModal();
    await refreshBookmarks();

    // If folder modal is open, refresh it to show updated color
    const folderModal = document.getElementById('openFolderModal');
    if (folderModal && folderModal.classList.contains('open') && window.currentOpenFolder) {
        await window.openFolderModal(window.currentOpenFolder);
    }
}

// ========== MOVE TO WORKSPACE MODAL ==========
let currentMoveItemType = null; // 'bookmark' or 'folder'
let currentMoveItemId = null;

async function showWorkspaceSelectionModal(type, itemId) {
    if (currentWorkspaceLocked) {
        return;
    }
    currentMoveItemType = type;
    currentMoveItemId = itemId;

    const modal = document.getElementById('moveToWorkspaceModal');
    const workspaceList = document.getElementById('workspaceSelectionList');

    // Clear existing list
    workspaceList.innerHTML = '';

    // Get all workspaces
    const workspaces = await StorageManager.getWorkspaces();
    const currentWorkspace = await StorageManager.getCurrentWorkspace();

    // Create workspace selection items
    workspaces.forEach(workspace => {
        // Don't show current workspace
        if (workspace.id === currentWorkspace || workspace.locked) {
            return;
        }

        const item = document.createElement('div');
        item.className = 'workspace-selection-item';
        item.dataset.workspaceId = workspace.id;

        const icon = document.createElement('span');
        icon.className = 'material-icons';
        icon.textContent = 'work';

        const name = document.createElement('span');
        name.textContent = workspace.name;

        item.appendChild(icon);
        item.appendChild(name);

        // Add click handler
        item.addEventListener('click', async () => {
            await moveItemToWorkspace(workspace.id);
        });

        workspaceList.appendChild(item);
    });

    setupMoveToWorkspaceModalListeners();
    modal.classList.add('open');
}

function setupMoveToWorkspaceModalListeners() {
    // Close buttons
    const closeBtn = document.getElementById('closeMoveToWorkspaceModal');
    const cancelBtn = document.getElementById('cancelMoveToWorkspace');

    closeBtn.addEventListener('click', closeMoveToWorkspaceModal);
    cancelBtn.addEventListener('click', closeMoveToWorkspaceModal);

    // Click outside to close
    const modal = document.getElementById('moveToWorkspaceModal');
    modal.addEventListener('click', (e) => {
        if (e.target.id === 'moveToWorkspaceModal') {
            // Don't close if user is selecting text
            const selection = window.getSelection();
            if (selection && selection.toString().length > 0) {
                return;
            }
            closeMoveToWorkspaceModal();
        }
    });
}

function closeMoveToWorkspaceModal() {
    document.getElementById('moveToWorkspaceModal').classList.remove('open');
    currentMoveItemType = null;
    currentMoveItemId = null;
}

async function moveItemToWorkspace(targetWorkspaceId) {
    if (currentWorkspaceLocked) {
        return;
    }
    if (!currentMoveItemId || !currentMoveItemType) return;
    if (await getWorkspaceLockState(targetWorkspaceId)) {
        return;
    }

    try {
        if (currentMoveItemType === 'bookmark') {
            // Move bookmark to target workspace
            await bookmarkManager.updateBookmark(currentMoveItemId, {
                workspace: targetWorkspaceId
            });
        } else if (currentMoveItemType === 'folder') {
            // Move folder to target workspace
            const folders = await StorageManager.getFolders();
            const folder = folders.find(f => f.id === currentMoveItemId);

            if (folder) {
                folder.workspace = targetWorkspaceId;
                await StorageManager.saveFolders(folders);

                // Also move all bookmarks in this folder to the target workspace
                const bookmarksInFolder = bookmarkManager.allBookmarks.filter(b => b.folderId === currentMoveItemId);
                for (const bookmark of bookmarksInFolder) {
                    await bookmarkManager.updateBookmark(bookmark.id, {
                        workspace: targetWorkspaceId
                    });
                }
            }
        }

        closeMoveToWorkspaceModal();
        await refreshBookmarks();
    } catch (error) {
        console.error('Error moving item to workspace:', error);
    }
}

// ========== WORKSPACE BACKGROUND MODAL ==========
let currentBackgroundWorkspaceId = null;
let selectedBackgroundType = 'preset';
let selectedPreset = null;
let selectedCustomMedia = null;
let selectedCustomMediaType = 'image';

function applyVideoBackground(videoDataUrl) {
    if (!videoDataUrl) {
        removeVideoBackground();
        return;
    }

    let video = document.getElementById('workspaceBackgroundVideo');
    if (!video) {
        video = document.createElement('video');
        video.id = 'workspaceBackgroundVideo';
        video.className = 'workspace-bg-video';
        video.autoplay = true;
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.setAttribute('aria-hidden', 'true');
        document.body.prepend(video);
    }

    if (video.src !== videoDataUrl) {
        video.src = videoDataUrl;
    }

    document.body.classList.add('has-video-background');
    video.play().catch(() => {});
}

function removeVideoBackground() {
    const existing = document.getElementById('workspaceBackgroundVideo');
    if (existing) {
        existing.pause();
        existing.removeAttribute('src');
        existing.load();
        existing.remove();
    }
    document.body.classList.remove('has-video-background');
}

function getBackgroundMediaType(file) {
    if (!file) return null;
    const name = file.name ? file.name.toLowerCase() : '';
    if (file.type === 'video/webm' || name.endsWith('.webm')) return 'video';
    if (file.type && file.type.startsWith('image/')) return 'image';
    return null;
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

function resetWorkspaceCustomPreview() {
    const customPreview = document.querySelector('.custom-bg-preview');
    if (!customPreview) return;
    customPreview.style.backgroundImage = '';
    const existingVideo = customPreview.querySelector('video');
    if (existingVideo) {
        existingVideo.remove();
    }
    const icon = customPreview.querySelector('.material-icons');
    if (icon) {
        icon.style.display = 'flex';
    }
}

function updateWorkspaceCustomPreview(mediaType, dataUrl) {
    const customPreview = document.querySelector('.custom-bg-preview');
    if (!customPreview) return;
    customPreview.style.backgroundImage = '';
    const existingVideo = customPreview.querySelector('video');
    if (existingVideo) {
        existingVideo.remove();
    }
    const icon = customPreview.querySelector('.material-icons');
    if (icon) {
        icon.style.display = 'none';
    }

    if (mediaType === 'video') {
        const video = document.createElement('video');
        video.src = dataUrl;
        video.muted = true;
        video.loop = true;
        video.autoplay = true;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.objectFit = 'cover';
        customPreview.appendChild(video);
        return;
    }

    customPreview.style.backgroundImage = `url(${dataUrl})`;
}

// Compress image before saving
function compressImage(file, maxWidth = 1920, maxHeight = 1080, quality = 0.85) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            const img = new Image();

            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                // Calculate new dimensions
                if (width > maxWidth || height > maxHeight) {
                    const ratio = Math.min(maxWidth / width, maxHeight / height);
                    width = width * ratio;
                    height = height * ratio;
                }

                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // Convert to JPEG with quality
                const compressedData = canvas.toDataURL('image/jpeg', quality);
                resolve(compressedData);
            };

            img.onerror = reject;
            img.src = e.target.result;
        };

        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function openWorkspaceBackgroundModal(workspaceId) {
    if (await getWorkspaceLockState(workspaceId)) {
        return;
    }
    currentBackgroundWorkspaceId = workspaceId;
    const modal = document.getElementById('workspaceBackgroundModal');
    const workspaceData = await StorageManager.getWorkspaceData(workspaceId);

    // Load current background
    if (workspaceData && workspaceData.background) {
        selectedBackgroundType = workspaceData.background.type || 'preset';
        if (workspaceData.background.type === 'preset') {
            selectedPreset = workspaceData.background.preset;
        }
        if (workspaceData.background.type === 'custom') {
            selectedCustomMediaType = workspaceData.background.mediaType || 'image';
        }
    } else {
        selectedBackgroundType = 'preset';
        selectedPreset = null;
    }

    // Set active tab
    document.querySelectorAll('.bg-tab').forEach(tab => {
        tab.classList.remove('active');
        if (tab.dataset.tab === selectedBackgroundType + 's') {
            tab.classList.add('active');
        }
    });

    // Show correct tab content
    if (selectedBackgroundType === 'preset') {
        document.getElementById('presetsTab').style.display = 'block';
        document.getElementById('customTab').style.display = 'none';
    } else {
        document.getElementById('presetsTab').style.display = 'none';
        document.getElementById('customTab').style.display = 'block';
    }

    // Highlight selected preset
    document.querySelectorAll('#presetsTab .preset-bg-item').forEach(item => {
        item.classList.remove('selected');
        if (selectedPreset && item.dataset.preset === selectedPreset) {
            item.classList.add('selected');
        }
    });

    // Load custom media preview if exists
    if (selectedBackgroundType === 'custom') {
        const mediaData = await StorageManager.getWorkspaceBackground(workspaceId);
        if (mediaData) {
            const preview = document.getElementById('workspaceBackgroundPreview');
            selectedCustomMedia = mediaData;
            if (selectedCustomMediaType === 'video' || mediaData.startsWith('data:video')) {
                selectedCustomMediaType = 'video';
                preview.innerHTML = `<video src="${mediaData}" muted autoplay loop playsinline></video>`;
            } else {
                selectedCustomMediaType = 'image';
                preview.innerHTML = `<img src="${mediaData}" alt="Background">`;
            }
            document.getElementById('removeWorkspaceBackground').style.display = 'block';
        }
    }

    // Setup event listeners
    setupBackgroundModalListeners();

    modal.classList.add('open');
}

function setupBackgroundModalListeners() {
    // Tab switching - remove old listeners by cloning
    document.querySelectorAll('.bg-tab').forEach(tab => {
        const newTab = tab.cloneNode(true);
        tab.parentNode.replaceChild(newTab, tab);

        newTab.addEventListener('click', (e) => {
            const tabName = newTab.dataset.tab;

            document.querySelectorAll('.bg-tab').forEach(t => t.classList.remove('active'));
            newTab.classList.add('active');

            if (tabName === 'presets') {
                document.getElementById('presetsTab').style.display = 'block';
                document.getElementById('customTab').style.display = 'none';
                selectedBackgroundType = 'preset';
            } else {
                document.getElementById('presetsTab').style.display = 'none';
                document.getElementById('customTab').style.display = 'block';
                selectedBackgroundType = 'custom';
            }
        });
    });

    // Preset selection - remove old listeners by cloning
    document.querySelectorAll('#presetsTab .preset-bg-item').forEach(item => {
        const newItem = item.cloneNode(true);
        item.parentNode.replaceChild(newItem, item);

        newItem.addEventListener('click', () => {
            document.querySelectorAll('#presetsTab .preset-bg-item').forEach(i => {
                i.classList.remove('selected');
            });
            newItem.classList.add('selected');
            selectedPreset = newItem.dataset.preset;
            selectedBackgroundType = 'preset';
        });
    });

    // Upload button - clone to remove old listeners
    const uploadBtn = document.getElementById('uploadBackgroundBtn');
    const newUploadBtn = uploadBtn.cloneNode(true);
    uploadBtn.parentNode.replaceChild(newUploadBtn, uploadBtn);
    newUploadBtn.addEventListener('click', () => {
        document.getElementById('workspaceBackgroundUpload').click();
    });

    // File upload - clone to remove old listeners
    const fileInput = document.getElementById('workspaceBackgroundUpload');
    const newFileInput = fileInput.cloneNode(true);
    fileInput.parentNode.replaceChild(newFileInput, fileInput);
    newFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (file.size > MAX_BACKGROUND_MEDIA_BYTES) {
            alert(i18n('backgroundMediaTooLarge'));
            newFileInput.value = '';
            return;
        }

        const isVideo = file.type === 'video/webm' || file.name.toLowerCase().endsWith('.webm');
        const isImage = file.type.startsWith('image/');

        try {
            const preview = document.getElementById('workspaceBackgroundPreview');
            preview.innerHTML = '';

            if (isVideo) {
                const reader = new FileReader();
                const dataUrl = await new Promise((resolve, reject) => {
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = () => reject(reader.error);
                    reader.readAsDataURL(file);
                });

                selectedCustomMedia = dataUrl;
                selectedCustomMediaType = 'video';
                preview.innerHTML = `<video src="${selectedCustomMedia}" muted autoplay loop playsinline></video>`;
            } else if (isImage) {
                const compressedImage = await compressImage(file);
                selectedCustomMedia = compressedImage;
                selectedCustomMediaType = 'image';
                preview.innerHTML = `<img src="${selectedCustomMedia}" alt="Background">`;
            } else {
                alert(i18n('backgroundMediaUnsupported'));
                newFileInput.value = '';
                return;
            }

            document.getElementById('removeWorkspaceBackground').style.display = 'block';
            selectedBackgroundType = 'custom';
        } catch (error) {
            console.error('Error processing background:', error);
            alert(i18n('backgroundMediaFailed'));
            document.getElementById('workspaceBackgroundPreview').innerHTML = '';
        }
    });

    // Remove custom background - clone to remove old listeners
    const removeBtn = document.getElementById('removeWorkspaceBackground');
    const newRemoveBtn = removeBtn.cloneNode(true);
    removeBtn.parentNode.replaceChild(newRemoveBtn, removeBtn);
    newRemoveBtn.addEventListener('click', () => {
        selectedCustomMedia = null;
        selectedCustomMediaType = 'image';
        document.getElementById('workspaceBackgroundPreview').innerHTML = '';
        document.getElementById('removeWorkspaceBackground').style.display = 'none';
        document.getElementById('workspaceBackgroundUpload').value = '';
    });

    // Close modal - clone to remove old listeners
    const closeBtn = document.getElementById('closeBackgroundModal');
    const newCloseBtn = closeBtn.cloneNode(true);
    closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
    newCloseBtn.addEventListener('click', closeBackgroundModal);

    const cancelBtn = document.getElementById('cancelBackground');
    const newCancelBtn = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
    newCancelBtn.addEventListener('click', closeBackgroundModal);

    // Save background - clone to remove old listeners
    const saveBtn = document.getElementById('saveBackground');
    const newSaveBtn = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
    newSaveBtn.addEventListener('click', saveWorkspaceBackground);
}

function closeBackgroundModal() {
    document.getElementById('workspaceBackgroundModal').classList.remove('open');
    currentBackgroundWorkspaceId = null;
    selectedPreset = null;
    selectedCustomMedia = null;
    selectedCustomMediaType = 'image';
    document.getElementById('workspaceBackgroundPreview').innerHTML = '';
    document.getElementById('removeWorkspaceBackground').style.display = 'none';
}

async function saveWorkspaceBackground() {
    if (!currentBackgroundWorkspaceId) return;
    if (await getWorkspaceLockState(currentBackgroundWorkspaceId)) {
        return;
    }

    const backgroundData = {
        type: selectedBackgroundType
    };

    if (selectedBackgroundType === 'preset') {
        // Use selected preset or default to 'aurora'
        backgroundData.preset = selectedPreset || 'aurora';
    } else if (selectedBackgroundType === 'custom' && selectedCustomMedia) {
        // Save custom media to storage
        backgroundData.mediaType = selectedCustomMediaType || 'image';
        await StorageManager.saveWorkspaceBackground(currentBackgroundWorkspaceId, selectedCustomMedia);
    } else if (selectedBackgroundType === 'custom' && !selectedCustomMedia) {
        // No custom media selected, don't save
        alert(i18n('backgroundMediaMissing'));
        return;
    }

    // Save background data to workspace
    await StorageManager.updateWorkspaceBackground(currentBackgroundWorkspaceId, backgroundData);

    // Apply background if this is current workspace
    const currentWorkspace = await StorageManager.getCurrentWorkspace();
    if (currentWorkspace === currentBackgroundWorkspaceId) {
        await applyWorkspaceBackground();
    }

    closeBackgroundModal();
}

// ========== ORGANIZATION ==========

// Auto-arrange bookmarks and folders in current workspace
async function autoArrangeBookmarks() {
    if (currentWorkspaceLocked) {
        return;
    }
    // Ask for confirmation
    if (!confirm(i18n('autoArrangeConfirm'))) {
        return;
    }

    const currentWorkspace = await StorageManager.getCurrentWorkspace();
    const allBookmarks = await StorageManager.getBookmarks();
    const allFolders = await StorageManager.getFolders();

    // Filter items for current workspace (not in folders)
    const workspaceBookmarks = allBookmarks.filter(b =>
        b.workspace === currentWorkspace && !b.folderId
    );
    const workspaceFolders = allFolders.filter(f =>
        f.workspace === currentWorkspace
    );

    // Grid parameters
    const startX = 50;
    const startY = 50;
    const gapX = 20;
    const gapY = 20;
    const minSize = 150; // Minimum size to fit more items

    // Calculate items per row based on viewport width
    const viewportWidth = window.innerWidth;
    const itemsPerRow = Math.floor((viewportWidth - startX * 2 + gapX) / (minSize + gapX));

    let currentX = startX;
    let currentY = startY;
    let itemsInCurrentRow = 0;

    // Sort bookmarks by title
    workspaceBookmarks.sort((a, b) => a.title.localeCompare(b.title));

    // Sort folders by name
    workspaceFolders.sort((a, b) => a.name.localeCompare(b.name));

    // Position bookmarks first
    for (const bookmark of workspaceBookmarks) {
        bookmark.x = currentX;
        bookmark.y = currentY;
        bookmark.width = minSize;
        bookmark.height = minSize;

        itemsInCurrentRow++;
        currentX += minSize + gapX;

        // Move to next row if needed
        if (itemsInCurrentRow >= itemsPerRow) {
            currentX = startX;
            currentY += minSize + gapY;
            itemsInCurrentRow = 0;
        }
    }

    // If there are bookmarks and folders, start folders on new row
    if (workspaceBookmarks.length > 0 && workspaceFolders.length > 0 && itemsInCurrentRow > 0) {
        currentX = startX;
        currentY += minSize + gapY;
        itemsInCurrentRow = 0;
    }

    // Position folders
    for (const folder of workspaceFolders) {
        folder.x = currentX;
        folder.y = currentY;
        folder.width = minSize;
        folder.height = minSize;

        itemsInCurrentRow++;
        currentX += minSize + gapX;

        // Move to next row if needed
        if (itemsInCurrentRow >= itemsPerRow) {
            currentX = startX;
            currentY += minSize + gapY;
            itemsInCurrentRow = 0;
        }
    }

    // Save changes
    await StorageManager.saveBookmarks(allBookmarks);
    await StorageManager.saveFolders(allFolders);

    // Refresh display
    await refreshBookmarks();

    // Show success message
    alert(i18n('autoArrangeSuccess', [workspaceBookmarks.length, workspaceFolders.length]));
}

// ========== DATA MANAGEMENT ==========

// Export all data (bookmarks, folders, workspaces, settings)
async function exportAllData() {
    try {
        const bookmarks = await StorageManager.getBookmarks();
        const folders = await StorageManager.getFolders();
        const settings = await StorageManager.getSettings();
        const workspaces = settings.workspaces || [];

        const exportData = {
            version: '2.0',
            exportDate: new Date().toISOString(),
            bookmarks,
            folders,
            workspaces,
            settings,
            note: 'Screenshots and images are stored separately and not included in export'
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `visual-bookmarks-backup-${Date.now()}.json`;
        a.click();

        URL.revokeObjectURL(url);

        console.log('✅ Data exported successfully');
        alert(i18n('exportSuccess'));
    } catch (error) {
        console.error('Export failed:', error);
        alert(i18n('exportFailed', [error.message]));
    }
}

// Import data from JSON file
async function importAllData() {
    try {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json';

        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async (event) => {
                try {
                    const importData = JSON.parse(event.target.result);

                    // Validate import data
                    if (!importData.version) {
                        throw new Error('Invalid backup file format');
                    }

                    if (!confirm(i18n('importConfirm', [importData.exportDate]))) {
                        return;
                    }

                    // Import bookmarks
                    if (importData.bookmarks) {
                        await StorageManager.saveBookmarks(importData.bookmarks);
                    }

                    // Import folders
                    if (importData.folders) {
                        await StorageManager.saveFolders(importData.folders);
                    }

                    // Import workspaces and settings
                    if (importData.settings) {
                        // Merge workspaces if present
                        if (importData.workspaces) {
                            importData.settings.workspaces = importData.workspaces;
                        }
                        await StorageManager.saveSettings(importData.settings);
                    }

                    console.log('✅ Data imported successfully');
                    alert(i18n('importSuccessReload'));

                    // Reload page to apply changes
                    location.reload();
                } catch (error) {
                    console.error('Import failed:', error);
                    alert(i18n('importFailed', [error.message]));
                }
            };

            reader.readAsText(file);
        };

        input.click();
    } catch (error) {
        console.error('Import failed:', error);
        alert(i18n('importFailed', [error.message]));
    }
}

// ========== EXTERNAL DRAG AND DROP (FROM CHROME BOOKMARKS BAR) ==========
function setupExternalDragDrop(container) {
    // Prevent default drag behavior on the container
    container.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (currentWorkspaceLocked) {
            e.dataTransfer.dropEffect = 'none';
            container.classList.remove('drag-over-external');
            return;
        }

        // Check if dragging from external source (like Chrome bookmarks bar)
        if (e.dataTransfer.types.includes('text/uri-list') ||
            e.dataTransfer.types.includes('text/plain')) {
            e.dataTransfer.dropEffect = 'copy';
            container.classList.add('drag-over-external');
        }
    });

    container.addEventListener('dragenter', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });

    container.addEventListener('dragleave', (e) => {
        if (e.target === container) {
            container.classList.remove('drag-over-external');
        }
    });

    container.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        container.classList.remove('drag-over-external');

        if (currentWorkspaceLocked) {
            return;
        }

        try {
            // Get URL from drag event
            let url = e.dataTransfer.getData('text/uri-list') ||
                     e.dataTransfer.getData('text/plain') ||
                     e.dataTransfer.getData('URL');

            if (!url) {
                return;
            }

            // Clean up URL (remove extra whitespace, newlines)
            url = url.trim().split('\n')[0];

            // Validate URL
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                return;
            }

            // Try to get title from Chrome Bookmarks API
            let title = '';

            // Method 1: Search Chrome bookmarks by URL to get the real title
            try {
                const bookmarks = await new Promise((resolve) => {
                    chrome.bookmarks.search({ url: url }, (results) => {
                        resolve(results);
                    });
                });

                if (bookmarks && bookmarks.length > 0 && bookmarks[0].title) {
                    title = bookmarks[0].title;
                }
            } catch (err) {
                console.error('Error searching bookmarks:', err);
            }

            // Method 2: Try to get from HTML data (fallback)
            if (!title) {
                const htmlData = e.dataTransfer.getData('text/html');
                if (htmlData) {
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(htmlData, 'text/html');
                    const link = doc.querySelector('a');
                    if (link) {
                        let linkText = (link.textContent || link.title || link.innerText || '').trim();

                        if (linkText && linkText !== url && !linkText.startsWith('http://') && !linkText.startsWith('https://')) {
                            title = linkText;
                        }
                    }
                }
            }

            // Method 3: If no title found, extract from URL
            if (!title) {
                try {
                    const urlObj = new URL(url);
                    title = urlObj.hostname.replace('www.', '');
                } catch (err) {
                    title = i18n('newBookmarkTitle');
                }
            }

            // Truncate title if too long (max 100 characters)
            if (title.length > 100) {
                title = title.substring(0, 97) + '...';
            }

            // Calculate drop position
            const rect = container.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            // Get current workspace
            const currentWorkspace = await StorageManager.getCurrentWorkspace();

            // Create new bookmark
            const newBookmark = {
                id: 'bookmark_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                title: title,
                url: url,
                workspace: currentWorkspace,
                x: Math.max(0, Math.min(x - 100, rect.width - 200)), // Center on cursor with bounds
                y: Math.max(0, Math.min(y - 100, rect.height - 200)),
                width: 200,
                height: 200,
                color: null,
                displayType: 'icon',
                createdAt: Date.now()
            };

            // Save bookmark
            await bookmarkManager.addBookmark(newBookmark);
            await refreshBookmarks();

            console.log('Bookmark created from external drag:', newBookmark);

        } catch (error) {
            console.error('Error creating bookmark from external drag:', error);
        }
    });
}

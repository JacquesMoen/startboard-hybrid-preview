// Free-form Drag and Drop functionality for Visual Bookmarks

class DragDropManager {
    constructor() {
        this.draggedElement = null;
        this.offsetX = 0;
        this.offsetY = 0;
        this.animationsEnabled = true;
        this.container = null;
        this.snapGridSize = 10; // Snap to 10px grid for alignment
        this.selectedElements = new Set();
        this.selectionBox = null;
        this.selectionContainer = null;
        this.isSelecting = false;
        this.selectionStart = null;
        this.gridHighlightLayer = null;
        this.gridHighlightLines = null;
        this.workspaceLocked = false;
        this.gridInteractionCount = 0;
    }

    setWorkspaceLocked(locked) {
        this.workspaceLocked = locked;
        if (locked) {
            this.clearSelection();
            this.clearGridHighlights();
            this.clearFolderHighlights();
            this.resetGridInteraction(this.container);
            if (this.selectionBox) {
                this.selectionBox.style.display = 'none';
            }
            this.isSelecting = false;
        }
    }

    beginGridInteraction(container) {
        if (!container || !container.classList.contains('bookmarks-grid')) {
            return;
        }
        this.gridInteractionCount += 1;
        if (this.gridInteractionCount === 1) {
            container.classList.add('grid-enabled');
        }
    }

    endGridInteraction(container) {
        if (!container || !container.classList.contains('bookmarks-grid')) {
            return;
        }
        this.gridInteractionCount = Math.max(0, this.gridInteractionCount - 1);
        if (this.gridInteractionCount === 0) {
            container.classList.remove('grid-enabled');
            this.clearGridHighlights();
        }
    }

    resetGridInteraction(container) {
        if (!container || !container.classList.contains('bookmarks-grid')) {
            return;
        }
        this.gridInteractionCount = 0;
        container.classList.remove('grid-enabled');
        this.clearGridHighlights();
    }

    enableDragDrop(container) {
        this.container = container;
        const cards = container.querySelectorAll('.bookmark-card');
        const folders = container.querySelectorAll('.folder-card');

        // Check if this is a folder modal (grid layout)
        const isFolderGrid = container.classList.contains('folder-bookmarks-grid');

        if (!isFolderGrid) {
            this.clearSelection();
            this.enableSelection(container);
            this.enableSelectionInterception(container);
        }

        cards.forEach((card) => {
            if (isFolderGrid) {
                // For folder grid - enable simple drag for sorting
                this.enableGridSortDrag(card, container);
            } else {
                // Only enable free drag for desktop bookmarks
                // Mouse drag events (custom implementation for real-time movement)
                this.enableMouseDrag(card);

                // Touch support
                this.enableTouchDrag(card);

                // Resize support
                this.enableResize(card);
            }
        });

        folders.forEach((folder) => {
            // Enable drag for folder cards
            this.enableFolderDrag(folder);

            // Enable resize for folder cards
            this.enableFolderResize(folder);
        });
    }

    enableSelection(container) {
        if (container.classList.contains('folder-bookmarks-grid')) return;
        if (container.dataset.selectionEnabled === 'true') return;

        container.dataset.selectionEnabled = 'true';
        this.selectionContainer = container;
        this.ensureSelectionBox(container);

        const handleMouseDown = (e) => {
            if (this.workspaceLocked) return;
            if (e.button !== 0) return;
            if (e.target.closest('.bookmark-card, .folder-card')) return;

            this.ensureSelectionBox(container);
            this.clearSelection();
            this.isSelecting = true;

            const containerRect = container.getBoundingClientRect();
            const startX = e.clientX - containerRect.left;
            const startY = e.clientY - containerRect.top;

            this.selectionStart = { x: startX, y: startY };
            this.updateSelectionBox(startX, startY, startX, startY);
            this.selectionBox.style.display = 'block';
            document.body.style.userSelect = 'none';

            e.preventDefault();

            const handleMouseMove = (moveEvent) => {
                if (!this.isSelecting) return;

                const maxX = container.clientWidth;
                const maxY = container.clientHeight;
                const currentX = Math.min(Math.max(moveEvent.clientX - containerRect.left, 0), maxX);
                const currentY = Math.min(Math.max(moveEvent.clientY - containerRect.top, 0), maxY);

                this.updateSelectionBox(startX, startY, currentX, currentY);
                const selectionRect = this.getSelectionRect(startX, startY, currentX, currentY);
                this.updateSelectionFromRect(selectionRect, container);
            };

            const handleMouseUp = () => {
                if (!this.isSelecting) return;

                this.isSelecting = false;
                this.selectionBox.style.display = 'none';
                document.body.style.userSelect = '';

                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
            };

            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        };

        container.addEventListener('mousedown', handleMouseDown);
    }

    enableSelectionInterception(container) {
        if (container.dataset.selectionInterception === 'true') return;
        container.dataset.selectionInterception = 'true';

        const isSelectionActive = () => this.selectedElements.size > 0;
        const isSelectableTarget = (target) => target.closest('.bookmark-card, .folder-card');

        container.addEventListener('click', (e) => {
            if (!isSelectionActive() || !isSelectableTarget(e.target)) return;
            e.stopPropagation();
            e.preventDefault();
        }, true);

        container.addEventListener('contextmenu', (e) => {
            if (!isSelectionActive() || !isSelectableTarget(e.target)) return;
            e.stopPropagation();
            e.preventDefault();
        }, true);

        container.addEventListener('mousedown', (e) => {
            if (!isSelectionActive()) return;
            if (e.target.classList.contains('bookmark-resize-handle') || e.target.closest('.bookmark-actions')) {
                e.stopPropagation();
                e.preventDefault();
            }
        }, true);
    }

    ensureSelectionBox(container) {
        if (this.selectionBox && this.selectionBox.isConnected && this.selectionBox.parentElement === container) {
            return;
        }

        const selectionBox = document.createElement('div');
        selectionBox.className = 'selection-rect';
        selectionBox.style.display = 'none';
        container.appendChild(selectionBox);
        this.selectionBox = selectionBox;
    }

    updateSelectionBox(startX, startY, currentX, currentY) {
        const rect = this.getSelectionRect(startX, startY, currentX, currentY);
        this.selectionBox.style.left = rect.left + 'px';
        this.selectionBox.style.top = rect.top + 'px';
        this.selectionBox.style.width = rect.width + 'px';
        this.selectionBox.style.height = rect.height + 'px';
    }

    getSelectionRect(startX, startY, currentX, currentY) {
        const left = Math.min(startX, currentX);
        const top = Math.min(startY, currentY);
        const right = Math.max(startX, currentX);
        const bottom = Math.max(startY, currentY);
        return {
            left,
            top,
            right,
            bottom,
            width: right - left,
            height: bottom - top
        };
    }

    updateSelectionFromRect(selectionRect, container) {
        const elements = container.querySelectorAll('.bookmark-card, .folder-card');
        const containerRect = container.getBoundingClientRect();
        const nextSelection = new Set();

        elements.forEach((element) => {
            const rect = element.getBoundingClientRect();
            const left = rect.left - containerRect.left;
            const right = rect.right - containerRect.left;
            const top = rect.top - containerRect.top;
            const bottom = rect.bottom - containerRect.top;

            const intersects = !(
                right < selectionRect.left ||
                left > selectionRect.right ||
                bottom < selectionRect.top ||
                top > selectionRect.bottom
            );

            if (intersects) {
                nextSelection.add(element);
            }
        });

        this.selectedElements.forEach((element) => {
            if (!nextSelection.has(element)) {
                element.classList.remove('selected');
            }
        });

        nextSelection.forEach((element) => {
            if (!this.selectedElements.has(element)) {
                element.classList.add('selected');
            }
        });

        this.selectedElements = nextSelection;
        this.emitSelectionChange(container);
    }

    clearSelection(container = this.selectionContainer) {
        this.selectedElements.forEach((element) => {
            element.classList.remove('selected');
        });
        this.selectedElements.clear();
        if (container) {
            this.emitSelectionChange(container);
        }
    }

    getDragGroup(container, anchorElement) {
        if (this.selectedElements.size > 0 && this.selectedElements.has(anchorElement)) {
            const group = Array.from(this.selectedElements).filter(element => container.contains(element));
            if (group.length) {
                return group;
            }
        }
        return [anchorElement];
    }

    buildDragContext(group) {
        return group.map((element) => ({
            element,
            startX: parseInt(element.style.left, 10) || 0,
            startY: parseInt(element.style.top, 10) || 0,
            width: element.offsetWidth,
            height: element.offsetHeight,
            type: element.classList.contains('folder-card') ? 'folder' : 'bookmark'
        }));
    }

    getGroupDeltaBounds(context, container) {
        let minDeltaX = -Infinity;
        let maxDeltaX = Infinity;
        let minDeltaY = -Infinity;
        let maxDeltaY = Infinity;

        context.forEach((entry) => {
            minDeltaX = Math.max(minDeltaX, -entry.startX);
            maxDeltaX = Math.min(maxDeltaX, container.clientWidth - entry.width - entry.startX);
            minDeltaY = Math.max(minDeltaY, -entry.startY);
            maxDeltaY = Math.min(maxDeltaY, container.clientHeight - entry.height - entry.startY);
        });

        if (!Number.isFinite(minDeltaX)) minDeltaX = 0;
        if (!Number.isFinite(maxDeltaX)) maxDeltaX = 0;
        if (!Number.isFinite(minDeltaY)) minDeltaY = 0;
        if (!Number.isFinite(maxDeltaY)) maxDeltaY = 0;

        return { minDeltaX, maxDeltaX, minDeltaY, maxDeltaY };
    }

    applyGroupDrag(context, deltaX, deltaY) {
        context.forEach((entry) => {
            entry.element.style.left = (entry.startX + deltaX) + 'px';
            entry.element.style.top = (entry.startY + deltaY) + 'px';
        });
    }

    setGroupDragging(context, isDragging) {
        context.forEach((entry) => {
            if (isDragging) {
                entry.element.classList.add('dragging');
                entry.element.style.cursor = 'grabbing';
            } else {
                entry.element.classList.remove('dragging');
                entry.element.style.cursor = '';
            }
        });
    }

    markGroupDragged(context) {
        context.forEach((entry) => {
            entry.element.dataset.wasDragging = 'true';
            setTimeout(() => {
                delete entry.element.dataset.wasDragging;
            }, 100);
        });
    }

    dispatchGroupMove(context) {
        context.forEach((entry) => {
            const newX = parseInt(entry.element.style.left, 10);
            const newY = parseInt(entry.element.style.top, 10);

            if (entry.type === 'folder') {
                const event = new CustomEvent('folder-moved', {
                    detail: {
                        folderId: entry.element.dataset.folderId,
                        x: newX,
                        y: newY
                    }
                });
                document.dispatchEvent(event);
            } else {
                const event = new CustomEvent('bookmark-moved', {
                    detail: {
                        bookmarkId: entry.element.dataset.id,
                        x: newX,
                        y: newY,
                        insideFolder: false
                    }
                });
                document.dispatchEvent(event);
            }
        });
    }

    clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    shouldShowGridHighlights(container) {
        return !!container && container.classList.contains('grid-enabled');
    }

    ensureGridHighlights(container) {
        if (!container) return null;

        if (this.gridHighlightLayer && this.gridHighlightLayer.parentElement === container) {
            return this.gridHighlightLayer;
        }

        if (this.gridHighlightLayer && this.gridHighlightLayer.parentElement) {
            this.gridHighlightLayer.parentElement.removeChild(this.gridHighlightLayer);
        }

        const layer = document.createElement('div');
        layer.className = 'grid-highlight-layer';

        const lineTop = document.createElement('div');
        lineTop.className = 'grid-highlight-line horizontal';
        const lineBottom = document.createElement('div');
        lineBottom.className = 'grid-highlight-line horizontal';
        const lineLeft = document.createElement('div');
        lineLeft.className = 'grid-highlight-line vertical';
        const lineRight = document.createElement('div');
        lineRight.className = 'grid-highlight-line vertical';

        layer.append(lineTop, lineBottom, lineLeft, lineRight);
        container.appendChild(layer);

        this.gridHighlightLayer = layer;
        this.gridHighlightLines = {
            top: lineTop,
            bottom: lineBottom,
            left: lineLeft,
            right: lineRight
        };

        return layer;
    }

    updateGridHighlightsForElements(elements, container) {
        if (!this.shouldShowGridHighlights(container) || !elements || elements.length === 0) {
            this.clearGridHighlights();
            return;
        }

        const layer = this.ensureGridHighlights(container);
        if (!layer || !this.gridHighlightLines) return;

        let minLeft = Infinity;
        let minTop = Infinity;
        let maxRight = -Infinity;
        let maxBottom = -Infinity;

        elements.forEach((element) => {
            if (!element) return;
            const left = parseInt(element.style.left, 10) || element.offsetLeft || 0;
            const top = parseInt(element.style.top, 10) || element.offsetTop || 0;
            const width = element.offsetWidth || 0;
            const height = element.offsetHeight || 0;

            minLeft = Math.min(minLeft, left);
            minTop = Math.min(minTop, top);
            maxRight = Math.max(maxRight, left + width);
            maxBottom = Math.max(maxBottom, top + height);
        });

        if (!isFinite(minLeft) || !isFinite(minTop) || !isFinite(maxRight) || !isFinite(maxBottom)) {
            this.clearGridHighlights();
            return;
        }

        const maxX = Math.max(0, container.clientWidth - 1);
        const maxY = Math.max(0, container.clientHeight - 1);
        const left = Math.max(0, Math.min(minLeft, maxX));
        const right = Math.max(0, Math.min(maxRight, maxX));
        const top = Math.max(0, Math.min(minTop, maxY));
        const bottom = Math.max(0, Math.min(maxBottom, maxY));

        const { top: lineTop, bottom: lineBottom, left: lineLeft, right: lineRight } = this.gridHighlightLines;
        lineTop.style.top = `${top}px`;
        lineBottom.style.top = `${bottom}px`;
        lineLeft.style.left = `${left}px`;
        lineRight.style.left = `${right}px`;

        layer.classList.add('active');
    }

    clearGridHighlights() {
        if (this.gridHighlightLayer) {
            this.gridHighlightLayer.classList.remove('active');
        }
    }

    emitSelectionChange(container) {
        const selection = Array.from(this.selectedElements);
        const details = {
            count: selection.length,
            bookmarks: [],
            folders: []
        };

        selection.forEach((element) => {
            if (element.classList.contains('bookmark-card') && element.dataset.id) {
                details.bookmarks.push(element.dataset.id);
            } else if (element.classList.contains('folder-card') && element.dataset.folderId) {
                details.folders.push(element.dataset.folderId);
            }
        });

        document.dispatchEvent(new CustomEvent('selection-changed', { detail: details }));
    }

    // Drag for folder cards
    enableFolderDrag(card) {
        let isDragging = false;
        let hasMoved = false;
        let mouseStartX = 0;
        let mouseStartY = 0;
        let cardStartX = 0;
        let cardStartY = 0;
        let dragContext = null;
        let dragBounds = null;
        let draggedStartX = 0;
        let draggedStartY = 0;
        let gridActive = false;
        let gridContainer = null;

        const handleMouseDown = (e) => {
            if (this.workspaceLocked) return;
            if (e.button !== 0) return;

            isDragging = true;
            hasMoved = false;
            this.draggedElement = card;
            gridContainer = card.parentElement;
            const container = gridContainer;
            if (!this.selectedElements.has(card) && this.selectedElements.size > 0) {
                this.clearSelection();
            }
            const dragGroup = this.getDragGroup(container, card);
            dragContext = this.buildDragContext(dragGroup);
            dragBounds = this.getGroupDeltaBounds(dragContext, container);
            const anchor = dragContext.find(entry => entry.element === card);

            mouseStartX = e.clientX;
            mouseStartY = e.clientY;

            // Use current position from styles if available
            cardStartX = parseInt(card.style.left) || 0;
            cardStartY = parseInt(card.style.top) || 0;
            draggedStartX = anchor ? anchor.startX : cardStartX;
            draggedStartY = anchor ? anchor.startY : cardStartY;

            e.preventDefault();

            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        };

        const handleMouseMove = (e) => {
            if (!isDragging) return;

            if (!gridActive) {
                this.beginGridInteraction(gridContainer);
                gridActive = true;
            }

            const deltaX = e.clientX - mouseStartX;
            const deltaY = e.clientY - mouseStartY;

            if (!hasMoved && (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3)) {
                hasMoved = true;
                if (dragContext) {
                    this.setGroupDragging(dragContext, true);
                }
            }

            if (!hasMoved) return;

            const container = gridContainer;
            const snappedX = Math.round((draggedStartX + deltaX) / this.snapGridSize) * this.snapGridSize;
            const snappedY = Math.round((draggedStartY + deltaY) / this.snapGridSize) * this.snapGridSize;
            let appliedDeltaX = snappedX - draggedStartX;
            let appliedDeltaY = snappedY - draggedStartY;

            if (dragBounds) {
                appliedDeltaX = this.clamp(appliedDeltaX, dragBounds.minDeltaX, dragBounds.maxDeltaX);
                appliedDeltaY = this.clamp(appliedDeltaY, dragBounds.minDeltaY, dragBounds.maxDeltaY);
            }

            if (dragContext) {
                this.applyGroupDrag(dragContext, appliedDeltaX, appliedDeltaY);
            }

            const dragElements = dragContext ? dragContext.map(entry => entry.element) : [card];
            this.updateGridHighlightsForElements(dragElements, container);
        };

        const handleMouseUp = (e) => {
            if (!isDragging) return;

            isDragging = false;
            if (dragContext) {
                this.setGroupDragging(dragContext, false);
            }
            this.draggedElement = null;

            if (hasMoved) {
                if (dragContext) {
                    this.markGroupDragged(dragContext);
                    this.dispatchGroupMove(dragContext);
                }
            }

            this.clearGridHighlights();
            if (gridActive) {
                this.endGridInteraction(gridContainer);
                gridActive = false;
                gridContainer = null;
            }

            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };

        card.addEventListener('mousedown', handleMouseDown);

        card.addEventListener('contextmenu', () => {
            if (isDragging) {
                isDragging = false;
                hasMoved = false;
                card.classList.remove('dragging');
                card.style.cursor = '';
                this.clearGridHighlights();
                if (gridActive) {
                    this.endGridInteraction(gridContainer);
                    gridActive = false;
                    gridContainer = null;
                }
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
            }
        });
    }

    // Custom mouse drag implementation for real-time movement
    enableMouseDrag(card) {
        let isDragging = false;
        let hasMoved = false;
        let mouseStartX = 0;
        let mouseStartY = 0;
        let cardStartX = 0;
        let cardStartY = 0;
        let dragContext = null;
        let dragBounds = null;
        let draggedStartX = 0;
        let draggedStartY = 0;
        let allowFolderDrop = false;
        let gridActive = false;
        let gridContainer = null;

        const handleMouseDown = (e) => {
            if (this.workspaceLocked) return;
            // Only handle left mouse button
            if (e.button !== 0) return;

            // Ignore if clicking on resize handle
            if (e.target.classList.contains('bookmark-resize-handle')) return;
            // Ignore if clicking on buttons
            if (e.target.closest('.bookmark-actions')) return;

            isDragging = true;
            hasMoved = false;
            this.draggedElement = card;
            gridContainer = card.parentElement;
            const container = gridContainer;
            if (!this.selectedElements.has(card) && this.selectedElements.size > 0) {
                this.clearSelection();
            }
            const dragGroup = this.getDragGroup(container, card);
            dragContext = this.buildDragContext(dragGroup);
            dragBounds = this.getGroupDeltaBounds(dragContext, container);
            const anchor = dragContext.find(entry => entry.element === card);
            allowFolderDrop = dragContext.length === 1 && anchor && anchor.type === 'bookmark';

            mouseStartX = e.clientX;
            mouseStartY = e.clientY;

            // Use current position from styles if available
            cardStartX = parseInt(card.style.left) || 0;
            cardStartY = parseInt(card.style.top) || 0;
            draggedStartX = anchor ? anchor.startX : cardStartX;
            draggedStartY = anchor ? anchor.startY : cardStartY;

            // Prevent text selection during drag
            e.preventDefault();

            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        };

        const handleMouseMove = (e) => {
            if (!isDragging) return;

            if (!gridActive) {
                this.beginGridInteraction(gridContainer);
                gridActive = true;
            }

            const deltaX = e.clientX - mouseStartX;
            const deltaY = e.clientY - mouseStartY;

            // Only start dragging if moved more than 3px (prevents accidental drags)
            if (!hasMoved && (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3)) {
                hasMoved = true;
                // Visual feedback
                if (dragContext) {
                    this.setGroupDragging(dragContext, true);
                }
            }

            if (!hasMoved) return;

            const container = gridContainer;
            const snappedX = Math.round((draggedStartX + deltaX) / this.snapGridSize) * this.snapGridSize;
            const snappedY = Math.round((draggedStartY + deltaY) / this.snapGridSize) * this.snapGridSize;
            let appliedDeltaX = snappedX - draggedStartX;
            let appliedDeltaY = snappedY - draggedStartY;

            if (dragBounds) {
                appliedDeltaX = this.clamp(appliedDeltaX, dragBounds.minDeltaX, dragBounds.maxDeltaX);
                appliedDeltaY = this.clamp(appliedDeltaY, dragBounds.minDeltaY, dragBounds.maxDeltaY);
            }

            if (dragContext) {
                this.applyGroupDrag(dragContext, appliedDeltaX, appliedDeltaY);
            }

            if (allowFolderDrop) {
                this.highlightFolderUnderBookmark(card);
            }

            const dragElements = dragContext ? dragContext.map(entry => entry.element) : [card];
            this.updateGridHighlightsForElements(dragElements, container);
        };

        const handleMouseUp = (e) => {
            if (!isDragging) return;

            isDragging = false;
            if (dragContext) {
                this.setGroupDragging(dragContext, false);
            }
            this.draggedElement = null;

            // Remove folder highlight
            this.clearFolderHighlights();
            this.clearGridHighlights();
            if (gridActive) {
                this.endGridInteraction(gridContainer);
                gridActive = false;
                gridContainer = null;
            }

            // If actually dragged, save position and prevent click
            if (hasMoved) {
                if (dragContext) {
                    this.markGroupDragged(dragContext);
                }

                if (allowFolderDrop) {
                    // Check if bookmark was dropped on a folder
                    const bookmarkId = card.dataset.id;
                    const newX = parseInt(card.style.left);
                    const newY = parseInt(card.style.top);

                    // Check if inside folder modal
                    const insideFolder = card.closest('#folderBookmarksGrid') !== null;

                    const droppedOnFolder = !insideFolder ? this.checkDropOnFolder(card) : null;

                    if (droppedOnFolder) {
                        // Bookmark dropped on folder
                        const event = new CustomEvent('bookmark-dropped-on-folder', {
                            detail: {
                                bookmarkId: bookmarkId,
                                folderId: droppedOnFolder,
                                x: newX,
                                y: newY
                            }
                        });
                        document.dispatchEvent(event);
                    } else {
                        // Normal position save
                        const event = new CustomEvent('bookmark-moved', {
                            detail: {
                                bookmarkId: bookmarkId,
                                x: newX,
                                y: newY,
                                insideFolder: insideFolder
                            }
                        });
                        document.dispatchEvent(event);
                    }
                } else if (dragContext) {
                    this.dispatchGroupMove(dragContext);
                }
            }

            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };

        card.addEventListener('mousedown', handleMouseDown);

        // Cancel drag if context menu opens
        card.addEventListener('contextmenu', () => {
            if (isDragging) {
                isDragging = false;
                hasMoved = false;
                card.classList.remove('dragging');
                card.style.cursor = '';
                this.clearGridHighlights();
                if (gridActive) {
                    this.endGridInteraction(gridContainer);
                    gridActive = false;
                    gridContainer = null;
                }
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
            }
        });
    }

    // Touch support for mobile
    enableTouchDrag(card) {
        let touchStartX = 0;
        let touchStartY = 0;
        let cardStartX = 0;
        let cardStartY = 0;
        let isDragging = false;
        let gridActive = false;
        let gridContainer = null;

        card.addEventListener('touchstart', (e) => {
            if (this.workspaceLocked) return;
            const touch = e.touches[0];
            const rect = card.getBoundingClientRect();

            touchStartX = touch.clientX;
            touchStartY = touch.clientY;
            cardStartX = rect.left - card.parentElement.getBoundingClientRect().left;
            cardStartY = rect.top - card.parentElement.getBoundingClientRect().top;
            gridContainer = card.parentElement;

            isDragging = false;

            // Delay to distinguish tap from drag
            setTimeout(() => {
                if (!isDragging) {
                    card.classList.add('dragging');
                    isDragging = true;
                }
            }, 100);
        });

        card.addEventListener('touchmove', (e) => {
            if (this.workspaceLocked) return;
            if (!isDragging) return;

            e.preventDefault();
            const touch = e.touches[0];
            if (!gridActive) {
                this.beginGridInteraction(gridContainer);
                gridActive = true;
            }

            const deltaX = touch.clientX - touchStartX;
            const deltaY = touch.clientY - touchStartY;

            let newX = cardStartX + deltaX;
            let newY = cardStartY + deltaY;

            // Snap to grid
            newX = Math.round(newX / this.snapGridSize) * this.snapGridSize;
            newY = Math.round(newY / this.snapGridSize) * this.snapGridSize;

            // Keep within bounds
            const container = card.parentElement;
            const cardRect = card.getBoundingClientRect();
            const isFolderModal = container.classList.contains('folder-bookmarks-grid');

            // Horizontal bounds
            newX = Math.max(0, Math.min(newX, container.clientWidth - cardRect.width));

            // Vertical bounds - for folder modal, allow completely free movement
            if (isFolderModal) {
                // In folder modal, NO restrictions at all - complete freedom
                // User can position bookmarks anywhere

                // Dynamically expand container if bookmark is moved down
                const minContainerHeight = Math.max(newY + cardRect.height + 100, 0);
                if (minContainerHeight > container.offsetHeight) {
                    container.style.minHeight = minContainerHeight + 'px';
                }
            } else {
                // Desktop - normal bounds
                newY = Math.max(0, Math.min(newY, container.clientHeight - cardRect.height));
            }

            card.style.left = newX + 'px';
            card.style.top = newY + 'px';
            this.updateGridHighlightsForElements([card], container);
        });

        card.addEventListener('touchend', (e) => {
            if (this.workspaceLocked) return;
            if (!isDragging) return;

            card.classList.remove('dragging');
            if (gridActive) {
                this.endGridInteraction(gridContainer);
                gridActive = false;
                gridContainer = null;
            }

            // Save position
            const bookmarkId = card.dataset.id;
            const newX = parseInt(card.style.left);
            const newY = parseInt(card.style.top);

            const event = new CustomEvent('bookmark-moved', {
                detail: {
                    bookmarkId: bookmarkId,
                    x: newX,
                    y: newY
                }
            });
            document.dispatchEvent(event);
            this.clearGridHighlights();

            isDragging = false;
        });
    }

    setAnimationsEnabled(enabled) {
        this.animationsEnabled = enabled;
    }

    // Enable resize functionality
    enableResize(card) {
        const resizeHandle = card.querySelector('.bookmark-resize-handle');
        if (!resizeHandle) return;

        let isResizing = false;
        let startX = 0;
        let startY = 0;
        let startWidth = 0;
        let startHeight = 0;
        let gridActive = false;
        let gridContainer = null;

        resizeHandle.addEventListener('mousedown', (e) => {
            if (this.workspaceLocked) return;
            if (this.selectedElements.size > 0) return;
            e.stopPropagation(); // Prevent drag
            e.preventDefault();

            isResizing = true;
            startX = e.clientX;
            startY = e.clientY;
            startWidth = card.offsetWidth;
            startHeight = card.offsetHeight;
            gridContainer = card.parentElement;
            this.beginGridInteraction(gridContainer);
            gridActive = true;

            card.classList.add('resizing');
            card.draggable = false; // Disable drag while resizing

            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        });

        const handleMouseMove = (e) => {
            if (!isResizing) return;

            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;

            let newWidth = startWidth + deltaX;
            let newHeight = startHeight + deltaY;

            // Snap to grid
            newWidth = Math.round(newWidth / this.snapGridSize) * this.snapGridSize;
            newHeight = Math.round(newHeight / this.snapGridSize) * this.snapGridSize;

            // Minimum size (increased to fit buttons)
            newWidth = Math.max(150, newWidth);
            newHeight = Math.max(150, newHeight);

            // Maximum size
            newWidth = Math.min(600, newWidth);
            newHeight = Math.min(600, newHeight);

            card.style.width = newWidth + 'px';
            card.style.height = newHeight + 'px';
            this.updateGridHighlightsForElements([card], card.parentElement);
        };

        const handleMouseUp = (e) => {
            if (!isResizing) return;

            isResizing = false;
            card.classList.remove('resizing');
            card.draggable = true;

            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);

            // Save new size
            const bookmarkId = card.dataset.id;
            const newWidth = card.offsetWidth;
            const newHeight = card.offsetHeight;

            if (gridActive) {
                this.endGridInteraction(gridContainer);
                gridActive = false;
                gridContainer = null;
            }

            const event = new CustomEvent('bookmark-resized', {
                detail: {
                    bookmarkId: bookmarkId,
                    width: newWidth,
                    height: newHeight
                }
            });
            document.dispatchEvent(event);
            this.clearGridHighlights();
        };

        // Touch support for resize
        resizeHandle.addEventListener('touchstart', (e) => {
            if (this.workspaceLocked) return;
            e.stopPropagation();
            e.preventDefault();

            const touch = e.touches[0];
            isResizing = true;
            startX = touch.clientX;
            startY = touch.clientY;
            startWidth = card.offsetWidth;
            startHeight = card.offsetHeight;
            gridContainer = card.parentElement;
            this.beginGridInteraction(gridContainer);
            gridActive = true;

            card.classList.add('resizing');
        });

        resizeHandle.addEventListener('touchmove', (e) => {
            if (this.workspaceLocked) return;
            if (!isResizing) return;

            e.preventDefault();
            const touch = e.touches[0];

            const deltaX = touch.clientX - startX;
            const deltaY = touch.clientY - startY;

            let newWidth = startWidth + deltaX;
            let newHeight = startHeight + deltaY;

            // Snap to grid
            newWidth = Math.round(newWidth / this.snapGridSize) * this.snapGridSize;
            newHeight = Math.round(newHeight / this.snapGridSize) * this.snapGridSize;

            newWidth = Math.max(150, Math.min(600, newWidth));
            newHeight = Math.max(150, Math.min(600, newHeight));

            card.style.width = newWidth + 'px';
            card.style.height = newHeight + 'px';
            this.updateGridHighlightsForElements([card], card.parentElement);
        });

        resizeHandle.addEventListener('touchend', (e) => {
            if (this.workspaceLocked) return;
            if (!isResizing) return;

            isResizing = false;
            card.classList.remove('resizing');

            if (gridActive) {
                this.endGridInteraction(gridContainer);
                gridActive = false;
                gridContainer = null;
            }

            // Save new size
            const bookmarkId = card.dataset.id;
            const event = new CustomEvent('bookmark-resized', {
                detail: {
                    bookmarkId: bookmarkId,
                    width: card.offsetWidth,
                    height: card.offsetHeight
                }
            });
            document.dispatchEvent(event);
            this.clearGridHighlights();
        });
    }

    // Enable resize for folder cards
    enableFolderResize(card) {
        const resizeHandle = card.querySelector('.bookmark-resize-handle');
        if (!resizeHandle) return;

        let isResizing = false;
        let startX = 0;
        let startY = 0;
        let startWidth = 0;
        let startHeight = 0;
        let gridActive = false;
        let gridContainer = null;

        resizeHandle.addEventListener('mousedown', (e) => {
            if (this.workspaceLocked) return;
            if (this.selectedElements.size > 0) return;
            e.stopPropagation();
            e.preventDefault();

            isResizing = true;
            startX = e.clientX;
            startY = e.clientY;
            startWidth = card.offsetWidth;
            startHeight = card.offsetHeight;
            gridContainer = card.parentElement;
            this.beginGridInteraction(gridContainer);
            gridActive = true;

            card.classList.add('resizing');

            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        });

        const handleMouseMove = (e) => {
            if (this.workspaceLocked) return;
            if (!isResizing) return;

            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;

            let newWidth = startWidth + deltaX;
            let newHeight = startHeight + deltaY;

            newWidth = Math.round(newWidth / this.snapGridSize) * this.snapGridSize;
            newHeight = Math.round(newHeight / this.snapGridSize) * this.snapGridSize;

            newWidth = Math.max(150, Math.min(600, newWidth));
            newHeight = Math.max(150, Math.min(600, newHeight));

            card.style.width = newWidth + 'px';
            card.style.height = newHeight + 'px';
            this.updateGridHighlightsForElements([card], card.parentElement);
        };

        const handleMouseUp = (e) => {
            if (!isResizing) return;

            isResizing = false;
            card.classList.remove('resizing');

            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);

            // Save folder size
            const folderId = card.dataset.folderId;
            const event = new CustomEvent('folder-resized', {
                detail: {
                    folderId: folderId,
                    width: card.offsetWidth,
                    height: card.offsetHeight
                }
            });
            document.dispatchEvent(event);
            this.clearGridHighlights();
            if (gridActive) {
                this.endGridInteraction(gridContainer);
                gridActive = false;
                gridContainer = null;
            }
        };
    }

    // Highlight folder when bookmark is dragged over it
    highlightFolderUnderBookmark(bookmarkCard) {
        const folderId = this.checkDropOnFolder(bookmarkCard);

        // Clear all highlights first
        const allFolders = document.querySelectorAll('.folder-card');
        allFolders.forEach(folder => folder.classList.remove('drop-target'));

        // Add highlight to folder under bookmark
        if (folderId) {
            const folder = document.querySelector(`.folder-card[data-folder-id="${folderId}"]`);
            if (folder) {
                folder.classList.add('drop-target');
            }
        }
    }

    // Clear all folder highlights
    clearFolderHighlights() {
        const allFolders = document.querySelectorAll('.folder-card');
        allFolders.forEach(folder => folder.classList.remove('drop-target'));
    }

    // Check if bookmark is dropped on a folder
    checkDropOnFolder(bookmarkCard) {
        const bookmarkRect = bookmarkCard.getBoundingClientRect();
        const bookmarkCenterX = bookmarkRect.left + bookmarkRect.width / 2;
        const bookmarkCenterY = bookmarkRect.top + bookmarkRect.height / 2;

        // Get all folder cards
        const folders = document.querySelectorAll('.folder-card');

        for (const folder of folders) {
            const folderRect = folder.getBoundingClientRect();

            // Check if bookmark center is within folder bounds
            if (
                bookmarkCenterX >= folderRect.left &&
                bookmarkCenterX <= folderRect.right &&
                bookmarkCenterY >= folderRect.top &&
                bookmarkCenterY <= folderRect.bottom
            ) {
                return folder.dataset.folderId;
            }
        }

        return null;
    }

    // Enable drag for sorting in grid layout (folders)
    enableGridSortDrag(card, container) {
        card.draggable = true;
        let hasDragged = false;

        card.addEventListener('dragstart', (e) => {
            if (this.workspaceLocked) {
                e.preventDefault();
                return;
            }
            // Ignore if clicking on buttons
            if (e.target.closest('.bookmark-actions')) {
                e.preventDefault();
                return;
            }

            hasDragged = true;
            card.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/html', card.innerHTML);

            // Block clicks for a moment
            card.dataset.wasDragging = 'true';
        });

        card.addEventListener('dragend', (e) => {
            card.classList.remove('dragging');

            if (hasDragged) {
                // Get all cards and their current order
                const allCards = Array.from(container.querySelectorAll('.bookmark-card'));
                const bookmarkIds = allCards.map(c => c.dataset.id);

                // Dispatch event with new order
                const event = new CustomEvent('bookmarks-reordered-in-folder', {
                    detail: { bookmarkIds }
                });
                document.dispatchEvent(event);
            }

            // Reset drag flag after a short delay
            setTimeout(() => {
                delete card.dataset.wasDragging;
                hasDragged = false;
            }, 100);
        });

        card.addEventListener('dragover', (e) => {
            e.preventDefault();
            const draggingCard = container.querySelector('.dragging');
            if (!draggingCard || draggingCard === card) return;

            // Get all cards
            const cards = Array.from(container.querySelectorAll('.bookmark-card:not(.dragging)'));
            const nextCard = cards.find(c => {
                const box = c.getBoundingClientRect();
                const offset = e.clientY - box.top - box.height / 2;
                return offset < 0;
            });

            if (nextCard) {
                container.insertBefore(draggingCard, nextCard);
            } else {
                container.appendChild(draggingCard);
            }
        });
    }

    // Cleanup
    destroy() {
        this.draggedElement = null;
    }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DragDropManager;
}

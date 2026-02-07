/**
 * Layers App
 * Main entry point
 *
 * @module app
 */

import { LayersRenderer } from './noisemaker/renderer.js'
import { createMediaLayer, createEffectLayer, createChildEffect } from './layers/layer-model.js'
import './layers/layer-stack.js'
import { EffectParams } from './layers/effect-params.js'
import { openDialog } from './ui/open-dialog.js'
import { addLayerDialog } from './ui/add-layer-dialog.js'
import { aboutDialog } from './ui/about-dialog.js'
import { saveProjectDialog } from './ui/save-project-dialog.js'
import { projectManagerDialog } from './ui/project-manager-dialog.js'
import { confirmDialog } from './ui/confirm-dialog.js'
import { infoDialog } from './ui/info-dialog.js'
import { toast } from './ui/toast.js'
import { imageSizeDialog } from './ui/image-size-dialog.js'
import { canvasResizeDialog } from './ui/canvas-resize-dialog.js'
import { exportPng, exportJpg, getTimestampedFilename } from './utils/export.js'
import { saveProject, loadProject } from './utils/project-storage.js'
import { registerServiceWorker } from './sw-register.js'
import { SelectionManager } from './selection/selection-manager.js'
import { copySelection, pasteFromClipboard, getSelectionBounds } from './selection/clipboard-ops.js'
import { MoveTool } from './tools/move-tool.js'
import { UndoManager } from './utils/undo-manager.js'
import { invertMask, expandMask, contractMask, borderMask, featherMask, smoothMask, colorRange } from './selection/selection-modify.js'
import { selectionParamDialog } from './ui/selection-param-dialog.js'
import { Files } from './utils/files.js'
import { ExportImageDialog } from './ui/export-image-dialog.js'
import { ExportVideoDialog } from './ui/export-video-dialog.js'
import { getFontaineLoader, BASE_FONTS } from './layers/fontaine-loader.js'

/**
 * Main application class
 */
class LayersApp {
    constructor() {
        this._renderer = null
        this._layerStack = null
        this._layers = []
        this._initialized = false
        this._currentProjectId = null
        this._currentProjectName = null
        this._isDirty = false
        this._zoomMode = 'fit' // 'fit', '50', '100', '200'
        this._selectionManager = null
        this._copyOrigin = null
        this._moveTool = null
        this._currentTool = 'selection' // 'selection' | 'move'

        // Layer reorder FSM state
        this._reorderState = 'IDLE'  // IDLE | DRAGGING | PROCESSING | ROLLING_BACK
        this._reorderSnapshot = null  // { layers, dsl }
        this._reorderSource = null    // { layerId, index }

        // Undo/redo
        this._undoManager = new UndoManager(50)
        this._undoDebounceTimer = null
        this._restoring = false
    }

    /**
     * Mark the project as having unsaved changes
     * @private
     */
    _markDirty() {
        this._isDirty = true
    }

    /**
     * Mark the project as saved (no unsaved changes)
     * @private
     */
    _markClean() {
        this._isDirty = false
    }

    /**
     * Deep-clone the layer array for undo snapshots.
     * File objects are immutable so sharing references is fine.
     * @returns {Array} Cloned layer array
     * @private
     */
    _cloneLayers(layers) {
        return layers.map(l => ({
            ...l,
            effectParams: JSON.parse(JSON.stringify(l.effectParams)),
            children: (l.children || []).map(c => ({
                ...c,
                effectParams: JSON.parse(JSON.stringify(c.effectParams))
            }))
        }))
    }

    /**
     * Push current state onto the undo stack (call AFTER mutation).
     * Cancels any pending debounce timer.
     * @private
     */
    _pushUndoState() {
        if (this._undoDebounceTimer) {
            clearTimeout(this._undoDebounceTimer)
            this._undoDebounceTimer = null
        }
        this._undoManager.pushState({
            layers: this._cloneLayers(this._layers),
            canvasWidth: this._canvas.width,
            canvasHeight: this._canvas.height
        })
        this._updateUndoMenuState()
    }

    /**
     * Push undo state after a delay, coalescing rapid changes (slider drags).
     * Each call resets the 500ms timer. When the timer fires, the final
     * state is committed as one undo step.
     * @private
     */
    _pushUndoStateDebounced() {
        if (this._undoDebounceTimer) {
            clearTimeout(this._undoDebounceTimer)
        }
        this._undoDebounceTimer = setTimeout(() => {
            this._undoDebounceTimer = null
            this._pushUndoState()
        }, 500)
        // Update menu immediately so undo shows as available
        this._updateUndoMenuState()
    }

    /**
     * If a debounce timer is pending, finalize it immediately.
     * Call this before any non-debounced mutation so slider changes
     * get their own undo step.
     * @private
     */
    _finalizePendingUndo() {
        if (this._undoDebounceTimer) {
            clearTimeout(this._undoDebounceTimer)
            this._undoDebounceTimer = null
            this._pushUndoState()
        }
    }

    /**
     * Restore a snapshot from the undo stack
     * @param {object} snapshot - { layers, canvasWidth, canvasHeight }
     * @private
     */
    async _restoreState(snapshot) {
        // Unload all current media
        for (const layer of this._layers) {
            if (layer.sourceType === 'media') {
                this._renderer.unloadMedia(layer.id)
            }
        }

        // Restore layers (deep clone to avoid aliasing with the stack)
        this._layers = this._cloneLayers(snapshot.layers)

        // Resize canvas if dimensions changed
        if (snapshot.canvasWidth !== this._canvas.width ||
            snapshot.canvasHeight !== this._canvas.height) {
            this._renderer.stop()
            this._resizeCanvas(snapshot.canvasWidth, snapshot.canvasHeight)
        }

        // Reload media for any media layers
        for (const layer of this._layers) {
            if (layer.sourceType === 'media' && layer.mediaFile) {
                await this._renderer.loadMedia(layer.id, layer.mediaFile, layer.mediaType)
            }
        }

        this._updateLayerStack()
        await this._rebuild({ force: true })

        // Restart renderer if it was stopped
        if (!this._renderer.isRunning) {
            await new Promise(resolve => requestAnimationFrame(resolve))
            this._renderer.start()
        }

        this._updateUndoMenuState()
        this._markDirty()
    }

    /**
     * Undo the last action
     * @private
     */
    async _undo() {
        if (this._restoring) return
        this._finalizePendingUndo()
        const snapshot = this._undoManager.undo()
        if (snapshot) {
            this._restoring = true
            try { await this._restoreState(snapshot) }
            finally { this._restoring = false }
        }
    }

    /**
     * Redo the last undone action
     * @private
     */
    async _redo() {
        if (this._restoring) return
        this._finalizePendingUndo()
        const snapshot = this._undoManager.redo()
        if (snapshot) {
            this._restoring = true
            try { await this._restoreState(snapshot) }
            finally { this._restoring = false }
        }
    }

    /**
     * Update undo/redo menu item disabled states
     * @private
     */
    _updateUndoMenuState() {
        const undoItem = document.getElementById('undoMenuItem')
        const redoItem = document.getElementById('redoMenuItem')
        // Pending debounce timer means uncommitted changes exist that _undo() can finalize
        const canUndo = this._undoManager.canUndo() || this._undoDebounceTimer !== null
        if (undoItem) undoItem.classList.toggle('disabled', !canUndo)
        if (redoItem) redoItem.classList.toggle('disabled', !this._undoManager.canRedo())
    }

    /**
     * Check for unsaved changes and prompt user
     * @returns {Promise<boolean>} true if ok to proceed, false to cancel
     * @private
     */
    async _confirmUnsavedChanges() {
        if (!this._isDirty) {
            return true
        }

        return confirmDialog.show({
            message: 'You have unsaved changes. Discard them?',
            confirmText: 'Discard',
            cancelText: 'Cancel',
            danger: true
        })
    }

    /**
     * Initialize the application
     */
    async init() {
        console.debug('[Layers] Initializing...')

        // Register service worker for PWA support (disabled)
        // registerServiceWorker()

        // Get DOM elements
        this._canvas = document.getElementById('canvas')
        this._layerStack = document.querySelector('layer-stack')

        // Get selection overlay
        this._selectionOverlay = document.getElementById('selectionOverlay')

        // Initialize selection manager
        this._selectionManager = new SelectionManager()
        if (this._selectionOverlay) {
            this._selectionManager.init(this._selectionOverlay)
        }

        // Set source canvas for magic wand
        this._selectionManager.setSourceCanvas(this._canvas)
        this._selectionManager.onSelectionChange = () => {
            this._updateImageMenu()
            this._updateSelectMenu()
        }

        const getLayerPosition = (layer) => {
            if (layer?.effectId === 'filter/text') {
                return {
                    x: (layer.effectParams?.posX ?? 0.5) * this._canvas.width,
                    y: (layer.effectParams?.posY ?? 0.5) * this._canvas.height
                }
            }
            return { x: layer?.offsetX || 0, y: layer?.offsetY || 0 }
        }

        // Initialize move tool (destructive - punches holes)
        this._moveTool = new MoveTool({
            overlay: this._selectionOverlay,
            selectionManager: this._selectionManager,
            getActiveLayer: () => this._getActiveLayer(),
            getSelectedLayers: () => this._layerStack?.selectedLayerIds || [],
            updateLayerPosition: (x, y) => this._updateActiveLayerPosition(x, y),
            getLayerPosition,
            extractSelection: (destructive) => this._extractSelectionToLayer(destructive),
            showNoLayerDialog: () => this._showNoLayerSelectedDialog(),
            selectTopmostLayer: () => this._selectTopmostLayer(),
            isLayerBlocked: (layer) => {
                if (layer?.mediaType === 'video') {
                    toast.warning('Move tool not available for video layers')
                    return true
                }
                return false
            },
            destructive: true,
            toolClass: 'move-tool'
        })

        // Initialize clone tool (non-destructive - just clones)
        this._cloneTool = new MoveTool({
            overlay: this._selectionOverlay,
            selectionManager: this._selectionManager,
            getActiveLayer: () => this._getActiveLayer(),
            getSelectedLayers: () => this._layerStack?.selectedLayerIds || [],
            updateLayerPosition: (x, y) => this._updateActiveLayerPosition(x, y),
            getLayerPosition,
            extractSelection: (destructive) => this._extractSelectionToLayer(destructive),
            showNoLayerDialog: () => this._showNoLayerSelectedDialog(),
            selectTopmostLayer: () => this._selectTopmostLayer(),
            duplicateLayer: () => this._duplicateActiveLayer(),
            onComplete: () => this._onCloneComplete(),
            destructive: false,
            toolClass: 'clone-tool'
        })

        if (!this._canvas) {
            console.error('[Layers] Canvas not found')
            return
        }

        // Create renderer (let it create its own WebGL context)
        this._renderer = new LayersRenderer(this._canvas, {
            // Initial size - will be updated when media is loaded
            width: this._canvas.width || 1024,
            height: this._canvas.height || 1024,
            loopDuration: 10,
            onError: (err) => {
                console.error('[Layers] Render error:', err)
                toast.error('Render error: ' + err.message)
            }
        })

        // Initialize renderer
        try {
            await this._renderer.init()

            // Set up effect loader for effect-params components
            EffectParams.setEffectLoader((effectId) =>
                this._renderer.getEffectDefinition(effectId)
            )
        } catch (err) {
            console.error('[Layers] Failed to initialize renderer:', err)
            toast.error('Failed to initialize renderer')
            return
        }

        // Set up event listeners
        this._setupMenuHandlers()
        this._setupLayerStackHandlers()
        this._setupLayerMenuHandlers()
        this._setupKeyboardShortcuts()

        // Export system
        this._files = new Files()
        this._exportImageDialog = new ExportImageDialog({
            files: this._files,
            canvas: this._canvas,
            getResolution: () => ({ width: this._canvas.width, height: this._canvas.height }),
            setResolution: (w, h) => this._resizeCanvas(w, h),
            onComplete: (format) => toast.success(`Exported as ${format.toUpperCase()}`),
            onCancel: () => {}
        })
        this._exportVideoDialog = new ExportVideoDialog({
            files: this._files,
            renderer: this._renderer,
            canvas: this._canvas,
            getResolution: () => ({ width: this._canvas.width, height: this._canvas.height }),
            setResolution: (w, h) => this._resizeCanvas(w, h),
            onComplete: (format) => toast.success(`Exported as ${format.toUpperCase()}`),
            onCancel: () => {}
        })

        // Set initial tool state
        this._setToolMode('selection')
        this._updateLayerMenu()

        // Recalculate fit on window resize
        window.addEventListener('resize', () => {
            if (this._zoomMode === 'fit') {
                this._applyZoom()
            }
        })

        // Apply default zoom mode
        this._applyZoom()

        // Hide loading screen and show open dialog
        this._hideLoadingScreen()
        this._showOpenDialog()

        this._initialized = true
        console.debug('[Layers] Ready')
    }

    /**
     * Hide the loading screen
     * @private
     */
    _hideLoadingScreen() {
        const loadingScreen = document.getElementById('loading-screen')
        if (loadingScreen) {
            loadingScreen.classList.add('fade-out')
            setTimeout(() => {
                loadingScreen.classList.add('hidden')
            }, 350)
        }
    }

    /**
     * Show the open dialog to select initial base layer
     * @private
     */
    _showOpenDialog() {
        openDialog.show({
            onOpen: async (file, mediaType) => {
                await this._handleOpenMedia(file, mediaType)
            },
            onSolid: async (width, height) => {
                await this._handleCreateSolidBase(width, height)
            },
            onGradient: async (width, height) => {
                await this._handleCreateGradientBase(width, height)
            },
            onTransparent: async (width, height) => {
                await this._handleCreateTransparentBase(width, height)
            },
            onLoadProject: () => {
                this._showLoadProjectDialog(true)
            }
        })
    }

    /**
     * Create a base layer and initialize the project
     * @param {object} layer - Layer object to use as base
     * @param {number} width - Canvas width
     * @param {number} height - Canvas height
     * @param {string} successMessage - Toast message on success
     * @private
     */
    async _initializeBaseLayer(layer, width, height, successMessage) {
        this._layers = [layer]
        this._updateLayerStack()

        // Select the layer
        if (this._layerStack) {
            this._layerStack.selectedLayerId = layer.id
        }

        // Set canvas dimensions first
        this._resizeCanvas(width, height)
        // Wait for any pending microtasks (canvas observer uses queueMicrotask)
        await new Promise(resolve => queueMicrotask(resolve))
        // Compile pipeline at correct dimensions
        await this._rebuild()
        // Wait for next frame to ensure WebGL state is stable
        await new Promise(resolve => requestAnimationFrame(resolve))
        this._renderer.start()

        this._currentProjectId = null
        this._currentProjectName = null
        this._markDirty()

        this._undoManager.clear()
        this._pushUndoState()

        openDialog.element.close()
        toast.success(successMessage)
    }

    /**
     * Create a solid color base layer
     * @param {number} width - Canvas width
     * @param {number} height - Canvas height
     * @private
     */
    async _handleCreateSolidBase(width = 1024, height = 1024) {
        const layer = createEffectLayer('synth/solid')
        layer.name = 'Solid'
        layer.effectParams = { color: [0.2, 0.2, 0.2], alpha: 1 }

        await this._initializeBaseLayer(layer, width, height, 'Created solid base layer')
    }

    /**
     * Create a gradient base layer
     * @param {number} width - Canvas width
     * @param {number} height - Canvas height
     * @private
     */
    async _handleCreateGradientBase(width = 1024, height = 1024) {
        const layer = createEffectLayer('synth/gradient')
        layer.name = 'Gradient'

        await this._initializeBaseLayer(layer, width, height, 'Created gradient base layer')
    }

    /**
     * Create a transparent base layer
     * @param {number} width - Canvas width
     * @param {number} height - Canvas height
     * @private
     */
    async _handleCreateTransparentBase(width = 1024, height = 1024) {
        const layer = createEffectLayer('synth/solid')
        layer.name = 'Transparent'
        layer.effectParams = { color: [0, 0, 0], alpha: 0 }

        await this._initializeBaseLayer(layer, width, height, 'Created transparent base layer')
    }

    /**
     * Handle opening a media file
     * @param {File} file - Media file
     * @param {string} mediaType - 'image' or 'video'
     * @private
     */
    async _handleOpenMedia(file, mediaType) {
        // Create base layer
        const layer = createMediaLayer(file, mediaType)
        this._layers = [layer]

        // Load media into renderer
        let dimensions = { width: 0, height: 0 }
        try {
            dimensions = await this._renderer.loadMedia(layer.id, file, mediaType)
        } catch (err) {
            console.error('[Layers] Failed to load media:', err)
            toast.error('Failed to load media: ' + err.message)
            return
        }

        // Update layer stack
        this._updateLayerStack()

        // Select the layer
        if (this._layerStack) {
            this._layerStack.selectedLayerId = layer.id
        }

        // Resize canvas to match base layer media dimensions
        if (dimensions.width > 0 && dimensions.height > 0) {
            this._resizeCanvas(dimensions.width, dimensions.height)
        }

        // Wait for any pending microtasks (canvas observer uses queueMicrotask)
        await new Promise(resolve => queueMicrotask(resolve))
        // Compile pipeline at correct dimensions
        await this._rebuild()

        // Wait for next frame to ensure WebGL state is stable
        await new Promise(resolve => requestAnimationFrame(resolve))
        this._renderer.start()

        // Reset project state and update filename
        this._currentProjectId = null
        this._currentProjectName = null
        this._markDirty()

        this._undoManager.clear()
        this._pushUndoState()

        // Close the open dialog
        openDialog.element.close()
        toast.success(`Opened ${file.name}`)
    }

    /**
     * Handle adding a media layer
     * @param {File} file - Media file
     * @param {string} mediaType - 'image' or 'video'
     * @private
     */
    async _handleAddMediaLayer(file, mediaType) {
        this._finalizePendingUndo()
        const layer = createMediaLayer(file, mediaType)
        this._layers.push(layer)

        // Load media
        await this._renderer.loadMedia(layer.id, file, mediaType)

        // Update and rebuild
        this._updateLayerStack()
        await this._rebuild()
        this._markDirty()
        this._pushUndoState()

        // Select the new layer
        if (this._layerStack) {
            this._layerStack.selectedLayerId = layer.id
        }

        toast.success(`Added layer: ${layer.name}`)
    }

    /**
     * Handle adding an effect layer
     * @param {string} effectId - Effect ID
     * @private
     */
    async _handleAddEffectLayer(effectId) {
        this._finalizePendingUndo()
        const layer = createEffectLayer(effectId)
        this._layers.push(layer)

        // Update and rebuild
        this._updateLayerStack()
        await this._rebuild()
        this._markDirty()
        this._pushUndoState()

        // Select the new layer
        if (this._layerStack) {
            this._layerStack.selectedLayerId = layer.id
        }

        toast.success(`Added layer: ${layer.name}`)
    }

    /**
     * Add a child effect to a parent layer
     * @param {string} parentLayerId - Parent layer ID
     * @param {string} effectId - Effect ID to add
     * @private
     */
    async _handleAddChildEffect(parentLayerId, effectId) {
        const parent = this._layers.find(l => l.id === parentLayerId)
        if (!parent) return

        this._finalizePendingUndo()

        const child = createChildEffect(effectId)
        if (!parent.children) parent.children = []
        parent.children.push(child)

        this._updateLayerStack()
        await this._rebuild()
        this._markDirty()
        this._pushUndoState()

        // Select the new child
        if (this._layerStack) {
            this._layerStack.selectedLayerId = child.id
        }

        toast.success(`Added effect: ${child.name}`)
    }

    /**
     * Reset all layers (for new project)
     * @private
     */
    _resetLayers() {
        if (this._undoDebounceTimer) {
            clearTimeout(this._undoDebounceTimer)
            this._undoDebounceTimer = null
        }
        this._layers.forEach(l => {
            if (l.sourceType === 'media') {
                this._renderer.unloadMedia(l.id)
            }
        })
        this._layers = []
        this._undoManager.clear()
        this._updateUndoMenuState()
    }

    /**
     * Handle deleting a layer
     * @param {string} layerId - Layer ID to delete
     * @param {string} [parentLayerId] - Parent layer ID if deleting a child effect
     * @private
     */
    async _handleDeleteLayer(layerId, parentLayerId) {
        if (parentLayerId) {
            // Deleting a child effect
            const parent = this._layers.find(l => l.id === parentLayerId)
            if (!parent || !parent.children) return

            const childIndex = parent.children.findIndex(c => c.id === layerId)
            if (childIndex < 0) return

            this._finalizePendingUndo()
            const child = parent.children[childIndex]
            parent.children.splice(childIndex, 1)

            this._updateLayerStack()
            await this._rebuild()
            this._markDirty()
            this._pushUndoState()

            toast.info(`Deleted effect: ${child.name}`)
            return
        }

        // Existing top-level layer delete logic
        const index = this._layers.findIndex(l => l.id === layerId)
        if (index <= 0) return // Can't delete base layer

        this._finalizePendingUndo()
        const layer = this._layers[index]

        // Unload media if needed
        if (layer.sourceType === 'media') {
            this._renderer.unloadMedia(layerId)
        }

        // Remove layer
        this._layers.splice(index, 1)

        // Update and rebuild
        this._updateLayerStack()
        await this._rebuild()
        this._markDirty()
        this._pushUndoState()

        toast.info(`Deleted layer: ${layer.name}`)
    }

    /**
     * Handle layer changes (visibility, blend mode, opacity, effectParams)
     * @param {object} detail - Change detail
     * @private
     */
    async _handleLayerChange(detail) {
        const isDebounced = detail.property === 'effectParams' || detail.property === 'opacity'
        if (!isDebounced) {
            this._finalizePendingUndo()
        }

        // Find the target — either a child or a top-level layer
        let layer
        if (detail.parentLayerId) {
            const parent = this._layers.find(l => l.id === detail.parentLayerId)
            layer = parent?.children?.find(c => c.id === detail.layerId)
        } else {
            layer = this._layers.find(l => l.id === detail.layerId)
        }

        if (layer) {
            layer[detail.property] = detail.value
        }

        this._markDirty()

        // Handle child-specific property changes
        if (detail.parentLayerId) {
            if (detail.property === 'effectParams') {
                this._renderer.updateLayerParams(detail.layerId, detail.value)
                this._renderer.syncDsl()
                this._pushUndoStateDebounced()
            } else {
                await this._rebuild()
                this._pushUndoState()
            }
            return
        }

        // Determine if this requires a full rebuild or just a parameter update
        switch (detail.property) {
            case 'effectParams':
                // Update parameters directly without recompiling
                this._renderer.updateLayerParams(detail.layerId, detail.value)
                // Keep DSL in sync to prevent spurious rebuild on next structural change
                this._renderer.syncDsl()
                this._pushUndoStateDebounced()
                break

            case 'opacity':
                // Base layer opacity requires rebuild (alpha baked into DSL)
                // Non-base layers can update via blendMode uniform
                const layerIdx = this._layers.findIndex(l => l.id === detail.layerId)
                if (layerIdx === 0) {
                    // Base layer - rebuild with new alpha value
                    await this._rebuild()
                } else {
                    // Non-base layer - update opacity via blendMode uniform
                    this._renderer.updateLayerOpacity(detail.layerId, detail.value)
                    // Keep DSL in sync to prevent spurious rebuild on next structural change
                    this._renderer.syncDsl()
                }
                this._pushUndoStateDebounced()
                break

            case 'visibility':
            case 'blendMode':
                // Structural changes require full rebuild
                await this._rebuild()
                this._pushUndoState()
                break

            default:
                // Unknown property - rebuild to be safe
                await this._rebuild()
                this._pushUndoState()
        }
    }

    /**
     * FSM: Start drag operation (IDLE → DRAGGING)
     * @param {string} layerId - Layer being dragged
     * @private
     */
    _startDrag(layerId) {
        if (this._reorderState !== 'IDLE') {
            console.warn('[Layers] Cannot start drag - not in IDLE state')
            return
        }

        const sourceIndex = this._layers.findIndex(l => l.id === layerId)
        if (sourceIndex === -1 || sourceIndex === 0) {
            console.warn('[Layers] Cannot drag base layer or unknown layer')
            return
        }

        // Capture snapshot
        this._reorderSnapshot = {
            layers: JSON.parse(JSON.stringify(this._layers)),
            dsl: this._renderer._currentDsl
        }
        this._reorderSource = { layerId, index: sourceIndex }
        this._reorderState = 'DRAGGING'

        // Update z-index on all layer items
        this._updateLayerZIndex()

        console.debug('[Layers] FSM: IDLE → DRAGGING', { layerId, sourceIndex })
    }

    /**
     * FSM: Cancel drag operation (DRAGGING → IDLE)
     * @private
     */
    _cancelDrag() {
        if (this._reorderState !== 'DRAGGING') return

        this._reorderSnapshot = null
        this._reorderSource = null
        this._reorderState = 'IDLE'

        // Clear any drag-over indicators
        this._clearDragIndicators()

        console.debug('[Layers] FSM: DRAGGING → IDLE (cancelled)')
    }

    /**
     * Update z-index on layer items based on stack position
     * @private
     */
    _updateLayerZIndex() {
        const items = this._layerStack?.querySelectorAll('layer-item')
        if (!items) return

        const count = items.length
        items.forEach((item, domIndex) => {
            // DOM order is top-to-bottom, so first item = highest z-index
            item.style.zIndex = count - domIndex
        })
    }

    /**
     * Clear all drag indicator classes from layer items
     * @private
     */
    _clearDragIndicators() {
        const items = this._layerStack?.querySelectorAll('layer-item')
        if (!items) return

        items.forEach(item => {
            item.classList.remove('drag-over', 'drag-over-above', 'drag-over-below', 'dragging')
        })
    }

    /**
     * Calculate new layer order based on drop position
     * @param {string} sourceId - ID of layer being moved
     * @param {string} targetId - ID of drop target layer
     * @param {string} dropPosition - 'above' or 'below'
     * @returns {Array|null} New layer order, or null if invalid
     * @private
     */
    _calculateNewOrder(sourceId, targetId, dropPosition) {
        const layers = [...this._layers]

        const sourceIdx = layers.findIndex(l => l.id === sourceId)
        const targetIdx = layers.findIndex(l => l.id === targetId)

        // Validate
        if (sourceIdx === -1 || targetIdx === -1) return null
        if (sourceIdx === 0) return null  // can't move base layer
        if (sourceIdx === targetIdx) return null  // dropping on self

        // Remove source
        const [sourceLayer] = layers.splice(sourceIdx, 1)

        // Calculate insert position on the MODIFIED array
        let insertIdx = targetIdx
        if (sourceIdx < targetIdx) {
            // Source was above target, target shifted up by 1
            insertIdx = targetIdx - 1
        }

        // Adjust for drop position
        // In our UI: higher index = visually higher (top of stack)
        // dropPosition 'above' means visually above = higher index
        // dropPosition 'below' means visually below = same or lower index
        if (dropPosition === 'above') {
            insertIdx = insertIdx + 1
        }
        // Ensure we never place at or below base layer (index 0)
        insertIdx = Math.max(1, insertIdx)

        layers.splice(insertIdx, 0, sourceLayer)
        return layers
    }

    /**
     * FSM: Process drop operation (DRAGGING → PROCESSING → IDLE or ROLLING_BACK)
     * @param {string} targetId - ID of drop target layer
     * @param {string} dropPosition - 'above' or 'below'
     * @private
     */
    async _processDrop(targetId, dropPosition) {
        if (this._reorderState !== 'DRAGGING') {
            console.warn('[Layers] Cannot process drop - not in DRAGGING state')
            return
        }

        const sourceId = this._reorderSource?.layerId
        if (!sourceId) {
            this._cancelDrag()
            return
        }

        this._reorderState = 'PROCESSING'
        console.debug('[Layers] FSM: DRAGGING → PROCESSING', { sourceId, targetId, dropPosition })

        // Clear visual indicators
        this._clearDragIndicators()

        // Calculate new order
        const newLayers = this._calculateNewOrder(sourceId, targetId, dropPosition)
        if (!newLayers) {
            console.debug('[Layers] Invalid reorder - returning to IDLE')
            this._reorderState = 'IDLE'
            this._reorderSnapshot = null
            this._reorderSource = null
            return
        }

        // Generate and validate new DSL
        try {
            const newDsl = this._renderer.buildDslFromLayers(newLayers)
            const result = await this._renderer.tryCompile(newDsl)

            if (result.success) {
                this._finalizePendingUndo()

                // Commit the change
                this._layers = newLayers
                // Force rebuild to update layer-step mapping even if DSL is unchanged
                // (DSL may be string-identical after reorder when layers have same effects)
                await this._rebuild({ force: true })
                this._updateLayerStack()
                this._updateLayerZIndex()
                this._markDirty()
                this._pushUndoState()

                this._reorderState = 'IDLE'
                this._reorderSnapshot = null
                this._reorderSource = null

                console.debug('[Layers] FSM: PROCESSING → IDLE (success)')
            } else {
                // Validation failed - rollback
                await this._rollback(result.error || 'DSL validation failed')
            }
        } catch (err) {
            await this._rollback(err.message || String(err))
        }
    }

    /**
     * FSM: Rollback failed reorder (PROCESSING → ROLLING_BACK → IDLE)
     * @param {string} error - Error message
     * @private
     */
    async _rollback(error) {
        this._reorderState = 'ROLLING_BACK'
        console.debug('[Layers] FSM: PROCESSING → ROLLING_BACK', { error })

        // Restore snapshot
        if (this._reorderSnapshot) {
            this._layers = this._reorderSnapshot.layers
            await this._rebuild()
            this._updateLayerStack()
        }

        // Show error to user
        toast.error(`Layer reorder failed: ${error}. Changes reverted.`)

        this._reorderState = 'IDLE'
        this._reorderSnapshot = null
        this._reorderSource = null

        console.debug('[Layers] FSM: ROLLING_BACK → IDLE')
    }

    /**
     * Update the layer stack component
     * @private
     */
    _updateLayerStack() {
        // Re-query in case the element wasn't ready before
        if (!this._layerStack) {
            this._layerStack = document.querySelector('layer-stack')
        }

        if (this._layerStack) {
            this._layerStack.layers = this._layers
        } else {
            console.error('[Layers] layer-stack element not found!')
        }

        this._updateLayerMenu()
    }

    /**
     * Save visibility state of all layers
     * @returns {Map<string, boolean>}
     * @private
     */
    _saveVisibility() {
        return new Map(this._layers.map(l => [l.id, l.visible]))
    }

    /**
     * Restore previously saved visibility state
     * @param {Map<string, boolean>} snapshot
     * @private
     */
    _restoreVisibility(snapshot) {
        for (const l of this._layers) {
            if (snapshot.has(l.id)) l.visible = snapshot.get(l.id)
        }
    }

    /**
     * Rebuild and render
     * @param {object} [options={}] - Options passed to renderer
     * @param {boolean} [options.force=false] - Force rebuild even if DSL unchanged
     * @private
     */
    async _rebuild(options = {}) {
        const result = await this._renderer.setLayers(this._layers, options)
        if (!result.success) {
            console.error('[Layers] Rebuild failed:', result.error)
            toast.error('Failed to render: ' + result.error)
        }
    }

    /**
     * Resize canvas to match media dimensions
     * @param {number} width - New width
     * @param {number} height - New height
     * @private
     */
    _resizeCanvas(width, height) {
        // Update canvas element
        this._canvas.width = width
        this._canvas.height = height
        
        // Update renderer
        this._renderer.resize(width, height)

        // Update selection overlay size
        if (this._selectionOverlay) {
            this._selectionOverlay.width = width
            this._selectionOverlay.height = height
        }
        if (this._selectionManager) {
            this._selectionManager.resize(width, height)
        }

        // Re-apply current zoom mode
        this._applyZoom()
    }

    /**
     * Apply the current zoom mode to the canvas
     * @private
     */
    _applyZoom() {
        const canvas = this._canvas
        if (!canvas) return

        // Update menu checkmarks
        const zoomMenuIds = {
            fit: 'fitInWindowMenuItem',
            50: 'zoom50MenuItem',
            100: 'zoom100MenuItem',
            200: 'zoom200MenuItem'
        }
        for (const [mode, id] of Object.entries(zoomMenuIds)) {
            document.getElementById(id)?.classList.toggle('checked', mode === this._zoomMode)
        }

        let displayWidth, displayHeight

        if (this._zoomMode === 'fit') {
            const container = canvas.parentElement
            const containerWidth = container.clientWidth
            const containerHeight = container.clientHeight
            const canvasAspect = canvas.width / canvas.height
            const containerAspect = containerWidth / containerHeight

            if (canvasAspect > containerAspect) {
                displayWidth = containerWidth
                displayHeight = containerWidth / canvasAspect
            } else {
                displayHeight = containerHeight
                displayWidth = containerHeight * canvasAspect
            }
        } else {
            const percent = parseInt(this._zoomMode) / 100
            displayWidth = canvas.width * percent
            displayHeight = canvas.height * percent
        }

        const widthPx = displayWidth + 'px'
        const heightPx = displayHeight + 'px'

        for (const el of [canvas, this._selectionOverlay]) {
            if (!el) continue
            el.style.maxWidth = 'none'
            el.style.maxHeight = 'none'
            el.style.width = widthPx
            el.style.height = heightPx
        }
    }

    /**
     * Set zoom mode
     * @param {string} mode - 'fit', '50', '100', or '200'
     * @private
     */
    _setZoom(mode) {
        this._zoomMode = mode
        this._applyZoom()
    }

    /**
     * Zoom in one step
     * @private
     */
    _zoomIn() {
        const steps = ['fit', '50', '100', '200']
        const currentIndex = steps.indexOf(this._zoomMode)
        // If at fit or not found, go to 100%. Otherwise go to next step.
        if (this._zoomMode === 'fit') {
            this._setZoom('100')
        } else if (currentIndex < steps.length - 1) {
            this._setZoom(steps[currentIndex + 1])
        }
    }

    /**
     * Zoom out one step
     * @private
     */
    _zoomOut() {
        const steps = ['fit', '50', '100', '200']
        const currentIndex = steps.indexOf(this._zoomMode)
        // If at fit, stay at fit. Otherwise go to previous step.
        if (currentIndex > 0) {
            this._setZoom(steps[currentIndex - 1])
        }
    }

    /**
     * Set up menu handlers
     * @private
     */
    _setupMenuHandlers() {
        // Menu dropdowns
        const menus = document.querySelectorAll('.menu')
        menus.forEach(menu => {
            const title = menu.querySelector('.menu-title')
            const items = menu.querySelector('.menu-items')

            if (title && items) {
                title.addEventListener('click', (e) => {
                    e.stopPropagation()
                    // Close other menus
                    document.querySelectorAll('.menu-items').forEach(m => {
                        if (m !== items) m.classList.add('hide')
                    })
                    items.classList.toggle('hide')
                })
            }
        })

        // Close menus on outside click
        document.addEventListener('click', () => {
            document.querySelectorAll('.menu-items').forEach(m => m.classList.add('hide'))
        })

        // Logo menu - About
        document.getElementById('aboutMenuItem')?.addEventListener('click', () => {
            aboutDialog.show()
        })

        // File menu - New / Open (both show the same open dialog with reset)
        for (const id of ['newMenuItem', 'openMenuItem']) {
            document.getElementById(id)?.addEventListener('click', async () => {
                if (!await this._confirmUnsavedChanges()) return
                openDialog.show({
                    canClose: true,
                    onOpen: async (file, mediaType) => {
                        this._resetLayers()
                        await this._handleOpenMedia(file, mediaType)
                    },
                    onSolid: async (width, height) => {
                        this._resetLayers()
                        await this._handleCreateSolidBase(width, height)
                    },
                    onGradient: async (width, height) => {
                        this._resetLayers()
                        await this._handleCreateGradientBase(width, height)
                    },
                    onTransparent: async (width, height) => {
                        this._resetLayers()
                        await this._handleCreateTransparentBase(width, height)
                    },
                    onLoadProject: () => {
                        this._showLoadProjectDialog(true)
                    }
                })
            })
        }

        // File menu - Save Project (uses Save As if no project ID)
        document.getElementById('saveProjectMenuItem')?.addEventListener('click', () => {
            if (this._currentProjectId) {
                this._quickSaveProject()
            } else {
                this._showSaveProjectDialog()
            }
        })

        // File menu - Save Project As
        document.getElementById('saveProjectAsMenuItem')?.addEventListener('click', () => {
            this._showSaveProjectAsDialog()
        })

        // File menu - Load Project
        document.getElementById('loadProjectMenuItem')?.addEventListener('click', async () => {
            if (!await this._confirmUnsavedChanges()) return
            this._showLoadProjectDialog()
        })

        document.getElementById('savePngMenuItem')?.addEventListener('click', () => {
            this._quickSavePng()
        })

        document.getElementById('saveJpgMenuItem')?.addEventListener('click', () => {
            this._quickSaveJpg()
        })

        // File menu - Export Image
        document.getElementById('exportImageMenuItem')?.addEventListener('click', () => {
            this._exportImageDialog.open()
        })

        // File menu - Export Video
        document.getElementById('exportVideoMenuItem')?.addEventListener('click', () => {
            this._exportVideoDialog.open()
        })

        // Edit menu - Undo
        document.getElementById('undoMenuItem')?.addEventListener('click', () => {
            this._undo()
        })

        // Edit menu - Redo
        document.getElementById('redoMenuItem')?.addEventListener('click', () => {
            this._redo()
        })

        // Image menu - Crop to selection
        document.getElementById('cropToSelectionMenuItem')?.addEventListener('click', async () => {
            await this._cropToSelection()
        })

        // Image menu - Image size
        document.getElementById('imageSizeMenuItem')?.addEventListener('click', () => {
            this._showImageSizeDialog()
        })

        // Image menu - Canvas size
        document.getElementById('canvasSizeMenuItem')?.addEventListener('click', () => {
            this._showCanvasSizeDialog()
        })

        // Image menu - Adjustments
        document.getElementById('invertMenuItem')?.addEventListener('click', () => {
            if (this._layers.length === 0) return
            this._handleAddEffectLayer('filter/inv')
        })
        document.getElementById('brightnessContrastMenuItem')?.addEventListener('click', () => {
            if (this._layers.length === 0) return
            this._handleAddEffectLayer('filter/bc')
        })
        document.getElementById('hueSaturationMenuItem')?.addEventListener('click', () => {
            if (this._layers.length === 0) return
            this._handleAddEffectLayer('filter/hs')
        })
        document.getElementById('blurMenuItem')?.addEventListener('click', () => {
            if (this._layers.length === 0) return
            this._handleAddEffectLayer('filter/blur')
        })
        document.getElementById('gradientPaletteMenuItem')?.addEventListener('click', () => {
            if (this._layers.length === 0) return
            this._handleAddEffectLayer('filter/tetraColorArray')
        })
        document.getElementById('cosinePaletteMenuItem')?.addEventListener('click', () => {
            if (this._layers.length === 0) return
            this._handleAddEffectLayer('filter/tetraCosine')
        })
        document.getElementById('colorGradingMenuItem')?.addEventListener('click', () => {
            if (this._layers.length === 0) return
            this._handleAddEffectLayer('filter/grade')
        })

        // Select menu - Select All
        document.getElementById('selectAllMenuItem')?.addEventListener('click', () => {
            const { width, height } = this._canvas
            this._selectionManager.setSelection({
                type: 'rect', x: 0, y: 0, width, height
            })
        })

        // Select menu - Select None
        document.getElementById('selectNoneMenuItem')?.addEventListener('click', () => {
            this._selectionManager.clearSelection()
        })

        // Select menu - Select Inverse
        document.getElementById('selectInverseMenuItem')?.addEventListener('click', () => {
            const mask = this._selectionManager.rasterizeSelection()
            if (!mask) return
            const inverted = invertMask(mask)
            this._selectionManager.setSelection({ type: 'mask', data: inverted })
        })

        // Select menu - Color Range
        document.getElementById('colorRangeMenuItem')?.addEventListener('click', () => {
            this._startColorRangePick()
        })

        // Select menu - Modify operations
        document.getElementById('borderSelectionMenuItem')?.addEventListener('click', () => {
            this._modifySelection({ title: 'Border Selection', label: 'Width', defaultValue: 1 }, borderMask)
        })
        document.getElementById('smoothSelectionMenuItem')?.addEventListener('click', () => {
            this._modifySelection({ title: 'Smooth Selection', label: 'Radius', defaultValue: 2 }, smoothMask)
        })
        document.getElementById('expandSelectionMenuItem')?.addEventListener('click', () => {
            this._modifySelection({ title: 'Expand Selection', label: 'Radius', defaultValue: 1 }, expandMask)
        })
        document.getElementById('contractSelectionMenuItem')?.addEventListener('click', () => {
            this._modifySelection({ title: 'Contract Selection', label: 'Radius', defaultValue: 1 }, contractMask)
        })
        document.getElementById('featherSelectionMenuItem')?.addEventListener('click', () => {
            this._modifySelection({ title: 'Feather Selection', label: 'Radius', defaultValue: 2 }, featherMask)
        })

        // View menu - Zoom
        document.getElementById('zoomInMenuItem')?.addEventListener('click', () => {
            this._zoomIn()
        })

        document.getElementById('zoomOutMenuItem')?.addEventListener('click', () => {
            this._zoomOut()
        })

        document.getElementById('fitInWindowMenuItem')?.addEventListener('click', () => {
            this._setZoom('fit')
        })

        document.getElementById('zoom50MenuItem')?.addEventListener('click', () => {
            this._setZoom('50')
        })

        document.getElementById('zoom100MenuItem')?.addEventListener('click', () => {
            this._setZoom('100')
        })

        document.getElementById('zoom200MenuItem')?.addEventListener('click', () => {
            this._setZoom('200')
        })

        // Text tool button (toolbar)
        document.getElementById('textToolBtn')?.addEventListener('click', () => {
            if (this._layers.length === 0) return
            this._handleAddEffectLayer('filter/text')
        })

        // Add layer button
        document.getElementById('addLayerBtn')?.addEventListener('click', () => {
            this._showAddLayerDialog()
        })

        // Selection tool menu
        document.getElementById('selectRectMenuItem')?.addEventListener('click', () => {
            this._setSelectionTool('rectangle')
        })

        document.getElementById('selectOvalMenuItem')?.addEventListener('click', () => {
            this._setSelectionTool('oval')
        })

        document.getElementById('selectLassoMenuItem')?.addEventListener('click', () => {
            this._setSelectionTool('lasso')
        })

        document.getElementById('selectPolygonMenuItem')?.addEventListener('click', () => {
            this._setSelectionTool('polygon')
        })

        document.getElementById('selectWandMenuItem')?.addEventListener('click', () => {
            this._setSelectionTool('wand')
        })

        // Tolerance slider
        document.getElementById('wandTolerance')?.addEventListener('input', (e) => {
            const value = parseInt(e.target.value, 10)
            if (this._selectionManager) {
                this._selectionManager.wandTolerance = value
            }
            const display = document.getElementById('wandToleranceValue')
            if (display) display.textContent = value
        })

        // Clone tool button
        document.getElementById('cloneToolBtn')?.addEventListener('click', () => {
            this._setToolMode('clone')
        })

        // Move tool button
        document.getElementById('moveToolBtn')?.addEventListener('click', () => {
            this._setToolMode('move')
        })

        // Play/pause button
        document.getElementById('playPauseBtn')?.addEventListener('click', () => {
            this._togglePlayPause()
        })

        // Font install dialog trigger
        document.addEventListener('font-install-request', () => {
            this._showFontInstallDialog()
        })

        // Font bundle changed (e.g., uninstall)
        document.addEventListener('font-bundle-changed', () => {
            this._refreshFontSelects()
        })
    }

    /**
     * Set up Layer menu handlers
     * @private
     */
    _setupLayerMenuHandlers() {
        document.getElementById('layerActionMenuItem')?.addEventListener('click', () => {
            const selectedIds = this._layerStack?.selectedLayerIds || []

            if (selectedIds.length === 0) {
                this._flattenImage()
            } else if (selectedIds.length === 1) {
                const layer = this._layers.find(l => l.id === selectedIds[0])
                if (layer && layer.sourceType !== 'media') {
                    this._rasterizeLayer(selectedIds[0])
                }
            } else {
                this._flattenLayers(selectedIds)
            }
        })

        document.getElementById('duplicateLayerMenuItem')?.addEventListener('click', () => {
            this._duplicateActiveLayer()
        })

        document.getElementById('deleteLayerMenuItem')?.addEventListener('click', () => {
            const selected = this._layerStack?.getSelectedLayer()
            if (selected && this._layers.indexOf(selected) > 0) {
                this._handleDeleteLayer(selected.id)
            }
        })

        document.getElementById('deselectAllLayersMenuItem')?.addEventListener('click', () => {
            this._deselectAllLayers()
        })
    }

    /**
     * Set up layer stack event handlers
     * @private
     */
    _setupLayerStackHandlers() {
        if (!this._layerStack) return

        this._layerStack.addEventListener('layer-change', (e) => {
            this._handleLayerChange(e.detail)
        })

        this._layerStack.addEventListener('layer-delete', (e) => {
            this._handleDeleteLayer(e.detail.layerId, e.detail.parentLayerId)
        })

        // Layer reorder FSM events
        this._layerStack.addEventListener('layer-drag-start', (e) => {
            this._startDrag(e.detail.layerId)
        })

        this._layerStack.addEventListener('layer-drag-end', (e) => {
            // If we're still in DRAGGING state, this means drop didn't happen
            if (this._reorderState === 'DRAGGING') {
                this._cancelDrag()
            }
        })

        this._layerStack.addEventListener('layer-drop', (e) => {
            this._processDrop(e.detail.targetId, e.detail.dropPosition)
        })

        this._layerStack.addEventListener('selection-change', () => {
            this._updateLayerMenu()
            this._updateToolButtons()
            // Switch off move tool if video layer selected
            if (this._currentTool === 'move' && this._getActiveLayer()?.mediaType === 'video') {
                this._setToolMode('selection')
            }
        })

        this._layerStack.addEventListener('child-add', (e) => {
            this._showAddChildEffectDialog(e.detail.layerId)
        })
    }

    /**
     * Update the Layer menu item based on current selection
     * @private
     */
    _updateLayerMenu() {
        const menuItem = document.getElementById('layerActionMenuItem')
        if (!menuItem) return

        const selectedIds = this._layerStack?.selectedLayerIds || []

        // Duplicate layer: enabled when exactly one layer selected
        const dupItem = document.getElementById('duplicateLayerMenuItem')
        if (dupItem) {
            dupItem.classList.toggle('disabled', selectedIds.length !== 1)
        }

        // Delete layer: enabled when exactly one non-base layer selected
        const delItem = document.getElementById('deleteLayerMenuItem')
        if (delItem) {
            const canDelete = selectedIds.length === 1 &&
                this._layers.findIndex(l => l.id === selectedIds[0]) > 0
            delItem.classList.toggle('disabled', !canDelete)
        }
        const selectedLayers = selectedIds.map(id => this._layers.find(l => l.id === id)).filter(Boolean)

        if (selectedIds.length === 0) {
            // No selection: flatten image
            menuItem.textContent = 'flatten image'
            menuItem.classList.remove('disabled')
        } else if (selectedIds.length === 1) {
            // Single layer selected
            const layer = selectedLayers[0]
            menuItem.textContent = 'rasterize layer'
            if (layer?.sourceType === 'media') {
                menuItem.classList.add('disabled')
            } else {
                menuItem.classList.remove('disabled')
            }
        } else {
            // Multiple layers selected
            menuItem.textContent = 'flatten layers'
            menuItem.classList.remove('disabled')
        }
    }

    /**
     * Flatten entire image to a single layer
     * Renders all visible layers, discards hidden layers
     * @private
     */
    async _flattenImage() {
        if (this._layers.length === 0) return

        this._finalizePendingUndo()

        // Capture current canvas (all visible layers composited)
        const offscreen = new OffscreenCanvas(this._canvas.width, this._canvas.height)
        const ctx = offscreen.getContext('2d')
        ctx.drawImage(this._canvas, 0, 0)

        // Convert to blob and create media layer
        const blob = await offscreen.convertToBlob({ type: 'image/png' })
        const file = new File([blob], 'flattened-image.png', { type: 'image/png' })

        const newLayer = createMediaLayer(file, 'image', this._currentProjectName || 'flattened image')

        // Unload all existing media
        for (const layer of this._layers) {
            if (layer.sourceType === 'media') {
                this._renderer.unloadMedia(layer.id)
            }
        }

        // Replace entire layer stack
        this._layers = [newLayer]
        await this._renderer.loadMedia(newLayer.id, file, 'image')

        // Update UI
        this._updateLayerStack()
        if (this._layerStack) {
            this._layerStack.selectedLayerId = newLayer.id
        }
        await this._rebuild()
        this._markDirty()
        this._pushUndoState()

        toast.success('Image flattened')
    }

    /**
     * Rasterize a single effect layer to media (user-facing with undo and toast)
     * @param {string} layerId
     * @private
     */
    async _rasterizeLayer(layerId) {
        const layer = this._layers.find(l => l.id === layerId)
        if (!layer || layer.sourceType === 'media') return

        this._finalizePendingUndo()

        const newId = await this._rasterizeLayerInPlace(layerId)
        if (!newId) return

        // Rename with "(rasterized)" suffix
        const newLayer = this._layers.find(l => l.id === newId)
        if (newLayer) newLayer.name = `${layer.name} (rasterized)`

        this._updateLayerStack()
        await this._rebuild()
        this._markDirty()
        this._pushUndoState()

        toast.success('Layer rasterized')
    }

    /**
     * Flatten multiple selected layers into one
     * @param {Array<string>} layerIds
     * @private
     */
    async _flattenLayers(layerIds) {
        if (layerIds.length < 2) return

        this._finalizePendingUndo()

        // Find the layers and their indices
        const selectedLayers = layerIds
            .map(id => ({ layer: this._layers.find(l => l.id === id), index: this._layers.findIndex(l => l.id === id) }))
            .filter(item => item.layer && item.index !== -1)
            .sort((a, b) => a.index - b.index)

        if (selectedLayers.length < 2) return

        // Find topmost selected layer index (highest index = top of stack)
        const topmostIndex = Math.max(...selectedLayers.map(item => item.index))

        const savedVisibility = this._saveVisibility()

        // Hide all layers except selected visible ones
        for (const l of this._layers) {
            if (!layerIds.includes(l.id)) l.visible = false
        }

        // Rebuild to render only selected visible layers
        await this._rebuild()

        // Capture the rendered result
        const offscreen = new OffscreenCanvas(this._canvas.width, this._canvas.height)
        const ctx = offscreen.getContext('2d')
        ctx.drawImage(this._canvas, 0, 0)

        this._restoreVisibility(savedVisibility)

        const blob = await offscreen.convertToBlob({ type: 'image/png' })
        const file = new File([blob], 'flattened.png', { type: 'image/png' })

        const newLayer = createMediaLayer(file, 'image', 'flattened')

        // Load media
        await this._renderer.loadMedia(newLayer.id, file, 'image')

        // Unload media for selected layers that are media type
        for (const item of selectedLayers) {
            if (item.layer.sourceType === 'media') {
                this._renderer.unloadMedia(item.layer.id)
            }
        }

        // Remove selected layers from stack (in reverse order to preserve indices)
        const indicesToRemove = selectedLayers.map(item => item.index).sort((a, b) => b - a)
        for (const idx of indicesToRemove) {
            this._layers.splice(idx, 1)
        }

        // Insert new layer at topmost position (adjusted for removed layers above it)
        const removedAboveTopmost = indicesToRemove.filter(idx => idx < topmostIndex).length
        const insertIndex = topmostIndex - removedAboveTopmost
        this._layers.splice(insertIndex, 0, newLayer)

        // Update UI
        this._updateLayerStack()
        if (this._layerStack) {
            this._layerStack.selectedLayerId = newLayer.id
        }
        await this._rebuild()
        this._markDirty()
        this._pushUndoState()

        toast.success('Layers flattened')
    }

    /**
     * Set up keyboard shortcuts
     * @private
     */
    _setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // ESC - cancel drag operation
            if (e.key === 'Escape' && this._reorderState === 'DRAGGING') {
                e.preventDefault()
                this._cancelDrag()
                return
            }

            // Ctrl/Cmd+S - save project (allow in inputs)
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault()
                this._showSaveProjectDialog()
                return
            }

            // Cmd/Ctrl+Shift+Z - redo (check before undo since Shift+Z matches both)
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z') {
                e.preventDefault()
                this._redo()
                return
            }

            // Cmd/Ctrl+Shift+I - inverse selection
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'i' || e.key === 'I')) {
                e.preventDefault()
                if (this._selectionManager?.hasSelection()) {
                    const mask = this._selectionManager.rasterizeSelection()
                    if (mask) {
                        this._selectionManager.setSelection({ type: 'mask', data: invertMask(mask) })
                    }
                }
                return
            }

            // Cmd/Ctrl+A - select all
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'a' || e.key === 'A')) {
                e.preventDefault()
                const { width, height } = this._canvas
                this._selectionManager.setSelection({
                    type: 'rect', x: 0, y: 0, width, height
                })
                return
            }

            // Cmd/Ctrl+Z - undo
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
                e.preventDefault()
                this._undo()
                return
            }

            // Cmd+C - copy selection
            if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
                if (this._selectionManager?.hasSelection()) {
                    e.preventDefault()
                    this._handleCopy()
                    return
                }
            }

            // Cmd+V - paste
            if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
                e.preventDefault()
                this._handlePaste()
                return
            }

            // Don't handle other shortcuts if in input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.contentEditable === 'true') {
                return
            }

            // Delete key - delete selected layer
            if (e.key === 'Delete' || e.key === 'Backspace') {
                const selected = this._layerStack?.getSelectedLayer()
                if (selected && this._layers.indexOf(selected) > 0) {
                    e.preventDefault()
                    this._handleDeleteLayer(selected.id)
                }
            }

            // Space - toggle play/pause
            if (e.key === ' ') {
                e.preventDefault()
                this._togglePlayPause()
            }

            // V - toggle visibility of selected layer
            if (e.key === 'v' || e.key === 'V') {
                const selected = this._layerStack?.getSelectedLayer()
                if (selected) {
                    this._finalizePendingUndo()
                    selected.visible = !selected.visible
                    this._updateLayerStack()
                    this._rebuild().then(() => {
                        this._markDirty()
                        this._pushUndoState()
                    })
                }
            }

            // Escape - clear selection
            if (e.key === 'Escape') {
                if (this._selectionManager?.hasSelection()) {
                    e.preventDefault()
                    this._selectionManager.clearSelection()
                }
            }

            // Cmd/Ctrl+D - deselect
            if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
                if (this._selectionManager?.hasSelection()) {
                    e.preventDefault()
                    this._selectionManager.clearSelection()
                }
            }
        })
    }

    /**
     * Show the add layer dialog
     * @private
     */
    _showAddLayerDialog() {
        addLayerDialog.show({
            effects: this._renderer.getLayerEffects(),
            onAddMedia: async (file, mediaType) => {
                await this._handleAddMediaLayer(file, mediaType)
            },
            onAddEffect: async (effectId) => {
                await this._handleAddEffectLayer(effectId)
            }
        })
    }

    /**
     * Show effect picker for adding a child effect to a layer
     * @param {string} parentLayerId - Parent layer ID
     * @private
     */
    _showAddChildEffectDialog(parentLayerId) {
        addLayerDialog.showEffectOnly({
            effects: this._renderer.getLayerEffects(),
            onAddEffect: async (effectId) => {
                await this._handleAddChildEffect(parentLayerId, effectId)
            }
        })
    }

    /**
     * Toggle play/pause
     * @private
     */
    _togglePlayPause() {
        const btn = document.getElementById('playPauseBtn')
        if (this._renderer.isRunning) {
            this._renderer.stop()
            if (btn) btn.textContent = 'play_arrow'
        } else {
            this._renderer.start()
            if (btn) btn.textContent = 'pause'
        }
    }

    /**
     * Set the current selection tool
     * @param {'rectangle' | 'oval' | 'lasso' | 'polygon' | 'wand'} tool
     * @private
     */
    _setSelectionTool(tool) {
        // Deactivate move tool when selecting a selection tool
        this._setToolMode('selection')

        if (!this._selectionManager) return

        this._selectionManager.currentTool = tool

        // Update menu checkmarks
        const items = ['Rect', 'Oval', 'Lasso', 'Polygon', 'Wand']
        const tools = ['rectangle', 'oval', 'lasso', 'polygon', 'wand']
        items.forEach((item, i) => {
            const el = document.getElementById(`select${item}MenuItem`)
            if (el) el.classList.toggle('checked', tools[i] === tool)
        })

        // Update icon - swap SVG content based on tool
        const iconContainer = document.getElementById('selectionToolIcon')
        if (iconContainer) {
            const svgAttrs = 'class="selection-icon" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="1 2" stroke-linecap="round"'
            const icons = {
                rectangle: `<svg ${svgAttrs}><rect x="2" y="4" width="16" height="12"/></svg>`,
                oval: `<svg ${svgAttrs}><ellipse cx="10" cy="10" rx="8" ry="6"/></svg>`,
                lasso: `<svg class="selection-icon" width="20" height="20" viewBox="0 0 1280 1280" fill="none" stroke="currentColor" stroke-width="64" stroke-dasharray="64 128" stroke-linecap="round"><path transform="translate(0,1280) scale(1,-1)" d="M854 1221 c-21 -15 -48 -38 -58 -50 -24 -26 -51 -27 -107 -1 -62 28 -120 26 -148 -4 -21 -22 -22 -30 -16 -102 6 -73 5 -82 -17 -114 -30 -44 -68 -50 -134 -20 -72 33 -104 35 -137 10 -87 -69 -65 -144 60 -201 100 -45 115 -92 52 -163 -24 -27 -40 -36 -77 -41 -67 -9 -100 -24 -122 -55 -44 -62 -30 -134 37 -189 42 -35 75 -39 139 -17 47 17 201 31 237 22 13 -3 36 -23 51 -44 22 -32 26 -49 26 -104 0 -51 5 -71 21 -92 57 -73 267 13 330 135 30 59 26 140 -11 218 l-31 64 23 25 c20 21 29 23 71 18 42 -4 51 -2 79 23 26 23 32 36 35 82 5 63 -18 117 -57 136 -14 7 -48 13 -77 13 -43 0 -55 4 -71 25 -33 42 -10 90 61 126 55 29 63 53 48 151 -7 45 -19 94 -27 109 -37 73 -113 90 -180 40z"/></svg>`,
                polygon: `<svg ${svgAttrs}><polygon points="10,2 18,8 15,18 5,18 2,8"/></svg>`,
                wand: '<span class="icon-material">auto_fix_high</span>'
            }
            iconContainer.outerHTML = icons[tool] ?
                `${icons[tool].replace("<svg ", "<svg id=\"selectionToolIcon\" ")}` :
                `${icons.rectangle.replace("<svg ", "<svg id=\"selectionToolIcon\" ")}`
        }

        // Show/hide tolerance slider
        const toleranceRow = document.getElementById('wandToleranceRow')
        if (toleranceRow) {
            toleranceRow.classList.toggle('hide', tool !== 'wand')
        }
    }

    /**
     * Get the currently active (selected) layer
     * @returns {object|null}
     * @private
     */
    _getActiveLayer() {
        const selectedIds = this._layerStack?.selectedLayerIds || []
        if (selectedIds.length !== 1) return null
        return this._layers.find(l => l.id === selectedIds[0]) || null
    }

    /**
     * Select the topmost layer
     * @private
     */
    _selectTopmostLayer() {
        if (this._layers.length > 0 && this._layerStack) {
            const topLayer = this._layers[this._layers.length - 1]
            this._layerStack.selectedLayerId = topLayer.id
        }
    }

    /**
     * Show dialog when no layer is selected
     * @private
     */
    _showNoLayerSelectedDialog() {
        infoDialog.show({ message: 'No layers are currently selected.' })
    }

    /**
     * Deselect all layers
     * @private
     */
    _deselectAllLayers() {
        if (this._layerStack) {
            this._layerStack.selectedLayerIds = []
        }
    }

    /**
     * Duplicate the active layer
     * @returns {Promise<boolean>} True if successful
     * @private
     */
    async _duplicateActiveLayer() {
        this._finalizePendingUndo()
        const layer = this._getActiveLayer()
        if (!layer) return false

        const canvasWidth = this._canvas.width
        const canvasHeight = this._canvas.height

        // Render the layer to get its pixels
        const compositeImg = await this._renderLayerComposite([layer.id])
        if (!compositeImg) return false

        // Create new layer with the pixels
        const offscreen = new OffscreenCanvas(canvasWidth, canvasHeight)
        const ctx = offscreen.getContext('2d')
        ctx.drawImage(compositeImg, 0, 0)

        const blob = await offscreen.convertToBlob({ type: 'image/png' })
        const file = new File([blob], 'duplicated.png', { type: 'image/png' })

        const newLayer = createMediaLayer(file, 'image', `${layer.name} copy`)

        // Insert after source layer
        const layerIndex = this._layers.findIndex(l => l.id === layer.id)
        this._layers.splice(layerIndex + 1, 0, newLayer)

        await this._renderer.loadMedia(newLayer.id, file, 'image')
        this._layerStack.selectedLayerId = newLayer.id

        this._updateLayerStack()
        await this._rebuild()
        this._markDirty()
        this._pushUndoState()
        return true
    }

    /**
     * Called after clone tool completes - switch to selection and create marquee
     * @private
     */
    _onCloneComplete() {
        const layer = this._getActiveLayer()
        if (!layer) return

        if (this._selectionManager.hasSelection()) {
            // Clone-with-selection: move the selection to follow the dragged pixels
            const dx = layer.offsetX || 0
            const dy = layer.offsetY || 0
            if (dx !== 0 || dy !== 0) {
                const path = this._selectionManager._selectionPath
                if (path.type === 'rect' || path.type === 'oval') {
                    path.x = (path.x || 0) + dx
                    path.y = (path.y || 0) + dy
                    if (path.cx !== undefined) { path.cx += dx; path.cy += dy }
                } else if (path.points) {
                    for (const p of path.points) { p.x += dx; p.y += dy }
                }
            }
        } else {
            // Clone whole layer: create a rect selection around it
            this._selectionManager._selectionPath = {
                type: 'rect',
                x: layer.offsetX || 0,
                y: layer.offsetY || 0,
                width: this._canvas.width,
                height: this._canvas.height
            }
            this._selectionManager._startAnimation()
        }
        this._updateImageMenu()
        this._updateSelectMenu()

        // Switch to selection tool
        this._setToolMode('selection')
    }

    /**
     * Update active layer's position.
     * Text layers use normalized 0-1 coords (posX/posY in effectParams).
     * Media layers use pixel offsets (offsetX/offsetY).
     * @param {number} x - position in canvas pixels
     * @param {number} y - position in canvas pixels
     * @private
     */
    _updateActiveLayerPosition(x, y) {
        const layer = this._getActiveLayer()
        if (!layer) return

        if (layer.effectId === 'filter/text') {
            const posX = Math.max(0, Math.min(1, x / this._canvas.width))
            const posY = Math.max(0, Math.min(1, y / this._canvas.height))
            layer.effectParams = { ...layer.effectParams, posX, posY }
            this._renderer.updateTextParams(layer.id, layer.effectParams)
        } else {
            layer.offsetX = x
            layer.offsetY = y
            this._renderer.updateLayerOffset(layer.id, x, y)
        }

        this._markDirty()
        this._pushUndoStateDebounced()
    }

    /**
     * Rasterize a layer in place without UI updates or toast
     * Used internally before extraction
     * @param {string} layerId
     * @returns {Promise<string|null>} The new layer id, or null if already media
     * @private
     */
    async _rasterizeLayerInPlace(layerId) {
        const layerIndex = this._layers.findIndex(l => l.id === layerId)
        if (layerIndex === -1) return null

        const layer = this._layers[layerIndex]
        if (layer.sourceType === 'media') return layer.id

        const savedVisibility = this._saveVisibility()
        for (const l of this._layers) {
            if (l.id !== layerId) l.visible = false
        }
        await this._rebuild()

        const offscreen = new OffscreenCanvas(this._canvas.width, this._canvas.height)
        const ctx = offscreen.getContext('2d')
        ctx.drawImage(this._canvas, 0, 0)

        this._restoreVisibility(savedVisibility)

        // Convert to media layer
        const blob = await offscreen.convertToBlob({ type: 'image/png' })
        const file = new File([blob], 'rasterized.png', { type: 'image/png' })

        const newLayer = createMediaLayer(file, 'image', layer.name)
        newLayer.visible = layer.visible
        newLayer.opacity = layer.opacity
        newLayer.blendMode = layer.blendMode
        newLayer.offsetX = 0
        newLayer.offsetY = 0

        await this._renderer.loadMedia(newLayer.id, file, 'image')
        this._layers[layerIndex] = newLayer

        if (this._layerStack) {
            this._layerStack.selectedLayerId = newLayer.id
        }

        return newLayer.id
    }

    /**
     * Extract current selection to a new layer
     * @param {boolean} destructive - If true, modify originals (punch holes/flatten). If false, just clone.
     * @private
     */
    async _extractSelectionToLayer(destructive = true) {
        if (!this._selectionManager?.hasSelection()) {
            console.warn('[Extract] No selection')
            return false
        }

        const selectedIds = this._layerStack?.selectedLayerIds || []
        if (selectedIds.length === 0) {
            console.warn('[Extract] No layers selected')
            return false
        }

        this._finalizePendingUndo()

        const selectedLayers = selectedIds
            .map(id => this._layers.find(l => l.id === id))
            .filter(Boolean)

        if (selectedLayers.length === 1) {
            return this._extractFromSingleLayer(selectedLayers[0], destructive)
        }
        return this._extractFromMultipleLayers(selectedIds, destructive)
    }

    /**
     * Clamp selection bounds to canvas dimensions
     * @returns {object|null} Clamped bounds, or null if empty
     * @private
     */
    _clampBounds(bounds) {
        if (bounds.width <= 0 || bounds.height <= 0) return null

        const clamped = {
            x: Math.max(0, Math.floor(bounds.x)),
            y: Math.max(0, Math.floor(bounds.y)),
            width: Math.ceil(bounds.width),
            height: Math.ceil(bounds.height)
        }
        clamped.width = Math.min(clamped.width, this._canvas.width - clamped.x)
        clamped.height = Math.min(clamped.height, this._canvas.height - clamped.y)
        if (clamped.width <= 0 || clamped.height <= 0) return null

        return clamped
    }

    /**
     * Check whether an image region contains any non-transparent pixels
     * @private
     */
    _hasVisiblePixels(ctx, bounds) {
        const data = ctx.getImageData(bounds.x, bounds.y, bounds.width, bounds.height).data
        for (let i = 3; i < data.length; i += 4) {
            if (data[i] > 0) return true
        }
        return false
    }

    /**
     * Extract selection from a single layer
     * @param {object} layer - The layer to extract from
     * @param {boolean} punchHole - Whether to punch hole in original
     * @private
     */
    async _extractFromSingleLayer(layer, punchHole) {
        const selectionPath = this._selectionManager.selectionPath
        const canvasWidth = this._canvas.width
        const canvasHeight = this._canvas.height

        const extractBounds = this._clampBounds(getSelectionBounds(selectionPath))
        if (!extractBounds) return false

        // Create selection mask
        const maskCanvas = new OffscreenCanvas(canvasWidth, canvasHeight)
        const maskCtx = maskCanvas.getContext('2d')
        this._drawSelectionMask(maskCtx, selectionPath)

        // Render the layer through the shader to capture what the user sees,
        // correctly handling media scaling, positioning, rotation, etc.
        const sourceImg = await this._renderLayerComposite([layer.id])
        if (!sourceImg) return false

        // Create extracted pixels canvas
        const extractedCanvas = new OffscreenCanvas(canvasWidth, canvasHeight)
        const extractedCtx = extractedCanvas.getContext('2d')
        extractedCtx.drawImage(sourceImg, 0, 0)
        extractedCtx.globalCompositeOperation = 'destination-in'
        extractedCtx.drawImage(maskCanvas, 0, 0)
        extractedCtx.globalCompositeOperation = 'source-over'

        if (!this._hasVisiblePixels(extractedCtx, extractBounds)) {
            toast.warning('no pixels selected')
            return false
        }

        // Punch hole in source if requested
        if (punchHole) {
            const punchedCanvas = new OffscreenCanvas(canvasWidth, canvasHeight)
            const punchedCtx = punchedCanvas.getContext('2d')
            punchedCtx.drawImage(sourceImg, 0, 0)
            punchedCtx.globalCompositeOperation = 'destination-out'
            punchedCtx.drawImage(maskCanvas, 0, 0)
            punchedCtx.globalCompositeOperation = 'source-over'

            const punchedBlob = await punchedCanvas.convertToBlob({ type: 'image/png' })
            const punchedFile = new File([punchedBlob], layer.mediaFile?.name || 'layer.png', { type: 'image/png' })

            // Replace layer content with punched image (converts effect layers to media)
            this._renderer.unloadMedia(layer.id)
            layer.sourceType = 'media'
            layer.mediaFile = punchedFile
            layer.mediaType = 'image'
            layer.effectId = null
            layer.effectParams = {}
            layer.offsetX = 0
            layer.offsetY = 0
            await this._renderer.loadMedia(layer.id, punchedFile, 'image')
        }

        // Create new layer with extracted pixels
        const extractedBlob = await extractedCanvas.convertToBlob({ type: 'image/png' })
        const extractedFile = new File([extractedBlob], 'moved-selection.png', { type: 'image/png' })

        const newLayer = createMediaLayer(extractedFile, 'image', 'moved selection')

        // Insert after source layer
        const layerIndex = this._layers.findIndex(l => l.id === layer.id)
        this._layers.splice(layerIndex + 1, 0, newLayer)

        await this._renderer.loadMedia(newLayer.id, extractedFile, 'image')
        this._layerStack.selectedLayerId = newLayer.id

        if (punchHole) {
            this._selectionManager.clearSelection()
        }
        this._updateLayerStack()
        await this._rebuild()
        this._markDirty()
        this._pushUndoState()
        return true
    }

    /**
     * Extract selection from multiple layers
     * @param {string[]} layerIds - The layer IDs to extract from
     * @param {boolean} punchHole - Whether to flatten and punch (true) or just clone (false)
     * @private
     */
    async _extractFromMultipleLayers(layerIds, punchHole) {
        const selectionPath = this._selectionManager.selectionPath
        const canvasWidth = this._canvas.width
        const canvasHeight = this._canvas.height

        const extractBounds = this._clampBounds(getSelectionBounds(selectionPath))
        if (!extractBounds) return false

        // Create selection mask
        const maskCanvas = new OffscreenCanvas(canvasWidth, canvasHeight)
        const maskCtx = maskCanvas.getContext('2d')
        this._drawSelectionMask(maskCtx, selectionPath)

        // Render composite of selected layers
        const compositeImg = await this._renderLayerComposite(layerIds)
        if (!compositeImg) return false

        // Create extracted pixels canvas
        const extractedCanvas = new OffscreenCanvas(canvasWidth, canvasHeight)
        const extractedCtx = extractedCanvas.getContext('2d')
        extractedCtx.drawImage(compositeImg, 0, 0)
        extractedCtx.globalCompositeOperation = 'destination-in'
        extractedCtx.drawImage(maskCanvas, 0, 0)
        extractedCtx.globalCompositeOperation = 'source-over'

        if (!this._hasVisiblePixels(extractedCtx, extractBounds)) {
            toast.warning('no pixels selected')
            return false
        }

        // Find topmost layer index for insertion
        const topmostIndex = Math.max(...layerIds.map(id => this._layers.findIndex(l => l.id === id)))

        if (punchHole) {
            // Flatten layers, then punch hole
            // First flatten (similar to _flattenLayers but we keep the result for punching)
            const flattenedCanvas = new OffscreenCanvas(canvasWidth, canvasHeight)
            const flattenedCtx = flattenedCanvas.getContext('2d')
            flattenedCtx.drawImage(compositeImg, 0, 0)

            // Punch hole
            flattenedCtx.globalCompositeOperation = 'destination-out'
            flattenedCtx.drawImage(maskCanvas, 0, 0)
            flattenedCtx.globalCompositeOperation = 'source-over'

            // Create flattened layer with hole
            const flattenedBlob = await flattenedCanvas.convertToBlob({ type: 'image/png' })
            const flattenedFile = new File([flattenedBlob], 'flattened.png', { type: 'image/png' })

            const flattenedLayer = createMediaLayer(flattenedFile, 'image', 'flattened')

            // Remove old layers
            const selectedLayers = layerIds.map(id => this._layers.find(l => l.id === id)).filter(Boolean)
            for (const layer of selectedLayers) {
                if (layer.sourceType === 'media') {
                    this._renderer.unloadMedia(layer.id)
                }
            }
            const indicesToRemove = layerIds
                .map(id => this._layers.findIndex(l => l.id === id))
                .filter(i => i !== -1)
                .sort((a, b) => b - a)
            for (const idx of indicesToRemove) {
                this._layers.splice(idx, 1)
            }

            // Insert flattened layer
            const removedAboveTopmost = indicesToRemove.filter(idx => idx < topmostIndex).length
            const insertIndex = topmostIndex - removedAboveTopmost
            this._layers.splice(insertIndex, 0, flattenedLayer)
            await this._renderer.loadMedia(flattenedLayer.id, flattenedFile, 'image')
        }

        // Create new layer with extracted pixels
        const extractedBlob = await extractedCanvas.convertToBlob({ type: 'image/png' })
        const extractedFile = new File([extractedBlob], 'moved-selection.png', { type: 'image/png' })

        const newLayer = createMediaLayer(extractedFile, 'image', 'moved selection')

        // Insert at top
        this._layers.push(newLayer)
        await this._renderer.loadMedia(newLayer.id, extractedFile, 'image')
        this._layerStack.selectedLayerId = newLayer.id

        if (punchHole) {
            this._selectionManager.clearSelection()
        }
        this._updateLayerStack()
        await this._rebuild()
        this._markDirty()
        this._pushUndoState()
        return true
    }

    /**
     * Load an Image element from a Blob
     * @param {Blob} blob
     * @returns {Promise<HTMLImageElement|null>}
     * @private
     */
    _loadImageFromBlob(blob) {
        return new Promise((resolve) => {
            const img = new Image()
            const url = URL.createObjectURL(blob)
            img.onload = () => {
                URL.revokeObjectURL(url)
                resolve(img)
            }
            img.onerror = () => {
                URL.revokeObjectURL(url)
                resolve(null)
            }
            img.src = url
        })
    }

    /**
     * Render a composite image of specified layers
     * @param {string[]} layerIds - Layer IDs to render
     * @returns {Promise<HTMLImageElement|null>}
     * @private
     */
    async _renderLayerComposite(layerIds) {
        const savedVisibility = this._saveVisibility()

        for (const l of this._layers) {
            l.visible = layerIds.includes(l.id)
        }

        await this._rebuild()

        const offscreen = new OffscreenCanvas(this._canvas.width, this._canvas.height)
        const ctx = offscreen.getContext('2d')
        ctx.drawImage(this._canvas, 0, 0)

        this._restoreVisibility(savedVisibility)
        await this._rebuild()

        const blob = await offscreen.convertToBlob({ type: 'image/png' })
        return this._loadImageFromBlob(blob)
    }

    /**
     * Get image element for a layer
     * @param {object} layer
     * @returns {Promise<HTMLImageElement|null>}
     * @private
     */
    _getLayerImage(layer) {
        if (!layer.mediaFile) return null
        return this._loadImageFromBlob(layer.mediaFile)
    }

    /**
     * Capture current video frame as an image at native dimensions
     * @param {string} layerId
     * @returns {Promise<HTMLImageElement|null>}
     * @private
     */
    async _captureVideoFrame(layerId) {
        const media = this._renderer.getMediaInfo(layerId)
        if (!media || media.type !== 'video') return null
        const offscreen = new OffscreenCanvas(media.width, media.height)
        const ctx = offscreen.getContext('2d')
        ctx.drawImage(media.element, 0, 0)
        const blob = await offscreen.convertToBlob({ type: 'image/png' })
        return this._loadImageFromBlob(blob)
    }

    /**
     * Draw selection mask to canvas context
     * @param {CanvasRenderingContext2D} ctx
     * @param {object} selectionPath
     * @param {number} [offsetX=0]
     * @param {number} [offsetY=0]
     * @private
     */
    _drawSelectionMask(ctx, selectionPath, offsetX = 0, offsetY = 0) {
        ctx.imageSmoothingEnabled = false
        ctx.fillStyle = 'white'

        if (selectionPath.type === 'rect') {
            // Use integer coords to avoid anti-aliasing artifacts
            const x = Math.round(selectionPath.x + offsetX)
            const y = Math.round(selectionPath.y + offsetY)
            const w = Math.round(selectionPath.width)
            const h = Math.round(selectionPath.height)
            ctx.fillRect(x, y, w, h)
        } else if (selectionPath.type === 'oval') {
            ctx.beginPath()
            ctx.ellipse(selectionPath.cx + offsetX, selectionPath.cy + offsetY, selectionPath.rx, selectionPath.ry, 0, 0, Math.PI * 2)
            ctx.fill()
        } else if (selectionPath.type === 'lasso' || selectionPath.type === 'polygon') {
            if (selectionPath.points.length >= 3) {
                ctx.beginPath()
                ctx.moveTo(selectionPath.points[0].x + offsetX, selectionPath.points[0].y + offsetY)
                for (let i = 1; i < selectionPath.points.length; i++) {
                    ctx.lineTo(selectionPath.points[i].x + offsetX, selectionPath.points[i].y + offsetY)
                }
                ctx.closePath()
                ctx.fill()
            }
        } else if (selectionPath.type === 'wand' || selectionPath.type === 'mask') {
            const mask = selectionPath.type === 'wand' ? selectionPath.mask : selectionPath.data
            // For mask-based selections, we need to translate the putImageData
            ctx.putImageData(mask, offsetX, offsetY)
        }
    }

    /**
     * Set current tool mode
     * @param {'selection' | 'move' | 'clone'} tool
     * @private
     */
    _setToolMode(tool) {
        this._currentTool = tool

        // Deactivate all tools
        this._moveTool?.deactivate()
        this._cloneTool?.deactivate()

        // Update button states
        document.getElementById('moveToolBtn')?.classList.toggle('active', tool === 'move')
        document.getElementById('cloneToolBtn')?.classList.toggle('active', tool === 'clone')
        document.getElementById('selectionToolBtn')?.classList.toggle('active', tool === 'selection')

        // Clear selection tool checkmarks when not in selection mode
        if (tool !== 'selection') {
            const items = ['Rect', 'Oval', 'Lasso', 'Polygon', 'Wand']
            items.forEach(item => {
                const el = document.getElementById(`select${item}MenuItem`)
                if (el) el.classList.remove('checked')
            })
        }

        // Activate selected tool
        if (tool === 'move') this._moveTool?.activate()
        else if (tool === 'clone') this._cloneTool?.activate()

        this._selectionManager.enabled = (tool === 'selection')
        this._selectionOverlay?.classList.toggle('move-tool', tool === 'move')
        this._selectionOverlay?.classList.toggle('clone-tool', tool === 'clone')
    }

    _updateToolButtons() {
        const isVideo = this._getActiveLayer()?.mediaType === 'video'
        document.getElementById('moveToolBtn')?.classList.toggle('disabled', isVideo)
    }

    /**
     * Handle copy command
     * @private
     */
    async _handleCopy() {
        if (!this._selectionManager?.hasSelection()) return

        const selectionPath = this._selectionManager.selectionPath
        const selectedLayers = this._layerStack?.selectedLayers || []

        // Filter to visible layers only
        const visibleLayers = selectedLayers.filter(l => l.visible)

        // If no layers selected in panel, use all visible layers
        const layersToCopy = visibleLayers.length > 0
            ? visibleLayers
            : this._layers.filter(l => l.visible)

        const origin = await copySelection({
            selectionPath,
            layers: layersToCopy,
            sourceCanvas: this._canvas
        })

        if (origin) {
            this._copyOrigin = origin
            toast.success('Copied to clipboard')
        } else {
            toast.error('Failed to copy')
        }
    }

    /**
     * Handle paste command
     * @private
     */
    async _handlePaste() {
        const result = await pasteFromClipboard()
        if (!result) {
            return // No image in clipboard, silent fail
        }

        const { blob } = result

        // Load pasted image to get dimensions
        const img = new Image()
        const url = URL.createObjectURL(blob)
        await new Promise((resolve, reject) => {
            img.onload = resolve
            img.onerror = reject
            img.src = url
        })
        URL.revokeObjectURL(url)

        const canvasWidth = this._canvas.width
        const canvasHeight = this._canvas.height
        const offscreen = new OffscreenCanvas(canvasWidth, canvasHeight)
        const ctx = offscreen.getContext('2d')
        ctx.clearRect(0, 0, canvasWidth, canvasHeight)

        // If there's an active selection, scale and position image to fit within it
        if (this._selectionManager?.hasSelection()) {
            const bounds = getSelectionBounds(this._selectionManager.selectionPath)
            if (bounds.width > 0 && bounds.height > 0) {
                // Draw scaled to fit selection bounds
                ctx.drawImage(img, bounds.x, bounds.y, bounds.width, bounds.height)
                // Clear selection after paste
                this._selectionManager.clearSelection()
            }
        } else {
            // No selection: use copy origin or center
            let x, y
            if (this._copyOrigin) {
                x = this._copyOrigin.x
                y = this._copyOrigin.y
            } else {
                x = Math.round((canvasWidth - img.width) / 2)
                y = Math.round((canvasHeight - img.height) / 2)
            }
            ctx.drawImage(img, x, y)
        }

        // Convert to file and add as layer
        const positionedBlob = await offscreen.convertToBlob({ type: 'image/png' })
        const file = new File([positionedBlob], 'pasted-image.png', { type: 'image/png' })

        await this._handleAddMediaLayer(file, 'image')
    }

    /**
     * Show the save project dialog
     * @private
     */
    _showSaveProjectDialog() {
        saveProjectDialog.show({
            projectId: this._currentProjectId,
            projectName: this._currentProjectName || 'untitled',
            onSave: async (projectId, projectName) => {
                await this._saveProject(projectId, projectName)
            }
        })
    }

    /**
     * Show save project as dialog (always prompts for name)
     * @private
     */
    _showSaveProjectAsDialog() {
        saveProjectDialog.show({
            projectId: null,
            projectName: this._currentProjectName || 'untitled',
            onSave: async (projectId, projectName) => {
                await this._saveProject(projectId, projectName)
            }
        })
    }

    /**
     * Quick save project without dialog (for existing projects)
     * @private
     */
    async _quickSaveProject() {
        try {
            await this._saveProject(this._currentProjectId, this._currentProjectName)
        } catch (err) {
            // Error already shown in _saveProject
        }
    }

    /**
     * Show the load project dialog
     * @param {boolean} isRequired - If true, dialog cannot be closed without selection
     * @private
     */
    _showLoadProjectDialog(isRequired = false) {
        projectManagerDialog.show({
            isRequired,
            onLoad: async (projectId) => {
                await this._loadProject(projectId)
            },
            onCancel: isRequired ? () => {
                // Open dialog is still visible behind, nothing to do
            } : undefined
        })
    }

    /**
     * Save the current project
     * @param {string|null} projectId - Existing project ID (for update)
     * @param {string} projectName - Project name
     * @private
     */
    async _saveProject(projectId, projectName) {
        try {
            const savedId = await saveProject({
                name: projectName,
                canvasWidth: this._canvas.width,
                canvasHeight: this._canvas.height,
                layers: this._layers
            }, projectId)

            this._currentProjectId = savedId
            this._currentProjectName = projectName
            this._markClean()

            toast.success('Project saved')
        } catch (err) {
            console.error('[Layers] Failed to save project:', err)
            toast.error('Failed to save project')
            throw err
        }
    }

    /**
     * Load a project
     * @param {string} projectId - Project ID
     * @private
     */
    async _loadProject(projectId) {
        try {
            const result = await loadProject(projectId)
            if (!result) {
                toast.error('Project not found')
                return
            }

            const { project, mediaFiles } = result

            // Reset current layers
            this._resetLayers()

            // Resize canvas
            if (project.canvasWidth && project.canvasHeight) {
                this._resizeCanvas(project.canvasWidth, project.canvasHeight)
            }

            // Restore layers
            this._layers = project.layers

            // Load media for each media layer
            for (const layer of this._layers) {
                if (layer.sourceType === 'media') {
                    const file = mediaFiles.get(layer.id)
                    if (file) {
                        layer.mediaFile = file
                        await this._renderer.loadMedia(layer.id, file, layer.mediaType)
                    }
                }
            }

            // Update state
            this._currentProjectId = project.id
            this._currentProjectName = project.name
            // Update UI and rebuild
            this._updateLayerStack()
            // Wait for any pending microtasks (canvas observer uses queueMicrotask)
            await new Promise(resolve => queueMicrotask(resolve))
            await this._rebuild()
            // Wait for next frame to ensure WebGL state is stable
            await new Promise(resolve => requestAnimationFrame(resolve))
            this._renderer.start()
            this._markClean()

            this._undoManager.clear()
            this._pushUndoState()

            // Close the open dialog (in case we came from there)
            openDialog.element.close()
            toast.success(`Loaded "${project.name}"`)
        } catch (err) {
            console.error('[Layers] Failed to load project:', err)
            toast.error('Failed to load project')
            throw err
        }
    }

    /**
     * Quick save as PNG
     * @private
     */
    _quickSavePng() {
        const filename = getTimestampedFilename('layers')
        exportPng(this._canvas, filename)
        toast.success('Saved as PNG')
    }

    /**
     * Quick save as JPG
     * @private
     */
    _quickSaveJpg() {
        const filename = getTimestampedFilename('layers')
        exportJpg(this._canvas, filename)
        toast.success('Saved as JPG')
    }

    /**
     * Prompt for a radius parameter, rasterize the current selection, and apply a mask operation.
     * @param {Object} dialogOptions - Options for selectionParamDialog.show()
     * @param {function(ImageData, number): ImageData} maskFn - Mask transform function
     * @private
     */
    async _modifySelection(dialogOptions, maskFn) {
        const r = await selectionParamDialog.show(dialogOptions)
        if (r === null) return
        const mask = this._selectionManager.rasterizeSelection()
        if (!mask) return
        this._selectionManager.setSelection({ type: 'mask', data: maskFn(mask, r) })
    }

    _updateSelectMenu() {
        const hasSelection = this._selectionManager?.hasSelection()
        const selectionItems = [
            'selectNoneMenuItem',
            'selectInverseMenuItem',
            'borderSelectionMenuItem',
            'smoothSelectionMenuItem',
            'expandSelectionMenuItem',
            'contractSelectionMenuItem',
            'featherSelectionMenuItem'
        ]
        for (const id of selectionItems) {
            document.getElementById(id)?.classList.toggle('disabled', !hasSelection)
        }
    }

    _startColorRangePick() {
        if (!this._canvas) return
        this._colorRangePicking = true
        this._selectionOverlay.style.cursor = 'crosshair'

        const handler = (e) => {
            this._selectionOverlay.removeEventListener('click', handler)
            this._colorRangePicking = false
            this._selectionOverlay.style.cursor = ''
            this._handleColorRangePick(e)
        }

        this._selectionManager.enabled = false

        this._selectionOverlay.addEventListener('click', handler)

        const cancelHandler = (e) => {
            if (e.key === 'Escape') {
                this._selectionOverlay.removeEventListener('click', handler)
                document.removeEventListener('keydown', cancelHandler)
                this._colorRangePicking = false
                this._selectionOverlay.style.cursor = ''
                this._selectionManager.enabled = true
            }
        }
        document.addEventListener('keydown', cancelHandler)

        this._selectionOverlay.addEventListener('click', () => {
            document.removeEventListener('keydown', cancelHandler)
            this._selectionManager.enabled = true
        }, { once: true })
    }

    _handleColorRangePick(e) {
        const rect = this._selectionOverlay.getBoundingClientRect()
        const scaleX = this._canvas.width / rect.width
        const scaleY = this._canvas.height / rect.height
        const x = Math.round((e.clientX - rect.left) * scaleX)
        const y = Math.round((e.clientY - rect.top) * scaleY)

        const tempCanvas = document.createElement('canvas')
        tempCanvas.width = this._canvas.width
        tempCanvas.height = this._canvas.height
        const tempCtx = tempCanvas.getContext('2d')
        tempCtx.drawImage(this._canvas, 0, 0)
        const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height)

        const tolerance = this._selectionManager.wandTolerance
        const mask = colorRange(imageData, x, y, tolerance)

        let hasPixels = false
        for (let i = 3; i < mask.data.length; i += 4) {
            if (mask.data[i] > 127) { hasPixels = true; break }
        }

        if (hasPixels) {
            this._selectionManager.setSelection({ type: 'mask', data: mask })
        }
    }

    _updateImageMenu() {
        const cropItem = document.getElementById('cropToSelectionMenuItem')
        if (!cropItem) return
        const hasSelection = this._selectionManager?.hasSelection()
        cropItem.classList.toggle('disabled', !hasSelection)
    }

    async _cropToSelection() {
        if (!this._selectionManager?.hasSelection()) return

        this._finalizePendingUndo()

        const selectionPath = this._selectionManager.selectionPath
        const bounds = getSelectionBounds(selectionPath)
        if (bounds.width <= 0 || bounds.height <= 0) return

        for (const layer of this._layers) {
            if (layer.sourceType === 'media' && layer.mediaType !== 'video') {
                await this._cropMediaLayer(layer, bounds)
            } else {
                // Video and effect layers: shift offsets (video can't be rasterized)
                layer.offsetX = (layer.offsetX || 0) - bounds.x
                layer.offsetY = (layer.offsetY || 0) - bounds.y
            }
        }

        // Stop renderer before resizing (resize invalidates WebGL state)
        this._renderer.stop()
        this._resizeCanvas(bounds.width, bounds.height)
        this._selectionManager.clearSelection()

        // Recompile pipeline at new dimensions and restart
        await this._rebuild()
        await new Promise(resolve => requestAnimationFrame(resolve))
        this._renderer.start()
        this._markDirty()
        this._pushUndoState()

        toast.success('Cropped to selection')
    }

    async _cropMediaLayer(layer, bounds) {
        // Render through the shader to capture what the user sees
        const compositeImg = await this._renderLayerComposite([layer.id])
        if (!compositeImg) return

        const offscreen = new OffscreenCanvas(bounds.width, bounds.height)
        const ctx = offscreen.getContext('2d')
        ctx.drawImage(
            compositeImg,
            bounds.x, bounds.y, bounds.width, bounds.height,
            0, 0, bounds.width, bounds.height
        )

        const blob = await offscreen.convertToBlob({ type: 'image/png' })
        const file = new File([blob], 'cropped.png', { type: 'image/png' })

        // Replace layer with rasterized crop (transforms are baked into the output)
        this._renderer.unloadMedia(layer.id)
        layer.mediaFile = file
        layer.mediaType = 'image'
        layer.offsetX = 0
        layer.offsetY = 0
        layer.effectParams = {}
        await this._renderer.loadMedia(layer.id, file, 'image')
    }

    _showImageSizeDialog() {
        imageSizeDialog.show({
            width: this._canvas.width,
            height: this._canvas.height,
            onConfirm: async (width, height) => {
                await this._resizeImage(width, height)
            }
        })
    }

    async _resizeImage(newWidth, newHeight) {
        const oldWidth = this._canvas.width
        const oldHeight = this._canvas.height
        if (newWidth === oldWidth && newHeight === oldHeight) return

        this._finalizePendingUndo()

        const scaleX = newWidth / oldWidth
        const scaleY = newHeight / oldHeight

        // Resize each layer
        for (const layer of this._layers) {
            if (layer.sourceType === 'media') {
                await this._resampleMediaLayer(layer, scaleX, scaleY)
            } else {
                // Effect layers: scale offsets only
                layer.offsetX = Math.round((layer.offsetX || 0) * scaleX)
                layer.offsetY = Math.round((layer.offsetY || 0) * scaleY)
            }
        }

        // Stop renderer before resizing (resize invalidates WebGL state)
        this._renderer.stop()

        this._resizeCanvas(newWidth, newHeight)
        await this._rebuild()
        await new Promise(resolve => requestAnimationFrame(resolve))
        this._renderer.start()
        this._markDirty()
        this._pushUndoState()

        toast.success(`Resized to ${newWidth} x ${newHeight}`)
    }

    async _resampleMediaLayer(layer, scaleX, scaleY) {
        const media = this._renderer._mediaTextures.get(layer.id)
        if (!media || !media.element) return

        const srcW = media.width
        const srcH = media.height
        const dstW = Math.round(srcW * scaleX)
        const dstH = Math.round(srcH * scaleY)

        if (layer.mediaType === 'video') {
            // Video: update stored dimensions so imageSize uniform reflects scale.
            // Video element stays alive — animation continues.
            media.width = dstW
            media.height = dstH
        } else {
            // Image: create resampled pixels
            const offscreen = new OffscreenCanvas(dstW, dstH)
            const ctx = offscreen.getContext('2d')
            ctx.drawImage(media.element, 0, 0, srcW, srcH, 0, 0, dstW, dstH)

            const blob = await offscreen.convertToBlob({ type: 'image/png' })
            const file = new File([blob], 'resized.png', { type: 'image/png' })

            this._renderer.unloadMedia(layer.id)
            await this._renderer.loadMedia(layer.id, file, 'image')

            layer.mediaFile = file
        }

        layer.offsetX = Math.round((layer.offsetX || 0) * scaleX)
        layer.offsetY = Math.round((layer.offsetY || 0) * scaleY)
    }

    _showCanvasSizeDialog() {
        canvasResizeDialog.show({
            width: this._canvas.width,
            height: this._canvas.height,
            onConfirm: async (width, height, anchor) => {
                await this._changeCanvasSize(width, height, anchor)
            }
        })
    }

    /**
     * Show the font bundle install dialog
     */
    _showFontInstallDialog() {
        const modal = document.getElementById('fontInstallModal')
        const contentView = document.getElementById('fontInstallContentView')
        const progressView = document.getElementById('fontInstallProgressView')
        const progressBar = document.getElementById('fontInstallProgressBar')
        const progressText = document.getElementById('fontInstallProgressText')
        const beginBtn = document.getElementById('fontInstallBeginBtn')
        const cancelBtn = document.getElementById('fontInstallCancelBtn')
        const closeBtn = document.getElementById('fontInstallCloseBtn')

        // Reset to content view
        contentView.style.display = ''
        progressView.style.display = 'none'

        modal.showModal()

        const close = () => modal.close()

        closeBtn.onclick = close
        modal.onclick = (e) => { if (e.target === modal) close() }
        modal.addEventListener('cancel', (e) => { e.preventDefault(); close() }, { once: true })

        beginBtn.onclick = async () => {
            contentView.style.display = 'none'
            progressView.style.display = ''

            const loader = getFontaineLoader()

            try {
                await loader.install({
                    onProgress: (percent, message) => {
                        progressBar.style.width = `${Math.min(percent, 100)}%`
                        progressText.textContent = message
                    }
                })

                progressText.textContent = 'Done! Refreshing font list...'

                // Refresh any open font-select elements
                this._refreshFontSelects()

                setTimeout(close, 1000)
            } catch (err) {
                progressText.textContent = `Error: ${err.message}`
                console.error('[FontInstall] Failed:', err)
            }
        }

        cancelBtn.onclick = close
    }

    /**
     * Refresh all font-select elements with current font options
     */
    async _refreshFontSelects() {
        const fontSelects = document.querySelectorAll('font-select')
        if (fontSelects.length === 0) return

        const loader = getFontaineLoader()
        const installed = await loader.isInstalled()

        let options = BASE_FONTS
        if (installed) {
            await loader.loadFromCache()
            options = loader.getAllFonts().map(f => ({
                value: f.name,
                text: f.name,
                category: f.category || 'other',
                tags: f.tags || []
            }))
            loader.registerAllFonts()
        }

        fontSelects.forEach(fs => {
            const currentValue = fs.value
            fs.setOptions(options)
            fs.value = currentValue
        })
    }

    async _changeCanvasSize(newWidth, newHeight, anchor = 'center') {
        const oldWidth = this._canvas.width
        const oldHeight = this._canvas.height
        if (newWidth === oldWidth && newHeight === oldHeight) return

        this._finalizePendingUndo()

        const deltaW = newWidth - oldWidth
        const deltaH = newHeight - oldHeight

        // Calculate offset based on anchor
        let shiftX = 0, shiftY = 0

        // Horizontal positioning
        if (anchor.includes('center') && !anchor.includes('left') && !anchor.includes('right')) {
            shiftX = Math.round(deltaW / 2)
        } else if (anchor.includes('right')) {
            shiftX = deltaW
        }
        // else left: shiftX = 0

        // Vertical positioning
        if (anchor === 'center' || anchor.includes('middle')) {
            shiftY = Math.round(deltaH / 2)
        } else if (anchor.includes('bottom')) {
            shiftY = deltaH
        }
        // else top: shiftY = 0

        // Adjust all layer offsets
        for (const layer of this._layers) {
            layer.offsetX = (layer.offsetX || 0) + shiftX
            layer.offsetY = (layer.offsetY || 0) + shiftY
        }

        // Stop renderer before resizing (resize invalidates WebGL state)
        this._renderer.stop()

        this._resizeCanvas(newWidth, newHeight)
        await this._rebuild()
        await new Promise(resolve => requestAnimationFrame(resolve))
        this._renderer.start()
        this._markDirty()
        this._pushUndoState()

        toast.success(`Canvas resized to ${newWidth} x ${newHeight}`)
    }

}

// Initialize app when DOM is ready
const app = new LayersApp()

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => app.init())
} else {
    app.init()
}

// Export for debugging
window.layersApp = app

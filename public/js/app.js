/**
 * Layers App
 * Main entry point
 *
 * @module app
 */

import { LayersRenderer } from './noisemaker/renderer.js'
import { createMediaLayer, createEffectLayer } from './layers/layer-model.js'
import './layers/layer-stack.js'
import { EffectParams } from './layers/effect-params.js'
import { openDialog } from './ui/open-dialog.js'
import { addLayerDialog } from './ui/add-layer-dialog.js'
import { aboutDialog } from './ui/about-dialog.js'
import { saveProjectDialog } from './ui/save-project-dialog.js'
import { projectManagerDialog } from './ui/project-manager-dialog.js'
import { confirmDialog } from './ui/confirm-dialog.js'
import { toast } from './ui/toast.js'
import { exportPng, exportJpg, getTimestampedFilename } from './utils/export.js'
import { saveProject, loadProject } from './utils/project-storage.js'
import { registerServiceWorker } from './sw-register.js'
import { SelectionManager } from './selection/selection-manager.js'
import { copySelection, pasteFromClipboard, getSelectionBounds } from './selection/clipboard-ops.js'
import { MoveTool } from './tools/move-tool.js'

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
        if (this._selectionManager) {
            this._selectionManager.setSourceCanvas(this._canvas)
        }

        // Initialize move tool
        this._moveTool = new MoveTool({
            overlay: this._selectionOverlay,
            selectionManager: this._selectionManager,
            getActiveLayer: () => this._getActiveLayer(),
            getSelectedLayers: () => this._layerStack?.selectedLayerIds || [],
            updateLayerPosition: (x, y) => this._updateActiveLayerPosition(x, y),
            extractSelection: () => this._extractSelectionToLayer(),
            showMultiLayerDialog: () => this._showMultiLayerNotSupportedDialog(),
            autoSelectLayer: () => this._autoSelectTopmostLayer()
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
            EffectParams.setEffectLoader(async (effectId) => {
                return await this._renderer.getEffectDefinition(effectId)
            })
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
        this._updateFilename('untitled')
        this._markDirty()

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
        this._updateFilename(file.name)
        this._markDirty()

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
        const layer = createMediaLayer(file, mediaType)
        this._layers.push(layer)

        // Load media
        await this._renderer.loadMedia(layer.id, file, mediaType)

        // Update and rebuild
        this._updateLayerStack()
        await this._rebuild()
        this._markDirty()

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
        const layer = createEffectLayer(effectId)
        this._layers.push(layer)

        // Update and rebuild
        this._updateLayerStack()
        await this._rebuild()
        this._markDirty()

        toast.success(`Added layer: ${layer.name}`)
    }

    /**
     * Reset all layers (for new project)
     * @private
     */
    _resetLayers() {
        this._layers.forEach(l => {
            if (l.sourceType === 'media') {
                this._renderer.unloadMedia(l.id)
            }
        })
        this._layers = []
    }

    /**
     * Handle deleting a layer
     * @param {string} layerId - Layer ID to delete
     * @private
     */
    async _handleDeleteLayer(layerId) {
        const index = this._layers.findIndex(l => l.id === layerId)
        if (index <= 0) return // Can't delete base layer

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

        toast.info(`Deleted layer: ${layer.name}`)
    }

    /**
     * Handle layer changes (visibility, blend mode, opacity, effectParams)
     * @param {object} detail - Change detail
     * @private
     */
    async _handleLayerChange(detail) {
        // Update layer in our array
        const layer = this._layers.find(l => l.id === detail.layerId)
        if (layer) {
            layer[detail.property] = detail.value
        }

        this._markDirty()

        // Determine if this requires a full rebuild or just a parameter update
        switch (detail.property) {
            case 'effectParams':
                // Update parameters directly without recompiling
                this._renderer.updateLayerParams(detail.layerId, detail.value)
                // Keep DSL in sync to prevent spurious rebuild on next structural change
                this._renderer.syncDsl()
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
                break

            case 'visibility':
            case 'blendMode':
                // Structural changes require full rebuild
                await this._rebuild()
                break

            default:
                // Unknown property - rebuild to be safe
                await this._rebuild()
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
                // Commit the change
                this._layers = newLayers
                // Force rebuild to update layer-step mapping even if DSL is unchanged
                // (DSL may be string-identical after reorder when layers have same effects)
                await this._rebuild({ force: true })
                this._updateLayerStack()
                this._updateLayerZIndex()
                this._markDirty()

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
     * Update the filename in the menu bar
     * @param {string} filename - Filename to display
     * @private
     */
    _updateFilename(filename) {
        const el = document.getElementById('menuFilename')
        if (el) {
            el.textContent = filename.replace(/\.[^.]+$/, '')
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
        const modes = ['fit', '50', '100', '200']
        const menuIds = {
            'fit': 'fitInWindowMenuItem',
            '50': 'zoom50MenuItem',
            '100': 'zoom100MenuItem',
            '200': 'zoom200MenuItem'
        }
        modes.forEach(mode => {
            const el = document.getElementById(menuIds[mode])
            if (el) {
                el.classList.toggle('checked', mode === this._zoomMode)
            }
        })

        const overlay = this._selectionOverlay

        if (this._zoomMode === 'fit') {
            // Fit in window - calculate size to maintain aspect ratio
            const container = canvas.parentElement
            const containerWidth = container.clientWidth
            const containerHeight = container.clientHeight
            const canvasAspect = canvas.width / canvas.height
            const containerAspect = containerWidth / containerHeight

            let displayWidth, displayHeight
            if (canvasAspect > containerAspect) {
                // Canvas is wider than container - fit to width
                displayWidth = containerWidth
                displayHeight = containerWidth / canvasAspect
            } else {
                // Canvas is taller than container - fit to height
                displayHeight = containerHeight
                displayWidth = containerHeight * canvasAspect
            }

            canvas.style.maxWidth = 'none'
            canvas.style.maxHeight = 'none'
            canvas.style.width = displayWidth + 'px'
            canvas.style.height = displayHeight + 'px'
            if (overlay) {
                overlay.style.maxWidth = 'none'
                overlay.style.maxHeight = 'none'
                overlay.style.width = displayWidth + 'px'
                overlay.style.height = displayHeight + 'px'
            }
        } else {
            // Specific percentage
            const percent = parseInt(this._zoomMode) / 100
            canvas.style.maxWidth = 'none'
            canvas.style.maxHeight = 'none'
            canvas.style.width = (canvas.width * percent) + 'px'
            canvas.style.height = (canvas.height * percent) + 'px'
            if (overlay) {
                overlay.style.maxWidth = 'none'
                overlay.style.maxHeight = 'none'
                overlay.style.width = (canvas.width * percent) + 'px'
                overlay.style.height = (canvas.height * percent) + 'px'
            }
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

        // File menu - New
        document.getElementById('newMenuItem')?.addEventListener('click', async () => {
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

        // File menu - Open
        document.getElementById('openMenuItem')?.addEventListener('click', async () => {
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

        // Add text layer button (layers panel)
        document.getElementById('addTextLayerBtn')?.addEventListener('click', () => {
            if (this._layers.length === 0) return
            this._handleAddEffectLayer('filter/text')
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

        // Move tool button
        document.getElementById('moveToolBtn')?.addEventListener('click', () => {
            this._setToolMode('move')
        })

        // Play/pause button
        document.getElementById('playPauseBtn')?.addEventListener('click', () => {
            this._togglePlayPause()
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
            this._handleDeleteLayer(e.detail.layerId)
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

        // Capture current canvas (all visible layers composited)
        const canvasWidth = this._canvas.width
        const canvasHeight = this._canvas.height

        const offscreen = new OffscreenCanvas(canvasWidth, canvasHeight)
        const ctx = offscreen.getContext('2d')
        ctx.drawImage(this._canvas, 0, 0)

        // Convert to blob and create media layer
        const blob = await offscreen.convertToBlob({ type: 'image/png' })
        const file = new File([blob], 'flattened-image.png', { type: 'image/png' })

        const { createMediaLayer } = await import('./layers/layer-model.js')
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

        toast.success('Image flattened')
    }

    /**
     * Rasterize a single effect layer to media
     * @param {string} layerId
     * @private
     */
    async _rasterizeLayer(layerId) {
        const layerIndex = this._layers.findIndex(l => l.id === layerId)
        if (layerIndex === -1) return

        const layer = this._layers[layerIndex]
        if (layer.sourceType === 'media') return // Already media

        // Save original visibility states
        const visibilitySnapshot = this._layers.map(l => ({ id: l.id, visible: l.visible }))

        // Hide all other layers
        for (const l of this._layers) {
            if (l.id !== layerId) {
                l.visible = false
            }
        }

        // Rebuild to render only this layer
        await this._rebuild()

        // Capture the rendered result
        const canvasWidth = this._canvas.width
        const canvasHeight = this._canvas.height

        const offscreen = new OffscreenCanvas(canvasWidth, canvasHeight)
        const ctx = offscreen.getContext('2d')
        ctx.drawImage(this._canvas, 0, 0)

        // Restore visibility
        for (const snap of visibilitySnapshot) {
            const l = this._layers.find(layer => layer.id === snap.id)
            if (l) l.visible = snap.visible
        }

        // Convert to blob and create media layer
        const blob = await offscreen.convertToBlob({ type: 'image/png' })
        const file = new File([blob], 'rasterized.png', { type: 'image/png' })

        const { createMediaLayer } = await import('./layers/layer-model.js')
        const newLayer = createMediaLayer(file, 'image', `${layer.name} (rasterized)`)

        // Preserve properties from original layer
        newLayer.visible = layer.visible
        newLayer.opacity = layer.opacity
        newLayer.blendMode = layer.blendMode
        // Offset is baked in, reset to 0
        newLayer.offsetX = 0
        newLayer.offsetY = 0

        // Load media
        await this._renderer.loadMedia(newLayer.id, file, 'image')

        // Replace the layer in the stack
        this._layers[layerIndex] = newLayer

        // Update UI
        this._updateLayerStack()
        if (this._layerStack) {
            this._layerStack.selectedLayerId = newLayer.id
        }
        await this._rebuild()
        this._markDirty()

        toast.success('Layer rasterized')
    }

    /**
     * Flatten multiple selected layers into one
     * @param {Array<string>} layerIds
     * @private
     */
    async _flattenLayers(layerIds) {
        if (layerIds.length < 2) return

        // Find the layers and their indices
        const selectedLayers = layerIds
            .map(id => ({ layer: this._layers.find(l => l.id === id), index: this._layers.findIndex(l => l.id === id) }))
            .filter(item => item.layer && item.index !== -1)
            .sort((a, b) => a.index - b.index)

        if (selectedLayers.length < 2) return

        // Find topmost selected layer index (highest index = top of stack)
        const topmostIndex = Math.max(...selectedLayers.map(item => item.index))

        // Save original visibility states
        const visibilitySnapshot = this._layers.map(l => ({ id: l.id, visible: l.visible }))

        // Hide all layers except selected visible ones
        for (const l of this._layers) {
            const isSelected = layerIds.includes(l.id)
            if (!isSelected) {
                l.visible = false
            }
            // Selected but hidden layers stay hidden (will be discarded)
        }

        // Rebuild to render only selected visible layers
        await this._rebuild()

        // Capture the rendered result
        const canvasWidth = this._canvas.width
        const canvasHeight = this._canvas.height

        const offscreen = new OffscreenCanvas(canvasWidth, canvasHeight)
        const ctx = offscreen.getContext('2d')
        ctx.drawImage(this._canvas, 0, 0)

        // Restore visibility
        for (const snap of visibilitySnapshot) {
            const l = this._layers.find(layer => layer.id === snap.id)
            if (l) l.visible = snap.visible
        }

        // Convert to blob and create media layer
        const blob = await offscreen.convertToBlob({ type: 'image/png' })
        const file = new File([blob], 'flattened.png', { type: 'image/png' })

        const { createMediaLayer } = await import('./layers/layer-model.js')
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
                    selected.visible = !selected.visible
                    this._updateLayerStack()
                    this._rebuild()
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
     * Auto-select the topmost layer and return it
     * @returns {object|null}
     * @private
     */
    _autoSelectTopmostLayer() {
        // Find topmost layer
        if (this._layers.length > 0) {
            const layer = this._layers[this._layers.length - 1]
            if (this._layerStack) {
                this._layerStack.selectedLayerId = layer.id
            }
            return layer
        }
        return null
    }

    /**
     * Update active layer's position offset
     * @param {number} x
     * @param {number} y
     * @private
     */
    _updateActiveLayerPosition(x, y) {
        const layer = this._getActiveLayer()
        if (!layer) return

        layer.offsetX = x
        layer.offsetY = y

        this._renderer.updateLayerOffset(layer.id, x, y)
        this._markDirty()
    }

    /**
     * Rasterize a layer in place without UI updates or toast
     * Used internally before extraction
     * @param {string} layerId
     * @private
     */
    async _rasterizeLayerInPlace(layerId) {
        const layerIndex = this._layers.findIndex(l => l.id === layerId)
        if (layerIndex === -1) return

        const layer = this._layers[layerIndex]
        if (layer.sourceType === 'media') return

        // Save and hide other layers
        const visibilitySnapshot = this._layers.map(l => ({ id: l.id, visible: l.visible }))
        for (const l of this._layers) {
            if (l.id !== layerId) l.visible = false
        }
        await this._rebuild()

        // Capture rendered result
        const offscreen = new OffscreenCanvas(this._canvas.width, this._canvas.height)
        const ctx = offscreen.getContext('2d')
        ctx.drawImage(this._canvas, 0, 0)

        // Restore visibility
        for (const snap of visibilitySnapshot) {
            const l = this._layers.find(layer => layer.id === snap.id)
            if (l) l.visible = snap.visible
        }

        // Convert to media layer
        const blob = await offscreen.convertToBlob({ type: 'image/png' })
        const file = new File([blob], 'rasterized.png', { type: 'image/png' })

        const { createMediaLayer } = await import('./layers/layer-model.js')
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
    }

    /**
     * Extract current selection to a new layer
     * Auto-rasterizes effect layers, then punches hole and moves pixels
     * @private
     */
    async _extractSelectionToLayer() {
        try {
            if (!this._selectionManager?.hasSelection()) {
                console.warn('[Extract] No selection')
                return false
            }

            const selectionPath = this._selectionManager.selectionPath
            let activeLayer = this._getActiveLayer()

            // Auto-rasterize effect layers before extracting
            if (activeLayer && activeLayer.sourceType !== 'media') {
                await this._rasterizeLayerInPlace(activeLayer.id)
                activeLayer = this._getActiveLayer() // Get updated layer
            }

            const bounds = getSelectionBounds(selectionPath)
            if (bounds.width <= 0 || bounds.height <= 0) {
                console.warn('[Extract] Invalid bounds')
                return false
            }

            const canvasWidth = this._canvas.width
            const canvasHeight = this._canvas.height

            // Clamp bounds to canvas
            const extractBounds = {
                x: Math.max(0, Math.floor(bounds.x)),
                y: Math.max(0, Math.floor(bounds.y)),
                width: Math.ceil(bounds.width),
                height: Math.ceil(bounds.height)
            }
            extractBounds.width = Math.min(extractBounds.width, canvasWidth - extractBounds.x)
            extractBounds.height = Math.min(extractBounds.height, canvasHeight - extractBounds.y)

            if (extractBounds.width <= 0 || extractBounds.height <= 0) {
                return false
            }

            // Need an active layer to extract from
            if (!activeLayer) {
                console.warn('[Extract] No active layer')
                return false
            }

            // Create selection mask at canvas size
            const maskCanvas = new OffscreenCanvas(canvasWidth, canvasHeight)
            const maskCtx = maskCanvas.getContext('2d')
            this._drawSelectionMask(maskCtx, selectionPath)

            // After auto-rasterization, layer is always media type
            if (activeLayer.sourceType === 'media' && activeLayer.mediaFile) {
                // Get source image
                const sourceImg = await this._getLayerImage(activeLayer)
                if (!sourceImg) {
                    return false
                }

                // Create extracted pixels canvas
                const extractedCanvas = new OffscreenCanvas(canvasWidth, canvasHeight)
                const extractedCtx = extractedCanvas.getContext('2d')
                const layerOffsetX = activeLayer.offsetX || 0
                const layerOffsetY = activeLayer.offsetY || 0
                extractedCtx.drawImage(sourceImg, layerOffsetX, layerOffsetY)
                extractedCtx.globalCompositeOperation = 'destination-in'
                extractedCtx.drawImage(maskCanvas, 0, 0)
                extractedCtx.globalCompositeOperation = 'source-over'

                // Check if any pixels
                const checkData = extractedCtx.getImageData(extractBounds.x, extractBounds.y, extractBounds.width, extractBounds.height)
                let hasAnyPixels = false
                for (let i = 0; i < checkData.data.length; i += 4) {
                    if (checkData.data[i + 3] > 0) {
                        hasAnyPixels = true
                        break
                    }
                }
                if (!hasAnyPixels) {
                    toast.warning('no pixels selected')
                    return false
                }

                // Punch hole in source - translate mask from canvas coords to source coords
                const sourceCanvas = new OffscreenCanvas(sourceImg.width, sourceImg.height)
                const sourceCtx = sourceCanvas.getContext('2d')
                sourceCtx.drawImage(sourceImg, 0, 0)
                sourceCtx.globalCompositeOperation = 'destination-out'
                sourceCtx.drawImage(maskCanvas, -layerOffsetX, -layerOffsetY)
                sourceCtx.globalCompositeOperation = 'source-over'

                // Update source layer
                const sourceBlob = await sourceCanvas.convertToBlob({ type: 'image/png' })
                const sourceFile = new File([sourceBlob], activeLayer.mediaFile?.name || 'layer.png', { type: 'image/png' })
                activeLayer.mediaFile = sourceFile
                await this._renderer.loadMedia(activeLayer.id, sourceFile, 'image')

                // Create new layer with extracted pixels
                const extractedBlob = await extractedCanvas.convertToBlob({ type: 'image/png' })
                const extractedFile = new File([extractedBlob], 'moved-selection.png', { type: 'image/png' })

                const { createMediaLayer } = await import('./layers/layer-model.js')
                const newLayer = createMediaLayer(extractedFile, 'image', 'moved selection')

                // Insert after active layer
                const activeIndex = this._layers.findIndex(l => l.id === activeLayer.id)
                this._layers.splice(activeIndex + 1, 0, newLayer)

                await this._renderer.loadMedia(newLayer.id, extractedFile, 'image')
                this._layerStack.selectedLayerId = newLayer.id
            }

            this._selectionManager.clearSelection()
            this._updateLayerStack()
            await this._rebuild()
            this._markDirty()
            return true
        } catch (err) {
            console.error('[Extract] ERROR:', err)
            throw err
        }
    }

    /**
     * Get image element for a layer
     * @param {object} layer
     * @returns {Promise<HTMLImageElement|null>}
     * @private
     */
    async _getLayerImage(layer) {
        if (!layer.mediaFile) return null

        return new Promise((resolve) => {
            const img = new Image()
            const url = URL.createObjectURL(layer.mediaFile)
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
     * Draw selection mask to canvas context
     * @param {CanvasRenderingContext2D} ctx
     * @param {object} selectionPath
     * @private
     */
    _drawSelectionMask(ctx, selectionPath) {
        this._drawSelectionMaskOffset(ctx, selectionPath, 0, 0)
    }

    /**
     * Draw selection mask to canvas context with offset
     * @param {CanvasRenderingContext2D} ctx
     * @param {object} selectionPath
     * @param {number} offsetX
     * @param {number} offsetY
     * @private
     */
    _drawSelectionMaskOffset(ctx, selectionPath, offsetX, offsetY) {
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
     * Show dialog for multi-layer move not supported
     * @private
     */
    _showMultiLayerNotSupportedDialog() {
        confirmDialog.show({
            message: 'Moving multiple layers is not yet supported. Please select a single layer.',
            confirmText: 'OK',
            cancelText: null,
            danger: false
        })
    }

    /**
     * Set current tool mode
     * @param {'selection' | 'move'} tool
     * @private
     */
    _setToolMode(tool) {
        this._currentTool = tool

        // Deactivate all tools
        this._moveTool?.deactivate()

        // Update button states
        const moveBtn = document.getElementById('moveToolBtn')
        if (moveBtn) {
            moveBtn.classList.toggle('active', tool === 'move')
        }
        const selectionToolBtn = document.getElementById('selectionToolBtn')
        if (selectionToolBtn) {
            selectionToolBtn.classList.toggle('active', tool !== 'move')
        }

        // Clear selection tool checkmarks when move tool is active
        if (tool === 'move') {
            const items = ['Rect', 'Oval', 'Lasso', 'Polygon', 'Wand']
            items.forEach(item => {
                const el = document.getElementById(`select${item}MenuItem`)
                if (el) el.classList.remove('checked')
            })
        }

        // Activate selected tool
        if (tool === 'move') {
            this._moveTool?.activate()
            this._selectionManager.enabled = false
            this._selectionOverlay?.classList.add('move-tool')
        } else {
            this._selectionManager.enabled = true
            this._selectionOverlay?.classList.remove('move-tool')
        }
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
            this._updateFilename(projectName)
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
            this._updateFilename(project.name)

            // Update UI and rebuild
            this._updateLayerStack()
            // Wait for any pending microtasks (canvas observer uses queueMicrotask)
            await new Promise(resolve => queueMicrotask(resolve))
            await this._rebuild()
            // Wait for next frame to ensure WebGL state is stable
            await new Promise(resolve => requestAnimationFrame(resolve))
            this._renderer.start()
            this._markClean()

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

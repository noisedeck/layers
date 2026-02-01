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
import { copySelection, pasteFromClipboard } from './selection/clipboard-ops.js'

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

        // Register service worker for PWA support
        registerServiceWorker()

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
        this._setupKeyboardShortcuts()

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
     * Handle layer reorder
     * @param {Array} newLayers - Reordered layers array
     * @private
     */
    async _handleLayerReorder(newLayers) {
        this._layers = newLayers
        await this._rebuild()
        this._markDirty()
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
    }

    /**
     * Rebuild and render
     * @private
     */
    async _rebuild() {
        const result = await this._renderer.setLayers(this._layers)
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
        } else {
            // Specific percentage
            const percent = parseInt(this._zoomMode) / 100
            canvas.style.maxWidth = 'none'
            canvas.style.maxHeight = 'none'
            canvas.style.width = (canvas.width * percent) + 'px'
            canvas.style.height = (canvas.height * percent) + 'px'
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

        // Add text layer button
        document.getElementById('addTextLayerBtn')?.addEventListener('click', () => {
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

        // Play/pause button
        document.getElementById('playPauseBtn')?.addEventListener('click', () => {
            this._togglePlayPause()
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

        this._layerStack.addEventListener('layers-reorder', (e) => {
            this._handleLayerReorder(e.detail.layers)
        })
    }

    /**
     * Set up keyboard shortcuts
     * @private
     */
    _setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl/Cmd+S - save project (allow in inputs)
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault()
                this._showSaveProjectDialog()
                return
            }

            // Ctrl/Cmd+C - copy selection
            if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
                if (this._selectionManager?.hasSelection()) {
                    e.preventDefault()
                    this._handleCopy()
                    return
                }
            }

            // Ctrl/Cmd+V - paste
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

            // M - cycle selection tools
            if (e.key === 'm' || e.key === 'M') {
                const current = this._selectionManager?.currentTool
                this._setSelectionTool(current === 'rectangle' ? 'oval' : 'rectangle')
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
     * @param {'rectangle' | 'oval'} tool
     * @private
     */
    _setSelectionTool(tool) {
        if (!this._selectionManager) return

        this._selectionManager.currentTool = tool

        // Update menu checkmarks
        const rectItem = document.getElementById('selectRectMenuItem')
        const ovalItem = document.getElementById('selectOvalMenuItem')
        const icon = document.getElementById('selectionToolIcon')

        if (rectItem) rectItem.classList.toggle('checked', tool === 'rectangle')
        if (ovalItem) ovalItem.classList.toggle('checked', tool === 'oval')
        if (icon) icon.textContent = tool === 'rectangle' ? 'crop_square' : 'circle'
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

        // Determine position
        let x, y
        if (this._copyOrigin) {
            x = this._copyOrigin.x
            y = this._copyOrigin.y
        } else {
            // Center of canvas
            const img = await createImageBitmap(blob)
            x = Math.round((this._canvas.width - img.width) / 2)
            y = Math.round((this._canvas.height - img.height) / 2)
        }

        // Create file from blob for the layer system
        const file = new File([blob], 'pasted-image.png', { type: 'image/png' })

        // Create media layer
        const { createMediaLayer } = await import('./layers/layer-model.js')
        const layer = createMediaLayer(file, 'image')
        layer.name = 'Pasted'

        // Store position in effectParams for the renderer
        layer.effectParams = {
            ...layer.effectParams,
            position: [x, y]
        }

        // Add layer
        this._layers.push(layer)

        // Load media
        await this._renderer.loadMedia(layer.id, file, 'image')

        // Update and rebuild
        this._updateLayerStack()
        await this._rebuild()
        this._markDirty()

        // Clear copy origin for next paste
        this._copyOrigin = null

        toast.success('Pasted as new layer')
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

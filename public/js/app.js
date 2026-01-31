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
import { toast } from './ui/toast.js'
import { exportPng, exportJpg, getTimestampedFilename } from './utils/export.js'
import { saveProject, loadProject } from './utils/project-storage.js'

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
    }

    /**
     * Initialize the application
     */
    async init() {
        console.log('[Layers] Initializing...')

        // Get DOM elements
        this._canvas = document.getElementById('canvas')
        this._layerStack = document.querySelector('layer-stack')

        if (!this._canvas) {
            console.error('[Layers] Canvas not found')
            return
        }

        // Create renderer
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
            console.log('[Layers] Renderer initialized')

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

        // Hide loading screen and show open dialog
        this._hideLoadingScreen()
        this._showOpenDialog()

        this._initialized = true
        console.log('[Layers] Ready')
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
            isBaseLayer: true,
            onOpen: async (file, mediaType) => {
                await this._handleOpenMedia(file, mediaType)
            },
            onSolid: async () => {
                await this._handleCreateSolidBase()
            },
            onGradient: async () => {
                await this._handleCreateGradientBase()
            },
            onTransparent: async () => {
                await this._handleCreateTransparentBase()
            }
        })
    }

    /**
     * Create a solid color base layer
     * @private
     */
    async _handleCreateSolidBase() {
        console.log('[Layers] Creating solid base layer')

        const layer = createEffectLayer('synth/solid')
        layer.name = 'Solid'
        layer.effectParams = { color: [0.2, 0.2, 0.2], alpha: 1 }
        this._layers = [layer]

        // Set default canvas size
        this._resizeCanvas(1024, 1024)

        this._updateLayerStack()
        await this._rebuild()
        this._renderer.start()

        // Reset project state
        this._currentProjectId = null
        this._currentProjectName = null
        this._updateFilename('untitled')
        toast.success('Created solid base layer')
    }

    /**
     * Create a gradient base layer
     * @private
     */
    async _handleCreateGradientBase() {
        console.log('[Layers] Creating gradient base layer')

        const layer = createEffectLayer('synth/gradient')
        layer.name = 'Gradient'
        this._layers = [layer]

        // Set default canvas size
        this._resizeCanvas(1024, 1024)

        this._updateLayerStack()
        await this._rebuild()
        this._renderer.start()

        // Reset project state
        this._currentProjectId = null
        this._currentProjectName = null
        this._updateFilename('untitled')
        toast.success('Created gradient base layer')
    }

    /**
     * Create a transparent base layer
     * @private
     */
    async _handleCreateTransparentBase() {
        console.log('[Layers] Creating transparent base layer')

        const layer = createEffectLayer('synth/solid')
        layer.name = 'Transparent'
        layer.effectParams = { color: [0, 0, 0], alpha: 0 }
        this._layers = [layer]

        // Set default canvas size
        this._resizeCanvas(1024, 1024)

        this._updateLayerStack()
        await this._rebuild()
        this._renderer.start()

        // Reset project state
        this._currentProjectId = null
        this._currentProjectName = null
        this._updateFilename('untitled')
        toast.success('Created transparent base layer')
    }

    /**
     * Handle opening a media file
     * @param {File} file - Media file
     * @param {string} mediaType - 'image' or 'video'
     * @private
     */
    async _handleOpenMedia(file, mediaType) {
        console.log('[Layers] Opening media:', file.name, mediaType)

        // Create base layer
        const layer = createMediaLayer(file, mediaType)
        console.log('[Layers] Created layer:', layer)
        this._layers = [layer]
        console.log('[Layers] this._layers is now:', this._layers)

        // Load media into renderer
        try {
            const dimensions = await this._renderer.loadMedia(layer.id, file, mediaType)
            console.log('[Layers] Media loaded successfully, dimensions:', dimensions)
            
            // Resize canvas to match base layer media dimensions
            if (dimensions.width > 0 && dimensions.height > 0) {
                this._resizeCanvas(dimensions.width, dimensions.height)
            }
        } catch (err) {
            console.error('[Layers] Failed to load media:', err)
            toast.error('Failed to load media: ' + err.message)
            return
        }

        // Update layer stack
        this._updateLayerStack()

        // Rebuild and start rendering
        await this._rebuild()
        this._renderer.start()

        // Reset project state and update filename
        this._currentProjectId = null
        this._currentProjectName = null
        this._updateFilename(file.name)

        toast.success(`Opened ${file.name}`)
    }

    /**
     * Handle adding a media layer
     * @param {File} file - Media file
     * @param {string} mediaType - 'image' or 'video'
     * @private
     */
    async _handleAddMediaLayer(file, mediaType) {
        console.log('[Layers] Adding media layer:', file.name, mediaType)

        const layer = createMediaLayer(file, mediaType)
        this._layers.push(layer)

        // Load media
        await this._renderer.loadMedia(layer.id, file, mediaType)

        // Update and rebuild
        this._updateLayerStack()
        await this._rebuild()

        toast.success(`Added layer: ${layer.name}`)
    }

    /**
     * Handle adding an effect layer
     * @param {string} effectId - Effect ID
     * @private
     */
    async _handleAddEffectLayer(effectId) {
        console.log('[Layers] Adding effect layer:', effectId)

        const layer = createEffectLayer(effectId)
        this._layers.push(layer)

        // Update and rebuild
        this._updateLayerStack()
        await this._rebuild()

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

        toast.info(`Deleted layer: ${layer.name}`)
    }

    /**
     * Handle layer changes (visibility, blend mode, opacity, effectParams)
     * @param {object} detail - Change detail
     * @private
     */
    async _handleLayerChange(detail) {
        console.log('[Layers] Layer change:', detail)

        // Update layer in our array
        const layer = this._layers.find(l => l.id === detail.layerId)
        if (layer) {
            layer[detail.property] = detail.value
        }

        // Determine if this requires a full rebuild or just a parameter update
        switch (detail.property) {
            case 'effectParams':
                // Update parameters directly without recompiling
                this._renderer.updateLayerParams(detail.layerId, detail.value)
                // Keep DSL in sync to prevent spurious rebuild on next structural change
                this._renderer.syncDsl()
                break

            case 'opacity':
                // Update opacity via blendMode uniform
                this._renderer.updateLayerOpacity(detail.layerId, detail.value)
                // Keep DSL in sync to prevent spurious rebuild on next structural change
                this._renderer.syncDsl()
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
        console.log('[Layers] Reordering layers')
        this._layers = newLayers
        await this._rebuild()
    }

    /**
     * Update the layer stack component
     * @private
     */
    _updateLayerStack() {
        console.log('[Layers] _updateLayerStack called, layers:', this._layers.length)

        // Re-query in case the element wasn't ready before
        if (!this._layerStack) {
            this._layerStack = document.querySelector('layer-stack')
        }

        if (this._layerStack) {
            console.log('[Layers] Setting layer-stack.layers to', this._layers)
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
        console.log('[Layers] Resizing canvas to:', width, height)
        
        // Update canvas element
        this._canvas.width = width
        this._canvas.height = height
        
        // Update renderer
        this._renderer.resize(width, height)
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

        // File menu
        document.getElementById('openMenuItem')?.addEventListener('click', () => {
            openDialog.show({
                isBaseLayer: true,
                onOpen: async (file, mediaType) => {
                    // Reset layers and load new base
                    this._resetLayers()
                    await this._handleOpenMedia(file, mediaType)
                },
                onSolid: async () => {
                    this._resetLayers()
                    await this._handleCreateSolidBase()
                },
                onGradient: async () => {
                    this._resetLayers()
                    await this._handleCreateGradientBase()
                },
                onTransparent: async () => {
                    this._resetLayers()
                    await this._handleCreateTransparentBase()
                }
            })
        })

        document.getElementById('saveProjectMenuItem')?.addEventListener('click', () => {
            this._showSaveProjectDialog()
        })

        document.getElementById('loadProjectMenuItem')?.addEventListener('click', () => {
            this._showLoadProjectDialog()
        })

        document.getElementById('savePngMenuItem')?.addEventListener('click', () => {
            this._quickSavePng()
        })

        document.getElementById('saveJpgMenuItem')?.addEventListener('click', () => {
            this._quickSaveJpg()
        })

        // Add layer button
        document.getElementById('addLayerBtn')?.addEventListener('click', () => {
            this._showAddLayerDialog()
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
     * Show the load project dialog
     * @private
     */
    _showLoadProjectDialog() {
        projectManagerDialog.show({
            onLoad: async (projectId) => {
                await this._loadProject(projectId)
            }
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
            await this._rebuild()
            this._renderer.start()

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

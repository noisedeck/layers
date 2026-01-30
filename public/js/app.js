/**
 * Layers App
 * Main entry point
 *
 * @module app
 */

import { LayersRenderer } from './noisemaker/renderer.js'
import { createMediaLayer, createEffectLayer } from './layers/layer-model.js'
import './layers/layer-stack.js'
import { openDialog } from './ui/open-dialog.js'
import { addLayerDialog } from './ui/add-layer-dialog.js'
import { aboutDialog } from './ui/about-dialog.js'
import { shareModal } from './ui/share-modal.js'
import { toast } from './ui/toast.js'
import { exportPng, exportJpg, getTimestampedFilename } from './utils/export.js'

/**
 * Main application class
 */
class LayersApp {
    constructor() {
        this._renderer = null
        this._layerStack = null
        this._layers = []
        this._initialized = false
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
            width: 1024,
            height: 1024,
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
     * Show the open dialog to select initial media
     * @private
     */
    _showOpenDialog() {
        openDialog.show({
            onOpen: async (file, mediaType) => {
                await this._handleOpenMedia(file, mediaType)
            }
        })
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
            await this._renderer.loadMedia(layer.id, file, mediaType)
            console.log('[Layers] Media loaded successfully')
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

        // Update filename in menu
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
     * Handle layer changes (visibility, blend mode, opacity)
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

        // Rebuild
        await this._rebuild()
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
                onOpen: async (file, mediaType) => {
                    // Reset layers and load new base
                    this._layers.forEach(l => {
                        if (l.sourceType === 'media') {
                            this._renderer.unloadMedia(l.id)
                        }
                    })
                    this._layers = []
                    await this._handleOpenMedia(file, mediaType)
                }
            })
        })

        document.getElementById('savePngMenuItem')?.addEventListener('click', () => {
            this._quickSavePng()
        })

        document.getElementById('saveJpgMenuItem')?.addEventListener('click', () => {
            this._quickSaveJpg()
        })

        // Program menu
        document.getElementById('copyProgramMenuItem')?.addEventListener('click', () => {
            this._copyProgram()
        })

        document.getElementById('sharePubliclyMenuItem')?.addEventListener('click', () => {
            shareModal.show({
                dsl: this._renderer.currentDsl,
                canvas: this._canvas
            })
        })

        document.getElementById('editInNoisedeckMenuItem')?.addEventListener('click', () => {
            this._editInNoisedeck()
        })

        document.getElementById('editInPolymorphicMenuItem')?.addEventListener('click', () => {
            this._editInPolymorphic()
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
            // Don't handle if in input
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
     * Copy program to clipboard
     * @private
     */
    async _copyProgram() {
        const dsl = this._renderer.currentDsl
        if (!dsl) {
            toast.warning('No program to copy')
            return
        }

        try {
            await navigator.clipboard.writeText(dsl)
            toast.success('Copied to clipboard')
        } catch (err) {
            console.error('Failed to copy:', err)
            toast.error('Failed to copy')
        }
    }

    /**
     * Open in Noisedeck
     * @private
     */
    _editInNoisedeck() {
        const dsl = this._renderer.currentDsl
        if (!dsl) {
            toast.warning('No program to edit')
            return
        }

        const encoded = encodeURIComponent(dsl)
        window.open(`https://noisedeck.app/?dsl=${encoded}`, '_blank')
    }

    /**
     * Open in Polymorphic
     * @private
     */
    _editInPolymorphic() {
        const dsl = this._renderer.currentDsl
        if (!dsl) {
            toast.warning('No program to edit')
            return
        }

        const encoded = encodeURIComponent(dsl)
        window.open(`https://polymorphic.noisedeck.app/?dsl=${encoded}`, '_blank')
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

/**
 * Layer Stack Web Component
 * Container for all layers
 *
 * @module layers/layer-stack
 */

import './layer-item.js'

/**
 * LayerStack - Web component for the layer list
 * Displays layers in reverse order (top layer first visually)
 * @extends HTMLElement
 */
class LayerStack extends HTMLElement {
    constructor() {
        super()
        this._layers = []
        this._selectedLayerId = null
    }

    connectedCallback() {
        this._render()
        this._setupEventListeners()
    }

    /**
     * Set the layers array
     * @param {Array} layers - Array of layer objects (bottom to top order)
     */
    set layers(layers) {
        console.log('[LayerStack] set layers called with:', layers)
        this._layers = layers || []
        this._render()
    }

    /**
     * Get the layers array
     * @returns {Array} Layer array
     */
    get layers() {
        return this._layers
    }

    /**
     * Set the selected layer ID
     * @param {string|null} id - Layer ID or null
     */
    set selectedLayerId(id) {
        this._selectedLayerId = id
        this._updateSelection()
    }

    /**
     * Get the selected layer ID
     * @returns {string|null} Selected layer ID
     */
    get selectedLayerId() {
        return this._selectedLayerId
    }

    /**
     * Render the layer stack
     * @private
     */
    _render() {
        console.log('[LayerStack] _render called, layers count:', this._layers.length)
        this.innerHTML = ''

        if (this._layers.length === 0) {
            this.innerHTML = `
                <div class="empty-state">
                    <span class="icon-material">layers</span>
                    <p>No layers yet</p>
                    <p style="font-size: 12px; opacity: 0.7;">Open a media file to get started</p>
                </div>
            `
            return
        }

        // Render layers in reverse order (top first visually)
        const reversedLayers = [...this._layers].reverse()

        for (let i = 0; i < reversedLayers.length; i++) {
            const layer = reversedLayers[i]
            const isBase = i === reversedLayers.length - 1 // Last in reversed = first in original

            const item = document.createElement('layer-item')
            item.layer = layer
            if (isBase) {
                item.setAttribute('base', '')
            }
            if (layer.id === this._selectedLayerId) {
                item.selected = true
            }

            this.appendChild(item)
        }
    }

    /**
     * Update selection state on layer items
     * @private
     */
    _updateSelection() {
        const items = this.querySelectorAll('layer-item')
        items.forEach(item => {
            item.selected = item.layer?.id === this._selectedLayerId
        })
    }

    /**
     * Set up event listeners
     * @private
     */
    _setupEventListeners() {
        // Listen for layer select events
        this.addEventListener('layer-select', (e) => {
            this._selectedLayerId = e.detail.layerId
            this._updateSelection()
        })

        // Listen for reorder events
        this.addEventListener('layer-reorder', (e) => {
            this._handleReorder(e.detail.sourceId, e.detail.targetId)
        })
    }

    /**
     * Handle layer reorder
     * @param {string} sourceId - ID of layer being moved
     * @param {string} targetId - ID of layer to move above (in visual terms)
     * @private
     */
    _handleReorder(sourceId, targetId) {
        const sourceIndex = this._layers.findIndex(l => l.id === sourceId)
        const targetIndex = this._layers.findIndex(l => l.id === targetId)

        if (sourceIndex === -1 || targetIndex === -1) return
        if (sourceIndex === 0) return // Can't move base layer
        if (sourceIndex === targetIndex) return // No-op

        // Remove source layer
        const [sourceLayer] = this._layers.splice(sourceIndex, 1)

        // Calculate new index
        // When sourceIndex < targetIndex, target shifts down by 1 after removal
        // When sourceIndex > targetIndex, target index stays the same
        // In both cases, we want to insert at the target's current position
        let newIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex

        // Don't allow dropping at base layer position (index 0)
        if (newIndex <= 0) {
            newIndex = 1  // Insert just above base layer
        }

        // Insert at new position
        this._layers.splice(newIndex, 0, sourceLayer)

        // Re-render and emit event
        this._render()
        this._updateSelection()

        this.dispatchEvent(new CustomEvent('layers-reorder', {
            bubbles: true,
            detail: { layers: this._layers }
        }))
    }

    /**
     * Add a layer to the stack
     * @param {object} layer - Layer to add
     * @param {number} [index] - Index to insert at (default: top)
     */
    addLayer(layer, index) {
        if (index === undefined) {
            this._layers.push(layer)
        } else {
            this._layers.splice(index, 0, layer)
        }
        this._selectedLayerId = layer.id
        this._render()
    }

    /**
     * Remove a layer from the stack
     * @param {string} layerId - Layer ID to remove
     */
    removeLayer(layerId) {
        const index = this._layers.findIndex(l => l.id === layerId)
        if (index === -1 || index === 0) return // Can't remove base layer

        this._layers.splice(index, 1)

        // Select adjacent layer
        if (this._selectedLayerId === layerId) {
            if (index < this._layers.length) {
                this._selectedLayerId = this._layers[index].id
            } else if (this._layers.length > 0) {
                this._selectedLayerId = this._layers[this._layers.length - 1].id
            } else {
                this._selectedLayerId = null
            }
        }

        this._render()
    }

    /**
     * Get the selected layer
     * @returns {object|null} Selected layer or null
     */
    getSelectedLayer() {
        return this._layers.find(l => l.id === this._selectedLayerId) || null
    }
}

customElements.define('layer-stack', LayerStack)

export { LayerStack }

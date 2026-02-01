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
        this._selectedLayerIds = new Set()
        this._lastClickedLayerId = null  // For shift-click range
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
     * Set the selected layer ID (single select, clears others)
     * @param {string|null} id - Layer ID or null
     */
    set selectedLayerId(id) {
        this._selectedLayerIds.clear()
        if (id) {
            this._selectedLayerIds.add(id)
            this._lastClickedLayerId = id
        }
        this._updateSelection()
    }

    /**
     * Get the primary selected layer ID (first in set)
     * @returns {string|null} Selected layer ID
     */
    get selectedLayerId() {
        return this._selectedLayerIds.size > 0
            ? [...this._selectedLayerIds][0]
            : null
    }

    /**
     * Get all selected layer IDs
     * @returns {string[]} Array of selected layer IDs
     */
    get selectedLayerIds() {
        return [...this._selectedLayerIds]
    }

    /**
     * Get all selected layers
     * @returns {object[]} Array of selected layer objects
     */
    get selectedLayers() {
        return this._layers.filter(l => this._selectedLayerIds.has(l.id))
    }

    /**
     * Render the layer stack
     * @private
     */
    _render() {
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
            if (this._selectedLayerIds.has(layer.id)) {
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
            item.selected = this._selectedLayerIds.has(item.layer?.id)
        })
    }

    /**
     * Set up event listeners
     * @private
     */
    _setupEventListeners() {
        // Listen for layer select events
        this.addEventListener('layer-select', (e) => {
            const layerId = e.detail.layerId
            const ctrlKey = e.detail.ctrlKey || e.detail.metaKey
            const shiftKey = e.detail.shiftKey

            if (ctrlKey) {
                // Cmd/Ctrl+click: toggle selection
                if (this._selectedLayerIds.has(layerId)) {
                    this._selectedLayerIds.delete(layerId)
                } else {
                    this._selectedLayerIds.add(layerId)
                }
                this._lastClickedLayerId = layerId
            } else if (shiftKey && this._lastClickedLayerId) {
                // Shift+click: range select
                const lastIndex = this._layers.findIndex(l => l.id === this._lastClickedLayerId)
                const currentIndex = this._layers.findIndex(l => l.id === layerId)

                if (lastIndex !== -1 && currentIndex !== -1) {
                    const start = Math.min(lastIndex, currentIndex)
                    const end = Math.max(lastIndex, currentIndex)

                    for (let i = start; i <= end; i++) {
                        this._selectedLayerIds.add(this._layers[i].id)
                    }
                }
            } else {
                // Plain click: single select
                this._selectedLayerIds.clear()
                this._selectedLayerIds.add(layerId)
                this._lastClickedLayerId = layerId
            }

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

        const isInvalidMove = sourceIndex === -1 ||
            targetIndex === -1 ||
            sourceIndex === 0 ||
            sourceIndex === targetIndex

        if (isInvalidMove) return

        const [sourceLayer] = this._layers.splice(sourceIndex, 1)

        // After removal, indices shift: adjust target if source was before it
        const adjustedTarget = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex

        // Ensure we never place a layer at or before the base layer (index 0)
        const newIndex = Math.max(1, adjustedTarget)

        this._layers.splice(newIndex, 0, sourceLayer)
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
        this._selectedLayerIds.clear()
        this._selectedLayerIds.add(layer.id)
        this._lastClickedLayerId = layer.id
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

        // Remove from selection if selected
        this._selectedLayerIds.delete(layerId)

        // If we removed the last clicked layer, update it
        if (this._lastClickedLayerId === layerId) {
            this._lastClickedLayerId = this._selectedLayerIds.size > 0
                ? [...this._selectedLayerIds][0]
                : null
        }

        // If no selection remains, select adjacent layer
        if (this._selectedLayerIds.size === 0) {
            if (index < this._layers.length) {
                this._selectedLayerIds.add(this._layers[index].id)
            } else if (this._layers.length > 0) {
                this._selectedLayerIds.add(this._layers[this._layers.length - 1].id)
            }
        }

        this._render()
    }

    /**
     * Get the selected layer (primary/first if multiple)
     * @returns {object|null} Selected layer or null
     */
    getSelectedLayer() {
        if (this._selectedLayerIds.size === 0) return null
        const id = [...this._selectedLayerIds][0]
        return this._layers.find(l => l.id === id) || null
    }
}

customElements.define('layer-stack', LayerStack)

export { LayerStack }

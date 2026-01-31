/**
 * Layer Item Web Component
 * Individual layer in the stack
 *
 * @module layers/layer-item
 */

import { BLEND_MODES } from './blend-modes.js'
import './effect-params.js'

/**
 * LayerItem - Web component for a single layer
 * @extends HTMLElement
 */
class LayerItem extends HTMLElement {
    constructor() {
        super()
        this._layer = null
        this._selected = false
        this._paramsExpanded = false
        this._dragFromHandle = false
    }

    connectedCallback() {
        this._render()
        this._setupEventListeners()
    }

    disconnectedCallback() {
        // Clean up event listeners
    }

    /**
     * Set the layer data
     * @param {object} layer - Layer object
     */
    set layer(layer) {
        this._layer = layer
        this._render()
    }

    /**
     * Get the layer data
     * @returns {object} Layer object
     */
    get layer() {
        return this._layer
    }

    /**
     * Set selected state
     * @param {boolean} selected
     */
    set selected(selected) {
        this._selected = selected
        this.classList.toggle('selected', selected)
    }

    /**
     * Get selected state
     * @returns {boolean}
     */
    get selected() {
        return this._selected
    }

    /**
     * Render the component
     * @private
     */
    _render() {
        if (!this._layer) {
            this.innerHTML = ''
            return
        }

        const layer = this._layer
        const isVisible = layer.visible
        const isEffect = layer.sourceType === 'effect'
        const isMedia = layer.sourceType === 'media'
        const hasParams = isEffect || isMedia  // Both effect and media layers have params
        const isBase = this.hasAttribute('base')

        // Build blend mode options
        const blendOptions = BLEND_MODES.map(mode =>
            `<option value="${mode.id}" ${layer.blendMode === mode.id ? 'selected' : ''}>${mode.name}</option>`
        ).join('')

        // Determine icon
        let thumbnailContent
        if (isEffect) {
            thumbnailContent = '<span class="icon-material">auto_awesome</span>'
        } else if (layer.mediaType === 'video') {
            thumbnailContent = '<span class="icon-material">videocam</span>'
        } else {
            thumbnailContent = '<span class="icon-material">image</span>'
        }

        this.className = `layer-item ${isEffect ? 'effect-layer' : 'media-layer'} ${isBase ? 'base-layer' : ''} ${layer.locked ? 'locked' : ''}`
        this.dataset.layerId = layer.id
        this.draggable = !isBase

        this.innerHTML = `
            <div class="layer-row">
                <div class="layer-drag-handle" title="Drag to reorder">
                    <span class="icon-material">drag_indicator</span>
                </div>
                <button class="layer-visibility ${isVisible ? 'visible' : ''}" title="Toggle visibility">
                    <span class="icon-material">${isVisible ? 'visibility' : 'visibility_off'}</span>
                </button>
                <div class="layer-thumbnail">
                    ${thumbnailContent}
                </div>
                <div class="layer-info">
                    <div class="layer-name" contenteditable="false" spellcheck="false">${this._escapeHtml(layer.name)}</div>
                    <div class="layer-type ${layer.sourceType}">${isEffect ? 'Effect' : layer.mediaType || 'Media'}</div>
                </div>
                <button class="layer-delete" title="Delete layer">
                    <span class="icon-material">close</span>
                </button>
            </div>
            <div class="layer-controls">
                ${hasParams ? `<button class="layer-params-toggle ${this._paramsExpanded ? 'expanded' : ''}" title="Toggle parameters">
                    <span class="icon-material">arrow_right</span>
                </button>` : ''}
                <select class="layer-blend-mode" title="Blend mode">
                    ${blendOptions}
                </select>
                <div class="layer-opacity-container">
                    <input type="range" class="layer-opacity" min="0" max="100" value="${layer.opacity}" title="Opacity">
                    <span class="layer-opacity-value">${layer.opacity}%</span>
                </div>
            </div>
            ${hasParams ? '<effect-params class="layer-effect-params"></effect-params>' : ''}
        `
        
        // Initialize effect params if this layer has parameters
        if (hasParams) {
            this._initEffectParams()
        }
    }
    
    /**
     * Initialize effect params component
     * @private
     */
    _initEffectParams() {
        const paramsEl = this.querySelector('effect-params')
        if (!paramsEl || !this._layer) return

        // Use effectId for effects, 'synth/media' for media layers
        const effectId = this._layer.sourceType === 'effect'
            ? this._layer.effectId
            : 'synth/media'

        if (effectId) {
            paramsEl.setEffect(
                effectId,
                this._layer.id,
                this._layer.effectParams || {}
            )
            // Apply expanded state via class
            this.classList.toggle('params-expanded', this._paramsExpanded)
        }
    }

    /**
     * Toggle params expanded state
     * @private
     */
    _toggleParamsExpanded() {
        this._paramsExpanded = !this._paramsExpanded

        // Toggle classes for CSS-based show/hide
        this.classList.toggle('params-expanded', this._paramsExpanded)

        const toggleBtn = this.querySelector('.layer-params-toggle')
        if (toggleBtn) {
            toggleBtn.classList.toggle('expanded', this._paramsExpanded)
        }
    }

    /**
     * Set up event listeners
     * @private
     */
    _setupEventListeners() {
        // Visibility toggle
        this.addEventListener('click', (e) => {
            const visBtn = e.target.closest('.layer-visibility')
            if (visBtn) {
                e.stopPropagation()
                this._toggleVisibility()
                return
            }

            const deleteBtn = e.target.closest('.layer-delete')
            if (deleteBtn) {
                e.stopPropagation()
                this._handleDelete()
                return
            }

            const paramsToggle = e.target.closest('.layer-params-toggle')
            if (paramsToggle) {
                e.stopPropagation()
                this._toggleParamsExpanded()
                return
            }

            // Select layer on click (anywhere else except controls and params)
            if (!e.target.closest('.layer-controls') && !e.target.closest('effect-params')) {
                this._emitSelect()
            }
        })

        // Double-click to edit name
        this.addEventListener('dblclick', (e) => {
            const nameEl = e.target.closest('.layer-name')
            if (nameEl) {
                this._startEditingName(nameEl)
            }
        })

        // Blend mode change
        this.addEventListener('change', (e) => {
            if (e.target.classList.contains('layer-blend-mode')) {
                this._handleBlendModeChange(e.target.value)
            }
        })

        // Opacity change
        this.addEventListener('input', (e) => {
            if (e.target.classList.contains('layer-opacity')) {
                this._handleOpacityChange(parseInt(e.target.value, 10))
            }
        })

        // Drag and drop - track if mousedown was on handle
        this.addEventListener('mousedown', (e) => {
            this._dragFromHandle = !!e.target.closest('.layer-drag-handle')
        })

        this.addEventListener('dragstart', (e) => this._handleDragStart(e))
        this.addEventListener('dragend', (e) => this._handleDragEnd(e))
        this.addEventListener('dragover', (e) => this._handleDragOver(e))
        this.addEventListener('dragleave', (e) => this._handleDragLeave(e))
        this.addEventListener('drop', (e) => this._handleDrop(e))
        
        // Effect parameter changes (from effect-params component)
        this.addEventListener('param-change', (e) => {
            e.stopPropagation()
            this._handleParamChange(e.detail)
        })
    }
    
    /**
     * Handle effect parameter change
     * @param {object} detail - Event detail with paramName, value, params
     * @private
     */
    _handleParamChange(detail) {
        if (!this._layer) return
        
        // Update layer's effectParams
        this._layer.effectParams = { ...detail.params }
        
        // Emit as a standard layer-change event
        this._emitChange('effectParams', this._layer.effectParams)
    }

    /**
     * Toggle layer visibility
     * @private
     */
    _toggleVisibility() {
        if (!this._layer) return
        this._layer.visible = !this._layer.visible
        this._render()
        this._emitChange('visibility', this._layer.visible)
    }

    /**
     * Handle delete button click
     * @private
     */
    _handleDelete() {
        this.dispatchEvent(new CustomEvent('layer-delete', {
            bubbles: true,
            detail: { layerId: this._layer.id }
        }))
    }

    /**
     * Start editing the layer name
     * @param {HTMLElement} nameEl - Name element
     * @private
     */
    _startEditingName(nameEl) {
        nameEl.contentEditable = 'true'
        nameEl.classList.add('editing')
        nameEl.focus()

        // Select all text
        const range = document.createRange()
        range.selectNodeContents(nameEl)
        const sel = window.getSelection()
        sel.removeAllRanges()
        sel.addRange(range)

        // Handle blur and enter
        const finishEdit = () => {
            nameEl.contentEditable = 'false'
            nameEl.classList.remove('editing')
            const newName = nameEl.textContent.trim() || 'Untitled'
            nameEl.textContent = newName
            if (this._layer && this._layer.name !== newName) {
                this._layer.name = newName
                this._emitChange('name', newName)
            }
        }

        nameEl.addEventListener('blur', finishEdit, { once: true })
        nameEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault()
                nameEl.blur()
            } else if (e.key === 'Escape') {
                nameEl.textContent = this._layer.name
                nameEl.blur()
            }
        })
    }

    /**
     * Handle blend mode change
     * @param {string} mode - New blend mode
     * @private
     */
    _handleBlendModeChange(mode) {
        if (!this._layer) return
        this._layer.blendMode = mode
        this._emitChange('blendMode', mode)
    }

    /**
     * Handle opacity change
     * @param {number} opacity - New opacity
     * @private
     */
    _handleOpacityChange(opacity) {
        if (!this._layer) return
        this._layer.opacity = opacity

        // Update display
        const valueEl = this.querySelector('.layer-opacity-value')
        if (valueEl) {
            valueEl.textContent = `${opacity}%`
        }

        this._emitChange('opacity', opacity)
    }

    /**
     * Emit a change event
     * @param {string} property - Property that changed
     * @param {*} value - New value
     * @private
     */
    _emitChange(property, value) {
        this.dispatchEvent(new CustomEvent('layer-change', {
            bubbles: true,
            detail: {
                layerId: this._layer.id,
                property,
                value,
                layer: this._layer
            }
        }))
    }

    /**
     * Emit select event
     * @private
     */
    _emitSelect() {
        this.dispatchEvent(new CustomEvent('layer-select', {
            bubbles: true,
            detail: { layerId: this._layer.id }
        }))
    }

    // =========================================================================
    // Drag & Drop
    // =========================================================================

    _handleDragStart(e) {
        // Only allow drag from the drag handle
        if (!this._layer || this.hasAttribute('base') || !this._dragFromHandle) {
            e.preventDefault()
            return
        }
        this.classList.add('dragging')
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', this._layer.id)
    }

    _handleDragEnd(e) {
        this.classList.remove('dragging')
        this._dragFromHandle = false
    }

    _handleDragOver(e) {
        if (this.hasAttribute('base')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        this.classList.add('drag-over')
    }

    _handleDragLeave(e) {
        this.classList.remove('drag-over')
    }

    _handleDrop(e) {
        e.preventDefault()
        this.classList.remove('drag-over')

        const sourceId = e.dataTransfer.getData('text/plain')
        if (sourceId && sourceId !== this._layer.id) {
            this.dispatchEvent(new CustomEvent('layer-reorder', {
                bubbles: true,
                detail: {
                    sourceId,
                    targetId: this._layer.id
                }
            }))
        }
    }

    /**
     * Escape HTML special characters
     * @param {string} str - Input string
     * @returns {string} Escaped string
     * @private
     */
    _escapeHtml(str) {
        const div = document.createElement('div')
        div.textContent = str
        return div.innerHTML
    }
}

customElements.define('layer-item', LayerItem)

export { LayerItem }

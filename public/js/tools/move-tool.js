/**
 * Move Tool
 * Handles moving layers and extracting selections
 *
 * @module tools/move-tool
 */

import { getSelectionBounds } from '../selection/clipboard-ops.js'

/**
 * Move tool for repositioning layers
 */
class MoveTool {
    /**
     * @param {object} options
     * @param {HTMLCanvasElement} options.overlay - Selection overlay canvas
     * @param {SelectionManager} options.selectionManager
     * @param {function} options.getActiveLayer - Returns current active layer
     * @param {function} options.getSelectedLayers - Returns selected layer IDs
     * @param {function} options.updateLayerPosition - Callback to update layer position
     * @param {function} options.extractSelection - Callback to extract selection to new layer
     * @param {function} options.showMultiLayerDialog - Show "not supported" dialog
     */
    constructor(options) {
        this._overlay = options.overlay
        this._selectionManager = options.selectionManager
        this._getActiveLayer = options.getActiveLayer
        this._getSelectedLayers = options.getSelectedLayers
        this._updateLayerPosition = options.updateLayerPosition
        this._extractSelection = options.extractSelection
        this._showMultiLayerDialog = options.showMultiLayerDialog

        this._active = false
        this._isDragging = false
        this._dragStart = null
        this._layerStartPos = null
        this._hasExtracted = false

        this._onMouseDown = this._onMouseDown.bind(this)
        this._onMouseMove = this._onMouseMove.bind(this)
        this._onMouseUp = this._onMouseUp.bind(this)
    }

    /**
     * Activate the move tool
     */
    activate() {
        if (this._active) return
        this._active = true

        this._overlay.addEventListener('mousedown', this._onMouseDown)
        this._overlay.addEventListener('mousemove', this._onMouseMove)
        this._overlay.addEventListener('mouseup', this._onMouseUp)
        this._overlay.addEventListener('mouseleave', this._onMouseUp)

        this._overlay.classList.add('move-tool')
    }

    /**
     * Deactivate the move tool
     */
    deactivate() {
        if (!this._active) return
        this._active = false

        this._overlay.removeEventListener('mousedown', this._onMouseDown)
        this._overlay.removeEventListener('mousemove', this._onMouseMove)
        this._overlay.removeEventListener('mouseup', this._onMouseUp)
        this._overlay.removeEventListener('mouseleave', this._onMouseUp)

        this._overlay.classList.remove('move-tool')
        this._isDragging = false
        this._hasExtracted = false
    }

    /**
     * Check if tool is active
     * @returns {boolean}
     */
    get isActive() {
        return this._active
    }

    /**
     * Get canvas coordinates from mouse event
     * @param {MouseEvent} e
     * @returns {{x: number, y: number}}
     * @private
     */
    _getCanvasCoords(e) {
        const rect = this._overlay.getBoundingClientRect()
        const scaleX = this._overlay.width / rect.width
        const scaleY = this._overlay.height / rect.height
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        }
    }

    /**
     * Handle mouse down
     * @param {MouseEvent} e
     * @private
     */
    _onMouseDown(e) {
        // Check for multiple layers selected
        const selectedLayers = this._getSelectedLayers()
        if (selectedLayers.length > 1) {
            this._showMultiLayerDialog()
            return
        }

        const layer = this._getActiveLayer()
        if (!layer) return

        this._isDragging = true
        this._dragStart = this._getCanvasCoords(e)
        this._layerStartPos = {
            x: layer.offsetX || 0,
            y: layer.offsetY || 0
        }
    }

    /**
     * Handle mouse move
     * @param {MouseEvent} e
     * @private
     */
    async _onMouseMove(e) {
        if (!this._isDragging) return

        const coords = this._getCanvasCoords(e)
        const dx = coords.x - this._dragStart.x
        const dy = coords.y - this._dragStart.y

        // If there's a selection and we haven't extracted yet, extract on first move
        if (this._selectionManager.hasSelection() && !this._hasExtracted) {
            try {
                await this._extractSelection()
                this._hasExtracted = true
                // Update layer start position for the new layer
                const layer = this._getActiveLayer()
                if (layer) {
                    this._layerStartPos = {
                        x: layer.offsetX || 0,
                        y: layer.offsetY || 0
                    }
                }
            } catch (err) {
                console.error('[MoveTool] Extraction error:', err)
            }
        }

        // Update layer position
        const newX = this._layerStartPos.x + dx
        const newY = this._layerStartPos.y + dy
        this._updateLayerPosition(newX, newY)
    }

    /**
     * Handle mouse up
     * @param {MouseEvent} e
     * @private
     */
    _onMouseUp(e) {
        this._isDragging = false
        this._dragStart = null
        this._layerStartPos = null
        // Don't reset _hasExtracted here - it resets when tool is deactivated
    }
}

export { MoveTool }

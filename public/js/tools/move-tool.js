/**
 * Move Tool
 * Handles moving layers and extracting selections
 *
 * FSM States:
 * - IDLE: Ready for interaction
 * - EXTRACTING: Async extraction in progress (no other actions allowed)
 * - DRAGGING: Actively dragging layer
 *
 * @module tools/move-tool
 */

const State = {
    IDLE: 'idle',
    EXTRACTING: 'extracting',
    DRAGGING: 'dragging'
}

/**
 * Move tool for repositioning layers
 */
class MoveTool {
    constructor(options) {
        this._overlay = options.overlay
        this._selectionManager = options.selectionManager
        this._getActiveLayer = options.getActiveLayer
        this._getSelectedLayers = options.getSelectedLayers
        this._updateLayerPosition = options.updateLayerPosition
        this._extractSelection = options.extractSelection
        this._showMultiLayerDialog = options.showMultiLayerDialog
        this._autoSelectLayer = options.autoSelectLayer

        this._active = false
        this._state = State.IDLE
        this._dragStart = null
        this._layerStartPos = null

        this._onMouseDown = this._onMouseDown.bind(this)
        this._onMouseMove = this._onMouseMove.bind(this)
        this._onMouseUp = this._onMouseUp.bind(this)
    }

    activate() {
        if (this._active) return
        this._active = true
        this._state = State.IDLE

        this._overlay.addEventListener('mousedown', this._onMouseDown)
        this._overlay.addEventListener('mousemove', this._onMouseMove)
        this._overlay.addEventListener('mouseup', this._onMouseUp)
        this._overlay.addEventListener('mouseleave', this._onMouseUp)

        this._overlay.classList.add('move-tool')
    }

    deactivate() {
        if (!this._active) return
        this._active = false

        this._overlay.removeEventListener('mousedown', this._onMouseDown)
        this._overlay.removeEventListener('mousemove', this._onMouseMove)
        this._overlay.removeEventListener('mouseup', this._onMouseUp)
        this._overlay.removeEventListener('mouseleave', this._onMouseUp)

        this._overlay.classList.remove('move-tool')
        this._reset()
    }

    get isActive() {
        return this._active
    }

    _reset() {
        this._state = State.IDLE
        this._dragStart = null
        this._layerStartPos = null
    }

    _getCanvasCoords(e) {
        const rect = this._overlay.getBoundingClientRect()
        const scaleX = this._overlay.width / rect.width
        const scaleY = this._overlay.height / rect.height
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        }
    }

    _onMouseDown(e) {
        // Only start from IDLE state
        if (this._state !== State.IDLE) return

        // Check for multiple layers selected
        const selectedLayers = this._getSelectedLayers()
        if (selectedLayers.length > 1) {
            this._showMultiLayerDialog()
            return
        }

        let layer = this._getActiveLayer()
        if (!layer && this._autoSelectLayer) {
            layer = this._autoSelectLayer()
        }
        if (!layer) return

        const coords = this._getCanvasCoords(e)

        // If there's a selection, extract it first
        if (this._selectionManager.hasSelection()) {
            this._state = State.EXTRACTING
            this._doExtraction(coords)
        } else {
            // No selection - just start dragging the layer
            this._state = State.DRAGGING
            this._dragStart = coords
            this._layerStartPos = {
                x: layer.offsetX || 0,
                y: layer.offsetY || 0
            }
        }
    }

    async _doExtraction(startCoords) {
        try {
            const success = await this._extractSelection()
            if (success) {
                // Now start dragging the newly created layer
                const layer = this._getActiveLayer()
                this._state = State.DRAGGING
                this._dragStart = startCoords
                this._layerStartPos = {
                    x: layer?.offsetX || 0,
                    y: layer?.offsetY || 0
                }
            } else {
                // Extraction failed, go back to idle
                this._reset()
            }
        } catch (err) {
            console.error('[MoveTool] Extraction error:', err)
            this._reset()
        }
    }

    _onMouseMove(e) {
        // Only move in DRAGGING state
        if (this._state !== State.DRAGGING) return
        if (!this._dragStart || !this._layerStartPos) return

        const coords = this._getCanvasCoords(e)
        const dx = coords.x - this._dragStart.x
        const dy = coords.y - this._dragStart.y

        const newX = this._layerStartPos.x + dx
        const newY = this._layerStartPos.y + dy
        this._updateLayerPosition(newX, newY)
    }

    _onMouseUp() {
        // Always reset to IDLE on mouse up (unless extracting)
        if (this._state === State.EXTRACTING) return
        this._reset()
    }
}

export { MoveTool }

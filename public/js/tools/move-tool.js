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
 * Can be destructive (punch holes) or non-destructive (clone only)
 */
class MoveTool {
    constructor(options) {
        this._overlay = options.overlay
        this._selectionManager = options.selectionManager
        this._getActiveLayer = options.getActiveLayer
        this._getSelectedLayers = options.getSelectedLayers
        this._updateLayerPosition = options.updateLayerPosition
        this._extractSelection = options.extractSelection
        this._showNoLayerDialog = options.showNoLayerDialog
        this._selectTopmostLayer = options.selectTopmostLayer
        this._destructive = options.destructive !== false // Default true for backwards compat
        this._toolClass = options.toolClass || 'move-tool'

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

        // Auto-select topmost layer if none selected
        if (!this._getActiveLayer() && this._selectTopmostLayer) {
            this._selectTopmostLayer()
        }

        this._overlay.addEventListener('mousedown', this._onMouseDown)
        this._overlay.addEventListener('mousemove', this._onMouseMove)
        this._overlay.addEventListener('mouseup', this._onMouseUp)
        this._overlay.addEventListener('mouseleave', this._onMouseUp)

        this._overlay.classList.add(this._toolClass)
    }

    deactivate() {
        if (!this._active) return
        this._active = false

        this._overlay.removeEventListener('mousedown', this._onMouseDown)
        this._overlay.removeEventListener('mousemove', this._onMouseMove)
        this._overlay.removeEventListener('mouseup', this._onMouseUp)
        this._overlay.removeEventListener('mouseleave', this._onMouseUp)

        this._overlay.classList.remove(this._toolClass)
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

        const selectedLayers = this._getSelectedLayers()
        const hasSelection = this._selectionManager.hasSelection()

        // If there's a selection, extraction handles single/multi layer cases
        if (hasSelection) {
            if (selectedLayers.length === 0) {
                if (this._showNoLayerDialog) {
                    this._showNoLayerDialog()
                }
                return
            }
            const coords = this._getCanvasCoords(e)
            this._state = State.EXTRACTING
            this._doExtraction(coords)
            return
        }

        // No selection - just drag (requires single layer)
        const layer = this._getActiveLayer()
        if (!layer) {
            if (this._showNoLayerDialog) {
                this._showNoLayerDialog()
            }
            return
        }

        const coords = this._getCanvasCoords(e)
        this._state = State.DRAGGING
        this._dragStart = coords
        this._layerStartPos = {
            x: layer.offsetX || 0,
            y: layer.offsetY || 0
        }
    }

    async _doExtraction(startCoords) {
        try {
            const success = await this._extractSelection(this._destructive)
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

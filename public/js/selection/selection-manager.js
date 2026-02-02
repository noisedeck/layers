/**
 * Selection Manager
 * Manages marquee selection state and rendering
 *
 * @module selection/selection-manager
 */

/**
 * @typedef {'rectangle' | 'oval' | 'lasso' | 'polygon' | 'wand'} SelectionTool
 */

/**
 * @typedef {Object} RectSelection
 * @property {'rect'} type
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {Object} OvalSelection
 * @property {'oval'} type
 * @property {number} cx - Center X
 * @property {number} cy - Center Y
 * @property {number} rx - Radius X
 * @property {number} ry - Radius Y
 */

/**
 * @typedef {Object} LassoSelection
 * @property {'lasso'} type
 * @property {Array<{x: number, y: number}>} points
 */

/**
 * @typedef {Object} PolygonSelection
 * @property {'polygon'} type
 * @property {Array<{x: number, y: number}>} points
 */

/**
 * @typedef {'replace' | 'add' | 'subtract'} SelectionMode
 */

/**
 * @typedef {RectSelection | OvalSelection | LassoSelection | PolygonSelection | null} SelectionPath
 */

class SelectionManager {
    constructor() {
        /** @type {SelectionTool} */
        this._currentTool = 'rectangle'

        /** @type {SelectionPath} */
        this._selectionPath = null

        /** @type {boolean} */
        this._isDrawing = false

        /** @type {{x: number, y: number} | null} */
        this._drawStart = null

        /** @type {HTMLCanvasElement | null} */
        this._overlay = null

        /** @type {CanvasRenderingContext2D | null} */
        this._ctx = null

        /** @type {number | null} */
        this._animationId = null

        /** @type {number} */
        this._dashOffset = 0

        /** @type {{x: number, y: number} | null} */
        this._copyOrigin = null

        /** @type {SelectionMode} */
        this._selectionMode = 'replace'

        /** @type {Array<{x: number, y: number}>} */
        this._lassoPoints = []

        /** @type {Array<{x: number, y: number}>} */
        this._polygonPoints = []

        /** @type {boolean} */
        this._isPolygonDrawing = false
    }

    /**
     * Initialize the selection manager
     * @param {HTMLCanvasElement} overlay - The overlay canvas element
     */
    init(overlay) {
        this._overlay = overlay
        this._ctx = overlay.getContext('2d')
        this._setupEventListeners()
    }

    /**
     * Get current selection tool
     * @returns {SelectionTool}
     */
    get currentTool() {
        return this._currentTool
    }

    /**
     * Set current selection tool
     * @param {SelectionTool} tool
     */
    set currentTool(tool) {
        this._currentTool = tool
    }

    /**
     * Get current selection path
     * @returns {SelectionPath}
     */
    get selectionPath() {
        return this._selectionPath
    }

    /**
     * Check if there's an active selection
     * @returns {boolean}
     */
    hasSelection() {
        return this._selectionPath !== null
    }

    /**
     * Clear the current selection
     */
    clearSelection() {
        this._selectionPath = null
        this._copyOrigin = null
        this._stopAnimation()
        this._clearOverlay()
    }

    /**
     * Set up mouse event listeners
     * @private
     */
    _setupEventListeners() {
        if (!this._overlay) return

        this._overlay.addEventListener('mousedown', (e) => this._handleMouseDown(e))
        this._overlay.addEventListener('mousemove', (e) => this._handleMouseMove(e))
        this._overlay.addEventListener('mouseup', (e) => this._handleMouseUp(e))
        this._overlay.addEventListener('mouseleave', (e) => this._handleMouseUp(e))
        this._overlay.addEventListener('dblclick', (e) => this._handleDoubleClick(e))
        document.addEventListener('keydown', (e) => this._handleKeyDown(e))
    }

    /**
     * Get selection mode from modifier keys
     * @param {MouseEvent|KeyboardEvent} e
     * @returns {SelectionMode}
     * @private
     */
    _getModeFromEvent(e) {
        if (e.shiftKey) return 'add'
        if (e.altKey) return 'subtract'
        return 'replace'
    }

    /**
     * Handle mouse down
     * @param {MouseEvent} e
     * @private
     */
    _handleMouseDown(e) {
        if (this._currentTool === 'polygon') {
            const coords = this._getCanvasCoords(e)
            this._selectionMode = this._getModeFromEvent(e)
            this._handlePolygonClick(coords, e)
            return
        }

        const coords = this._getCanvasCoords(e)
        this._selectionMode = this._getModeFromEvent(e)

        // If clicking outside existing selection, clear it
        if (this._selectionPath && !this._isPointInSelection(coords.x, coords.y)) {
            this.clearSelection()
        }

        // Start drawing new selection
        this._isDrawing = true
        this._drawStart = coords
        this._selectionPath = null
        this._stopAnimation()

        // Reset lasso points
        this._lassoPoints = []
        if (this._currentTool === 'lasso') {
            this._lassoPoints.push(coords)
        }
    }

    /**
     * Handle mouse move
     * @param {MouseEvent} e
     * @private
     */
    _handleMouseMove(e) {
        if (this._currentTool === 'polygon' && this._isPolygonDrawing) {
            const coords = this._getCanvasCoords(e)
            this._updatePolygonPreview(coords)
            return
        }

        if (!this._isDrawing || !this._drawStart) return

        const coords = this._getCanvasCoords(e)
        const constrain = e.shiftKey

        if (this._currentTool === 'lasso' && this._isDrawing) {
            this._lassoPoints.push(coords)
            this._selectionPath = {
                type: 'lasso',
                points: [...this._lassoPoints]
            }
            this._drawPreview()
            return
        }

        this._updateSelectionPath(this._drawStart, coords, constrain)
        this._drawPreview()
    }

    /**
     * Handle mouse up
     * @param {MouseEvent} e
     * @private
     */
    _handleMouseUp(e) {
        if (!this._isDrawing) return

        this._isDrawing = false

        // Only finalize if we have a valid selection
        if (this._selectionPath) {
            const path = this._selectionPath
            const hasSize = path.type === 'rect'
                ? (path.width > 2 && path.height > 2)
                : (path.rx > 1 && path.ry > 1)

            if (hasSize) {
                this._startAnimation()
            } else {
                this.clearSelection()
            }
        }

        this._drawStart = null
    }

    /**
     * Update selection path based on drag
     * @param {{x: number, y: number}} start
     * @param {{x: number, y: number}} end
     * @param {boolean} constrain - Constrain to square/circle
     * @private
     */
    _updateSelectionPath(start, end, constrain) {
        let width = end.x - start.x
        let height = end.y - start.y

        if (constrain) {
            const size = Math.max(Math.abs(width), Math.abs(height))
            width = Math.sign(width) * size || size
            height = Math.sign(height) * size || size
        }

        // Normalize to positive width/height
        const x = width < 0 ? start.x + width : start.x
        const y = height < 0 ? start.y + height : start.y
        const w = Math.abs(width)
        const h = Math.abs(height)

        if (this._currentTool === 'rectangle') {
            this._selectionPath = { type: 'rect', x, y, width: w, height: h }
        } else {
            this._selectionPath = {
                type: 'oval',
                cx: x + w / 2,
                cy: y + h / 2,
                rx: w / 2,
                ry: h / 2
            }
        }
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
     * Check if a point is inside the current selection
     * @param {number} x
     * @param {number} y
     * @returns {boolean}
     * @private
     */
    _isPointInSelection(x, y) {
        if (!this._selectionPath) return false

        const path = this._selectionPath
        if (path.type === 'rect') {
            return x >= path.x && x <= path.x + path.width &&
                   y >= path.y && y <= path.y + path.height
        } else if (path.type === 'oval') {
            // Ellipse equation: ((x-cx)/rx)^2 + ((y-cy)/ry)^2 <= 1
            const dx = (x - path.cx) / path.rx
            const dy = (y - path.cy) / path.ry
            return dx * dx + dy * dy <= 1
        } else if (path.type === 'lasso' || path.type === 'polygon') {
            // Use canvas isPointInPath
            if (!this._ctx || path.points.length < 3) return false
            this._ctx.beginPath()
            this._ctx.moveTo(path.points[0].x, path.points[0].y)
            for (let i = 1; i < path.points.length; i++) {
                this._ctx.lineTo(path.points[i].x, path.points[i].y)
            }
            this._ctx.closePath()
            return this._ctx.isPointInPath(x, y)
        }
        return false
    }

    /**
     * Handle polygon tool click
     * @param {{x: number, y: number}} coords
     * @param {MouseEvent} e
     * @private
     */
    _handlePolygonClick(coords, e) {
        const CLOSE_THRESHOLD = 10

        // Check if clicking near start point to close
        if (this._polygonPoints.length >= 3) {
            const start = this._polygonPoints[0]
            const dist = Math.hypot(coords.x - start.x, coords.y - start.y)
            if (dist < CLOSE_THRESHOLD) {
                this._finishPolygon()
                return
            }
        }

        // Add point
        this._polygonPoints.push(coords)
        this._isPolygonDrawing = true
        this._updatePolygonPreview(coords)
    }

    /**
     * Finish polygon selection
     * @private
     */
    _finishPolygon() {
        if (this._polygonPoints.length >= 3) {
            this._selectionPath = {
                type: 'polygon',
                points: [...this._polygonPoints]
            }
            this._startAnimation()
        }
        this._polygonPoints = []
        this._isPolygonDrawing = false
    }

    /**
     * Update polygon preview with cursor position
     * @param {{x: number, y: number}} cursor
     * @private
     */
    _updatePolygonPreview(cursor) {
        this._clearOverlay()
        if (!this._ctx || this._polygonPoints.length === 0) return

        this._ctx.setLineDash([5, 5])
        this._ctx.strokeStyle = '#000'
        this._ctx.lineWidth = 1

        // Draw placed points
        this._ctx.beginPath()
        this._ctx.moveTo(this._polygonPoints[0].x, this._polygonPoints[0].y)
        for (let i = 1; i < this._polygonPoints.length; i++) {
            this._ctx.lineTo(this._polygonPoints[i].x, this._polygonPoints[i].y)
        }
        // Line to cursor
        this._ctx.lineTo(cursor.x, cursor.y)
        this._ctx.stroke()

        // White offset stroke
        this._ctx.strokeStyle = '#fff'
        this._ctx.lineDashOffset = 5
        this._ctx.beginPath()
        this._ctx.moveTo(this._polygonPoints[0].x, this._polygonPoints[0].y)
        for (let i = 1; i < this._polygonPoints.length; i++) {
            this._ctx.lineTo(this._polygonPoints[i].x, this._polygonPoints[i].y)
        }
        this._ctx.lineTo(cursor.x, cursor.y)
        this._ctx.stroke()
        this._ctx.lineDashOffset = 0

        // Draw vertex dots
        this._ctx.fillStyle = '#fff'
        this._ctx.strokeStyle = '#000'
        this._ctx.setLineDash([])
        for (const pt of this._polygonPoints) {
            this._ctx.beginPath()
            this._ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2)
            this._ctx.fill()
            this._ctx.stroke()
        }
    }

    /**
     * Handle double click (finish polygon)
     * @param {MouseEvent} e
     * @private
     */
    _handleDoubleClick(e) {
        if (this._currentTool === 'polygon' && this._isPolygonDrawing) {
            this._finishPolygon()
        }
    }

    /**
     * Handle keydown (escape cancels polygon)
     * @param {KeyboardEvent} e
     * @private
     */
    _handleKeyDown(e) {
        if (e.key === 'Escape' && this._isPolygonDrawing) {
            this._polygonPoints = []
            this._isPolygonDrawing = false
            this._clearOverlay()
        }
    }

    /**
     * Clear the overlay canvas
     * @private
     */
    _clearOverlay() {
        if (!this._ctx || !this._overlay) return
        this._ctx.clearRect(0, 0, this._overlay.width, this._overlay.height)
    }

    /**
     * Draw preview while dragging (dashed line, not animated)
     * @private
     */
    _drawPreview() {
        this._clearOverlay()
        if (!this._selectionPath || !this._ctx) return

        this._ctx.setLineDash([5, 5])
        this._ctx.strokeStyle = '#000'
        this._ctx.lineWidth = 1

        this._strokePath()

        this._ctx.strokeStyle = '#fff'
        this._ctx.lineDashOffset = 5
        this._strokePath()

        this._ctx.lineDashOffset = 0
    }

    /**
     * Stroke the current selection path
     * @private
     */
    _strokePath() {
        if (!this._selectionPath || !this._ctx) return

        const path = this._selectionPath
        this._ctx.beginPath()

        if (path.type === 'rect') {
            this._ctx.rect(path.x, path.y, path.width, path.height)
        } else if (path.type === 'oval') {
            this._ctx.ellipse(path.cx, path.cy, path.rx, path.ry, 0, 0, Math.PI * 2)
        } else if (path.type === 'lasso' || path.type === 'polygon') {
            if (path.points.length > 0) {
                this._ctx.moveTo(path.points[0].x, path.points[0].y)
                for (let i = 1; i < path.points.length; i++) {
                    this._ctx.lineTo(path.points[i].x, path.points[i].y)
                }
                this._ctx.closePath()
            }
        }

        this._ctx.stroke()
    }

    /**
     * Start marching ants animation
     * @private
     */
    _startAnimation() {
        if (this._animationId) return

        const animate = () => {
            this._dashOffset = (this._dashOffset + 0.5) % 10
            this._drawMarchingAnts()
            this._animationId = requestAnimationFrame(animate)
        }

        this._animationId = requestAnimationFrame(animate)
    }

    /**
     * Stop marching ants animation
     * @private
     */
    _stopAnimation() {
        if (this._animationId) {
            cancelAnimationFrame(this._animationId)
            this._animationId = null
        }
    }

    /**
     * Draw marching ants (animated selection border)
     * @private
     */
    _drawMarchingAnts() {
        this._clearOverlay()
        if (!this._selectionPath || !this._ctx) return

        this._ctx.setLineDash([5, 5])
        this._ctx.lineWidth = 1

        // Black stroke
        this._ctx.strokeStyle = '#000'
        this._ctx.lineDashOffset = this._dashOffset
        this._strokePath()

        // White stroke offset
        this._ctx.strokeStyle = '#fff'
        this._ctx.lineDashOffset = this._dashOffset + 5
        this._strokePath()
    }

    /**
     * Resize overlay to match main canvas
     * @param {number} width
     * @param {number} height
     */
    resize(width, height) {
        if (!this._overlay) return
        this._overlay.width = width
        this._overlay.height = height

        // Redraw if we have a selection
        if (this._selectionPath) {
            this._drawMarchingAnts()
        }
    }

    /**
     * Destroy the selection manager
     */
    destroy() {
        this._stopAnimation()
        this._clearOverlay()
    }
}

export { SelectionManager }

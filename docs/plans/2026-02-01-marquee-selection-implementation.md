# Marquee Selection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add rectangle and oval marquee selection tools with marching ants, copy/paste, and multi-layer selection.

**Architecture:** SelectionManager owns selection state and canvas overlay. Vector paths stored for selections, rasterized on-demand for copy. LayerStack extended to support multi-select via Set.

**Tech Stack:** Vanilla JS (ES Modules), Canvas 2D API, Clipboard API, Web Components

---

## Task 1: Selection Overlay Canvas

Add a transparent canvas overlay that will capture mouse events and render marching ants.

**Files:**
- Modify: `public/index.html`
- Create: `public/css/selection.css`

**Step 1: Add overlay canvas to HTML**

In `public/index.html`, after the main canvas (line 120), add the selection overlay:

```html
<div class="canvas-container">
    <canvas id="canvas" width="1024" height="1024"></canvas>
    <canvas id="selectionOverlay" width="1024" height="1024"></canvas>
</div>
```

**Step 2: Create selection CSS**

Create `public/css/selection.css`:

```css
/* Selection overlay canvas */
#selectionOverlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: auto;
    cursor: crosshair;
}

/* When no selection tool is active, let events pass through */
#selectionOverlay.inactive {
    pointer-events: none;
    cursor: default;
}
```

**Step 3: Link CSS in HTML**

In `public/index.html`, add after line 26 (after loading.css):

```html
<link rel="stylesheet" href="css/selection.css">
```

**Step 4: Verify**

Open the app in browser. The overlay should be invisible but present. Check DevTools Elements panel for `#selectionOverlay`.

**Step 5: Commit**

```bash
git add public/index.html public/css/selection.css
git commit -m "feat: add selection overlay canvas"
```

---

## Task 2: SelectionManager Core Class

Create the core SelectionManager class with state management.

**Files:**
- Create: `public/js/selection/selection-manager.js`

**Step 1: Create SelectionManager**

Create `public/js/selection/selection-manager.js`:

```javascript
/**
 * Selection Manager
 * Manages marquee selection state and rendering
 *
 * @module selection/selection-manager
 */

/**
 * @typedef {'rectangle' | 'oval'} SelectionTool
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
 * @typedef {RectSelection | OvalSelection | null} SelectionPath
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
    }

    /**
     * Handle mouse down
     * @param {MouseEvent} e
     * @private
     */
    _handleMouseDown(e) {
        const coords = this._getCanvasCoords(e)

        // If clicking outside existing selection, clear it
        if (this._selectionPath && !this._isPointInSelection(coords.x, coords.y)) {
            this.clearSelection()
        }

        // Start drawing new selection
        this._isDrawing = true
        this._drawStart = coords
        this._selectionPath = null
        this._stopAnimation()
    }

    /**
     * Handle mouse move
     * @param {MouseEvent} e
     * @private
     */
    _handleMouseMove(e) {
        if (!this._isDrawing || !this._drawStart) return

        const coords = this._getCanvasCoords(e)
        const constrain = e.shiftKey

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
        } else {
            // Ellipse equation: ((x-cx)/rx)^2 + ((y-cy)/ry)^2 <= 1
            const dx = (x - path.cx) / path.rx
            const dy = (y - path.cy) / path.ry
            return dx * dx + dy * dy <= 1
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
        } else {
            this._ctx.ellipse(path.cx, path.cy, path.rx, path.ry, 0, 0, Math.PI * 2)
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
```

**Step 2: Verify syntax**

```bash
node --check public/js/selection/selection-manager.js
```

Expected: No output (valid syntax)

**Step 3: Commit**

```bash
git add public/js/selection/selection-manager.js
git commit -m "feat: add SelectionManager core class"
```

---

## Task 3: Integrate SelectionManager with App

Wire up SelectionManager to the main app.

**Files:**
- Modify: `public/js/app.js`

**Step 1: Import SelectionManager**

In `public/js/app.js`, add import after line 21:

```javascript
import { SelectionManager } from './selection/selection-manager.js'
```

**Step 2: Add SelectionManager instance**

In `LayersApp` constructor (around line 35), add:

```javascript
this._selectionManager = null
```

**Step 3: Initialize SelectionManager in init()**

In `init()` method, after getting canvas element (around line 83), add:

```javascript
// Get selection overlay
this._selectionOverlay = document.getElementById('selectionOverlay')

// Initialize selection manager
this._selectionManager = new SelectionManager()
if (this._selectionOverlay) {
    this._selectionManager.init(this._selectionOverlay)
}
```

**Step 4: Update _resizeCanvas to resize overlay**

In `_resizeCanvas()` method (around line 483), after `this._renderer.resize(width, height)`, add:

```javascript
// Update selection overlay size
if (this._selectionOverlay) {
    this._selectionOverlay.width = width
    this._selectionOverlay.height = height
}
if (this._selectionManager) {
    this._selectionManager.resize(width, height)
}
```

**Step 5: Verify**

Open app in browser. Mouse over canvas should show crosshair cursor. Drag to draw rectangle selection. Release to see marching ants. Click outside to clear.

**Step 6: Commit**

```bash
git add public/js/app.js
git commit -m "feat: integrate SelectionManager with app"
```

---

## Task 4: Selection Tool Menu Dropdown

Add selection tool dropdown to menu bar.

**Files:**
- Modify: `public/index.html`
- Modify: `public/css/menu.css`
- Modify: `public/js/app.js`

**Step 1: Add selection menu to HTML**

In `public/index.html`, in `#menuRight` (around line 112), add before the play/pause button:

```html
<div class="menu" id="selectionMenu">
    <div class="menu-title">
        <span class="icon-material" id="selectionToolIcon">crop_square</span>
    </div>
    <div class="menu-items hide">
        <div id="selectRectMenuItem" class="checked">
            <span class="icon-material">crop_square</span>
            Rectangle Select
        </div>
        <div id="selectOvalMenuItem">
            <span class="icon-material">circle</span>
            Oval Select
        </div>
    </div>
</div>
```

**Step 2: Add menu styles**

In `public/css/menu.css`, add at end:

```css
/* Selection tool menu */
#selectionMenu .menu-title {
    padding: 0 0.25em;
}

#selectionMenu .menu-items div {
    display: flex;
    align-items: center;
    gap: 0.5em;
}

#selectionMenu .menu-items div .icon-material {
    font-size: 1.25em;
}

#selectionMenu .menu-items div.checked .icon-material:first-child::before {
    content: '';
}
```

**Step 3: Add menu handlers in app.js**

In `_setupMenuHandlers()` (around line 743), add before play/pause button handler:

```javascript
// Selection tool menu
document.getElementById('selectRectMenuItem')?.addEventListener('click', () => {
    this._setSelectionTool('rectangle')
})

document.getElementById('selectOvalMenuItem')?.addEventListener('click', () => {
    this._setSelectionTool('oval')
})
```

**Step 4: Add _setSelectionTool method**

Add new method after `_togglePlayPause()` (around line 840):

```javascript
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
```

**Step 5: Add M key shortcut**

In `_setupKeyboardShortcuts()`, add after the V key handler (around line 807):

```javascript
// M - cycle selection tools
if (e.key === 'm' || e.key === 'M') {
    const current = this._selectionManager?.currentTool
    this._setSelectionTool(current === 'rectangle' ? 'oval' : 'rectangle')
}
```

**Step 6: Verify**

Open app. Selection menu should appear in menu bar. Click to switch between Rectangle and Oval. Press M to cycle. Draw both selection types.

**Step 7: Commit**

```bash
git add public/index.html public/css/menu.css public/js/app.js
git commit -m "feat: add selection tool dropdown menu"
```

---

## Task 5: Keyboard Shortcuts for Deselect

Add Escape and Cmd+D to clear selection.

**Files:**
- Modify: `public/js/app.js`

**Step 1: Add Escape handler**

In `_setupKeyboardShortcuts()`, add after the M key handler:

```javascript
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
```

**Step 2: Verify**

Draw a selection. Press Escape - selection clears. Draw another. Press Cmd+D - selection clears.

**Step 3: Commit**

```bash
git add public/js/app.js
git commit -m "feat: add Escape and Cmd+D to clear selection"
```

---

## Task 6: Multi-Layer Selection in LayerStack

Change layer selection from single to multi-select.

**Files:**
- Modify: `public/js/layers/layer-stack.js`

**Step 1: Change _selectedLayerId to Set**

In `LayerStack` constructor, replace `this._selectedLayerId = null` with:

```javascript
this._selectedLayerIds = new Set()
this._lastClickedLayerId = null  // For shift-click range
```

**Step 2: Update selectedLayerId getter/setter for backward compat**

Replace the `selectedLayerId` getter and setter with:

```javascript
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
```

**Step 3: Update _render to check Set**

In `_render()`, replace the selection check (around line 91):

```javascript
if (this._selectedLayerIds.has(layer.id)) {
    item.selected = true
}
```

**Step 4: Update _updateSelection**

Replace `_updateSelection()` method:

```javascript
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
```

**Step 5: Update layer-select event handler**

Replace the layer-select listener in `_setupEventListeners()`:

```javascript
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
```

**Step 6: Update getSelectedLayer**

Replace `getSelectedLayer()`:

```javascript
/**
 * Get the selected layer (primary/first if multiple)
 * @returns {object|null} Selected layer or null
 */
getSelectedLayer() {
    if (this._selectedLayerIds.size === 0) return null
    const id = [...this._selectedLayerIds][0]
    return this._layers.find(l => l.id === id) || null
}
```

**Step 7: Update addLayer to select new layer**

In `addLayer()`, replace the selection line:

```javascript
this._selectedLayerIds.clear()
this._selectedLayerIds.add(layer.id)
this._lastClickedLayerId = layer.id
```

**Step 8: Update removeLayer selection logic**

In `removeLayer()`, replace the selection logic:

```javascript
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
```

**Step 9: Commit**

```bash
git add public/js/layers/layer-stack.js
git commit -m "feat: add multi-layer selection to LayerStack"
```

---

## Task 7: Pass Modifier Keys from LayerItem

Update LayerItem to pass modifier key state in select event.

**Files:**
- Modify: `public/js/layers/layer-item.js`

**Step 1: Update _emitSelect to include modifiers**

Replace `_emitSelect()` method:

```javascript
/**
 * Emit select event
 * @param {MouseEvent} [e] - Original mouse event for modifier keys
 * @private
 */
_emitSelect(e) {
    this.dispatchEvent(new CustomEvent('layer-select', {
        bubbles: true,
        detail: {
            layerId: this._layer.id,
            ctrlKey: e?.ctrlKey || false,
            metaKey: e?.metaKey || false,
            shiftKey: e?.shiftKey || false
        }
    }))
}
```

**Step 2: Pass event to _emitSelect**

In `_setupEventListeners()`, update the click handler that calls `_emitSelect()` (around line 208):

```javascript
// Select layer on click (anywhere else except controls and params)
if (!e.target.closest('.layer-controls') && !e.target.closest('effect-params')) {
    this._emitSelect(e)
}
```

**Step 3: Verify**

Open app with layers. Cmd+click to toggle multiple layers. Shift+click to select range. Multiple layers should show selected styling.

**Step 4: Commit**

```bash
git add public/js/layers/layer-item.js
git commit -m "feat: pass modifier keys in layer select event"
```

---

## Task 8: Clipboard Operations Module

Create clipboard operations for copy/paste.

**Files:**
- Create: `public/js/selection/clipboard-ops.js`

**Step 1: Create clipboard-ops.js**

Create `public/js/selection/clipboard-ops.js`:

```javascript
/**
 * Clipboard Operations
 * Handles copy/paste with selections
 *
 * @module selection/clipboard-ops
 */

/**
 * Copy selected region from layers to clipboard
 * @param {object} options
 * @param {object} selectionPath - Selection path (rect or oval)
 * @param {object[]} layers - Array of layer objects (visible, selected)
 * @param {HTMLCanvasElement} sourceCanvas - Main render canvas
 * @returns {Promise<{x: number, y: number} | null>} Copy origin for paste-in-place, or null if failed
 */
async function copySelection({ selectionPath, layers, sourceCanvas }) {
    if (!selectionPath || layers.length === 0) return null

    // Get bounds
    const bounds = getSelectionBounds(selectionPath)
    if (bounds.width <= 0 || bounds.height <= 0) return null

    // Create offscreen canvas for the copied region
    const offscreen = new OffscreenCanvas(bounds.width, bounds.height)
    const ctx = offscreen.getContext('2d')

    // Draw from source canvas (already composited)
    ctx.drawImage(
        sourceCanvas,
        bounds.x, bounds.y, bounds.width, bounds.height,
        0, 0, bounds.width, bounds.height
    )

    // Apply selection mask for non-rectangular selections
    if (selectionPath.type === 'oval') {
        applyOvalMask(ctx, selectionPath, bounds)
    }

    // Convert to blob and write to clipboard
    try {
        const blob = await offscreen.convertToBlob({ type: 'image/png' })
        await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob })
        ])

        return { x: bounds.x, y: bounds.y }
    } catch (err) {
        console.error('[Clipboard] Failed to copy:', err)
        return null
    }
}

/**
 * Paste from clipboard
 * @returns {Promise<{blob: Blob, origin: {x: number, y: number} | null} | null>}
 */
async function pasteFromClipboard() {
    try {
        const items = await navigator.clipboard.read()

        for (const item of items) {
            if (item.types.includes('image/png')) {
                const blob = await item.getType('image/png')
                return { blob, origin: null }
            }
            if (item.types.includes('image/jpeg')) {
                const blob = await item.getType('image/jpeg')
                return { blob, origin: null }
            }
        }

        return null
    } catch (err) {
        console.error('[Clipboard] Failed to paste:', err)
        return null
    }
}

/**
 * Get bounding box of selection
 * @param {object} selectionPath
 * @returns {{x: number, y: number, width: number, height: number}}
 */
function getSelectionBounds(selectionPath) {
    if (selectionPath.type === 'rect') {
        return {
            x: Math.round(selectionPath.x),
            y: Math.round(selectionPath.y),
            width: Math.round(selectionPath.width),
            height: Math.round(selectionPath.height)
        }
    } else {
        // Oval bounding box
        return {
            x: Math.round(selectionPath.cx - selectionPath.rx),
            y: Math.round(selectionPath.cy - selectionPath.ry),
            width: Math.round(selectionPath.rx * 2),
            height: Math.round(selectionPath.ry * 2)
        }
    }
}

/**
 * Apply oval mask to canvas context
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} selectionPath
 * @param {{x: number, y: number, width: number, height: number}} bounds
 */
function applyOvalMask(ctx, selectionPath, bounds) {
    // Use destination-in composite to mask
    ctx.globalCompositeOperation = 'destination-in'
    ctx.beginPath()
    ctx.ellipse(
        selectionPath.cx - bounds.x,
        selectionPath.cy - bounds.y,
        selectionPath.rx,
        selectionPath.ry,
        0, 0, Math.PI * 2
    )
    ctx.fill()
    ctx.globalCompositeOperation = 'source-over'
}

export { copySelection, pasteFromClipboard, getSelectionBounds }
```

**Step 2: Verify syntax**

```bash
node --check public/js/selection/clipboard-ops.js
```

**Step 3: Commit**

```bash
git add public/js/selection/clipboard-ops.js
git commit -m "feat: add clipboard operations module"
```

---

## Task 9: Wire Up Copy/Paste in App

Connect clipboard operations to keyboard shortcuts.

**Files:**
- Modify: `public/js/app.js`

**Step 1: Import clipboard ops**

Add import after SelectionManager import:

```javascript
import { copySelection, pasteFromClipboard } from './selection/clipboard-ops.js'
```

**Step 2: Add copy origin tracking**

In `LayersApp` constructor, add:

```javascript
this._copyOrigin = null
```

**Step 3: Add Cmd+C handler**

In `_setupKeyboardShortcuts()`, add after Cmd+S handler (before the input check):

```javascript
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
```

**Step 4: Add _handleCopy method**

Add after `_setSelectionTool()`:

```javascript
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
```

**Step 5: Add _handlePaste method**

Add after `_handleCopy()`:

```javascript
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
```

**Step 6: Verify**

1. Open app with base layer
2. Draw a selection
3. Press Cmd+C - should see "Copied to clipboard"
4. Press Cmd+V - should see "Pasted as new layer" and new layer appears

**Step 7: Commit**

```bash
git add public/js/app.js
git commit -m "feat: wire up copy/paste keyboard shortcuts"
```

---

## Task 10: Final Polish and Testing

Verify all features work together.

**Files:**
- None (testing only)

**Step 1: Test selection tools**

1. Open app, create solid base layer
2. Draw rectangle selection - marching ants appear
3. Press M to switch to oval
4. Draw oval selection - marching ants appear
5. Click outside - selection clears
6. Draw selection, press Escape - clears
7. Draw selection, press Cmd+D - clears

**Step 2: Test multi-layer selection**

1. Add multiple layers
2. Click layer - single select
3. Cmd+click another - both selected
4. Shift+click range - all in range selected

**Step 3: Test copy/paste**

1. Select multiple layers
2. Draw rectangle selection
3. Cmd+C - "Copied to clipboard"
4. Cmd+V - new layer appears at same position
5. Copy from external app, paste - centers in canvas

**Step 4: Test keyboard shortcuts**

- M: cycles selection tools
- Escape: clears selection
- Cmd+D: clears selection
- Cmd+C: copies selection
- Cmd+V: pastes

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete marquee selection v1

- Rectangle and oval selection tools
- Marching ants animation
- Multi-layer selection (Cmd+click, Shift+click)
- Copy/paste with clipboard API
- Keyboard shortcuts (M, Escape, Cmd+D, Cmd+C, Cmd+V)"
```

---

## Summary

This plan implements marquee selection in 10 tasks:

1. **Selection overlay canvas** - HTML/CSS setup
2. **SelectionManager core** - State and drawing logic
3. **App integration** - Wire up manager
4. **Menu dropdown** - Tool selection UI
5. **Deselect shortcuts** - Escape and Cmd+D
6. **Multi-layer selection** - LayerStack changes
7. **Modifier keys** - LayerItem event updates
8. **Clipboard module** - Copy/paste logic
9. **Copy/paste shortcuts** - Cmd+C and Cmd+V
10. **Testing** - Verify everything works

Each task has clear file changes, code snippets, and verification steps.

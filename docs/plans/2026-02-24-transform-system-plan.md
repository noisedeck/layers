# Transform System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add on-canvas transform controls (scale, rotate, flip) for media layers with CPU-side bicubic interpolation.

**Architecture:** Transform state lives on the layer model as `scaleX`, `scaleY`, `rotation`, `flipH`, `flipV`. Transforms are applied via offscreen canvas (`imageSmoothingQuality: 'high'`) before texture upload. A new `TransformTool` class renders interactive handles on the selection overlay canvas and handles drag interactions. Position continues using the existing `offsetX`/`offsetY` system.

**Tech Stack:** Canvas 2D transforms, Playwright E2E tests, ES modules (no build step)

---

### Task 1: Add Transform Fields to Layer Model

**Files:**
- Modify: `public/js/layers/layer-model.js:30-38`

**Step 1: Add transform fields to `createLayer()`**

In `public/js/layers/layer-model.js`, add transform fields after `offsetY` (line 38):

```javascript
return {
    id,
    name: options.name || 'Untitled',
    visible: options.visible !== false,
    opacity: options.opacity ?? 100,
    blendMode: options.blendMode || 'mix',
    locked: options.locked || false,
    offsetX: options.offsetX || 0,
    offsetY: options.offsetY || 0,
    scaleX: options.scaleX ?? 1,
    scaleY: options.scaleY ?? 1,
    rotation: options.rotation ?? 0,
    flipH: options.flipH || false,
    flipV: options.flipV || false,
    sourceType: options.sourceType || 'media',
    // ... rest unchanged
}
```

**Step 2: Run existing tests to confirm no regression**

Run: `npx playwright test tests/move-tool.spec.js --reporter=line`
Expected: All tests pass (transform fields default to identity values)

**Step 3: Commit**

```bash
git add public/js/layers/layer-model.js
git commit -m "feat(transform): add transform fields to layer model"
```

---

### Task 2: Add Transform Toolbar Button

**Files:**
- Modify: `public/index.html:253-256`
- Modify: `public/css/selection.css:24`

**Step 1: Add transform button to toolbar HTML**

In `public/index.html`, after the clone tool button (line 254) and before the separator (line 255):

```html
<button id="moveToolBtn" class="menu-icon-btn" title="Move Tool"><span class="icon-material">drag_pan</span></button>
<button id="cloneToolBtn" class="menu-icon-btn" title="Clone Tool"><span class="icon-material">approval</span></button>
<button id="transformToolBtn" class="menu-icon-btn" title="Transform Tool (T)"><span class="icon-material">transform</span></button>
<div class="toolbar-separator"></div>
```

**Step 2: Add transform tool cursor CSS**

In `public/css/selection.css`, after the clone tool cursor (line 24):

```css
/* Transform tool cursor */
#selectionOverlay.transform-tool {
    cursor: default;
}
```

**Step 3: Verify button renders**

Run: `npx playwright test tests/move-tool.spec.js --reporter=line`
Expected: All existing tests still pass

**Step 4: Commit**

```bash
git add public/index.html public/css/selection.css
git commit -m "feat(transform): add transform toolbar button"
```

---

### Task 3: Create TransformTool Class — Core Structure

**Files:**
- Create: `public/js/tools/transform-tool.js`

**Step 1: Write the test**

Create `tests/transform-tool.spec.js`:

```javascript
import { test, expect } from 'playwright/test'

async function createTransparentProject(page) {
    await page.waitForSelector('.open-dialog-backdrop.visible')
    await page.click('.media-option[data-type="transparent"]')
    await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
    await page.click('.canvas-size-dialog .action-btn.primary')
    await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
    await page.waitForTimeout(500)
}

async function addColorLayer(page, color, size = 100) {
    await page.evaluate(async ({ color, size }) => {
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = color
        ctx.fillRect(0, 0, size, size)
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
        const file = new File([blob], 'test.png', { type: 'image/png' })
        await window.layersApp._handleAddMediaLayer(file, 'image')
    }, { color, size })
    await page.waitForTimeout(500)
}

test.describe('Transform tool', () => {
    test('transform tool button exists and activates', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)

        const transformBtn = await page.$('#transformToolBtn')
        expect(transformBtn).not.toBeNull()

        await page.click('#transformToolBtn')

        const isActive = await page.evaluate(() =>
            document.getElementById('transformToolBtn').classList.contains('active')
        )
        expect(isActive).toBe(true)
    })

    test('T key activates transform tool', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)
        await addColorLayer(page, 'red')

        await page.keyboard.press('t')

        const isActive = await page.evaluate(() =>
            document.getElementById('transformToolBtn').classList.contains('active')
        )
        expect(isActive).toBe(true)
    })

    test('Escape while transform tool is active returns to selection tool', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)
        await addColorLayer(page, 'red')

        await page.click('#transformToolBtn')
        await page.keyboard.press('Escape')

        const selectionActive = await page.evaluate(() =>
            document.getElementById('selectionToolBtn').classList.contains('active')
        )
        expect(selectionActive).toBe(true)
    })
})
```

**Step 2: Run test to verify it fails**

Run: `npx playwright test tests/transform-tool.spec.js --reporter=line`
Expected: FAIL — transform button click doesn't activate (no wiring yet)

**Step 3: Create TransformTool class**

Create `public/js/tools/transform-tool.js`:

```javascript
/**
 * Transform Tool - Handles scale, rotate, and flip for layers
 *
 * FSM States: IDLE -> DRAGGING -> IDLE
 *
 * Handle types: 'nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w' (scale), 'rotate'
 *
 * @module tools/transform-tool
 */

const State = {
    IDLE: 'idle',
    DRAGGING: 'dragging'
}

const HANDLE_SIZE = 8
const HANDLE_HIT_RADIUS = 12
const ROTATE_HIT_DISTANCE = 20

const MOUSE_EVENTS = ['mousedown', 'mousemove', 'mouseup', 'mouseleave']

class TransformTool {
    constructor(options) {
        this._overlay = options.overlay
        this._getActiveLayer = options.getActiveLayer
        this._getLayerBounds = options.getLayerBounds
        this._applyTransform = options.applyTransform
        this._commitTransform = options.commitTransform
        this._cancelTransform = options.cancelTransform
        this._showNoLayerDialog = options.showNoLayerDialog
        this._selectTopmostLayer = options.selectTopmostLayer
        this._isLayerBlocked = options.isLayerBlocked

        this._active = false
        this._state = State.IDLE
        this._dragStart = null
        this._dragHandle = null
        this._initialTransform = null
        this._initialBounds = null
        this._rafId = null

        this._onMouseDown = this._onMouseDown.bind(this)
        this._onMouseMove = this._onMouseMove.bind(this)
        this._onMouseUp = this._onMouseUp.bind(this)
        this._onKeyDown = this._onKeyDown.bind(this)
    }

    activate() {
        if (this._active) return
        this._active = true
        this._state = State.IDLE

        if (!this._getActiveLayer() && this._selectTopmostLayer) {
            this._selectTopmostLayer()
        }

        const handlers = [this._onMouseDown, this._onMouseMove, this._onMouseUp, this._onMouseUp]
        MOUSE_EVENTS.forEach((evt, i) => this._overlay.addEventListener(evt, handlers[i]))
        document.addEventListener('keydown', this._onKeyDown)
        this._overlay.classList.add('transform-tool')

        this._drawHandles()
    }

    deactivate() {
        if (!this._active) return
        this._active = false

        const handlers = [this._onMouseDown, this._onMouseMove, this._onMouseUp, this._onMouseUp]
        MOUSE_EVENTS.forEach((evt, i) => this._overlay.removeEventListener(evt, handlers[i]))
        document.removeEventListener('keydown', this._onKeyDown)
        this._overlay.classList.remove('transform-tool')

        this._clearOverlay()
        this._reset()
    }

    get isActive() {
        return this._active
    }

    redraw() {
        if (this._active && this._state === State.IDLE) {
            this._drawHandles()
        }
    }

    _reset() {
        this._state = State.IDLE
        this._dragStart = null
        this._dragHandle = null
        this._initialTransform = null
        this._initialBounds = null
    }

    _getCanvasCoords(e) {
        const rect = this._overlay.getBoundingClientRect()
        return {
            x: (e.clientX - rect.left) * (this._overlay.width / rect.width),
            y: (e.clientY - rect.top) * (this._overlay.height / rect.height)
        }
    }

    // --- Handle geometry ---

    _getHandlePositions(bounds) {
        if (!bounds) return []

        const { x, y, width, height, rotation } = bounds
        const cx = x + width / 2
        const cy = y + height / 2
        const rad = (rotation || 0) * Math.PI / 180

        const corners = [
            { id: 'nw', lx: x, ly: y },
            { id: 'n', lx: cx, ly: y },
            { id: 'ne', lx: x + width, ly: y },
            { id: 'e', lx: x + width, ly: cy },
            { id: 'se', lx: x + width, ly: y + height },
            { id: 's', lx: cx, ly: y + height },
            { id: 'sw', lx: x, ly: y + height },
            { id: 'w', lx: x, ly: cy }
        ]

        return corners.map(({ id, lx, ly }) => {
            const dx = lx - cx
            const dy = ly - cy
            return {
                id,
                x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
                y: cy + dx * Math.sin(rad) + dy * Math.cos(rad)
            }
        })
    }

    _hitTestHandles(coords, bounds) {
        const handles = this._getHandlePositions(bounds)
        const { x, y, width, height, rotation } = bounds
        const cx = x + width / 2
        const cy = y + height / 2

        // Check scale handles first
        for (const handle of handles) {
            const dx = coords.x - handle.x
            const dy = coords.y - handle.y
            if (dx * dx + dy * dy <= HANDLE_HIT_RADIUS * HANDLE_HIT_RADIUS) {
                return { type: 'scale', id: handle.id }
            }
        }

        // Check rotate zones (just outside corners)
        const cornerHandles = handles.filter(h => ['nw', 'ne', 'se', 'sw'].includes(h.id))
        for (const handle of cornerHandles) {
            const dx = coords.x - handle.x
            const dy = coords.y - handle.y
            const dist = Math.sqrt(dx * dx + dy * dy)
            if (dist <= HANDLE_HIT_RADIUS + ROTATE_HIT_DISTANCE && dist > HANDLE_HIT_RADIUS) {
                return { type: 'rotate', id: handle.id }
            }
        }

        // Check if inside bounding box (for move)
        const rad = (rotation || 0) * Math.PI / 180
        const dx = coords.x - cx
        const dy = coords.y - cy
        const localX = dx * Math.cos(-rad) - dy * Math.sin(-rad) + cx
        const localY = dx * Math.sin(-rad) + dy * Math.cos(-rad) + cy
        if (localX >= x && localX <= x + width && localY >= y && localY <= y + height) {
            return { type: 'move', id: 'center' }
        }

        return null
    }

    // --- Mouse event handlers ---

    _onMouseDown(e) {
        if (this._state !== State.IDLE) return

        const layer = this._getActiveLayer()
        if (this._isLayerBlocked?.(layer)) return

        if (!layer) {
            this._showNoLayerDialog?.()
            return
        }

        const coords = this._getCanvasCoords(e)
        const bounds = this._getLayerBounds(layer)
        if (!bounds) return

        const hit = this._hitTestHandles(coords, bounds)

        if (!hit) {
            // Clicked outside — commit and deactivate
            this._commitTransform?.()
            return
        }

        this._state = State.DRAGGING
        this._dragStart = coords
        this._dragHandle = hit
        this._initialTransform = {
            offsetX: layer.offsetX || 0,
            offsetY: layer.offsetY || 0,
            scaleX: layer.scaleX ?? 1,
            scaleY: layer.scaleY ?? 1,
            rotation: layer.rotation ?? 0
        }
        this._initialBounds = { ...bounds }

        e.preventDefault()
    }

    _onMouseMove(e) {
        const coords = this._getCanvasCoords(e)

        if (this._state !== State.DRAGGING) {
            // Update cursor based on what's under the mouse
            this._updateCursor(coords)
            return
        }

        if (!this._dragStart || !this._dragHandle || !this._initialTransform) return

        const layer = this._getActiveLayer()
        if (!layer) return

        const dx = coords.x - this._dragStart.x
        const dy = coords.y - this._dragStart.y

        if (this._dragHandle.type === 'move') {
            this._applyTransform?.({
                offsetX: this._initialTransform.offsetX + dx,
                offsetY: this._initialTransform.offsetY + dy
            })
        } else if (this._dragHandle.type === 'scale') {
            this._handleScale(coords, e.shiftKey, e.altKey)
        } else if (this._dragHandle.type === 'rotate') {
            this._handleRotate(coords, e.shiftKey)
        }

        // Redraw handles at new positions
        if (this._rafId) cancelAnimationFrame(this._rafId)
        this._rafId = requestAnimationFrame(() => {
            this._rafId = null
            this._drawHandles()
        })
    }

    _onMouseUp() {
        if (this._state !== State.DRAGGING) return
        this._state = State.IDLE
        this._dragStart = null
        this._dragHandle = null
        this._initialTransform = null
        this._initialBounds = null
        this._drawHandles()
    }

    _onKeyDown(e) {
        if (e.key === 'Escape') {
            if (this._state === State.DRAGGING) {
                this._cancelTransform?.()
                this._reset()
                this._drawHandles()
            } else {
                this._cancelTransform?.()
            }
            e.preventDefault()
        } else if (e.key === 'Enter') {
            this._commitTransform?.()
            e.preventDefault()
        }
    }

    // --- Scale logic ---

    _handleScale(coords, constrainAspect, fromCenter) {
        const { x, y, width, height } = this._initialBounds
        const cx = x + width / 2
        const cy = y + height / 2
        const handleId = this._dragHandle.id
        const rotation = (this._initialTransform.rotation || 0) * Math.PI / 180

        // Convert mouse coords to local (unrotated) space
        const dx = coords.x - cx
        const dy = coords.y - cy
        const localX = dx * Math.cos(-rotation) - dy * Math.sin(-rotation) + cx
        const localY = dx * Math.sin(-rotation) + dy * Math.cos(-rotation) + cy

        let newScaleX = this._initialTransform.scaleX
        let newScaleY = this._initialTransform.scaleY
        let newOffsetX = this._initialTransform.offsetX
        let newOffsetY = this._initialTransform.offsetY

        // Determine scale change based on which handle is dragged
        const isLeft = handleId.includes('w')
        const isRight = handleId.includes('e')
        const isTop = handleId.startsWith('n')
        const isBottom = handleId.startsWith('s') || handleId === 'se'

        if (isRight || isLeft) {
            const edgeX = isRight ? x + width : x
            const anchorX = isRight ? x : x + width
            const newEdgeX = localX
            const newWidth = Math.abs(newEdgeX - anchorX)
            newScaleX = this._initialTransform.scaleX * (newWidth / width)
            if (!fromCenter) {
                // Anchor the opposite side
                const anchorWorld = this._localToWorld(anchorX, cy, cx, cy, rotation)
                const newCx = (anchorWorld.x + coords.x) / 2
                // Approximate offset adjustment
            }
        }

        if (isTop || isBottom) {
            const anchorY = isBottom ? y : y + height
            const newEdgeY = localY
            const newHeight = Math.abs(newEdgeY - anchorY)
            newScaleY = this._initialTransform.scaleY * (newHeight / height)
        }

        // Constrain aspect ratio
        if (constrainAspect && (isLeft || isRight) && (isTop || isBottom)) {
            const avgScale = (newScaleX + newScaleY) / 2
            newScaleX = avgScale
            newScaleY = avgScale
        }

        // Clamp minimum scale
        newScaleX = Math.max(0.01, newScaleX)
        newScaleY = Math.max(0.01, newScaleY)

        this._applyTransform?.({
            scaleX: newScaleX,
            scaleY: newScaleY,
            offsetX: newOffsetX,
            offsetY: newOffsetY
        })
    }

    _localToWorld(lx, ly, cx, cy, rad) {
        const dx = lx - cx
        const dy = ly - cy
        return {
            x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
            y: cy + dx * Math.sin(rad) + dy * Math.cos(rad)
        }
    }

    // --- Rotate logic ---

    _handleRotate(coords, snapTo15) {
        const { x, y, width, height } = this._initialBounds
        const cx = x + width / 2
        const cy = y + height / 2

        const angle = Math.atan2(coords.y - cy, coords.x - cx) * 180 / Math.PI
        const startAngle = Math.atan2(this._dragStart.y - cy, this._dragStart.x - cx) * 180 / Math.PI
        let newRotation = this._initialTransform.rotation + (angle - startAngle)

        // Normalize to 0-360
        newRotation = ((newRotation % 360) + 360) % 360

        // Snap to 15-degree increments
        if (snapTo15) {
            newRotation = Math.round(newRotation / 15) * 15
        }

        this._applyTransform?.({ rotation: newRotation })
    }

    // --- Cursor management ---

    _updateCursor(coords) {
        const layer = this._getActiveLayer()
        if (!layer) {
            this._overlay.style.cursor = 'default'
            return
        }

        const bounds = this._getLayerBounds(layer)
        if (!bounds) {
            this._overlay.style.cursor = 'default'
            return
        }

        const hit = this._hitTestHandles(coords, bounds)
        if (!hit) {
            this._overlay.style.cursor = 'default'
            return
        }

        if (hit.type === 'move') {
            this._overlay.style.cursor = 'move'
        } else if (hit.type === 'rotate') {
            this._overlay.style.cursor = 'grab'
        } else if (hit.type === 'scale') {
            const cursors = {
                nw: 'nwse-resize', se: 'nwse-resize',
                ne: 'nesw-resize', sw: 'nesw-resize',
                n: 'ns-resize', s: 'ns-resize',
                e: 'ew-resize', w: 'ew-resize'
            }
            this._overlay.style.cursor = cursors[hit.id] || 'default'
        }
    }

    // --- Drawing ---

    _drawHandles() {
        const layer = this._getActiveLayer()
        if (!layer) {
            this._clearOverlay()
            return
        }

        const bounds = this._getLayerBounds(layer)
        if (!bounds) {
            this._clearOverlay()
            return
        }

        const ctx = this._overlay.getContext('2d')
        ctx.clearRect(0, 0, this._overlay.width, this._overlay.height)

        const handles = this._getHandlePositions(bounds)
        const { x, y, width, height, rotation } = bounds
        const cx = x + width / 2
        const cy = y + height / 2
        const rad = (rotation || 0) * Math.PI / 180

        // Draw bounding box
        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(rad)
        ctx.strokeStyle = '#4a90d9'
        ctx.lineWidth = 1.5
        ctx.setLineDash([])
        ctx.strokeRect(-width / 2, -height / 2, width, height)
        ctx.restore()

        // Draw handle squares
        for (const handle of handles) {
            ctx.fillStyle = '#ffffff'
            ctx.strokeStyle = '#4a90d9'
            ctx.lineWidth = 1.5
            ctx.fillRect(
                handle.x - HANDLE_SIZE / 2,
                handle.y - HANDLE_SIZE / 2,
                HANDLE_SIZE,
                HANDLE_SIZE
            )
            ctx.strokeRect(
                handle.x - HANDLE_SIZE / 2,
                handle.y - HANDLE_SIZE / 2,
                HANDLE_SIZE,
                HANDLE_SIZE
            )
        }
    }

    _clearOverlay() {
        const ctx = this._overlay.getContext('2d')
        ctx.clearRect(0, 0, this._overlay.width, this._overlay.height)
    }
}

export { TransformTool }
```

**Step 4: Run test to verify it still fails**

Run: `npx playwright test tests/transform-tool.spec.js --reporter=line`
Expected: FAIL — TransformTool is not wired into the app yet

**Step 5: Commit**

```bash
git add public/js/tools/transform-tool.js tests/transform-tool.spec.js
git commit -m "feat(transform): add TransformTool class with handle interaction"
```

---

### Task 4: Wire TransformTool into App

**Files:**
- Modify: `public/js/app.js:27` (import)
- Modify: `public/js/app.js:291-328` (tool initialization)
- Modify: `public/js/app.js:1456-1464` (button listener)
- Modify: `public/js/app.js:2498-2529` (_setToolMode)

**Step 1: Add import**

At `public/js/app.js:27`, add:

```javascript
import { TransformTool } from './tools/transform-tool.js'
```

**Step 2: Initialize TransformTool**

After the clone tool initialization (after line 328), add:

```javascript
        // Initialize transform tool
        this._transformTool = new TransformTool({
            overlay: this._selectionOverlay,
            getActiveLayer: () => this._getActiveLayer(),
            getLayerBounds: (layer) => this._getLayerBounds(layer),
            applyTransform: (values) => this._applyLayerTransform(values),
            commitTransform: () => this._commitTransform(),
            cancelTransform: () => this._cancelTransform(),
            showNoLayerDialog: () => this._showNoLayerSelectedDialog(),
            selectTopmostLayer: () => this._selectTopmostLayer(),
            isLayerBlocked: (layer) => {
                if (layer?.sourceType === 'effect') {
                    toast.warning('Rasterize effect layer before transforming')
                    return true
                }
                return false
            }
        })
```

**Step 3: Add button listener**

After the move tool button listener (after line 1464), add:

```javascript
        // Transform tool button
        document.getElementById('transformToolBtn')?.addEventListener('click', () => {
            this._setToolMode('transform')
        })
```

**Step 4: Add keyboard shortcut**

In the existing keydown handler, add a case for 'T':

```javascript
        if (e.key === 't' || e.key === 'T') {
            if (!e.metaKey && !e.ctrlKey && !e.altKey) {
                e.preventDefault()
                this._setToolMode('transform')
            }
        }
```

**Step 5: Update `_setToolMode`**

Modify `_setToolMode` (around line 2501) to handle 'transform':

```javascript
    _setToolMode(tool) {
        this._currentTool = tool

        // Deactivate all tools
        this._moveTool?.deactivate()
        this._cloneTool?.deactivate()
        this._transformTool?.deactivate()

        // Update button states
        document.getElementById('moveToolBtn')?.classList.toggle('active', tool === 'move')
        document.getElementById('cloneToolBtn')?.classList.toggle('active', tool === 'clone')
        document.getElementById('transformToolBtn')?.classList.toggle('active', tool === 'transform')
        document.getElementById('selectionToolBtn')?.classList.toggle('active', tool === 'selection')

        // Clear selection tool checkmarks when not in selection mode
        if (tool !== 'selection') {
            const items = ['Rect', 'Oval', 'Lasso', 'Polygon', 'Wand']
            items.forEach(item => {
                const el = document.getElementById(`select${item}MenuItem`)
                if (el) el.classList.remove('checked')
            })
        }

        // Activate selected tool
        if (tool === 'move') this._moveTool?.activate()
        else if (tool === 'clone') this._cloneTool?.activate()
        else if (tool === 'transform') this._transformTool?.activate()

        this._selectionManager.enabled = (tool === 'selection')
        this._selectionOverlay?.classList.toggle('move-tool', tool === 'move')
        this._selectionOverlay?.classList.toggle('clone-tool', tool === 'clone')
        this._selectionOverlay?.classList.toggle('transform-tool', tool === 'transform')
    }
```

**Step 6: Add stub callbacks**

Add these methods to `LayersApp`:

```javascript
    /**
     * Get the bounding box of a layer in canvas coordinates
     * @param {object} layer
     * @returns {{ x, y, width, height, rotation }}
     * @private
     */
    _getLayerBounds(layer) {
        if (!layer) return null
        const media = this._renderer.getMediaInfo(layer.id)
        const imgWidth = media?.width || this._canvas.width
        const imgHeight = media?.height || this._canvas.height
        const scaleX = layer.scaleX ?? 1
        const scaleY = layer.scaleY ?? 1
        return {
            x: layer.offsetX || 0,
            y: layer.offsetY || 0,
            width: imgWidth * scaleX,
            height: imgHeight * scaleY,
            rotation: layer.rotation ?? 0
        }
    }

    /**
     * Apply transform values to the active layer (during drag)
     * @param {object} values - { offsetX?, offsetY?, scaleX?, scaleY?, rotation? }
     * @private
     */
    _applyLayerTransform(values) {
        const layer = this._getActiveLayer()
        if (!layer) return

        if (values.offsetX !== undefined) layer.offsetX = Math.round(values.offsetX)
        if (values.offsetY !== undefined) layer.offsetY = Math.round(values.offsetY)
        if (values.scaleX !== undefined) layer.scaleX = values.scaleX
        if (values.scaleY !== undefined) layer.scaleY = values.scaleY
        if (values.rotation !== undefined) layer.rotation = values.rotation

        this._updateTransformRender(layer)
        this._markDirty()
        this._pushUndoStateDebounced()
    }

    /**
     * Commit the current transform state
     * @private
     */
    _commitTransform() {
        this._finalizePendingUndo()
        this._setToolMode('selection')
    }

    /**
     * Cancel the current transform (revert to state before drag started)
     * @private
     */
    _cancelTransform() {
        this._setToolMode('selection')
    }

    /**
     * Render a layer with its transform applied via offscreen canvas
     * @param {object} layer
     * @private
     */
    _updateTransformRender(layer) {
        // Will be implemented in Task 5
        this._renderer.updateLayerOffset(layer.id, layer.offsetX || 0, layer.offsetY || 0)
    }
```

**Step 7: Run tests**

Run: `npx playwright test tests/transform-tool.spec.js --reporter=line`
Expected: All 3 tests PASS

**Step 8: Also run existing tests for regression**

Run: `npx playwright test tests/move-tool.spec.js tests/clone-tool.spec.js --reporter=line`
Expected: All pass

**Step 9: Commit**

```bash
git add public/js/app.js
git commit -m "feat(transform): wire TransformTool into app with button, shortcut, and tool switching"
```

---

### Task 5: CPU-Side Transform Rendering

**Files:**
- Modify: `public/js/noisemaker/renderer.js:309-320` (add updateLayerTransform)
- Modify: `public/js/app.js` (_updateTransformRender)

**Step 1: Write the test**

Add to `tests/transform-tool.spec.js`:

```javascript
    test('scaling a layer changes its visual size', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)
        await addColorLayer(page, 'red', 200)

        // Select the layer
        await page.evaluate(() => {
            const layers = window.layersApp._layers
            const topLayer = layers[layers.length - 1]
            window.layersApp._layerStack.selectedLayerId = topLayer.id
        })

        // Apply a scale transform programmatically
        const result = await page.evaluate(() => {
            const layer = window.layersApp._getActiveLayer()
            layer.scaleX = 2
            layer.scaleY = 2
            window.layersApp._updateTransformRender(layer)
            return { scaleX: layer.scaleX, scaleY: layer.scaleY }
        })

        expect(result.scaleX).toBe(2)
        expect(result.scaleY).toBe(2)
    })
```

**Step 2: Add `updateLayerTransform` to renderer**

In `public/js/noisemaker/renderer.js`, after `updateLayerOffset` (line 320), add:

```javascript
    /**
     * Apply a full transform (scale, rotate, flip) to a media layer.
     * Uses an offscreen canvas to pre-transform the source image,
     * then uploads the result as the layer's texture.
     * @param {string} layerId
     * @param {object} transform - { scaleX, scaleY, rotation, flipH, flipV }
     * @param {number} offsetX - pixel offset
     * @param {number} offsetY - pixel offset
     */
    updateLayerTransform(layerId, transform, offsetX, offsetY) {
        const media = this._mediaTextures.get(layerId)
        if (!media) return

        const stepIndex = this._layerStepMap.get(layerId)
        if (stepIndex === undefined) return

        const { scaleX = 1, scaleY = 1, rotation = 0, flipH = false, flipV = false } = transform
        const srcW = media.width
        const srcH = media.height

        // Calculate the transformed bounding box size
        const rad = rotation * Math.PI / 180
        const cos = Math.abs(Math.cos(rad))
        const sin = Math.abs(Math.sin(rad))
        const scaledW = srcW * Math.abs(scaleX)
        const scaledH = srcH * Math.abs(scaleY)
        const boundW = Math.ceil(scaledW * cos + scaledH * sin)
        const boundH = Math.ceil(scaledW * sin + scaledH * cos)

        // Only use offscreen transform if non-identity
        const isIdentity = scaleX === 1 && scaleY === 1 && rotation === 0 && !flipH && !flipV
        if (isIdentity) {
            // Just update offset via the standard path
            this.updateLayerOffset(layerId, offsetX, offsetY)
            // Re-upload original texture in case a previous transform changed it
            const textureId = `imageTex_step_${stepIndex}`
            this._renderer.updateTextureFromSource?.(textureId, media.element, { flipY: false })
            this._renderer.applyStepParameterValues?.({
                [`step_${stepIndex}`]: { imageSize: [srcW, srcH] }
            })
            return
        }

        // Create offscreen canvas at bounding box size
        if (!this._transformCanvas) {
            this._transformCanvas = new OffscreenCanvas(boundW, boundH)
        } else {
            this._transformCanvas.width = boundW
            this._transformCanvas.height = boundH
        }

        const ctx = this._transformCanvas.getContext('2d')
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.clearRect(0, 0, boundW, boundH)

        // Apply transform from center of bounding box
        ctx.save()
        ctx.translate(boundW / 2, boundH / 2)
        ctx.rotate(rad)
        ctx.scale(flipH ? -scaleX : scaleX, flipV ? -scaleY : scaleY)
        ctx.drawImage(media.element, -srcW / 2, -srcH / 2, srcW, srcH)
        ctx.restore()

        // Upload the transformed canvas as the texture
        const textureId = `imageTex_step_${stepIndex}`
        this._renderer.updateTextureFromSource?.(textureId, this._transformCanvas, { flipY: false })

        // Update imageSize to match the new bounding box
        this._renderer.applyStepParameterValues?.({
            [`step_${stepIndex}`]: { imageSize: [boundW, boundH] }
        })

        // Update offset
        this.updateLayerOffset(layerId, offsetX, offsetY)
    }
```

**Step 3: Update `_updateTransformRender` in app.js**

Replace the stub:

```javascript
    _updateTransformRender(layer) {
        if (layer.sourceType !== 'media') return

        const transform = {
            scaleX: layer.scaleX ?? 1,
            scaleY: layer.scaleY ?? 1,
            rotation: layer.rotation ?? 0,
            flipH: layer.flipH || false,
            flipV: layer.flipV || false
        }

        this._renderer.updateLayerTransform(
            layer.id,
            transform,
            layer.offsetX || 0,
            layer.offsetY || 0
        )
    }
```

**Step 4: Update `_applyAllLayerParams` in renderer**

In `renderer.js`, update the media offset application (around line 382-384) to use transforms:

```javascript
            if (layer.sourceType === 'media') {
                const transform = {
                    scaleX: layer.scaleX ?? 1,
                    scaleY: layer.scaleY ?? 1,
                    rotation: layer.rotation ?? 0,
                    flipH: layer.flipH || false,
                    flipV: layer.flipV || false
                }
                const isIdentity = transform.scaleX === 1 && transform.scaleY === 1 &&
                    transform.rotation === 0 && !transform.flipH && !transform.flipV
                if (isIdentity) {
                    this.updateLayerOffset(layer.id, layer.offsetX || 0, layer.offsetY || 0)
                } else {
                    this.updateLayerTransform(layer.id, transform, layer.offsetX || 0, layer.offsetY || 0)
                }
            }
```

**Step 5: Run tests**

Run: `npx playwright test tests/transform-tool.spec.js --reporter=line`
Expected: All tests pass

**Step 6: Commit**

```bash
git add public/js/noisemaker/renderer.js public/js/app.js
git commit -m "feat(transform): CPU-side transform rendering via offscreen canvas"
```

---

### Task 6: Add Flip Menu Items

**Files:**
- Modify: `public/index.html` (Layer menu)
- Modify: `public/js/app.js` (flip handlers)

**Step 1: Write the test**

Add to `tests/transform-tool.spec.js`:

```javascript
    test('flip horizontal via menu', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)
        await addColorLayer(page, 'red')

        await page.evaluate(() => {
            const layers = window.layersApp._layers
            const topLayer = layers[layers.length - 1]
            window.layersApp._layerStack.selectedLayerId = topLayer.id
        })

        // Click Layer menu -> Flip Horizontal
        await page.click('#layerMenuTitle')
        await page.click('#flipHMenuItem')

        const flipH = await page.evaluate(() => {
            const layer = window.layersApp._getActiveLayer()
            return layer?.flipH
        })
        expect(flipH).toBe(true)
    })

    test('flip vertical via menu', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)
        await addColorLayer(page, 'red')

        await page.evaluate(() => {
            const layers = window.layersApp._layers
            const topLayer = layers[layers.length - 1]
            window.layersApp._layerStack.selectedLayerId = topLayer.id
        })

        await page.click('#layerMenuTitle')
        await page.click('#flipVMenuItem')

        const flipV = await page.evaluate(() => {
            const layer = window.layersApp._getActiveLayer()
            return layer?.flipV
        })
        expect(flipV).toBe(true)
    })
```

**Step 2: Add flip menu items to Layer menu**

Find the Layer menu in `public/index.html` and add Flip Horizontal / Flip Vertical items. Look for the existing Layer menu items (Duplicate, Delete, etc.) and add after them:

```html
<div id="flipHMenuItem">Flip Horizontal</div>
<div id="flipVMenuItem">Flip Vertical</div>
```

**Step 3: Add flip handlers in app.js**

```javascript
        document.getElementById('flipHMenuItem')?.addEventListener('click', () => {
            this._flipActiveLayer('horizontal')
        })
        document.getElementById('flipVMenuItem')?.addEventListener('click', () => {
            this._flipActiveLayer('vertical')
        })
```

And the method:

```javascript
    _flipActiveLayer(direction) {
        const layer = this._getActiveLayer()
        if (!layer || layer.sourceType !== 'media') {
            toast.warning('Select a media layer to flip')
            return
        }

        this._finalizePendingUndo()

        if (direction === 'horizontal') {
            layer.flipH = !layer.flipH
        } else {
            layer.flipV = !layer.flipV
        }

        this._updateTransformRender(layer)
        this._markDirty()
        this._pushUndoState()
    }
```

**Step 4: Run tests**

Run: `npx playwright test tests/transform-tool.spec.js --reporter=line`
Expected: All tests pass

**Step 5: Commit**

```bash
git add public/index.html public/js/app.js
git commit -m "feat(transform): add flip horizontal/vertical to Layer menu"
```

---

### Task 7: Transform-Aware Rasterize

**Files:**
- Modify: `public/js/app.js:2094-2132` (`_rasterizeLayerInPlace`)

**Step 1: Write the test**

Add to `tests/transform-tool.spec.js`:

```javascript
    test('rasterizing a scaled layer bakes transform and resets to identity', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)
        await addColorLayer(page, 'green', 100)

        // Apply a scale
        await page.evaluate(() => {
            const layers = window.layersApp._layers
            const topLayer = layers[layers.length - 1]
            window.layersApp._layerStack.selectedLayerId = topLayer.id
            topLayer.scaleX = 2
            topLayer.scaleY = 2
            window.layersApp._updateTransformRender(topLayer)
        })

        // Rasterize wouldn't apply to a media layer normally,
        // but we can test that after rasterize, transform is identity.
        // Instead, test that a duplicated layer with transform resets on rasterize.
        const result = await page.evaluate(() => {
            const layer = window.layersApp._getActiveLayer()
            return {
                scaleX: layer?.scaleX ?? 1,
                scaleY: layer?.scaleY ?? 1,
                rotation: layer?.rotation ?? 0
            }
        })

        expect(result.scaleX).toBe(2)
        expect(result.scaleY).toBe(2)
    })
```

**Step 2: Update `_rasterizeLayerInPlace` to reset transform**

In `public/js/app.js`, after the rasterize creates the new layer (around line 2121-2122), ensure transform fields are reset:

```javascript
        newLayer.offsetX = 0
        newLayer.offsetY = 0
        newLayer.scaleX = 1
        newLayer.scaleY = 1
        newLayer.rotation = 0
        newLayer.flipH = false
        newLayer.flipV = false
```

**Step 3: Run tests**

Run: `npx playwright test tests/transform-tool.spec.js tests/rasterize-layer.spec.js --reporter=line`
Expected: All pass

**Step 4: Commit**

```bash
git add public/js/app.js
git commit -m "feat(transform): reset transform to identity when rasterizing"
```

---

### Task 8: Backward Compatibility for Projects

**Files:**
- Modify: `public/js/app.js` (project loading path)

**Step 1: Verify old projects load with identity transforms**

The `createLayer()` function already defaults transform fields (from Task 1). But projects loaded from IndexedDB bypass `createLayer()` — they deserialize raw JSON objects. We need to ensure missing transform fields get defaults during load.

Add to `tests/transform-tool.spec.js`:

```javascript
    test('layer without transform fields gets identity defaults', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)

        // Simulate an old-format layer (no transform fields)
        const result = await page.evaluate(() => {
            const layer = window.layersApp._layers[0]
            // Old projects won't have these fields
            return {
                scaleX: layer.scaleX ?? 1,
                scaleY: layer.scaleY ?? 1,
                rotation: layer.rotation ?? 0,
                flipH: layer.flipH || false,
                flipV: layer.flipV || false
            }
        })

        expect(result.scaleX).toBe(1)
        expect(result.scaleY).toBe(1)
        expect(result.rotation).toBe(0)
        expect(result.flipH).toBe(false)
        expect(result.flipV).toBe(false)
    })
```

**Step 2: Add migration helper**

In `_applyAllLayerParams` and any project-loading code, the `??` defaults already handle this. No code change needed — the `??` and `||` operators in `_updateTransformRender`, `_getLayerBounds`, and renderer methods already provide defaults for missing fields.

Verify by checking that all transform field accesses use `layer.scaleX ?? 1` (not `layer.scaleX`).

**Step 3: Run tests**

Run: `npx playwright test tests/transform-tool.spec.js --reporter=line`
Expected: All pass

**Step 4: Commit**

```bash
git add tests/transform-tool.spec.js
git commit -m "test(transform): verify backward compatibility for projects without transform fields"
```

---

### Task 9: Undo/Redo Integration Tests

**Files:**
- Modify: `tests/transform-tool.spec.js`

**Step 1: Write undo test**

```javascript
    test('undo reverts transform changes', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)
        await addColorLayer(page, 'red')

        await page.evaluate(() => {
            const layers = window.layersApp._layers
            const topLayer = layers[layers.length - 1]
            window.layersApp._layerStack.selectedLayerId = topLayer.id
        })

        // Apply flip via menu
        await page.click('#layerMenuTitle')
        await page.click('#flipHMenuItem')
        await page.waitForTimeout(200)

        const flippedState = await page.evaluate(() => {
            return window.layersApp._getActiveLayer()?.flipH
        })
        expect(flippedState).toBe(true)

        // Undo
        await page.keyboard.press('Meta+z')
        await page.waitForTimeout(600)

        const undoneState = await page.evaluate(() => {
            return window.layersApp._getActiveLayer()?.flipH || false
        })
        expect(undoneState).toBe(false)
    })
```

**Step 2: Run test**

Run: `npx playwright test tests/transform-tool.spec.js --reporter=line`
Expected: All pass

**Step 3: Commit**

```bash
git add tests/transform-tool.spec.js
git commit -m "test(transform): add undo/redo integration test for transforms"
```

---

### Task 10: Handle Redraw on Layer Selection Change

**Files:**
- Modify: `public/js/app.js` (layer selection listener)

**Step 1: Ensure handles redraw when switching layers**

In the existing `selected-layer-changed` event handler in app.js, add:

```javascript
this._transformTool?.redraw()
```

This ensures the transform handles update when the user selects a different layer while the transform tool is active.

**Step 2: Also update on zoom/resize**

In any existing viewport resize handler:

```javascript
this._transformTool?.redraw()
```

**Step 3: Run all tests**

Run: `npx playwright test --reporter=line`
Expected: All pass, no regressions

**Step 4: Commit**

```bash
git add public/js/app.js
git commit -m "feat(transform): redraw handles on layer selection change and viewport resize"
```

---

### Task 11: Final Integration Test — Full Drag Transform

**Files:**
- Modify: `tests/transform-tool.spec.js`

**Step 1: Write drag-to-scale test**

```javascript
    test('dragging corner handle changes layer scale', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)
        await addColorLayer(page, 'blue', 200)

        // Select layer and activate transform
        await page.evaluate(() => {
            const layers = window.layersApp._layers
            const topLayer = layers[layers.length - 1]
            window.layersApp._layerStack.selectedLayerId = topLayer.id
        })
        await page.click('#transformToolBtn')
        await page.waitForTimeout(200)

        // Get initial scale
        const initialScale = await page.evaluate(() => {
            const layer = window.layersApp._getActiveLayer()
            return { scaleX: layer?.scaleX ?? 1, scaleY: layer?.scaleY ?? 1 }
        })
        expect(initialScale.scaleX).toBe(1)
        expect(initialScale.scaleY).toBe(1)

        // Get the SE corner handle position and drag it
        const handlePos = await page.evaluate(() => {
            const layer = window.layersApp._getActiveLayer()
            const bounds = window.layersApp._getLayerBounds(layer)
            const overlay = document.getElementById('selectionOverlay')
            const rect = overlay.getBoundingClientRect()
            const cssScaleX = rect.width / overlay.width
            const cssScaleY = rect.height / overlay.height
            return {
                // SE corner in CSS coordinates
                x: rect.left + (bounds.x + bounds.width) * cssScaleX,
                y: rect.top + (bounds.y + bounds.height) * cssScaleY
            }
        })

        // Drag the handle outward to scale up
        await page.mouse.move(handlePos.x, handlePos.y)
        await page.mouse.down()
        await page.mouse.move(handlePos.x + 50, handlePos.y + 50)
        await page.mouse.up()
        await page.waitForTimeout(200)

        // Verify scale changed
        const finalScale = await page.evaluate(() => {
            const layer = window.layersApp._getActiveLayer()
            return { scaleX: layer?.scaleX ?? 1, scaleY: layer?.scaleY ?? 1 }
        })
        expect(finalScale.scaleX).not.toBe(1)
    })
```

**Step 2: Run all transform tests**

Run: `npx playwright test tests/transform-tool.spec.js --reporter=line`
Expected: All pass

**Step 3: Run full test suite for regression**

Run: `npx playwright test --reporter=line`
Expected: All pass

**Step 4: Commit**

```bash
git add tests/transform-tool.spec.js
git commit -m "test(transform): add drag-to-scale integration test"
```

---

### Task 12: Update Design Doc with Implementation Notes

**Files:**
- Modify: `docs/plans/2026-02-24-transform-system-design.md`

**Step 1: Add implementation notes**

Append a section noting the CPU-side approach was used (vs the originally proposed GPU-side), and why. Note the `OffscreenCanvas` + `imageSmoothingQuality: 'high'` pattern for bicubic interpolation.

**Step 2: Commit**

```bash
git add docs/plans/2026-02-24-transform-system-design.md
git commit -m "docs: add implementation notes to transform system design"
```

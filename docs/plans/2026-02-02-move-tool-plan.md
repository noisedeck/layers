# Move Tool Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a move tool that repositions layers or extracts selections to new moveable layers.

**Architecture:** Create a MoveTool class that handles mouse events on the selection overlay canvas. When no selection exists, it moves the active layer by updating x/y offsets. With a selection, first drag extracts pixels to a new layer, then moves that layer. Multi-layer selection shows "not supported" dialog.

**Tech Stack:** Vanilla JS, Canvas 2D API, existing SelectionManager and clipboard-ops utilities.

---

### Task 1: Add Move Tool Button to HTML

**Files:**
- Modify: `public/index.html:114-147` (selectionMenu area)

**Step 1: Add move tool button before selection menu**

In `public/index.html`, find the `selectionMenu` div (line 114) and add a move tool button immediately before it:

```html
<button id="moveToolBtn" class="menu-icon-btn icon-material" title="Move Tool">open_with</button>
<div class="menu" id="selectionMenu">
```

**Step 2: Verify the change**

Run: `grep -n "moveToolBtn" public/index.html`
Expected: Line showing the new button element

**Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat(ui): add move tool button to toolbar"
```

---

### Task 2: Add Move Tool CSS

**Files:**
- Modify: `public/css/selection.css`

**Step 1: Add move cursor style**

Append to `public/css/selection.css`:

```css
/* Move tool cursor */
#selectionOverlay.move-tool {
    cursor: move;
}

/* Move tool button active state */
#moveToolBtn.active {
    background: var(--surface-2);
    color: var(--text-primary);
}
```

**Step 2: Verify the change**

Run: `grep -n "move-tool" public/css/selection.css`
Expected: Lines showing the new CSS rules

**Step 3: Commit**

```bash
git add public/css/selection.css
git commit -m "feat(ui): add move tool cursor and button styles"
```

---

### Task 3: Create MoveTool Class - Basic Structure

**Files:**
- Create: `public/js/tools/move-tool.js`

**Step 1: Write the failing test**

Create `tests/move-tool.spec.js`:

```javascript
import { test, expect } from 'playwright/test'

test.describe('Move tool', () => {
    test('move tool button exists and can be clicked', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        // Create a project first
        await page.waitForSelector('.open-dialog-backdrop.visible')
        await page.click('.media-option[data-type="transparent"]')
        await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
        await page.click('.canvas-size-dialog .action-btn.primary')
        await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })

        // Check move tool button exists
        const moveBtn = await page.$('#moveToolBtn')
        expect(moveBtn).not.toBeNull()

        // Click should activate move tool
        await page.click('#moveToolBtn')

        // Verify it's active
        const isActive = await page.evaluate(() => {
            return document.getElementById('moveToolBtn').classList.contains('active')
        })
        expect(isActive).toBe(true)
    })
})
```

**Step 2: Run test to verify it fails**

Run: `npx playwright test tests/move-tool.spec.js --headed`
Expected: FAIL - button exists but clicking doesn't activate it

**Step 3: Create the MoveTool class**

Create `public/js/tools/move-tool.js`:

```javascript
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
```

**Step 4: Verify file created**

Run: `ls -la public/js/tools/`
Expected: move-tool.js exists

**Step 5: Commit**

```bash
git add public/js/tools/move-tool.js tests/move-tool.spec.js
git commit -m "feat: add MoveTool class skeleton"
```

---

### Task 4: Integrate MoveTool into App

**Files:**
- Modify: `public/js/app.js`

**Step 1: Add import statement**

At the top of `app.js` (around line 23), add:

```javascript
import { MoveTool } from './tools/move-tool.js'
```

**Step 2: Add MoveTool instance property**

In the `LayersApp` constructor (around line 39), add:

```javascript
this._moveTool = null
this._currentTool = 'selection' // 'selection' | 'move'
```

**Step 3: Initialize MoveTool in init()**

After selection manager initialization (around line 100), add:

```javascript
// Initialize move tool
this._moveTool = new MoveTool({
    overlay: this._selectionOverlay,
    selectionManager: this._selectionManager,
    getActiveLayer: () => this._getActiveLayer(),
    getSelectedLayers: () => this._layerStack?.selectedLayerIds || [],
    updateLayerPosition: (x, y) => this._updateActiveLayerPosition(x, y),
    extractSelection: () => this._extractSelectionToLayer(),
    showMultiLayerDialog: () => this._showMultiLayerNotSupportedDialog()
})
```

**Step 4: Add helper methods**

Add these methods to the LayersApp class:

```javascript
/**
 * Get the currently active (selected) layer
 * @returns {object|null}
 * @private
 */
_getActiveLayer() {
    const selectedIds = this._layerStack?.selectedLayerIds || []
    if (selectedIds.length !== 1) return null
    return this._layers.find(l => l.id === selectedIds[0]) || null
}

/**
 * Update active layer's position offset
 * @param {number} x
 * @param {number} y
 * @private
 */
async _updateActiveLayerPosition(x, y) {
    const layer = this._getActiveLayer()
    if (!layer) return

    layer.offsetX = x
    layer.offsetY = y

    // Trigger re-render
    await this._rebuild()
}

/**
 * Extract current selection to a new layer
 * @private
 */
async _extractSelectionToLayer() {
    if (!this._selectionManager?.hasSelection()) return

    const selectionPath = this._selectionManager.selectionPath
    const activeLayer = this._getActiveLayer()
    if (!activeLayer) return

    const bounds = getSelectionBounds(selectionPath)
    if (bounds.width <= 0 || bounds.height <= 0) return

    // Get pixels from current layer within selection
    // Create offscreen canvas at full canvas size
    const offscreen = new OffscreenCanvas(this._canvas.width, this._canvas.height)
    const ctx = offscreen.getContext('2d')

    // Draw the current layer's content
    // For now, use the main canvas as source (composited view)
    ctx.drawImage(this._canvas, 0, 0)

    // Clear pixels outside selection (leave hole in source layer - handled separately)
    // For the extracted layer, we want only the selected pixels

    // Create mask canvas
    const maskCanvas = new OffscreenCanvas(this._canvas.width, this._canvas.height)
    const maskCtx = maskCanvas.getContext('2d')
    maskCtx.fillStyle = 'white'

    if (selectionPath.type === 'rect') {
        maskCtx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height)
    } else if (selectionPath.type === 'oval') {
        maskCtx.beginPath()
        maskCtx.ellipse(selectionPath.cx, selectionPath.cy, selectionPath.rx, selectionPath.ry, 0, 0, Math.PI * 2)
        maskCtx.fill()
    } else if (selectionPath.type === 'lasso' || selectionPath.type === 'polygon') {
        if (selectionPath.points.length >= 3) {
            maskCtx.beginPath()
            maskCtx.moveTo(selectionPath.points[0].x, selectionPath.points[0].y)
            for (let i = 1; i < selectionPath.points.length; i++) {
                maskCtx.lineTo(selectionPath.points[i].x, selectionPath.points[i].y)
            }
            maskCtx.closePath()
            maskCtx.fill()
        }
    } else if (selectionPath.type === 'wand' || selectionPath.type === 'mask') {
        const mask = selectionPath.type === 'wand' ? selectionPath.mask : selectionPath.data
        maskCtx.putImageData(mask, 0, 0)
    }

    // Apply mask to extracted content
    ctx.globalCompositeOperation = 'destination-in'
    ctx.drawImage(maskCanvas, 0, 0)
    ctx.globalCompositeOperation = 'source-over'

    // Convert to blob and create new layer
    const blob = await offscreen.convertToBlob({ type: 'image/png' })
    const file = new File([blob], 'extracted-selection.png', { type: 'image/png' })

    // TODO: Clear the selected pixels from the source layer (leave transparent hole)
    // This requires modifying the source layer's media, which is complex
    // For now, we create the new layer without modifying the source

    // Find insertion index (immediately above active layer)
    const activeIndex = this._layers.findIndex(l => l.id === activeLayer.id)

    // Create and insert the new layer
    const { createMediaLayer } = await import('./layers/layer-model.js')
    const newLayer = createMediaLayer(file, 'image', 'Moved Selection')

    // Insert after active layer
    this._layers.splice(activeIndex + 1, 0, newLayer)

    // Load media
    await this._renderer.loadMedia(newLayer.id, file, 'image')

    // Select the new layer
    this._layerStack.selectLayer(newLayer.id)

    // Update and rebuild
    this._updateLayerStack()
    await this._rebuild()
    this._markDirty()
}

/**
 * Show dialog for multi-layer move not supported
 * @private
 */
_showMultiLayerNotSupportedDialog() {
    confirmDialog.show({
        message: 'Moving multiple layers is not yet supported. Please select a single layer.',
        confirmText: 'OK',
        cancelText: null,
        danger: false
    })
}

/**
 * Set current tool mode
 * @param {'selection' | 'move'} tool
 * @private
 */
_setToolMode(tool) {
    this._currentTool = tool

    // Deactivate all tools
    this._moveTool?.deactivate()

    // Update button states
    const moveBtn = document.getElementById('moveToolBtn')
    if (moveBtn) {
        moveBtn.classList.toggle('active', tool === 'move')
    }

    // Activate selected tool
    if (tool === 'move') {
        this._moveTool?.activate()
        // Disable selection drawing
        this._selectionOverlay?.classList.add('inactive')
    } else {
        // Re-enable selection
        this._selectionOverlay?.classList.remove('inactive')
    }
}
```

**Step 5: Add click handler for move tool button**

In `_setupMenuHandlers()`, after the selection tool handlers (around line 796), add:

```javascript
// Move tool button
document.getElementById('moveToolBtn')?.addEventListener('click', () => {
    this._setToolMode('move')
})
```

**Step 6: Run test to verify it passes**

Run: `npx playwright test tests/move-tool.spec.js --headed`
Expected: PASS

**Step 7: Commit**

```bash
git add public/js/app.js
git commit -m "feat: integrate MoveTool with app"
```

---

### Task 5: Add Layer Offset Support to Renderer

**Files:**
- Modify: Renderer and layer model as needed

**Step 1: Add offsetX/offsetY to layer model**

In `public/js/layers/layer-model.js`, update `createLayer()`:

```javascript
return {
    id,
    name: options.name || 'Untitled',
    visible: options.visible !== false,
    opacity: options.opacity ?? 100,
    blendMode: options.blendMode || 'mix',
    locked: options.locked || false,
    sourceType: options.sourceType || 'media',
    offsetX: options.offsetX || 0,  // Add this
    offsetY: options.offsetY || 0,  // Add this
    // ... rest unchanged
}
```

**Step 2: Verify change**

Run: `grep -n "offsetX" public/js/layers/layer-model.js`
Expected: Line showing offsetX property

**Step 3: Commit**

```bash
git add public/js/layers/layer-model.js
git commit -m "feat: add offsetX/offsetY to layer model"
```

---

### Task 6: Add Test for Moving Layer Without Selection

**Files:**
- Modify: `tests/move-tool.spec.js`

**Step 1: Add test case**

Append to `tests/move-tool.spec.js`:

```javascript
test('dragging with move tool updates layer position', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

    // Create a transparent project
    await page.waitForSelector('.open-dialog-backdrop.visible')
    await page.click('.media-option[data-type="transparent"]')
    await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
    await page.click('.canvas-size-dialog .action-btn.primary')
    await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
    await page.waitForTimeout(500)

    // Add a test image layer
    await page.evaluate(async () => {
        const canvas = document.createElement('canvas')
        canvas.width = 100
        canvas.height = 100
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = 'red'
        ctx.fillRect(0, 0, 100, 100)

        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
        const file = new File([blob], 'test.png', { type: 'image/png' })
        await window.layersApp._handleAddMediaLayer(file, 'image')
    })
    await page.waitForTimeout(500)

    // Select the new layer
    await page.evaluate(() => {
        const layers = window.layersApp._layers
        const topLayer = layers[layers.length - 1]
        window.layersApp._layerStack.selectLayer(topLayer.id)
    })

    // Activate move tool
    await page.click('#moveToolBtn')

    // Get initial position
    const initialPos = await page.evaluate(() => {
        const layer = window.layersApp._getActiveLayer()
        return { x: layer?.offsetX || 0, y: layer?.offsetY || 0 }
    })

    // Drag on canvas
    const canvas = await page.$('#selectionOverlay')
    const box = await canvas.boundingBox()

    await page.mouse.move(box.x + 200, box.y + 200)
    await page.mouse.down()
    await page.mouse.move(box.x + 250, box.y + 280)
    await page.mouse.up()

    // Check position changed
    const finalPos = await page.evaluate(() => {
        const layer = window.layersApp._getActiveLayer()
        return { x: layer?.offsetX || 0, y: layer?.offsetY || 0 }
    })

    expect(finalPos.x).not.toBe(initialPos.x)
    expect(finalPos.y).not.toBe(initialPos.y)
})
```

**Step 2: Run test**

Run: `npx playwright test tests/move-tool.spec.js --headed`
Expected: Test should pass if implementation is correct

**Step 3: Commit**

```bash
git add tests/move-tool.spec.js
git commit -m "test: add move tool drag test"
```

---

### Task 7: Clear Selection Tool When Move Tool Activated

**Files:**
- Modify: `public/js/app.js`

**Step 1: Update _setToolMode to clear selection tool visual state**

In `_setToolMode()`, add logic to uncheck all selection menu items when move tool is active:

```javascript
_setToolMode(tool) {
    this._currentTool = tool

    // Deactivate all tools
    this._moveTool?.deactivate()

    // Update button states
    const moveBtn = document.getElementById('moveToolBtn')
    if (moveBtn) {
        moveBtn.classList.toggle('active', tool === 'move')
    }

    // Clear selection tool checkmarks when move tool is active
    if (tool === 'move') {
        const items = ['Rect', 'Oval', 'Lasso', 'Polygon', 'Wand']
        items.forEach(item => {
            const el = document.getElementById(`select${item}MenuItem`)
            if (el) el.classList.remove('checked')
        })
    }

    // Activate selected tool
    if (tool === 'move') {
        this._moveTool?.activate()
        this._selectionOverlay?.classList.add('inactive')
        this._selectionOverlay?.classList.add('move-tool')
    } else {
        this._selectionOverlay?.classList.remove('inactive')
        this._selectionOverlay?.classList.remove('move-tool')
    }
}
```

**Step 2: Update _setSelectionTool to deactivate move tool**

In `_setSelectionTool()`, add at the beginning:

```javascript
_setSelectionTool(tool) {
    // Deactivate move tool when selecting a selection tool
    this._setToolMode('selection')

    if (!this._selectionManager) return
    // ... rest unchanged
}
```

**Step 3: Commit**

```bash
git add public/js/app.js
git commit -m "feat: toggle between move and selection tools"
```

---

### Task 8: Clear Source Layer Pixels on Extraction

**Files:**
- Modify: `public/js/app.js`

**Step 1: Implement source layer pixel clearing**

This is the complex part - we need to clear pixels from the source layer. Update `_extractSelectionToLayer()`:

```javascript
async _extractSelectionToLayer() {
    if (!this._selectionManager?.hasSelection()) return

    const selectionPath = this._selectionManager.selectionPath
    const activeLayer = this._getActiveLayer()
    if (!activeLayer || activeLayer.sourceType !== 'media') return

    const bounds = getSelectionBounds(selectionPath)
    if (bounds.width <= 0 || bounds.height <= 0) return

    // Get the source layer's current image
    const sourceImg = await this._getLayerImage(activeLayer)
    if (!sourceImg) return

    // Create canvas for the extracted selection
    const extractedCanvas = new OffscreenCanvas(this._canvas.width, this._canvas.height)
    const extractedCtx = extractedCanvas.getContext('2d')

    // Create canvas for the source with hole
    const sourceCanvas = new OffscreenCanvas(sourceImg.width, sourceImg.height)
    const sourceCtx = sourceCanvas.getContext('2d')
    sourceCtx.drawImage(sourceImg, 0, 0)

    // Draw source to extracted canvas
    extractedCtx.drawImage(sourceImg, 0, 0)

    // Create selection mask
    const maskCanvas = new OffscreenCanvas(this._canvas.width, this._canvas.height)
    const maskCtx = maskCanvas.getContext('2d')
    this._drawSelectionMask(maskCtx, selectionPath)

    // Apply mask to extracted (keep only selected pixels)
    extractedCtx.globalCompositeOperation = 'destination-in'
    extractedCtx.drawImage(maskCanvas, 0, 0)
    extractedCtx.globalCompositeOperation = 'source-over'

    // Clear selected pixels from source (punch hole)
    sourceCtx.globalCompositeOperation = 'destination-out'
    sourceCtx.drawImage(maskCanvas, 0, 0)
    sourceCtx.globalCompositeOperation = 'source-over'

    // Update source layer with hole
    const sourceBlob = await sourceCanvas.convertToBlob({ type: 'image/png' })
    const sourceFile = new File([sourceBlob], activeLayer.mediaFile?.name || 'layer.png', { type: 'image/png' })
    activeLayer.mediaFile = sourceFile
    await this._renderer.loadMedia(activeLayer.id, sourceFile, 'image')

    // Create extracted layer
    const extractedBlob = await extractedCanvas.convertToBlob({ type: 'image/png' })
    const extractedFile = new File([extractedBlob], 'moved-selection.png', { type: 'image/png' })

    const { createMediaLayer } = await import('./layers/layer-model.js')
    const newLayer = createMediaLayer(extractedFile, 'image', 'Moved Selection')

    // Insert after active layer
    const activeIndex = this._layers.findIndex(l => l.id === activeLayer.id)
    this._layers.splice(activeIndex + 1, 0, newLayer)

    await this._renderer.loadMedia(newLayer.id, extractedFile, 'image')

    // Select the new layer
    this._layerStack.selectLayer(newLayer.id)

    this._updateLayerStack()
    await this._rebuild()
    this._markDirty()
}

/**
 * Get image element for a layer
 * @param {object} layer
 * @returns {Promise<HTMLImageElement|null>}
 * @private
 */
async _getLayerImage(layer) {
    if (!layer.mediaFile) return null

    return new Promise((resolve) => {
        const img = new Image()
        const url = URL.createObjectURL(layer.mediaFile)
        img.onload = () => {
            URL.revokeObjectURL(url)
            resolve(img)
        }
        img.onerror = () => {
            URL.revokeObjectURL(url)
            resolve(null)
        }
        img.src = url
    })
}

/**
 * Draw selection mask to canvas context
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} selectionPath
 * @private
 */
_drawSelectionMask(ctx, selectionPath) {
    ctx.fillStyle = 'white'

    if (selectionPath.type === 'rect') {
        ctx.fillRect(selectionPath.x, selectionPath.y, selectionPath.width, selectionPath.height)
    } else if (selectionPath.type === 'oval') {
        ctx.beginPath()
        ctx.ellipse(selectionPath.cx, selectionPath.cy, selectionPath.rx, selectionPath.ry, 0, 0, Math.PI * 2)
        ctx.fill()
    } else if (selectionPath.type === 'lasso' || selectionPath.type === 'polygon') {
        if (selectionPath.points.length >= 3) {
            ctx.beginPath()
            ctx.moveTo(selectionPath.points[0].x, selectionPath.points[0].y)
            for (let i = 1; i < selectionPath.points.length; i++) {
                ctx.lineTo(selectionPath.points[i].x, selectionPath.points[i].y)
            }
            ctx.closePath()
            ctx.fill()
        }
    } else if (selectionPath.type === 'wand' || selectionPath.type === 'mask') {
        const mask = selectionPath.type === 'wand' ? selectionPath.mask : selectionPath.data
        ctx.putImageData(mask, 0, 0)
    }
}
```

**Step 2: Commit**

```bash
git add public/js/app.js
git commit -m "feat: clear source layer pixels on selection extraction"
```

---

### Task 9: Add Test for Selection Extraction

**Files:**
- Modify: `tests/move-tool.spec.js`

**Step 1: Add test**

```javascript
test('moving selection extracts pixels to new layer', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

    // Create transparent project
    await page.waitForSelector('.open-dialog-backdrop.visible')
    await page.click('.media-option[data-type="transparent"]')
    await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
    await page.click('.canvas-size-dialog .action-btn.primary')
    await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
    await page.waitForTimeout(500)

    // Add a colored layer
    await page.evaluate(async () => {
        const canvas = document.createElement('canvas')
        canvas.width = 200
        canvas.height = 200
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = 'blue'
        ctx.fillRect(0, 0, 200, 200)

        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
        const file = new File([blob], 'test.png', { type: 'image/png' })
        await window.layersApp._handleAddMediaLayer(file, 'image')
    })
    await page.waitForTimeout(500)

    const initialLayerCount = await page.evaluate(() => window.layersApp._layers.length)

    // Select the layer
    await page.evaluate(() => {
        const layers = window.layersApp._layers
        const topLayer = layers[layers.length - 1]
        window.layersApp._layerStack.selectLayer(topLayer.id)
    })

    // Create a selection
    await page.evaluate(() => {
        const sm = window.layersApp._selectionManager
        sm._selectionPath = { type: 'rect', x: 50, y: 50, width: 100, height: 100 }
        sm._startAnimation()
    })
    await page.waitForTimeout(200)

    // Activate move tool
    await page.click('#moveToolBtn')

    // Drag to trigger extraction
    const canvas = await page.$('#selectionOverlay')
    const box = await canvas.boundingBox()

    await page.mouse.move(box.x + 100, box.y + 100)
    await page.mouse.down()
    await page.mouse.move(box.x + 150, box.y + 150)
    await page.mouse.up()

    await page.waitForTimeout(500)

    // Verify new layer was created
    const finalLayerCount = await page.evaluate(() => window.layersApp._layers.length)
    expect(finalLayerCount).toBe(initialLayerCount + 1)

    // Verify the new layer is selected
    const selectedLayerName = await page.evaluate(() => {
        const layer = window.layersApp._getActiveLayer()
        return layer?.name
    })
    expect(selectedLayerName).toBe('Moved Selection')
})
```

**Step 2: Run test**

Run: `npx playwright test tests/move-tool.spec.js --headed`
Expected: PASS

**Step 3: Commit**

```bash
git add tests/move-tool.spec.js
git commit -m "test: add selection extraction test"
```

---

### Task 10: Final Integration Testing

**Step 1: Run all tests**

Run: `npx playwright test`
Expected: All tests pass

**Step 2: Manual verification**

1. Open the app
2. Create a transparent project
3. Add an image layer
4. Click the move tool button - verify it activates
5. Click and drag on the layer - verify it moves
6. Select a different selection tool - verify move tool deactivates
7. Create a selection with the marquee tool
8. Activate move tool
9. Drag the selection - verify it extracts to a new layer and leaves a hole

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete move tool implementation"
```

---

## Summary of Changes

1. **HTML**: Added move tool button before selection menu
2. **CSS**: Added move cursor and active button styles
3. **MoveTool class**: New class handling move interactions
4. **App integration**: MoveTool initialization, helper methods, tool switching
5. **Layer model**: Added offsetX/offsetY properties
6. **Tests**: Button activation, layer movement, selection extraction

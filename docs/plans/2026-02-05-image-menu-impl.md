# Image Menu Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an Image menu (crop, image size, canvas size) and remove the filename display from the menu bar.

**Architecture:** Three independent features behind one new dropdown menu. Crop uses existing selection bounds. Image Size creates a new dialog. Canvas Size extends the existing dialog with an anchor grid. All operations iterate over the layer array, modifying media layers via offscreen canvas and effect layers via offset adjustment.

**Tech Stack:** Vanilla JS, HTML `<dialog>`, CSS, Playwright E2E tests.

---

### Task 1: Remove filename display from menu bar

**Files:**
- Modify: `public/index.html:119-121`
- Modify: `public/css/menu.css:62,113-132`
- Modify: `public/js/app.js` (lines 268, 362, 754-759, 2340, 2391)

**Step 1: Remove filename HTML**

In `public/index.html`, delete lines 119-121:
```html
            <div id="menuCenter">
                <span id="menuFilename">untitled</span>
            </div>
```

**Step 2: Simplify menu grid CSS**

In `public/css/menu.css`, change the `#menu` grid from 3 columns to 2:
```css
/* Was: grid-template-columns: auto 1fr auto; */
grid-template-columns: 1fr auto;
```

Remove the `#menuCenter` and `#menuFilename` rule blocks (lines 113-132).

Update `#menuRight` to use `grid-column: 2` instead of `grid-column: 3`.

**Step 3: Remove `_updateFilename` from app.js**

Delete the `_updateFilename` method (lines 754-759) and all calls to it:
- Line 268: `this._updateFilename('untitled')` — delete
- Line 362: `this._updateFilename(file.name)` — delete
- Line 2340: `this._updateFilename(projectName)` — delete
- Line 2391: `this._updateFilename(project.name)` — delete

**Step 4: Verify app loads**

Run: `npx playwright test tests/flatten-image.spec.js`
Expected: PASS (existing test still works without filename)

**Step 5: Commit**

```bash
git add public/index.html public/css/menu.css public/js/app.js
git commit -m "feat: remove filename display from menu bar"
```

---

### Task 2: Add Image menu dropdown to HTML and wire handlers

**Files:**
- Modify: `public/index.html` (after File menu, before Layer menu)
- Modify: `public/js/app.js` (`_setupMenuHandlers`)

**Step 1: Add Image menu HTML**

In `public/index.html`, insert between the File menu (line 90) and the Layer menu (line 92):

```html
                <!-- Image Menu -->
                <div class="menu" id="imageMenu">
                    <div class="menu-title">image</div>
                    <div class="menu-items hide">
                        <div id="cropToSelectionMenuItem" class="disabled">crop to selection</div>
                        <hr class="menu-seperator">
                        <div id="imageSizeMenuItem">image size...</div>
                        <div id="canvasSizeMenuItem">canvas size...</div>
                    </div>
                </div>
```

**Step 2: Add menu handlers in app.js**

In `_setupMenuHandlers()`, after the File menu handlers (around line 1010), add:

```javascript
        // Image menu - Crop to selection
        document.getElementById('cropToSelectionMenuItem')?.addEventListener('click', async () => {
            await this._cropToSelection()
        })

        // Image menu - Image size
        document.getElementById('imageSizeMenuItem')?.addEventListener('click', () => {
            this._showImageSizeDialog()
        })

        // Image menu - Canvas size
        document.getElementById('canvasSizeMenuItem')?.addEventListener('click', () => {
            this._showCanvasSizeDialog()
        })
```

**Step 3: Add `_updateImageMenu` method**

Add a method that enables/disables the crop menu item based on selection state. Call it from `_setupMenuHandlers` and wherever selection changes (the selection manager's `onSelectionChange` callback):

```javascript
    _updateImageMenu() {
        const cropItem = document.getElementById('cropToSelectionMenuItem')
        if (!cropItem) return
        const hasSelection = this._selectionManager?.hasSelection
        cropItem.classList.toggle('disabled', !hasSelection)
    }
```

Wire into the selection change callback (find where `onSelectionChange` is set in app.js and add `this._updateImageMenu()` call).

**Step 4: Add stub methods**

Add empty stubs so the app doesn't crash:

```javascript
    async _cropToSelection() {
        // TODO: Task 3
    }

    _showImageSizeDialog() {
        // TODO: Task 4
    }

    _showCanvasSizeDialog() {
        // TODO: Task 5
    }
```

**Step 5: Verify app loads and menu appears**

Run: `npx playwright test tests/flatten-image.spec.js`
Expected: PASS

**Step 6: Commit**

```bash
git add public/index.html public/js/app.js
git commit -m "feat: add Image menu dropdown with stub handlers"
```

---

### Task 3: Implement crop to selection

**Files:**
- Modify: `public/js/app.js` (replace `_cropToSelection` stub)
- Create: `tests/crop-to-selection.spec.js`

**Step 1: Write the E2E test**

Create `tests/crop-to-selection.spec.js`:

```javascript
import { test, expect } from 'playwright/test'

test.describe('Image menu - Crop to Selection', () => {
    test('crop to selection resizes canvas to selection bounds', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        // Create a solid base layer (1024x1024)
        await page.waitForSelector('.open-dialog-backdrop.visible')
        await page.click('.media-option[data-type="solid"]')
        await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
        await page.click('.canvas-size-dialog .action-btn.primary')
        await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
        await page.waitForTimeout(500)

        // Programmatically set a rectangular selection (100,100 to 612,612 = 512x512)
        await page.evaluate(() => {
            window.layersApp._selectionManager._selectionPath = {
                type: 'rect', x: 100, y: 100, width: 512, height: 512
            }
            window.layersApp._selectionManager._renderSelection()
        })
        await page.waitForTimeout(200)

        // Crop to selection
        await page.evaluate(async () => {
            await window.layersApp._cropToSelection()
        })
        await page.waitForTimeout(500)

        // Verify canvas is now 512x512
        const dims = await page.evaluate(() => ({
            w: window.layersApp._canvas.width,
            h: window.layersApp._canvas.height
        }))
        expect(dims.w).toBe(512)
        expect(dims.h).toBe(512)

        // Verify selection was cleared
        const hasSelection = await page.evaluate(() =>
            window.layersApp._selectionManager.hasSelection
        )
        expect(hasSelection).toBe(false)
    })
})
```

**Step 2: Run test to verify it fails**

Run: `npx playwright test tests/crop-to-selection.spec.js`
Expected: FAIL (stub is empty)

**Step 3: Implement `_cropToSelection`**

Replace the stub in `public/js/app.js`:

```javascript
    async _cropToSelection() {
        if (!this._selectionManager?.hasSelection) return

        const selectionPath = this._selectionManager.selectionPath
        const bounds = getSelectionBounds(selectionPath)
        if (bounds.width <= 0 || bounds.height <= 0) return

        const oldWidth = this._canvas.width
        const oldHeight = this._canvas.height

        // Crop each media layer
        for (const layer of this._layers) {
            if (layer.sourceType === 'media') {
                await this._cropMediaLayer(layer, bounds)
            } else {
                // Effect layers: shift offsets
                layer.offsetX = (layer.offsetX || 0) - bounds.x
                layer.offsetY = (layer.offsetY || 0) - bounds.y
            }
        }

        // Resize canvas
        this._resizeCanvas(bounds.width, bounds.height)

        // Clear selection
        this._selectionManager.clearSelection()

        // Re-render
        await this._rebuild()
        this._markDirty()

        toast.success('Cropped to selection')
    }

    async _cropMediaLayer(layer, bounds) {
        const media = this._renderer._mediaTextures.get(layer.id)
        if (!media || !media.element) return

        // Calculate the source region accounting for layer offset
        const ox = layer.offsetX || 0
        const oy = layer.offsetY || 0

        const offscreen = new OffscreenCanvas(bounds.width, bounds.height)
        const ctx = offscreen.getContext('2d')
        ctx.drawImage(
            media.element,
            bounds.x - ox, bounds.y - oy, bounds.width, bounds.height,
            0, 0, bounds.width, bounds.height
        )

        const blob = await offscreen.convertToBlob({ type: 'image/png' })
        const file = new File([blob], 'cropped.png', { type: 'image/png' })

        // Replace media
        this._renderer.unloadMedia(layer.id)
        await this._renderer.loadMedia(layer.id, file, 'image')

        // Update layer
        layer.mediaFile = file
        layer.mediaType = 'image'
        layer.offsetX = 0
        layer.offsetY = 0
    }
```

**Step 4: Run test to verify it passes**

Run: `npx playwright test tests/crop-to-selection.spec.js`
Expected: PASS

**Step 5: Commit**

```bash
git add public/js/app.js tests/crop-to-selection.spec.js
git commit -m "feat: implement crop to selection"
```

---

### Task 4: Image Size dialog and resize logic

**Files:**
- Create: `public/js/ui/image-size-dialog.js`
- Modify: `public/js/app.js` (import dialog, replace `_showImageSizeDialog` stub, add `_resizeImage`)
- Create: `tests/image-size.spec.js`

**Step 1: Write the E2E test**

Create `tests/image-size.spec.js`:

```javascript
import { test, expect } from 'playwright/test'

test.describe('Image menu - Image Size', () => {
    test('resize image scales canvas and layers', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        // Create a solid base layer (1024x1024)
        await page.waitForSelector('.open-dialog-backdrop.visible')
        await page.click('.media-option[data-type="solid"]')
        await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
        await page.click('.canvas-size-dialog .action-btn.primary')
        await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
        await page.waitForTimeout(500)

        // Resize to 512x512 via direct method
        await page.evaluate(async () => {
            await window.layersApp._resizeImage(512, 512)
        })
        await page.waitForTimeout(500)

        // Verify canvas is 512x512
        const dims = await page.evaluate(() => ({
            w: window.layersApp._canvas.width,
            h: window.layersApp._canvas.height
        }))
        expect(dims.w).toBe(512)
        expect(dims.h).toBe(512)
    })
})
```

**Step 2: Run test to verify it fails**

Run: `npx playwright test tests/image-size.spec.js`
Expected: FAIL

**Step 3: Create the Image Size dialog**

Create `public/js/ui/image-size-dialog.js`. Follow the same class pattern as `canvas-size-dialog.js`:

```javascript
/**
 * Image Size Dialog
 * Resize image with optional constrained proportions
 *
 * @module ui/image-size-dialog
 */

const MIN_SIZE = 64
const MAX_SIZE = 2048

class ImageSizeDialog {
    constructor() {
        this._dialog = null
        this._onConfirm = null
        this._originalWidth = 0
        this._originalHeight = 0
        this._constrain = true
    }

    show(options = {}) {
        this._onConfirm = options.onConfirm
        this._originalWidth = options.width || 1024
        this._originalHeight = options.height || 1024

        if (!this._dialog) {
            this._createDialog()
        }

        this._constrain = true
        this._dialog.querySelector('#image-size-constrain').checked = true
        this._setInputValue('image-width', this._originalWidth)
        this._setInputValue('image-height', this._originalHeight)
        this._clearErrors()

        this._dialog.showModal()
    }

    hide() {
        if (this._dialog) this._dialog.close()
    }

    _createDialog() {
        this._dialog = document.createElement('dialog')
        this._dialog.className = 'image-size-dialog'
        this._dialog.innerHTML = `
            <div class="dialog-header">
                <h2>Image Size</h2>
                <button class="dialog-close" aria-label="Close">
                    <span class="icon-material">close</span>
                </button>
            </div>
            <div class="dialog-body">
                <div class="size-inputs">
                    <div class="form-field">
                        <label for="image-width">Width</label>
                        <div class="input-with-unit">
                            <input type="number" id="image-width"
                                min="${MIN_SIZE}" max="${MAX_SIZE}" step="1">
                            <span class="input-unit">px</span>
                        </div>
                        <div class="form-error" id="image-width-error"></div>
                    </div>

                    <span class="size-separator">x</span>

                    <div class="form-field">
                        <label for="image-height">Height</label>
                        <div class="input-with-unit">
                            <input type="number" id="image-height"
                                min="${MIN_SIZE}" max="${MAX_SIZE}" step="1">
                            <span class="input-unit">px</span>
                        </div>
                        <div class="form-error" id="image-height-error"></div>
                    </div>
                </div>

                <div class="constrain-row">
                    <label>
                        <input type="checkbox" id="image-size-constrain" checked>
                        Constrain proportions
                    </label>
                </div>

                <div class="size-limits">
                    Min: ${MIN_SIZE}px | Max: ${MAX_SIZE}px
                </div>
            </div>
            <div class="dialog-actions">
                <button class="action-btn" id="image-size-cancel">Cancel</button>
                <button class="action-btn primary" id="image-size-ok">OK</button>
            </div>
        `

        document.body.appendChild(this._dialog)
        this._setupEventListeners()
    }

    _setupEventListeners() {
        this._dialog.querySelector('.dialog-close').addEventListener('click', () => this.hide())
        this._dialog.querySelector('#image-size-cancel').addEventListener('click', () => this.hide())
        this._dialog.querySelector('#image-size-ok').addEventListener('click', () => this._handleConfirm())

        this._dialog.querySelector('#image-size-constrain').addEventListener('change', (e) => {
            this._constrain = e.target.checked
        })

        const widthInput = this._dialog.querySelector('#image-width')
        const heightInput = this._dialog.querySelector('#image-height')

        widthInput.addEventListener('input', () => {
            this._validateInput('width')
            if (this._constrain) {
                const w = parseInt(widthInput.value, 10)
                if (!isNaN(w) && w > 0) {
                    const ratio = this._originalHeight / this._originalWidth
                    this._setInputValue('image-height', Math.round(w * ratio))
                }
            }
        })

        heightInput.addEventListener('input', () => {
            this._validateInput('height')
            if (this._constrain) {
                const h = parseInt(heightInput.value, 10)
                if (!isNaN(h) && h > 0) {
                    const ratio = this._originalWidth / this._originalHeight
                    this._setInputValue('image-width', Math.round(h * ratio))
                }
            }
        })

        this._dialog.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                this._handleConfirm()
            }
        })
    }

    _handleConfirm() {
        const w = this._getInputValue('image-width')
        const h = this._getInputValue('image-height')
        if (!this._validateInput('width') || !this._validateInput('height')) return
        if (this._onConfirm) this._onConfirm(w, h)
        this.hide()
    }

    _validateInput(field) {
        const inputId = field === 'width' ? 'image-width' : 'image-height'
        const errorId = `image-${field}-error`
        const value = this._getInputValue(inputId)
        const errorEl = this._dialog.querySelector(`#${errorId}`)
        if (isNaN(value) || value < MIN_SIZE) {
            errorEl.textContent = `Minimum ${MIN_SIZE}px`
            return false
        }
        if (value > MAX_SIZE) {
            errorEl.textContent = `Maximum ${MAX_SIZE}px`
            return false
        }
        errorEl.textContent = ''
        return true
    }

    _clearErrors() {
        this._dialog.querySelector('#image-width-error').textContent = ''
        this._dialog.querySelector('#image-height-error').textContent = ''
    }

    _getInputValue(id) {
        return parseInt(this._dialog.querySelector(`#${id}`).value, 10)
    }

    _setInputValue(id, value) {
        const input = this._dialog.querySelector(`#${id}`)
        if (input) input.value = value
    }
}

export const imageSizeDialog = new ImageSizeDialog()
```

**Step 4: Wire dialog and implement `_resizeImage` in app.js**

Add import at top of `app.js`:
```javascript
import { imageSizeDialog } from './ui/image-size-dialog.js'
```

Replace the `_showImageSizeDialog` stub:
```javascript
    _showImageSizeDialog() {
        imageSizeDialog.show({
            width: this._canvas.width,
            height: this._canvas.height,
            onConfirm: async (width, height) => {
                await this._resizeImage(width, height)
            }
        })
    }
```

Add `_resizeImage`:
```javascript
    async _resizeImage(newWidth, newHeight) {
        const oldWidth = this._canvas.width
        const oldHeight = this._canvas.height
        if (newWidth === oldWidth && newHeight === oldHeight) return

        const scaleX = newWidth / oldWidth
        const scaleY = newHeight / oldHeight

        // Resize each media layer
        for (const layer of this._layers) {
            if (layer.sourceType === 'media') {
                await this._resampleMediaLayer(layer, scaleX, scaleY, newWidth, newHeight)
            } else {
                layer.offsetX = Math.round((layer.offsetX || 0) * scaleX)
                layer.offsetY = Math.round((layer.offsetY || 0) * scaleY)
            }
        }

        this._resizeCanvas(newWidth, newHeight)
        await this._rebuild()
        this._markDirty()

        toast.success(`Resized to ${newWidth} x ${newHeight}`)
    }

    async _resampleMediaLayer(layer, scaleX, scaleY, newWidth, newHeight) {
        const media = this._renderer._mediaTextures.get(layer.id)
        if (!media || !media.element) return

        const srcW = media.width
        const srcH = media.height
        const dstW = Math.round(srcW * scaleX)
        const dstH = Math.round(srcH * scaleY)

        const offscreen = new OffscreenCanvas(dstW, dstH)
        const ctx = offscreen.getContext('2d')
        ctx.drawImage(media.element, 0, 0, srcW, srcH, 0, 0, dstW, dstH)

        const blob = await offscreen.convertToBlob({ type: 'image/png' })
        const file = new File([blob], 'resized.png', { type: 'image/png' })

        this._renderer.unloadMedia(layer.id)
        await this._renderer.loadMedia(layer.id, file, 'image')

        layer.mediaFile = file
        layer.mediaType = 'image'
        layer.offsetX = Math.round((layer.offsetX || 0) * scaleX)
        layer.offsetY = Math.round((layer.offsetY || 0) * scaleY)
    }
```

**Step 5: Run test to verify it passes**

Run: `npx playwright test tests/image-size.spec.js`
Expected: PASS

**Step 6: Commit**

```bash
git add public/js/ui/image-size-dialog.js public/js/app.js tests/image-size.spec.js
git commit -m "feat: image size dialog with constrained proportions"
```

---

### Task 5: Canvas Size dialog with anchor grid

**Files:**
- Modify: `public/js/app.js` (replace `_showCanvasSizeDialog` stub, add `_changeCanvasSize`)
- Create: `public/js/ui/canvas-resize-dialog.js` (new dialog — keep existing `canvas-size-dialog.js` for the startup flow)
- Create: `tests/canvas-size.spec.js`

**Step 1: Write the E2E test**

Create `tests/canvas-size.spec.js`:

```javascript
import { test, expect } from 'playwright/test'

test.describe('Image menu - Canvas Size', () => {
    test('canvas size changes dimensions with anchor offset', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        // Create a solid base layer (1024x1024)
        await page.waitForSelector('.open-dialog-backdrop.visible')
        await page.click('.media-option[data-type="solid"]')
        await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
        await page.click('.canvas-size-dialog .action-btn.primary')
        await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
        await page.waitForTimeout(500)

        // Change canvas size to 2048x2048 with center anchor
        await page.evaluate(async () => {
            await window.layersApp._changeCanvasSize(2048, 2048, 'center')
        })
        await page.waitForTimeout(500)

        // Verify canvas is 2048x2048
        const dims = await page.evaluate(() => ({
            w: window.layersApp._canvas.width,
            h: window.layersApp._canvas.height
        }))
        expect(dims.w).toBe(2048)
        expect(dims.h).toBe(2048)

        // Verify the media layer offset is (512, 512) — centered in the larger canvas
        const offset = await page.evaluate(() => ({
            x: window.layersApp._layers[0].offsetX,
            y: window.layersApp._layers[0].offsetY
        }))
        expect(offset.x).toBe(512)
        expect(offset.y).toBe(512)
    })
})
```

**Step 2: Run test to verify it fails**

Run: `npx playwright test tests/canvas-size.spec.js`
Expected: FAIL

**Step 3: Create the Canvas Resize dialog**

Create `public/js/ui/canvas-resize-dialog.js`. This is a separate dialog from the startup canvas-size-dialog — it has an anchor grid and pre-fills with current canvas dimensions:

```javascript
/**
 * Canvas Resize Dialog
 * Change canvas dimensions with anchor position control
 *
 * @module ui/canvas-resize-dialog
 */

const MIN_SIZE = 64
const MAX_SIZE = 2048

const ANCHORS = [
    'top-left', 'top-center', 'top-right',
    'middle-left', 'center', 'middle-right',
    'bottom-left', 'bottom-center', 'bottom-right'
]

class CanvasResizeDialog {
    constructor() {
        this._dialog = null
        this._onConfirm = null
        this._anchor = 'center'
    }

    show(options = {}) {
        this._onConfirm = options.onConfirm
        this._anchor = 'center'

        if (!this._dialog) {
            this._createDialog()
        }

        this._setInputValue('canvas-resize-width', options.width || 1024)
        this._setInputValue('canvas-resize-height', options.height || 1024)
        this._clearErrors()
        this._updateAnchorGrid()

        this._dialog.showModal()
    }

    hide() {
        if (this._dialog) this._dialog.close()
    }

    _createDialog() {
        this._dialog = document.createElement('dialog')
        this._dialog.className = 'canvas-resize-dialog'
        this._dialog.innerHTML = `
            <div class="dialog-header">
                <h2>Canvas Size</h2>
                <button class="dialog-close" aria-label="Close">
                    <span class="icon-material">close</span>
                </button>
            </div>
            <div class="dialog-body">
                <div class="size-inputs">
                    <div class="form-field">
                        <label for="canvas-resize-width">Width</label>
                        <div class="input-with-unit">
                            <input type="number" id="canvas-resize-width"
                                min="${MIN_SIZE}" max="${MAX_SIZE}" step="1">
                            <span class="input-unit">px</span>
                        </div>
                        <div class="form-error" id="canvas-resize-width-error"></div>
                    </div>

                    <span class="size-separator">x</span>

                    <div class="form-field">
                        <label for="canvas-resize-height">Height</label>
                        <div class="input-with-unit">
                            <input type="number" id="canvas-resize-height"
                                min="${MIN_SIZE}" max="${MAX_SIZE}" step="1">
                            <span class="input-unit">px</span>
                        </div>
                        <div class="form-error" id="canvas-resize-height-error"></div>
                    </div>
                </div>

                <div class="anchor-section">
                    <label>Anchor</label>
                    <div class="anchor-grid">
                        ${ANCHORS.map(a => `<button class="anchor-btn${a === 'center' ? ' active' : ''}" data-anchor="${a}" title="${a}">
                            <span class="anchor-dot"></span>
                        </button>`).join('')}
                    </div>
                </div>

                <div class="size-limits">
                    Min: ${MIN_SIZE}px | Max: ${MAX_SIZE}px
                </div>
            </div>
            <div class="dialog-actions">
                <button class="action-btn" id="canvas-resize-cancel">Cancel</button>
                <button class="action-btn primary" id="canvas-resize-ok">OK</button>
            </div>
        `

        document.body.appendChild(this._dialog)
        this._setupEventListeners()
    }

    _setupEventListeners() {
        this._dialog.querySelector('.dialog-close').addEventListener('click', () => this.hide())
        this._dialog.querySelector('#canvas-resize-cancel').addEventListener('click', () => this.hide())
        this._dialog.querySelector('#canvas-resize-ok').addEventListener('click', () => this._handleConfirm())

        this._dialog.querySelectorAll('.anchor-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this._anchor = btn.dataset.anchor
                this._updateAnchorGrid()
            })
        })

        this._dialog.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                this._handleConfirm()
            }
        })
    }

    _updateAnchorGrid() {
        this._dialog.querySelectorAll('.anchor-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.anchor === this._anchor)
        })
    }

    _handleConfirm() {
        const w = this._getInputValue('canvas-resize-width')
        const h = this._getInputValue('canvas-resize-height')
        if (!this._validateInput('width') || !this._validateInput('height')) return
        if (this._onConfirm) this._onConfirm(w, h, this._anchor)
        this.hide()
    }

    _validateInput(field) {
        const inputId = field === 'width' ? 'canvas-resize-width' : 'canvas-resize-height'
        const errorId = `canvas-resize-${field}-error`
        const value = this._getInputValue(inputId)
        const errorEl = this._dialog.querySelector(`#${errorId}`)
        if (isNaN(value) || value < MIN_SIZE) {
            errorEl.textContent = `Minimum ${MIN_SIZE}px`
            return false
        }
        if (value > MAX_SIZE) {
            errorEl.textContent = `Maximum ${MAX_SIZE}px`
            return false
        }
        errorEl.textContent = ''
        return true
    }

    _clearErrors() {
        this._dialog.querySelector('#canvas-resize-width-error').textContent = ''
        this._dialog.querySelector('#canvas-resize-height-error').textContent = ''
    }

    _getInputValue(id) {
        return parseInt(this._dialog.querySelector(`#${id}`).value, 10)
    }

    _setInputValue(id, value) {
        const input = this._dialog.querySelector(`#${id}`)
        if (input) input.value = value
    }
}

export const canvasResizeDialog = new CanvasResizeDialog()
```

**Step 4: Add anchor grid CSS**

Add to `public/css/components.css`:

```css
/* Anchor grid for canvas resize */
.anchor-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
    width: 72px;
    margin: 0.5em auto;
}

.anchor-btn {
    width: 20px;
    height: 20px;
    border: 1px solid var(--color-border);
    border-radius: 2px;
    background: transparent;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
}

.anchor-btn .anchor-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-text-muted);
}

.anchor-btn.active .anchor-dot {
    background: var(--color-text-primary);
}

.anchor-btn:hover {
    border-color: var(--color-text-muted);
}

.anchor-section {
    text-align: center;
    margin: 1em 0;
}

.anchor-section label {
    display: block;
    margin-bottom: 0.5em;
    font-size: 0.875rem;
    color: var(--color-text-muted);
}

.constrain-row {
    margin: 0.75em 0;
    font-size: 0.875rem;
    color: var(--color-text-muted);
}

.constrain-row label {
    display: flex;
    align-items: center;
    gap: 0.5em;
    cursor: pointer;
}
```

**Step 5: Wire dialog and implement `_changeCanvasSize` in app.js**

Add import at top:
```javascript
import { canvasResizeDialog } from './ui/canvas-resize-dialog.js'
```

Replace `_showCanvasSizeDialog` stub:
```javascript
    _showCanvasSizeDialog() {
        canvasResizeDialog.show({
            width: this._canvas.width,
            height: this._canvas.height,
            onConfirm: async (width, height, anchor) => {
                await this._changeCanvasSize(width, height, anchor)
            }
        })
    }
```

Add `_changeCanvasSize`:
```javascript
    async _changeCanvasSize(newWidth, newHeight, anchor = 'center') {
        const oldWidth = this._canvas.width
        const oldHeight = this._canvas.height
        if (newWidth === oldWidth && newHeight === oldHeight) return

        const deltaW = newWidth - oldWidth
        const deltaH = newHeight - oldHeight

        // Calculate offset based on anchor
        let shiftX = 0, shiftY = 0
        if (anchor.includes('center') || anchor.includes('middle')) {
            // horizontal
            if (!anchor.includes('left') && !anchor.includes('right')) shiftX = Math.round(deltaW / 2)
        }
        if (anchor.includes('right')) shiftX = deltaW
        if (anchor.includes('center') && !anchor.includes('left') && !anchor.includes('right')) {
            // already set above
        }
        if (anchor.includes('middle') || (anchor === 'center')) {
            shiftY = Math.round(deltaH / 2)
        }
        if (anchor.includes('bottom')) shiftY = deltaH

        // Adjust all layer offsets
        for (const layer of this._layers) {
            layer.offsetX = (layer.offsetX || 0) + shiftX
            layer.offsetY = (layer.offsetY || 0) + shiftY
        }

        this._resizeCanvas(newWidth, newHeight)
        await this._rebuild()
        this._markDirty()

        toast.success(`Canvas resized to ${newWidth} x ${newHeight}`)
    }
```

**Step 6: Run test to verify it passes**

Run: `npx playwright test tests/canvas-size.spec.js`
Expected: PASS

**Step 7: Commit**

```bash
git add public/js/ui/canvas-resize-dialog.js public/js/app.js public/css/components.css tests/canvas-size.spec.js
git commit -m "feat: canvas size dialog with anchor grid"
```

---

### Task 6: Run all tests and verify

**Step 1: Run full test suite**

Run: `npx playwright test`
Expected: All tests PASS

**Step 2: Fix any failures**

Address any test failures from the menu structure changes.

**Step 3: Final commit (if fixes needed)**

```bash
git add -A
git commit -m "fix: test fixes for image menu changes"
```

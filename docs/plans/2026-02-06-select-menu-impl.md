# Select Menu Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Select menu with All, None, Inverse, Color Range, Border, Smooth, Expand, Contract, and Feather operations.

**Architecture:** Pure-function mask modification module (`selection-modify.js`) with Meijster EDT for expand/contract/border/feather. A reusable parameter dialog (`selection-param-dialog.js`) prompts for pixel radius. Menu HTML between Layer and View, wired in `app.js`. Color Range uses eyedropper click on canvas with wand tolerance.

**Tech Stack:** Vanilla JS, Canvas ImageData, native `<dialog>`, Playwright tests.

---

### Task 1: Create `selection-modify.js` — distance field + mask operations

**Files:**
- Create: `public/js/selection/selection-modify.js`

**Step 1: Write the module with all pure functions**

```javascript
/**
 * Selection Modify
 * Pure functions for mask modification operations
 *
 * @module selection/selection-modify
 */

/**
 * Invert a selection mask — flip alpha channel.
 * @param {ImageData} mask
 * @returns {ImageData}
 */
export function invertMask(mask) {
    const { width, height, data } = mask
    const result = new Uint8ClampedArray(data.length)
    for (let i = 0; i < data.length; i += 4) {
        const val = data[i + 3] > 127 ? 0 : 255
        result[i] = val
        result[i + 1] = val
        result[i + 2] = val
        result[i + 3] = val
    }
    return new ImageData(result, width, height)
}

/**
 * Compute Euclidean distance transform using Meijster's algorithm.
 * Returns Float32Array where each element is the distance to the nearest
 * "background" pixel (where predicate returns false).
 *
 * @param {Uint8ClampedArray} data - RGBA pixel data
 * @param {number} width
 * @param {number} height
 * @param {function(number): boolean} predicate - Given alpha index, returns true if "foreground"
 * @returns {Float32Array} Distance for each pixel
 */
function computeDistanceTransform(data, width, height, predicate) {
    const INF = width + height
    const g = new Float32Array(width * height)

    // Phase 1: column scan
    for (let x = 0; x < width; x++) {
        // Forward pass
        g[x] = predicate((x) * 4 + 3) ? 0 : INF
        for (let y = 1; y < height; y++) {
            const idx = y * width + x
            g[idx] = predicate(idx * 4 + 3) ? 0 : g[(y - 1) * width + x] + 1
        }
        // Backward pass
        for (let y = height - 2; y >= 0; y--) {
            const idx = y * width + x
            const below = g[(y + 1) * width + x] + 1
            if (below < g[idx]) g[idx] = below
        }
    }

    // Phase 2: row scan with parabola envelope
    const dt = new Float32Array(width * height)
    const s = new Int32Array(width)  // parabola positions
    const t = new Float32Array(width) // boundaries
    const v = new Int32Array(width)

    for (let y = 0; y < height; y++) {
        let q = 0
        v[0] = 0
        t[0] = -INF

        for (let x = 1; x < width; x++) {
            const gx = g[y * width + x]
            while (q >= 0) {
                const vq = v[q]
                const gvq = g[y * width + vq]
                // f(x, vq) vs f(vq, vq) comparison
                if ((x - vq) * (x - vq) + gx * gx > (vq - vq) * (vq - vq) + gvq * gvq) {
                    // Compute intersection
                    const sep = ((x * x - vq * vq) + (gx * gx - gvq * gvq)) / (2 * (x - vq))
                    if (sep > t[q]) {
                        q++
                        v[q] = x
                        t[q] = sep
                        break
                    }
                }
                q--
            }
            if (q < 0) {
                q = 0
                v[0] = x
                t[0] = -INF
            }
        }

        q = v.length > 0 ? q : 0
        for (let x = width - 1; x >= 0; x--) {
            while (q > 0 && t[q] > x) q--
            const vq = v[q]
            const gvq = g[y * width + vq]
            const dx = x - vq
            dt[y * width + x] = Math.sqrt(dx * dx + gvq * gvq)
        }
    }

    return dt
}

/**
 * Compute inside and outside distance fields for a mask.
 * @param {ImageData} mask
 * @returns {{ inside: Float32Array, outside: Float32Array }}
 */
export function computeDistanceFields(mask) {
    const { width, height, data } = mask

    // Outside: distance from unselected pixels to nearest selected pixel
    // Predicate: "foreground" = selected (we want distance to foreground boundary)
    const outside = computeDistanceTransform(data, width, height,
        (alphaIdx) => data[alphaIdx] > 127)

    // Inside: distance from selected pixels to nearest unselected pixel
    const inside = computeDistanceTransform(data, width, height,
        (alphaIdx) => data[alphaIdx] <= 127)

    return { inside, outside }
}

/**
 * Expand selection by r pixels.
 * @param {ImageData} mask
 * @param {number} r - Radius in pixels
 * @returns {ImageData}
 */
export function expandMask(mask, r) {
    const { width, height } = mask
    const { outside } = computeDistanceFields(mask)
    const result = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < width * height; i++) {
        const val = outside[i] <= r ? 255 : 0
        const idx = i * 4
        result[idx] = val
        result[idx + 1] = val
        result[idx + 2] = val
        result[idx + 3] = val
    }
    return new ImageData(result, width, height)
}

/**
 * Contract selection by r pixels.
 * @param {ImageData} mask
 * @param {number} r - Radius in pixels
 * @returns {ImageData}
 */
export function contractMask(mask, r) {
    const { width, height } = mask
    const { inside } = computeDistanceFields(mask)
    const result = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < width * height; i++) {
        // A pixel stays selected only if it's far enough from the edge
        const val = (mask.data[i * 4 + 3] > 127 && inside[i] > r) ? 255 : 0
        const idx = i * 4
        result[idx] = val
        result[idx + 1] = val
        result[idx + 2] = val
        result[idx + 3] = val
    }
    return new ImageData(result, width, height)
}

/**
 * Border selection — keep only pixels within r of the selection edge (inside).
 * @param {ImageData} mask
 * @param {number} r - Border width in pixels
 * @returns {ImageData}
 */
export function borderMask(mask, r) {
    const { width, height } = mask
    const { inside } = computeDistanceFields(mask)
    const result = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < width * height; i++) {
        const val = (mask.data[i * 4 + 3] > 127 && inside[i] <= r) ? 255 : 0
        const idx = i * 4
        result[idx] = val
        result[idx + 1] = val
        result[idx + 2] = val
        result[idx + 3] = val
    }
    return new ImageData(result, width, height)
}

/**
 * Feather selection — soft alpha gradient at edges.
 * @param {ImageData} mask
 * @param {number} r - Feather radius in pixels
 * @returns {ImageData}
 */
export function featherMask(mask, r) {
    const { width, height } = mask
    const { inside, outside } = computeDistanceFields(mask)
    const result = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < width * height; i++) {
        let alpha
        if (mask.data[i * 4 + 3] > 127) {
            // Inside selection: fade out near edge
            alpha = inside[i] >= r ? 255 : Math.round(255 * (inside[i] / r))
        } else {
            // Outside selection: fade in near edge
            alpha = outside[i] >= r ? 0 : Math.round(255 * (1 - outside[i] / r))
        }
        const idx = i * 4
        result[idx] = alpha
        result[idx + 1] = alpha
        result[idx + 2] = alpha
        result[idx + 3] = alpha
    }
    return new ImageData(result, width, height)
}

/**
 * Smooth selection — box blur + re-threshold.
 * @param {ImageData} mask
 * @param {number} r - Blur radius in pixels
 * @returns {ImageData}
 */
export function smoothMask(mask, r) {
    const { width, height, data } = mask

    // Extract alpha channel as float
    let src = new Float32Array(width * height)
    for (let i = 0; i < width * height; i++) {
        src[i] = data[i * 4 + 3]
    }

    // 3-pass box blur (approximates Gaussian)
    for (let pass = 0; pass < 3; pass++) {
        const dst = new Float32Array(width * height)

        // Horizontal pass
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let sum = 0, count = 0
                for (let dx = -r; dx <= r; dx++) {
                    const nx = x + dx
                    if (nx >= 0 && nx < width) {
                        sum += src[y * width + nx]
                        count++
                    }
                }
                dst[y * width + x] = sum / count
            }
        }

        // Vertical pass
        const dst2 = new Float32Array(width * height)
        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
                let sum = 0, count = 0
                for (let dy = -r; dy <= r; dy++) {
                    const ny = y + dy
                    if (ny >= 0 && ny < height) {
                        sum += dst[ny * width + x]
                        count++
                    }
                }
                dst2[y * width + x] = sum / count
            }
        }

        src = dst2
    }

    // Re-threshold at 128
    const result = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < width * height; i++) {
        const val = src[i] > 128 ? 255 : 0
        const idx = i * 4
        result[idx] = val
        result[idx + 1] = val
        result[idx + 2] = val
        result[idx + 3] = val
    }
    return new ImageData(result, width, height)
}

/**
 * Color range selection — non-contiguous color match.
 * @param {ImageData} imageData - Source image
 * @param {number} x - Sample X coordinate
 * @param {number} y - Sample Y coordinate
 * @param {number} tolerance - Color tolerance (0-255)
 * @returns {ImageData} Selection mask
 */
export function colorRange(imageData, x, y, tolerance) {
    const { width, height, data } = imageData
    const startIdx = (y * width + x) * 4
    const targetR = data[startIdx]
    const targetG = data[startIdx + 1]
    const targetB = data[startIdx + 2]
    const targetA = data[startIdx + 3]
    const threshold = tolerance * 4

    const result = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < width * height; i++) {
        const di = i * 4
        const diff = Math.abs(data[di] - targetR) +
                     Math.abs(data[di + 1] - targetG) +
                     Math.abs(data[di + 2] - targetB) +
                     Math.abs(data[di + 3] - targetA)
        const val = diff <= threshold ? 255 : 0
        result[di] = val
        result[di + 1] = val
        result[di + 2] = val
        result[di + 3] = val
    }
    return new ImageData(result, width, height)
}
```

**Step 2: Commit**

```bash
git add public/js/selection/selection-modify.js
git commit -m "feat: add selection-modify module with distance field operations"
```

---

### Task 2: Create `selection-param-dialog.js` — reusable numeric input dialog

**Files:**
- Create: `public/js/ui/selection-param-dialog.js`

**Step 1: Write the dialog component**

```javascript
/**
 * Selection Parameter Dialog
 * Reusable dialog for selection operations that need a single numeric input
 *
 * @module ui/selection-param-dialog
 */

class SelectionParamDialog {
    constructor() {
        this._dialog = null
        this._resolve = null
    }

    /**
     * Show the dialog and return a promise with the value or null.
     * @param {Object} options
     * @param {string} options.title - Dialog title (e.g. "Expand Selection")
     * @param {string} options.label - Input label (e.g. "Radius")
     * @param {number} options.defaultValue - Default input value
     * @param {number} [options.min=1] - Minimum value
     * @param {number} [options.max=100] - Maximum value
     * @returns {Promise<number|null>}
     */
    show(options = {}) {
        const { title = 'Selection', label = 'Radius', defaultValue = 1, min = 1, max = 100 } = options

        if (!this._dialog) {
            this._createDialog()
        }

        this._dialog.querySelector('.dialog-header h2').textContent = title
        const input = this._dialog.querySelector('#selection-param-input')
        const inputLabel = this._dialog.querySelector('#selection-param-label')
        inputLabel.textContent = label
        input.min = min
        input.max = max
        input.value = defaultValue

        this._dialog.showModal()
        input.select()

        return new Promise(resolve => {
            this._resolve = resolve
        })
    }

    _createDialog() {
        this._dialog = document.createElement('dialog')
        this._dialog.className = 'selection-param-dialog'
        this._dialog.innerHTML = `
            <div class="dialog-header">
                <h2>Selection</h2>
                <button class="dialog-close" aria-label="Close">
                    <span class="icon-material">close</span>
                </button>
            </div>
            <div class="dialog-body">
                <div class="form-field">
                    <label id="selection-param-label" for="selection-param-input">Radius</label>
                    <div class="input-with-unit">
                        <input type="number" id="selection-param-input" min="1" max="100" step="1" value="1">
                        <span class="input-unit">px</span>
                    </div>
                </div>
            </div>
            <div class="dialog-actions">
                <button class="action-btn" id="selection-param-cancel">Cancel</button>
                <button class="action-btn primary" id="selection-param-ok">OK</button>
            </div>
        `

        document.body.appendChild(this._dialog)

        this._dialog.querySelector('.dialog-close').addEventListener('click', () => this._cancel())
        this._dialog.querySelector('#selection-param-cancel').addEventListener('click', () => this._cancel())
        this._dialog.querySelector('#selection-param-ok').addEventListener('click', () => this._confirm())
        this._dialog.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                this._confirm()
            }
        })
        this._dialog.addEventListener('cancel', (e) => {
            e.preventDefault()
            this._cancel()
        })
    }

    _confirm() {
        const input = this._dialog.querySelector('#selection-param-input')
        const value = parseInt(input.value, 10)
        if (isNaN(value) || value < parseInt(input.min) || value > parseInt(input.max)) return
        this._dialog.close()
        this._resolve?.(value)
        this._resolve = null
    }

    _cancel() {
        this._dialog.close()
        this._resolve?.(null)
        this._resolve = null
    }
}

export const selectionParamDialog = new SelectionParamDialog()
```

**Step 2: Add CSS for the dialog width**

In `public/css/components.css`, add at the end:

```css
/* =========================================================================
   Selection Param Dialog
   ========================================================================= */

.selection-param-dialog {
    width: 320px;
}
```

**Step 3: Commit**

```bash
git add public/js/ui/selection-param-dialog.js public/css/components.css
git commit -m "feat: add selection parameter dialog component"
```

---

### Task 3: Add Select menu HTML to `index.html`

**Files:**
- Modify: `public/index.html:120-122` (between Layer menu closing `</div>` and View menu)

**Step 1: Add the Select menu HTML**

After line 120 (`</div>` closing the Layer menu) and before line 122 (`<!-- View Menu -->`), insert:

```html

                <!-- Select Menu -->
                <div class="menu">
                    <div class="menu-title">select</div>
                    <div class="menu-items hide">
                        <div id="selectAllMenuItem">select all<span class="menu-shortcut">&#8984;A</span></div>
                        <div id="selectNoneMenuItem" class="disabled">select none<span class="menu-shortcut">&#8984;D</span></div>
                        <div id="selectInverseMenuItem" class="disabled">select inverse<span class="menu-shortcut">&#8984;&#8679;I</span></div>
                        <hr class="menu-seperator">
                        <div id="colorRangeMenuItem">color range...</div>
                        <hr class="menu-seperator">
                        <div id="borderSelectionMenuItem" class="disabled">border...</div>
                        <div id="smoothSelectionMenuItem" class="disabled">smooth...</div>
                        <div id="expandSelectionMenuItem" class="disabled">expand...</div>
                        <div id="contractSelectionMenuItem" class="disabled">contract...</div>
                        <div id="featherSelectionMenuItem" class="disabled">feather...</div>
                    </div>
                </div>
```

**Step 2: Commit**

```bash
git add public/index.html
git commit -m "feat: add Select menu HTML between Layer and View"
```

---

### Task 4: Add `setSelection()` method to `SelectionManager`

**Files:**
- Modify: `public/js/selection/selection-manager.js`

**Step 1: Add `setSelection()` method**

After the `clearSelection()` method (around line 212), add:

```javascript
    /**
     * Set the selection to a mask programmatically.
     * Used by Select menu operations.
     * @param {SelectionPath} path
     */
    setSelection(path) {
        this._selectionPath = path
        if (path) {
            this._startAnimation()
        } else {
            this._stopAnimation()
            this._clearOverlay()
        }
        this.onSelectionChange?.()
    }
```

**Step 2: Commit**

```bash
git add public/js/selection/selection-manager.js
git commit -m "feat: add setSelection method to SelectionManager"
```

---

### Task 5: Wire up Select menu handlers in `app.js`

**Files:**
- Modify: `public/js/app.js`

**Step 1: Add imports**

At the top of `app.js`, after the existing imports (after line 28), add:

```javascript
import { invertMask, expandMask, contractMask, borderMask, featherMask, smoothMask, colorRange } from './selection/selection-modify.js'
import { selectionParamDialog } from './ui/selection-param-dialog.js'
```

**Step 2: Update `onSelectionChange` callback**

Change line 266 from:
```javascript
this._selectionManager.onSelectionChange = () => this._updateImageMenu()
```
to:
```javascript
this._selectionManager.onSelectionChange = () => {
    this._updateImageMenu()
    this._updateSelectMenu()
}
```

**Step 3: Add `_updateSelectMenu()` method**

After the `_updateImageMenu()` method (around line 2564), add:

```javascript
    _updateSelectMenu() {
        const hasSelection = this._selectionManager?.hasSelection()
        const selectionItems = [
            'selectNoneMenuItem',
            'selectInverseMenuItem',
            'borderSelectionMenuItem',
            'smoothSelectionMenuItem',
            'expandSelectionMenuItem',
            'contractSelectionMenuItem',
            'featherSelectionMenuItem'
        ]
        for (const id of selectionItems) {
            document.getElementById(id)?.classList.toggle('disabled', !hasSelection)
        }
    }
```

**Step 4: Add `_rasterizeCurrentSelection()` helper**

Near `_updateSelectMenu()`, add:

```javascript
    _rasterizeCurrentSelection() {
        const sel = this._selectionManager
        if (!sel.hasSelection()) return null
        const path = sel.selectionPath
        if (path.type === 'wand') return path.mask
        if (path.type === 'mask') return path.data
        // Geometric selection — rasterize via SelectionManager's private method
        // We use the same approach: draw to offscreen canvas
        const { width, height } = this._canvas
        const offscreen = new OffscreenCanvas(width, height)
        const ctx = offscreen.getContext('2d')
        ctx.fillStyle = 'white'
        if (path.type === 'rect') {
            ctx.fillRect(path.x, path.y, path.width, path.height)
        } else if (path.type === 'oval') {
            ctx.beginPath()
            ctx.ellipse(path.cx, path.cy, path.rx, path.ry, 0, 0, Math.PI * 2)
            ctx.fill()
        } else if (path.type === 'lasso' || path.type === 'polygon') {
            if (path.points.length >= 3) {
                ctx.beginPath()
                ctx.moveTo(path.points[0].x, path.points[0].y)
                for (let i = 1; i < path.points.length; i++) {
                    ctx.lineTo(path.points[i].x, path.points[i].y)
                }
                ctx.closePath()
                ctx.fill()
            }
        }
        return ctx.getImageData(0, 0, width, height)
    }
```

**Step 5: Add Select menu handlers in `_setupMenuHandlers()`**

After the Image menu handlers (around line 1203), add:

```javascript
        // Select menu - Select All
        document.getElementById('selectAllMenuItem')?.addEventListener('click', () => {
            const { width, height } = this._canvas
            this._selectionManager.setSelection({
                type: 'rect', x: 0, y: 0, width, height
            })
        })

        // Select menu - Select None
        document.getElementById('selectNoneMenuItem')?.addEventListener('click', () => {
            this._selectionManager.clearSelection()
        })

        // Select menu - Select Inverse
        document.getElementById('selectInverseMenuItem')?.addEventListener('click', () => {
            const mask = this._rasterizeCurrentSelection()
            if (!mask) return
            const inverted = invertMask(mask)
            this._selectionManager.setSelection({ type: 'mask', data: inverted })
        })

        // Select menu - Color Range
        document.getElementById('colorRangeMenuItem')?.addEventListener('click', () => {
            this._startColorRangePick()
        })

        // Select menu - Border
        document.getElementById('borderSelectionMenuItem')?.addEventListener('click', async () => {
            const r = await selectionParamDialog.show({
                title: 'Border Selection', label: 'Width', defaultValue: 1
            })
            if (r === null) return
            const mask = this._rasterizeCurrentSelection()
            if (!mask) return
            this._selectionManager.setSelection({ type: 'mask', data: borderMask(mask, r) })
        })

        // Select menu - Smooth
        document.getElementById('smoothSelectionMenuItem')?.addEventListener('click', async () => {
            const r = await selectionParamDialog.show({
                title: 'Smooth Selection', label: 'Radius', defaultValue: 2
            })
            if (r === null) return
            const mask = this._rasterizeCurrentSelection()
            if (!mask) return
            this._selectionManager.setSelection({ type: 'mask', data: smoothMask(mask, r) })
        })

        // Select menu - Expand
        document.getElementById('expandSelectionMenuItem')?.addEventListener('click', async () => {
            const r = await selectionParamDialog.show({
                title: 'Expand Selection', label: 'Radius', defaultValue: 1
            })
            if (r === null) return
            const mask = this._rasterizeCurrentSelection()
            if (!mask) return
            this._selectionManager.setSelection({ type: 'mask', data: expandMask(mask, r) })
        })

        // Select menu - Contract
        document.getElementById('contractSelectionMenuItem')?.addEventListener('click', async () => {
            const r = await selectionParamDialog.show({
                title: 'Contract Selection', label: 'Radius', defaultValue: 1
            })
            if (r === null) return
            const mask = this._rasterizeCurrentSelection()
            if (!mask) return
            this._selectionManager.setSelection({ type: 'mask', data: contractMask(mask, r) })
        })

        // Select menu - Feather
        document.getElementById('featherSelectionMenuItem')?.addEventListener('click', async () => {
            const r = await selectionParamDialog.show({
                title: 'Feather Selection', label: 'Radius', defaultValue: 2
            })
            if (r === null) return
            const mask = this._rasterizeCurrentSelection()
            if (!mask) return
            this._selectionManager.setSelection({ type: 'mask', data: featherMask(mask, r) })
        })
```

**Step 6: Add keyboard shortcuts for Cmd+A and Shift+Cmd+I**

In the keydown handler (around line 1551, after the Cmd+Shift+Z redo handler and before Cmd+Z undo), add:

```javascript
            // Cmd/Ctrl+Shift+I - inverse selection
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'i' || e.key === 'I')) {
                e.preventDefault()
                if (this._selectionManager?.hasSelection()) {
                    const mask = this._rasterizeCurrentSelection()
                    if (mask) {
                        this._selectionManager.setSelection({ type: 'mask', data: invertMask(mask) })
                    }
                }
                return
            }

            // Cmd/Ctrl+A - select all
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'a' || e.key === 'A')) {
                e.preventDefault()
                const { width, height } = this._canvas
                this._selectionManager.setSelection({
                    type: 'rect', x: 0, y: 0, width, height
                })
                return
            }
```

Note: The existing Cmd+D handler (line 1623-1629) already calls `clearSelection()` — no change needed there.

**Step 7: Commit**

```bash
git add public/js/app.js
git commit -m "feat: wire up Select menu handlers and keyboard shortcuts"
```

---

### Task 6: Add Color Range eyedropper mode

**Files:**
- Modify: `public/js/app.js`

**Step 1: Add `_startColorRangePick()` and `_handleColorRangePick()` methods**

Near the other Select menu helpers, add:

```javascript
    _startColorRangePick() {
        if (!this._canvas) return
        this._colorRangePicking = true
        this._selectionOverlay.style.cursor = 'crosshair'

        const handler = (e) => {
            this._selectionOverlay.removeEventListener('click', handler)
            this._colorRangePicking = false
            this._selectionOverlay.style.cursor = ''
            this._handleColorRangePick(e)
        }

        // Temporarily disable selection manager so click doesn't draw selection
        this._selectionManager.enabled = false

        this._selectionOverlay.addEventListener('click', handler)

        // Cancel on escape
        const cancelHandler = (e) => {
            if (e.key === 'Escape') {
                this._selectionOverlay.removeEventListener('click', handler)
                document.removeEventListener('keydown', cancelHandler)
                this._colorRangePicking = false
                this._selectionOverlay.style.cursor = ''
                this._selectionManager.enabled = true
            }
        }
        document.addEventListener('keydown', cancelHandler)

        // Clean up enable after pick
        this._selectionOverlay.addEventListener('click', () => {
            document.removeEventListener('keydown', cancelHandler)
            this._selectionManager.enabled = true
        }, { once: true })
    }

    _handleColorRangePick(e) {
        const rect = this._selectionOverlay.getBoundingClientRect()
        const scaleX = this._canvas.width / rect.width
        const scaleY = this._canvas.height / rect.height
        const x = Math.round((e.clientX - rect.left) * scaleX)
        const y = Math.round((e.clientY - rect.top) * scaleY)

        // Sample from flattened canvas
        const tempCanvas = document.createElement('canvas')
        tempCanvas.width = this._canvas.width
        tempCanvas.height = this._canvas.height
        const tempCtx = tempCanvas.getContext('2d')
        tempCtx.drawImage(this._canvas, 0, 0)
        const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height)

        const tolerance = this._selectionManager.wandTolerance
        const mask = colorRange(imageData, x, y, tolerance)

        // Check if any pixels were selected
        let hasPixels = false
        for (let i = 3; i < mask.data.length; i += 4) {
            if (mask.data[i] > 127) { hasPixels = true; break }
        }

        if (hasPixels) {
            this._selectionManager.setSelection({ type: 'mask', data: mask })
        }
    }
```

**Step 2: Commit**

```bash
git add public/js/app.js
git commit -m "feat: add Color Range eyedropper mode"
```

---

### Task 7: Write tests

**Files:**
- Create: `tests/select-menu.spec.js`

**Step 1: Write the test file**

```javascript
import { test, expect } from 'playwright/test'

/** Helper: create solid base and wait for app ready */
async function setupApp(page) {
    await page.goto('/', { waitUntil: 'networkidle' })
    await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
    await page.waitForSelector('.open-dialog-backdrop.visible')
    await page.click('.media-option[data-type="solid"]')
    await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
    await page.click('.canvas-size-dialog .action-btn.primary')
    await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
    await page.waitForTimeout(500)
}

/** Helper: set a rect selection programmatically */
async function setRectSelection(page, x, y, w, h) {
    await page.evaluate(({ x, y, w, h }) => {
        window.layersApp._selectionManager.setSelection({
            type: 'rect', x, y, width: w, height: h
        })
    }, { x, y, w, h })
    await page.waitForTimeout(100)
}

test.describe('Select Menu', () => {
    test('select all creates full-canvas selection', async ({ page }) => {
        await setupApp(page)
        await page.click('#selectAllMenuItem')
        await page.waitForTimeout(100)

        const result = await page.evaluate(() => {
            const sel = window.layersApp._selectionManager.selectionPath
            return { type: sel?.type, x: sel?.x, y: sel?.y, w: sel?.width, h: sel?.height }
        })
        expect(result.type).toBe('rect')
        expect(result.w).toBe(1024)
        expect(result.h).toBe(1024)
    })

    test('select none clears selection', async ({ page }) => {
        await setupApp(page)
        await setRectSelection(page, 10, 10, 100, 100)
        await page.click('#selectNoneMenuItem')
        await page.waitForTimeout(100)

        const hasSelection = await page.evaluate(() =>
            window.layersApp._selectionManager.hasSelection()
        )
        expect(hasSelection).toBe(false)
    })

    test('select inverse inverts selection mask', async ({ page }) => {
        await setupApp(page)
        await setRectSelection(page, 0, 0, 512, 512)
        await page.click('#selectInverseMenuItem')
        await page.waitForTimeout(100)

        const result = await page.evaluate(() => {
            const sel = window.layersApp._selectionManager.selectionPath
            if (sel?.type !== 'mask') return { type: sel?.type }
            // Check that pixel (256, 256) is NOT selected (was inside rect)
            // and pixel (768, 768) IS selected (was outside rect)
            const insideIdx = (256 * sel.data.width + 256) * 4 + 3
            const outsideIdx = (768 * sel.data.width + 768) * 4 + 3
            return {
                type: sel.type,
                insideAlpha: sel.data.data[insideIdx],
                outsideAlpha: sel.data.data[outsideIdx]
            }
        })
        expect(result.type).toBe('mask')
        expect(result.insideAlpha).toBe(0)
        expect(result.outsideAlpha).toBe(255)
    })

    test('expand selection grows the mask', async ({ page }) => {
        await setupApp(page)
        await setRectSelection(page, 100, 100, 100, 100)

        // Click expand, enter radius 10
        await page.click('#expandSelectionMenuItem')
        await page.waitForSelector('.selection-param-dialog[open]', { timeout: 2000 })
        await page.fill('#selection-param-input', '10')
        await page.click('#selection-param-ok')
        await page.waitForTimeout(200)

        // Pixel at (95, 150) should now be selected (was 5px outside the left edge, within radius 10)
        const selected = await page.evaluate(() => {
            const sel = window.layersApp._selectionManager.selectionPath
            if (sel?.type !== 'mask') return false
            const idx = (150 * sel.data.width + 95) * 4 + 3
            return sel.data.data[idx] > 127
        })
        expect(selected).toBe(true)
    })

    test('contract selection shrinks the mask', async ({ page }) => {
        await setupApp(page)
        await setRectSelection(page, 100, 100, 100, 100)

        await page.click('#contractSelectionMenuItem')
        await page.waitForSelector('.selection-param-dialog[open]', { timeout: 2000 })
        await page.fill('#selection-param-input', '10')
        await page.click('#selection-param-ok')
        await page.waitForTimeout(200)

        // Pixel at (105, 150) should NOT be selected (was 5px inside left edge, within contraction radius 10)
        const selected = await page.evaluate(() => {
            const sel = window.layersApp._selectionManager.selectionPath
            if (sel?.type !== 'mask') return true
            const idx = (150 * sel.data.width + 105) * 4 + 3
            return sel.data.data[idx] > 127
        })
        expect(selected).toBe(false)
    })

    test('menu items are disabled when no selection', async ({ page }) => {
        await setupApp(page)

        const disabled = await page.evaluate(() => {
            const ids = [
                'selectNoneMenuItem', 'selectInverseMenuItem',
                'borderSelectionMenuItem', 'smoothSelectionMenuItem',
                'expandSelectionMenuItem', 'contractSelectionMenuItem',
                'featherSelectionMenuItem'
            ]
            return ids.every(id => document.getElementById(id)?.classList.contains('disabled'))
        })
        expect(disabled).toBe(true)
    })

    test('menu items are enabled when selection exists', async ({ page }) => {
        await setupApp(page)
        await setRectSelection(page, 10, 10, 100, 100)

        const enabled = await page.evaluate(() => {
            const ids = [
                'selectNoneMenuItem', 'selectInverseMenuItem',
                'borderSelectionMenuItem', 'smoothSelectionMenuItem',
                'expandSelectionMenuItem', 'contractSelectionMenuItem',
                'featherSelectionMenuItem'
            ]
            return ids.every(id => !document.getElementById(id)?.classList.contains('disabled'))
        })
        expect(enabled).toBe(true)
    })

    test('Cmd+A selects all via keyboard', async ({ page }) => {
        await setupApp(page)
        await page.keyboard.press('Meta+a')
        await page.waitForTimeout(100)

        const hasSelection = await page.evaluate(() =>
            window.layersApp._selectionManager.hasSelection()
        )
        expect(hasSelection).toBe(true)
    })
})
```

**Step 2: Run tests to verify they pass**

Run: `npx playwright test tests/select-menu.spec.js`
Expected: All 7 tests pass.

**Step 3: Commit**

```bash
git add tests/select-menu.spec.js
git commit -m "test: add Select menu tests"
```

---

### Task 8: Call `_updateSelectMenu()` on init

**Files:**
- Modify: `public/js/app.js`

**Step 1: Call `_updateSelectMenu()` in `init()`**

Find where `_updateImageMenu()` is first called after init (at line ~1822 or wherever the initial menu state is set), and add `this._updateSelectMenu()` right after it. This ensures the menu starts with correct disabled states.

Search for the line like:
```javascript
this._updateImageMenu()
```
and add after it:
```javascript
this._updateSelectMenu()
```

**Step 2: Run all tests**

Run: `npx playwright test`
Expected: All tests pass including the new ones.

**Step 3: Commit**

```bash
git add public/js/app.js
git commit -m "fix: call _updateSelectMenu on init for correct initial state"
```

# Layer Menu Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Layer menu with contextual Rasterize/Flatten operations.

**Architecture:** New "Layer" menu between File and View with a single dynamic menu item. Menu text and enabled state update based on layer selection. Three operations: rasterize single effect layer, flatten selected layers, flatten entire image.

**Tech Stack:** Vanilla JS, HTML, existing OffscreenCanvas patterns, Playwright for tests.

---

### Task 1: Add Layer Menu HTML

**Files:**
- Modify: `public/index.html:90-93` (between File and View menus)

**Step 1: Add the Layer menu HTML**

Insert after the File menu closing `</div>` (line 90) and before the View menu:

```html
<!-- Layer Menu -->
<div class="menu">
    <div class="menu-title">layer</div>
    <div class="menu-items hide">
        <div id="layerActionMenuItem">Flatten Image</div>
    </div>
</div>
```

**Step 2: Verify manually**

Run: `npm run dev`
Check: Layer menu appears between File and View, clicking shows "Flatten Image" item.

**Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: add Layer menu HTML structure"
```

---

### Task 2: Add Menu Update Logic

**Files:**
- Modify: `public/js/app.js` (add `_updateLayerMenu` method)

**Step 1: Add the `_updateLayerMenu` method**

Add after `_setupLayerStackHandlers` method (around line 1097):

```javascript
/**
 * Update the Layer menu item based on current selection
 * @private
 */
_updateLayerMenu() {
    const menuItem = document.getElementById('layerActionMenuItem')
    if (!menuItem) return

    const selectedIds = this._layerStack?.selectedLayerIds || []
    const selectedLayers = selectedIds.map(id => this._layers.find(l => l.id === id)).filter(Boolean)

    if (selectedIds.length === 0) {
        // No selection: Flatten Image
        menuItem.textContent = 'Flatten Image'
        menuItem.classList.remove('disabled')
    } else if (selectedIds.length === 1) {
        // Single layer selected
        const layer = selectedLayers[0]
        menuItem.textContent = 'Rasterize Layer'
        if (layer?.sourceType === 'media') {
            menuItem.classList.add('disabled')
        } else {
            menuItem.classList.remove('disabled')
        }
    } else {
        // Multiple layers selected
        menuItem.textContent = 'Flatten Layers'
        menuItem.classList.remove('disabled')
    }
}
```

**Step 2: Call `_updateLayerMenu` on selection changes**

In `_setupLayerStackHandlers`, add a listener for selection changes. Find the method and add:

```javascript
this._layerStack.addEventListener('selection-change', () => {
    this._updateLayerMenu()
})
```

**Step 3: Call `_updateLayerMenu` after layer stack updates**

At the end of `_updateLayerStack` method, add:

```javascript
this._updateLayerMenu()
```

**Step 4: Initialize menu state in `init`**

At the end of the `init` method (after `_setToolMode('selection')`), add:

```javascript
this._updateLayerMenu()
```

**Step 5: Verify manually**

Run: `npm run dev`
Check:
- With no selection → "Flatten Image" (enabled)
- Select effect layer → "Rasterize Layer" (enabled)
- Select media layer → "Rasterize Layer" (grayed out)
- Select 2+ layers → "Flatten Layers" (enabled)

**Step 6: Commit**

```bash
git add public/js/app.js
git commit -m "feat: add dynamic Layer menu update logic"
```

---

### Task 3: Write Flatten Image Test

**Files:**
- Create: `tests/flatten-image.spec.js`

**Step 1: Write the failing test**

```javascript
import { test, expect } from 'playwright/test'

test.describe('Layer menu - Flatten Image', () => {
    test('flatten image combines all visible layers into one', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        // Create a solid base layer
        await page.waitForSelector('.open-dialog-backdrop.visible')
        await page.click('.media-option[data-type="solid"]')
        await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
        await page.click('.canvas-size-dialog .action-btn.primary')
        await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
        await page.waitForTimeout(500)

        // Add a second effect layer
        await page.evaluate(async () => {
            await window.layersApp._handleAddEffectLayer('synth/gradient')
        })
        await page.waitForTimeout(500)

        // Verify we have 2 layers
        const layerCountBefore = await page.evaluate(() => window.layersApp._layers.length)
        expect(layerCountBefore).toBe(2)

        // Clear selection (click on canvas area, not on layers)
        await page.evaluate(() => {
            window.layersApp._layerStack.selectedLayerIds = []
            window.layersApp._layerStack.dispatchEvent(new CustomEvent('selection-change'))
        })
        await page.waitForTimeout(100)

        // Verify menu shows "Flatten Image"
        const menuText = await page.locator('#layerActionMenuItem').textContent()
        expect(menuText).toBe('Flatten Image')

        // Click Layer menu and then Flatten Image
        await page.click('.menu-title:text("layer")')
        await page.click('#layerActionMenuItem')
        await page.waitForTimeout(1000)

        // Verify we now have exactly 1 layer
        const layerCountAfter = await page.evaluate(() => window.layersApp._layers.length)
        expect(layerCountAfter).toBe(1)

        // Verify it's a media layer (rasterized)
        const layerType = await page.evaluate(() => window.layersApp._layers[0]?.sourceType)
        expect(layerType).toBe('media')
    })
})
```

**Step 2: Run test to verify it fails**

Run: `npx playwright test tests/flatten-image.spec.js --headed`
Expected: FAIL (flatten not implemented yet)

**Step 3: Commit**

```bash
git add tests/flatten-image.spec.js
git commit -m "test: add failing test for Flatten Image"
```

---

### Task 4: Implement Flatten Image

**Files:**
- Modify: `public/js/app.js`

**Step 1: Add `_flattenImage` method**

Add after `_updateLayerMenu`:

```javascript
/**
 * Flatten entire image to a single layer
 * Renders all visible layers, discards hidden layers
 * @private
 */
async _flattenImage() {
    if (this._layers.length === 0) return

    // Capture current canvas (all visible layers composited)
    const canvasWidth = this._canvas.width
    const canvasHeight = this._canvas.height

    const offscreen = new OffscreenCanvas(canvasWidth, canvasHeight)
    const ctx = offscreen.getContext('2d')
    ctx.drawImage(this._canvas, 0, 0)

    // Convert to blob and create media layer
    const blob = await offscreen.convertToBlob({ type: 'image/png' })
    const file = new File([blob], 'flattened-image.png', { type: 'image/png' })

    const { createMediaLayer } = await import('./layers/layer-model.js')
    const newLayer = createMediaLayer(file, 'image', this._currentProjectName || 'Flattened Image')

    // Unload all existing media
    for (const layer of this._layers) {
        if (layer.sourceType === 'media') {
            this._renderer.unloadMedia(layer.id)
        }
    }

    // Replace entire layer stack
    this._layers = [newLayer]
    await this._renderer.loadMedia(newLayer.id, file, 'image')

    // Update UI
    this._updateLayerStack()
    if (this._layerStack) {
        this._layerStack.selectedLayerId = newLayer.id
    }
    await this._rebuild()
    this._markDirty()

    toast.success('Image flattened')
}
```

**Step 2: Add `_setupLayerMenuHandlers` method**

Add after `_setupMenuHandlers`:

```javascript
/**
 * Set up Layer menu handlers
 * @private
 */
_setupLayerMenuHandlers() {
    document.getElementById('layerActionMenuItem')?.addEventListener('click', () => {
        const selectedIds = this._layerStack?.selectedLayerIds || []

        if (selectedIds.length === 0) {
            this._flattenImage()
        } else if (selectedIds.length === 1) {
            const layer = this._layers.find(l => l.id === selectedIds[0])
            if (layer && layer.sourceType !== 'media') {
                this._rasterizeLayer(selectedIds[0])
            }
        } else {
            this._flattenLayers(selectedIds)
        }
    })
}
```

**Step 3: Call `_setupLayerMenuHandlers` from `init`**

In the `init` method, after `this._setupLayerStackHandlers()`, add:

```javascript
this._setupLayerMenuHandlers()
```

**Step 4: Add stub methods for rasterize and flatten layers**

```javascript
/**
 * Rasterize a single effect layer to media
 * @param {string} layerId
 * @private
 */
async _rasterizeLayer(layerId) {
    // TODO: implement
    console.log('_rasterizeLayer not yet implemented', layerId)
}

/**
 * Flatten multiple selected layers into one
 * @param {Array<string>} layerIds
 * @private
 */
async _flattenLayers(layerIds) {
    // TODO: implement
    console.log('_flattenLayers not yet implemented', layerIds)
}
```

**Step 5: Run test to verify it passes**

Run: `npx playwright test tests/flatten-image.spec.js --headed`
Expected: PASS

**Step 6: Commit**

```bash
git add public/js/app.js
git commit -m "feat: implement Flatten Image operation"
```

---

### Task 5: Write Rasterize Layer Test

**Files:**
- Create: `tests/rasterize-layer.spec.js`

**Step 1: Write the failing test**

```javascript
import { test, expect } from 'playwright/test'

test.describe('Layer menu - Rasterize Layer', () => {
    test('rasterize converts effect layer to media layer', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        // Create a solid base layer
        await page.waitForSelector('.open-dialog-backdrop.visible')
        await page.click('.media-option[data-type="solid"]')
        await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
        await page.click('.canvas-size-dialog .action-btn.primary')
        await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
        await page.waitForTimeout(500)

        // Verify it's an effect layer
        const layerTypeBefore = await page.evaluate(() => window.layersApp._layers[0]?.sourceType)
        expect(layerTypeBefore).toBe('effect')

        const layerNameBefore = await page.evaluate(() => window.layersApp._layers[0]?.name)

        // Select the layer (should already be selected, but ensure it)
        await page.evaluate(() => {
            const layerId = window.layersApp._layers[0].id
            window.layersApp._layerStack.selectedLayerId = layerId
        })
        await page.waitForTimeout(100)

        // Verify menu shows "Rasterize Layer" and is enabled
        const menuText = await page.locator('#layerActionMenuItem').textContent()
        expect(menuText).toBe('Rasterize Layer')
        const isDisabled = await page.locator('#layerActionMenuItem').evaluate(el => el.classList.contains('disabled'))
        expect(isDisabled).toBe(false)

        // Click Layer menu and then Rasterize Layer
        await page.click('.menu-title:text("layer")')
        await page.click('#layerActionMenuItem')
        await page.waitForTimeout(1000)

        // Verify layer is now media type
        const layerTypeAfter = await page.evaluate(() => window.layersApp._layers[0]?.sourceType)
        expect(layerTypeAfter).toBe('media')

        // Verify name has "(rasterized)" suffix
        const layerNameAfter = await page.evaluate(() => window.layersApp._layers[0]?.name)
        expect(layerNameAfter).toBe(`${layerNameBefore} (rasterized)`)

        // Verify still exactly 1 layer
        const layerCount = await page.evaluate(() => window.layersApp._layers.length)
        expect(layerCount).toBe(1)
    })

    test('rasterize is disabled for media layers', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        // Create a media base layer via test image
        await page.waitForSelector('.open-dialog-backdrop.visible')
        await page.evaluate(async () => {
            const canvas = document.createElement('canvas')
            canvas.width = 100
            canvas.height = 100
            const ctx = canvas.getContext('2d')
            ctx.fillStyle = 'blue'
            ctx.fillRect(0, 0, 100, 100)
            const blob = await new Promise(r => canvas.toBlob(r, 'image/png'))
            const file = new File([blob], 'test.png', { type: 'image/png' })
            await window.layersApp._handleOpenMedia(file, 'image')
        })
        await page.waitForTimeout(500)

        // Verify it's a media layer
        const layerType = await page.evaluate(() => window.layersApp._layers[0]?.sourceType)
        expect(layerType).toBe('media')

        // Select the layer
        await page.evaluate(() => {
            const layerId = window.layersApp._layers[0].id
            window.layersApp._layerStack.selectedLayerId = layerId
        })
        await page.waitForTimeout(100)

        // Verify menu shows "Rasterize Layer" but is disabled
        const menuText = await page.locator('#layerActionMenuItem').textContent()
        expect(menuText).toBe('Rasterize Layer')
        const isDisabled = await page.locator('#layerActionMenuItem').evaluate(el => el.classList.contains('disabled'))
        expect(isDisabled).toBe(true)
    })
})
```

**Step 2: Run test to verify it fails**

Run: `npx playwright test tests/rasterize-layer.spec.js --headed`
Expected: FAIL (rasterize not implemented)

**Step 3: Commit**

```bash
git add tests/rasterize-layer.spec.js
git commit -m "test: add failing tests for Rasterize Layer"
```

---

### Task 6: Implement Rasterize Layer

**Files:**
- Modify: `public/js/app.js`

**Step 1: Implement `_rasterizeLayer` method**

Replace the stub with:

```javascript
/**
 * Rasterize a single effect layer to media
 * @param {string} layerId
 * @private
 */
async _rasterizeLayer(layerId) {
    const layerIndex = this._layers.findIndex(l => l.id === layerId)
    if (layerIndex === -1) return

    const layer = this._layers[layerIndex]
    if (layer.sourceType === 'media') return // Already media

    // Save original visibility states
    const visibilitySnapshot = this._layers.map(l => ({ id: l.id, visible: l.visible }))

    // Hide all other layers
    for (const l of this._layers) {
        if (l.id !== layerId) {
            l.visible = false
        }
    }

    // Rebuild to render only this layer
    await this._rebuild()

    // Capture the rendered result
    const canvasWidth = this._canvas.width
    const canvasHeight = this._canvas.height

    const offscreen = new OffscreenCanvas(canvasWidth, canvasHeight)
    const ctx = offscreen.getContext('2d')
    ctx.drawImage(this._canvas, 0, 0)

    // Restore visibility
    for (const snap of visibilitySnapshot) {
        const l = this._layers.find(layer => layer.id === snap.id)
        if (l) l.visible = snap.visible
    }

    // Convert to blob and create media layer
    const blob = await offscreen.convertToBlob({ type: 'image/png' })
    const file = new File([blob], 'rasterized.png', { type: 'image/png' })

    const { createMediaLayer } = await import('./layers/layer-model.js')
    const newLayer = createMediaLayer(file, 'image', `${layer.name} (rasterized)`)

    // Preserve properties from original layer
    newLayer.visible = layer.visible
    newLayer.opacity = layer.opacity
    newLayer.blendMode = layer.blendMode
    // Offset is baked in, reset to 0
    newLayer.offsetX = 0
    newLayer.offsetY = 0

    // Load media
    await this._renderer.loadMedia(newLayer.id, file, 'image')

    // Replace the layer in the stack
    this._layers[layerIndex] = newLayer

    // Update UI
    this._updateLayerStack()
    if (this._layerStack) {
        this._layerStack.selectedLayerId = newLayer.id
    }
    await this._rebuild()
    this._markDirty()

    toast.success('Layer rasterized')
}
```

**Step 2: Run test to verify it passes**

Run: `npx playwright test tests/rasterize-layer.spec.js --headed`
Expected: PASS

**Step 3: Commit**

```bash
git add public/js/app.js
git commit -m "feat: implement Rasterize Layer operation"
```

---

### Task 7: Write Flatten Layers Test

**Files:**
- Create: `tests/flatten-layers.spec.js`

**Step 1: Write the failing test**

```javascript
import { test, expect } from 'playwright/test'

test.describe('Layer menu - Flatten Layers', () => {
    test('flatten layers combines selected layers into one', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        // Create a solid base layer
        await page.waitForSelector('.open-dialog-backdrop.visible')
        await page.click('.media-option[data-type="solid"]')
        await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
        await page.click('.canvas-size-dialog .action-btn.primary')
        await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
        await page.waitForTimeout(500)

        // Add two more effect layers
        await page.evaluate(async () => {
            await window.layersApp._handleAddEffectLayer('synth/gradient')
            await window.layersApp._handleAddEffectLayer('synth/solid')
        })
        await page.waitForTimeout(500)

        // Verify we have 3 layers
        const layerCountBefore = await page.evaluate(() => window.layersApp._layers.length)
        expect(layerCountBefore).toBe(3)

        // Select the top 2 layers (indices 1 and 2)
        await page.evaluate(() => {
            const layer1 = window.layersApp._layers[1]
            const layer2 = window.layersApp._layers[2]
            window.layersApp._layerStack.selectedLayerIds = [layer1.id, layer2.id]
            window.layersApp._layerStack.dispatchEvent(new CustomEvent('selection-change'))
        })
        await page.waitForTimeout(100)

        // Verify menu shows "Flatten Layers"
        const menuText = await page.locator('#layerActionMenuItem').textContent()
        expect(menuText).toBe('Flatten Layers')

        // Click Layer menu and then Flatten Layers
        await page.click('.menu-title:text("layer")')
        await page.click('#layerActionMenuItem')
        await page.waitForTimeout(1000)

        // Verify we now have 2 layers (base + flattened)
        const layerCountAfter = await page.evaluate(() => window.layersApp._layers.length)
        expect(layerCountAfter).toBe(2)

        // Verify the new layer is named "Flattened"
        const topLayerName = await page.evaluate(() => window.layersApp._layers[1]?.name)
        expect(topLayerName).toBe('Flattened')

        // Verify it's a media layer
        const topLayerType = await page.evaluate(() => window.layersApp._layers[1]?.sourceType)
        expect(topLayerType).toBe('media')
    })
})
```

**Step 2: Run test to verify it fails**

Run: `npx playwright test tests/flatten-layers.spec.js --headed`
Expected: FAIL (flatten layers not implemented)

**Step 3: Commit**

```bash
git add tests/flatten-layers.spec.js
git commit -m "test: add failing test for Flatten Layers"
```

---

### Task 8: Implement Flatten Layers

**Files:**
- Modify: `public/js/app.js`

**Step 1: Implement `_flattenLayers` method**

Replace the stub with:

```javascript
/**
 * Flatten multiple selected layers into one
 * @param {Array<string>} layerIds
 * @private
 */
async _flattenLayers(layerIds) {
    if (layerIds.length < 2) return

    // Find the layers and their indices
    const selectedLayers = layerIds
        .map(id => ({ layer: this._layers.find(l => l.id === id), index: this._layers.findIndex(l => l.id === id) }))
        .filter(item => item.layer && item.index !== -1)
        .sort((a, b) => a.index - b.index)

    if (selectedLayers.length < 2) return

    // Find topmost selected layer index (highest index = top of stack)
    const topmostIndex = Math.max(...selectedLayers.map(item => item.index))

    // Save original visibility states
    const visibilitySnapshot = this._layers.map(l => ({ id: l.id, visible: l.visible }))

    // Hide all layers except selected visible ones
    for (const l of this._layers) {
        const isSelected = layerIds.includes(l.id)
        if (!isSelected) {
            l.visible = false
        }
        // Selected but hidden layers stay hidden (will be discarded)
    }

    // Rebuild to render only selected visible layers
    await this._rebuild()

    // Capture the rendered result
    const canvasWidth = this._canvas.width
    const canvasHeight = this._canvas.height

    const offscreen = new OffscreenCanvas(canvasWidth, canvasHeight)
    const ctx = offscreen.getContext('2d')
    ctx.drawImage(this._canvas, 0, 0)

    // Restore visibility
    for (const snap of visibilitySnapshot) {
        const l = this._layers.find(layer => layer.id === snap.id)
        if (l) l.visible = snap.visible
    }

    // Convert to blob and create media layer
    const blob = await offscreen.convertToBlob({ type: 'image/png' })
    const file = new File([blob], 'flattened.png', { type: 'image/png' })

    const { createMediaLayer } = await import('./layers/layer-model.js')
    const newLayer = createMediaLayer(file, 'image', 'Flattened')

    // Load media
    await this._renderer.loadMedia(newLayer.id, file, 'image')

    // Unload media for selected layers that are media type
    for (const item of selectedLayers) {
        if (item.layer.sourceType === 'media') {
            this._renderer.unloadMedia(item.layer.id)
        }
    }

    // Remove selected layers from stack (in reverse order to preserve indices)
    const indicesToRemove = selectedLayers.map(item => item.index).sort((a, b) => b - a)
    for (const idx of indicesToRemove) {
        this._layers.splice(idx, 1)
    }

    // Insert new layer at topmost position (adjusted for removed layers above it)
    const removedAboveTopmost = indicesToRemove.filter(idx => idx < topmostIndex).length
    const insertIndex = topmostIndex - removedAboveTopmost
    this._layers.splice(insertIndex, 0, newLayer)

    // Update UI
    this._updateLayerStack()
    if (this._layerStack) {
        this._layerStack.selectedLayerId = newLayer.id
    }
    await this._rebuild()
    this._markDirty()

    toast.success('Layers flattened')
}
```

**Step 2: Run test to verify it passes**

Run: `npx playwright test tests/flatten-layers.spec.js --headed`
Expected: PASS

**Step 3: Commit**

```bash
git add public/js/app.js
git commit -m "feat: implement Flatten Layers operation"
```

---

### Task 9: Run All Tests and Final Commit

**Step 1: Run all new tests**

Run: `npx playwright test tests/flatten-image.spec.js tests/rasterize-layer.spec.js tests/flatten-layers.spec.js`
Expected: All PASS

**Step 2: Run full test suite**

Run: `npx playwright test`
Expected: No regressions

**Step 3: Final commit if any cleanup needed**

If tests revealed issues, fix and commit. Otherwise, done.

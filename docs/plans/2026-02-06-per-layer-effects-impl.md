# Per-Layer Effects Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the ability to apply filter effects to individual layers before blending, with children shown indented in the layer stack UI.

**Architecture:** Each layer gains a `children` array of child effect objects. Children are chained in the DSL between the parent's output write and its blend operation. The layer-item component gets a "+" button and a `child` mode that hides blend/opacity controls. The layer-stack renders children indented below their parent.

**Tech Stack:** Vanilla JS, ES modules, Web Components, Noisemaker DSL/WebGL, Playwright tests

---

### Task 1: Data Model — Add `children` to Layer Objects

**Files:**
- Modify: `public/js/layers/layer-model.js:27-49` (createLayer)
- Modify: `public/js/layers/layer-model.js:89-95` (cloneLayer)
- Modify: `public/js/layers/layer-model.js:102-109` (serializeLayers)

**Step 1: Add `children: []` to `createLayer()`**

In `public/js/layers/layer-model.js`, add `children` to the return object at line 47:

```js
export function createLayer(options = {}) {
    const id = options.id || `layer-${layerCounter++}`

    return {
        id,
        name: options.name || 'Untitled',
        visible: options.visible !== false,
        opacity: options.opacity ?? 100,
        blendMode: options.blendMode || 'mix',
        locked: options.locked || false,
        offsetX: options.offsetX || 0,
        offsetY: options.offsetY || 0,
        sourceType: options.sourceType || 'media',

        // Media-specific
        mediaFile: options.mediaFile || null,
        mediaType: options.mediaType || null,

        // Effect-specific
        effectId: options.effectId || null,
        effectParams: options.effectParams || {},

        // Child effects (filter chain applied before blending)
        children: []
    }
}
```

**Step 2: Add `createChildEffect()` factory function**

Add after `createEffectLayer()` (~line 82):

```js
/**
 * Create a child effect object (lightweight, no blend/opacity/media fields)
 * @param {string} effectId - Effect ID (namespace/name)
 * @param {string} [name] - Display name
 * @param {object} [params] - Effect parameters
 * @returns {object} Child effect object
 */
export function createChildEffect(effectId, name, params = {}) {
    const effectName = effectId.split('/').pop()
    return {
        id: `layer-${layerCounter++}`,
        name: name || camelToHumanCase(effectName),
        effectId,
        effectParams: params,
        visible: true
    }
}
```

**Step 3: Update `cloneLayer()` to deep-clone children with new IDs**

```js
export function cloneLayer(layer) {
    return {
        ...layer,
        id: `layer-${layerCounter++}`,
        name: `${layer.name} copy`,
        effectParams: JSON.parse(JSON.stringify(layer.effectParams)),
        children: (layer.children || []).map(child => ({
            ...child,
            id: `layer-${layerCounter++}`,
            effectParams: JSON.parse(JSON.stringify(child.effectParams))
        }))
    }
}
```

**Step 4: Update `serializeLayers()` to include children**

No change needed — children contain no File objects, so `{ ...layer, mediaFile: null }` already preserves them via spread.

**Step 5: Commit**

```bash
git add public/js/layers/layer-model.js
git commit -m "feat: add children array to layer model"
```

---

### Task 2: Undo Deep Clone — Include Children

**Files:**
- Modify: `public/js/app.js:83-87` (_cloneLayers)

**Step 1: Update `_cloneLayers()` to deep-clone children**

Current code at line 83:
```js
_cloneLayers(layers) {
    return layers.map(l => ({
        ...l,
        effectParams: JSON.parse(JSON.stringify(l.effectParams))
    }))
}
```

New code:
```js
_cloneLayers(layers) {
    return layers.map(l => ({
        ...l,
        effectParams: JSON.parse(JSON.stringify(l.effectParams)),
        children: (l.children || []).map(c => ({
            ...c,
            effectParams: JSON.parse(JSON.stringify(c.effectParams))
        }))
    }))
}
```

**Step 2: Commit**

```bash
git add public/js/app.js
git commit -m "feat: deep-clone children in undo snapshots"
```

---

### Task 3: DSL Compilation — Chain Children Before Blend

**Files:**
- Modify: `public/js/noisemaker/renderer.js:595-676` (_buildDsl)

**Step 1: Update namespace collection to include child effect namespaces**

After the existing namespace loop (line 604-608), add:

```js
// Also collect namespaces from child effects
for (const layer of visibleLayers) {
    for (const child of (layer.children || [])) {
        if (child.visible && child.effectId) {
            const [namespace] = child.effectId.split('/')
            usedNamespaces.add(namespace)
        }
    }
}
```

**Step 2: Add helper method `_buildChildChain()`**

Add a new method after `_buildEffectCall()` (~line 693):

```js
/**
 * Build DSL lines for a layer's visible child effects.
 * Each child reads from the previous output and writes to the next buffer.
 * @param {object} layer - Parent layer
 * @param {number} currentOutput - Current output buffer index
 * @param {string[]} lines - DSL lines array to append to
 * @returns {number} Updated output buffer index
 * @private
 */
_buildChildChain(layer, currentOutput, lines) {
    const visibleChildren = (layer.children || []).filter(c => c.visible)
    for (const child of visibleChildren) {
        const effectCall = this._buildEffectCall(child)
        const nextOutput = currentOutput + 1
        lines.push(`read(o${currentOutput}).${effectCall}.write(o${nextOutput})`)
        currentOutput = nextOutput
    }
    return currentOutput
}
```

**Step 3: Insert child chain calls into `_buildDsl()`**

In the base layer branch (solid case, ~line 635), after writing the solid, add child chain:

```js
// After: lines.push(`solid(color: ${hex}, alpha: ${effectAlpha.toFixed(4)}).write(o${currentOutput})`)
currentOutput = this._buildChildChain(layer, currentOutput, lines)
```

In the base layer branch (non-solid case, ~line 644), after the blend, add child chain:

```js
// After: lines.push(`read(o${currentOutput}).blendMode(...).write(o${currentOutput + 2})`)
// currentOutput += 2
currentOutput = this._buildChildChain(layer, currentOutput, lines)
```

In the non-base layer branch (~line 660-663), after writing the layer effect but BEFORE the blend, add child chain. The key insight: children process the layer's own output, then the blend uses the final child output.

Current non-base code structure:
```js
// Write layer effect to buffer
if (isSynth) {
    lines.push(`${effectCall}.write(o${currentOutput})`)
} else {
    lines.push(`read(o${prevOutput}).${effectCall}.write(o${currentOutput})`)
}

// Blend with previous
const nextOutput = currentOutput + 1
lines.push(`read(o${prevOutput}).blendMode(tex: read(o${currentOutput}), ...).write(o${nextOutput})`)
currentOutput = nextOutput
```

New structure — insert child chain between write and blend:
```js
// Write layer effect to buffer
if (isSynth) {
    lines.push(`${effectCall}.write(o${currentOutput})`)
} else {
    lines.push(`read(o${prevOutput}).${effectCall}.write(o${currentOutput})`)
}

// Apply child effects to this layer's output
currentOutput = this._buildChildChain(layer, currentOutput, lines)

// Blend with previous (now uses final child output)
const nextOutput = currentOutput + 1
lines.push(`read(o${prevOutput}).blendMode(tex: read(o${currentOutput}), ...).write(o${nextOutput})`)
currentOutput = nextOutput
```

**Step 4: Commit**

```bash
git add public/js/noisemaker/renderer.js
git commit -m "feat: chain child effects in DSL compilation"
```

---

### Task 4: Layer Step Map — Map Child IDs to Render Passes

**Files:**
- Modify: `public/js/noisemaker/renderer.js:243-273` (_buildLayerStepMap)

**Step 1: Extend `_buildLayerStepMap()` to map children**

After mapping each parent layer, iterate its visible children and map them too. Children are always filter effects, so they use `effectId.split('/')[1]` for the effect name.

Replace the method body:

```js
_buildLayerStepMap() {
    this._layerStepMap.clear()

    const passes = this._renderer.pipeline?.graph?.passes
    if (!passes) return

    const visibleLayers = this._layers.filter(l => l.visible)
    const effectTypeCounts = {}

    for (const layer of visibleLayers) {
        const effectName = layer.sourceType === 'media'
            ? 'media'
            : layer.effectId?.split('/')[1]

        if (!effectName) continue

        const seenCount = effectTypeCounts[effectName] || 0
        effectTypeCounts[effectName] = seenCount + 1

        let matchCount = 0
        for (const pass of passes) {
            if (pass.effectFunc === effectName || pass.effectKey === effectName) {
                if (matchCount === seenCount) {
                    this._layerStepMap.set(layer.id, pass.stepIndex)
                    break
                }
                matchCount++
            }
        }

        // Map visible child effects
        const visibleChildren = (layer.children || []).filter(c => c.visible)
        for (const child of visibleChildren) {
            const childEffectName = child.effectId?.split('/')[1]
            if (!childEffectName) continue

            const childSeenCount = effectTypeCounts[childEffectName] || 0
            effectTypeCounts[childEffectName] = childSeenCount + 1

            let childMatchCount = 0
            for (const pass of passes) {
                if (pass.effectFunc === childEffectName || pass.effectKey === childEffectName) {
                    if (childMatchCount === childSeenCount) {
                        this._layerStepMap.set(child.id, pass.stepIndex)
                        break
                    }
                    childMatchCount++
                }
            }
        }
    }
}
```

**Step 2: Commit**

```bash
git add public/js/noisemaker/renderer.js
git commit -m "feat: map child effect IDs in layer step map"
```

---

### Task 5: Renderer API — Add `getFilterEffects()`

**Files:**
- Modify: `public/js/noisemaker/renderer.js:778-783` (after getLayerEffects)

**Step 1: Add `getFilterEffects()` method**

The existing `getLayerEffects()` already filters to non-starter, non-synth effects. However it also hides some namespaces. For child effects we want the same filter (only filter-type effects that process existing content). So `getLayerEffects()` already returns what we need. No new method required — just reuse `getLayerEffects()` when showing the child effect picker.

**No code change. Move to next task.**

---

### Task 6: CSS — Child Layer Indentation

**Files:**
- Modify: `public/css/layers.css` (add after line 51, the drag-over-below rule)

**Step 1: Add child layer styles**

Add after the `.layer-item.drag-over-below` block (~line 51):

```css
/* Child Effect Layers (indented below parent) */
.layer-item.child-layer {
    margin-left: 24px;
    border-left: 2px solid var(--color-accent-muted);
    border-radius: 0 var(--radius-md) var(--radius-md) 0;
}

.layer-item.child-layer .layer-drag-handle {
    visibility: hidden;
    width: 0;
    padding: 0;
}

/* Add Child Button */
.layer-add-child {
    background: none;
    border: none;
    color: var(--color-text-muted);
    cursor: pointer;
    padding: 4px;
    line-height: 1;
    border-radius: var(--radius-sm);
    transition: all var(--transition-fast);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    opacity: 0;
}

.layer-item:hover .layer-add-child {
    opacity: 1;
}

.layer-add-child:hover {
    color: var(--color-accent);
    background: var(--color-accent-muted);
}

.layer-add-child .icon-material {
    font-size: 16px;
}
```

**Step 2: Commit**

```bash
git add public/css/layers.css
git commit -m "feat: add child layer CSS styles"
```

---

### Task 7: UI — layer-item "+" Button and Child Mode

**Files:**
- Modify: `public/js/layers/layer-item.js:67-136` (_render)
- Modify: `public/js/layers/layer-item.js:182-250` (_setupEventListeners)

**Step 1: Add `child` property to layer-item**

In the constructor (~line 16):
```js
constructor() {
    super()
    this._layer = null
    this._selected = false
    this._paramsExpanded = false
    this._dragFromHandle = false
    this._isChild = false
}
```

Add a setter/getter after the existing `selected` property:

```js
set isChild(val) {
    this._isChild = val
}

get isChild() {
    return this._isChild
}
```

**Step 2: Update `_render()` to support child mode**

Modify the render method. Key changes:
- Add "+" button next to delete button (only for non-child layers)
- In child mode: hide blend mode select and opacity slider, hide drag handle
- In child mode: add `child-layer` CSS class

Replace the class-building and HTML template section. The `_render()` changes:

In the CSS classes block (~line 87-94), add child-layer:
```js
const classes = [
    'layer-item',
    isEffect ? 'effect-layer' : 'media-layer',
    isBase && 'base-layer',
    this._isChild && 'child-layer',
    layer.locked && 'locked',
    this._selected && 'selected'
].filter(Boolean).join(' ')
```

In the HTML template, add the "+" button next to the delete button (~line 113), but only when NOT a child:

```html
${!this._isChild ? `<button class="layer-add-child" title="Add effect">
    <span class="icon-material">add</span>
</button>` : ''}
<button class="layer-delete" title="Delete layer">
    <span class="icon-material">close</span>
</button>
```

For child mode, replace the controls section (~line 117-128). Children only show the params toggle (no blend/opacity):

```html
<div class="layer-controls">
    ${hasParams ? `<button class="layer-params-toggle ${this._paramsExpanded ? 'expanded' : ''}" title="Toggle parameters">
        <span class="icon-material">arrow_right</span>
    </button>` : ''}
    ${!this._isChild ? `<select class="layer-blend-mode" title="Blend mode">
        ${blendOptions}
    </select>
    <div class="layer-opacity-container">
        <input type="range" class="layer-opacity" min="0" max="100" value="${layer.opacity}" title="Opacity">
        <span class="layer-opacity-value">${layer.opacity}%</span>
    </div>` : ''}
</div>
```

For child mode, override the icon to `tune` (filter icon) instead of `auto_awesome`:

```js
let iconName = 'image'
if (this._isChild) iconName = 'tune'
else if (isEffect) iconName = 'auto_awesome'
else if (layer.mediaType === 'video') iconName = 'videocam'
```

**Step 3: Add "+" button click handler in `_setupEventListeners()`**

In the click handler (~line 184), add a case for `.layer-add-child`:

```js
const addChildBtn = e.target.closest('.layer-add-child')
if (addChildBtn) {
    e.stopPropagation()
    this.dispatchEvent(new CustomEvent('child-add', {
        bubbles: true,
        detail: { layerId: this._layer.id }
    }))
    return
}
```

**Step 4: Add `parentLayerId` to events when in child mode**

Update `_emitChange()` (~line 362) and `_handleDelete()` (~line 282) to include parent context when this is a child:

In `_emitChange()`:
```js
_emitChange(property, value) {
    const detail = {
        layerId: this._layer.id,
        property,
        value,
        layer: this._layer
    }
    if (this._parentLayerId) {
        detail.parentLayerId = this._parentLayerId
    }
    this.dispatchEvent(new CustomEvent('layer-change', {
        bubbles: true,
        detail
    }))
}
```

In `_handleDelete()`:
```js
_handleDelete() {
    const detail = { layerId: this._layer.id }
    if (this._parentLayerId) {
        detail.parentLayerId = this._parentLayerId
    }
    this.dispatchEvent(new CustomEvent('layer-delete', {
        bubbles: true,
        detail
    }))
}
```

Add `_parentLayerId` to constructor init:
```js
this._parentLayerId = null
```

Add setter:
```js
set parentLayerId(val) {
    this._parentLayerId = val
}
```

**Step 5: Commit**

```bash
git add public/js/layers/layer-item.js
git commit -m "feat: add child mode and + button to layer-item"
```

---

### Task 8: UI — layer-stack Renders Children

**Files:**
- Modify: `public/js/layers/layer-stack.js:102-134` (_render)

**Step 1: Update `_render()` to include children below each parent**

Replace the rendering loop. After creating each parent `<layer-item>`, iterate its `children` array and create child `<layer-item>` elements:

```js
_render() {
    this.innerHTML = ''

    if (this._layers.length === 0) {
        this.innerHTML = `
            <div class="empty-state">
                <span class="icon-material">layers</span>
                <p>No layers yet</p>
                <p style="font-size: 12px; opacity: 0.7;">Open a media file to get started</p>
            </div>
        `
        return
    }

    // Render layers in reverse order (top first visually)
    const reversedLayers = [...this._layers].reverse()

    for (let i = 0; i < reversedLayers.length; i++) {
        const layer = reversedLayers[i]
        const isBase = i === reversedLayers.length - 1

        const item = document.createElement('layer-item')
        item.layer = layer
        if (isBase) {
            item.setAttribute('base', '')
        }
        if (this._selectedLayerIds.has(layer.id)) {
            item.selected = true
        }

        this.appendChild(item)

        // Render child effects (in order, below parent)
        for (const child of (layer.children || [])) {
            const childItem = document.createElement('layer-item')
            childItem.layer = child
            childItem.isChild = true
            childItem.parentLayerId = layer.id
            if (this._selectedLayerIds.has(child.id)) {
                childItem.selected = true
            }
            this.appendChild(childItem)
        }
    }
}
```

**Step 2: Commit**

```bash
git add public/js/layers/layer-stack.js
git commit -m "feat: render child effects in layer stack"
```

---

### Task 9: App.js — Child Effect Event Handling

**Files:**
- Modify: `public/js/app.js:1395-1430` (_setupLayerStackHandlers)
- Modify: `public/js/app.js:587-604` (near _handleAddEffectLayer)
- Modify: `public/js/app.js:630-652` (_handleDeleteLayer)
- Modify: `public/js/app.js:659-711` (_handleLayerChange)
- Modify: `public/js/app.js:1737-1747` (near _showAddLayerDialog)

**Step 1: Add `child-add` event listener in `_setupLayerStackHandlers()`**

After the existing event listeners (~line 1429), add:

```js
this._layerStack.addEventListener('child-add', (e) => {
    this._showAddChildEffectDialog(e.detail.layerId)
})
```

**Step 2: Add `_showAddChildEffectDialog()` method**

Add near `_showAddLayerDialog()` (~line 1747):

```js
/**
 * Show effect picker for adding a child effect to a layer
 * @param {string} parentLayerId - Parent layer ID
 * @private
 */
_showAddChildEffectDialog(parentLayerId) {
    // Reuse add-layer dialog in effect-only mode
    addLayerDialog.show({
        effects: this._renderer.getLayerEffects(),
        onAddEffect: async (effectId) => {
            await this._handleAddChildEffect(parentLayerId, effectId)
        }
    })
    // Skip to effect picker immediately
    addLayerDialog._showEffectPicker()
}
```

Note: This reuses the existing add-layer dialog. The `_showEffectPicker()` call jumps directly to the effect picker view. If this coupling feels too tight, an alternative is to create a dedicated dialog — but this is the minimal approach.

**Step 3: Add `_handleAddChildEffect()` method**

Add near `_handleAddEffectLayer()` (~line 604):

```js
/**
 * Add a child effect to a parent layer
 * @param {string} parentLayerId - Parent layer ID
 * @param {string} effectId - Effect ID to add
 * @private
 */
async _handleAddChildEffect(parentLayerId, effectId) {
    const parent = this._layers.find(l => l.id === parentLayerId)
    if (!parent) return

    this._finalizePendingUndo()

    const child = createChildEffect(effectId)
    if (!parent.children) parent.children = []
    parent.children.push(child)

    this._updateLayerStack()
    await this._rebuild()
    this._markDirty()
    this._pushUndoState()

    // Select the new child
    if (this._layerStack) {
        this._layerStack.selectedLayerId = child.id
    }

    toast.success(`Added effect: ${child.name}`)
}
```

Also add `createChildEffect` to the import from `layer-model.js` at the top of app.js.

**Step 4: Update `_handleDeleteLayer()` to handle children**

Modify `_handleDeleteLayer()` (~line 630). Check if the `layerId` has a parent (is a child):

```js
async _handleDeleteLayer(layerId, parentLayerId) {
    if (parentLayerId) {
        // Deleting a child effect
        const parent = this._layers.find(l => l.id === parentLayerId)
        if (!parent || !parent.children) return

        const childIndex = parent.children.findIndex(c => c.id === layerId)
        if (childIndex < 0) return

        this._finalizePendingUndo()
        const child = parent.children[childIndex]
        parent.children.splice(childIndex, 1)

        this._updateLayerStack()
        await this._rebuild()
        this._markDirty()
        this._pushUndoState()

        toast.info(`Deleted effect: ${child.name}`)
        return
    }

    // Existing top-level layer delete logic follows...
    const index = this._layers.findIndex(l => l.id === layerId)
    if (index <= 0) return
    // ... rest unchanged
}
```

Update the caller in `_setupLayerStackHandlers()` to pass `parentLayerId`:

```js
this._layerStack.addEventListener('layer-delete', (e) => {
    this._handleDeleteLayer(e.detail.layerId, e.detail.parentLayerId)
})
```

**Step 5: Update `_handleLayerChange()` to handle children**

Modify `_handleLayerChange()` (~line 659). If `detail.parentLayerId` is set, find the child in the parent's children array instead of the top-level layers:

Add at the top of the method, before the existing layer lookup:

```js
async _handleLayerChange(detail) {
    const isDebounced = detail.property === 'effectParams' || detail.property === 'opacity'
    if (!isDebounced) {
        this._finalizePendingUndo()
    }

    // Find the target — either a child or a top-level layer
    let layer
    if (detail.parentLayerId) {
        const parent = this._layers.find(l => l.id === detail.parentLayerId)
        layer = parent?.children?.find(c => c.id === detail.layerId)
    } else {
        layer = this._layers.find(l => l.id === detail.layerId)
    }

    if (layer) {
        layer[detail.property] = detail.value
    }

    this._markDirty()

    // Children only support effectParams and visibility changes
    if (detail.parentLayerId) {
        switch (detail.property) {
            case 'effectParams':
                this._renderer.updateLayerParams(detail.layerId, detail.value)
                this._renderer.syncDsl()
                this._pushUndoStateDebounced()
                break
            case 'visibility':
            case 'name':
                await this._rebuild()
                this._pushUndoState()
                break
            default:
                await this._rebuild()
                this._pushUndoState()
        }
        return
    }

    // Existing top-level property handling follows unchanged...
    switch (detail.property) {
        // ... existing cases
    }
}
```

**Step 6: Commit**

```bash
git add public/js/app.js
git commit -m "feat: wire up child effect add/delete/change handlers"
```

---

### Task 10: Effect Picker Dialog — Skip to Effect Mode

**Files:**
- Modify: `public/js/ui/add-layer-dialog.js:29-40` (show method)

**Step 1: Check if `_showEffectPicker()` works when called directly after `show()`**

Read the add-layer-dialog to verify the mode switching. The `show()` method opens the dialog and shows the choose screen. `_showEffectPicker()` switches to the effect picker view. Calling them in sequence should work.

If the choose screen flickers, add a `showEffectOnly()` convenience method:

```js
/**
 * Show dialog in effect-only mode (skip media/effect choice)
 * @param {object} options
 */
showEffectOnly(options) {
    this._effects = options.effects || []
    this._onAddEffect = options.onAddEffect || null
    this._dialog.showModal()
    this._showEffectPicker()
}
```

Then update `_showAddChildEffectDialog()` in app.js to use this:

```js
_showAddChildEffectDialog(parentLayerId) {
    addLayerDialog.showEffectOnly({
        effects: this._renderer.getLayerEffects(),
        onAddEffect: async (effectId) => {
            await this._handleAddChildEffect(parentLayerId, effectId)
        }
    })
}
```

**Step 2: Commit**

```bash
git add public/js/ui/add-layer-dialog.js public/js/app.js
git commit -m "feat: add effect-only mode for child effect picker"
```

---

### Task 11: Write E2E Tests

**Files:**
- Create: `tests/child-effects.spec.js`

**Step 1: Write the test file**

```js
// @ts-check
const { test, expect } = require('@playwright/test')

test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

    // Create a solid color project
    await page.waitForSelector('.open-dialog-backdrop.visible')
    await page.click('.media-option[data-type="solid"]')
    await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
    await page.click('.canvas-size-dialog .action-btn.primary')
    await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
    await page.waitForTimeout(500)

    // Add an effect layer on top
    await page.evaluate(async () => {
        await window.layersApp._handleAddEffectLayer('synth/gradient')
    })
    await page.waitForTimeout(500)
})

test('add child effect to a layer', async ({ page }) => {
    // Add a child effect to the gradient layer
    const parentId = await page.evaluate(() => window.layersApp._layers[1].id)

    await page.evaluate(async (parentId) => {
        await window.layersApp._handleAddChildEffect(parentId, 'filter/blur')
    }, parentId)
    await page.waitForTimeout(500)

    // Verify child was added
    const childCount = await page.evaluate(() =>
        window.layersApp._layers[1].children.length
    )
    expect(childCount).toBe(1)

    const childName = await page.evaluate(() =>
        window.layersApp._layers[1].children[0].name
    )
    expect(childName).toBe('Blur')

    // Verify child appears in UI as indented
    const childItems = page.locator('layer-item.child-layer')
    await expect(childItems).toHaveCount(1)
})

test('child effect modifies DSL output', async ({ page }) => {
    const parentId = await page.evaluate(() => window.layersApp._layers[1].id)

    // Get DSL before adding child
    const dslBefore = await page.evaluate(() =>
        window.layersApp._renderer._currentDsl
    )

    await page.evaluate(async (parentId) => {
        await window.layersApp._handleAddChildEffect(parentId, 'filter/blur')
    }, parentId)
    await page.waitForTimeout(500)

    // Get DSL after
    const dslAfter = await page.evaluate(() =>
        window.layersApp._renderer._currentDsl
    )

    expect(dslAfter).not.toBe(dslBefore)
    expect(dslAfter).toContain('blur(')
})

test('child effect visibility toggle triggers rebuild', async ({ page }) => {
    const parentId = await page.evaluate(() => window.layersApp._layers[1].id)

    await page.evaluate(async (parentId) => {
        await window.layersApp._handleAddChildEffect(parentId, 'filter/blur')
    }, parentId)
    await page.waitForTimeout(500)

    // Toggle child visibility off
    const childId = await page.evaluate(() =>
        window.layersApp._layers[1].children[0].id
    )

    const dslWithChild = await page.evaluate(() =>
        window.layersApp._renderer._currentDsl
    )

    await page.evaluate(({ parentId, childId }) => {
        window.layersApp._handleLayerChange({
            layerId: childId,
            parentLayerId: parentId,
            property: 'visibility',
            value: false
        })
    }, { parentId, childId })
    await page.waitForTimeout(500)

    const dslHidden = await page.evaluate(() =>
        window.layersApp._renderer._currentDsl
    )

    // DSL should not contain blur when child is hidden
    expect(dslWithChild).toContain('blur(')
    expect(dslHidden).not.toContain('blur(')
})

test('delete child effect removes from parent', async ({ page }) => {
    const parentId = await page.evaluate(() => window.layersApp._layers[1].id)

    await page.evaluate(async (parentId) => {
        await window.layersApp._handleAddChildEffect(parentId, 'filter/blur')
    }, parentId)
    await page.waitForTimeout(500)

    const childId = await page.evaluate(() =>
        window.layersApp._layers[1].children[0].id
    )

    await page.evaluate(async ({ childId, parentId }) => {
        await window.layersApp._handleDeleteLayer(childId, parentId)
    }, { childId, parentId })
    await page.waitForTimeout(500)

    const childCount = await page.evaluate(() =>
        window.layersApp._layers[1].children.length
    )
    expect(childCount).toBe(0)

    // Verify child removed from UI
    const childItems = page.locator('layer-item.child-layer')
    await expect(childItems).toHaveCount(0)
})

test('undo restores child effects', async ({ page }) => {
    const parentId = await page.evaluate(() => window.layersApp._layers[1].id)

    await page.evaluate(async (parentId) => {
        await window.layersApp._handleAddChildEffect(parentId, 'filter/blur')
    }, parentId)
    await page.waitForTimeout(500)

    // Verify child exists
    let childCount = await page.evaluate(() =>
        window.layersApp._layers[1].children.length
    )
    expect(childCount).toBe(1)

    // Undo
    await page.evaluate(() => window.layersApp._undo())
    await page.waitForTimeout(500)

    childCount = await page.evaluate(() =>
        window.layersApp._layers[1].children.length
    )
    expect(childCount).toBe(0)

    // Redo
    await page.evaluate(() => window.layersApp._redo())
    await page.waitForTimeout(500)

    childCount = await page.evaluate(() =>
        window.layersApp._layers[1].children.length
    )
    expect(childCount).toBe(1)
})

test('multiple children chain in order', async ({ page }) => {
    const parentId = await page.evaluate(() => window.layersApp._layers[1].id)

    await page.evaluate(async (parentId) => {
        await window.layersApp._handleAddChildEffect(parentId, 'filter/blur')
        await window.layersApp._handleAddChildEffect(parentId, 'filter/invert')
    }, parentId)
    await page.waitForTimeout(500)

    const childCount = await page.evaluate(() =>
        window.layersApp._layers[1].children.length
    )
    expect(childCount).toBe(2)

    const dsl = await page.evaluate(() =>
        window.layersApp._renderer._currentDsl
    )

    // Blur should appear before invert in the DSL
    const blurIndex = dsl.indexOf('blur(')
    const invertIndex = dsl.indexOf('invert(')
    expect(blurIndex).toBeGreaterThan(-1)
    expect(invertIndex).toBeGreaterThan(-1)
    expect(blurIndex).toBeLessThan(invertIndex)
})
```

**Step 2: Run tests to verify they fail**

Run: `npx playwright test tests/child-effects.spec.js`
Expected: All tests FAIL (feature not implemented yet, or if implementing in order, tests validate the implementation).

**Step 3: Commit**

```bash
git add tests/child-effects.spec.js
git commit -m "test: add child effects E2E tests"
```

---

### Task 12: Run All Tests and Fix Issues

**Step 1: Run existing test suite**

Run: `npx playwright test`
Expected: All 21 existing specs pass + 6 new child effect specs pass.

**Step 2: Fix any regressions**

Common issues to watch for:
- Existing layers without `children` field (add `|| []` guards in all child iteration)
- `_cloneLayers` snapshot corruption (verify deep clone)
- DSL buffer counter misalignment (verify `_buildChildChain` return value)

**Step 3: Final commit**

```bash
git add -A
git commit -m "fix: resolve any test regressions from child effects"
```

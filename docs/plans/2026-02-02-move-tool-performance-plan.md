# Move Tool Performance Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the move tool smooth by updating layer offsets via runtime uniforms instead of DSL rebuild.

**Architecture:** Add `updateLayerOffset()` method to renderer that uses `applyStepParameterValues()` for 60fps updates. Remove offset from DSL generation so it doesn't trigger recompile.

**Tech Stack:** Vanilla JS, WebGL shader uniforms

---

### Task 1: Add updateLayerOffset method to renderer

**Files:**
- Modify: `public/js/noisemaker/renderer.js:382` (after `updateLayerParams`)

**Step 1: Add the method**

Add after `updateLayerParams()` method (around line 370):

```javascript
/**
 * Update offset for a media layer without recompiling
 * @param {string} layerId - Layer ID
 * @param {number} x - X offset in pixels
 * @param {number} y - Y offset in pixels
 */
updateLayerOffset(layerId, x, y) {
    const stepIndex = this._layerStepMap.get(layerId)
    if (stepIndex === undefined) return

    const normalizedX = (x / this.width) / 1.5 * 100
    const normalizedY = (y / this.height) / 1.5 * 100

    const stepKey = `step_${stepIndex}`
    if (this._renderer.applyStepParameterValues) {
        this._renderer.applyStepParameterValues({
            [stepKey]: {
                offsetX: Math.max(-100, Math.min(100, normalizedX)),
                offsetY: Math.max(-100, Math.min(100, normalizedY))
            }
        })
    }
}
```

**Step 2: Commit**

```bash
git add public/js/noisemaker/renderer.js
git commit -m "feat(renderer): add updateLayerOffset for runtime offset updates"
```

---

### Task 2: Remove offset from DSL generation

**Files:**
- Modify: `public/js/noisemaker/renderer.js:917-941` (`_buildMediaCall` method)

**Step 1: Simplify the method**

Replace the entire `_buildMediaCall` method:

```javascript
/**
 * Build a media call string
 * @param {object} layer - Layer object
 * @returns {string} Media call DSL
 * @private
 */
_buildMediaCall(layer) {
    return 'media()'
}
```

**Step 2: Commit**

```bash
git add public/js/noisemaker/renderer.js
git commit -m "refactor(renderer): remove offset from DSL generation"
```

---

### Task 3: Apply offsets after compile

**Files:**
- Modify: `public/js/noisemaker/renderer.js:437-462` (`_applyAllLayerParams` method)

**Step 1: Add offset application for media layers**

In `_applyAllLayerParams()`, add after the existing param application block (after line 460, before the closing brace of the for loop):

```javascript
// Apply offset for media layers
if (layer.sourceType === 'media') {
    this.updateLayerOffset(layer.id, layer.offsetX || 0, layer.offsetY || 0)
}
```

**Step 2: Commit**

```bash
git add public/js/noisemaker/renderer.js
git commit -m "feat(renderer): apply media offsets after compile"
```

---

### Task 4: Update app.js to use runtime offset updates

**Files:**
- Modify: `public/js/app.js:1041-1049` (`_updateActiveLayerPosition` method)

**Step 1: Replace the method**

Replace the entire `_updateActiveLayerPosition` method:

```javascript
/**
 * Update active layer's position offset
 * @param {number} x
 * @param {number} y
 * @private
 */
_updateActiveLayerPosition(x, y) {
    const layer = this._getActiveLayer()
    if (!layer) return

    layer.offsetX = x
    layer.offsetY = y

    this._renderer.updateLayerOffset(layer.id, x, y)
    this._markDirty()
}
```

**Step 2: Commit**

```bash
git add public/js/app.js
git commit -m "fix(app): use runtime offset updates instead of rebuild"
```

---

### Task 5: Manual verification

**Step 1: Start the dev server**

```bash
npm run dev
```

**Step 2: Test move tool performance**

1. Open browser to localhost
2. Create transparent project
3. Add a media layer (any image)
4. Select the layer
5. Click move tool button
6. Drag the layer around

**Expected:** Smooth 60fps movement, no lag

**Step 3: Test existing functionality**

1. Run existing tests: `npm test`
2. Verify all pass

**Step 4: Final commit if any fixes needed**

---

## Summary

4 code changes across 2 files:
- `renderer.js`: Add `updateLayerOffset()`, simplify `_buildMediaCall()`, update `_applyAllLayerParams()`
- `app.js`: Change `_updateActiveLayerPosition()` to use new method

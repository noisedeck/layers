# Move Tool Performance Fix

## Problem

The move tool is unusable due to lag. Every mouse move during drag calls `_rebuild()`, which regenerates DSL and recompiles the entire shader pipeline. This happens because `offsetX`/`offsetY` are baked into the DSL string in `_buildMediaCall()`.

## Solution

Update layer offsets via runtime uniform parameters instead of DSL rebuild.

## Changes

### renderer.js

**1. Add `updateLayerOffset(layerId, x, y)` method:**

```javascript
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

**2. Simplify `_buildMediaCall()` - remove offset params:**

```javascript
_buildMediaCall(layer) {
    return 'media()'
}
```

**3. Modify `_applyAllLayerParams()` - apply offsets after compile:**

Add after existing param application for media layers:
```javascript
if (layer.sourceType === 'media') {
    this.updateLayerOffset(layer.id, layer.offsetX || 0, layer.offsetY || 0)
}
```

### app.js

**4. Modify `_updateActiveLayerPosition()` - use uniform update instead of rebuild:**

```javascript
_updateActiveLayerPosition(x, y) {
    const layer = this._getActiveLayer()
    if (!layer) return

    layer.offsetX = x
    layer.offsetY = y

    this._renderer.updateLayerOffset(layer.id, x, y)
    this._markDirty()
}
```

Remove `async` keyword - no longer needed.

## Files Modified

- `public/js/noisemaker/renderer.js`
- `public/js/app.js`

## Files Unchanged

- `public/js/tools/move-tool.js` (FSM structure is adequate)

## Verification

- Drag a layer with move tool - should be smooth 60fps
- Existing tests should pass
- Layer position persists after save/load

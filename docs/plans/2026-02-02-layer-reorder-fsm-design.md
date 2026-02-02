# Layer Reorder FSM Design

## Problem

The current layer drag-and-drop reordering has three interconnected issues:

1. **Z-index layering broken** - Layer items don't have proper z-index, causing visual glitches during drag
2. **Drop placement wrong** - Index calculation bugs place layers in unexpected positions
3. **DSL corruption** - The chain update logic can break the shader program, corrupting the project

Root cause: A fragile multi-step process spread across multiple components with no transactional safety.

## Solution

Implement a Finite State Machine (FSM) in `app.js` with full transaction support:
- Snapshot state before reorder
- Validate new DSL compiles before committing
- Rollback on failure

---

## FSM States

| State | Description |
|-------|-------------|
| `IDLE` | No drag in progress, ready for interaction |
| `DRAGGING` | User is actively dragging a layer |
| `PROCESSING` | Drop occurred, validating new order |
| `ROLLING_BACK` | Validation failed, reverting to snapshot |

## State Transitions

```
IDLE
  → DRAGGING      (on: dragstart from valid layer)

DRAGGING
  → IDLE          (on: dragend without drop, or escape key)
  → PROCESSING    (on: drop on valid target)

PROCESSING
  → IDLE          (on: validation success, commit complete)
  → ROLLING_BACK  (on: DSL compile failure)

ROLLING_BACK
  → IDLE          (on: rollback complete, show error to user)
```

## State Data

Captured on entering DRAGGING:
- `snapshot.layers` - deep copy of current layers array
- `snapshot.dsl` - current compiled DSL string
- `sourceLayerId` - the layer being dragged
- `sourceIndex` - original position in array

---

## Transaction Flow

### On entering DRAGGING

1. Capture snapshot: `{ layers: deepCopy(this._layers), dsl: this._renderer._currentDsl }`
2. Store `sourceLayerId` and `sourceIndex`
3. Add `dragging` class to source layer-item
4. Set z-index on all layer-items based on their stack position (top layer = highest)

### During DRAGGING (dragover events)

- Update drop indicator classes on layer-items (no data changes)
- Calculate and show visual preview of where layer would land

### On DROP → entering PROCESSING

1. Calculate `targetIndex` from drop target
2. Build `newLayers` array with reordered layers
3. Generate new DSL from `newLayers` via `_buildDsl()`
4. Attempt to compile: `this._renderer.tryCompile(newDsl)`
5. **If compile succeeds:**
   - Commit: `this._layers = newLayers`
   - Update renderer state, textures, parameters
   - Transition → IDLE
6. **If compile fails:**
   - Transition → ROLLING_BACK

### On entering ROLLING_BACK

1. Restore: `this._layers = snapshot.layers`
2. Recompile original DSL (should always succeed)
3. Show error notification to user: "Layer reorder failed - reverted"
4. Transition → IDLE

### On ESC key or dragend without drop

- Clear visual feedback
- Transition → IDLE (no snapshot restore needed - nothing changed)

---

## Z-Index Fix

### Problem

Layer items in the UI don't have z-index set, so during drag operations the visual stacking is unpredictable.

### Solution

When entering DRAGGING state (and on initial render), set z-index on each layer-item:

```javascript
_updateLayerZIndex() {
    const items = this._layerStack.querySelectorAll('layer-item')
    const count = items.length

    items.forEach((item, domIndex) => {
        // DOM order is top-to-bottom, so first item = highest z-index
        item.style.zIndex = count - domIndex
    })
}
```

### CSS Requirements

```css
layer-item {
    position: relative; /* Required for z-index to work */
}

layer-item.dragging {
    z-index: 9999 !important;
    opacity: 0.8;
}
```

### When to update z-index

- On initial layer-stack render
- After any reorder commits successfully
- On entering DRAGGING state (defensive)

---

## Drop Position Calculation

### Problem

Current code has error-prone index math - removing then reinserting at adjusted index.

### Solution

Calculate target position BEFORE any array mutation, using drop position ('above' or 'below'):

```javascript
_calculateNewOrder(sourceId, targetId, dropPosition) {
    // dropPosition: 'above' or 'below' the target
    const layers = [...this._layers]  // work on copy

    const sourceIdx = layers.findIndex(l => l.id === sourceId)
    const targetIdx = layers.findIndex(l => l.id === targetId)

    // Validate
    if (sourceIdx === -1 || targetIdx === -1) return null
    if (sourceIdx === 0) return null  // can't move base layer

    // Remove source
    const [sourceLayer] = layers.splice(sourceIdx, 1)

    // Calculate insert position on the MODIFIED array
    let insertIdx = targetIdx
    if (sourceIdx < targetIdx) {
        // Source was above target, target shifted up by 1
        insertIdx = targetIdx - 1
    }

    // Adjust for drop position
    if (dropPosition === 'below') {
        insertIdx = Math.max(1, insertIdx)  // never below base
    } else {
        insertIdx = insertIdx + 1  // above means higher index
    }

    layers.splice(insertIdx, 0, sourceLayer)
    return layers
}
```

Drop position is determined from the dragover event's Y coordinate relative to the target element's center.

---

## DSL Validation

### Problem

Currently, reordering mutates `_layers` first, then rebuilds DSL. If DSL generation or compilation fails, the layer state and DSL are out of sync.

### Solution

Validate in isolation before committing:

```javascript
async _validateReorder(newLayers) {
    try {
        // 1. Generate DSL from proposed layer order (don't touch real state)
        const newDsl = this._buildDslFromLayers(newLayers)

        // 2. Try to compile it (dry run)
        const compiledProgram = this._renderer.tryCompile(newDsl)
        if (!compiledProgram) {
            return { success: false, error: 'DSL compilation failed' }
        }

        // 3. Validate layer-step mapping is complete
        const stepMap = this._buildLayerStepMap(newLayers, compiledProgram)
        const allLayersMapped = newLayers.every(l => stepMap.has(l.id))
        if (!allLayersMapped) {
            return { success: false, error: 'Layer mapping incomplete' }
        }

        return { success: true, dsl: newDsl, program: compiledProgram, stepMap }

    } catch (err) {
        return { success: false, error: err.message }
    }
}
```

### Renderer Changes

Add `tryCompile(dsl)` method - compiles without side effects, returns program or null on failure.

Add `commitCompiled(program, dsl, stepMap)` method - applies pre-validated compilation result.

---

## Implementation Structure

### New State Properties in app.js

```javascript
// FSM state
this._reorderState = 'IDLE'  // IDLE | DRAGGING | PROCESSING | ROLLING_BACK
this._reorderSnapshot = null  // { layers, dsl } captured on drag start
this._reorderSource = null    // { layerId, index } of dragged layer
```

### New Methods in app.js

| Method | Purpose |
|--------|---------|
| `_startDrag(layerId)` | IDLE → DRAGGING, capture snapshot |
| `_cancelDrag()` | DRAGGING → IDLE, clear visual state |
| `_processDrop(targetId, position)` | DRAGGING → PROCESSING, validate and commit |
| `_rollback(error)` | PROCESSING → ROLLING_BACK → IDLE, restore snapshot |
| `_validateReorder(newLayers)` | Generate and validate DSL without side effects |
| `_commitReorder(newLayers, validatedResult)` | Apply validated changes |
| `_updateLayerZIndex()` | Set z-index on layer-items |

### Event Flow Changes

1. `layer-item` emits granular events: `layer-drag-start`, `layer-drag-over`, `layer-drag-end`, `layer-drop`
2. `layer-stack` passes these up without processing (remove `_handleReorder`)
3. `app.js` FSM handles all events and orchestrates the transaction

---

## Edge Cases

| Case | Handling |
|------|----------|
| Dragging base layer | Blocked at drag start |
| Dropping on self | No-op, return to IDLE |
| Dropping below base layer | Clamp to index 1 |
| Compile failure | Full rollback with user feedback |
| ESC during drag | Cancel, clear visual state |
| Drop outside valid target | Cancel, clear visual state |

## Error Notifications

- Use existing notification/toast system if available
- Message format: "Layer reorder failed: [reason]. Changes reverted."

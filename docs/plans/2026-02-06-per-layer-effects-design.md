# Per-Layer Effects Design

## Summary

Add the ability to apply filter effects to individual layers before blending. Each layer can have zero or more child effects that form a filter chain on the parent's output. Children render indented below their parent in the layer stack UI.

## Data Model

Each layer object gains a `children` array, defaulting to `[]`. Child effects are lightweight objects:

```js
{
  id: "child-1",
  name: "Outline",
  effectId: "filter/outline",
  effectParams: { ... },
  visible: true
}
```

Children don't have `opacity`, `blendMode`, `offsetX/Y`, `sourceType`, `mediaFile`, `locked`, or their own `children`. They are stored in application order (first child applied first).

The nested model (vs. flat array with `parentId`) keeps children out of the blending order and naturally enforces the no-grandchildren rule.

## DSL Compilation

Children insert between the parent's output write and the blend operation:

```
// Without children:
layer2_effect.write(o1)
read(o0).blendMode(tex: read(o1), ...).write(o2)

// With children (outline, then blur):
layer2_effect.write(o1)
read(o1).outline(...).write(o2)
read(o2).blur(...).write(o3)
read(o0).blendMode(tex: read(o3), ...).write(o4)
```

The blend references the final child's output buffer instead of the parent's. The buffer counter increments as usual.

Visibility rules:
- Hidden child: skip it in the chain
- All children hidden: blend uses parent output directly
- Parent hidden: children skipped entirely

Change is localized to `_buildDsl()` in `renderer.js`.

## UI Components

### layer-item changes

- "+" button added to each layer's controls area
- Clicking "+" opens the effect picker, filtered to filter-type effects only (no synths)
- On selection, child appended to parent's `children` array

### Child rendering in layer-stack

Children render as `<layer-item>` elements below their parent with these differences:

- Indented via CSS class (`child-layer`)
- No blend mode selector
- No opacity slider
- No "+" button

What children keep:
- Visibility toggle
- Editable layer name
- Expandable effect params
- Delete button
- Thumbnail/icon
- Drag handle (reorder constrained to siblings within same parent)

The `<layer-stack>` rendering loop: for each layer (reverse/top-down), render the layer-item, then render its children in order with the indented style.

## App.js Integration

### Event handling

Child `layer-change` events identify both parent and child IDs. The handler locates the parent, finds the child in `children`, and calls `_renderer.updateLayerParams(childId, params)` for live updates. Adding/removing a child triggers `_rebuild()`.

### Undo

Children are captured by the existing deep-clone snapshot (`JSON.parse(JSON.stringify(...))`). No undo mechanism changes needed. Child mutations follow the standard pattern: `_finalizePendingUndo()` before, mutation, `_pushUndoState()` after. Child param changes use `_pushUndoStateDebounced()`.

### Layer step mapping

`_buildLayerStepMap()` maps child IDs to render pass steps so `updateLayerParams(childId, params)` works without full rebuild.

### Layer model

`createLayer()`, `createMediaLayer()`, `createEffectLayer()` each initialize `children: []`. `cloneLayer()` deep-clones children with new IDs.

## Constraints & Edge Cases

- Base layer and media layers can have children
- Effect picker for children excludes synths (use `_isEffectSynth()` or namespace prefix)
- Duplicate layer duplicates children (deep clone)
- Flatten/merge bakes children into result (follows from DSL)
- Child drag-and-drop constrained within parent's children list; cannot become top-level or move to different parent

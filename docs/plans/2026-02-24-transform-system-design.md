# Transform System Design

Date: 2026-02-24

## Overview

Add on-canvas transform controls (scale, rotate, flip) to media and text layers, with GPU-side rendering for non-destructive, resolution-independent transforms and bicubic interpolation.

## Scope

**Supported layers:**
- Media layers (image, video) — full transform support
- Text layers — scale and rotation added to existing position support
- Effect layers — must be rasterized first (procedural shaders are not directly transformable)

**Transform operations:**
- Scale (uniform and non-uniform)
- Rotate (free rotation in degrees)
- Flip horizontal / vertical
- Reset to identity

**Explicitly excluded (for now):**
- Skew / perspective warp
- Per-pixel distortion (covered by Noisemaker effects)
- Per-layer crop (use selection + extract)

## Data Model

Transform fields are stored as flat properties on the layer object (not nested):

```js
layer.scaleX = 1    // scale factor
layer.scaleY = 1
layer.rotation = 0  // degrees
layer.flipH = false
layer.flipV = false
// Position continues using existing offsetX/offsetY fields
```

Default is identity — backward compatible with existing projects. Old projects without transform fields use `??` defaults.

## Interaction Model

### Activation
- Select a layer, then activate the **Transform tool** in the toolbar (keyboard shortcut: `T`)
- Transform handles appear on the canvas around the layer's bounding box
- Clicking outside the handles commits the transform and deactivates

### On-Canvas Handles

```
    [rotate cursor zone]
  o---------------o---------------o
  |                               |
  o            layer              o   <- edge handles (scale one axis)
  |                               |
  o---------------o---------------o
                                      <- corner handles (scale both axes)
```

- 8 scale handles: 4 corners + 4 edge midpoints
- Rotate: cursor changes when hovering just outside a corner; drag to rotate freely
- Move: drag inside the bounding box to reposition
- Handles rotate with the bounding box when the layer is rotated

### Keyboard Modifiers
- **Shift** — constrain aspect ratio (scale) or snap to 15-degree increments (rotate)
- **Alt/Option** — scale from center instead of opposite corner
- **Shift+Alt** — both constraints

### Committing & Canceling
- **Enter** or click outside — commits
- **Escape** — cancels, reverts to pre-transform state
- Switching tools — auto-commits

### Numeric Input
- Layer panel shows editable X, Y, Width, Height, Rotation fields
- Live updates while typing (debounced, same pattern as effect params)

## Architecture

### CPU-Side Transform via OffscreenCanvas (Implemented)

The design originally proposed GPU-side transforms, but the Noisemaker `media()` shader is loaded from a CDN and doesn't expose scale/rotation uniforms. Instead, transforms are applied CPU-side:

- An `OffscreenCanvas` pre-transforms the source image before texture upload
- `imageSmoothingQuality: 'high'` provides bicubic-quality interpolation
- Source pixels are preserved — the transform is recomputed on every change
- The canvas is cached (`this._transformCanvas`) and reused across calls
- Identity transforms skip the offscreen canvas entirely and use the original texture

**Trade-offs vs GPU-side:**
- Quality is excellent for single transforms but slightly degrades on repeated re-transforms (re-rasterization)
- Performance is good — canvas 2D is hardware-accelerated on modern browsers
- Simpler implementation with no shader pipeline changes needed

### Overlay Rendering

Transform handles are drawn on the existing selection overlay canvas:
- 8 scale handles (4 corners + 4 edges) drawn as filled white squares with blue outlines
- Rotation zones detected outside corner handles with visual arc indicators
- Hit testing in local (unrotated) coordinate space
- Scale handles take priority over rotation zones in hit testing
- Handles redraw on layer selection change and after drag operations

### Undo Integration
- Each committed transform is a single undo step
- Intermediate drag states are not pushed
- `_finalizePendingUndo()` called before committing (existing pattern)

### Project Serialization
- `layer.transform` saved alongside existing layer data in IndexedDB
- Old projects get identity transform on load — fully backward compatible

## Edge Cases

- **Video layers** — transform matrix is a uniform, applies to every frame uniformly
- **Selections** — operate in canvas space, not affected by layer transforms
- **Child effects** — apply after parent transform (blur on rotated layer blurs the rotated result)
- **Rasterize** — bakes transform into pixels, resets transform to identity
- **Flatten** — composites the rendered (transformed) result naturally
- **Canvas/image resize** — transforms are pixel-space; image resample scales offsets proportionally
- **Zero-scale guard** — clamp minimum scale to 0.01
- **Base layer** — transforms allowed; may reveal transparent areas

## Testing Plan

- Scale up, down, non-uniform
- Rotate freely and with Shift snap
- Flip horizontal and vertical
- Shift constrains aspect ratio
- Escape cancels, Enter commits
- Undo/redo restores transform state
- Old projects load with identity default
- Rasterize bakes transform into pixels
- Handles update on zoom
- Transform + child effects render correctly
- Numeric input matches visual result

## Interpolation

Bicubic-quality interpolation via `OffscreenCanvas` with `imageSmoothingQuality: 'high'`. Browser implementations typically use Lanczos or Mitchell-Netravali filtering, providing smooth results without nearest-neighbor artifacts.

## Implementation Notes (2026-02-24)

**Files created:**
- `public/js/tools/transform-tool.js` — TransformTool class (~515 lines)
- `tests/transform-tool.spec.js` — 6 E2E tests

**Files modified:**
- `public/js/layers/layer-model.js` — added scaleX, scaleY, rotation, flipH, flipV
- `public/js/noisemaker/renderer.js` — added `updateLayerTransform()`, updated `_applyAllLayerParams()`
- `public/js/app.js` — tool wiring, flip menu, transform callbacks, T shortcut
- `public/index.html` — transform toolbar button, flip menu items
- `public/css/selection.css` — transform tool cursor

**Not yet implemented (future work):**
- Numeric input fields in layer panel
- Text layer transform support (currently media-only)
- Video layer transform support (currently blocked)

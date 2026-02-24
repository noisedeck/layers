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

Per-layer transform state replaces the current `layer.x` / `layer.y` offset fields:

```js
layer.transform = {
  x: 0,        // position offset (pixels)
  y: 0,
  scaleX: 1.0,
  scaleY: 1.0,
  rotation: 0,  // degrees
  flipH: false,
  flipV: false
}
```

Default is identity — backward compatible with existing projects. Old projects without `.transform` get identity on load.

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

### GPU-Side Transform (Recommended Approach)

Pass a transform matrix as uniforms to the Noisemaker pipeline. The shader samples the source texture with the inverse matrix applied to UV coordinates. Bicubic interpolation via a 4x4 sample kernel in the shader.

**Why GPU-side over CPU-side:**
- Truly non-destructive — source pixels untouched
- Resolution-independent — no quality loss on repeated transforms
- Fast — GPU-accelerated
- Fits existing architecture — layers already pass per-step uniforms

### Overlay Rendering

Transform handles are a separate HTML/CSS overlay positioned over the canvas:
- Handle positions calculated from layer bounds x current zoom/pan
- Hit testing via distance-to-handle checks
- Updates on zoom/scroll/resize via existing viewport events
- Clean separation from WebGL render pipeline — always crisp

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

Bicubic interpolation for all scale operations. Implemented as a 4x4 texel sample kernel in the shader, providing smooth results without nearest-neighbor artifacts or bilinear blurriness.

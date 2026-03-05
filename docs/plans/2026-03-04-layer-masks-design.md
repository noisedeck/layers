# Phase 4: Layer Masks — Design Document

**Goal:** Add per-layer grayscale masks for non-destructive compositing. White=visible, black=hidden, gray=partial transparency.

**Dependencies:** Phase 2 (drawing tools) — completed.

---

## 1. Data Model

Each layer gains three new properties:

- `mask` — `ImageData | null`. Grayscale mask at canvas resolution. Red channel stores mask value (0=hidden, 255=visible).
- `maskEnabled` — `boolean`, default `true`. Toggle mask on/off without deleting.
- `maskVisible` — `boolean`, default `false`. Show rubylith overlay on canvas.

App-level state for mask editing:

- `_maskEditMode` — `boolean`. Currently painting on a mask.
- `_maskEditLayerId` — `string | null`. Which layer's mask is being edited.

## 2. Rendering Pipeline

### Shader Change

Extend the existing `alphaMask` mixer effect (upstream at `../noisemaker/shaders/effects/mixer/alphaMask`) with an `int maskMode` uniform:

- `maskMode = 0` — original alpha blend behavior (unchanged)
- `maskMode = 1` — grayscale mask mode: multiply input alpha by mask texture luminance

```glsl
uniform int maskMode;

if (maskMode == 1) {
    float maskVal = dot(texture(tex, st).rgb, vec3(0.299, 0.587, 0.114));
    fragColor = vec4(color1.rgb, color1.a * maskVal);
} else {
    // ...existing alpha blend code...
}
```

### DSL Integration

For layers with an enabled mask, insert a mask step between layer render and blend:

```
// Without mask:
media().write(o1)
read(o0).blendMode(tex: read(o1), mode: mix, mixAmt: 50).write(o2)

// With mask:
media().write(o1)
read(o1).alphaMask(tex: read(maskTex_layerId), maskMode: 1).write(o1m)
read(o0).blendMode(tex: read(o1m), mode: mix, mixAmt: 50).write(o2)
```

### Mask Texture Management

- `_maskTextures` Map on the renderer (parallel to `_mediaTextures`)
- Mask ImageData → OffscreenCanvas → `updateTextureFromSource()`
- Re-upload when mask is edited (after each stroke)

## 3. Mask Editing UX

### Entering Mask Edit Mode

1. Click the mask thumbnail on a layer-item
2. App state: `_maskEditMode = true`, `_maskEditLayerId = layerId`
3. Canvas shows rubylith overlay (semi-transparent red over hidden areas)
4. Drawing tools switch context: brush = white (reveal), eraser = black (hide)
5. Brush opacity slider controls gray level for partial masking

### Rubylith Overlay

- Second canvas element (`#maskOverlay`) positioned over the main canvas
- Rendered when `maskVisible` or `_maskEditMode` is active
- Transparent where mask = 255 (fully visible)
- Semi-transparent red where mask < 255 (partially or fully hidden)
- Updated after each stroke during mask painting

### Exiting Mask Edit Mode

- Click mask thumbnail again
- Press Escape
- Select a different layer
- Sets `_maskEditMode = false`, hides overlay

### Mask Painting

- Reuses `StrokeRenderer` with a temporary offscreen canvas
- Each stroke rasterized, then composited onto the mask ImageData
- After stroke completes: re-upload mask texture, rebuild scene
- Undo: debounced per-stroke (same as drawing layer strokes)

## 4. Layer Stack UI

### Layer-Item Layout (with mask)

```
[👁] [Layer Thumbnail] [Mask Thumbnail] Layer Name
     [opacity slider]  [blend mode ▾]
```

- **Mask thumbnail**: Small grayscale preview, same size as layer thumbnail area
- **Click** → enter mask edit mode (thumbnail gets highlight border)
- **Shift-click** → toggle rubylith overlay without entering edit mode
- **Right-click** → context menu: Invert Mask, Delete Mask, Disable/Enable Mask

### Mask Creation

Right-click layer context menu:

- **Add Layer Mask** → fully white (all-revealed) mask
- **Mask from Selection** → converts current selection to mask (enabled when selection active)

Visual indicators:

- Mask edit mode active: mask thumbnail gets colored border (accent color)
- Disabled mask: thumbnail at reduced opacity with "X" badge

## 5. Selection Integration

### Mask from Selection

`selectionManager.rasterizeSelection()` → ImageData → assign as `layer.mask`

### Selection from Mask

Convert mask back to selection: `selectionManager.setSelection({ type: 'mask', data: layer.mask })`

### Mask Modification Operations

Reuse existing `selection-modify.js` functions directly on mask ImageData:

- Feather Mask → `featherMask(mask, radius)`
- Expand Mask → `expandMask(mask, radius)`
- Contract Mask → `contractMask(mask, radius)`
- Invert Mask → `invertMask(mask)`
- Smooth Mask → `smoothMask(mask, radius)`

Available via mask context menu or Image > Mask submenu.

## 6. Undo/Redo & Serialization

### Undo

- Mask edits follow existing protocol: `_finalizePendingUndo()` → mutation → `_pushUndoState()`
- Mask painting: debounced undo (each completed stroke = one undo step)
- Mask ImageData deep-cloned in undo snapshots

### Serialization

- Masks serialize as base64-encoded PNG in project JSON
- Encode: `layer.mask` → canvas → `toDataURL('image/png')` → base64
- Decode: base64 → Image → canvas → `getImageData()` → ImageData
- `maskEnabled` and `maskVisible` serialize as booleans

# Layer Menu Design

## Overview

Add a "Layer" menu between "File" and "View" with contextual rasterize/flatten operations. This enables destructive operations on effect layers (e.g., moving a selection requires rasterized pixels).

## Menu Structure

The Layer menu contains a single item whose label and behavior changes based on selection:

| Selection State | Menu Item | Enabled |
|----------------|-----------|---------|
| 0 layers selected | "Flatten Image" | Yes |
| 1 media layer | "Rasterize Layer" | No (grayed) |
| 1 non-media layer | "Rasterize Layer" | Yes |
| 2+ layers selected | "Flatten Layers" | Yes |

Menu item text updates dynamically when layer selection changes.

## Rasterize Layer

Converts a single non-media (effect) layer to a media layer.

1. Render the layer's visual contribution to a full-canvas-size offscreen canvas
2. Bake any offset into the pixels (offset resets to 0,0)
3. Convert to PNG blob, create media layer named "{original name} (rasterized)"
4. Replace original layer at same stack position
5. Preserve visibility, blend mode, opacity
6. Select the new layer

## Flatten Layers (2+ selected)

Merges multiple selected layers into one.

1. Render all selected visible layers composited (respecting blend modes, opacities, offsets)
2. Create media layer named "Flattened" at topmost selected layer's position
3. Remove all selected layers (visible and hidden)
4. Bake offsets into pixels, result at 0,0
5. Select the new layer

## Flatten Image (0 selected)

Collapses entire project to single layer.

1. Render entire visible canvas (all visible layers composited)
2. Create media layer named after project or "Flattened Image"
3. Delete all hidden layers
4. Replace entire layer stack with this one layer
5. Select the new layer

## Implementation

**Files to modify:**

- `public/index.html` - Add Layer menu HTML between File and View
- `public/js/app.js`:
  - `_setupLayerMenuHandlers()` - menu click handling
  - `_updateLayerMenu()` - update label/enabled on selection change
  - `_rasterizeLayer(layerId)` - single layer rasterization
  - `_flattenLayers(layerIds)` - multi-layer flatten
  - `_flattenImage()` - full image flatten

**Rendering approach:**

- For rasterize: temporarily hide other layers, render, restore visibility
- For flatten: render current visible state directly
- Use existing OffscreenCanvas and media layer creation patterns

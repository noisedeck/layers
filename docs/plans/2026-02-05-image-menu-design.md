# Image Menu Design

## Overview

Add an "Image" dropdown menu to the menu bar with three operations: crop to selection, image size, and canvas size. Remove the filename display from the menu bar to make room.

## Menu Bar Changes

- Remove `#menuCenter` column and `#menuFilename` element
- Simplify `#menu` grid from 3 columns (left/center/right) to 2 (left/right)
- Add "Image" dropdown between File and Layer in `#menuLeft`

### Image Menu Items

| Item | Behavior | Disabled when... |
|------|----------|-------------------|
| crop to selection | Crops canvas + all layers to selection bounds, clears selection | No active selection |
| image size... | Opens resize dialog — resamples all layers to new dimensions | Never |
| canvas size... | Opens canvas size dialog — changes canvas without resampling | Never |

Disabled items appear grayed out (visible but not clickable).

## Crop to Selection

When invoked:

1. Get the bounding box of the current selection marquee
2. For each layer:
   - Media layers: crop the underlying image data to the bounding box, adjust offsets
   - Effect layers: adjust parameters/offsets relative to new canvas origin
3. Resize the canvas to the bounding box dimensions
4. Clear the selection
5. Re-render

Destructive operation (no undo), consistent with flatten and rasterize.

## Image Size Dialog

Modal dialog with:

- Width and Height number inputs, pre-filled with current canvas dimensions
- Constrain proportions checkbox (checked by default) — changing one dimension auto-updates the other
- Cancel / OK buttons

On OK:

1. Calculate scale factors (newWidth/oldWidth, newHeight/oldHeight)
2. Media layers: resample image data using offscreen canvas `drawImage` scaling
3. Effect layers: scale offset parameters proportionally
4. Resize canvas to new dimensions
5. Re-render

## Canvas Size Dialog

Reuse patterns from existing `canvas-size-dialog.js`. Modal with:

- Width and Height number inputs, pre-filled with current canvas dimensions
- Anchor position: 3x3 grid of radio buttons (top-left through bottom-right), default center
- Cancel / OK buttons

On OK:

1. Calculate content offset based on anchor position and size delta
2. Media layers: reposition by adjusting offsets (no resampling)
3. Effect layers: adjust offset parameters
4. Resize canvas to new dimensions
5. Re-render

Growing adds transparent space. Shrinking crops from edges opposite the anchor.

## Files to Change

- `public/index.html` — remove `#menuCenter`, add Image dropdown
- `public/css/menu.css` — remove center column styles, simplify grid
- `public/js/app.js` — remove `_updateFilename()`, add Image menu handlers, implement crop/resize operations
- `public/js/ui/image-size-dialog.js` — new dialog with constrain-proportions toggle
- `public/js/ui/canvas-size-dialog.js` — refactor, add anchor position grid
- Tests — update any references to filename or menu structure

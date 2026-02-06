# Select Menu Design

## Menu Placement

Logo | File | Edit | Image | Layer | **Select** | View

## Menu Structure

```
Select All          ⌘A
Select None         ⌘D
Select Inverse      ⇧⌘I
─────────────────────
Color Range...
─────────────────────
Border...
Smooth...
Expand...
Contract...
Feather...
```

## State Rules

- **Always enabled:** Select All, Color Range
- **Require active selection:** Select None, Inverse, Border, Smooth, Expand, Contract, Feather
- State updated via `_updateSelectMenu()` called from the existing `onSelectionChange` callback

## Keyboard Shortcuts

- `⌘A` — Select All
- `⌘D` — Select None
- `⇧⌘I` — Select Inverse

Modification operations have no shortcuts (menu only).

## Operations

### Select All

Creates a rect selection matching canvas dimensions. No mask conversion needed.

### Select None

Calls existing `clearSelection()`.

### Select Inverse

Converts the current selection path to a mask (if not already one), then inverts the mask alpha channel. Selected areas become unselected, unselected areas become selected. No layer data is read or modified.

### Color Range

1. User clicks Select > Color Range
2. Cursor changes to eyedropper
3. User clicks a pixel on the canvas
4. All pixels matching that color (within current wand tolerance) are selected globally (non-contiguous)
5. Cursor returns to normal

Reuses the wand tolerance slider value. Implementation: scan entire flattened image, compare each pixel to sampled color using same sum-of-absolute-differences formula as flood fill.

### Modification Operations

Border, Smooth, Expand, Contract, and Feather each prompt the user for a pixel radius via a reusable parameter dialog, then modify the current selection mask.

**Default values:** Border=1, Smooth=2, Expand=1, Contract=1, Feather=2

## Mask Modification Algorithms

All modification operations work on rasterized masks (ImageData alpha channel). Any geometric selection (rect, oval, lasso, polygon) gets converted to a mask first via the existing `_rasterizeSelection()` method. The result is always `{ type: 'mask', data: ImageData }`.

### Distance Field Approach

A shared helper `computeDistanceFields(mask)` computes two distance arrays using the Meijster two-pass algorithm (exact Euclidean distance, O(n) for the full image, independent of radius):

- `distOutside[i]` — distance from each unselected pixel to nearest selected pixel
- `distInside[i]` — distance from each selected pixel to nearest unselected pixel

Operations threshold against these fields:

- **Expand(r):** Select pixel if `distOutside[i] <= r`
- **Contract(r):** Deselect pixel if `distInside[i] <= r`
- **Border(r):** Select pixel if `distInside[i] <= r` (pixels within r of the edge, on the inside)
- **Feather(r):** Map `distInside` and `distOutside` near the boundary to a smooth alpha gradient (linear ramp over r pixels)

### Smooth

Uses 3-pass box blur (approximates Gaussian) on the mask alpha channel, then re-thresholds at 128 for a hard edge. O(n) per pass. Distance field not needed.

## Parameter Dialog

New component: `selection-param-dialog.js`

A reusable dialog for operations that need a single numeric input:

- Title shows the operation name (e.g. "Expand Selection")
- Single labeled input field ("Radius:" or "Width:") with a number input
- OK / Cancel buttons
- Returns a promise that resolves with the value or null on cancel
- Styled to match existing dialogs (image-size-dialog, canvas-size-dialog)

## Undo

Selection operations do not participate in the undo stack. The undo system tracks layers and canvas size only. This matches Photoshop behavior.

## File Structure

### New Files

- `public/js/ui/selection-param-dialog.js` — reusable numeric input dialog
- `public/js/selection/selection-modify.js` — pure functions for mask operations (inverse, expand, contract, border, smooth, feather, color range) and distance field computation

### Modified Files

- `public/index.html` — add Select menu HTML between Layer and View, add script tags
- `public/js/app.js` — wire up menu handlers, `_updateSelectMenu()`, Color Range eyedropper mode
- `public/js/selection/selection-manager.js` — expose method to set selection from external mask, color range sampling

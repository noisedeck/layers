# Marquee Selection Feature Design

**Date:** 2026-02-01
**Status:** Approved

## Overview

Add marquee selection capability to Layers, enabling users to select regions of the canvas and copy/paste pixel data. This is the first interactive canvas tool in the application.

## Scope

### Version 1 (This Design)

- Rectangle and Oval selection tools
- Drag-to-draw with Shift to constrain proportions
- Marching ants on Canvas 2D overlay
- Replace mode (new selection replaces old)
- Multi-layer selection in layer panel (Cmd+click, Shift+click)
- Copy flattened composite of visible selected layers
- Paste as new media layer (in-place or centered)
- Deselect via click-outside, Escape, Cmd+D
- Selection tool dropdown in menu bar
- `M` key to cycle tools

### Deferred to v2

- Lasso (freehand) selection
- Polygon selection
- Magic wand (color-based selection with tolerance)
- Feathering (soft selection edges)
- Add/subtract/intersect selection modes (Shift/Alt modifiers)
- Select menu (Deselect, Select All, Inverse)
- Selection transforms (move, resize selection)

## Architecture

### Selection State Model

New `SelectionManager` class that owns:

- `currentTool`: `'rectangle' | 'oval'` (default: `'rectangle'`)
- `selectionPath`: Vector data describing the current selection (null when no selection)
  - Rectangle: `{ type: 'rect', x, y, width, height }`
  - Oval: `{ type: 'oval', cx, cy, rx, ry }`
- `isDrawing`: Boolean for drag state
- `drawStart`: Starting coordinates when drag began

### Canvas Overlay

A new transparent `<canvas id="selectionOverlay">` sits above the main render canvas, same dimensions. This overlay:

- Receives all mouse events (becomes the interactive layer)
- Draws marching ants via 2D context
- Passes through to main canvas for display purposes only

### Rasterization

When copy is triggered, `SelectionManager.rasterize()` creates an `OffscreenCanvas`, draws the vector path filled white on black, returns the mask for pixel operations.

## Interaction Flow

### Drawing a Selection

1. User moves mouse over canvas → cursor changes to crosshair
2. Mousedown on overlay canvas → record `drawStart` coordinates, set `isDrawing = true`
3. Mousemove while drawing → calculate bounds from `drawStart` to current position
   - If Shift held: constrain to square (rect) or circle (oval)
   - Render preview shape on overlay (dashed line, not yet marching)
4. Mouseup → finalize `selectionPath`, start marching ants animation, set `isDrawing = false`

### Marching Ants Animation

- `requestAnimationFrame` loop updates `lineDashOffset` to create movement
- Draws the path with alternating black/white dashes for visibility on any background
- Animation runs continuously while selection exists
- Stops and clears overlay when selection is cleared

### Clearing Selection

Any of these clears `selectionPath` and stops animation:

- Click on overlay outside current selection bounds
- Press Escape key
- Press Cmd/Ctrl+D
- (Future: Select menu → Deselect)

## Copy & Paste Operations

### Copy (Cmd/Ctrl+C)

1. Check for active selection - if none, do nothing
2. Gather selected layers that are also visible (skip hidden)
3. Create temporary `OffscreenCanvas` at selection bounds size
4. For each layer (bottom to top), composite pixels within selection bounds using layer's blend mode and opacity
5. Apply selection mask (rasterized from vector path) as alpha
6. Write result to clipboard via `navigator.clipboard.write()` as PNG blob
7. Store source coordinates internally for paste-in-place

### Paste (Cmd/Ctrl+V)

1. Read from clipboard via `navigator.clipboard.read()`
2. If image data found:
   - Create new media layer with clipboard contents
   - Position at stored source coordinates (if pasting from internal copy)
   - Position at canvas center (if external paste or no stored coords)
   - Insert layer above currently selected layer
   - Auto-select the new layer
3. If no image data, do nothing (no error)

### Clipboard Integration

Uses the async Clipboard API for cross-app compatibility. Users can copy in Layers and paste in other apps, or copy from other apps and paste as new layers.

## Multi-Layer Selection

### Extending LayerStack

Currently `_selectedLayerId` holds a single ID. Change to `_selectedLayerIds: Set<string>` to track multiple selections.

### Selection Interactions

- **Plain click** on layer: Clear all, select only this layer
- **Cmd/Ctrl+click**: Toggle this layer in/out of selection set
- **Shift+click**: Select range from last-clicked layer to this one (inclusive)

### Visual Feedback

- Selected layers keep existing cyan border/shadow treatment
- Multiple layers can show this simultaneously
- Consider subtle "primary" indicator on most recently clicked layer (the anchor for shift-click ranges)

### API Changes

- `layerStack.selectedLayerIds` → returns `Array<string>`
- `layerStack.selectedLayers` → returns array of layer data objects
- Events update to emit array: `detail: { selectedIds: [...] }`
- Backward compat: `selectedLayerId` (singular) returns first/primary selection

## Menu Bar UI

### Selection Tool Button

Added to `#menuRight`, before the play/pause button:

```
[Selection ▾] [▶]
```

- Button shows icon for current tool (rectangle or oval outline icon)
- Click opens dropdown menu with:
  - Rectangle Select (with icon)
  - Oval Select (with icon)
- Checkmark or highlight indicates current tool
- Selecting an option closes dropdown, updates button icon

### Styling

- Match existing menu button styling (glass morphism, backdrop blur)
- Dropdown appears below button, same style as File/View menus
- Icons: Use Material Icons (`crop_square` for rect, `circle` outline for oval) or simple SVG shapes

### Mobile Considerations

- On narrow screens (<910px), button may need to be icon-only (no text)
- Dropdown should remain usable on touch devices

### Keyboard Shortcut

- `M` key cycles between selection tools (Photoshop convention)

## File Structure

### New Files

- `public/js/selection/selection-manager.js` - Core state and logic
- `public/js/selection/marching-ants.js` - Animation rendering
- `public/js/selection/clipboard-ops.js` - Copy/paste with clipboard API
- `public/css/selection.css` - Cursor styles, any selection-specific UI

### Modified Files

- `public/index.html` - Add selection overlay canvas, selection tool button in menu
- `public/js/app.js` - Initialize SelectionManager, wire up keyboard shortcuts (Cmd+C, Cmd+V, Cmd+D, Escape, M)
- `public/js/layers/layer-stack.js` - Change from single to multi-select (Set-based)
- `public/js/layers/layer-item.js` - Handle Cmd+click and Shift+click modifiers
- `public/css/menu.css` - Styles for selection tool dropdown

### Event Flow

```
User drags on overlay
    → SelectionManager handles mouse events
    → Updates selectionPath
    → Triggers marching ants redraw

User presses Cmd+C
    → App catches keydown
    → Calls SelectionManager.copy(layerStack.selectedLayers)
    → SelectionManager composites and writes to clipboard

User presses Cmd+V
    → App catches keydown
    → Calls SelectionManager.paste()
    → SelectionManager reads clipboard, emits 'paste-layer' event
    → App creates new media layer with image data
```

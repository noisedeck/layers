# Move Tool Design

## Overview

A move tool that repositions layers or extracts selections to new moveable layers, similar to Photoshop's move tool.

## Core Behavior

### No Selection Active

When no selection is active, dragging moves the entire current layer:

1. Mouse down on canvas begins tracking
2. Mouse move updates layer's x/y offset in real-time (live preview)
3. Mouse up finalizes position

### With Selection Active

When a selection exists, the first drag extracts and moves:

1. On first mouse down + drag start:
   - Extract selected pixels from current layer
   - Fill the extracted area with transparent pixels (leave a hole)
   - Create a new layer containing only the extracted pixels
   - Insert new layer immediately above the source layer
   - Make new layer the active layer
   - Preserve selection marquee (marching ants) around the content
2. Continue with normal move behavior on the new layer
3. Subsequent drags move the layer without further extraction

## Edge Cases

### Multiple Layers Selected

Show a dialog: "Moving multiple layers is not yet supported. Please select a single layer."

No action taken on the layers. Tool remains active.

### Other Cases

- **No layers exist**: Move tool does nothing
- **Canvas boundaries**: Allow layers to move partially or fully off-canvas (no clamping)
- **During playback**: Move works normally, affects layer position for all frames

## UI

### Toolbar Button

- Position: Immediately left of the selection marquee tool
- Icon: Four-way arrow (cross with arrowheads)
- Tooltip: "Move Tool"
- Styling: Match existing toolbar button styles

### Cursor

- Four-way arrow cursor when move tool is active

### Layer Naming

Extracted layers follow existing naming conventions (e.g., `Layer N`).

## Implementation

### New Files

- `/public/js/tools/move-tool.js`

### Move Tool Class Structure

```
MoveTool
├── activate()          - called when tool selected
├── deactivate()        - called when switching away
├── onMouseDown(e)      - begin tracking, check for multi-layer
├── onMouseMove(e)      - update position (live preview)
├── onMouseUp(e)        - finalize move
├── extractSelection()  - cut pixels, create new layer
└── showMultiLayerDialog()
```

### Integration Points

- `app.js`: Register move tool, wire up toolbar button
- Toolbar HTML: Add move button before selection marquee
- Layer system: Use existing layer creation/positioning APIs
- Selection system: Read current selection mask, clear pixels from source layer
- Renderer: Layer offset changes trigger re-render automatically

### Selection Extraction Logic

1. Get selection mask from current selection tool
2. Read pixels from source layer within selection bounds
3. Create ImageData with only selected pixels (rest transparent)
4. Clear those pixels on source layer (set to transparent)
5. Create new layer from extracted ImageData
6. Position new layer at selection's original coordinates

## Out of Scope

- Moving multiple layers at once
- Keyboard shortcut (V)
- Undo/redo integration (unless already automatic)

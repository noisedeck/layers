# Drawing & Annotation Tools Design

Date: 2026-02-28

Phase 2 of the feature roadmap. Adds brush, eraser, shape, and flood fill tools with vector-based stroke storage and a new drawing layer type.

## Design Decisions

- **Stroke storage**: Vector paths (resolution-independent, non-destructive editing of individual strokes)
- **Eraser model**: Whole-stroke deletion (click/drag to remove strokes)
- **Fill output**: Raster layer (reads composited pixels, flood fills region)
- **Layer targeting**: Paint on current drawing layer if selected; auto-create new drawing layer otherwise
- **Architecture**: New `sourceType: 'drawing'` layer type, rasterized to texture for the Noisemaker pipeline

## Data Model

### Drawing Layer

New `sourceType: 'drawing'` alongside existing `'media'` and `'effect'`:

```javascript
Layer {
    sourceType: 'drawing',
    strokes: Stroke[],         // ordered vector stroke data
    drawingCanvas: null,       // runtime only — OffscreenCanvas for rasterization (not serialized)
}
```

### Stroke Types

```javascript
Stroke {
    id: string,                // unique ID for eraser targeting
    type: 'path' | 'rect' | 'ellipse' | 'line' | 'arrow',
    color: string,             // hex or rgba
    size: number,              // brush/stroke width in pixels
    opacity: number,           // 0-1 per-stroke opacity
    points: [{x, y}],         // for path type (brush strokes)
    // For shapes:
    x: number, y: number,     // top-left origin
    width: number, height: number,
    filled: boolean,           // stroke vs fill for shapes
}
```

Stroke coordinates are in canvas pixel space (same coordinate system as selection and transform tools).

## File Structure

```
public/js/tools/
├── brush-tool.js        # Freehand path drawing
├── eraser-tool.js       # Click/drag to delete strokes
├── shape-tool.js        # Rectangle, ellipse, line, arrow
└── fill-tool.js         # Flood fill to raster layer

public/js/drawing/
├── stroke-renderer.js   # Rasterizes strokes[] → OffscreenCanvas
└── stroke-model.js      # Stroke data structures & factory functions
```

## Tool Mode Integration

Tools register in `_setToolMode()` alongside existing tools. Toolbar layout:

```
[Selection ▾] [Move] [Clone] [Transform] [Brush] [Eraser] [Shape ▾] [Fill]
```

Shape tool gets a dropdown for shape type (rectangle, ellipse, line, arrow), matching the selection tool's dropdown pattern.

### Auto-Create Logic

```javascript
_ensureDrawingLayer() {
    const active = this._getActiveLayer();
    if (active?.sourceType === 'drawing') return active;
    const layer = createDrawingLayer(`Drawing ${this._nextDrawingIndex++}`);
    this._insertLayerAbove(active, layer);
    return layer;
}
```

## Rendering Pipeline

### Rasterization Flow

```
strokes[] → StrokeRenderer.rasterize(strokes, width, height)
         → OffscreenCanvas (2D context)
         → Register as texture in LayersRenderer (same path as image layers)
         → DSL: media("drawing-layer-0", "bicubic") + blendMode(...)
```

### StrokeRenderer

Draws strokes onto a 2D canvas context:

- **Path strokes**: `beginPath()`, `moveTo()`, `quadraticCurveTo()` with `lineCap: 'round'`, `lineJoin: 'round'`
- **Shapes**: `strokeRect()`/`fillRect()`, `ellipse()`, `moveTo()`/`lineTo()`
- **Arrows**: Line with arrowhead computed from endpoint angle, head size proportional to stroke width
- **Per-stroke opacity**: `globalAlpha`

### Texture Registration

Drawing layers register their OffscreenCanvas as a texture source in the renderer's `mediaTextures` map. WebGL reads canvas elements directly as texture sources.

### DSL Integration

In `LayersRenderer._buildDsl()`, drawing layers compile identically to media layers:

```javascript
case 'drawing':
    dsl += `media("${layer.id}", "bicubic")\n`;
    dsl += `blendMode("${layer.blendMode}", ${layer.opacity / 100})\n`;
    break;
```

Transform properties (offsetX, scaleX, rotation, etc.) apply the same way — drawing layers are fully transformable.

### Re-rasterization Triggers

- Stroke added (mouseup on brush/shape tool)
- Stroke deleted (eraser)
- Strokes array restored from undo
- Project loaded from storage

Rasterization is cached — only re-renders when strokes change, not every frame.

## Tool Behaviors

### Brush Tool (`B`)

- Mousedown starts a path stroke, mousemove accumulates points with distance-based sampling (min 2px between points), mouseup finalizes
- Quadratic Bezier interpolation between raw points for smooth curves
- Live preview on overlay canvas during drag; rasterized to drawing layer on commit
- Cursor: circle outline sized to current brush diameter

### Eraser Tool (`E`)

- Click near a stroke to delete it
- Hit testing: check if click point is within `strokeWidth/2 + tolerance` of any stroke's path segments or shape bounds
- Hover highlight: stroke under cursor drawn in a different color on the overlay
- Drag-delete: drag across multiple strokes to delete all touched strokes in one undo step

### Shape Tool (`U`)

- Mousedown sets origin, mousemove previews on overlay, mouseup finalizes
- Shift constrains to square/circle (same as selection tools)
- Arrow: line with computed arrowhead, head size proportional to stroke width
- Preview: dashed outline during drag, solid on commit

### Fill Tool (`G`)

- Click on canvas → read composited WebGL output → flood fill from click point
- Reuses existing `flood-fill.js` scanline algorithm with tolerance
- Creates a new **media-type layer** (not drawing layer) with filled pixels as canvas texture
- Uses current brush color

## Drawing Options Bar

Contextual options shown when a drawing tool is active:

- **Brush**: color picker, size slider (1-100px), opacity slider
- **Eraser**: no options
- **Shape**: color picker, size (stroke width), filled/outlined toggle
- **Fill**: color picker, tolerance slider (0-255)

Tool options persist across tool switches.

## Undo Integration

- Each stroke add or eraser delete calls `_pushUndoState()`
- Full `strokes[]` array is deep-cloned in undo snapshots (same pattern as effectParams)
- `_finalizePendingUndo()` called before mutations
- `_restoreState()` re-rasterizes from restored strokes and calls `_rebuild({ force: true })`
- No debouncing needed — strokes are discrete events

## Serialization

- `strokes[]` serializes naturally (plain objects with numbers/strings)
- `drawingCanvas` is skipped (runtime only, rebuilt from strokes on load)
- Vector paths are compact — hundreds of strokes are small compared to image data

## Layer Stack UI

- Drawing layers show a pencil icon
- Thumbnail rendered from the OffscreenCanvas
- Context menu works the same (duplicate, delete, merge down, etc.)
- **Merge down**: rasterizes drawing layer and composites onto layer below; result becomes a media layer

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `B` | Brush tool |
| `E` | Eraser tool |
| `U` | Shape tool |
| `G` | Fill tool |
| `[` | Decrease brush size by 5px |
| `]` | Increase brush size by 5px |

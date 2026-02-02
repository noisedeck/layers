# Marquee Selection V2 Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add lasso, polygon, and magic wand selection tools with add/subtract modifiers.

**Architecture:** Extend SelectionManager with new tool types, rasterize to mask for boolean operations.

**Tech Stack:** Canvas 2D, ImageData for masks, queue-based flood fill.

---

## Tool Overview

Five selection tools in a single dropdown menu:

| Tool | Behavior |
|------|----------|
| Rectangle | Drag to draw rectangular selection (existing) |
| Oval | Drag to draw elliptical selection (existing) |
| Lasso | Freehand draw, auto-closes on mouse up |
| Polygon | Click vertices, double-click or click start to close, Escape cancels |
| Magic Wand | Click to select contiguous similar colors |

**Selection modifiers (all tools):**
- **Shift + draw/click**: Add to existing selection
- **Alt/Option + draw/click**: Subtract from existing selection
- **No modifier**: Replace existing selection

**Removed**: M key cycling. Tool selection via dropdown only.

---

## Selection Path Data Model

Extend the current `SelectionPath` type:

```typescript
// Existing
type RectSelection = { type: 'rect', x, y, width, height }
type OvalSelection = { type: 'oval', cx, cy, rx, ry }

// New
type LassoSelection = {
  type: 'lasso',
  points: Array<{x, y}>  // Closed polygon from freehand
}

type PolygonSelection = {
  type: 'polygon',
  points: Array<{x, y}>  // User-placed vertices
}

type WandSelection = {
  type: 'wand',
  mask: ImageData  // Rasterized selection mask
}

type MaskSelection = {
  type: 'mask',
  data: ImageData  // Combined selection result
}
```

Lasso and Polygon store point arrays. Magic Wand produces a pixel mask. Combined selections become masks.

---

## Rendering & Marching Ants

**Lasso and Polygon**: Stroke path with `moveTo()` + `lineTo()` through points, `closePath()`. Animate dash offset for marching ants.

**Magic Wand / Mask**: Edge detection - walk the mask, draw dashed lines where selected pixels border unselected pixels.

**Preview while drawing:**
- Lasso: Dashed line following cursor as user draws
- Polygon: Placed vertices + line from last vertex to cursor
- Magic Wand: Selection appears immediately on click (no preview)

---

## Magic Wand Algorithm

**Sampling source**: Composite selected layers to offscreen canvas, read ImageData.

**Algorithm**: Queue-based flood fill from click point
1. Get color at click point (R, G, B, A)
2. Flood fill to find all contiguous pixels within tolerance
3. Store result as ImageData mask (255 = selected, 0 = not)

**Tolerance calculation**:
```javascript
const diff = Math.abs(r1 - r2) + Math.abs(g1 - g2) +
             Math.abs(b1 - b2) + Math.abs(a1 - a2)
const match = diff <= (tolerance * 4)  // tolerance 0-255
```

**Tolerance slider**: Range 0-255, default 32. Appears in menu when Magic Wand selected.

---

## Combining Selections (Add/Subtract)

When Shift or Alt is held:
1. Rasterize current selection to mask (if not already)
2. Rasterize new selection to mask
3. Combine masks:
   - Add: `mask[i] = oldMask[i] | newMask[i]`
   - Subtract: `mask[i] = oldMask[i] & ~newMask[i]`
4. Store combined result as `type: 'mask'`

Once a selection becomes a mask, it stays a mask.

---

## Clipboard Operations

**Copy** applies mask based on selection type:
- Rectangle: No mask needed
- Oval: Existing `applyOvalMask()`
- Lasso/Polygon: New `applyPolygonMask()` using path fill
- Wand/Mask: New `applyImageMask()` using ImageData alpha

**Paste**: Unchanged - positions at copy origin or center.

---

## Edge Cases

**Lasso:**
- Very short drag: Ignore, no selection
- Self-intersecting: Allow, use even-odd fill rule

**Polygon:**
- Escape mid-draw: Cancel
- Only 2 points: Not valid, ignore
- Click near start (<10px): Snap to close

**Magic Wand:**
- Click transparent pixel: Select contiguous transparent
- No layers selected: Use all visible layers
- Click outside canvas: Ignore

**Modifiers:**
- Shift with no selection: Creates new selection
- Subtract removes everything: Clear selection
- Switch tools mid-draw: Cancel operation

---

## UI Changes

**Menu items** - add to dropdown:
```html
<div id="selectLassoMenuItem">
  <span class="icon-material">gesture</span>
  Lasso
</div>
<div id="selectPolygonMenuItem">
  <span class="icon-material">pentagon</span>
  Polygon
</div>
<div id="selectWandMenuItem">
  <span class="icon-material">auto_fix_high</span>
  Magic Wand
</div>
```

**Tolerance slider** - visible when Magic Wand selected:
```html
<div id="wandToleranceRow" class="menu-slider-row hide">
  <label>Tolerance</label>
  <input type="range" id="wandTolerance" min="0" max="255" value="32">
  <span id="wandToleranceValue">32</span>
</div>
```

**Icon updates** based on tool:
- Rectangle: `square`
- Oval: `lens`
- Lasso: `gesture`
- Polygon: `pentagon`
- Magic Wand: `auto_fix_high`

---

## File Changes

**Modify:**
| File | Changes |
|------|---------|
| `selection-manager.js` | Add lasso, polygon, wand tools; add/subtract modes; mask rasterization |
| `clipboard-ops.js` | Add polygon and mask clipping functions |
| `index.html` | Add 3 menu items, tolerance slider row |
| `menu.css` | Style for slider row in dropdown |
| `app.js` | Remove M key handler, add tolerance state, wire up new menu items |

**Create:**
| File | Purpose |
|------|---------|
| `selection/flood-fill.js` | Queue-based flood fill for magic wand |

**No changes needed:**
- Renderer/shader code
- Layer model
- Project storage

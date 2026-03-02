# Color Well, Eyedropper & Tool UI Design

Date: 2026-03-01

Introduces a global foreground color with toolbar color well, an eyedropper tool, and refactors both the selection and shape tool buttons to a split-button dropdown pattern. Cleans up the shape tool to box + oval only.

## Design Decisions

- **Global foreground color**: App-level `_foregroundColor` property, all drawing tools read from it
- **Color well**: Toolbar swatch (always visible), clicking opens native color picker
- **Eyedropper**: Dedicated tool button, reads pixel from WebGL canvas, sets foreground color, auto-returns to previous tool
- **Split-button dropdowns**: Both selection and shape tools get the noisedeck-style split-button (main button + caret dropdown)
- **Shape types**: Reduced to box + oval (line/arrow dropped)
- **Options bar**: Color input removed (replaced by toolbar swatch), keeps size/opacity/filled/tolerance

## 1. Global Foreground Color

### Data Model

```javascript
// In LayersApp constructor
this._foregroundColor = '#000000'
```

All drawing tools (brush, shape, fill) read `this._foregroundColor` when creating strokes. The per-tool `_color` properties are removed — tools reference the app's foreground color via a callback.

### Toolbar Color Well

```html
<div id="colorWell" class="color-well" title="Foreground Color">
    <input type="color" id="colorWellInput" value="#000000">
</div>
```

Placed in the toolbar between the separator and brush button. The swatch is ~24x24px. The native `<input type="color">` is styled to fill the swatch invisibly (opacity: 0, positioned absolute) so clicking the swatch opens the system color picker.

```css
.color-well {
    position: relative;
    width: 24px;
    height: 24px;
    border: 2px solid var(--border-color, #555);
    border-radius: 4px;
    cursor: pointer;
    overflow: hidden;
}

.color-well input[type="color"] {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
    border: none;
    padding: 0;
}
```

### Wiring

On `input` event of `#colorWellInput`:
- Update `this._foregroundColor`
- Update swatch background: `colorWell.style.backgroundColor = color`
- Push to all tool instances that use color

The options bar's color input (`#drawingColorInput`) is removed.

## 2. Eyedropper Tool

### Toolbar Button

```html
<button id="eyedropperToolBtn" class="menu-icon-btn" title="Eyedropper (I)">
    <span class="icon-material">colorize</span>
</button>
```

Placed in the toolbar with the other drawing tools. Keyboard shortcut: `I`.

### Tool Class

```
public/js/tools/eyedropper-tool.js
```

Simple click-only tool:
- `activate()`: Add click listener on overlay, set cursor to crosshair
- `deactivate()`: Remove listener
- On click: Read pixel from WebGL canvas at click coords, convert to hex, call `setForegroundColor(hex)` callback
- After setting color, call `restorePreviousTool()` callback to auto-switch back

### Pixel Reading

Read a single pixel from the WebGL canvas:

```javascript
const gl = canvas.getContext('webgl') || canvas.getContext('webgl2')
const pixels = new Uint8Array(4)
// WebGL Y is flipped
gl.readPixels(x, canvas.height - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
const hex = `#${[pixels[0], pixels[1], pixels[2]].map(v => v.toString(16).padStart(2, '0')).join('')}`
```

### Auto-Return Behavior

When eyedropper activates, store the current tool in `this._previousTool`. After sampling a color, call `_setToolMode(this._previousTool)` to return.

## 3. Split-Button Dropdown Pattern

### HTML Structure (reusable for both tools)

```html
<div class="menu tool-split-btn" id="shapeMenu">
    <button id="shapeToolBtn" class="menu-icon-btn" title="Shape Tool (U)">
        <span class="icon-material">crop_square</span>
    </button>
    <span class="menu-title tool-caret icon-material">arrow_drop_down</span>
    <div class="menu-items hide">
        <div class="tool-menu-item checked" data-shape="rect">
            <span>Box</span><span class="icon-material">crop_square</span>
        </div>
        <div class="tool-menu-item" data-shape="ellipse">
            <span>Oval</span><span class="icon-material">circle</span>
        </div>
    </div>
</div>
```

### CSS

```css
.tool-split-btn {
    display: inline-flex;
    align-items: center;
    position: relative;
}

.tool-caret {
    font-size: 1rem;
    cursor: pointer;
    color: var(--text-secondary, #aaa);
    user-select: none;
    line-height: 1;
}

.tool-caret:hover {
    color: var(--text-primary, #eee);
}

.tool-menu-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.75em;
}
```

### Behavior

- **Main button click**: Activates the tool with current (last-used) shape type
- **Caret click**: Toggles dropdown via existing `.menu-title` handler
- **Dropdown item click**: Sets shape type, updates main button icon, closes dropdown, activates tool
- **Icon swap**: `syncToolIcon(toolBtnId, iconName)` updates the `<span class="icon-material">` text content
- **Checked state**: `.checked` class on the selected item

### Selection Tool Refactor

Replace the current selection menu structure with the split-button pattern:

Items:
| data-shape | Label | Icon |
|-----------|-------|------|
| rectangle | Box | crop_square |
| oval | Oval | circle |
| lasso | Lasso | gesture |
| polygon | Polygon | polyline |
| wand | Magic Wand | auto_fix_high |

Wand tolerance slider moves to the options bar (shown when selection tool + wand is active).

### Shape Tool Dropdown

Items:
| data-shape | Label | Icon |
|-----------|-------|------|
| rect | Box | crop_square |
| ellipse | Oval | circle |

## 4. Shape Tool Cleanup

- Remove `line` and `arrow` from shape-tool.js `_shapeType` options
- Remove line/arrow preview drawing from `_drawPreview()`
- Remove line/arrow stroke creation from `_onMouseUp()`
- Keep `createLineStroke` in stroke-model.js (backward compat for existing projects)
- Stroke renderer keeps all draw methods (backward compat)

## 5. Options Bar Simplification

Remove:
- `#drawingColorInput` label and input (replaced by toolbar color well)

Keep:
- Size input (brush, shape)
- Opacity slider (brush, shape)
- Filled checkbox (shape only)
- Tolerance slider (fill only)

The options bar becomes tool-settings-only, not color.

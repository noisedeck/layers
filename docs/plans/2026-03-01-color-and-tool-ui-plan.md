# Color Well, Eyedropper & Tool UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a global foreground color with toolbar swatch, eyedropper tool, and refactor selection + shape tool buttons to split-button dropdowns.

**Architecture:** Global `_foregroundColor` on LayersApp replaces per-tool color. Toolbar color well is always visible. Eyedropper reads WebGL pixels. Both selection and shape tools adopt noisedeck-style split-button pattern (main button + caret dropdown). Shape tool reduced to box + oval.

**Tech Stack:** Vanilla ES modules, Canvas 2D/WebGL for eyedropper, Playwright E2E tests.

**Design doc:** `docs/plans/2026-03-01-color-and-tool-ui-design.md`

---

## Dependency Graph

```
Task 1 (foreground color) ── Task 2 (color well UI) ── Task 3 (eyedropper)
                                                              │
Task 4 (split-button CSS) ── Task 5 (selection refactor) ────┤
                          └── Task 6 (shape dropdown)         │
                                                              │
Task 7 (shape cleanup) ── Task 8 (options bar cleanup) ── Task 9 (validation)
```

Tasks 5-6 can run in parallel (both depend on Task 4).

---

### Task 1: Global Foreground Color Property

**Files:**
- Modify: `public/js/app.js` (constructor ~line 59, tool instantiation ~lines 377-418)
- Modify: `public/js/tools/brush-tool.js` (color getter/setter ~line 39-40)
- Modify: `public/js/tools/shape-tool.js` (color getter/setter ~line 43-44)
- Modify: `public/js/tools/fill-tool.js` (color getter/setter ~line 29-30)
- Test: `tests/foreground-color.spec.js`

**Step 1: Write the failing test**

```javascript
// tests/foreground-color.spec.js
import { test, expect } from 'playwright/test'

async function createTransparentProject(page) {
    await page.waitForSelector('.open-dialog-backdrop.visible')
    await page.click('.media-option[data-type="transparent"]')
    await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
    await page.click('.canvas-size-dialog .action-btn.primary')
    await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
    await page.waitForTimeout(500)
}

test.describe('Foreground color', () => {
    test('app has a foreground color property defaulting to black', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)

        const color = await page.evaluate(() => window.layersApp._foregroundColor)
        expect(color).toBe('#000000')
    })

    test('setForegroundColor updates all tools', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)

        await page.evaluate(() => {
            window.layersApp._setForegroundColor('#ff0000')
        })

        const colors = await page.evaluate(() => ({
            app: window.layersApp._foregroundColor,
            brush: window.layersApp._brushTool.color,
            shape: window.layersApp._shapeTool.color,
            fill: window.layersApp._fillTool.color
        }))

        expect(colors.app).toBe('#ff0000')
        expect(colors.brush).toBe('#ff0000')
        expect(colors.shape).toBe('#ff0000')
        expect(colors.fill).toBe('#ff0000')
    })

    test('brush tool uses foreground color for strokes', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)

        await page.evaluate(() => {
            window.layersApp._setForegroundColor('#00ff00')
        })

        await page.click('#brushToolBtn')
        const overlay = await page.$('#selectionOverlay')
        const box = await overlay.boundingBox()
        await page.mouse.move(box.x + 100, box.y + 100)
        await page.mouse.down()
        await page.mouse.move(box.x + 200, box.y + 200)
        await page.mouse.up()
        await page.waitForTimeout(300)

        const strokeColor = await page.evaluate(() => {
            const layer = window.layersApp._layers.find(l => l.sourceType === 'drawing')
            return layer?.strokes[0]?.color
        })
        expect(strokeColor).toBe('#00ff00')
    })
})
```

**Step 2: Run test to verify it fails**

Run: `npx playwright test tests/foreground-color.spec.js --reporter=line`
Expected: FAIL — `_foregroundColor` undefined

**Step 3: Implement global foreground color**

In `public/js/app.js` constructor (near line 59), add:
```javascript
this._foregroundColor = '#000000'
```

Add `_setForegroundColor()` method:
```javascript
_setForegroundColor(color) {
    this._foregroundColor = color
    if (this._brushTool) this._brushTool.color = color
    if (this._shapeTool) this._shapeTool.color = color
    if (this._fillTool) this._fillTool.color = color
    // Update color well UI if it exists
    const well = document.getElementById('colorWell')
    if (well) well.style.backgroundColor = color
    const input = document.getElementById('colorWellInput')
    if (input) input.value = color
}
```

**Step 4: Run test to verify it passes**

Run: `npx playwright test tests/foreground-color.spec.js --reporter=line`
Expected: PASS

**Step 5: Commit**

```bash
git add public/js/app.js tests/foreground-color.spec.js
git commit -m "feat: add global foreground color property with tool sync"
```

---

### Task 2: Toolbar Color Well UI

**Files:**
- Modify: `public/index.html` (toolbar area ~line 261)
- Modify: `public/css/layout.css` (add color well styles)
- Modify: `public/js/app.js` (wire up color well input event)
- Test: `tests/color-well.spec.js`

**Step 1: Write the failing test**

```javascript
// tests/color-well.spec.js
import { test, expect } from 'playwright/test'

async function createTransparentProject(page) {
    await page.waitForSelector('.open-dialog-backdrop.visible')
    await page.click('.media-option[data-type="transparent"]')
    await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
    await page.click('.canvas-size-dialog .action-btn.primary')
    await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
    await page.waitForTimeout(500)
}

test.describe('Color well', () => {
    test('color well exists in toolbar', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)

        const well = await page.$('#colorWell')
        expect(well).not.toBeNull()

        const input = await page.$('#colorWellInput')
        expect(input).not.toBeNull()
    })

    test('changing color well updates foreground color', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)

        await page.evaluate(() => {
            const input = document.getElementById('colorWellInput')
            input.value = '#ff5500'
            input.dispatchEvent(new Event('input'))
        })

        const color = await page.evaluate(() => window.layersApp._foregroundColor)
        expect(color).toBe('#ff5500')
    })

    test('color well background reflects foreground color', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)

        await page.evaluate(() => {
            window.layersApp._setForegroundColor('#0000ff')
        })

        const bg = await page.evaluate(() =>
            document.getElementById('colorWell').style.backgroundColor
        )
        // Browsers may return rgb format
        expect(bg).toMatch(/blue|rgb\(0,\s*0,\s*255\)|#0000ff/i)
    })
})
```

**Step 2: Run test to verify it fails**

Run: `npx playwright test tests/color-well.spec.js --reporter=line`
Expected: FAIL — `#colorWell` not found

**Step 3: Add color well HTML**

In `public/index.html`, before the brush tool button (line 262), add:

```html
<div id="colorWell" class="color-well" style="background-color: #000000;" title="Foreground Color">
    <input type="color" id="colorWellInput" value="#000000">
</div>
```

**Step 4: Add color well CSS**

In `public/css/layout.css`, add:

```css
.color-well {
    position: relative;
    width: 24px;
    height: 24px;
    border: 2px solid var(--border-color, #555);
    border-radius: 4px;
    cursor: pointer;
    overflow: hidden;
    flex-shrink: 0;
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

**Step 5: Wire up color well input in app.js**

In `init()`, add event listener:

```javascript
document.getElementById('colorWellInput')?.addEventListener('input', (e) => {
    this._setForegroundColor(e.target.value)
})
```

**Step 6: Run test to verify it passes**

Run: `npx playwright test tests/color-well.spec.js --reporter=line`
Expected: PASS

**Step 7: Commit**

```bash
git add public/index.html public/css/layout.css public/js/app.js tests/color-well.spec.js
git commit -m "feat: add toolbar color well for foreground color"
```

---

### Task 3: Eyedropper Tool

**Files:**
- Create: `public/js/tools/eyedropper-tool.js`
- Modify: `public/js/app.js` (instantiate, add to _setToolMode, add button handler, add shortcut)
- Modify: `public/index.html` (add button)
- Modify: `public/css/selection.css` (cursor class)
- Test: `tests/eyedropper-tool.spec.js`

**Step 1: Write the failing test**

```javascript
// tests/eyedropper-tool.spec.js
import { test, expect } from 'playwright/test'

test.describe('Eyedropper tool', () => {
    test('eyedropper button exists', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        await page.waitForSelector('.open-dialog-backdrop.visible')
        await page.click('.media-option[data-type="solid"]')
        await page.click('.action-btn.primary')
        await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
        await page.waitForTimeout(500)

        const btn = await page.$('#eyedropperToolBtn')
        expect(btn).not.toBeNull()
    })

    test('I key activates eyedropper', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        await page.waitForSelector('.open-dialog-backdrop.visible')
        await page.click('.media-option[data-type="solid"]')
        await page.click('.action-btn.primary')
        await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
        await page.waitForTimeout(500)

        await page.keyboard.press('i')
        const tool = await page.evaluate(() => window.layersApp._currentTool)
        expect(tool).toBe('eyedropper')
    })

    test('clicking canvas samples color and returns to previous tool', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        // Create a solid color project (default gray)
        await page.waitForSelector('.open-dialog-backdrop.visible')
        await page.click('.media-option[data-type="solid"]')
        await page.click('.action-btn.primary')
        await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
        await page.waitForTimeout(500)

        // Start with brush tool
        await page.click('#brushToolBtn')
        const prevTool = await page.evaluate(() => window.layersApp._currentTool)
        expect(prevTool).toBe('brush')

        // Switch to eyedropper and click canvas
        await page.click('#eyedropperToolBtn')
        const overlay = await page.$('#selectionOverlay')
        const box = await overlay.boundingBox()
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
        await page.waitForTimeout(300)

        // Should have returned to brush and sampled a non-black color
        const result = await page.evaluate(() => ({
            tool: window.layersApp._currentTool,
            color: window.layersApp._foregroundColor
        }))
        expect(result.tool).toBe('brush')
        // Solid project has a non-black color
        expect(result.color).not.toBe('#000000')
    })
})
```

**Step 2: Run test to verify it fails**

Run: `npx playwright test tests/eyedropper-tool.spec.js --reporter=line`
Expected: FAIL

**Step 3: Create eyedropper-tool.js**

```javascript
// public/js/tools/eyedropper-tool.js
export class EyedropperTool {
    constructor(options) {
        this._overlay = options.overlay
        this._canvas = options.canvas
        this._setForegroundColor = options.setForegroundColor
        this._restorePreviousTool = options.restorePreviousTool

        this._active = false
        this._onClick = this._onClick.bind(this)
    }

    activate() {
        if (this._active) return
        this._active = true
        this._overlay.addEventListener('click', this._onClick)
    }

    deactivate() {
        if (!this._active) return
        this._active = false
        this._overlay.removeEventListener('click', this._onClick)
    }

    _getCanvasCoords(e) {
        const rect = this._overlay.getBoundingClientRect()
        return {
            x: Math.floor((e.clientX - rect.left) * (this._overlay.width / rect.width)),
            y: Math.floor((e.clientY - rect.top) * (this._overlay.height / rect.height))
        }
    }

    _onClick(e) {
        const pt = this._getCanvasCoords(e)
        const gl = this._canvas.getContext('webgl') || this._canvas.getContext('webgl2')
        if (!gl) return

        const pixels = new Uint8Array(4)
        gl.readPixels(pt.x, this._canvas.height - pt.y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels)

        const hex = '#' + [pixels[0], pixels[1], pixels[2]]
            .map(v => v.toString(16).padStart(2, '0')).join('')

        this._setForegroundColor(hex)
        this._restorePreviousTool()
    }
}
```

**Step 4: Add button to index.html**

After the fill tool button (line 265):

```html
<button id="eyedropperToolBtn" class="menu-icon-btn" title="Eyedropper (I)"><span class="icon-material">colorize</span></button>
```

**Step 5: Add cursor class to selection.css**

```css
#selectionOverlay.eyedropper-tool {
    cursor: crosshair;
}
```

**Step 6: Wire up in app.js**

Import, instantiate, add to `_setToolMode()`, add `_previousTool` tracking, add button handler, add `I` shortcut.

In constructor:
```javascript
this._previousTool = 'selection'
```

In init():
```javascript
import { EyedropperTool } from './tools/eyedropper-tool.js'

this._eyedropperTool = new EyedropperTool({
    overlay: this._selectionOverlay,
    canvas: this._canvas,
    setForegroundColor: (c) => this._setForegroundColor(c),
    restorePreviousTool: () => this._setToolMode(this._previousTool)
})
```

In `_setToolMode()`:
- Add `this._eyedropperTool?.deactivate()` to deactivate block
- Store previous tool before switching: `if (tool !== 'eyedropper') this._previousTool = this._currentTool` (before `this._currentTool = tool`)
- Add activation case for eyedropper
- Add button active toggle and CSS class

Button handler and keyboard shortcut `I`.

**Step 7: Run test to verify it passes**

Run: `npx playwright test tests/eyedropper-tool.spec.js --reporter=line`
Expected: PASS

**Step 8: Commit**

```bash
git add public/js/tools/eyedropper-tool.js public/index.html public/css/selection.css public/js/app.js tests/eyedropper-tool.spec.js
git commit -m "feat: add eyedropper tool for sampling canvas colors"
```

---

### Task 4: Split-Button CSS

**Files:**
- Modify: `public/css/layout.css` (add split-button styles)

**Step 1: Add split-button styles**

```css
.tool-split-btn {
    display: inline-flex;
    align-items: center;
    position: relative;
    height: 100%;
}

.tool-caret {
    font-size: 1rem;
    cursor: pointer;
    color: var(--text-secondary, #aaa);
    margin: 0 0.125em;
    user-select: none;
    line-height: 1;
    transition: color 0.15s ease;
}

.tool-caret:hover {
    color: var(--text-primary, #eee);
}

.tool-split-btn .menu-items {
    left: 0;
}

.tool-menu-item {
    display: flex !important;
    justify-content: space-between;
    align-items: center;
    gap: 0.75em;
}

.tool-menu-item .icon-material {
    font-size: 1.25rem;
    opacity: 0.7;
}
```

**Step 2: Commit**

```bash
git add public/css/layout.css
git commit -m "feat: add split-button dropdown CSS for tool menus"
```

---

### Task 5: Selection Tool Split-Button Refactor

**Files:**
- Modify: `public/index.html` (replace selection menu ~lines 213-255)
- Modify: `public/js/app.js` (replace selection menu handlers ~lines 1585-1603, update `_setSelectionTool()` ~lines 2178-2215)
- Test: `tests/selection-split-btn.spec.js`

**Step 1: Write the failing test**

```javascript
// tests/selection-split-btn.spec.js
import { test, expect } from 'playwright/test'

async function createTransparentProject(page) {
    await page.waitForSelector('.open-dialog-backdrop.visible')
    await page.click('.media-option[data-type="transparent"]')
    await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
    await page.click('.canvas-size-dialog .action-btn.primary')
    await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
    await page.waitForTimeout(500)
}

test.describe('Selection tool split-button', () => {
    test('selection tool has split-button structure', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)

        const hasBtn = await page.$('#selectionToolBtn')
        expect(hasBtn).not.toBeNull()

        const hasCaret = await page.$('#selectionMenu .tool-caret')
        expect(hasCaret).not.toBeNull()
    })

    test('clicking caret opens dropdown with shape options', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)

        await page.click('#selectionMenu .tool-caret')
        const visible = await page.evaluate(() => {
            const items = document.querySelector('#selectionMenu .menu-items')
            return items && !items.classList.contains('hide')
        })
        expect(visible).toBe(true)
    })

    test('selecting oval updates main button icon', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)

        await page.click('#selectionMenu .tool-caret')
        await page.click('#selectionMenu [data-shape="oval"]')

        const icon = await page.evaluate(() => {
            const btn = document.querySelector('#selectionToolBtn .icon-material')
            return btn?.textContent?.trim()
        })
        expect(icon).toBe('circle')
    })

    test('main button activates selection tool with last shape', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)

        // Switch to another tool first
        await page.click('#brushToolBtn')

        // Click main selection button
        await page.click('#selectionToolBtn')

        const tool = await page.evaluate(() => window.layersApp._currentTool)
        expect(tool).toBe('selection')
    })
})
```

**Step 2: Run test to verify it fails**

Run: `npx playwright test tests/selection-split-btn.spec.js --reporter=line`
Expected: FAIL

**Step 3: Replace selection menu HTML in index.html**

Replace lines 213-255 with:

```html
<div class="menu tool-split-btn" id="selectionMenu">
    <button id="selectionToolBtn" class="menu-icon-btn" title="Selection Tool">
        <span class="icon-material">crop_square</span>
    </button>
    <span class="menu-title tool-caret icon-material">arrow_drop_down</span>
    <div class="menu-items hide">
        <div class="tool-menu-item checked" data-shape="rectangle"><span>Box</span><span class="icon-material">crop_square</span></div>
        <div class="tool-menu-item" data-shape="oval"><span>Oval</span><span class="icon-material">circle</span></div>
        <div class="tool-menu-item" data-shape="lasso"><span>Lasso</span><span class="icon-material">gesture</span></div>
        <div class="tool-menu-item" data-shape="polygon"><span>Polygon</span><span class="icon-material">polyline</span></div>
        <div class="tool-menu-item" data-shape="wand"><span>Magic Wand</span><span class="icon-material">auto_fix_high</span></div>
    </div>
</div>
```

**Step 4: Update app.js selection menu handlers**

Replace the individual `selectRectMenuItem`, `selectOvalMenuItem`, etc. handlers (lines 1585-1603) with a generic handler:

```javascript
document.querySelectorAll('#selectionMenu .tool-menu-item').forEach(item => {
    item.addEventListener('click', (e) => {
        e.stopPropagation()
        const shape = item.dataset.shape
        this._setSelectionTool(shape)
        // Update icon
        const iconMap = { rectangle: 'crop_square', oval: 'circle', lasso: 'gesture', polygon: 'polyline', wand: 'auto_fix_high' }
        const btn = document.querySelector('#selectionToolBtn .icon-material')
        if (btn) btn.textContent = iconMap[shape] || 'crop_square'
        // Update checked state
        document.querySelectorAll('#selectionMenu .tool-menu-item').forEach(el => {
            el.classList.toggle('checked', el.dataset.shape === shape)
        })
        // Close dropdown
        item.closest('.menu')?.querySelector('.menu-items')?.classList.add('hide')
    })
})
```

Update `_setSelectionTool()` to remove the old icon-swapping SVG logic and checkmark logic (it's now handled by the click handler above).

**Step 5: Run test to verify it passes**

Run: `npx playwright test tests/selection-split-btn.spec.js --reporter=line`
Expected: PASS

**Step 6: Run existing selection tests for regressions**

Run: `npx playwright test tests/select-menu.spec.js --reporter=line`
Expected: PASS (may need test updates if they reference old menu item IDs)

**Step 7: Commit**

```bash
git add public/index.html public/js/app.js tests/selection-split-btn.spec.js
git commit -m "refactor: selection tool uses split-button dropdown pattern"
```

---

### Task 6: Shape Tool Split-Button Dropdown

**Files:**
- Modify: `public/index.html` (replace shape tool button ~line 264)
- Modify: `public/js/app.js` (add shape menu handlers, update _setToolMode)
- Test: `tests/shape-split-btn.spec.js`

**Step 1: Write the failing test**

```javascript
// tests/shape-split-btn.spec.js
import { test, expect } from 'playwright/test'

async function createTransparentProject(page) {
    await page.waitForSelector('.open-dialog-backdrop.visible')
    await page.click('.media-option[data-type="transparent"]')
    await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
    await page.click('.canvas-size-dialog .action-btn.primary')
    await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
    await page.waitForTimeout(500)
}

test.describe('Shape tool split-button', () => {
    test('shape tool has split-button with caret', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)

        const hasBtn = await page.$('#shapeToolBtn')
        expect(hasBtn).not.toBeNull()

        const hasCaret = await page.$('#shapeMenu .tool-caret')
        expect(hasCaret).not.toBeNull()
    })

    test('dropdown shows box and oval options', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)

        await page.click('#shapeMenu .tool-caret')

        const items = await page.evaluate(() => {
            const els = document.querySelectorAll('#shapeMenu .tool-menu-item')
            return [...els].map(el => el.dataset.shape)
        })
        expect(items).toEqual(['rect', 'ellipse'])
    })

    test('selecting oval updates icon and shape tool type', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)

        await page.click('#shapeMenu .tool-caret')
        await page.click('#shapeMenu [data-shape="ellipse"]')

        const result = await page.evaluate(() => ({
            icon: document.querySelector('#shapeToolBtn .icon-material')?.textContent?.trim(),
            shapeType: window.layersApp._shapeTool.shapeType
        }))

        expect(result.icon).toBe('circle')
        expect(result.shapeType).toBe('ellipse')
    })
})
```

**Step 2: Run test to verify it fails**

Run: `npx playwright test tests/shape-split-btn.spec.js --reporter=line`
Expected: FAIL

**Step 3: Replace shape tool button HTML**

Replace the single `#shapeToolBtn` button (line 264) with:

```html
<div class="menu tool-split-btn" id="shapeMenu">
    <button id="shapeToolBtn" class="menu-icon-btn" title="Shape Tool (U)">
        <span class="icon-material">crop_square</span>
    </button>
    <span class="menu-title tool-caret icon-material">arrow_drop_down</span>
    <div class="menu-items hide">
        <div class="tool-menu-item checked" data-shape="rect"><span>Box</span><span class="icon-material">crop_square</span></div>
        <div class="tool-menu-item" data-shape="ellipse"><span>Oval</span><span class="icon-material">circle</span></div>
    </div>
</div>
```

**Step 4: Add shape menu handlers in app.js**

In `init()`:

```javascript
document.querySelectorAll('#shapeMenu .tool-menu-item').forEach(item => {
    item.addEventListener('click', (e) => {
        e.stopPropagation()
        const shape = item.dataset.shape
        if (this._shapeTool) this._shapeTool.shapeType = shape
        // Update icon
        const iconMap = { rect: 'crop_square', ellipse: 'circle' }
        const btn = document.querySelector('#shapeToolBtn .icon-material')
        if (btn) btn.textContent = iconMap[shape] || 'crop_square'
        // Update checked state
        document.querySelectorAll('#shapeMenu .tool-menu-item').forEach(el => {
            el.classList.toggle('checked', el.dataset.shape === shape)
        })
        // Close dropdown and activate tool
        item.closest('.menu')?.querySelector('.menu-items')?.classList.add('hide')
        this._setToolMode('shape')
    })
})
```

**Step 5: Run test to verify it passes**

Run: `npx playwright test tests/shape-split-btn.spec.js --reporter=line`
Expected: PASS

**Step 6: Commit**

```bash
git add public/index.html public/js/app.js tests/shape-split-btn.spec.js
git commit -m "feat: shape tool uses split-button dropdown with box and oval"
```

---

### Task 7: Shape Tool Cleanup (Remove Line/Arrow)

**Files:**
- Modify: `public/js/tools/shape-tool.js` (remove line/arrow from _onMouseUp and _drawPreview)
- Test: `tests/shape-tool.spec.js` (update existing tests if needed)

**Step 1: Clean up shape-tool.js**

In `shape-tool.js`:

1. Change the comment on `_shapeType` (line 28) from `'rect' | 'ellipse' | 'line' | 'arrow'` to `'rect' | 'ellipse'`

2. In `_onMouseUp()` (~lines 114-121), remove the `if (this._shapeType === 'line' || this._shapeType === 'arrow')` branch and the `createLineStroke` import. Only keep rect/ellipse creation.

3. In `_drawPreview()` (~lines 170-175), remove the `line`/`arrow` branch from the preview drawing.

4. Remove the `createLineStroke` import from the top of the file.

**Step 2: Run existing shape tests**

Run: `npx playwright test tests/shape-tool.spec.js --reporter=line`
Expected: PASS (tests only cover rect and ellipse)

**Step 3: Commit**

```bash
git add public/js/tools/shape-tool.js
git commit -m "refactor: remove line/arrow from shape tool, keep box and oval only"
```

---

### Task 8: Options Bar Cleanup

**Files:**
- Modify: `public/index.html` (remove color input from options bar ~lines 270-272)
- Modify: `public/js/app.js` (remove drawingColorInput event listener ~lines 1637-1642)
- Test: `tests/drawing-options-bar.spec.js` (update if tests reference color input)

**Step 1: Remove color input from options bar HTML**

Remove lines 270-272 from index.html (the `<label>Color <input type="color" ...></label>`).

**Step 2: Remove drawingColorInput event listener from app.js**

Remove the event listener for `#drawingColorInput` (lines 1637-1642).

**Step 3: Update tests if needed**

Check `tests/drawing-options-bar.spec.js` — if it references `#drawingColorInput`, update or remove that test.

**Step 4: Run tests**

Run: `npx playwright test tests/drawing-options-bar.spec.js --reporter=line`
Expected: PASS

**Step 5: Commit**

```bash
git add public/index.html public/js/app.js tests/drawing-options-bar.spec.js
git commit -m "refactor: remove color input from options bar, replaced by toolbar color well"
```

---

### Task 9: Full Test Suite Validation

**Step 1: Run all tests**

Run: `npx playwright test --reporter=line`
Expected: All tests pass.

Common regressions to watch for:
- Selection tests (`tests/select-menu.spec.js`) may reference old menu item IDs like `selectRectMenuItem`
- Drawing tests may reference `#drawingColorInput` which was removed
- Existing tool button tests may need updates for new toolbar structure

**Step 2: Fix regressions**

If tests fail, update them to match the new UI structure.

**Step 3: Commit fixes**

```bash
git add -A
git commit -m "fix: update tests for new toolbar structure"
```

# Drawing & Annotation Tools Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add brush, eraser, shape, and flood fill tools with vector-based stroke storage and a new `sourceType: 'drawing'` layer type.

**Architecture:** New drawing layer type stores a `strokes[]` array that gets rasterized to an OffscreenCanvas, registered as a texture, and composited through the existing Noisemaker WebGL pipeline. Four new tool classes follow the established TransformTool/MoveTool pattern. Drawing options bar provides contextual tool settings.

**Tech Stack:** Vanilla ES modules, Canvas 2D API for stroke rasterization, WebGL (Noisemaker) for compositing, Playwright for E2E tests.

**Design doc:** `docs/plans/2026-02-28-drawing-tools-design.md`

---

## Dependency Graph

```
Task 1 (stroke-model) ──┐
                         ├── Task 3 (layer-model) ── Task 4 (renderer) ── Task 5 (app integration)
Task 2 (stroke-renderer)┘                                                       │
                                                                    ┌────────────┼────────────┐────────────┐
                                                              Task 6 (brush) Task 7 (eraser) Task 8 (shape) Task 9 (fill)
                                                                    └────────────┴────────────┘────────────┘
                                                                                 │
                                                                          Task 10 (options bar)
                                                                                 │
                                                                          Task 11 (keyboard shortcuts)
```

Tasks 6-9 are independent and can be parallelized.

---

### Task 1: Stroke Data Model

**Files:**
- Create: `public/js/drawing/stroke-model.js`
- Test: `tests/drawing-stroke-model.spec.js`

**Step 1: Write the failing test**

```javascript
// tests/drawing-stroke-model.spec.js
import { test, expect } from 'playwright/test'

test.describe('Stroke model', () => {
    test('createPathStroke creates a valid path stroke', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        const stroke = await page.evaluate(() => {
            const { createPathStroke } = window._drawingTestExports
            return createPathStroke({
                color: '#ff0000',
                size: 5,
                opacity: 0.8,
                points: [{ x: 10, y: 20 }, { x: 30, y: 40 }]
            })
        })

        expect(stroke.type).toBe('path')
        expect(stroke.id).toBeTruthy()
        expect(stroke.color).toBe('#ff0000')
        expect(stroke.size).toBe(5)
        expect(stroke.opacity).toBe(0.8)
        expect(stroke.points).toHaveLength(2)
    })

    test('createShapeStroke creates valid shape strokes', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        const rect = await page.evaluate(() => {
            const { createShapeStroke } = window._drawingTestExports
            return createShapeStroke({
                type: 'rect',
                color: '#00ff00',
                size: 2,
                x: 10, y: 20, width: 100, height: 50,
                filled: true
            })
        })

        expect(rect.type).toBe('rect')
        expect(rect.id).toBeTruthy()
        expect(rect.filled).toBe(true)
        expect(rect.x).toBe(10)
    })

    test('stroke IDs are unique', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        const ids = await page.evaluate(() => {
            const { createPathStroke } = window._drawingTestExports
            const a = createPathStroke({ color: '#000', size: 1, points: [] })
            const b = createPathStroke({ color: '#000', size: 1, points: [] })
            return [a.id, b.id]
        })

        expect(ids[0]).not.toBe(ids[1])
    })
})
```

**Step 2: Run test to verify it fails**

Run: `npx playwright test tests/drawing-stroke-model.spec.js --reporter=line`
Expected: FAIL — `window._drawingTestExports` is undefined

**Step 3: Write the stroke model module**

```javascript
// public/js/drawing/stroke-model.js
let strokeCounter = 0

export function createPathStroke({ color, size, opacity = 1, points = [] }) {
    return {
        id: `stroke-${strokeCounter++}`,
        type: 'path',
        color,
        size,
        opacity,
        points: points.map(p => ({ x: p.x, y: p.y }))
    }
}

export function createShapeStroke({ type, color, size, opacity = 1, x, y, width, height, filled = false }) {
    return {
        id: `stroke-${strokeCounter++}`,
        type,
        color,
        size,
        opacity,
        x, y, width, height,
        filled,
        points: []
    }
}

export function createLineStroke({ type = 'line', color, size, opacity = 1, points = [] }) {
    return {
        id: `stroke-${strokeCounter++}`,
        type,
        color,
        size,
        opacity,
        points: points.map(p => ({ x: p.x, y: p.y })),
        x: 0, y: 0, width: 0, height: 0,
        filled: false
    }
}

export function cloneStrokes(strokes) {
    return JSON.parse(JSON.stringify(strokes))
}
```

**Step 4: Expose test exports in app.js**

Add to `public/js/app.js` at the end of the `init()` method (near line 400):

```javascript
// Expose drawing model for tests
import * as strokeModel from './drawing/stroke-model.js'
window._drawingTestExports = strokeModel
```

Note: The import should go at the top of app.js with other imports.

**Step 5: Run test to verify it passes**

Run: `npx playwright test tests/drawing-stroke-model.spec.js --reporter=line`
Expected: PASS

**Step 6: Commit**

```bash
git add public/js/drawing/stroke-model.js tests/drawing-stroke-model.spec.js public/js/app.js
git commit -m "feat(drawing): add stroke data model with path and shape factories"
```

---

### Task 2: Stroke Renderer

**Files:**
- Create: `public/js/drawing/stroke-renderer.js`
- Test: `tests/drawing-stroke-renderer.spec.js`

**Step 1: Write the failing test**

```javascript
// tests/drawing-stroke-renderer.spec.js
import { test, expect } from 'playwright/test'

test.describe('Stroke renderer', () => {
    test('rasterizes a path stroke to canvas', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        const hasPixels = await page.evaluate(() => {
            const { StrokeRenderer } = window._drawingTestExports
            const { createPathStroke } = window._drawingTestExports
            const renderer = new StrokeRenderer()
            const stroke = createPathStroke({
                color: '#ff0000',
                size: 10,
                points: [{ x: 50, y: 50 }, { x: 100, y: 100 }, { x: 150, y: 50 }]
            })
            const canvas = renderer.rasterize([stroke], 200, 200)
            const ctx = canvas.getContext('2d')
            const data = ctx.getImageData(75, 75, 1, 1).data
            // Red stroke should have non-zero red channel
            return data[0] > 0 && data[3] > 0
        })

        expect(hasPixels).toBe(true)
    })

    test('rasterizes a filled rect stroke', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        const pixel = await page.evaluate(() => {
            const { StrokeRenderer, createShapeStroke } = window._drawingTestExports
            const renderer = new StrokeRenderer()
            const stroke = createShapeStroke({
                type: 'rect',
                color: '#00ff00',
                size: 2,
                x: 10, y: 10, width: 50, height: 50,
                filled: true
            })
            const canvas = renderer.rasterize([stroke], 100, 100)
            const ctx = canvas.getContext('2d')
            const data = ctx.getImageData(35, 35, 1, 1).data
            return { r: data[0], g: data[1], b: data[2], a: data[3] }
        })

        expect(pixel.g).toBe(255)
        expect(pixel.a).toBe(255)
    })

    test('returns empty canvas for no strokes', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        const isEmpty = await page.evaluate(() => {
            const { StrokeRenderer } = window._drawingTestExports
            const renderer = new StrokeRenderer()
            const canvas = renderer.rasterize([], 100, 100)
            const ctx = canvas.getContext('2d')
            const data = ctx.getImageData(0, 0, 100, 100).data
            return data.every(v => v === 0)
        })

        expect(isEmpty).toBe(true)
    })
})
```

**Step 2: Run test to verify it fails**

Run: `npx playwright test tests/drawing-stroke-renderer.spec.js --reporter=line`
Expected: FAIL — `StrokeRenderer` not in test exports

**Step 3: Write the stroke renderer**

```javascript
// public/js/drawing/stroke-renderer.js
export class StrokeRenderer {
    constructor() {
        this._canvas = null
        this._ctx = null
    }

    rasterize(strokes, width, height) {
        if (!this._canvas || this._canvas.width !== width || this._canvas.height !== height) {
            this._canvas = new OffscreenCanvas(width, height)
            this._ctx = this._canvas.getContext('2d')
        }

        this._ctx.clearRect(0, 0, width, height)

        for (const stroke of strokes) {
            this._ctx.save()
            this._ctx.globalAlpha = stroke.opacity ?? 1
            this._ctx.strokeStyle = stroke.color
            this._ctx.fillStyle = stroke.color
            this._ctx.lineWidth = stroke.size
            this._ctx.lineCap = 'round'
            this._ctx.lineJoin = 'round'

            switch (stroke.type) {
                case 'path': this._drawPath(stroke); break
                case 'rect': this._drawRect(stroke); break
                case 'ellipse': this._drawEllipse(stroke); break
                case 'line': this._drawLine(stroke); break
                case 'arrow': this._drawArrow(stroke); break
            }

            this._ctx.restore()
        }

        return this._canvas
    }

    _drawPath(stroke) {
        const pts = stroke.points
        if (pts.length < 2) {
            if (pts.length === 1) {
                this._ctx.beginPath()
                this._ctx.arc(pts[0].x, pts[0].y, stroke.size / 2, 0, Math.PI * 2)
                this._ctx.fill()
            }
            return
        }

        this._ctx.beginPath()
        this._ctx.moveTo(pts[0].x, pts[0].y)

        for (let i = 1; i < pts.length - 1; i++) {
            const mx = (pts[i].x + pts[i + 1].x) / 2
            const my = (pts[i].y + pts[i + 1].y) / 2
            this._ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my)
        }

        const last = pts[pts.length - 1]
        this._ctx.lineTo(last.x, last.y)
        this._ctx.stroke()
    }

    _drawRect(stroke) {
        if (stroke.filled) {
            this._ctx.fillRect(stroke.x, stroke.y, stroke.width, stroke.height)
        } else {
            this._ctx.strokeRect(stroke.x, stroke.y, stroke.width, stroke.height)
        }
    }

    _drawEllipse(stroke) {
        const cx = stroke.x + stroke.width / 2
        const cy = stroke.y + stroke.height / 2
        const rx = Math.abs(stroke.width / 2)
        const ry = Math.abs(stroke.height / 2)

        this._ctx.beginPath()
        this._ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)

        if (stroke.filled) {
            this._ctx.fill()
        } else {
            this._ctx.stroke()
        }
    }

    _drawLine(stroke) {
        if (stroke.points.length < 2) return
        this._ctx.beginPath()
        this._ctx.moveTo(stroke.points[0].x, stroke.points[0].y)
        this._ctx.lineTo(stroke.points[1].x, stroke.points[1].y)
        this._ctx.stroke()
    }

    _drawArrow(stroke) {
        if (stroke.points.length < 2) return
        const p0 = stroke.points[0]
        const p1 = stroke.points[1]

        // Shaft
        this._ctx.beginPath()
        this._ctx.moveTo(p0.x, p0.y)
        this._ctx.lineTo(p1.x, p1.y)
        this._ctx.stroke()

        // Arrowhead
        const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x)
        const headLen = Math.max(stroke.size * 3, 10)
        const headAngle = Math.PI / 6

        this._ctx.beginPath()
        this._ctx.moveTo(p1.x, p1.y)
        this._ctx.lineTo(
            p1.x - headLen * Math.cos(angle - headAngle),
            p1.y - headLen * Math.sin(angle - headAngle)
        )
        this._ctx.moveTo(p1.x, p1.y)
        this._ctx.lineTo(
            p1.x - headLen * Math.cos(angle + headAngle),
            p1.y - headLen * Math.sin(angle + headAngle)
        )
        this._ctx.stroke()
    }
}
```

**Step 4: Add StrokeRenderer to test exports in app.js**

Update the test export block:

```javascript
import * as strokeModel from './drawing/stroke-model.js'
import { StrokeRenderer } from './drawing/stroke-renderer.js'
window._drawingTestExports = { ...strokeModel, StrokeRenderer }
```

**Step 5: Run test to verify it passes**

Run: `npx playwright test tests/drawing-stroke-renderer.spec.js --reporter=line`
Expected: PASS

**Step 6: Commit**

```bash
git add public/js/drawing/stroke-renderer.js tests/drawing-stroke-renderer.spec.js public/js/app.js
git commit -m "feat(drawing): add stroke renderer with path, shape, line, and arrow support"
```

---

### Task 3: Drawing Layer Type in Layer Model

**Files:**
- Modify: `public/js/layers/layer-model.js` (lines 27-57 for createLayer, lines 134-154 for serialization)
- Test: `tests/drawing-layer-model.spec.js`

**Step 1: Write the failing test**

```javascript
// tests/drawing-layer-model.spec.js
import { test, expect } from 'playwright/test'

test.describe('Drawing layer model', () => {
    test('createDrawingLayer creates a layer with sourceType drawing', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        const layer = await page.evaluate(() => {
            const { createDrawingLayer } = window._drawingTestExports
            return createDrawingLayer('My Drawing')
        })

        expect(layer.sourceType).toBe('drawing')
        expect(layer.name).toBe('My Drawing')
        expect(layer.strokes).toEqual([])
        expect(layer.visible).toBe(true)
        expect(layer.opacity).toBe(100)
    })

    test('drawing layer serializes strokes and omits drawingCanvas', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        const result = await page.evaluate(() => {
            const { createDrawingLayer, createPathStroke } = window._drawingTestExports
            const layer = createDrawingLayer('Test')
            layer.strokes.push(createPathStroke({
                color: '#ff0000', size: 5,
                points: [{ x: 10, y: 20 }]
            }))
            layer.drawingCanvas = 'should-be-stripped'
            const serialized = JSON.parse(JSON.stringify(layer))
            // drawingCanvas won't survive JSON round-trip since it's not serializable
            // But we need serializeLayers to explicitly strip it
            return { hasStrokes: serialized.strokes.length === 1, sourceType: serialized.sourceType }
        })

        expect(result.hasStrokes).toBe(true)
        expect(result.sourceType).toBe('drawing')
    })
})
```

**Step 2: Run test to verify it fails**

Run: `npx playwright test tests/drawing-layer-model.spec.js --reporter=line`
Expected: FAIL — `createDrawingLayer` not defined

**Step 3: Add createDrawingLayer to layer-model.js**

Add after `createEffectLayer()` (after line 90 in `public/js/layers/layer-model.js`):

```javascript
export function createDrawingLayer(name) {
    return createLayer({
        name: name || 'Drawing',
        sourceType: 'drawing',
        strokes: [],
        drawingCanvas: null
    })
}
```

Update `createLayer()` to handle the new fields (add to the return object around line 55):

```javascript
// Drawing-specific
strokes: options.strokes || (options.sourceType === 'drawing' ? [] : undefined),
drawingCanvas: null,  // runtime only, never serialized
```

Update `serializeLayers()` to handle drawing layers — ensure `drawingCanvas` is stripped (it's runtime-only). Since `drawingCanvas` is an OffscreenCanvas reference, `JSON.stringify` will already drop it, but make it explicit by setting to `null` in the serialization function.

**Step 4: Export from app.js test exports**

```javascript
import { createDrawingLayer } from './layers/layer-model.js'
window._drawingTestExports = { ...strokeModel, StrokeRenderer, createDrawingLayer }
```

**Step 5: Run test to verify it passes**

Run: `npx playwright test tests/drawing-layer-model.spec.js --reporter=line`
Expected: PASS

**Step 6: Commit**

```bash
git add public/js/layers/layer-model.js tests/drawing-layer-model.spec.js public/js/app.js
git commit -m "feat(drawing): add drawing layer type to layer model"
```

---

### Task 4: Renderer Integration (DSL + Texture)

**Files:**
- Modify: `public/js/noisemaker/renderer.js` (lines 754-844 `_buildDsl()`, lines 483-520 `_uploadMediaTextures()`)
- Test: `tests/drawing-render.spec.js`

**Step 1: Write the failing test**

```javascript
// tests/drawing-render.spec.js
import { test, expect } from 'playwright/test'

async function createTransparentProject(page) {
    await page.waitForSelector('.open-dialog-backdrop.visible')
    await page.click('.media-option[data-type="transparent"]')
    await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
    await page.click('.canvas-size-dialog .action-btn.primary')
    await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
    await page.waitForTimeout(500)
}

test.describe('Drawing layer rendering', () => {
    test('drawing layer with strokes renders visible pixels', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)

        const hasColor = await page.evaluate(async () => {
            const app = window.layersApp
            const { createDrawingLayer } = await import('/js/layers/layer-model.js')
            const { createPathStroke } = await import('/js/drawing/stroke-model.js')

            const layer = createDrawingLayer('Test Drawing')
            layer.strokes.push(createPathStroke({
                color: '#ff0000',
                size: 20,
                points: [
                    { x: 100, y: 100 },
                    { x: 200, y: 200 },
                    { x: 300, y: 100 }
                ]
            }))

            app._layers.push(layer)
            await app._rasterizeDrawingLayer(layer)
            await app._rebuild({ force: true })
            app._updateLayerStack()

            await new Promise(r => setTimeout(r, 200))

            // Read pixels from the WebGL canvas
            const canvas = document.getElementById('canvas')
            const gl = canvas.getContext('webgl') || canvas.getContext('webgl2')
            const pixels = new Uint8Array(4)
            gl.readPixels(150, canvas.height - 150, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels)

            return pixels[0] > 100 && pixels[3] > 0
        })

        expect(hasColor).toBe(true)
    })
})
```

**Step 2: Run test to verify it fails**

Run: `npx playwright test tests/drawing-render.spec.js --reporter=line`
Expected: FAIL — `_rasterizeDrawingLayer` not defined, DSL doesn't handle drawing layers

**Step 3: Update renderer _buildDsl() to handle drawing layers**

In `public/js/noisemaker/renderer.js`, in the `_buildDsl()` method, wherever `layer.sourceType === 'media'` is checked, also handle `'drawing'`. Drawing layers compile to the same DSL as media layers — they produce a texture that gets blended.

Key changes:
1. In `_buildDsl()`, treat `'drawing'` same as `'media'` (both use `this._buildMediaCall()`)
2. In `_uploadMediaTextures()`, include drawing layers alongside media layers: `l.visible && (l.sourceType === 'media' || l.sourceType === 'drawing')`
3. In `_getMediaStepIndices()` (if it filters by sourceType), include drawing layers

**Step 4: Add _rasterizeDrawingLayer() to app.js**

Add method to `LayersApp`:

```javascript
async _rasterizeDrawingLayer(layer) {
    if (layer.sourceType !== 'drawing') return
    if (!layer.strokes || layer.strokes.length === 0) {
        layer.drawingCanvas = null
        return
    }
    const { StrokeRenderer } = await import('./drawing/stroke-renderer.js')
    if (!this._strokeRenderer) {
        this._strokeRenderer = new StrokeRenderer()
    }
    const canvas = this._strokeRenderer.rasterize(
        layer.strokes, this._canvas.width, this._canvas.height
    )
    layer.drawingCanvas = canvas

    // Register as texture in the renderer
    this._renderer._mediaTextures.set(layer.id, {
        type: 'image',
        element: canvas,
        width: this._canvas.width,
        height: this._canvas.height
    })
}
```

**Step 5: Run test to verify it passes**

Run: `npx playwright test tests/drawing-render.spec.js --reporter=line`
Expected: PASS

**Step 6: Commit**

```bash
git add public/js/noisemaker/renderer.js public/js/app.js tests/drawing-render.spec.js
git commit -m "feat(drawing): integrate drawing layers into renderer pipeline"
```

---

### Task 5: App Integration (Tool Mode, Toolbar, Auto-Create)

**Files:**
- Modify: `public/js/app.js` (lines 2662-2694 `_setToolMode()`, lines 293-352 tool init)
- Modify: `public/index.html` (lines 256-260 toolbar buttons)
- Modify: `public/css/selection.css` (lines 17-29 cursor classes)
- Test: `tests/drawing-tool-buttons.spec.js`

**Step 1: Write the failing test**

```javascript
// tests/drawing-tool-buttons.spec.js
import { test, expect } from 'playwright/test'

async function createTransparentProject(page) {
    await page.waitForSelector('.open-dialog-backdrop.visible')
    await page.click('.media-option[data-type="transparent"]')
    await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
    await page.click('.canvas-size-dialog .action-btn.primary')
    await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
    await page.waitForTimeout(500)
}

test.describe('Drawing tool buttons', () => {
    test('brush tool button exists and activates', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)

        const btn = await page.$('#brushToolBtn')
        expect(btn).not.toBeNull()

        await page.click('#brushToolBtn')
        const isActive = await page.evaluate(() =>
            document.getElementById('brushToolBtn').classList.contains('active')
        )
        expect(isActive).toBe(true)
    })

    test('eraser tool button exists and activates', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)

        await page.click('#eraserToolBtn')
        const isActive = await page.evaluate(() =>
            document.getElementById('eraserToolBtn').classList.contains('active')
        )
        expect(isActive).toBe(true)
    })

    test('shape tool button exists and activates', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)

        await page.click('#shapeToolBtn')
        const isActive = await page.evaluate(() =>
            document.getElementById('shapeToolBtn').classList.contains('active')
        )
        expect(isActive).toBe(true)
    })

    test('fill tool button exists and activates', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)

        await page.click('#fillToolBtn')
        const isActive = await page.evaluate(() =>
            document.getElementById('fillToolBtn').classList.contains('active')
        )
        expect(isActive).toBe(true)
    })

    test('switching tools deactivates previous tool', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)

        await page.click('#brushToolBtn')
        await page.click('#eraserToolBtn')

        const brushActive = await page.evaluate(() =>
            document.getElementById('brushToolBtn').classList.contains('active')
        )
        expect(brushActive).toBe(false)
    })

    test('_ensureDrawingLayer auto-creates drawing layer', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)

        const result = await page.evaluate(() => {
            const app = window.layersApp
            const layer = app._ensureDrawingLayer()
            return { sourceType: layer.sourceType, name: layer.name }
        })

        expect(result.sourceType).toBe('drawing')
    })
})
```

**Step 2: Run test to verify it fails**

Run: `npx playwright test tests/drawing-tool-buttons.spec.js --reporter=line`
Expected: FAIL — buttons don't exist

**Step 3: Add toolbar buttons to index.html**

After the transform tool button (line 258 in `public/index.html`), add:

```html
<div class="toolbar-separator"></div>
<button id="brushToolBtn" class="menu-icon-btn" title="Brush Tool (B)"><span class="icon-material">brush</span></button>
<button id="eraserToolBtn" class="menu-icon-btn" title="Eraser Tool (E)"><span class="icon-material">ink_eraser</span></button>
<button id="shapeToolBtn" class="menu-icon-btn" title="Shape Tool (U)"><span class="icon-material">crop_square</span></button>
<button id="fillToolBtn" class="menu-icon-btn" title="Fill Tool (G)"><span class="icon-material">format_color_fill</span></button>
```

**Step 4: Add cursor classes to selection.css**

After the transform-tool cursor class (line 29 in `public/css/selection.css`):

```css
#selectionOverlay.brush-tool {
    cursor: crosshair;
}

#selectionOverlay.eraser-tool {
    cursor: pointer;
}

#selectionOverlay.shape-tool {
    cursor: crosshair;
}

#selectionOverlay.fill-tool {
    cursor: crosshair;
}
```

**Step 5: Update _setToolMode() in app.js**

Extend `_setToolMode()` (at line 2662) to handle new tools:

```javascript
_setToolMode(tool) {
    this._currentTool = tool

    // Deactivate all tools
    this._moveTool?.deactivate()
    this._cloneTool?.deactivate()
    this._transformTool?.deactivate()
    this._brushTool?.deactivate()
    this._eraserTool?.deactivate()
    this._shapeTool?.deactivate()
    this._fillTool?.deactivate()

    // Update button states
    const buttons = ['move', 'clone', 'selection', 'transform', 'brush', 'eraser', 'shape', 'fill']
    buttons.forEach(t => {
        document.getElementById(`${t}ToolBtn`)?.classList.toggle('active', tool === t)
    })

    // ... existing selection checkmark clearing ...

    // Activate selected tool
    if (tool === 'move') this._moveTool?.activate()
    else if (tool === 'clone') this._cloneTool?.activate()
    else if (tool === 'transform') this._transformTool?.activate()
    else if (tool === 'brush') this._brushTool?.activate()
    else if (tool === 'eraser') this._eraserTool?.activate()
    else if (tool === 'shape') this._shapeTool?.activate()
    else if (tool === 'fill') this._fillTool?.activate()

    this._selectionManager.enabled = (tool === 'selection')

    // CSS classes for cursor
    const toolClasses = ['move-tool', 'clone-tool', 'transform-tool', 'brush-tool', 'eraser-tool', 'shape-tool', 'fill-tool']
    toolClasses.forEach(cls => this._selectionOverlay?.classList.remove(cls))
    if (tool !== 'selection') {
        this._selectionOverlay?.classList.add(`${tool}-tool`)
    }
}
```

**Step 6: Add _ensureDrawingLayer() to app.js**

```javascript
_ensureDrawingLayer() {
    const active = this._getActiveLayer()
    if (active?.sourceType === 'drawing') return active

    this._finalizePendingUndo()
    const { createDrawingLayer } = /* import from layer-model */
    const layer = createDrawingLayer(`Drawing ${++this._drawingLayerCounter}`)

    // Insert above current layer
    const activeIdx = active ? this._layers.indexOf(active) : this._layers.length - 1
    this._layers.splice(activeIdx + 1, 0, layer)

    this._updateLayerStack()
    if (this._layerStack) {
        this._layerStack.selectedLayerId = layer.id
    }

    this._markDirty()
    this._pushUndoState()
    return layer
}
```

Initialize `this._drawingLayerCounter = 0` in the constructor.

**Step 7: Wire up toolbar button click handlers**

In the init method, add click handlers for each new button:

```javascript
document.getElementById('brushToolBtn')?.addEventListener('click', () => this._setToolMode('brush'))
document.getElementById('eraserToolBtn')?.addEventListener('click', () => this._setToolMode('eraser'))
document.getElementById('shapeToolBtn')?.addEventListener('click', () => this._setToolMode('shape'))
document.getElementById('fillToolBtn')?.addEventListener('click', () => this._setToolMode('fill'))
```

**Step 8: Run test to verify it passes**

Run: `npx playwright test tests/drawing-tool-buttons.spec.js --reporter=line`
Expected: PASS

**Step 9: Commit**

```bash
git add public/index.html public/css/selection.css public/js/app.js tests/drawing-tool-buttons.spec.js
git commit -m "feat(drawing): add toolbar buttons, tool mode switching, and auto-create logic"
```

---

### Task 6: Brush Tool (Parallelizable — depends on Tasks 1-5)

**Files:**
- Create: `public/js/tools/brush-tool.js`
- Modify: `public/js/app.js` (instantiate brush tool)
- Test: `tests/brush-tool.spec.js`

**Step 1: Write the failing test**

```javascript
// tests/brush-tool.spec.js
import { test, expect } from 'playwright/test'

async function createTransparentProject(page) {
    await page.waitForSelector('.open-dialog-backdrop.visible')
    await page.click('.media-option[data-type="transparent"]')
    await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
    await page.click('.canvas-size-dialog .action-btn.primary')
    await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
    await page.waitForTimeout(500)
}

test.describe('Brush tool', () => {
    test('drawing a stroke creates a drawing layer with a path stroke', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)

        // Activate brush tool
        await page.click('#brushToolBtn')

        // Draw a stroke on the overlay canvas
        const overlay = await page.$('#selectionOverlay')
        const box = await overlay.boundingBox()
        const startX = box.x + box.width * 0.3
        const startY = box.y + box.height * 0.3
        const endX = box.x + box.width * 0.6
        const endY = box.y + box.height * 0.6

        await page.mouse.move(startX, startY)
        await page.mouse.down()
        // Draw in small steps for realistic stroke
        for (let i = 1; i <= 5; i++) {
            const t = i / 5
            await page.mouse.move(
                startX + (endX - startX) * t,
                startY + (endY - startY) * t
            )
        }
        await page.mouse.up()
        await page.waitForTimeout(300)

        // Verify a drawing layer was created with a stroke
        const result = await page.evaluate(() => {
            const app = window.layersApp
            const drawingLayers = app._layers.filter(l => l.sourceType === 'drawing')
            if (drawingLayers.length === 0) return { found: false }
            const layer = drawingLayers[0]
            return {
                found: true,
                strokeCount: layer.strokes.length,
                strokeType: layer.strokes[0]?.type,
                hasPoints: layer.strokes[0]?.points?.length > 0
            }
        })

        expect(result.found).toBe(true)
        expect(result.strokeCount).toBe(1)
        expect(result.strokeType).toBe('path')
        expect(result.hasPoints).toBe(true)
    })

    test('second stroke adds to existing drawing layer', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)

        await page.click('#brushToolBtn')
        const overlay = await page.$('#selectionOverlay')
        const box = await overlay.boundingBox()

        // First stroke
        await page.mouse.move(box.x + 100, box.y + 100)
        await page.mouse.down()
        await page.mouse.move(box.x + 200, box.y + 200)
        await page.mouse.up()
        await page.waitForTimeout(300)

        // Second stroke
        await page.mouse.move(box.x + 300, box.y + 100)
        await page.mouse.down()
        await page.mouse.move(box.x + 400, box.y + 200)
        await page.mouse.up()
        await page.waitForTimeout(300)

        const result = await page.evaluate(() => {
            const app = window.layersApp
            const drawingLayers = app._layers.filter(l => l.sourceType === 'drawing')
            return {
                layerCount: drawingLayers.length,
                strokeCount: drawingLayers[0]?.strokes?.length || 0
            }
        })

        expect(result.layerCount).toBe(1)
        expect(result.strokeCount).toBe(2)
    })
})
```

**Step 2: Run test to verify it fails**

Run: `npx playwright test tests/brush-tool.spec.js --reporter=line`
Expected: FAIL — brush tool not active / no stroke created

**Step 3: Write brush-tool.js**

```javascript
// public/js/tools/brush-tool.js
import { createPathStroke } from '../drawing/stroke-model.js'

const State = { IDLE: 'idle', DRAWING: 'drawing' }
const MOUSE_EVENTS = ['mousedown', 'mousemove', 'mouseup', 'mouseleave']
const MIN_DISTANCE = 2  // minimum pixels between sampled points

export class BrushTool {
    constructor(options) {
        this._overlay = options.overlay
        this._ensureDrawingLayer = options.ensureDrawingLayer
        this._rasterizeDrawingLayer = options.rasterizeDrawingLayer
        this._rebuild = options.rebuild
        this._pushUndoState = options.pushUndoState
        this._finalizePendingUndo = options.finalizePendingUndo
        this._markDirty = options.markDirty

        this._color = '#000000'
        this._size = 5
        this._opacity = 1

        this._active = false
        this._state = State.IDLE
        this._currentPoints = []
        this._targetLayer = null

        this._onMouseDown = this._onMouseDown.bind(this)
        this._onMouseMove = this._onMouseMove.bind(this)
        this._onMouseUp = this._onMouseUp.bind(this)
    }

    get color() { return this._color }
    set color(v) { this._color = v }

    get size() { return this._size }
    set size(v) { this._size = Math.max(1, Math.min(100, v)) }

    get opacity() { return this._opacity }
    set opacity(v) { this._opacity = Math.max(0, Math.min(1, v)) }

    activate() {
        if (this._active) return
        this._active = true
        this._state = State.IDLE

        MOUSE_EVENTS.forEach((evt, i) => {
            const handler = [this._onMouseDown, this._onMouseMove, this._onMouseUp, this._onMouseUp][i]
            this._overlay.addEventListener(evt, handler)
        })
    }

    deactivate() {
        if (!this._active) return
        this._active = false
        this._clearPreview()

        MOUSE_EVENTS.forEach((evt, i) => {
            const handler = [this._onMouseDown, this._onMouseMove, this._onMouseUp, this._onMouseUp][i]
            this._overlay.removeEventListener(evt, handler)
        })
    }

    _getCanvasCoords(e) {
        const rect = this._overlay.getBoundingClientRect()
        return {
            x: (e.clientX - rect.left) * (this._overlay.width / rect.width),
            y: (e.clientY - rect.top) * (this._overlay.height / rect.height)
        }
    }

    _onMouseDown(e) {
        if (e.button !== 0) return
        this._state = State.DRAWING
        this._targetLayer = this._ensureDrawingLayer()

        const pt = this._getCanvasCoords(e)
        this._currentPoints = [pt]
        this._drawPreview()
    }

    _onMouseMove(e) {
        if (this._state !== State.DRAWING) return
        const pt = this._getCanvasCoords(e)

        // Distance-based sampling
        const last = this._currentPoints[this._currentPoints.length - 1]
        const dx = pt.x - last.x
        const dy = pt.y - last.y
        if (dx * dx + dy * dy >= MIN_DISTANCE * MIN_DISTANCE) {
            this._currentPoints.push(pt)
            this._drawPreview()
        }
    }

    _onMouseUp(e) {
        if (this._state !== State.DRAWING) return
        this._state = State.IDLE

        if (this._currentPoints.length > 0 && this._targetLayer) {
            this._finalizePendingUndo()
            const stroke = createPathStroke({
                color: this._color,
                size: this._size,
                opacity: this._opacity,
                points: this._currentPoints
            })
            this._targetLayer.strokes.push(stroke)
            this._rasterizeDrawingLayer(this._targetLayer)
            this._rebuild({ force: true })
            this._markDirty()
            this._pushUndoState()
        }

        this._currentPoints = []
        this._targetLayer = null
        this._clearPreview()
    }

    _drawPreview() {
        const ctx = this._overlay.getContext('2d')
        ctx.clearRect(0, 0, this._overlay.width, this._overlay.height)

        if (this._currentPoints.length < 1) return

        ctx.save()
        ctx.strokeStyle = this._color
        ctx.lineWidth = this._size
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.globalAlpha = this._opacity

        const pts = this._currentPoints
        ctx.beginPath()
        ctx.moveTo(pts[0].x, pts[0].y)

        for (let i = 1; i < pts.length - 1; i++) {
            const mx = (pts[i].x + pts[i + 1].x) / 2
            const my = (pts[i].y + pts[i + 1].y) / 2
            ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my)
        }

        if (pts.length > 1) {
            const last = pts[pts.length - 1]
            ctx.lineTo(last.x, last.y)
        }

        ctx.stroke()
        ctx.restore()
    }

    _clearPreview() {
        const ctx = this._overlay.getContext('2d')
        ctx.clearRect(0, 0, this._overlay.width, this._overlay.height)
    }
}
```

**Step 4: Instantiate BrushTool in app.js init()**

Add alongside TransformTool instantiation (around line 340):

```javascript
import { BrushTool } from './tools/brush-tool.js'

this._brushTool = new BrushTool({
    overlay: this._selectionOverlay,
    ensureDrawingLayer: () => this._ensureDrawingLayer(),
    rasterizeDrawingLayer: (layer) => this._rasterizeDrawingLayer(layer),
    rebuild: (opts) => this._rebuild(opts),
    pushUndoState: () => this._pushUndoState(),
    finalizePendingUndo: () => this._finalizePendingUndo(),
    markDirty: () => this._markDirty()
})
```

**Step 5: Run test to verify it passes**

Run: `npx playwright test tests/brush-tool.spec.js --reporter=line`
Expected: PASS

**Step 6: Commit**

```bash
git add public/js/tools/brush-tool.js tests/brush-tool.spec.js public/js/app.js
git commit -m "feat(drawing): implement brush tool with freehand path drawing"
```

---

### Task 7: Eraser Tool (Parallelizable — depends on Tasks 1-5)

**Files:**
- Create: `public/js/tools/eraser-tool.js`
- Modify: `public/js/app.js` (instantiate eraser tool)
- Test: `tests/eraser-tool.spec.js`

**Step 1: Write the failing test**

```javascript
// tests/eraser-tool.spec.js
import { test, expect } from 'playwright/test'

async function createTransparentProject(page) {
    await page.waitForSelector('.open-dialog-backdrop.visible')
    await page.click('.media-option[data-type="transparent"]')
    await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
    await page.click('.canvas-size-dialog .action-btn.primary')
    await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
    await page.waitForTimeout(500)
}

test.describe('Eraser tool', () => {
    test('clicking on a stroke deletes it', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)

        // Create a drawing layer with a known stroke via JS
        await page.evaluate(async () => {
            const app = window.layersApp
            const { createDrawingLayer } = await import('/js/layers/layer-model.js')
            const { createPathStroke } = await import('/js/drawing/stroke-model.js')

            const layer = createDrawingLayer('Test')
            layer.strokes.push(createPathStroke({
                color: '#ff0000',
                size: 20,
                points: [{ x: 200, y: 200 }, { x: 300, y: 300 }]
            }))
            app._layers.push(layer)
            await app._rasterizeDrawingLayer(layer)
            await app._rebuild({ force: true })
            app._updateLayerStack()
            if (app._layerStack) {
                app._layerStack.selectedLayerId = layer.id
            }
        })
        await page.waitForTimeout(300)

        // Switch to eraser tool
        await page.click('#eraserToolBtn')

        // Click on the stroke (near the midpoint 250, 250)
        const overlay = await page.$('#selectionOverlay')
        const box = await overlay.boundingBox()
        const scaleX = box.width / 1024
        const scaleY = box.height / 1024
        await page.mouse.click(box.x + 250 * scaleX, box.y + 250 * scaleY)
        await page.waitForTimeout(300)

        const strokeCount = await page.evaluate(() => {
            const app = window.layersApp
            const layer = app._layers.find(l => l.sourceType === 'drawing')
            return layer?.strokes?.length ?? -1
        })

        expect(strokeCount).toBe(0)
    })
})
```

**Step 2: Run test to verify it fails**

Run: `npx playwright test tests/eraser-tool.spec.js --reporter=line`
Expected: FAIL — eraser tool doesn't exist

**Step 3: Write eraser-tool.js**

```javascript
// public/js/tools/eraser-tool.js
const MOUSE_EVENTS = ['mousedown', 'mousemove', 'mouseup', 'mouseleave']
const HIT_TOLERANCE = 8  // extra pixels around stroke for hit detection

export class EraserTool {
    constructor(options) {
        this._overlay = options.overlay
        this._getActiveLayer = options.getActiveLayer
        this._rasterizeDrawingLayer = options.rasterizeDrawingLayer
        this._rebuild = options.rebuild
        this._pushUndoState = options.pushUndoState
        this._finalizePendingUndo = options.finalizePendingUndo
        this._markDirty = options.markDirty

        this._active = false
        this._dragging = false
        this._deletedInDrag = new Set()
        this._hoveredStrokeId = null

        this._onMouseDown = this._onMouseDown.bind(this)
        this._onMouseMove = this._onMouseMove.bind(this)
        this._onMouseUp = this._onMouseUp.bind(this)
    }

    activate() {
        if (this._active) return
        this._active = true

        MOUSE_EVENTS.forEach((evt, i) => {
            const handler = [this._onMouseDown, this._onMouseMove, this._onMouseUp, this._onMouseUp][i]
            this._overlay.addEventListener(evt, handler)
        })
    }

    deactivate() {
        if (!this._active) return
        this._active = false
        this._clearOverlay()

        MOUSE_EVENTS.forEach((evt, i) => {
            const handler = [this._onMouseDown, this._onMouseMove, this._onMouseUp, this._onMouseUp][i]
            this._overlay.removeEventListener(evt, handler)
        })
    }

    _getCanvasCoords(e) {
        const rect = this._overlay.getBoundingClientRect()
        return {
            x: (e.clientX - rect.left) * (this._overlay.width / rect.width),
            y: (e.clientY - rect.top) * (this._overlay.height / rect.height)
        }
    }

    _onMouseDown(e) {
        if (e.button !== 0) return
        this._dragging = true
        this._deletedInDrag = new Set()
        this._tryDelete(e)
    }

    _onMouseMove(e) {
        if (this._dragging) {
            this._tryDelete(e)
        } else {
            this._updateHover(e)
        }
    }

    _onMouseUp(e) {
        if (!this._dragging) return
        this._dragging = false

        if (this._deletedInDrag.size > 0) {
            this._deletedInDrag.clear()
        }
    }

    _tryDelete(e) {
        const layer = this._getActiveLayer()
        if (!layer || layer.sourceType !== 'drawing') return

        const pt = this._getCanvasCoords(e)
        const hit = this._hitTest(layer.strokes, pt)

        if (hit && !this._deletedInDrag.has(hit.id)) {
            this._finalizePendingUndo()
            this._deletedInDrag.add(hit.id)
            layer.strokes = layer.strokes.filter(s => s.id !== hit.id)
            this._rasterizeDrawingLayer(layer)
            this._rebuild({ force: true })
            this._markDirty()
            this._pushUndoState()
        }
    }

    _updateHover(e) {
        const layer = this._getActiveLayer()
        if (!layer || layer.sourceType !== 'drawing') {
            if (this._hoveredStrokeId) {
                this._hoveredStrokeId = null
                this._clearOverlay()
            }
            return
        }

        const pt = this._getCanvasCoords(e)
        const hit = this._hitTest(layer.strokes, pt)
        const newId = hit?.id || null

        if (newId !== this._hoveredStrokeId) {
            this._hoveredStrokeId = newId
            this._drawHoverHighlight(layer.strokes, newId)
        }
    }

    _hitTest(strokes, pt) {
        // Test in reverse order (top stroke first)
        for (let i = strokes.length - 1; i >= 0; i--) {
            const s = strokes[i]
            if (this._strokeContainsPoint(s, pt)) return s
        }
        return null
    }

    _strokeContainsPoint(stroke, pt) {
        const tolerance = (stroke.size / 2) + HIT_TOLERANCE

        if (stroke.type === 'path') {
            for (let i = 0; i < stroke.points.length - 1; i++) {
                if (this._distToSegment(pt, stroke.points[i], stroke.points[i + 1]) <= tolerance) {
                    return true
                }
            }
            // Single-point stroke
            if (stroke.points.length === 1) {
                const dx = pt.x - stroke.points[0].x
                const dy = pt.y - stroke.points[0].y
                return Math.sqrt(dx * dx + dy * dy) <= tolerance
            }
            return false
        }

        if (stroke.type === 'rect' || stroke.type === 'ellipse') {
            // Bounding box hit test with tolerance
            return pt.x >= stroke.x - tolerance &&
                   pt.x <= stroke.x + stroke.width + tolerance &&
                   pt.y >= stroke.y - tolerance &&
                   pt.y <= stroke.y + stroke.height + tolerance
        }

        if (stroke.type === 'line' || stroke.type === 'arrow') {
            if (stroke.points.length >= 2) {
                return this._distToSegment(pt, stroke.points[0], stroke.points[1]) <= tolerance
            }
            return false
        }

        return false
    }

    _distToSegment(p, a, b) {
        const dx = b.x - a.x
        const dy = b.y - a.y
        const lenSq = dx * dx + dy * dy

        if (lenSq === 0) {
            const ex = p.x - a.x
            const ey = p.y - a.y
            return Math.sqrt(ex * ex + ey * ey)
        }

        let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
        t = Math.max(0, Math.min(1, t))

        const projX = a.x + t * dx
        const projY = a.y + t * dy
        const ex = p.x - projX
        const ey = p.y - projY
        return Math.sqrt(ex * ex + ey * ey)
    }

    _drawHoverHighlight(strokes, strokeId) {
        const ctx = this._overlay.getContext('2d')
        ctx.clearRect(0, 0, this._overlay.width, this._overlay.height)

        if (!strokeId) return

        const stroke = strokes.find(s => s.id === strokeId)
        if (!stroke) return

        ctx.save()
        ctx.strokeStyle = '#ff4444'
        ctx.lineWidth = stroke.size + 4
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.globalAlpha = 0.5

        if (stroke.type === 'path' && stroke.points.length >= 2) {
            ctx.beginPath()
            ctx.moveTo(stroke.points[0].x, stroke.points[0].y)
            for (let i = 1; i < stroke.points.length; i++) {
                ctx.lineTo(stroke.points[i].x, stroke.points[i].y)
            }
            ctx.stroke()
        } else if (stroke.type === 'rect') {
            ctx.strokeRect(stroke.x, stroke.y, stroke.width, stroke.height)
        }

        ctx.restore()
    }

    _clearOverlay() {
        const ctx = this._overlay.getContext('2d')
        ctx.clearRect(0, 0, this._overlay.width, this._overlay.height)
    }
}
```

**Step 4: Instantiate in app.js**

```javascript
import { EraserTool } from './tools/eraser-tool.js'

this._eraserTool = new EraserTool({
    overlay: this._selectionOverlay,
    getActiveLayer: () => this._getActiveLayer(),
    rasterizeDrawingLayer: (layer) => this._rasterizeDrawingLayer(layer),
    rebuild: (opts) => this._rebuild(opts),
    pushUndoState: () => this._pushUndoState(),
    finalizePendingUndo: () => this._finalizePendingUndo(),
    markDirty: () => this._markDirty()
})
```

**Step 5: Run test to verify it passes**

Run: `npx playwright test tests/eraser-tool.spec.js --reporter=line`
Expected: PASS

**Step 6: Commit**

```bash
git add public/js/tools/eraser-tool.js tests/eraser-tool.spec.js public/js/app.js
git commit -m "feat(drawing): implement eraser tool with stroke hit-testing and deletion"
```

---

### Task 8: Shape Tool (Parallelizable — depends on Tasks 1-5)

**Files:**
- Create: `public/js/tools/shape-tool.js`
- Modify: `public/js/app.js` (instantiate shape tool)
- Test: `tests/shape-tool.spec.js`

**Step 1: Write the failing test**

```javascript
// tests/shape-tool.spec.js
import { test, expect } from 'playwright/test'

async function createTransparentProject(page) {
    await page.waitForSelector('.open-dialog-backdrop.visible')
    await page.click('.media-option[data-type="transparent"]')
    await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
    await page.click('.canvas-size-dialog .action-btn.primary')
    await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
    await page.waitForTimeout(500)
}

test.describe('Shape tool', () => {
    test('drawing a rectangle creates a rect stroke', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)

        await page.click('#shapeToolBtn')

        // Set shape type to rect via JS (default)
        await page.evaluate(() => {
            window.layersApp._shapeTool.shapeType = 'rect'
        })

        const overlay = await page.$('#selectionOverlay')
        const box = await overlay.boundingBox()

        // Draw a rectangle
        const startX = box.x + box.width * 0.2
        const startY = box.y + box.height * 0.2
        const endX = box.x + box.width * 0.6
        const endY = box.y + box.height * 0.5

        await page.mouse.move(startX, startY)
        await page.mouse.down()
        await page.mouse.move(endX, endY)
        await page.mouse.up()
        await page.waitForTimeout(300)

        const result = await page.evaluate(() => {
            const app = window.layersApp
            const layer = app._layers.find(l => l.sourceType === 'drawing')
            if (!layer) return { found: false }
            return {
                found: true,
                strokeType: layer.strokes[0]?.type,
                hasSize: layer.strokes[0]?.width > 0 && layer.strokes[0]?.height > 0
            }
        })

        expect(result.found).toBe(true)
        expect(result.strokeType).toBe('rect')
        expect(result.hasSize).toBe(true)
    })

    test('drawing an ellipse creates an ellipse stroke', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)

        await page.click('#shapeToolBtn')
        await page.evaluate(() => {
            window.layersApp._shapeTool.shapeType = 'ellipse'
        })

        const overlay = await page.$('#selectionOverlay')
        const box = await overlay.boundingBox()

        await page.mouse.move(box.x + 100, box.y + 100)
        await page.mouse.down()
        await page.mouse.move(box.x + 300, box.y + 250)
        await page.mouse.up()
        await page.waitForTimeout(300)

        const type = await page.evaluate(() => {
            const app = window.layersApp
            const layer = app._layers.find(l => l.sourceType === 'drawing')
            return layer?.strokes[0]?.type
        })

        expect(type).toBe('ellipse')
    })
})
```

**Step 2: Run test to verify it fails**

Run: `npx playwright test tests/shape-tool.spec.js --reporter=line`
Expected: FAIL

**Step 3: Write shape-tool.js**

```javascript
// public/js/tools/shape-tool.js
import { createShapeStroke, createLineStroke } from '../drawing/stroke-model.js'

const State = { IDLE: 'idle', DRAWING: 'drawing' }
const MOUSE_EVENTS = ['mousedown', 'mousemove', 'mouseup', 'mouseleave']

export class ShapeTool {
    constructor(options) {
        this._overlay = options.overlay
        this._ensureDrawingLayer = options.ensureDrawingLayer
        this._rasterizeDrawingLayer = options.rasterizeDrawingLayer
        this._rebuild = options.rebuild
        this._pushUndoState = options.pushUndoState
        this._finalizePendingUndo = options.finalizePendingUndo
        this._markDirty = options.markDirty

        this._color = '#000000'
        this._size = 2
        this._opacity = 1
        this._filled = false
        this._shapeType = 'rect'  // 'rect' | 'ellipse' | 'line' | 'arrow'

        this._active = false
        this._state = State.IDLE
        this._startPt = null
        this._currentPt = null
        this._targetLayer = null

        this._onMouseDown = this._onMouseDown.bind(this)
        this._onMouseMove = this._onMouseMove.bind(this)
        this._onMouseUp = this._onMouseUp.bind(this)
    }

    get shapeType() { return this._shapeType }
    set shapeType(v) { this._shapeType = v }

    get color() { return this._color }
    set color(v) { this._color = v }

    get size() { return this._size }
    set size(v) { this._size = Math.max(1, Math.min(100, v)) }

    get opacity() { return this._opacity }
    set opacity(v) { this._opacity = Math.max(0, Math.min(1, v)) }

    get filled() { return this._filled }
    set filled(v) { this._filled = v }

    activate() {
        if (this._active) return
        this._active = true
        this._state = State.IDLE

        MOUSE_EVENTS.forEach((evt, i) => {
            const handler = [this._onMouseDown, this._onMouseMove, this._onMouseUp, this._onMouseUp][i]
            this._overlay.addEventListener(evt, handler)
        })
    }

    deactivate() {
        if (!this._active) return
        this._active = false
        this._clearPreview()

        MOUSE_EVENTS.forEach((evt, i) => {
            const handler = [this._onMouseDown, this._onMouseMove, this._onMouseUp, this._onMouseUp][i]
            this._overlay.removeEventListener(evt, handler)
        })
    }

    _getCanvasCoords(e) {
        const rect = this._overlay.getBoundingClientRect()
        return {
            x: (e.clientX - rect.left) * (this._overlay.width / rect.width),
            y: (e.clientY - rect.top) * (this._overlay.height / rect.height)
        }
    }

    _onMouseDown(e) {
        if (e.button !== 0) return
        this._state = State.DRAWING
        this._targetLayer = this._ensureDrawingLayer()
        this._startPt = this._getCanvasCoords(e)
        this._currentPt = { ...this._startPt }
    }

    _onMouseMove(e) {
        if (this._state !== State.DRAWING) return
        this._currentPt = this._getCanvasCoords(e)

        // Shift = constrain to square/circle
        if (e.shiftKey && (this._shapeType === 'rect' || this._shapeType === 'ellipse')) {
            const dx = this._currentPt.x - this._startPt.x
            const dy = this._currentPt.y - this._startPt.y
            const size = Math.max(Math.abs(dx), Math.abs(dy))
            this._currentPt.x = this._startPt.x + size * Math.sign(dx)
            this._currentPt.y = this._startPt.y + size * Math.sign(dy)
        }

        this._drawPreview()
    }

    _onMouseUp(e) {
        if (this._state !== State.DRAWING) return
        this._state = State.IDLE

        if (this._startPt && this._currentPt && this._targetLayer) {
            this._finalizePendingUndo()

            let stroke
            if (this._shapeType === 'line' || this._shapeType === 'arrow') {
                stroke = createLineStroke({
                    type: this._shapeType,
                    color: this._color,
                    size: this._size,
                    opacity: this._opacity,
                    points: [{ ...this._startPt }, { ...this._currentPt }]
                })
            } else {
                const x = Math.min(this._startPt.x, this._currentPt.x)
                const y = Math.min(this._startPt.y, this._currentPt.y)
                const width = Math.abs(this._currentPt.x - this._startPt.x)
                const height = Math.abs(this._currentPt.y - this._startPt.y)

                stroke = createShapeStroke({
                    type: this._shapeType,
                    color: this._color,
                    size: this._size,
                    opacity: this._opacity,
                    x, y, width, height,
                    filled: this._filled
                })
            }

            this._targetLayer.strokes.push(stroke)
            this._rasterizeDrawingLayer(this._targetLayer)
            this._rebuild({ force: true })
            this._markDirty()
            this._pushUndoState()
        }

        this._startPt = null
        this._currentPt = null
        this._targetLayer = null
        this._clearPreview()
    }

    _drawPreview() {
        const ctx = this._overlay.getContext('2d')
        ctx.clearRect(0, 0, this._overlay.width, this._overlay.height)

        if (!this._startPt || !this._currentPt) return

        ctx.save()
        ctx.strokeStyle = this._color
        ctx.fillStyle = this._color
        ctx.lineWidth = this._size
        ctx.setLineDash([5, 5])
        ctx.globalAlpha = this._opacity * 0.6

        const x = Math.min(this._startPt.x, this._currentPt.x)
        const y = Math.min(this._startPt.y, this._currentPt.y)
        const w = Math.abs(this._currentPt.x - this._startPt.x)
        const h = Math.abs(this._currentPt.y - this._startPt.y)

        if (this._shapeType === 'rect') {
            ctx.strokeRect(x, y, w, h)
        } else if (this._shapeType === 'ellipse') {
            ctx.beginPath()
            ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
            ctx.stroke()
        } else if (this._shapeType === 'line' || this._shapeType === 'arrow') {
            ctx.beginPath()
            ctx.moveTo(this._startPt.x, this._startPt.y)
            ctx.lineTo(this._currentPt.x, this._currentPt.y)
            ctx.stroke()
        }

        ctx.restore()
    }

    _clearPreview() {
        const ctx = this._overlay.getContext('2d')
        ctx.clearRect(0, 0, this._overlay.width, this._overlay.height)
    }
}
```

**Step 4: Instantiate in app.js**

```javascript
import { ShapeTool } from './tools/shape-tool.js'

this._shapeTool = new ShapeTool({
    overlay: this._selectionOverlay,
    ensureDrawingLayer: () => this._ensureDrawingLayer(),
    rasterizeDrawingLayer: (layer) => this._rasterizeDrawingLayer(layer),
    rebuild: (opts) => this._rebuild(opts),
    pushUndoState: () => this._pushUndoState(),
    finalizePendingUndo: () => this._finalizePendingUndo(),
    markDirty: () => this._markDirty()
})
```

**Step 5: Run test to verify it passes**

Run: `npx playwright test tests/shape-tool.spec.js --reporter=line`
Expected: PASS

**Step 6: Commit**

```bash
git add public/js/tools/shape-tool.js tests/shape-tool.spec.js public/js/app.js
git commit -m "feat(drawing): implement shape tool with rect, ellipse, line, and arrow"
```

---

### Task 9: Fill Tool (Parallelizable — depends on Tasks 1-5)

**Files:**
- Create: `public/js/tools/fill-tool.js`
- Modify: `public/js/app.js` (instantiate fill tool)
- Test: `tests/fill-tool.spec.js`

**Step 1: Write the failing test**

```javascript
// tests/fill-tool.spec.js
import { test, expect } from 'playwright/test'

test.describe('Fill tool', () => {
    test('clicking on canvas creates a filled raster layer', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        // Create a solid color project
        await page.waitForSelector('.open-dialog-backdrop.visible')
        await page.click('.media-option[data-type="solid"]')
        await page.click('.action-btn.primary')
        await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
        await page.waitForTimeout(500)

        const initialLayerCount = await page.evaluate(() =>
            window.layersApp._layers.length
        )

        // Activate fill tool
        await page.click('#fillToolBtn')

        // Click on the canvas
        const overlay = await page.$('#selectionOverlay')
        const box = await overlay.boundingBox()
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
        await page.waitForTimeout(500)

        const result = await page.evaluate((initial) => {
            const app = window.layersApp
            return {
                layerCount: app._layers.length,
                newLayerCreated: app._layers.length > initial,
                newLayerType: app._layers[app._layers.length - 1]?.sourceType
            }
        }, initialLayerCount)

        expect(result.newLayerCreated).toBe(true)
        expect(result.newLayerType).toBe('media')
    })
})
```

**Step 2: Run test to verify it fails**

Run: `npx playwright test tests/fill-tool.spec.js --reporter=line`
Expected: FAIL

**Step 3: Write fill-tool.js**

```javascript
// public/js/tools/fill-tool.js
import { floodFill } from '../selection/flood-fill.js'
import { createMediaLayer } from '../layers/layer-model.js'

export class FillTool {
    constructor(options) {
        this._overlay = options.overlay
        this._canvas = options.canvas
        this._addMediaLayerFromCanvas = options.addMediaLayerFromCanvas
        this._pushUndoState = options.pushUndoState
        this._finalizePendingUndo = options.finalizePendingUndo
        this._markDirty = options.markDirty

        this._color = '#000000'
        this._tolerance = 32
        this._active = false

        this._onClick = this._onClick.bind(this)
    }

    get color() { return this._color }
    set color(v) { this._color = v }

    get tolerance() { return this._tolerance }
    set tolerance(v) { this._tolerance = Math.max(0, Math.min(255, v)) }

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

    async _onClick(e) {
        const pt = this._getCanvasCoords(e)
        const width = this._canvas.width
        const height = this._canvas.height

        // Read composited pixels from WebGL canvas
        const gl = this._canvas.getContext('webgl') || this._canvas.getContext('webgl2')
        if (!gl) return

        const pixels = new Uint8Array(width * height * 4)
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)

        // WebGL readPixels is bottom-up, flip vertically
        const flipped = new Uint8ClampedArray(width * height * 4)
        for (let y = 0; y < height; y++) {
            const srcRow = (height - 1 - y) * width * 4
            const dstRow = y * width * 4
            flipped.set(pixels.subarray(srcRow, srcRow + width * 4), dstRow)
        }

        const imageData = new ImageData(flipped, width, height)

        // Flood fill from click point
        const mask = floodFill(imageData, pt.x, pt.y, this._tolerance)

        // Create filled canvas with the selected color
        const fillCanvas = new OffscreenCanvas(width, height)
        const ctx = fillCanvas.getContext('2d')

        // Parse color
        ctx.fillStyle = this._color
        ctx.fillRect(0, 0, width, height)

        // Apply mask
        const fillData = ctx.getImageData(0, 0, width, height)
        for (let i = 0; i < mask.data.length; i += 4) {
            if (mask.data[i + 3] === 0) {
                fillData.data[i + 3] = 0
            }
        }
        ctx.putImageData(fillData, 0, 0)

        // Create a media layer from the fill canvas
        this._finalizePendingUndo()
        await this._addMediaLayerFromCanvas(fillCanvas, 'Fill')
        this._markDirty()
        this._pushUndoState()
    }
}
```

**Step 4: Add _addMediaLayerFromCanvas() helper to app.js**

This creates a media layer from an OffscreenCanvas (used by fill tool):

```javascript
async _addMediaLayerFromCanvas(offscreenCanvas, name) {
    const layer = createMediaLayer(null, 'image', name)
    // Override mediaFile since we're working from a canvas
    layer.mediaFile = null
    this._layers.push(layer)

    // Register the canvas directly as a texture
    this._renderer._mediaTextures.set(layer.id, {
        type: 'image',
        element: offscreenCanvas,
        width: offscreenCanvas.width,
        height: offscreenCanvas.height
    })

    this._updateLayerStack()
    await this._rebuild({ force: true })

    if (this._layerStack) {
        this._layerStack.selectedLayerId = layer.id
    }
}
```

Instantiate FillTool:

```javascript
import { FillTool } from './tools/fill-tool.js'

this._fillTool = new FillTool({
    overlay: this._selectionOverlay,
    canvas: this._canvas,
    addMediaLayerFromCanvas: (c, n) => this._addMediaLayerFromCanvas(c, n),
    pushUndoState: () => this._pushUndoState(),
    finalizePendingUndo: () => this._finalizePendingUndo(),
    markDirty: () => this._markDirty()
})
```

**Step 5: Run test to verify it passes**

Run: `npx playwright test tests/fill-tool.spec.js --reporter=line`
Expected: PASS

**Step 6: Commit**

```bash
git add public/js/tools/fill-tool.js tests/fill-tool.spec.js public/js/app.js
git commit -m "feat(drawing): implement fill tool using flood fill algorithm"
```

---

### Task 10: Drawing Options Bar

**Files:**
- Modify: `public/index.html` (add options bar HTML)
- Modify: `public/css/layout.css` (style options bar)
- Modify: `public/js/app.js` (wire up options bar to tools)
- Test: `tests/drawing-options-bar.spec.js`

**Step 1: Write the failing test**

```javascript
// tests/drawing-options-bar.spec.js
import { test, expect } from 'playwright/test'

async function createTransparentProject(page) {
    await page.waitForSelector('.open-dialog-backdrop.visible')
    await page.click('.media-option[data-type="transparent"]')
    await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
    await page.click('.canvas-size-dialog .action-btn.primary')
    await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
    await page.waitForTimeout(500)
}

test.describe('Drawing options bar', () => {
    test('options bar appears when brush tool is active', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)

        await page.click('#brushToolBtn')

        const visible = await page.evaluate(() => {
            const bar = document.getElementById('drawingOptionsBar')
            return bar && !bar.classList.contains('hidden')
        })
        expect(visible).toBe(true)
    })

    test('options bar hides when non-drawing tool is active', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)

        await page.click('#brushToolBtn')
        await page.click('#moveToolBtn')

        const hidden = await page.evaluate(() => {
            const bar = document.getElementById('drawingOptionsBar')
            return bar && bar.classList.contains('hidden')
        })
        expect(hidden).toBe(true)
    })

    test('changing brush size updates brush tool', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)

        await page.click('#brushToolBtn')
        await page.fill('#drawingSizeInput', '25')
        await page.dispatchEvent('#drawingSizeInput', 'change')

        const size = await page.evaluate(() =>
            window.layersApp._brushTool.size
        )
        expect(size).toBe(25)
    })
})
```

**Step 2: Run test to verify it fails**

Run: `npx playwright test tests/drawing-options-bar.spec.js --reporter=line`
Expected: FAIL

**Step 3: Add options bar HTML**

Add before the canvas-panel div in `public/index.html`:

```html
<div id="drawingOptionsBar" class="drawing-options-bar hidden">
    <label>
        Color
        <input type="color" id="drawingColorInput" value="#000000">
    </label>
    <label>
        Size
        <input type="number" id="drawingSizeInput" min="1" max="100" value="5" style="width: 50px">
    </label>
    <label>
        Opacity
        <input type="range" id="drawingOpacityInput" min="0" max="100" value="100" style="width: 80px">
        <span id="drawingOpacityValue">100%</span>
    </label>
    <label id="drawingFilledLabel" class="hidden">
        <input type="checkbox" id="drawingFilledInput">
        Filled
    </label>
    <label id="drawingToleranceLabel" class="hidden">
        Tolerance
        <input type="range" id="drawingToleranceInput" min="0" max="255" value="32" style="width: 80px">
    </label>
</div>
```

**Step 4: Add CSS for options bar**

In `public/css/layout.css`:

```css
.drawing-options-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 4px 12px;
    background: var(--bg-secondary, #2a2a2a);
    border-bottom: 1px solid var(--border-color, #444);
    font-size: 12px;
}

.drawing-options-bar.hidden {
    display: none;
}

.drawing-options-bar label {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--text-secondary, #aaa);
}
```

**Step 5: Wire up options bar in app.js**

In `_setToolMode()`, show/hide the options bar and configure it per tool:

```javascript
const drawingTools = ['brush', 'eraser', 'shape', 'fill']
const optionsBar = document.getElementById('drawingOptionsBar')
optionsBar?.classList.toggle('hidden', !drawingTools.includes(tool))

// Show/hide tool-specific options
document.getElementById('drawingFilledLabel')?.classList.toggle('hidden', tool !== 'shape')
document.getElementById('drawingToleranceLabel')?.classList.toggle('hidden', tool !== 'fill')
```

Add change event listeners in init():

```javascript
document.getElementById('drawingColorInput')?.addEventListener('input', (e) => {
    const color = e.target.value
    if (this._brushTool) this._brushTool.color = color
    if (this._shapeTool) this._shapeTool.color = color
    if (this._fillTool) this._fillTool.color = color
})

document.getElementById('drawingSizeInput')?.addEventListener('change', (e) => {
    const size = parseInt(e.target.value, 10)
    if (this._brushTool) this._brushTool.size = size
    if (this._shapeTool) this._shapeTool.size = size
})

document.getElementById('drawingOpacityInput')?.addEventListener('input', (e) => {
    const opacity = parseInt(e.target.value, 10) / 100
    if (this._brushTool) this._brushTool.opacity = opacity
    if (this._shapeTool) this._shapeTool.opacity = opacity
    document.getElementById('drawingOpacityValue').textContent = `${e.target.value}%`
})

document.getElementById('drawingFilledInput')?.addEventListener('change', (e) => {
    if (this._shapeTool) this._shapeTool.filled = e.target.checked
})

document.getElementById('drawingToleranceInput')?.addEventListener('input', (e) => {
    if (this._fillTool) this._fillTool.tolerance = parseInt(e.target.value, 10)
})
```

**Step 6: Run test to verify it passes**

Run: `npx playwright test tests/drawing-options-bar.spec.js --reporter=line`
Expected: PASS

**Step 7: Commit**

```bash
git add public/index.html public/css/layout.css public/js/app.js tests/drawing-options-bar.spec.js
git commit -m "feat(drawing): add contextual drawing options bar for tool settings"
```

---

### Task 11: Keyboard Shortcuts

**Files:**
- Modify: `public/js/app.js` (`_setupKeyboardShortcuts()` around line 1801)
- Test: `tests/drawing-shortcuts.spec.js`

**Step 1: Write the failing test**

```javascript
// tests/drawing-shortcuts.spec.js
import { test, expect } from 'playwright/test'

async function createTransparentProject(page) {
    await page.waitForSelector('.open-dialog-backdrop.visible')
    await page.click('.media-option[data-type="transparent"]')
    await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
    await page.click('.canvas-size-dialog .action-btn.primary')
    await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
    await page.waitForTimeout(500)
}

test.describe('Drawing keyboard shortcuts', () => {
    test('B activates brush tool', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)

        await page.keyboard.press('b')
        const tool = await page.evaluate(() => window.layersApp._currentTool)
        expect(tool).toBe('brush')
    })

    test('E activates eraser tool', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)

        await page.keyboard.press('e')
        const tool = await page.evaluate(() => window.layersApp._currentTool)
        expect(tool).toBe('eraser')
    })

    test('U activates shape tool', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)

        await page.keyboard.press('u')
        const tool = await page.evaluate(() => window.layersApp._currentTool)
        expect(tool).toBe('shape')
    })

    test('G activates fill tool', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)

        await page.keyboard.press('g')
        const tool = await page.evaluate(() => window.layersApp._currentTool)
        expect(tool).toBe('fill')
    })

    test('[ and ] change brush size', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)

        await page.keyboard.press('b')
        const initial = await page.evaluate(() => window.layersApp._brushTool.size)

        await page.keyboard.press(']')
        const increased = await page.evaluate(() => window.layersApp._brushTool.size)
        expect(increased).toBe(initial + 5)

        await page.keyboard.press('[')
        const decreased = await page.evaluate(() => window.layersApp._brushTool.size)
        expect(decreased).toBe(initial)
    })
})
```

**Step 2: Run test to verify it fails**

Run: `npx playwright test tests/drawing-shortcuts.spec.js --reporter=line`
Expected: FAIL

**Step 3: Add shortcuts to _setupKeyboardShortcuts()**

In `_setupKeyboardShortcuts()` (around line 1890 in app.js), add:

```javascript
// Drawing tool shortcuts
if (e.key === 'b' || e.key === 'B') {
    this._setToolMode('brush')
}
if (e.key === 'e' || e.key === 'E') {
    this._setToolMode('eraser')
}
if (e.key === 'u' || e.key === 'U') {
    this._setToolMode('shape')
}
if (e.key === 'g' || e.key === 'G') {
    this._setToolMode('fill')
}

// Brush size shortcuts
if (e.key === '[') {
    if (this._brushTool) {
        this._brushTool.size -= 5
        document.getElementById('drawingSizeInput').value = this._brushTool.size
    }
    if (this._shapeTool) this._shapeTool.size -= 5
}
if (e.key === ']') {
    if (this._brushTool) {
        this._brushTool.size += 5
        document.getElementById('drawingSizeInput').value = this._brushTool.size
    }
    if (this._shapeTool) this._shapeTool.size += 5
}
```

**Step 4: Run test to verify it passes**

Run: `npx playwright test tests/drawing-shortcuts.spec.js --reporter=line`
Expected: PASS

**Step 5: Commit**

```bash
git add public/js/app.js tests/drawing-shortcuts.spec.js
git commit -m "feat(drawing): add keyboard shortcuts for drawing tools and brush size"
```

---

### Task 12: Layer Stack UI for Drawing Layers

**Files:**
- Modify: `public/js/layers/layer-item.js` (icon for drawing layers)
- Modify: `public/js/layers/layer-stack.js` (if needed for drawing layer display)
- Test: `tests/drawing-layer-ui.spec.js`

**Step 1: Write the failing test**

```javascript
// tests/drawing-layer-ui.spec.js
import { test, expect } from 'playwright/test'

async function createTransparentProject(page) {
    await page.waitForSelector('.open-dialog-backdrop.visible')
    await page.click('.media-option[data-type="transparent"]')
    await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
    await page.click('.canvas-size-dialog .action-btn.primary')
    await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
    await page.waitForTimeout(500)
}

test.describe('Drawing layer UI', () => {
    test('drawing layer shows pencil icon in layer stack', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)

        // Create a drawing layer
        await page.evaluate(async () => {
            const { createDrawingLayer } = await import('/js/layers/layer-model.js')
            const layer = createDrawingLayer('Test Drawing')
            window.layersApp._layers.push(layer)
            window.layersApp._updateLayerStack()
        })
        await page.waitForTimeout(300)

        // Check for the pencil/draw icon
        const hasIcon = await page.evaluate(() => {
            const items = document.querySelectorAll('layer-item')
            for (const item of items) {
                const icon = item.shadowRoot?.querySelector('.layer-type-icon')
                if (icon && icon.textContent.trim() === 'draw') return true
            }
            return false
        })

        expect(hasIcon).toBe(true)
    })
})
```

**Step 2: Run test to verify it fails**

Run: `npx playwright test tests/drawing-layer-ui.spec.js --reporter=line`
Expected: FAIL — no draw icon rendered

**Step 3: Update layer-item.js**

In the `_render()` method of `<layer-item>`, add handling for `sourceType: 'drawing'`:

Where the icon is determined (look for existing media/effect icon logic), add:

```javascript
const iconName = layer.sourceType === 'drawing' ? 'draw'
    : layer.sourceType === 'effect' ? 'auto_fix_high'
    : 'image'
```

**Step 4: Run test to verify it passes**

Run: `npx playwright test tests/drawing-layer-ui.spec.js --reporter=line`
Expected: PASS

**Step 5: Commit**

```bash
git add public/js/layers/layer-item.js tests/drawing-layer-ui.spec.js
git commit -m "feat(drawing): show pencil icon for drawing layers in layer stack"
```

---

### Task 13: Undo Integration for Drawing Layers

**Files:**
- Modify: `public/js/app.js` (`_restoreState()` method)
- Test: `tests/drawing-undo.spec.js`

**Step 1: Write the failing test**

```javascript
// tests/drawing-undo.spec.js
import { test, expect } from 'playwright/test'

async function createTransparentProject(page) {
    await page.waitForSelector('.open-dialog-backdrop.visible')
    await page.click('.media-option[data-type="transparent"]')
    await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
    await page.click('.canvas-size-dialog .action-btn.primary')
    await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
    await page.waitForTimeout(500)
}

test.describe('Drawing undo', () => {
    test('undo removes the last stroke', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)

        // Draw two strokes
        await page.click('#brushToolBtn')
        const overlay = await page.$('#selectionOverlay')
        const box = await overlay.boundingBox()

        // First stroke
        await page.mouse.move(box.x + 100, box.y + 100)
        await page.mouse.down()
        await page.mouse.move(box.x + 200, box.y + 200)
        await page.mouse.up()
        await page.waitForTimeout(300)

        // Second stroke
        await page.mouse.move(box.x + 300, box.y + 100)
        await page.mouse.down()
        await page.mouse.move(box.x + 400, box.y + 200)
        await page.mouse.up()
        await page.waitForTimeout(300)

        // Verify 2 strokes
        let strokeCount = await page.evaluate(() => {
            const layer = window.layersApp._layers.find(l => l.sourceType === 'drawing')
            return layer?.strokes?.length ?? 0
        })
        expect(strokeCount).toBe(2)

        // Undo
        await page.keyboard.press('Meta+z')
        await page.waitForTimeout(300)

        strokeCount = await page.evaluate(() => {
            const layer = window.layersApp._layers.find(l => l.sourceType === 'drawing')
            return layer?.strokes?.length ?? 0
        })
        expect(strokeCount).toBe(1)

        // Undo again — removes drawing layer entirely
        await page.keyboard.press('Meta+z')
        await page.waitForTimeout(300)

        const hasDrawingLayer = await page.evaluate(() =>
            window.layersApp._layers.some(l => l.sourceType === 'drawing')
        )
        // Either 0 strokes or no drawing layer
        expect(hasDrawingLayer).toBe(false)
    })
})
```

**Step 2: Run test to verify it fails**

Run: `npx playwright test tests/drawing-undo.spec.js --reporter=line`
Expected: May fail if `_restoreState` doesn't re-rasterize drawing layers

**Step 3: Update _restoreState() in app.js**

In the `_restoreState()` method, after restoring layers from undo snapshot, re-rasterize any drawing layers:

```javascript
// After restoring layers
for (const layer of this._layers) {
    if (layer.sourceType === 'drawing' && layer.strokes?.length > 0) {
        await this._rasterizeDrawingLayer(layer)
    }
}
```

Also ensure `_cloneLayers()` deep-clones the `strokes` array:

```javascript
// In _cloneLayers or wherever layers are cloned for undo:
if (clone.sourceType === 'drawing') {
    clone.strokes = JSON.parse(JSON.stringify(layer.strokes || []))
    clone.drawingCanvas = null  // runtime only, will be rebuilt
}
```

**Step 4: Run test to verify it passes**

Run: `npx playwright test tests/drawing-undo.spec.js --reporter=line`
Expected: PASS

**Step 5: Commit**

```bash
git add public/js/app.js tests/drawing-undo.spec.js
git commit -m "feat(drawing): integrate drawing layers with undo system"
```

---

### Task 14: Run Full Test Suite

**Step 1: Run all tests**

Run: `npx playwright test --reporter=line`
Expected: All tests pass, including all new drawing tests and all existing tests.

**Step 2: Fix any regressions**

If existing tests fail, investigate and fix. Common issues:
- `_setToolMode()` changes may affect existing tool button behavior
- New keyboard shortcuts may conflict with existing ones
- Layer serialization changes may affect project save/load

**Step 3: Commit fixes if needed**

```bash
git add -A
git commit -m "fix: resolve test regressions from drawing tools integration"
```

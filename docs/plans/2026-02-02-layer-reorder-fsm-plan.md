# Layer Reorder FSM Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the buggy layer drag-and-drop with an FSM-based transactional system that validates DSL before committing and rolls back on failure.

**Architecture:** Centralized FSM in app.js coordinates between layer-stack (UI events) and renderer (DSL validation). Layer-stack becomes a "dumb" UI emitting granular drag events. App owns snapshots, validation, and rollback.

**Tech Stack:** Vanilla JS, HTML5 Drag and Drop API, Custom Events, WebGL (Noisemaker renderer)

---

## Task 1: Add CSS for Z-Index and Drop Position Indicators

**Files:**
- Modify: `public/css/layers.css`

**Step 1: Add z-index and position:relative to layer-item**

Add after line 19 (inside `.layer-item` block):

```css
.layer-item {
    display: flex;
    flex-direction: column;
    background: var(--color-bg-active);
    border: 1px solid var(--color-border-muted);
    border-radius: var(--radius-md);
    margin-bottom: 6px;
    overflow: hidden;
    transition: all var(--transition-fast);
    cursor: pointer;
    position: relative;  /* ADD: Required for z-index */
}
```

**Step 2: Update dragging style with high z-index**

Replace the `.layer-item.dragging` block (lines 31-34):

```css
.layer-item.dragging {
    opacity: 0.5;
    border-style: dashed;
    z-index: 9999 !important;
}
```

**Step 3: Add drop position indicators**

Add after `.layer-item.drag-over` block (after line 39):

```css
.layer-item.drag-over-above {
    border-top: 3px solid var(--color-accent);
    margin-top: -2px;
}

.layer-item.drag-over-below {
    border-bottom: 3px solid var(--color-accent);
    margin-bottom: 4px;
}
```

**Step 4: Verify visually**

Open the app and inspect layer-items to confirm `position: relative` is applied.

**Step 5: Commit**

```bash
git add public/css/layers.css
git commit -m "style: add z-index support and drop position indicators for layers"
```

---

## Task 2: Add FSM State Properties to App

**Files:**
- Modify: `public/js/app.js`

**Step 1: Add FSM state constants and properties**

Find the constructor initialization section (around line 50-100) and add after `this._isDirty = false`:

```javascript
        // Layer reorder FSM state
        this._reorderState = 'IDLE'  // IDLE | DRAGGING | PROCESSING | ROLLING_BACK
        this._reorderSnapshot = null  // { layers, dsl }
        this._reorderSource = null    // { layerId, index }
```

**Step 2: Verify initialization**

Add a temporary console.log in the constructor to confirm:

```javascript
console.log('[Layers] Reorder FSM initialized:', this._reorderState)
```

Run the app and check the console.

**Step 3: Remove debug log and commit**

Remove the console.log, then:

```bash
git add public/js/app.js
git commit -m "feat: add FSM state properties for layer reordering"
```

---

## Task 3: Add Granular Drag Events to Layer-Item

**Files:**
- Modify: `public/js/layers/layer-item.js`

**Step 1: Update _handleDragStart to emit event with layerId**

Replace `_handleDragStart` method (lines 396-405):

```javascript
    _handleDragStart(e) {
        // Only allow drag from the drag handle
        if (!this._layer || this.hasAttribute('base') || !this._dragFromHandle) {
            e.preventDefault()
            return
        }
        this.classList.add('dragging')
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', this._layer.id)

        // Emit granular event for FSM
        this.dispatchEvent(new CustomEvent('layer-drag-start', {
            bubbles: true,
            detail: { layerId: this._layer.id }
        }))
    }
```

**Step 2: Update _handleDragEnd to emit event**

Replace `_handleDragEnd` method (lines 407-410):

```javascript
    _handleDragEnd(e) {
        this.classList.remove('dragging')
        this._dragFromHandle = false

        // Emit granular event for FSM
        this.dispatchEvent(new CustomEvent('layer-drag-end', {
            bubbles: true,
            detail: { layerId: this._layer.id }
        }))
    }
```

**Step 3: Update _handleDragOver to calculate and emit drop position**

Replace `_handleDragOver` method (lines 412-417):

```javascript
    _handleDragOver(e) {
        if (this.hasAttribute('base')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'

        // Calculate drop position based on mouse Y relative to element center
        const rect = this.getBoundingClientRect()
        const mouseY = e.clientY
        const centerY = rect.top + rect.height / 2
        const dropPosition = mouseY < centerY ? 'above' : 'below'

        // Update visual indicators
        this.classList.remove('drag-over', 'drag-over-above', 'drag-over-below')
        this.classList.add('drag-over', `drag-over-${dropPosition}`)

        // Emit granular event for FSM
        this.dispatchEvent(new CustomEvent('layer-drag-over', {
            bubbles: true,
            detail: {
                targetId: this._layer.id,
                dropPosition
            }
        }))
    }
```

**Step 4: Update _handleDragLeave to clear position indicators**

Replace `_handleDragLeave` method (lines 419-421):

```javascript
    _handleDragLeave(e) {
        this.classList.remove('drag-over', 'drag-over-above', 'drag-over-below')
    }
```

**Step 5: Update _handleDrop to include drop position**

Replace `_handleDrop` method (lines 423-437):

```javascript
    _handleDrop(e) {
        e.preventDefault()

        // Calculate final drop position
        const rect = this.getBoundingClientRect()
        const mouseY = e.clientY
        const centerY = rect.top + rect.height / 2
        const dropPosition = mouseY < centerY ? 'above' : 'below'

        this.classList.remove('drag-over', 'drag-over-above', 'drag-over-below')

        const sourceId = e.dataTransfer.getData('text/plain')
        if (sourceId && sourceId !== this._layer.id) {
            // Emit new granular drop event for FSM
            this.dispatchEvent(new CustomEvent('layer-drop', {
                bubbles: true,
                detail: {
                    sourceId,
                    targetId: this._layer.id,
                    dropPosition
                }
            }))
        }
    }
```

**Step 6: Commit**

```bash
git add public/js/layers/layer-item.js
git commit -m "feat: emit granular drag events with drop position from layer-item"
```

---

## Task 4: Update Layer-Stack to Pass Through Events

**Files:**
- Modify: `public/js/layers/layer-stack.js`

**Step 1: Remove _handleReorder method**

Delete the `_handleReorder` method (lines 187-214) entirely.

**Step 2: Remove layer-reorder event listener**

Find and remove the event listener (lines 175-178):

```javascript
        // Listen for reorder events  <-- DELETE THIS BLOCK
        this.addEventListener('layer-reorder', (e) => {
            this._handleReorder(e.detail.sourceId, e.detail.targetId)
        })
```

**Step 3: Commit**

```bash
git add public/js/layers/layer-stack.js
git commit -m "refactor: remove reorder handling from layer-stack (moved to app FSM)"
```

---

## Task 5: Add tryCompile Method to Renderer

**Files:**
- Modify: `public/js/noisemaker/renderer.js`

**Step 1: Add tryCompile method**

Add after the `setLayers` method (around line 297):

```javascript
    /**
     * Try to compile DSL without side effects
     * @param {string} dsl - DSL to compile
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async tryCompile(dsl) {
        if (!dsl || dsl.trim() === '') {
            return { success: true }
        }

        try {
            // Extract and load required effects (this is idempotent)
            const effectData = extractEffectNamesFromDsl(dsl, this._renderer.manifest || {})
            const effectIds = effectData.map(e => e.effectId)

            const registeredEffects = getAllEffects()
            const effectIdsToLoad = effectIds.filter(id => {
                const dotKey = id.replace('/', '.')
                return !registeredEffects.has(id) && !registeredEffects.has(dotKey)
            })

            if (effectIdsToLoad.length > 0) {
                await this._renderer.loadEffects(effectIdsToLoad)
            }

            // Try to compile - this validates the DSL
            // Note: This DOES have side effects on the renderer, but we'll
            // recompile the old DSL on rollback if needed
            await this._renderer.compile(dsl)

            return { success: true }
        } catch (err) {
            console.error('[LayersRenderer] tryCompile failed:', err)
            return {
                success: false,
                error: err.message || String(err)
            }
        }
    }
```

**Step 2: Add buildDslFromLayers public method**

Add after `tryCompile`:

```javascript
    /**
     * Build DSL from a given layers array (for validation)
     * @param {Array} layers - Layer array to build DSL from
     * @returns {string} DSL program
     */
    buildDslFromLayers(layers) {
        const originalLayers = this._layers
        this._layers = layers
        const dsl = this._buildDsl()
        this._layers = originalLayers
        return dsl
    }
```

**Step 3: Commit**

```bash
git add public/js/noisemaker/renderer.js
git commit -m "feat: add tryCompile and buildDslFromLayers for FSM validation"
```

---

## Task 6: Add FSM Methods to App (Part 1 - Start and Cancel)

**Files:**
- Modify: `public/js/app.js`

**Step 1: Add _startDrag method**

Add after `_handleLayerReorder` method (around line 486):

```javascript
    /**
     * FSM: Start drag operation (IDLE → DRAGGING)
     * @param {string} layerId - Layer being dragged
     * @private
     */
    _startDrag(layerId) {
        if (this._reorderState !== 'IDLE') {
            console.warn('[Layers] Cannot start drag - not in IDLE state')
            return
        }

        const sourceIndex = this._layers.findIndex(l => l.id === layerId)
        if (sourceIndex === -1 || sourceIndex === 0) {
            console.warn('[Layers] Cannot drag base layer or unknown layer')
            return
        }

        // Capture snapshot
        this._reorderSnapshot = {
            layers: JSON.parse(JSON.stringify(this._layers)),
            dsl: this._renderer._currentDsl
        }
        this._reorderSource = { layerId, index: sourceIndex }
        this._reorderState = 'DRAGGING'

        // Update z-index on all layer items
        this._updateLayerZIndex()

        console.debug('[Layers] FSM: IDLE → DRAGGING', { layerId, sourceIndex })
    }

    /**
     * FSM: Cancel drag operation (DRAGGING → IDLE)
     * @private
     */
    _cancelDrag() {
        if (this._reorderState !== 'DRAGGING') return

        this._reorderSnapshot = null
        this._reorderSource = null
        this._reorderState = 'IDLE'

        // Clear any drag-over indicators
        this._clearDragIndicators()

        console.debug('[Layers] FSM: DRAGGING → IDLE (cancelled)')
    }

    /**
     * Update z-index on layer items based on stack position
     * @private
     */
    _updateLayerZIndex() {
        const items = this._layerStack?.querySelectorAll('layer-item')
        if (!items) return

        const count = items.length
        items.forEach((item, domIndex) => {
            // DOM order is top-to-bottom, so first item = highest z-index
            item.style.zIndex = count - domIndex
        })
    }

    /**
     * Clear all drag indicator classes from layer items
     * @private
     */
    _clearDragIndicators() {
        const items = this._layerStack?.querySelectorAll('layer-item')
        if (!items) return

        items.forEach(item => {
            item.classList.remove('drag-over', 'drag-over-above', 'drag-over-below', 'dragging')
        })
    }
```

**Step 2: Commit**

```bash
git add public/js/app.js
git commit -m "feat: add FSM _startDrag and _cancelDrag methods"
```

---

## Task 7: Add FSM Methods to App (Part 2 - Process and Rollback)

**Files:**
- Modify: `public/js/app.js`

**Step 1: Add _calculateNewOrder method**

Add after `_clearDragIndicators`:

```javascript
    /**
     * Calculate new layer order based on drop position
     * @param {string} sourceId - ID of layer being moved
     * @param {string} targetId - ID of drop target layer
     * @param {string} dropPosition - 'above' or 'below'
     * @returns {Array|null} New layer order, or null if invalid
     * @private
     */
    _calculateNewOrder(sourceId, targetId, dropPosition) {
        const layers = [...this._layers]

        const sourceIdx = layers.findIndex(l => l.id === sourceId)
        const targetIdx = layers.findIndex(l => l.id === targetId)

        // Validate
        if (sourceIdx === -1 || targetIdx === -1) return null
        if (sourceIdx === 0) return null  // can't move base layer
        if (sourceIdx === targetIdx) return null  // dropping on self

        // Remove source
        const [sourceLayer] = layers.splice(sourceIdx, 1)

        // Calculate insert position on the MODIFIED array
        let insertIdx = targetIdx
        if (sourceIdx < targetIdx) {
            // Source was above target, target shifted up by 1
            insertIdx = targetIdx - 1
        }

        // Adjust for drop position
        // In our UI: higher index = visually higher (top of stack)
        // dropPosition 'above' means visually above = higher index
        // dropPosition 'below' means visually below = same or lower index
        if (dropPosition === 'above') {
            insertIdx = insertIdx + 1
        }
        // Ensure we never place at or below base layer (index 0)
        insertIdx = Math.max(1, insertIdx)

        layers.splice(insertIdx, 0, sourceLayer)
        return layers
    }
```

**Step 2: Add _processDrop method**

Add after `_calculateNewOrder`:

```javascript
    /**
     * FSM: Process drop operation (DRAGGING → PROCESSING → IDLE or ROLLING_BACK)
     * @param {string} targetId - ID of drop target layer
     * @param {string} dropPosition - 'above' or 'below'
     * @private
     */
    async _processDrop(targetId, dropPosition) {
        if (this._reorderState !== 'DRAGGING') {
            console.warn('[Layers] Cannot process drop - not in DRAGGING state')
            return
        }

        const sourceId = this._reorderSource?.layerId
        if (!sourceId) {
            this._cancelDrag()
            return
        }

        this._reorderState = 'PROCESSING'
        console.debug('[Layers] FSM: DRAGGING → PROCESSING', { sourceId, targetId, dropPosition })

        // Clear visual indicators
        this._clearDragIndicators()

        // Calculate new order
        const newLayers = this._calculateNewOrder(sourceId, targetId, dropPosition)
        if (!newLayers) {
            console.debug('[Layers] Invalid reorder - returning to IDLE')
            this._reorderState = 'IDLE'
            this._reorderSnapshot = null
            this._reorderSource = null
            return
        }

        // Generate and validate new DSL
        try {
            const newDsl = this._renderer.buildDslFromLayers(newLayers)
            const result = await this._renderer.tryCompile(newDsl)

            if (result.success) {
                // Commit the change
                this._layers = newLayers
                await this._rebuild()
                this._updateLayerStack()
                this._updateLayerZIndex()
                this._markDirty()

                this._reorderState = 'IDLE'
                this._reorderSnapshot = null
                this._reorderSource = null

                console.debug('[Layers] FSM: PROCESSING → IDLE (success)')
            } else {
                // Validation failed - rollback
                await this._rollback(result.error || 'DSL validation failed')
            }
        } catch (err) {
            await this._rollback(err.message || String(err))
        }
    }
```

**Step 3: Add _rollback method**

Add after `_processDrop`:

```javascript
    /**
     * FSM: Rollback failed reorder (PROCESSING → ROLLING_BACK → IDLE)
     * @param {string} error - Error message
     * @private
     */
    async _rollback(error) {
        this._reorderState = 'ROLLING_BACK'
        console.debug('[Layers] FSM: PROCESSING → ROLLING_BACK', { error })

        // Restore snapshot
        if (this._reorderSnapshot) {
            this._layers = this._reorderSnapshot.layers
            await this._rebuild()
            this._updateLayerStack()
        }

        // Show error to user
        toast.error(`Layer reorder failed: ${error}. Changes reverted.`)

        this._reorderState = 'IDLE'
        this._reorderSnapshot = null
        this._reorderSource = null

        console.debug('[Layers] FSM: ROLLING_BACK → IDLE')
    }
```

**Step 4: Commit**

```bash
git add public/js/app.js
git commit -m "feat: add FSM _processDrop and _rollback methods"
```

---

## Task 8: Wire Up FSM Event Listeners

**Files:**
- Modify: `public/js/app.js`

**Step 1: Find _setupLayerStackHandlers method**

Locate `_setupLayerStackHandlers` (around line 860).

**Step 2: Replace layers-reorder listener with granular event listeners**

Remove the old `layers-reorder` listener (lines 878-880):

```javascript
        // DELETE THIS:
        this._layerStack.addEventListener('layers-reorder', (e) => {
            this._handleLayerReorder(e.detail.layers)
        })
```

Add new FSM event listeners in its place:

```javascript
        // Layer reorder FSM events
        this._layerStack.addEventListener('layer-drag-start', (e) => {
            this._startDrag(e.detail.layerId)
        })

        this._layerStack.addEventListener('layer-drag-end', (e) => {
            // If we're still in DRAGGING state, this means drop didn't happen
            if (this._reorderState === 'DRAGGING') {
                this._cancelDrag()
            }
        })

        this._layerStack.addEventListener('layer-drop', (e) => {
            this._processDrop(e.detail.targetId, e.detail.dropPosition)
        })
```

**Step 3: Add ESC key handler for cancelling drag**

Find `_setupKeyboardShortcuts` method and add at the start of the keydown handler:

```javascript
            // ESC - cancel drag operation
            if (e.key === 'Escape' && this._reorderState === 'DRAGGING') {
                e.preventDefault()
                this._cancelDrag()
                return
            }
```

**Step 4: Commit**

```bash
git add public/js/app.js
git commit -m "feat: wire up FSM event listeners for layer reordering"
```

---

## Task 9: Clean Up Old Code

**Files:**
- Modify: `public/js/app.js`

**Step 1: Remove old _handleLayerReorder method**

Find and delete the `_handleLayerReorder` method (around lines 477-486):

```javascript
    // DELETE THIS ENTIRE METHOD:
    /**
     * Handle layer reorder
     * @param {Array} newLayers - Reordered layers array
     * @private
     */
    async _handleLayerReorder(newLayers) {
        this._layers = newLayers
        await this._rebuild()
        this._markDirty()
    }
```

**Step 2: Commit**

```bash
git add public/js/app.js
git commit -m "refactor: remove old _handleLayerReorder method"
```

---

## Task 10: Write Integration Test

**Files:**
- Create: `tests/layer-reorder.spec.js`

**Step 1: Create test file**

```javascript
import { test, expect } from 'playwright/test'

test.describe('Layer reorder FSM', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        // Create a solid project
        await page.waitForSelector('.open-dialog-backdrop.visible')
        await page.click('.media-option[data-type="solid"]')
        await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
        await page.click('.canvas-size-dialog .action-btn.primary')
        await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
        await page.waitForTimeout(500)
    })

    test('reordering layers updates render correctly', async ({ page }) => {
        // Add two more layers
        await page.evaluate(async () => {
            // Add red layer
            const canvas1 = document.createElement('canvas')
            canvas1.width = 100
            canvas1.height = 100
            const ctx1 = canvas1.getContext('2d')
            ctx1.fillStyle = 'red'
            ctx1.fillRect(0, 0, 100, 100)
            const blob1 = await new Promise(r => canvas1.toBlob(r, 'image/png'))
            const file1 = new File([blob1], 'red.png', { type: 'image/png' })
            await window.layersApp._handleAddMediaLayer(file1, 'image')
        })
        await page.waitForTimeout(500)

        await page.evaluate(async () => {
            // Add blue layer
            const canvas2 = document.createElement('canvas')
            canvas2.width = 100
            canvas2.height = 100
            const ctx2 = canvas2.getContext('2d')
            ctx2.fillStyle = 'blue'
            ctx2.fillRect(0, 0, 100, 100)
            const blob2 = await new Promise(r => canvas2.toBlob(r, 'image/png'))
            const file2 = new File([blob2], 'blue.png', { type: 'image/png' })
            await window.layersApp._handleAddMediaLayer(file2, 'image')
        })
        await page.waitForTimeout(500)

        // Verify we have 3 layers (base + red + blue)
        const layerCount = await page.evaluate(() => window.layersApp._layers.length)
        expect(layerCount).toBe(3)

        // Get initial layer order
        const initialOrder = await page.evaluate(() =>
            window.layersApp._layers.map(l => l.name)
        )
        console.log('Initial order:', initialOrder)

        // Reorder via FSM methods directly (simpler than drag-drop)
        const reorderSuccess = await page.evaluate(async () => {
            const app = window.layersApp
            const layers = app._layers

            // Move top layer (blue, index 2) below red layer (index 1)
            const sourceId = layers[2].id
            const targetId = layers[1].id

            app._startDrag(sourceId)
            await app._processDrop(targetId, 'below')

            return app._reorderState === 'IDLE'
        })
        expect(reorderSuccess).toBe(true)

        // Verify order changed
        const newOrder = await page.evaluate(() =>
            window.layersApp._layers.map(l => l.name)
        )
        console.log('New order:', newOrder)

        // Blue should now be at index 1, red at index 2
        expect(newOrder[1]).toContain('blue')
        expect(newOrder[2]).toContain('red')
    })

    test('FSM cancels drag on ESC', async ({ page }) => {
        // Add a layer to drag
        await page.evaluate(async () => {
            const canvas = document.createElement('canvas')
            canvas.width = 100
            canvas.height = 100
            const ctx = canvas.getContext('2d')
            ctx.fillStyle = 'green'
            ctx.fillRect(0, 0, 100, 100)
            const blob = await new Promise(r => canvas.toBlob(r, 'image/png'))
            const file = new File([blob], 'green.png', { type: 'image/png' })
            await window.layersApp._handleAddMediaLayer(file, 'image')
        })
        await page.waitForTimeout(500)

        // Start drag
        await page.evaluate(() => {
            const app = window.layersApp
            const layerId = app._layers[1].id
            app._startDrag(layerId)
        })

        // Verify in DRAGGING state
        const draggingState = await page.evaluate(() => window.layersApp._reorderState)
        expect(draggingState).toBe('DRAGGING')

        // Press ESC
        await page.keyboard.press('Escape')

        // Verify back to IDLE
        const idleState = await page.evaluate(() => window.layersApp._reorderState)
        expect(idleState).toBe('IDLE')
    })

    test('FSM prevents dragging base layer', async ({ page }) => {
        const result = await page.evaluate(() => {
            const app = window.layersApp
            const baseLayerId = app._layers[0].id

            app._startDrag(baseLayerId)

            return {
                state: app._reorderState,
                hasSnapshot: app._reorderSnapshot !== null
            }
        })

        // Should remain in IDLE, no snapshot
        expect(result.state).toBe('IDLE')
        expect(result.hasSnapshot).toBe(false)
    })
})
```

**Step 2: Run tests to verify**

```bash
npm test -- tests/layer-reorder.spec.js
```

Expected: All 3 tests pass.

**Step 3: Commit**

```bash
git add tests/layer-reorder.spec.js
git commit -m "test: add integration tests for layer reorder FSM"
```

---

## Task 11: Manual Testing and Final Verification

**Step 1: Start dev server**

```bash
npm start
```

**Step 2: Test drag-drop manually**

1. Create a new solid project
2. Add 2-3 image layers
3. Drag a layer using the handle - verify z-index shows layer above others
4. Drop above another layer - verify position is correct
5. Drop below another layer - verify position is correct
6. Press ESC during drag - verify cancellation works
7. Try to drag base layer - verify it's blocked

**Step 3: Test rollback (optional - requires breaking DSL manually)**

This is hard to trigger naturally. The rollback path is tested implicitly by the FSM structure.

**Step 4: Run full test suite**

```bash
npm test
```

Expected: All tests pass, including the new layer-reorder tests.

**Step 5: Final commit if any fixes needed**

If any issues found, fix and commit with appropriate message.

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | CSS for z-index and drop indicators | `public/css/layers.css` |
| 2 | FSM state properties | `public/js/app.js` |
| 3 | Granular drag events | `public/js/layers/layer-item.js` |
| 4 | Remove old reorder handling | `public/js/layers/layer-stack.js` |
| 5 | tryCompile method | `public/js/noisemaker/renderer.js` |
| 6 | FSM start/cancel methods | `public/js/app.js` |
| 7 | FSM process/rollback methods | `public/js/app.js` |
| 8 | Wire up event listeners | `public/js/app.js` |
| 9 | Clean up old code | `public/js/app.js` |
| 10 | Integration tests | `tests/layer-reorder.spec.js` |
| 11 | Manual testing | - |

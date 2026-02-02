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

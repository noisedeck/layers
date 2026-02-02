import { test, expect } from 'playwright/test'

test.describe('Move tool', () => {
    test('move tool button exists and can be clicked', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        // Create a project first
        await page.waitForSelector('.open-dialog-backdrop.visible')
        await page.click('.media-option[data-type="transparent"]')
        await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
        await page.click('.canvas-size-dialog .action-btn.primary')
        await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })

        // Check move tool button exists
        const moveBtn = await page.$('#moveToolBtn')
        expect(moveBtn).not.toBeNull()

        // Click should activate move tool
        await page.click('#moveToolBtn')

        // Verify it's active
        const isActive = await page.evaluate(() => {
            return document.getElementById('moveToolBtn').classList.contains('active')
        })
        expect(isActive).toBe(true)
    })

    test('dragging with move tool updates layer position', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        // Create a transparent project
        await page.waitForSelector('.open-dialog-backdrop.visible')
        await page.click('.media-option[data-type="transparent"]')
        await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
        await page.click('.canvas-size-dialog .action-btn.primary')
        await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
        await page.waitForTimeout(500)

        // Add a test image layer
        await page.evaluate(async () => {
            const canvas = document.createElement('canvas')
            canvas.width = 100
            canvas.height = 100
            const ctx = canvas.getContext('2d')
            ctx.fillStyle = 'red'
            ctx.fillRect(0, 0, 100, 100)

            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
            const file = new File([blob], 'test.png', { type: 'image/png' })
            await window.layersApp._handleAddMediaLayer(file, 'image')
        })
        await page.waitForTimeout(500)

        // Select the new layer
        await page.evaluate(() => {
            const layers = window.layersApp._layers
            const topLayer = layers[layers.length - 1]
            window.layersApp._layerStack.selectedLayerId = topLayer.id
        })

        // Activate move tool
        await page.click('#moveToolBtn')

        // Get initial position
        const initialPos = await page.evaluate(() => {
            const layer = window.layersApp._getActiveLayer()
            return { x: layer?.offsetX || 0, y: layer?.offsetY || 0 }
        })

        // Drag on canvas
        const canvas = await page.$('#selectionOverlay')
        const box = await canvas.boundingBox()

        await page.mouse.move(box.x + 200, box.y + 200)
        await page.mouse.down()
        await page.mouse.move(box.x + 250, box.y + 280)
        await page.mouse.up()

        // Check position changed
        const finalPos = await page.evaluate(() => {
            const layer = window.layersApp._getActiveLayer()
            return { x: layer?.offsetX || 0, y: layer?.offsetY || 0 }
        })

        expect(finalPos.x).not.toBe(initialPos.x)
        expect(finalPos.y).not.toBe(initialPos.y)
    })

    test('moving selection extracts pixels to new layer', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        // Create transparent project
        await page.waitForSelector('.open-dialog-backdrop.visible')
        await page.click('.media-option[data-type="transparent"]')
        await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
        await page.click('.canvas-size-dialog .action-btn.primary')
        await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
        await page.waitForTimeout(500)

        // Add a colored layer
        await page.evaluate(async () => {
            const canvas = document.createElement('canvas')
            canvas.width = 200
            canvas.height = 200
            const ctx = canvas.getContext('2d')
            ctx.fillStyle = 'blue'
            ctx.fillRect(0, 0, 200, 200)

            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
            const file = new File([blob], 'test.png', { type: 'image/png' })
            await window.layersApp._handleAddMediaLayer(file, 'image')
        })
        await page.waitForTimeout(500)

        const initialLayerCount = await page.evaluate(() => window.layersApp._layers.length)

        // Select the layer
        await page.evaluate(() => {
            const layers = window.layersApp._layers
            const topLayer = layers[layers.length - 1]
            window.layersApp._layerStack.selectedLayerId = topLayer.id
        })

        // Create a selection
        await page.evaluate(() => {
            const sm = window.layersApp._selectionManager
            sm._selectionPath = { type: 'rect', x: 50, y: 50, width: 100, height: 100 }
            sm._startAnimation()
        })
        await page.waitForTimeout(200)

        // Activate move tool
        await page.click('#moveToolBtn')

        // Drag to trigger extraction
        const canvas = await page.$('#selectionOverlay')
        const box = await canvas.boundingBox()

        await page.mouse.move(box.x + 100, box.y + 100)
        await page.mouse.down()
        await page.mouse.move(box.x + 150, box.y + 150)

        // Wait for extraction to complete by polling for the new layer
        await page.waitForFunction(
            (expectedCount) => window.layersApp._layers.length === expectedCount,
            initialLayerCount + 1,
            { timeout: 5000 }
        )

        await page.mouse.up()
        await page.waitForTimeout(200)

        // Verify new layer was created
        const finalLayerCount = await page.evaluate(() => window.layersApp._layers.length)
        expect(finalLayerCount).toBe(initialLayerCount + 1)

        // Verify the new layer is selected
        const selectedLayerName = await page.evaluate(() => {
            const layer = window.layersApp._getActiveLayer()
            return layer?.name
        })
        expect(selectedLayerName).toBe('Moved Selection')
    })
})

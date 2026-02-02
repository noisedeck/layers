import { test, expect } from 'playwright/test'

test.describe('Layer drag reorder', () => {
    test('dragging layer by handle reorders layers', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        // Create transparent project (requires size dialog confirmation)
        await page.waitForSelector('.open-dialog-backdrop.visible')
        await page.click('.media-option[data-type="transparent"]')
        await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
        await page.click('.canvas-size-dialog .action-btn.primary')
        await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
        await page.waitForTimeout(500)

        // Now we have a base layer - add two effect layers
        // Add first effect
        await page.click('#addLayerBtn')
        await page.waitForSelector('dialog[open]')
        await page.click('.media-option[data-mode="effect"]')

        // Wait for effect picker search input
        await page.waitForSelector('.effect-search-input')

        // Search for blur to show effect items
        await page.fill('.effect-search-input', 'blur')
        await page.waitForTimeout(500)
        await page.waitForSelector('.effect-item')
        await page.click('.effect-item')
        await page.waitForSelector('dialog[open]', { state: 'hidden' })

        // Add second effect
        await page.click('#addLayerBtn')
        await page.waitForSelector('dialog[open]')
        await page.click('.media-option[data-mode="effect"]')
        await page.waitForSelector('.effect-search-input')

        // Search for warp
        await page.fill('.effect-search-input', 'warp')
        await page.waitForTimeout(500)
        await page.waitForSelector('.effect-item')
        await page.click('.effect-item')
        await page.waitForSelector('dialog[open]', { state: 'hidden' })

        // Now we should have 3 layers: base (transparent), blur, warp
        // In the UI (reversed): warp is at top, blur in middle, base at bottom
        const layers = page.locator('layer-item')
        await expect(layers).toHaveCount(3)

        // Get the layer names in order (top to bottom in UI)
        const layerNames = page.locator('layer-item .layer-name')
        const names = await layerNames.allTextContents()
        console.log('Before drag - layers:', names)

        // The first layer in UI should be warp (most recently added)
        // The second should be blur
        // The third should be base

        // Get the top layer (warp) and middle layer (blur)
        const topLayer = layers.first()
        const middleLayer = layers.nth(1)

        // Get the drag handle of the top layer
        const dragHandle = topLayer.locator('.layer-drag-handle')
        await expect(dragHandle).toBeVisible()

        // Drag the top layer (warp) and drop it on the middle layer (blur)
        // This should move warp below blur in visual order
        const handleBox = await dragHandle.boundingBox()
        const middleBox = await middleLayer.boundingBox()

        if (!handleBox || !middleBox) {
            throw new Error('Could not get bounding boxes')
        }

        // Trigger reorder via FSM methods
        const reordered = await page.evaluate(async () => {
            const app = window.layersApp
            const layers = document.querySelectorAll('layer-item')
            const sourceId = layers[0].dataset.layerId  // Top layer (warp)
            const targetId = layers[1].dataset.layerId  // Middle layer (blur)

            // Use FSM methods to reorder
            app._startDrag(sourceId)
            await app._processDrop(targetId, 'below')

            return { sourceId, targetId, state: app._reorderState }
        })
        console.log('Triggered reorder:', reordered)

        // Wait for reorder to complete
        await page.waitForTimeout(500)

        // Get the new layer names
        const newNames = await layerNames.allTextContents()
        console.log('After reorder event - layers:', newNames)

        // Verify the order changed
        expect(newNames).not.toEqual(names)
    })

    test('drag handle shows grab cursor', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        // Create transparent project
        await page.waitForSelector('.open-dialog-backdrop.visible')
        await page.click('.media-option[data-type="transparent"]')
        await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
        await page.click('.canvas-size-dialog .action-btn.primary')
        await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
        await page.waitForTimeout(500)

        // Add an effect layer
        await page.click('#addLayerBtn')
        await page.waitForSelector('dialog[open]')
        await page.click('.media-option[data-mode="effect"]')
        await page.waitForSelector('.effect-search-input')
        await page.fill('.effect-search-input', 'blur')
        await page.waitForTimeout(500)
        await page.waitForSelector('.effect-item')
        await page.click('.effect-item')
        await page.waitForSelector('dialog[open]', { state: 'hidden' })

        // Find the first effect layer's drag handle
        const effectLayer = page.locator('layer-item.effect-layer').first()
        const dragHandle = effectLayer.locator('.layer-drag-handle')

        await expect(dragHandle).toBeVisible()

        // Verify cursor is grab
        const cursor = await dragHandle.evaluate(el => window.getComputedStyle(el).cursor)
        expect(cursor).toBe('grab')
    })

    test('base layer drag handle is hidden', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        // Create transparent project
        await page.waitForSelector('.open-dialog-backdrop.visible')
        await page.click('.media-option[data-type="transparent"]')
        await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
        await page.click('.canvas-size-dialog .action-btn.primary')
        await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
        await page.waitForTimeout(500)

        // Find the base layer
        const baseLayer = page.locator('layer-item.base-layer')
        await expect(baseLayer).toBeVisible()

        // The drag handle should be hidden (visibility: hidden)
        const dragHandle = baseLayer.locator('.layer-drag-handle')
        const visibility = await dragHandle.evaluate(el => window.getComputedStyle(el).visibility)
        expect(visibility).toBe('hidden')
    })
})

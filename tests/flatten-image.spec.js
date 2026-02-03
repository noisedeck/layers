import { test, expect } from 'playwright/test'

test.describe('Layer menu - Flatten Image', () => {
    test('flatten image combines all visible layers into one', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        // Create a solid base layer
        await page.waitForSelector('.open-dialog-backdrop.visible')
        await page.click('.media-option[data-type="solid"]')
        await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
        await page.click('.canvas-size-dialog .action-btn.primary')
        await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
        await page.waitForTimeout(500)

        // Add a second effect layer
        await page.evaluate(async () => {
            await window.layersApp._handleAddEffectLayer('synth/gradient')
        })
        await page.waitForTimeout(500)

        // Verify we have 2 layers
        const layerCountBefore = await page.evaluate(() => window.layersApp._layers.length)
        expect(layerCountBefore).toBe(2)

        // Clear selection (click on canvas area, not on layers)
        await page.evaluate(() => {
            window.layersApp._layerStack.selectedLayerIds = []
            window.layersApp._layerStack.dispatchEvent(new CustomEvent('selection-change'))
        })
        await page.waitForTimeout(100)

        // Verify menu shows "Flatten Image"
        const menuText = await page.locator('#layerActionMenuItem').textContent()
        expect(menuText).toBe('Flatten Image')

        // Click Layer menu and then Flatten Image
        await page.click('.menu-title:text("layer")')
        await page.click('#layerActionMenuItem')
        await page.waitForTimeout(1000)

        // Verify we now have exactly 1 layer
        const layerCountAfter = await page.evaluate(() => window.layersApp._layers.length)
        expect(layerCountAfter).toBe(1)

        // Verify it's a media layer (rasterized)
        const layerType = await page.evaluate(() => window.layersApp._layers[0]?.sourceType)
        expect(layerType).toBe('media')
    })
})

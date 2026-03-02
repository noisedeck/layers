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

import { test, expect } from 'playwright/test'

test.describe('Image menu - Crop to Selection', () => {
    test('crop to selection resizes canvas to selection bounds', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        // Create a solid base layer (1024x1024)
        await page.waitForSelector('.open-dialog-backdrop.visible')
        await page.click('.media-option[data-type="solid"]')
        await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
        await page.click('.canvas-size-dialog .action-btn.primary')
        await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
        await page.waitForTimeout(500)

        // Programmatically set a rectangular selection (100,100 to 612,612 = 512x512)
        await page.evaluate(() => {
            window.layersApp._selectionManager._selectionPath = {
                type: 'rect', x: 100, y: 100, width: 512, height: 512
            }
            window.layersApp._selectionManager._drawMarchingAnts()
        })
        await page.waitForTimeout(200)

        // Crop to selection
        await page.evaluate(async () => {
            await window.layersApp._cropToSelection()
        })
        await page.waitForTimeout(500)

        // Verify canvas is now 512x512
        const dims = await page.evaluate(() => ({
            w: window.layersApp._canvas.width,
            h: window.layersApp._canvas.height
        }))
        expect(dims.w).toBe(512)
        expect(dims.h).toBe(512)

        // Verify selection was cleared
        const hasSelection = await page.evaluate(() =>
            window.layersApp._selectionManager.hasSelection()
        )
        expect(hasSelection).toBe(false)
    })
})

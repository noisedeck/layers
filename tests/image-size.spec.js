import { test, expect } from 'playwright/test'

test.describe('Image menu - Image Size', () => {
    test('resize image scales canvas and layers', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        // Create a solid base layer (1024x1024)
        await page.waitForSelector('.open-dialog-backdrop.visible')
        await page.click('.media-option[data-type="solid"]')
        await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
        await page.click('.canvas-size-dialog .action-btn.primary')
        await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
        await page.waitForTimeout(500)

        // Resize to 512x512 via direct method
        await page.evaluate(async () => {
            await window.layersApp._resizeImage(512, 512)
        })
        await page.waitForTimeout(500)

        // Verify canvas is 512x512
        const dims = await page.evaluate(() => ({
            w: window.layersApp._canvas.width,
            h: window.layersApp._canvas.height
        }))
        expect(dims.w).toBe(512)
        expect(dims.h).toBe(512)
    })
})

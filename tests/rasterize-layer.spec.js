import { test, expect } from 'playwright/test'

test.describe('Layer menu - Rasterize Layer', () => {
    test('rasterize converts effect layer to media layer', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        // Create a solid base layer
        await page.waitForSelector('.open-dialog-backdrop.visible')
        await page.click('.media-option[data-type="solid"]')
        await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
        await page.click('.canvas-size-dialog .action-btn.primary')
        await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
        await page.waitForTimeout(500)

        // Verify it's an effect layer
        const layerTypeBefore = await page.evaluate(() => window.layersApp._layers[0]?.sourceType)
        expect(layerTypeBefore).toBe('effect')

        const layerNameBefore = await page.evaluate(() => window.layersApp._layers[0]?.name)

        // Select the layer (should already be selected, but ensure it)
        await page.evaluate(() => {
            const layerId = window.layersApp._layers[0].id
            window.layersApp._layerStack.selectedLayerId = layerId
        })
        await page.waitForTimeout(100)

        // Verify menu shows "Rasterize Layer" and is enabled
        const menuText = await page.locator('#layerActionMenuItem').textContent()
        expect(menuText).toBe('Rasterize Layer')
        const isDisabled = await page.locator('#layerActionMenuItem').evaluate(el => el.classList.contains('disabled'))
        expect(isDisabled).toBe(false)

        // Click Layer menu and then Rasterize Layer
        await page.click('.menu-title:text("layer")')
        await page.click('#layerActionMenuItem')
        await page.waitForTimeout(1000)

        // Verify layer is now media type
        const layerTypeAfter = await page.evaluate(() => window.layersApp._layers[0]?.sourceType)
        expect(layerTypeAfter).toBe('media')

        // Verify name has "(rasterized)" suffix
        const layerNameAfter = await page.evaluate(() => window.layersApp._layers[0]?.name)
        expect(layerNameAfter).toBe(`${layerNameBefore} (rasterized)`)

        // Verify still exactly 1 layer
        const layerCount = await page.evaluate(() => window.layersApp._layers.length)
        expect(layerCount).toBe(1)
    })

    test('rasterize is disabled for media layers', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        // Create a media base layer via test image
        await page.waitForSelector('.open-dialog-backdrop.visible')
        await page.evaluate(async () => {
            const canvas = document.createElement('canvas')
            canvas.width = 100
            canvas.height = 100
            const ctx = canvas.getContext('2d')
            ctx.fillStyle = 'blue'
            ctx.fillRect(0, 0, 100, 100)
            const blob = await new Promise(r => canvas.toBlob(r, 'image/png'))
            const file = new File([blob], 'test.png', { type: 'image/png' })
            await window.layersApp._handleOpenMedia(file, 'image')
        })
        await page.waitForTimeout(500)

        // Verify it's a media layer
        const layerType = await page.evaluate(() => window.layersApp._layers[0]?.sourceType)
        expect(layerType).toBe('media')

        // Select the layer
        await page.evaluate(() => {
            const layerId = window.layersApp._layers[0].id
            window.layersApp._layerStack.selectedLayerId = layerId
        })
        await page.waitForTimeout(100)

        // Verify menu shows "Rasterize Layer" but is disabled
        const menuText = await page.locator('#layerActionMenuItem').textContent()
        expect(menuText).toBe('Rasterize Layer')
        const isDisabled = await page.locator('#layerActionMenuItem').evaluate(el => el.classList.contains('disabled'))
        expect(isDisabled).toBe(true)
    })
})

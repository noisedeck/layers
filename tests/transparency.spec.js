import { test, expect } from 'playwright/test'

function readCenterAlpha(canvasEl) {
    const ctx = canvasEl.getContext('webgl2') || canvasEl.getContext('webgl')
    if (!ctx) return null
    ctx.bindFramebuffer(ctx.FRAMEBUFFER, null)
    const pixels = new Uint8Array(4)
    ctx.readPixels(
        Math.floor(canvasEl.width / 2),
        Math.floor(canvasEl.height / 2),
        1, 1,
        ctx.RGBA, ctx.UNSIGNED_BYTE, pixels
    )
    return pixels[3]
}

test.describe('Base layer transparency', () => {
    test('reducing base layer opacity shows checkerboard (canvas has transparent pixels)', async ({ page, context }) => {
        const consoleMessages = []
        page.on('console', msg => consoleMessages.push(msg.text()))

        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        // Create a solid base layer
        await page.waitForSelector('.open-dialog-backdrop.visible')
        await page.click('.media-option[data-type="solid"]')
        await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
        await page.click('.canvas-size-dialog .action-btn.primary')
        await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
        await page.waitForTimeout(2000)

        const layerItem = page.locator('layer-item').first()
        await expect(layerItem).toBeVisible()

        const opacitySlider = layerItem.locator('.layer-opacity')
        await expect(opacitySlider).toBeVisible()

        const canvas = page.locator('#canvas')

        // Should be fully opaque at 100% opacity
        const initialAlpha = await canvas.evaluate(readCenterAlpha)
        console.log('Initial alpha:', initialAlpha)
        expect(initialAlpha).toBe(255)

        // Reduce opacity to 50%
        const sliderValue = await opacitySlider.evaluate((el) => {
            el.value = '50'
            el.dispatchEvent(new Event('input', { bubbles: true }))
            return el.value
        })
        console.log('Slider value after set:', sliderValue)
        await page.waitForTimeout(1000)

        const opacityText = await page.locator('.layer-opacity-value').first().textContent()
        console.log('Opacity text:', opacityText)

        // Force a rebuild to apply the opacity change
        const debugInfo = await page.evaluate(async () => {
            const app = window.layersApp
            if (!app || !app._renderer) return 'No app or renderer'
            const renderer = app._renderer
            await renderer.rebuild()
            return {
                currentDsl: renderer.currentDsl,
                layerCount: renderer._layers?.length,
                layerOpacity: renderer._layers?.[0]?.opacity,
                hasBlendPasses: renderer._renderer?.pipeline?.graph?.passes?.filter(p => p.effectFunc === 'blendMode')?.length
            }
        })
        console.log('Debug info:', debugInfo)

        const shaderCheck = await page.evaluate(() => {
            const effects = window.noisemaker?.getAllEffects?.() || new Map()
            for (const [key, effect] of effects) {
                if (key.includes('blendMode')) {
                    const glsl = effect?.shaders?.blendMode?.glsl || ''
                    return {
                        hasEffect: true,
                        hasAlphaFix: glsl.includes('mix(color1.a, color2.a, amt)'),
                        alphaLine: glsl.match(/color\.a = [^;]+;/)?.[0] || 'not found'
                    }
                }
            }
            return { hasEffect: false }
        })
        console.log('Shader check:', shaderCheck)

        await page.waitForTimeout(500)
        await page.screenshot({ path: 'test-results/transparency-test.png' })

        // At 50% opacity, alpha should be around 128
        const reducedAlpha = await canvas.evaluate(readCenterAlpha)
        console.log('Reduced alpha:', reducedAlpha)
        expect(reducedAlpha).toBeLessThan(255)
        expect(reducedAlpha).toBeGreaterThan(0)

        // Reduce opacity to 0%
        await opacitySlider.evaluate((el) => {
            el.value = 0
            el.dispatchEvent(new Event('input', { bubbles: true }))
        })
        await page.waitForTimeout(500)

        // Should be fully transparent (checkerboard visible)
        const zeroAlpha = await canvas.evaluate(readCenterAlpha)
        console.log('Zero alpha:', zeroAlpha)
        expect(zeroAlpha).toBe(0)
    })
})

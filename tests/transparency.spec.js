import { test, expect } from 'playwright/test'

test.describe('Base layer transparency', () => {
    test('reducing base layer opacity shows checkerboard (canvas has transparent pixels)', async ({ page, context }) => {
        // Collect console messages
        const consoleMessages = []
        page.on('console', msg => consoleMessages.push(msg.text()))

        // Navigate to the app with cache disabled
        await page.goto('/', { waitUntil: 'networkidle' })

        // Wait for loading screen to disappear
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        // The open dialog should be visible - click "Solid" to create a solid base layer
        await page.waitForSelector('.open-dialog-backdrop.visible')
        await page.click('.media-option[data-type="solid"]')

        // Wait for canvas size dialog
        await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })

        // Click Create button (first primary button in the dialog)
        await page.click('.canvas-size-dialog .action-btn.primary')

        // Wait for dialogs to close
        await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })

        // Wait for canvas to render (needs time for shader compilation + render)
        await page.waitForTimeout(2000)

        // Find the base layer's opacity slider
        const layerItem = page.locator('layer-item').first()
        await expect(layerItem).toBeVisible()

        const opacitySlider = layerItem.locator('.layer-opacity')
        await expect(opacitySlider).toBeVisible()

        // Get initial canvas pixel data - should be opaque
        const canvas = page.locator('#canvas')
        const initialAlpha = await canvas.evaluate((el) => {
            const ctx = el.getContext('webgl2') || el.getContext('webgl')
            if (!ctx) return null
            // Bind to default framebuffer (canvas)
            ctx.bindFramebuffer(ctx.FRAMEBUFFER, null)
            const pixels = new Uint8Array(4)
            ctx.readPixels(
                Math.floor(el.width / 2),
                Math.floor(el.height / 2),
                1, 1,
                ctx.RGBA, ctx.UNSIGNED_BYTE, pixels
            )
            return pixels[3]
        })

        console.log('Initial alpha:', initialAlpha)
        expect(initialAlpha).toBe(255) // Should be fully opaque at 100% opacity

        // Reduce opacity to 50% by setting slider value
        const sliderValue = await opacitySlider.evaluate((el) => {
            el.value = '50'
            el.dispatchEvent(new Event('input', { bubbles: true }))
            return el.value
        })
        console.log('Slider value after set:', sliderValue)

        // Wait for render to complete
        await page.waitForTimeout(1000)

        // Check if opacity text updated
        const opacityText = await page.locator('.layer-opacity-value').first().textContent()
        console.log('Opacity text:', opacityText)

        // Debug: check what the renderer is doing and force a rebuild
        const debugInfo = await page.evaluate(async () => {
            const app = window.layersApp
            if (!app || !app._renderer) return 'No app or renderer'
            const renderer = app._renderer

            // Force a rebuild to apply the opacity change (async)
            await renderer.rebuild()

            return {
                currentDsl: renderer.currentDsl,
                layerCount: renderer._layers?.length,
                layerOpacity: renderer._layers?.[0]?.opacity,
                hasBlendPasses: renderer._renderer?.pipeline?.graph?.passes?.filter(p => p.effectFunc === 'blendMode')?.length
            }
        })
        console.log('Debug info:', debugInfo)

        // Check if the shader has the correct alpha blend line
        const shaderCheck = await page.evaluate(() => {
            // Look for blendMode effect in the registry
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

        // Wait for render frame
        await page.waitForTimeout(500)

        // Take a screenshot of the canvas area to visually verify
        await page.screenshot({ path: 'test-results/transparency-test.png' })

        // Get canvas pixel data - should now have transparency
        const reducedAlpha = await canvas.evaluate((el) => {
            const ctx = el.getContext('webgl2') || el.getContext('webgl')
            if (!ctx) return null
            ctx.bindFramebuffer(ctx.FRAMEBUFFER, null)
            const pixels = new Uint8Array(4)
            ctx.readPixels(
                Math.floor(el.width / 2),
                Math.floor(el.height / 2),
                1, 1,
                ctx.RGBA, ctx.UNSIGNED_BYTE, pixels
            )
            return pixels[3]
        })

        console.log('Reduced alpha:', reducedAlpha)

        // Alpha should be less than 255 (not fully opaque)
        // At 50% opacity, alpha should be around 128
        expect(reducedAlpha).toBeLessThan(255)
        expect(reducedAlpha).toBeGreaterThan(0)

        // Reduce opacity to 0%
        await opacitySlider.evaluate((el) => {
            el.value = 0
            el.dispatchEvent(new Event('input', { bubbles: true }))
        })

        // Wait for render
        await page.waitForTimeout(500)

        // Get canvas pixel data - should be fully transparent
        const zeroAlpha = await canvas.evaluate((el) => {
            const ctx = el.getContext('webgl2') || el.getContext('webgl')
            if (!ctx) return null
            ctx.bindFramebuffer(ctx.FRAMEBUFFER, null)
            const pixels = new Uint8Array(4)
            ctx.readPixels(
                Math.floor(el.width / 2),
                Math.floor(el.height / 2),
                1, 1,
                ctx.RGBA, ctx.UNSIGNED_BYTE, pixels
            )
            return pixels[3]
        })

        console.log('Zero alpha:', zeroAlpha)

        // Alpha should be 0 (fully transparent = checkerboard visible)
        expect(zeroAlpha).toBe(0)
    })
})

import { test, expect } from 'playwright/test'

test.describe('WebGL error handling', () => {
    test('creating gradient composition renders without WebGL errors', async ({ page }) => {
        // Collect console messages to check for WebGL errors
        const consoleMessages = []
        const webglErrors = []

        page.on('console', msg => {
            const text = msg.text()
            consoleMessages.push(text)

            // Capture any WebGL error messages
            if (text.includes('WebGL Error') || text.includes('GL_INVALID')) {
                webglErrors.push(text)
            }
        })

        // Navigate to the app
        await page.goto('/', { waitUntil: 'networkidle' })

        // Wait for loading screen to disappear
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        // The open dialog should be visible - click "Gradient" to create a gradient base layer
        await page.waitForSelector('.open-dialog-backdrop.visible')

        // Find and click the gradient option
        const gradientOption = page.locator('.media-option[data-type="gradient"]')
        await expect(gradientOption).toBeVisible({ timeout: 5000 })
        await gradientOption.click()

        // Wait for canvas size dialog
        await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })

        // Click Create button
        await page.click('.canvas-size-dialog .action-btn.primary')

        // Wait for dialogs to close
        await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })

        // Wait for canvas to render (shader compilation + first frame)
        await page.waitForTimeout(2000)

        // Verify canvas is visible
        const canvas = page.locator('#canvas')
        await expect(canvas).toBeVisible()

        // Verify a layer was created
        const layerItem = page.locator('layer-item').first()
        await expect(layerItem).toBeVisible()

        // Wait a bit more for any delayed errors
        await page.waitForTimeout(500)

        // Take a screenshot for debugging
        await page.screenshot({ path: 'test-results/webgl-gradient-test.png' })

        // Log all console messages for debugging
        console.log('Console messages:', consoleMessages.filter(m =>
            m.includes('WebGL') || m.includes('Error') || m.includes('error')
        ))

        // Check for WebGL errors - there should be none
        expect(webglErrors).toEqual([])
    })

    test('creating solid composition renders without WebGL errors', async ({ page }) => {
        // Collect console messages to check for WebGL errors
        const webglErrors = []

        page.on('console', msg => {
            const text = msg.text()
            if (text.includes('WebGL Error') || text.includes('GL_INVALID')) {
                webglErrors.push(text)
            }
        })

        // Navigate to the app
        await page.goto('/', { waitUntil: 'networkidle' })

        // Wait for loading screen to disappear
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        // The open dialog should be visible - click "Solid"
        await page.waitForSelector('.open-dialog-backdrop.visible')
        await page.click('.media-option[data-type="solid"]')

        // Wait for canvas size dialog
        await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })

        // Click Create button
        await page.click('.canvas-size-dialog .action-btn.primary')

        // Wait for dialogs to close
        await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })

        // Wait for canvas to render
        await page.waitForTimeout(2000)

        // Verify canvas is visible
        const canvas = page.locator('#canvas')
        await expect(canvas).toBeVisible()

        // Take a screenshot for debugging
        await page.screenshot({ path: 'test-results/webgl-solid-test.png' })

        // Check for WebGL errors - there should be none
        expect(webglErrors).toEqual([])
    })

    test('adding effect layer to composition renders without WebGL errors', async ({ page }) => {
        // Collect WebGL errors
        const webglErrors = []

        page.on('console', msg => {
            const text = msg.text()
            if (text.includes('WebGL Error') || text.includes('GL_INVALID')) {
                webglErrors.push(text)
            }
        })

        // Navigate to the app
        await page.goto('/', { waitUntil: 'networkidle' })

        // Wait for loading screen to disappear
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        // Create solid base layer first
        await page.waitForSelector('.open-dialog-backdrop.visible')
        await page.click('.media-option[data-type="solid"]')
        await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
        await page.click('.canvas-size-dialog .action-btn.primary')
        await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })

        // Wait for initial render
        await page.waitForTimeout(1500)

        // Click add layer button
        const addLayerBtn = page.locator('#addLayerBtn')
        await expect(addLayerBtn).toBeVisible()
        await addLayerBtn.click()

        // Wait for add layer dialog (uses different class)
        await page.waitForSelector('.add-layer-dialog', { timeout: 5000 })

        // Select effect mode
        const effectOption = page.locator('.media-option[data-mode="effect"]')
        await expect(effectOption).toBeVisible()
        await effectOption.click()

        // Wait for effect picker to show
        await page.waitForTimeout(500)

        // Click first available effect in the list
        const firstEffect = page.locator('.effect-option').first()
        if (await firstEffect.isVisible()) {
            await firstEffect.click()
        }

        // Wait for render
        await page.waitForTimeout(2000)

        // Take a screenshot
        await page.screenshot({ path: 'test-results/webgl-add-layer-test.png' })

        // Check for WebGL errors
        if (webglErrors.length > 0) {
            console.log('WebGL Errors found:', webglErrors)
        }
        expect(webglErrors).toEqual([])
    })
})

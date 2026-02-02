import { test, expect } from 'playwright/test'

test.describe('Layer params expando', () => {
    test('expando toggle toggles expanded state on layer item', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        // Create a transparent project (transparent/solid require size dialog confirmation)
        await page.waitForSelector('.open-dialog-backdrop.visible')
        await page.click('.media-option[data-type="transparent"]')
        await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
        await page.click('.canvas-size-dialog .action-btn.primary')
        await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
        await page.waitForTimeout(500)

        // Click the add layer button
        await page.click('#addLayerBtn')

        // Wait for add layer dialog to appear
        await page.waitForSelector('dialog[open]')

        // Click "Add Effect" option
        await page.click('.media-option[data-mode="effect"]')

        // Wait for effect picker search input and search for an effect
        await page.waitForSelector('.effect-search-input')
        await page.fill('.effect-search-input', 'blur')
        await page.waitForTimeout(500)
        await page.waitForSelector('.effect-item')

        // Click the first available effect
        await page.click('.effect-item')

        // Wait for dialog to close and layer to be added
        await page.waitForSelector('dialog[open]', { state: 'hidden' })

        // Find the effect layer (should have the params toggle)
        const layerItem = page.locator('layer-item.effect-layer:not(.base-layer)')
        await expect(layerItem).toBeVisible()

        // Find the params toggle button
        const toggleBtn = layerItem.locator('.layer-params-toggle')
        await expect(toggleBtn).toBeVisible()

        // Verify params are initially collapsed (layer-item should NOT have params-expanded class)
        await expect(layerItem).not.toHaveClass(/params-expanded/)

        // Verify toggle is not expanded initially
        await expect(toggleBtn).not.toHaveClass(/expanded/)

        // Find the effect-params element
        const effectParams = layerItem.locator('effect-params')

        // Verify effect-params exists
        await expect(effectParams).toBeAttached()

        // Click the toggle to expand
        await toggleBtn.click()

        // Verify layer-item now has params-expanded class
        await expect(layerItem).toHaveClass(/params-expanded/)

        // Verify toggle has expanded class (triangle should be rotated)
        await expect(toggleBtn).toHaveClass(/expanded/)

        // Click toggle again to collapse
        await toggleBtn.click()

        // Verify layer-item no longer has params-expanded class
        await expect(layerItem).not.toHaveClass(/params-expanded/)

        // Verify toggle no longer has expanded class
        await expect(toggleBtn).not.toHaveClass(/expanded/)
    })

    test('effect-params shows actual parameters when expanded', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        // Create a transparent project
        await page.waitForSelector('.open-dialog-backdrop.visible')
        await page.click('.media-option[data-type="transparent"]')
        await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
        await page.click('.canvas-size-dialog .action-btn.primary')
        await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
        await page.waitForTimeout(500)

        // Click the add layer button
        await page.click('#addLayerBtn')

        // Wait for dialog to appear
        await page.waitForSelector('dialog[open]')

        // Click "Add Effect" option
        await page.click('.media-option[data-mode="effect"]')

        // Wait for effect picker search input
        await page.waitForSelector('.effect-search-input')

        // Search for "warp" which has parameters (frequency, octaves, etc.)
        await page.fill('.effect-search-input', 'warp')
        await page.waitForTimeout(300) // Wait for filter to apply

        // Click the warp effect
        const warpEffect = page.locator('.effect-item').first()
        await warpEffect.click()

        // Wait for dialog to close
        await page.waitForSelector('dialog[open]', { state: 'hidden' })

        // Find the effect layer
        const layerItem = page.locator('layer-item.effect-layer:not(.base-layer)')
        await expect(layerItem).toBeVisible()

        // Find the params toggle button
        const toggleBtn = layerItem.locator('.layer-params-toggle')
        await expect(toggleBtn).toBeVisible()

        // Click to expand
        await toggleBtn.click()

        // Verify expanded state
        await expect(layerItem).toHaveClass(/params-expanded/)

        // Find effect-params
        const effectParams = layerItem.locator('effect-params')

        // Wait for params to load (async loading)
        await page.waitForTimeout(500)

        // Verify effect-params is visible
        await expect(effectParams).toBeVisible()

        // Verify it does NOT have the empty class
        await expect(effectParams).not.toHaveClass(/empty/)

        // Verify actual parameter controls are present
        const controlGroups = effectParams.locator('.control-group')
        await expect(controlGroups.first()).toBeVisible()

        // Verify at least one control label exists (e.g., "frequency", "octaves")
        const controlLabels = effectParams.locator('.control-label')
        const labelCount = await controlLabels.count()
        expect(labelCount).toBeGreaterThan(0)

        // Verify at least one slider exists
        const sliders = effectParams.locator('.control-slider')
        const sliderCount = await sliders.count()
        expect(sliderCount).toBeGreaterThan(0)

        // Collapse and verify hidden
        await toggleBtn.click()
        await expect(layerItem).not.toHaveClass(/params-expanded/)
        await expect(effectParams).not.toBeVisible()
    })
})

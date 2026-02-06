import { test, expect } from 'playwright/test'

test.describe('Export Video Dialog', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        // Create a solid base layer
        await page.waitForSelector('.open-dialog-backdrop.visible')
        await page.click('.media-option[data-type="solid"]')
        await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
        await page.click('.canvas-size-dialog .action-btn.primary')
        await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
        await page.waitForTimeout(500)
    })

    test('opens via menu and shows current canvas dimensions', async ({ page }) => {
        await page.click('.menu-title:has-text("file")')
        await page.click('#exportVideoMenuItem')

        const dialog = page.locator('#exportModal')
        await expect(dialog).toBeVisible()

        const width = await page.locator('#exportWidth').inputValue()
        const height = await page.locator('#exportHeight').inputValue()
        expect(width).toBe('1024')
        expect(height).toBe('1024')
    })

    test('shows settings view initially, not progress', async ({ page }) => {
        await page.click('.menu-title:has-text("file")')
        await page.click('#exportVideoMenuItem')

        await expect(page.locator('#exportDialogView')).toBeVisible()
        await expect(page.locator('#exportProgressView')).not.toBeVisible()
    })

    test('updates total frames when settings change', async ({ page }) => {
        await page.click('.menu-title:has-text("file")')
        await page.click('#exportVideoMenuItem')

        // Default: 30fps * 15s * 1 loop = 450 frames
        await expect(page.locator('#exportTotalFrames')).toHaveText('450 frames')

        // Change duration to 10
        await page.fill('#exportDuration', '10')
        await expect(page.locator('#exportTotalFrames')).toHaveText('300 frames')

        // Change framerate to 60
        await page.selectOption('#exportFramerate', '60')
        await expect(page.locator('#exportTotalFrames')).toHaveText('600 frames')
    })

    test('closes on cancel button', async ({ page }) => {
        await page.click('.menu-title:has-text("file")')
        await page.click('#exportVideoMenuItem')

        await expect(page.locator('#exportModal')).toBeVisible()

        await page.click('#exportCancelBtn')
        await expect(page.locator('#exportModal')).not.toBeVisible()
    })

    test('closes on Escape key', async ({ page }) => {
        await page.click('.menu-title:has-text("file")')
        await page.click('#exportVideoMenuItem')

        await expect(page.locator('#exportModal')).toBeVisible()

        await page.keyboard.press('Escape')
        await expect(page.locator('#exportModal')).not.toBeVisible()
    })

    test('pauses and resumes renderer', async ({ page }) => {
        // Verify renderer is running before dialog
        const runningBefore = await page.evaluate(() => window.layersApp._renderer.isRunning)
        expect(runningBefore).toBe(true)

        // Open dialog — renderer should pause
        await page.click('.menu-title:has-text("file")')
        await page.click('#exportVideoMenuItem')
        await page.waitForTimeout(100)

        const runningDuring = await page.evaluate(() => window.layersApp._renderer.isRunning)
        expect(runningDuring).toBe(false)

        // Close dialog — renderer should resume
        await page.keyboard.press('Escape')
        await page.waitForTimeout(100)

        const runningAfter = await page.evaluate(() => window.layersApp._renderer.isRunning)
        expect(runningAfter).toBe(true)
    })
})

import { test, expect } from 'playwright/test'

test.describe('Export Image Dialog', () => {
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
        // Open File menu
        await page.click('.menu-title:has-text("file")')
        await page.click('#exportImageMenuItem')

        // Dialog should be visible
        const dialog = page.locator('#exportImageModal')
        await expect(dialog).toBeVisible()

        // Width/height should match canvas (1024x1024 default)
        const width = await page.locator('#exportImageWidth').inputValue()
        const height = await page.locator('#exportImageHeight').inputValue()
        expect(width).toBe('1024')
        expect(height).toBe('1024')
    })

    test('closes on cancel button', async ({ page }) => {
        await page.click('.menu-title:has-text("file")')
        await page.click('#exportImageMenuItem')

        await expect(page.locator('#exportImageModal')).toBeVisible()

        await page.click('#exportImageCancelBtn')
        await expect(page.locator('#exportImageModal')).not.toBeVisible()
    })

    test('closes on Escape key', async ({ page }) => {
        await page.click('.menu-title:has-text("file")')
        await page.click('#exportImageMenuItem')

        await expect(page.locator('#exportImageModal')).toBeVisible()

        await page.keyboard.press('Escape')
        await expect(page.locator('#exportImageModal')).not.toBeVisible()
    })

    test('hides quality for PNG, shows for JPEG', async ({ page }) => {
        await page.click('.menu-title:has-text("file")')
        await page.click('#exportImageMenuItem')

        // PNG is default — quality should be hidden
        const qualityGroup = page.locator('#exportImageQualityGroup')
        await expect(qualityGroup).toBeHidden()

        // Switch to JPEG
        await page.selectOption('#exportImageFormat', 'jpg')
        await expect(qualityGroup).toBeVisible()

        // Switch back to PNG
        await page.selectOption('#exportImageFormat', 'png')
        await expect(qualityGroup).toBeHidden()
    })
})

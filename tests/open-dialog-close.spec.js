import { test, expect } from 'playwright/test'

/**
 * Helper to open a menu item from the file menu
 */
async function openFileMenuItem(page, menuItemId) {
    const fileMenu = page.locator('.menu').nth(1)
    await fileMenu.locator('.menu-title').click()
    await fileMenu.locator('.menu-items:not(.hide)').waitFor({ state: 'visible' })
    await fileMenu.locator(`#${menuItemId}`).click()
}

/**
 * Helper to create a solid base project
 */
async function createSolidProject(page) {
    await page.waitForSelector('.open-dialog-backdrop.visible')
    await page.click('.media-option[data-type="solid"]')
    await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
    await page.click('.canvas-size-dialog .action-btn.primary')
    await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
    await page.waitForTimeout(1000)
}

test.describe('Open dialog close behavior', () => {
    test('open dialog cannot be closed at startup (no active project)', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        // The open dialog should be visible
        const backdrop = page.locator('.open-dialog-backdrop.visible')
        await expect(backdrop).toBeVisible()

        // Close button should NOT be visible (no active project)
        const closeBtn = page.locator('.open-dialog .dialog-close')
        await expect(closeBtn).toBeHidden()

        // Clicking backdrop should NOT close the dialog
        await backdrop.click({ position: { x: 10, y: 10 } })
        await expect(backdrop).toBeVisible()

        // ESC should NOT close the dialog
        await page.keyboard.press('Escape')
        await expect(backdrop).toBeVisible()
    })

    test('open dialog can be closed from File > Open menu (has active project)', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        // Create a project first
        await createSolidProject(page)

        // Now open File > Open menu
        await openFileMenuItem(page, 'openMenuItem')

        // Handle possible confirm dialog for unsaved changes
        const confirmDialog = page.locator('.confirm-dialog-backdrop.visible')
        if (await confirmDialog.isVisible({ timeout: 500 }).catch(() => false)) {
            await page.click('.confirm-dialog .action-btn.danger')
            await confirmDialog.waitFor({ state: 'hidden' })
        }

        // The open dialog should appear
        const backdrop = page.locator('.open-dialog-backdrop.visible')
        await expect(backdrop).toBeVisible({ timeout: 5000 })

        // Close button SHOULD be visible (has active project)
        const closeBtn = page.locator('.open-dialog .dialog-close')
        await expect(closeBtn).toBeVisible()

        // Click close button - dialog should close
        await closeBtn.click()
        await expect(backdrop).toBeHidden()
    })

    test('open dialog can be closed via backdrop click when has active project', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        // Create a project first
        await createSolidProject(page)

        // Open File > Open menu
        await openFileMenuItem(page, 'openMenuItem')

        // Handle possible confirm dialog
        const confirmDialog = page.locator('.confirm-dialog-backdrop.visible')
        if (await confirmDialog.isVisible({ timeout: 500 }).catch(() => false)) {
            await page.click('.confirm-dialog .action-btn.danger')
            await confirmDialog.waitFor({ state: 'hidden' })
        }

        const backdrop = page.locator('.open-dialog-backdrop.visible')
        await expect(backdrop).toBeVisible({ timeout: 5000 })

        // Click on backdrop (not modal) - should close
        await backdrop.click({ position: { x: 10, y: 10 } })
        await expect(backdrop).toBeHidden()
    })

    test('open dialog can be closed via ESC when has active project', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        // Create a project first
        await createSolidProject(page)

        // Open File > Open menu
        await openFileMenuItem(page, 'openMenuItem')

        // Handle possible confirm dialog
        const confirmDialog = page.locator('.confirm-dialog-backdrop.visible')
        if (await confirmDialog.isVisible({ timeout: 500 }).catch(() => false)) {
            await page.click('.confirm-dialog .action-btn.danger')
            await confirmDialog.waitFor({ state: 'hidden' })
        }

        const backdrop = page.locator('.open-dialog-backdrop.visible')
        await expect(backdrop).toBeVisible({ timeout: 5000 })

        // Press ESC - should close
        await page.keyboard.press('Escape')
        await expect(backdrop).toBeHidden()
    })

    test('open dialog CAN be closed after File > New (project not reset until selection)', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        // Create a project first
        await createSolidProject(page)

        // Now click File > New
        await openFileMenuItem(page, 'newMenuItem')

        // Handle possible confirm dialog
        const confirmDialog = page.locator('.confirm-dialog-backdrop.visible')
        if (await confirmDialog.isVisible({ timeout: 500 }).catch(() => false)) {
            await page.click('.confirm-dialog .action-btn.danger')
            await confirmDialog.waitFor({ state: 'hidden' })
        }

        // The open dialog should appear
        const backdrop = page.locator('.open-dialog-backdrop.visible')
        await expect(backdrop).toBeVisible({ timeout: 5000 })

        // Close button SHOULD be visible (project still exists until user selects something)
        const closeBtn = page.locator('.open-dialog .dialog-close')
        await expect(closeBtn).toBeVisible()

        // ESC SHOULD close the dialog
        await page.keyboard.press('Escape')
        await expect(backdrop).toBeHidden()
    })
})

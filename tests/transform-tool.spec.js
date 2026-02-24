import { test, expect } from 'playwright/test'

async function createTransparentProject(page) {
    await page.waitForSelector('.open-dialog-backdrop.visible')
    await page.click('.media-option[data-type="transparent"]')
    await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
    await page.click('.canvas-size-dialog .action-btn.primary')
    await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
    await page.waitForTimeout(500)
}

test.describe('Transform tool', () => {
    test('transform tool button exists and activates', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)

        const transformBtn = await page.$('#transformToolBtn')
        expect(transformBtn).not.toBeNull()

        await page.click('#transformToolBtn')

        const isActive = await page.evaluate(() => {
            return document.getElementById('transformToolBtn').classList.contains('active')
        })
        expect(isActive).toBe(true)
    })

    test('T key activates transform tool', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)

        await page.keyboard.press('t')

        const isActive = await page.evaluate(() => {
            return document.getElementById('transformToolBtn').classList.contains('active')
        })
        expect(isActive).toBe(true)
    })

    test('Escape returns to selection tool', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)

        // Activate transform tool
        await page.click('#transformToolBtn')
        await page.waitForTimeout(200)

        // Verify transform tool is active
        const isTransformActive = await page.evaluate(() => {
            return document.getElementById('transformToolBtn').classList.contains('active')
        })
        expect(isTransformActive).toBe(true)

        // Press Escape — should return to selection tool
        await page.keyboard.press('Escape')
        await page.waitForTimeout(200)

        const isSelectionActive = await page.evaluate(() => {
            return document.getElementById('selectionToolBtn').classList.contains('active')
        })
        expect(isSelectionActive).toBe(true)

        const isTransformDeactivated = await page.evaluate(() => {
            return !document.getElementById('transformToolBtn').classList.contains('active')
        })
        expect(isTransformDeactivated).toBe(true)
    })
})

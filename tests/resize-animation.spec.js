import { test, expect } from 'playwright/test'
import path from 'path'

test.describe('Image menu - Resize preserves animation', () => {
    test('resizing animated video keeps canvas animated', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        // Load video file via the app's open media handler
        const videoPath = path.resolve(process.env.HOME, 'Downloads/noisedeck-1770311624501.mp4')
        await page.waitForSelector('.open-dialog-backdrop.visible')
        const fileInput = await page.locator('.open-dialog-backdrop input[type="file"]')
        await fileInput.setInputFiles(videoPath)
        await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 15000 })
        await page.waitForTimeout(1000)

        // Verify renderer is running before resize
        const runningBefore = await page.evaluate(() => window.layersApp._renderer.isRunning)
        expect(runningBefore).toBe(true)

        // Capture a frame before resize
        const frameBefore = await page.evaluate(() => {
            const canvas = window.layersApp._canvas
            const ctx = canvas.getContext('webgl2') || canvas.getContext('webgl')
            const pixels = new Uint8Array(4)
            ctx.readPixels(canvas.width / 2, canvas.height / 2, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, pixels)
            return Array.from(pixels)
        })

        // Resize to 720x720
        await page.evaluate(async () => {
            await window.layersApp._resizeImage(720, 720)
        })
        await page.waitForTimeout(500)

        // Verify canvas dimensions
        const dims = await page.evaluate(() => ({
            w: window.layersApp._canvas.width,
            h: window.layersApp._canvas.height
        }))
        expect(dims.w).toBe(720)
        expect(dims.h).toBe(720)

        // Verify renderer is still running after resize
        const runningAfter = await page.evaluate(() => window.layersApp._renderer.isRunning)
        expect(runningAfter).toBe(true)

        // Verify animation: capture two frames 500ms apart and check they differ
        const frame1 = await page.evaluate(() => {
            const canvas = window.layersApp._canvas
            const ctx = canvas.getContext('webgl2') || canvas.getContext('webgl')
            const pixels = new Uint8Array(canvas.width * 4)
            ctx.readPixels(0, canvas.height / 2, canvas.width, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, pixels)
            return Array.from(pixels)
        })

        await page.waitForTimeout(500)

        const frame2 = await page.evaluate(() => {
            const canvas = window.layersApp._canvas
            const ctx = canvas.getContext('webgl2') || canvas.getContext('webgl')
            const pixels = new Uint8Array(canvas.width * 4)
            ctx.readPixels(0, canvas.height / 2, canvas.width, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, pixels)
            return Array.from(pixels)
        })

        // Frames must differ (animation is running)
        let diffCount = 0
        for (let i = 0; i < frame1.length; i++) {
            if (frame1[i] !== frame2[i]) diffCount++
        }
        expect(diffCount).toBeGreaterThan(0)
    })
})

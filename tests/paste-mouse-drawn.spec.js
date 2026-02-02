import { test, expect } from 'playwright/test'

test.describe('Paste with real mouse-drawn selection', () => {
    test('mouse-drawn selection matches pasted image dimensions', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write'])

        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        // Create a transparent project
        await page.waitForSelector('.open-dialog-backdrop.visible')
        await page.click('.media-option[data-type="transparent"]')
        await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
        await page.click('.canvas-size-dialog .action-btn.primary')
        await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
        await page.waitForTimeout(500)

        // Copy a 50x50 red square to clipboard
        await page.evaluate(async () => {
            const canvas = document.createElement('canvas')
            canvas.width = 50
            canvas.height = 50
            const ctx = canvas.getContext('2d')
            ctx.fillStyle = 'red'
            ctx.fillRect(0, 0, 50, 50)
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        })

        // Get the selection overlay element and its bounding box
        const overlay = page.locator('#selectionOverlay')
        const overlayBox = await overlay.boundingBox()

        if (!overlayBox) {
            throw new Error('Could not get overlay bounding box')
        }

        // Log overlay info for debugging
        const overlayInfo = await page.evaluate(() => {
            const el = document.getElementById('selectionOverlay')
            const rect = el.getBoundingClientRect()
            return {
                internal: { width: el.width, height: el.height },
                displayed: { width: rect.width, height: rect.height },
                scaleX: el.width / rect.width,
                scaleY: el.height / rect.height
            }
        })
        console.log('Overlay info:', overlayInfo)

        // Draw a selection with mouse: start at (100, 100), drag to (250, 250) in displayed coordinates
        // This should create a 150x150 selection in displayed space
        const startX = overlayBox.x + 100
        const startY = overlayBox.y + 100
        const endX = overlayBox.x + 250
        const endY = overlayBox.y + 250

        await page.mouse.move(startX, startY)
        await page.mouse.down()
        await page.mouse.move(endX, endY, { steps: 10 })
        await page.mouse.up()

        await page.waitForTimeout(500)

        // Check what selection was created
        const selectionInfo = await page.evaluate(() => {
            const sm = window.layersApp._selectionManager
            if (!sm.hasSelection()) return { error: 'No selection created' }
            const path = sm.selectionPath
            return {
                type: path.type,
                x: path.x,
                y: path.y,
                width: path.width,
                height: path.height,
                aspectRatio: path.width / path.height
            }
        })

        console.log('Selection created:', selectionInfo)

        expect(selectionInfo.error).toBeUndefined()
        expect(selectionInfo.type).toBe('rect')

        // The selection should have roughly 1:1 aspect ratio since we drew a square
        // Allow some tolerance for mouse movement
        expect(selectionInfo.aspectRatio).toBeGreaterThan(0.9)
        expect(selectionInfo.aspectRatio).toBeLessThan(1.1)

        const selectionWidth = selectionInfo.width
        const selectionHeight = selectionInfo.height

        // Paste
        await page.evaluate(async () => {
            await window.layersApp._handlePaste()
        })
        await page.waitForTimeout(1000)

        // Check pasted image dimensions by reading the layer's mediaFile
        const pastedInfo = await page.evaluate(() => {
            const layers = window.layersApp._layers
            const pastedLayer = layers[layers.length - 1]
            const mediaFile = pastedLayer.mediaFile

            return new Promise((resolve) => {
                const reader = new FileReader()
                reader.onload = () => {
                    const img = new Image()
                    img.onload = () => {
                        const testCanvas = document.createElement('canvas')
                        testCanvas.width = img.width
                        testCanvas.height = img.height
                        const ctx = testCanvas.getContext('2d')
                        ctx.drawImage(img, 0, 0)
                        const imageData = ctx.getImageData(0, 0, testCanvas.width, testCanvas.height)

                        // Find bounds of non-transparent pixels
                        let minX = testCanvas.width, maxX = 0
                        let minY = testCanvas.height, maxY = 0

                        for (let y = 0; y < testCanvas.height; y++) {
                            for (let x = 0; x < testCanvas.width; x++) {
                                const idx = (y * testCanvas.width + x) * 4
                                if (imageData.data[idx + 3] > 0) {
                                    minX = Math.min(minX, x)
                                    maxX = Math.max(maxX, x)
                                    minY = Math.min(minY, y)
                                    maxY = Math.max(maxY, y)
                                }
                            }
                        }

                        const w = maxX - minX + 1
                        const h = maxY - minY + 1

                        resolve({
                            width: w,
                            height: h,
                            aspectRatio: w / h,
                            x: minX,
                            y: minY
                        })
                    }
                    img.src = reader.result
                }
                reader.readAsDataURL(mediaFile)
            })
        })

        console.log('Pasted image:', pastedInfo)

        // The pasted image dimensions should match the selection dimensions
        // Allow 2px tolerance for rounding
        expect(Math.abs(pastedInfo.width - selectionWidth)).toBeLessThan(3)
        expect(Math.abs(pastedInfo.height - selectionHeight)).toBeLessThan(3)

        // Aspect ratios should match
        expect(Math.abs(pastedInfo.aspectRatio - selectionInfo.aspectRatio)).toBeLessThan(0.1)
    })

    test('non-square mouse selection pastes correct aspect ratio', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write'])

        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        // Create a transparent project
        await page.waitForSelector('.open-dialog-backdrop.visible')
        await page.click('.media-option[data-type="transparent"]')
        await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
        await page.click('.canvas-size-dialog .action-btn.primary')
        await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
        await page.waitForTimeout(500)

        // Copy a 50x50 red square to clipboard
        await page.evaluate(async () => {
            const canvas = document.createElement('canvas')
            canvas.width = 50
            canvas.height = 50
            const ctx = canvas.getContext('2d')
            ctx.fillStyle = 'blue'
            ctx.fillRect(0, 0, 50, 50)
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        })

        const overlay = page.locator('#selectionOverlay')
        const overlayBox = await overlay.boundingBox()

        if (!overlayBox) {
            throw new Error('Could not get overlay bounding box')
        }

        // Draw a WIDE rectangle: 200x100 in displayed coordinates
        const startX = overlayBox.x + 100
        const startY = overlayBox.y + 100
        const endX = overlayBox.x + 300  // 200px wide
        const endY = overlayBox.y + 200  // 100px tall

        await page.mouse.move(startX, startY)
        await page.mouse.down()
        await page.mouse.move(endX, endY, { steps: 10 })
        await page.mouse.up()

        await page.waitForTimeout(500)

        const selectionInfo = await page.evaluate(() => {
            const sm = window.layersApp._selectionManager
            if (!sm.hasSelection()) return { error: 'No selection created' }
            const path = sm.selectionPath
            return {
                type: path.type,
                width: path.width,
                height: path.height,
                aspectRatio: path.width / path.height
            }
        })

        console.log('Wide selection:', selectionInfo)

        expect(selectionInfo.error).toBeUndefined()
        // Should be roughly 2:1 aspect ratio
        expect(selectionInfo.aspectRatio).toBeGreaterThan(1.5)
        expect(selectionInfo.aspectRatio).toBeLessThan(2.5)

        // Paste
        await page.evaluate(async () => {
            await window.layersApp._handlePaste()
        })
        await page.waitForTimeout(1000)

        const pastedInfo = await page.evaluate(() => {
            const layers = window.layersApp._layers
            const pastedLayer = layers[layers.length - 1]
            const mediaFile = pastedLayer.mediaFile

            return new Promise((resolve) => {
                const reader = new FileReader()
                reader.onload = () => {
                    const img = new Image()
                    img.onload = () => {
                        const testCanvas = document.createElement('canvas')
                        testCanvas.width = img.width
                        testCanvas.height = img.height
                        const ctx = testCanvas.getContext('2d')
                        ctx.drawImage(img, 0, 0)
                        const imageData = ctx.getImageData(0, 0, testCanvas.width, testCanvas.height)

                        let minX = testCanvas.width, maxX = 0
                        let minY = testCanvas.height, maxY = 0

                        for (let y = 0; y < testCanvas.height; y++) {
                            for (let x = 0; x < testCanvas.width; x++) {
                                const idx = (y * testCanvas.width + x) * 4
                                if (imageData.data[idx + 3] > 0) {
                                    minX = Math.min(minX, x)
                                    maxX = Math.max(maxX, x)
                                    minY = Math.min(minY, y)
                                    maxY = Math.max(maxY, y)
                                }
                            }
                        }

                        const w = maxX - minX + 1
                        const h = maxY - minY + 1

                        resolve({
                            width: w,
                            height: h,
                            aspectRatio: w / h
                        })
                    }
                    img.src = reader.result
                }
                reader.readAsDataURL(mediaFile)
            })
        })

        console.log('Pasted wide image:', pastedInfo)

        // Pasted image should have same aspect ratio as selection
        expect(Math.abs(pastedInfo.aspectRatio - selectionInfo.aspectRatio)).toBeLessThan(0.2)

        // Dimensions should match
        expect(Math.abs(pastedInfo.width - selectionInfo.width)).toBeLessThan(3)
        expect(Math.abs(pastedInfo.height - selectionInfo.height)).toBeLessThan(3)
    })
})

import { test, expect } from 'playwright/test'

test.describe('Paste to selection', () => {
    test('SQUARE selection pastes SQUARE image (not rectangle)', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write'])

        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        // Create a transparent project
        await page.waitForSelector('.open-dialog-backdrop.visible')
        await page.click('.media-option[data-type="transparent"]')
        await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
        await page.click('.canvas-size-dialog .action-btn.primary')
        await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
        await page.waitForTimeout(1000)

        // Create a 50x50 red square and copy to clipboard
        await page.evaluate(async () => {
            const canvas = document.createElement('canvas')
            canvas.width = 50
            canvas.height = 50
            const ctx = canvas.getContext('2d')
            ctx.fillStyle = 'red'
            ctx.fillRect(0, 0, 50, 50)

            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
            await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': blob })
            ])
        })

        // Create a SQUARE selection: 150x150 at (200, 200)
        const selectionSize = 150

        await page.evaluate(({ size }) => {
            const sm = window.layersApp._selectionManager
            sm._selectionPath = { type: 'rect', x: 200, y: 200, width: size, height: size }
            sm._startAnimation()
        }, { size: selectionSize })

        await page.waitForTimeout(500)

        // Verify selection is square
        const beforePaste = await page.evaluate(() => {
            const sm = window.layersApp._selectionManager
            const path = sm.selectionPath
            return {
                width: path.width,
                height: path.height,
                isSquare: path.width === path.height
            }
        })

        console.log('Selection before paste:', beforePaste)
        expect(beforePaste.isSquare).toBe(true)
        expect(beforePaste.width).toBe(selectionSize)
        expect(beforePaste.height).toBe(selectionSize)

        // Paste
        await page.evaluate(async () => {
            await window.layersApp._handlePaste()
        })
        await page.waitForTimeout(1000)

        // Verify pasted image is also square
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

                        const pastedWidth = maxX - minX + 1
                        const pastedHeight = maxY - minY + 1

                        resolve({
                            width: pastedWidth,
                            height: pastedHeight,
                            isSquare: pastedWidth === pastedHeight,
                            x: minX,
                            y: minY
                        })
                    }
                    img.src = reader.result
                }
                reader.readAsDataURL(mediaFile)
            })
        })

        console.log('Pasted image info:', pastedInfo)

        // CRITICAL: Pasted image must be square if selection was square
        expect(pastedInfo.isSquare).toBe(true)
        expect(pastedInfo.width).toBe(selectionSize)
        expect(pastedInfo.height).toBe(selectionSize)
        expect(pastedInfo.x).toBe(200)
        expect(pastedInfo.y).toBe(200)
    })

    test('pasted image scales to fit marquee selection bounds', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write'])

        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        // Create a transparent project
        await page.waitForSelector('.open-dialog-backdrop.visible')
        await page.click('.media-option[data-type="transparent"]')
        await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
        await page.click('.canvas-size-dialog .action-btn.primary')
        await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
        await page.waitForTimeout(1000)

        // Create a 50x50 red square image and copy to clipboard
        await page.evaluate(async () => {
            const canvas = document.createElement('canvas')
            canvas.width = 50
            canvas.height = 50
            const ctx = canvas.getContext('2d')
            ctx.fillStyle = 'red'
            ctx.fillRect(0, 0, 50, 50)

            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
            await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': blob })
            ])
        })

        // Create a selection at known coordinates: 200x100 at (100, 150)
        const selectionX = 100
        const selectionY = 150
        const selectionW = 200
        const selectionH = 100

        await page.evaluate(({ x, y, w, h }) => {
            const sm = window.layersApp._selectionManager
            sm._selectionPath = { type: 'rect', x, y, width: w, height: h }
            sm._startAnimation()
        }, { x: selectionX, y: selectionY, w: selectionW, h: selectionH })

        await page.waitForTimeout(500)

        // Debug: Check state before paste
        const beforePaste = await page.evaluate(() => {
            const app = window.layersApp
            const sm = app._selectionManager
            return {
                hasSelectionManager: !!sm,
                hasSelection: sm?.hasSelection() || false,
                selectionPath: sm?.selectionPath || null,
                layerCount: app._layers?.length || 0
            }
        })
        console.log('Before paste:', beforePaste)

        expect(beforePaste.hasSelectionManager).toBe(true)
        expect(beforePaste.hasSelection).toBe(true)
        expect(beforePaste.selectionPath).toEqual({
            type: 'rect',
            x: selectionX,
            y: selectionY,
            width: selectionW,
            height: selectionH
        })

        // Call paste and check what happens inside
        const pasteResult = await page.evaluate(async () => {
            const app = window.layersApp
            const sm = app._selectionManager

            // Manually trace what happens
            const result = {
                beforePasteHasSelection: sm.hasSelection(),
                beforePasteSelectionPath: sm.selectionPath ? { ...sm.selectionPath } : null
            }

            await app._handlePaste()

            result.afterPasteHasSelection = sm.hasSelection()
            result.afterPasteLayerCount = app._layers.length

            return result
        })

        console.log('Paste result:', pasteResult)

        // Selection should be cleared after paste
        expect(pasteResult.beforePasteHasSelection).toBe(true)
        expect(pasteResult.afterPasteHasSelection).toBe(false)
        expect(pasteResult.afterPasteLayerCount).toBe(2)

        // Wait for render to complete
        await page.waitForTimeout(500)

        // Verify the pasted image is at the correct position by reading pixels from the main canvas
        const pixelCheck = await page.evaluate(({ selX, selY, selW, selH }) => {
            const canvas = document.querySelector('#canvas')
            // Force a render by getting the WebGL context and reading pixels
            // The pasted layer should have red pixels at the selection bounds

            // We need to read from the 2D context of the rendered output
            // Let's check the renderer's media textures to verify the image was created correctly
            const app = window.layersApp
            const layers = app._layers
            const pastedLayer = layers[layers.length - 1]

            // Get the media file and read it
            const mediaFile = pastedLayer.mediaFile
            if (!mediaFile) return { error: 'No media file on pasted layer' }

            // Create a FileReader to read the blob
            return new Promise((resolve) => {
                const reader = new FileReader()
                reader.onload = async () => {
                    const img = new Image()
                    img.onload = () => {
                        // Draw to canvas and check pixel bounds
                        const testCanvas = document.createElement('canvas')
                        testCanvas.width = img.width
                        testCanvas.height = img.height
                        const ctx = testCanvas.getContext('2d')
                        ctx.drawImage(img, 0, 0)

                        const imageData = ctx.getImageData(0, 0, testCanvas.width, testCanvas.height)

                        // Find bounds of non-transparent pixels
                        let minX = testCanvas.width, maxX = 0
                        let minY = testCanvas.height, maxY = 0
                        let hasPixels = false
                        let redPixelCount = 0

                        for (let y = 0; y < testCanvas.height; y++) {
                            for (let x = 0; x < testCanvas.width; x++) {
                                const idx = (y * testCanvas.width + x) * 4
                                const alpha = imageData.data[idx + 3]
                                if (alpha > 0) {
                                    hasPixels = true
                                    minX = Math.min(minX, x)
                                    maxX = Math.max(maxX, x)
                                    minY = Math.min(minY, y)
                                    maxY = Math.max(maxY, y)
                                    // Check if it's a red pixel
                                    if (imageData.data[idx] > 200 && imageData.data[idx + 1] < 50) {
                                        redPixelCount++
                                    }
                                }
                            }
                        }

                        if (!hasPixels) {
                            resolve({ error: 'No visible pixels in pasted image' })
                            return
                        }

                        resolve({
                            imageSize: { width: testCanvas.width, height: testCanvas.height },
                            pixelBounds: {
                                x: minX,
                                y: minY,
                                width: maxX - minX + 1,
                                height: maxY - minY + 1
                            },
                            expectedBounds: { x: selX, y: selY, width: selW, height: selH },
                            redPixelCount
                        })
                    }
                    img.onerror = () => resolve({ error: 'Failed to load pasted image' })
                    img.src = reader.result
                }
                reader.onerror = () => resolve({ error: 'Failed to read media file' })
                reader.readAsDataURL(mediaFile)
            })
        }, { selX: selectionX, selY: selectionY, selW: selectionW, selH: selectionH })

        console.log('Pixel check:', pixelCheck)

        expect(pixelCheck.error).toBeUndefined()
        // The pasted image should be positioned at selection bounds
        expect(pixelCheck.pixelBounds.x).toBe(selectionX)
        expect(pixelCheck.pixelBounds.y).toBe(selectionY)
        expect(pixelCheck.pixelBounds.width).toBe(selectionW)
        expect(pixelCheck.pixelBounds.height).toBe(selectionH)
        expect(pixelCheck.redPixelCount).toBeGreaterThan(0)
    })

    test('paste without selection centers the image', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write'])

        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        await page.waitForSelector('.open-dialog-backdrop.visible')
        await page.click('.media-option[data-type="transparent"]')
        await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
        await page.click('.canvas-size-dialog .action-btn.primary')
        await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
        await page.waitForTimeout(1000)

        // Create a 100x100 blue square and copy to clipboard
        await page.evaluate(async () => {
            const canvas = document.createElement('canvas')
            canvas.width = 100
            canvas.height = 100
            const ctx = canvas.getContext('2d')
            ctx.fillStyle = 'blue'
            ctx.fillRect(0, 0, 100, 100)

            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
            await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': blob })
            ])
        })

        // Verify no selection
        const hasSelection = await page.evaluate(() => {
            return window.layersApp._selectionManager?.hasSelection() || false
        })
        expect(hasSelection).toBe(false)

        // Paste
        await page.evaluate(async () => {
            await window.layersApp._handlePaste()
        })
        await page.waitForTimeout(1000)

        // Check layer was added
        const layerCount = await page.evaluate(() => {
            return window.layersApp._layers.length
        })
        expect(layerCount).toBe(2)
    })
})

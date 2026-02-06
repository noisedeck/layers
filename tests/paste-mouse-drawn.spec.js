import { test, expect } from 'playwright/test'

async function createTransparentProject(page) {
    await page.waitForSelector('.open-dialog-backdrop.visible')
    await page.click('.media-option[data-type="transparent"]')
    await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
    await page.click('.canvas-size-dialog .action-btn.primary')
    await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
    await page.waitForTimeout(500)
}

async function copyColorSquareToClipboard(page, color) {
    await page.evaluate(async (fillColor) => {
        const canvas = document.createElement('canvas')
        canvas.width = 50
        canvas.height = 50
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = fillColor
        ctx.fillRect(0, 0, 50, 50)
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    }, color)
}

function getPastedPixelBounds() {
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
                    aspectRatio: w / h,
                    x: minX,
                    y: minY
                })
            }
            img.src = reader.result
        }
        reader.readAsDataURL(mediaFile)
    })
}

async function drawMouseSelection(page, overlayBox, startOffset, endOffset) {
    await page.mouse.move(overlayBox.x + startOffset.x, overlayBox.y + startOffset.y)
    await page.mouse.down()
    await page.mouse.move(overlayBox.x + endOffset.x, overlayBox.y + endOffset.y, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(500)
}

function getSelectionInfo() {
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
}

test.describe('Paste with real mouse-drawn selection', () => {
    test('mouse-drawn selection matches pasted image dimensions', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write'])

        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)
        await copyColorSquareToClipboard(page, 'red')

        const overlay = page.locator('#selectionOverlay')
        const overlayBox = await overlay.boundingBox()
        if (!overlayBox) throw new Error('Could not get overlay bounding box')

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

        await drawMouseSelection(page, overlayBox, { x: 100, y: 100 }, { x: 250, y: 250 })

        const selectionInfo = await page.evaluate(getSelectionInfo)
        console.log('Selection created:', selectionInfo)

        expect(selectionInfo.error).toBeUndefined()
        expect(selectionInfo.type).toBe('rect')
        expect(selectionInfo.aspectRatio).toBeGreaterThan(0.9)
        expect(selectionInfo.aspectRatio).toBeLessThan(1.1)

        await page.evaluate(async () => { await window.layersApp._handlePaste() })
        await page.waitForTimeout(1000)

        const pastedInfo = await page.evaluate(getPastedPixelBounds)
        console.log('Pasted image:', pastedInfo)

        expect(Math.abs(pastedInfo.width - selectionInfo.width)).toBeLessThan(3)
        expect(Math.abs(pastedInfo.height - selectionInfo.height)).toBeLessThan(3)
        expect(Math.abs(pastedInfo.aspectRatio - selectionInfo.aspectRatio)).toBeLessThan(0.1)
    })

    test('non-square mouse selection pastes correct aspect ratio', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write'])

        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })
        await createTransparentProject(page)
        await copyColorSquareToClipboard(page, 'blue')

        const overlay = page.locator('#selectionOverlay')
        const overlayBox = await overlay.boundingBox()
        if (!overlayBox) throw new Error('Could not get overlay bounding box')

        // Draw a WIDE rectangle: 200x100 in displayed coordinates
        await drawMouseSelection(page, overlayBox, { x: 100, y: 100 }, { x: 300, y: 200 })

        const selectionInfo = await page.evaluate(getSelectionInfo)
        console.log('Wide selection:', selectionInfo)

        expect(selectionInfo.error).toBeUndefined()
        expect(selectionInfo.aspectRatio).toBeGreaterThan(1.5)
        expect(selectionInfo.aspectRatio).toBeLessThan(2.5)

        await page.evaluate(async () => { await window.layersApp._handlePaste() })
        await page.waitForTimeout(1000)

        const pastedInfo = await page.evaluate(getPastedPixelBounds)
        console.log('Pasted wide image:', pastedInfo)

        expect(Math.abs(pastedInfo.aspectRatio - selectionInfo.aspectRatio)).toBeLessThan(0.2)
        expect(Math.abs(pastedInfo.width - selectionInfo.width)).toBeLessThan(3)
        expect(Math.abs(pastedInfo.height - selectionInfo.height)).toBeLessThan(3)
    })
})

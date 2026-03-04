/**
 * Auto-adjustment utilities
 * Analyzes canvas pixels to compute correction parameters
 */

/**
 * Read current canvas pixels via WebGL
 * @param {HTMLCanvasElement} canvas
 * @returns {Uint8ClampedArray} RGBA pixel data (top-down)
 */
function readCanvasPixels(canvas) {
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
    if (!gl) return null

    const width = canvas.width
    const height = canvas.height
    const pixels = new Uint8Array(width * height * 4)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)

    // WebGL readPixels is bottom-up, flip vertically
    const flipped = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++) {
        const srcRow = (height - 1 - y) * width * 4
        const dstRow = y * width * 4
        flipped.set(pixels.subarray(srcRow, srcRow + width * 4), dstRow)
    }
    return flipped
}

/**
 * Compute histogram from pixel data
 * @param {Uint8ClampedArray} pixels - RGBA pixel data
 * @returns {{ r, g, b, lum, percentile, mean, totalPixels }}
 */
function computeHistogram(pixels) {
    const r = new Uint32Array(256)
    const g = new Uint32Array(256)
    const b = new Uint32Array(256)
    const lum = new Uint32Array(256)
    let totalPixels = 0

    for (let i = 0; i < pixels.length; i += 4) {
        const ri = pixels[i], gi = pixels[i + 1], bi = pixels[i + 2]
        r[ri]++
        g[gi]++
        b[bi]++
        // Luminance: 0.299R + 0.587G + 0.114B
        lum[Math.round(0.299 * ri + 0.587 * gi + 0.114 * bi)]++
        totalPixels++
    }

    function percentile(channel, pct) {
        const target = Math.floor(totalPixels * pct)
        let count = 0
        for (let i = 0; i < 256; i++) {
            count += channel[i]
            if (count >= target) return i
        }
        return 255
    }

    function mean(channel) {
        let sum = 0
        for (let i = 0; i < 256; i++) sum += i * channel[i]
        return sum / totalPixels
    }

    return { r, g, b, lum, percentile, mean, totalPixels }
}

/**
 * Auto Levels - stretch per-channel histogram to full range
 * @returns {{ effectId: string, effectParams: object, name: string } | null}
 */
export function autoLevels(canvas) {
    const pixels = readCanvasPixels(canvas)
    if (!pixels) return null

    const hist = computeHistogram(pixels)

    // Find 1st and 99th percentile across all channels
    const rLow = hist.percentile(hist.r, 0.01), rHigh = hist.percentile(hist.r, 0.99)
    const gLow = hist.percentile(hist.g, 0.01), gHigh = hist.percentile(hist.g, 0.99)
    const bLow = hist.percentile(hist.b, 0.01), bHigh = hist.percentile(hist.b, 0.99)

    // Use the most extreme values across channels
    const low = Math.min(rLow, gLow, bLow) / 255
    const high = Math.max(rHigh, gHigh, bHigh) / 255

    // Map to brightness/contrast params
    const range = high - low
    if (range < 0.01) return null // already full range or flat

    const brightness = -(low + high - 1) / 2
    const contrast = 1 / range

    return {
        effectId: 'filter/bc',
        effectParams: {
            brightness: Math.max(-1, Math.min(1, brightness)),
            contrast: Math.max(0.1, Math.min(5, contrast))
        },
        name: 'Auto Levels'
    }
}

/**
 * Auto Contrast - stretch luminance histogram
 * @returns {{ effectId: string, effectParams: object, name: string } | null}
 */
export function autoContrast(canvas) {
    const pixels = readCanvasPixels(canvas)
    if (!pixels) return null

    const hist = computeHistogram(pixels)

    const low = hist.percentile(hist.lum, 0.01) / 255
    const high = hist.percentile(hist.lum, 0.99) / 255

    const range = high - low
    if (range < 0.01) return null

    const brightness = -(low + high - 1) / 2
    const contrast = 1 / range

    return {
        effectId: 'filter/bc',
        effectParams: {
            brightness: Math.max(-1, Math.min(1, brightness)),
            contrast: Math.max(0.1, Math.min(5, contrast))
        },
        name: 'Auto Contrast'
    }
}

/**
 * Auto White Balance - neutralize color cast via hue/saturation
 * @returns {{ effectId: string, effectParams: object, name: string } | null}
 */
export function autoWhiteBalance(canvas) {
    const pixels = readCanvasPixels(canvas)
    if (!pixels) return null

    const hist = computeHistogram(pixels)

    const rMean = hist.mean(hist.r)
    const gMean = hist.mean(hist.g)
    const bMean = hist.mean(hist.b)

    // Gray world assumption: ideal is equal R, G, B means
    const overall = (rMean + gMean + bMean) / 3

    // Detect dominant color cast
    const rDev = rMean - overall
    const gDev = gMean - overall
    const bDev = bMean - overall
    const maxDev = Math.max(Math.abs(rDev), Math.abs(gDev), Math.abs(bDev))

    if (maxDev < 3) return null // negligible cast

    // Map color cast to hue shift (approximate)
    let hue = 0
    let saturation = 1

    if (rDev > gDev && rDev > bDev) {
        // Red/warm cast
        hue = -maxDev / 255 * 0.3
        saturation = 1 - maxDev / 255 * 0.2
    } else if (bDev > rDev && bDev > gDev) {
        // Blue/cool cast
        hue = maxDev / 255 * 0.3
        saturation = 1 - maxDev / 255 * 0.2
    } else {
        // Green cast
        saturation = 1 - maxDev / 255 * 0.3
    }

    return {
        effectId: 'filter/hs',
        effectParams: {
            hue: Math.max(-1, Math.min(1, hue)),
            saturation: Math.max(0, Math.min(4, saturation)),
            lightness: 0
        },
        name: 'Auto White Balance'
    }
}

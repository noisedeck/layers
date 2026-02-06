/**
 * Flood Fill Algorithm
 * Queue-based flood fill for magic wand selection
 *
 * @module selection/flood-fill
 */

/**
 * Perform flood fill from a starting point
 * @param {ImageData} imageData - Source image data
 * @param {number} startX - Starting X coordinate
 * @param {number} startY - Starting Y coordinate
 * @param {number} tolerance - Color tolerance (0-255)
 * @returns {ImageData} - Mask where 255 = selected, 0 = not selected
 */
function floodFill(imageData, startX, startY, tolerance) {
    const { width, height, data } = imageData
    const mask = new Uint8ClampedArray(width * height)

    const startIdx = (startY * width + startX) * 4
    const targetR = data[startIdx]
    const targetG = data[startIdx + 1]
    const targetB = data[startIdx + 2]
    const targetA = data[startIdx + 3]

    const threshold = tolerance * 4

    /**
     * Check if pixel matches target color within tolerance
     * @param {number} idx - Pixel index in data array
     * @returns {boolean}
     */
    function matches(idx) {
        const diff = Math.abs(data[idx] - targetR) +
                     Math.abs(data[idx + 1] - targetG) +
                     Math.abs(data[idx + 2] - targetB) +
                     Math.abs(data[idx + 3] - targetA)
        return diff <= threshold
    }

    const queue = [[startX, startY]]
    const visited = new Set()
    visited.add(startY * width + startX)

    while (queue.length > 0) {
        const [x, y] = queue.shift()
        const pixelIdx = y * width + x
        const dataIdx = pixelIdx * 4

        if (!matches(dataIdx)) continue

        mask[pixelIdx] = 255

        const neighbors = [
            [x - 1, y],
            [x + 1, y],
            [x, y - 1],
            [x, y + 1]
        ]

        for (const [nx, ny] of neighbors) {
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
            const nIdx = ny * width + nx
            if (visited.has(nIdx)) continue
            visited.add(nIdx)
            queue.push([nx, ny])
        }
    }

    const maskData = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < mask.length; i++) {
        const idx = i * 4
        const val = mask[i]
        maskData[idx] = val
        maskData[idx + 1] = val
        maskData[idx + 2] = val
        maskData[idx + 3] = val
    }

    return new ImageData(maskData, width, height)
}

export { floodFill }

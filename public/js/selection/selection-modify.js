/**
 * Selection Mask Modification Operations
 * Pure functions for expanding, contracting, feathering, and other mask operations.
 * All functions take ImageData masks and return new ImageData masks.
 * Alpha channel determines selection (>127 = selected).
 *
 * @module selection/selection-modify
 */

/**
 * Large constant representing infinity for distance transform
 * @type {number}
 */
const INF = 1e9

/**
 * Invert a selection mask (flip alpha channel)
 * @param {ImageData} mask - Input mask
 * @returns {ImageData} - New mask with inverted selection
 */
function invertMask(mask) {
    const { width, height, data } = mask
    const result = new Uint8ClampedArray(data.length)

    for (let i = 0; i < data.length; i += 4) {
        const val = data[i + 3] > 127 ? 0 : 255
        result[i] = val
        result[i + 1] = val
        result[i + 2] = val
        result[i + 3] = val
    }

    return new ImageData(result, width, height)
}

/**
 * Compute 1D distance transform using Meijster's parabola envelope method.
 * Given an array f of squared distances from Phase 1, computes the exact
 * Euclidean distance transform along one row.
 *
 * @param {Float32Array} f - Input array of squared distances (one row/col)
 * @param {number} n - Length of the array
 * @param {Float32Array} d - Output array (will be filled with results)
 * @param {Int32Array} v - Scratch array for parabola locations (length n)
 * @param {Float32Array} z - Scratch array for parabola boundaries (length n+1)
 * @private
 */
function edt1d(f, n, d, v, z) {
    // v[k] = location of k-th parabola
    // z[k] = boundary between parabola k-1 and k
    let k = 0
    v[0] = 0
    z[0] = -INF
    z[1] = INF

    for (let q = 1; q < n; q++) {
        // Intersection of parabola at q with parabola at v[k]
        let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
        while (s <= z[k]) {
            k--
            s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
        }
        k++
        v[k] = q
        z[k] = s
        z[k + 1] = INF
    }

    k = 0
    for (let q = 0; q < n; q++) {
        while (z[k + 1] < q) k++
        const dx = q - v[k]
        d[q] = dx * dx + f[v[k]]
    }
}

/**
 * Compute distance transform using Meijster's two-pass algorithm.
 * Returns Float32Array of Euclidean distances from each pixel to the nearest
 * "background" pixel (as defined by the predicate).
 *
 * Phase 1: Column scan - compute distance to nearest background pixel in same column
 * Phase 2: Row scan - use parabola envelope to find true 2D nearest distance
 *
 * @param {Uint8ClampedArray} data - RGBA pixel data
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @param {function(number): boolean} predicate - Returns true if pixel at given
 *   flat index (i*4 offset into data) is "background" (distance = 0)
 * @returns {Float32Array} - Euclidean distance for each pixel
 * @private
 */
function computeDistanceTransform(data, width, height, predicate) {
    const size = width * height

    // Phase 1: column scan
    // For each pixel, compute squared distance to nearest background pixel in the same column
    const g = new Float32Array(size)

    for (let x = 0; x < width; x++) {
        // Top-down pass
        if (predicate((0 * width + x) * 4)) {
            g[0 * width + x] = 0
        } else {
            g[0 * width + x] = INF
        }

        for (let y = 1; y < height; y++) {
            const idx = y * width + x
            if (predicate(idx * 4)) {
                g[idx] = 0
            } else {
                g[idx] = g[(y - 1) * width + x] + 1
            }
        }

        // Bottom-up pass
        for (let y = height - 2; y >= 0; y--) {
            const idx = y * width + x
            const below = g[(y + 1) * width + x] + 1
            if (below < g[idx]) {
                g[idx] = below
            }
        }
    }

    // Square the column distances for Phase 2
    for (let i = 0; i < size; i++) {
        g[i] = g[i] * g[i]
    }

    // Phase 2: row scan with parabola envelope
    const dist = new Float32Array(size)
    const f = new Float32Array(Math.max(width, height))
    const d = new Float32Array(Math.max(width, height))
    const v = new Int32Array(Math.max(width, height))
    const z = new Float32Array(Math.max(width, height) + 1)

    for (let y = 0; y < height; y++) {
        const rowOffset = y * width
        // Extract row from g into f
        for (let x = 0; x < width; x++) {
            f[x] = g[rowOffset + x]
        }

        // Compute 1D distance transform along this row
        edt1d(f, width, d, v, z)

        // Store results (take square root for Euclidean distance)
        for (let x = 0; x < width; x++) {
            dist[rowOffset + x] = Math.sqrt(d[x])
        }
    }

    return dist
}

/**
 * Compute both inside and outside distance fields for a mask.
 *
 * - outside: distance from each pixel to nearest selected pixel.
 *   Background = selected pixels (alpha > 127). Distances measure how far
 *   unselected pixels are from the selection boundary.
 *
 * - inside: distance from each pixel to nearest unselected pixel.
 *   Background = unselected pixels (alpha <= 127). Distances measure how far
 *   selected pixels are from the selection boundary.
 *
 * @param {ImageData} mask - Input selection mask
 * @returns {{ inside: Float32Array, outside: Float32Array }}
 */
function computeDistanceFields(mask) {
    const { width, height, data } = mask

    // Outside field: distance to nearest selected pixel
    // "background" (distance=0) = selected pixels
    const outside = computeDistanceTransform(data, width, height, (idx) => {
        return data[idx + 3] > 127
    })

    // Inside field: distance to nearest unselected pixel
    // "background" (distance=0) = unselected pixels
    const inside = computeDistanceTransform(data, width, height, (idx) => {
        return data[idx + 3] <= 127
    })

    return { inside, outside }
}

/**
 * Expand (grow) selection by radius r pixels.
 * A pixel is selected if it is within distance r of any currently selected pixel.
 *
 * @param {ImageData} mask - Input selection mask
 * @param {number} r - Expansion radius in pixels
 * @returns {ImageData} - New expanded mask
 */
function expandMask(mask, r) {
    const { width, height, data } = mask

    // Outside distance: distance from each pixel to nearest selected pixel
    const outside = computeDistanceTransform(data, width, height, (idx) => {
        return data[idx + 3] > 127
    })

    const result = new Uint8ClampedArray(data.length)
    const size = width * height

    for (let i = 0; i < size; i++) {
        const val = outside[i] <= r ? 255 : 0
        const idx = i * 4
        result[idx] = val
        result[idx + 1] = val
        result[idx + 2] = val
        result[idx + 3] = val
    }

    return new ImageData(result, width, height)
}

/**
 * Contract (shrink) selection by radius r pixels.
 * A pixel is deselected if it is within distance r of the selection boundary (from inside).
 *
 * @param {ImageData} mask - Input selection mask
 * @param {number} r - Contraction radius in pixels
 * @returns {ImageData} - New contracted mask
 */
function contractMask(mask, r) {
    const { width, height, data } = mask

    // Inside distance: distance from each selected pixel to nearest unselected pixel
    const inside = computeDistanceTransform(data, width, height, (idx) => {
        return data[idx + 3] <= 127
    })

    const result = new Uint8ClampedArray(data.length)
    const size = width * height

    for (let i = 0; i < size; i++) {
        // Keep selected only if the pixel was already selected AND
        // its inside distance is greater than r (far enough from boundary)
        const wasSelected = data[i * 4 + 3] > 127
        const val = (wasSelected && inside[i] > r) ? 255 : 0
        const idx = i * 4
        result[idx] = val
        result[idx + 1] = val
        result[idx + 2] = val
        result[idx + 3] = val
    }

    return new ImageData(result, width, height)
}

/**
 * Create border selection - select pixels within r of the selection edge (inside the selection).
 *
 * @param {ImageData} mask - Input selection mask
 * @param {number} r - Border width in pixels
 * @returns {ImageData} - New mask with only border pixels selected
 */
function borderMask(mask, r) {
    const { width, height, data } = mask

    // Inside distance: distance from each selected pixel to nearest unselected pixel
    const inside = computeDistanceTransform(data, width, height, (idx) => {
        return data[idx + 3] <= 127
    })

    const result = new Uint8ClampedArray(data.length)
    const size = width * height

    for (let i = 0; i < size; i++) {
        // Select if pixel is currently selected AND within r of the boundary
        const wasSelected = data[i * 4 + 3] > 127
        const val = (wasSelected && inside[i] <= r) ? 255 : 0
        const idx = i * 4
        result[idx] = val
        result[idx + 1] = val
        result[idx + 2] = val
        result[idx + 3] = val
    }

    return new ImageData(result, width, height)
}

/**
 * Feather selection with linear alpha gradient using distance fields.
 * Produces smooth edges by ramping alpha from 255 (fully inside) to 0 (fully outside)
 * over the feather radius.
 *
 * @param {ImageData} mask - Input selection mask
 * @param {number} r - Feather radius in pixels
 * @returns {ImageData} - New mask with feathered edges
 */
function featherMask(mask, r) {
    const { width, height, data } = mask

    const { inside, outside } = computeDistanceFields(mask)

    const result = new Uint8ClampedArray(data.length)
    const size = width * height

    for (let i = 0; i < size; i++) {
        const wasSelected = data[i * 4 + 3] > 127
        let alpha

        if (wasSelected) {
            // Inside the selection: full alpha unless near edge
            if (inside[i] >= r) {
                alpha = 255
            } else {
                // Linear ramp from edge (0) to r (255)
                alpha = Math.round((inside[i] / r) * 255)
            }
        } else {
            // Outside the selection: fade out
            if (outside[i] >= r) {
                alpha = 0
            } else {
                // Linear ramp from edge (255) to r (0)
                alpha = Math.round((1 - outside[i] / r) * 255)
            }
        }

        const idx = i * 4
        result[idx] = alpha
        result[idx + 1] = alpha
        result[idx + 2] = alpha
        result[idx + 3] = alpha
    }

    return new ImageData(result, width, height)
}

/**
 * Smooth selection edges using 3-pass box blur followed by re-threshold.
 *
 * @param {ImageData} mask - Input selection mask
 * @param {number} r - Blur radius in pixels
 * @returns {ImageData} - New mask with smoothed edges
 */
function smoothMask(mask, r) {
    const { width, height, data } = mask
    const size = width * height

    // Extract alpha channel as float buffer
    let buf = new Float32Array(size)
    for (let i = 0; i < size; i++) {
        buf[i] = data[i * 4 + 3]
    }

    // 3-pass box blur
    for (let pass = 0; pass < 3; pass++) {
        buf = boxBlur(buf, width, height, r)
    }

    // Re-threshold at 128
    const result = new Uint8ClampedArray(size * 4)
    for (let i = 0; i < size; i++) {
        const val = buf[i] > 128 ? 255 : 0
        const idx = i * 4
        result[idx] = val
        result[idx + 1] = val
        result[idx + 2] = val
        result[idx + 3] = val
    }

    return new ImageData(result, width, height)
}

/**
 * Single-pass box blur (horizontal then vertical)
 * @param {Float32Array} input - Input buffer
 * @param {number} width
 * @param {number} height
 * @param {number} r - Blur radius
 * @returns {Float32Array} - Blurred buffer
 * @private
 */
function boxBlur(input, width, height, r) {
    const temp = new Float32Array(width * height)
    const output = new Float32Array(width * height)
    const kernelSize = 2 * r + 1

    // Horizontal pass
    for (let y = 0; y < height; y++) {
        const rowOffset = y * width
        let sum = 0

        // Initialize sum for first pixel
        for (let dx = -r; dx <= r; dx++) {
            const x = Math.min(Math.max(dx, 0), width - 1)
            sum += input[rowOffset + x]
        }
        temp[rowOffset] = sum / kernelSize

        // Slide the window
        for (let x = 1; x < width; x++) {
            const addX = Math.min(x + r, width - 1)
            const removeX = Math.max(x - r - 1, 0)
            sum += input[rowOffset + addX] - input[rowOffset + removeX]
            temp[rowOffset + x] = sum / kernelSize
        }
    }

    // Vertical pass
    for (let x = 0; x < width; x++) {
        let sum = 0

        // Initialize sum for first pixel
        for (let dy = -r; dy <= r; dy++) {
            const y = Math.min(Math.max(dy, 0), height - 1)
            sum += temp[y * width + x]
        }
        output[x] = sum / kernelSize

        // Slide the window
        for (let y = 1; y < height; y++) {
            const addY = Math.min(y + r, height - 1)
            const removeY = Math.max(y - r - 1, 0)
            sum += temp[addY * width + x] - temp[removeY * width + x]
            output[y * width + x] = sum / kernelSize
        }
    }

    return output
}

/**
 * Select pixels by color range (non-contiguous).
 * Uses the same SAD (Sum of Absolute Differences) formula as flood-fill.
 *
 * @param {ImageData} imageData - Source image data
 * @param {number} x - Sample X coordinate
 * @param {number} y - Sample Y coordinate
 * @param {number} tolerance - Color tolerance (0-255)
 * @returns {ImageData} - Mask where matching pixels are selected
 */
function colorRange(imageData, x, y, tolerance) {
    const { width, height, data } = imageData

    const startIdx = (y * width + x) * 4
    const targetR = data[startIdx]
    const targetG = data[startIdx + 1]
    const targetB = data[startIdx + 2]
    const targetA = data[startIdx + 3]

    const threshold = tolerance * 4
    const size = width * height
    const result = new Uint8ClampedArray(size * 4)

    for (let i = 0; i < size; i++) {
        const idx = i * 4
        const diff = Math.abs(data[idx] - targetR) +
                     Math.abs(data[idx + 1] - targetG) +
                     Math.abs(data[idx + 2] - targetB) +
                     Math.abs(data[idx + 3] - targetA)

        const val = diff <= threshold ? 255 : 0
        result[idx] = val
        result[idx + 1] = val
        result[idx + 2] = val
        result[idx + 3] = val
    }

    return new ImageData(result, width, height)
}

export {
    invertMask,
    computeDistanceFields,
    expandMask,
    contractMask,
    borderMask,
    featherMask,
    smoothMask,
    colorRange
}

/**
 * Clipboard Operations
 * Handles copy/paste with selections
 *
 * @module selection/clipboard-ops
 */

/**
 * Copy selected region from layers to clipboard
 * @param {object} options
 * @param {object} selectionPath - Selection path (rect or oval)
 * @param {object[]} layers - Array of layer objects (visible, selected)
 * @param {HTMLCanvasElement} sourceCanvas - Main render canvas
 * @returns {Promise<{x: number, y: number} | null>} Copy origin for paste-in-place, or null if failed
 */
async function copySelection({ selectionPath, layers, sourceCanvas }) {
    if (!selectionPath || layers.length === 0) return null

    // Get bounds
    const bounds = getSelectionBounds(selectionPath)
    if (bounds.width <= 0 || bounds.height <= 0) return null

    // Create offscreen canvas for the copied region
    const offscreen = new OffscreenCanvas(bounds.width, bounds.height)
    const ctx = offscreen.getContext('2d')

    // Draw from source canvas (already composited)
    ctx.drawImage(
        sourceCanvas,
        bounds.x, bounds.y, bounds.width, bounds.height,
        0, 0, bounds.width, bounds.height
    )

    // Apply selection mask for non-rectangular selections
    if (selectionPath.type === 'oval') {
        applyOvalMask(ctx, selectionPath, bounds)
    }

    // Convert to blob and write to clipboard
    try {
        const blob = await offscreen.convertToBlob({ type: 'image/png' })
        await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob })
        ])

        return { x: bounds.x, y: bounds.y }
    } catch (err) {
        console.error('[Clipboard] Failed to copy:', err)
        return null
    }
}

/**
 * Paste from clipboard
 * @returns {Promise<{blob: Blob, origin: {x: number, y: number} | null} | null>}
 */
async function pasteFromClipboard() {
    try {
        const items = await navigator.clipboard.read()

        for (const item of items) {
            if (item.types.includes('image/png')) {
                const blob = await item.getType('image/png')
                return { blob, origin: null }
            }
            if (item.types.includes('image/jpeg')) {
                const blob = await item.getType('image/jpeg')
                return { blob, origin: null }
            }
        }

        return null
    } catch (err) {
        console.error('[Clipboard] Failed to paste:', err)
        return null
    }
}

/**
 * Get bounding box of selection
 * @param {object} selectionPath
 * @returns {{x: number, y: number, width: number, height: number}}
 */
function getSelectionBounds(selectionPath) {
    if (selectionPath.type === 'rect') {
        return {
            x: Math.round(selectionPath.x),
            y: Math.round(selectionPath.y),
            width: Math.round(selectionPath.width),
            height: Math.round(selectionPath.height)
        }
    } else {
        // Oval bounding box
        return {
            x: Math.round(selectionPath.cx - selectionPath.rx),
            y: Math.round(selectionPath.cy - selectionPath.ry),
            width: Math.round(selectionPath.rx * 2),
            height: Math.round(selectionPath.ry * 2)
        }
    }
}

/**
 * Apply oval mask to canvas context
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} selectionPath
 * @param {{x: number, y: number, width: number, height: number}} bounds
 */
function applyOvalMask(ctx, selectionPath, bounds) {
    // Use destination-in composite to mask
    ctx.globalCompositeOperation = 'destination-in'
    ctx.beginPath()
    ctx.ellipse(
        selectionPath.cx - bounds.x,
        selectionPath.cy - bounds.y,
        selectionPath.rx,
        selectionPath.ry,
        0, 0, Math.PI * 2
    )
    ctx.fill()
    ctx.globalCompositeOperation = 'source-over'
}

export { copySelection, pasteFromClipboard, getSelectionBounds }

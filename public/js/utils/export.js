/**
 * Export Utilities
 * PNG/JPG export functions
 *
 * @module utils/export
 */

function triggerDownload(href, filename) {
    const link = document.createElement('a')
    link.href = href
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
}

/**
 * Export canvas as PNG
 * @param {HTMLCanvasElement} canvas - Canvas to export
 * @param {string} [filename='layers-export'] - Filename without extension
 */
export function exportPng(canvas, filename = 'layers-export') {
    downloadDataUrl(canvas.toDataURL('image/png'), `${filename}.png`)
}

/**
 * Export canvas as JPG
 * @param {HTMLCanvasElement} canvas - Canvas to export
 * @param {string} [filename='layers-export'] - Filename without extension
 * @param {number} [quality=0.92] - JPEG quality (0-1)
 */
export function exportJpg(canvas, filename = 'layers-export', quality = 0.92) {
    downloadDataUrl(canvas.toDataURL('image/jpeg', quality), `${filename}.jpg`)
}

/**
 * Download a data URL as a file
 * @param {string} dataUrl - Data URL to download
 * @param {string} filename - Filename
 */
export function downloadDataUrl(dataUrl, filename) {
    triggerDownload(dataUrl, filename)
}

/**
 * Download a blob as a file
 * @param {Blob} blob - Blob to download
 * @param {string} filename - Filename
 */
export function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob)
    triggerDownload(url, filename)
    URL.revokeObjectURL(url)
}

/**
 * Get a timestamped filename
 * @param {string} [prefix='layers'] - Filename prefix
 * @returns {string} Timestamped filename
 */
export function getTimestampedFilename(prefix = 'layers') {
    return `${prefix}-${new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}`
}

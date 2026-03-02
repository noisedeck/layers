/**
 * Eyedropper Tool - Sample a pixel color from the WebGL canvas
 *
 * Reads a pixel at the click position, sets the foreground color,
 * and auto-returns to the previous tool.
 *
 * @module tools/eyedropper-tool
 */

export class EyedropperTool {
    constructor(options) {
        this._overlay = options.overlay
        this._canvas = options.canvas
        this._setForegroundColor = options.setForegroundColor
        this._restorePreviousTool = options.restorePreviousTool

        this._active = false
        this._onClick = this._onClick.bind(this)
    }

    activate() {
        if (this._active) return
        this._active = true
        this._overlay.addEventListener('click', this._onClick)
    }

    deactivate() {
        if (!this._active) return
        this._active = false
        this._overlay.removeEventListener('click', this._onClick)
    }

    _getCanvasCoords(e) {
        const rect = this._overlay.getBoundingClientRect()
        return {
            x: Math.floor((e.clientX - rect.left) * (this._overlay.width / rect.width)),
            y: Math.floor((e.clientY - rect.top) * (this._overlay.height / rect.height))
        }
    }

    _onClick(e) {
        const pt = this._getCanvasCoords(e)
        const gl = this._canvas.getContext('webgl') || this._canvas.getContext('webgl2')
        if (!gl) return

        const pixels = new Uint8Array(4)
        gl.readPixels(pt.x, this._canvas.height - pt.y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels)

        const hex = '#' + [pixels[0], pixels[1], pixels[2]]
            .map(v => v.toString(16).padStart(2, '0')).join('')

        this._setForegroundColor(hex)
        this._restorePreviousTool()
    }
}

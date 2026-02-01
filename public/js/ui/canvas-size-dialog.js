/**
 * Canvas Size Dialog
 * Prompts user for canvas dimensions when creating non-media base layers
 *
 * @module ui/canvas-size-dialog
 */

const MIN_SIZE = 64
const MAX_SIZE = 2048
const DEFAULT_SIZE = 1024

const PRESETS = [
    { label: '512', width: 512, height: 512 },
    { label: '1024', width: 1024, height: 1024 },
    { label: '2048', width: 2048, height: 2048 },
    { label: '1920 x 1080', width: 1920, height: 1080 },
    { label: '1080 x 1920', width: 1080, height: 1920 },
]

// Base size for aspect ratio visualization (the max dimension)
const ASPECT_PREVIEW_SIZE = 40

/**
 * CanvasSizeDialog - Modal for choosing canvas dimensions
 */
class CanvasSizeDialog {
    constructor() {
        this._dialog = null
        this._onConfirm = null
        this._onCancel = null
        this._isRequired = false
    }

    /**
     * Show the canvas size dialog
     * @param {object} options - Options
     * @param {function} options.onConfirm - Callback with dimensions: (width, height) => void
     * @param {function} options.onCancel - Callback when cancelled: () => void
     * @param {boolean} options.isRequired - If true, shows Back instead of Cancel and hides close button
     * @returns {Promise<void>}
     */
    show(options = {}) {
        this._onConfirm = options.onConfirm
        this._onCancel = options.onCancel
        this._isRequired = options.isRequired || false

        if (!this._dialog) {
            this._createDialog()
        }

        // Update UI for required mode
        this._updateRequiredMode()

        // Reset to defaults
        this._setInputValue('canvas-width', DEFAULT_SIZE)
        this._setInputValue('canvas-height', DEFAULT_SIZE)
        this._clearErrors()

        this._dialog.showModal()
    }

    /**
     * Update UI elements for required mode
     * @private
     */
    _updateRequiredMode() {
        const closeBtn = this._dialog.querySelector('.dialog-close')
        const cancelBtn = this._dialog.querySelector('#canvas-size-cancel')

        if (closeBtn) {
            closeBtn.style.display = this._isRequired ? 'none' : ''
        }
        if (cancelBtn) {
            cancelBtn.textContent = this._isRequired ? 'Back' : 'Cancel'
        }
    }

    /**
     * Hide the dialog
     */
    hide() {
        if (this._dialog) {
            this._dialog.close()
        }
    }

    /**
     * Calculate preview dimensions for aspect ratio visualization
     * @param {number} width - Original width
     * @param {number} height - Original height
     * @returns {{w: number, h: number}} - Preview dimensions
     * @private
     */
    _getPreviewDimensions(width, height) {
        const maxDim = Math.max(width, height)
        const scale = ASPECT_PREVIEW_SIZE / maxDim
        return {
            w: Math.round(width * scale),
            h: Math.round(height * scale)
        }
    }

    /**
     * Create the dialog element
     * @private
     */
    _createDialog() {
        this._dialog = document.createElement('dialog')
        this._dialog.className = 'canvas-size-dialog'
        this._dialog.innerHTML = `
            <div class="dialog-header">
                <h2>Canvas Size</h2>
                <button class="dialog-close" aria-label="Close">
                    <span class="icon-material">close</span>
                </button>
            </div>
            <div class="dialog-body">
                <div class="size-presets">
                    ${PRESETS.map(p => {
                        const preview = this._getPreviewDimensions(p.width, p.height)
                        return `
                        <button class="size-preset" data-width="${p.width}" data-height="${p.height}">
                            <div class="preset-preview-container">
                                <div class="preset-preview" style="width: ${preview.w}px; height: ${preview.h}px;"></div>
                            </div>
                            <span class="preset-label">${p.label}</span>
                        </button>
                    `}).join('')}
                </div>

                <div class="size-inputs">
                    <div class="form-field">
                        <label for="canvas-width">Width</label>
                        <div class="input-with-unit">
                            <input type="number" id="canvas-width"
                                min="${MIN_SIZE}" max="${MAX_SIZE}"
                                value="${DEFAULT_SIZE}" step="1">
                            <span class="input-unit">px</span>
                        </div>
                        <div class="form-error" id="width-error"></div>
                    </div>

                    <span class="size-separator">x</span>

                    <div class="form-field">
                        <label for="canvas-height">Height</label>
                        <div class="input-with-unit">
                            <input type="number" id="canvas-height"
                                min="${MIN_SIZE}" max="${MAX_SIZE}"
                                value="${DEFAULT_SIZE}" step="1">
                            <span class="input-unit">px</span>
                        </div>
                        <div class="form-error" id="height-error"></div>
                    </div>
                </div>

                <div class="size-limits">
                    Min: ${MIN_SIZE}px | Max: ${MAX_SIZE}px
                </div>
            </div>
            <div class="dialog-actions">
                <button class="action-btn" id="canvas-size-cancel">Cancel</button>
                <button class="action-btn primary" id="canvas-size-create">Create</button>
            </div>
        `

        document.body.appendChild(this._dialog)
        this._setupEventListeners()
    }

    /**
     * Set up event listeners
     * @private
     */
    _setupEventListeners() {
        const closeBtn = this._dialog.querySelector('.dialog-close')
        closeBtn.addEventListener('click', () => this._handleCancel())

        const cancelBtn = this._dialog.querySelector('#canvas-size-cancel')
        cancelBtn.addEventListener('click', () => this._handleCancel())

        const createBtn = this._dialog.querySelector('#canvas-size-create')
        createBtn.addEventListener('click', () => this._handleConfirm())

        // Preset buttons
        const presetBtns = this._dialog.querySelectorAll('.size-preset')
        presetBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const width = parseInt(btn.dataset.width, 10)
                const height = parseInt(btn.dataset.height, 10)
                this._setInputValue('canvas-width', width)
                this._setInputValue('canvas-height', height)
                this._clearErrors()
            })

            btn.addEventListener('dblclick', () => {
                const width = parseInt(btn.dataset.width, 10)
                const height = parseInt(btn.dataset.height, 10)
                this._setInputValue('canvas-width', width)
                this._setInputValue('canvas-height', height)
                this._handleConfirm()
            })
        })

        // Input validation on change
        const widthInput = this._dialog.querySelector('#canvas-width')
        const heightInput = this._dialog.querySelector('#canvas-height')

        widthInput.addEventListener('input', () => this._validateInput('width'))
        heightInput.addEventListener('input', () => this._validateInput('height'))

        // Enter key to confirm
        this._dialog.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                this._handleConfirm()
            }
        })
    }

    /**
     * Handle confirm action
     * @private
     */
    _handleConfirm() {
        const width = this._getInputValue('canvas-width')
        const height = this._getInputValue('canvas-height')

        // Validate
        const widthValid = this._validateInput('width')
        const heightValid = this._validateInput('height')

        if (!widthValid || !heightValid) {
            return
        }

        if (this._onConfirm) {
            this._onConfirm(width, height)
        }
        this.hide()
    }

    /**
     * Handle cancel action
     * @private
     */
    _handleCancel() {
        if (this._onCancel) {
            this._onCancel()
        }
        this.hide()
    }

    /**
     * Validate an input field
     * @param {string} field - 'width' or 'height'
     * @returns {boolean} - Whether valid
     * @private
     */
    _validateInput(field) {
        const inputId = field === 'width' ? 'canvas-width' : 'canvas-height'
        const errorId = `${field}-error`
        const value = this._getInputValue(inputId)
        const errorEl = this._dialog.querySelector(`#${errorId}`)

        if (isNaN(value) || value < MIN_SIZE) {
            errorEl.textContent = `Minimum ${MIN_SIZE}px`
            return false
        }
        if (value > MAX_SIZE) {
            errorEl.textContent = `Maximum ${MAX_SIZE}px`
            return false
        }

        errorEl.textContent = ''
        return true
    }

    /**
     * Clear all error messages
     * @private
     */
    _clearErrors() {
        this._dialog.querySelector('#width-error').textContent = ''
        this._dialog.querySelector('#height-error').textContent = ''
    }

    /**
     * Get input value as integer
     * @param {string} id - Input ID
     * @returns {number}
     * @private
     */
    _getInputValue(id) {
        const input = this._dialog.querySelector(`#${id}`)
        return parseInt(input.value, 10)
    }

    /**
     * Set input value
     * @param {string} id - Input ID
     * @param {number} value - Value to set
     * @private
     */
    _setInputValue(id, value) {
        const input = this._dialog.querySelector(`#${id}`)
        if (input) {
            input.value = value
        }
    }
}

// Export singleton
export const canvasSizeDialog = new CanvasSizeDialog()

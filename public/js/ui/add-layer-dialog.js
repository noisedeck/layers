/**
 * Add Layer Dialog
 * Dialog for adding media or effect layers
 *
 * @module ui/add-layer-dialog
 */

import { effectPicker } from './effect-picker.js'

/**
 * AddLayerDialog - Modal for adding new layers
 */
class AddLayerDialog {
    constructor() {
        this._dialog = null
        this._onAddMedia = null
        this._onAddEffect = null
        this._mode = 'choose' // 'choose' | 'media' | 'effect'
    }

    /**
     * Show the add layer dialog
     * @param {object} options - Options
     * @param {function} options.onAddMedia - Callback: (file, mediaType) => void
     * @param {function} options.onAddEffect - Callback: (effectId) => void
     * @param {Array} options.effects - Available effects
     * @returns {Promise<void>}
     */
    show(options = {}) {
        this._onAddMedia = options.onAddMedia
        this._onAddEffect = options.onAddEffect
        this._effects = options.effects || []

        if (!this._dialog) {
            this._createDialog()
        }

        this._setMode('choose')
        this._dialog.showModal()
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
     * Create the dialog element
     * @private
     */
    _createDialog() {
        this._dialog = document.createElement('dialog')
        this._dialog.className = 'add-layer-dialog'
        this._dialog.innerHTML = `
            <div class="dialog-header">
                <h2>Add Layer</h2>
                <button class="dialog-close" aria-label="Close">
                    <span class="icon-material">close</span>
                </button>
            </div>
            <div class="dialog-body">
                <!-- Choose mode -->
                <div class="add-mode-choose">
                    <div class="media-options">
                        <div class="media-option" data-mode="media">
                            <span class="icon-material">image</span>
                            <span>Add Media</span>
                        </div>
                        <div class="media-option" data-mode="effect">
                            <span class="icon-material">auto_awesome</span>
                            <span>Add Effect</span>
                        </div>
                    </div>
                </div>

                <!-- Media mode -->
                <div class="add-mode-media hidden">
                    <button class="action-btn" id="add-back-btn">
                        <span class="icon-material">arrow_back</span>
                        Back
                    </button>
                    <div class="form-field" style="margin-top: 16px;">
                        <label for="add-media-input">Choose an image or video</label>
                        <input type="file" id="add-media-input" accept="image/*,video/*">
                    </div>
                </div>

                <!-- Effect mode -->
                <div class="add-mode-effect hidden">
                    <button class="action-btn" id="add-effect-back-btn">
                        <span class="icon-material">arrow_back</span>
                        Back
                    </button>
                    <div id="effect-picker-container" style="margin-top: 16px;"></div>
                </div>
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
        closeBtn.addEventListener('click', () => this.hide())

        // Mode selection
        const mediaOptions = this._dialog.querySelectorAll('.media-option')
        mediaOptions.forEach(opt => {
            opt.addEventListener('click', () => {
                const mode = opt.dataset.mode
                this._setMode(mode)
            })
        })

        // Back buttons
        const backBtn = this._dialog.querySelector('#add-back-btn')
        backBtn.addEventListener('click', () => this._setMode('choose'))

        const effectBackBtn = this._dialog.querySelector('#add-effect-back-btn')
        effectBackBtn.addEventListener('click', () => this._setMode('choose'))

        // Media file input
        const mediaInput = this._dialog.querySelector('#add-media-input')
        mediaInput.addEventListener('change', () => {
            if (mediaInput.files.length > 0) {
                this._handleMediaSelect(mediaInput.files[0])
            }
        })

        // Close on backdrop click
    }

    /**
     * Set the dialog mode
     * @param {string} mode - 'choose' | 'media' | 'effect'
     * @private
     */
    _setMode(mode) {
        this._mode = mode

        const chooseSection = this._dialog.querySelector('.add-mode-choose')
        const mediaSection = this._dialog.querySelector('.add-mode-media')
        const effectSection = this._dialog.querySelector('.add-mode-effect')

        chooseSection.classList.toggle('hidden', mode !== 'choose')
        mediaSection.classList.toggle('hidden', mode !== 'media')
        effectSection.classList.toggle('hidden', mode !== 'effect')

        const titles = {
            choose: 'Add Layer',
            media: 'Add Media Layer',
            effect: 'Add Effect Layer'
        }

        const title = this._dialog.querySelector('.dialog-header h2')
        title.textContent = titles[mode] || 'Add Layer'

        if (mode === 'effect') {
            this._showEffectPicker()
        }
    }

    /**
     * Show the effect picker
     * @private
     */
    _showEffectPicker() {
        const container = this._dialog.querySelector('#effect-picker-container')

        effectPicker.show({
            container,
            effects: this._effects,
            onSelect: (effectId) => {
                if (this._onAddEffect) {
                    this._onAddEffect(effectId)
                }
                this.hide()
            }
        })
    }

    /**
     * Handle media file selection
     * @param {File} file - Selected file
     * @private
     */
    _handleMediaSelect(file) {
        const mediaType = this._detectMediaType(file)

        if (mediaType && this._onAddMedia) {
            this._onAddMedia(file, mediaType)
        }

        this.hide()
    }

    /**
     * Detect media type from file
     * @param {File} file - File to check
     * @returns {string|null} 'image' or 'video' or null
     * @private
     */
    _detectMediaType(file) {
        if (file.type.startsWith('image/')) {
            return 'image'
        } else if (file.type.startsWith('video/')) {
            return 'video'
        }
        return null
    }
}

// Export singleton
export const addLayerDialog = new AddLayerDialog()

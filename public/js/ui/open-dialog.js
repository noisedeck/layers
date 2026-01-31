/**
 * Open Dialog
 * Initial base layer chooser - media, solid, gradient, or transparent
 *
 * @module ui/open-dialog
 */

/**
 * OpenDialog - Modal for choosing base layer type
 */
class OpenDialog {
    constructor() {
        this._dialog = null
        this._onOpen = null
        this._onSolid = null
        this._onGradient = null
        this._onTransparent = null
        this._mode = 'choose' // 'choose' | 'media'
        this._isBaseLayer = false
    }

    /**
     * Show the open dialog
     * @param {object} options - Options
     * @param {function} options.onOpen - Callback when media file is opened: (file, mediaType) => void
     * @param {function} options.onSolid - Callback for solid color: () => void
     * @param {function} options.onGradient - Callback for gradient: () => void
     * @param {function} options.onTransparent - Callback for transparent: () => void
     * @param {boolean} options.isBaseLayer - If true, dialog cannot be closed without selection
     * @returns {Promise<void>}
     */
    show(options = {}) {
        this._onOpen = options.onOpen
        this._onSolid = options.onSolid
        this._onGradient = options.onGradient
        this._onTransparent = options.onTransparent
        this._isBaseLayer = options.isBaseLayer || false

        // Create dialog if needed
        if (!this._dialog) {
            this._createDialog()
        }

        // Reset state
        this._setMode('choose')
        const fileInput = this._dialog.querySelector('#open-file-input')
        if (fileInput) fileInput.value = ''

        // Configure closability
        const closeBtn = this._dialog.querySelector('.dialog-close')
        if (closeBtn) {
            closeBtn.style.display = this._isBaseLayer ? 'none' : ''
        }

        // Update title for base layer
        const title = this._dialog.querySelector('.dialog-header h2')
        if (title) {
            title.textContent = this._isBaseLayer ? 'New Project' : 'Open Media'
        }

        // Show dialog
        this._dialog.showModal()
    }

    /**
     * Hide the dialog
     */
    hide() {
        if (this._dialog && !this._isBaseLayer) {
            this._dialog.close()
        }
    }

    /**
     * Force hide (used after selection)
     */
    _forceHide() {
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
        this._dialog.className = 'open-dialog'
        this._dialog.innerHTML = `
            <div class="dialog-header">
                <h2>New Project</h2>
                <button class="dialog-close" aria-label="Close">
                    <span class="icon-material">close</span>
                </button>
            </div>
            <div class="dialog-body">
                <!-- Choose mode -->
                <div class="open-mode-choose">
                    <div class="media-options media-options-grid">
                        <div class="media-option" data-type="media">
                            <span class="icon-material">image</span>
                            <span>Media</span>
                        </div>
                        <div class="media-option" data-type="solid">
                            <span class="icon-material">square</span>
                            <span>Solid</span>
                        </div>
                        <div class="media-option" data-type="gradient">
                            <span class="icon-material">gradient</span>
                            <span>Gradient</span>
                        </div>
                        <div class="media-option" data-type="transparent">
                            <span class="icon-material">grid_on</span>
                            <span>Transparent</span>
                        </div>
                    </div>
                    <div class="privacy-notice">
                        <span class="icon-material">lock</span>
                        <span>All files stay on your machine. Nothing is uploaded or transmitted.</span>
                    </div>
                </div>

                <!-- Media mode -->
                <div class="open-mode-media hidden">
                    <button class="action-btn" id="open-back-btn">
                        <span class="icon-material">arrow_back</span>
                        Back
                    </button>
                    <div class="form-field" style="margin-top: 16px;">
                        <label for="open-file-input">Choose an image or video</label>
                        <input type="file" id="open-file-input" accept="image/*,video/*">
                    </div>
                </div>
            </div>
        `

        document.body.appendChild(this._dialog)
        this._setupEventListeners()
    }

    /**
     * Set the dialog mode
     * @param {string} mode - 'choose' | 'media'
     * @private
     */
    _setMode(mode) {
        this._mode = mode

        const chooseSection = this._dialog.querySelector('.open-mode-choose')
        const mediaSection = this._dialog.querySelector('.open-mode-media')

        chooseSection.classList.toggle('hidden', mode !== 'choose')
        mediaSection.classList.toggle('hidden', mode !== 'media')

        // Update title
        const title = this._dialog.querySelector('.dialog-header h2')
        if (mode === 'choose') {
            title.textContent = this._isBaseLayer ? 'New Project' : 'Open Media'
        } else if (mode === 'media') {
            title.textContent = 'Choose Media'
        }
    }

    /**
     * Set up event listeners
     * @private
     */
    _setupEventListeners() {
        const closeBtn = this._dialog.querySelector('.dialog-close')
        closeBtn.addEventListener('click', () => this.hide())

        // Type selection
        const mediaOptions = this._dialog.querySelectorAll('.media-option')
        mediaOptions.forEach(opt => {
            opt.addEventListener('click', () => {
                const type = opt.dataset.type
                this._handleTypeSelect(type)
            })
        })

        // Back button
        const backBtn = this._dialog.querySelector('#open-back-btn')
        backBtn.addEventListener('click', () => this._setMode('choose'))

        // Media file input
        const fileInput = this._dialog.querySelector('#open-file-input')
        fileInput.addEventListener('change', () => {
            if (fileInput.files.length > 0) {
                this._handleMediaSelect(fileInput.files[0])
            }
        })

        // Close on backdrop click (only if not base layer)
        this._dialog.addEventListener('click', (e) => {
            if (e.target === this._dialog) {
                this.hide()
            }
        })

        // Close on Escape (only if not base layer)
        this._dialog.addEventListener('cancel', (e) => {
            if (this._isBaseLayer) {
                e.preventDefault()
            }
        })
    }

    /**
     * Handle type selection
     * @param {string} type - 'media' | 'solid' | 'gradient' | 'transparent'
     * @private
     */
    _handleTypeSelect(type) {
        switch (type) {
            case 'media':
                this._setMode('media')
                break
            case 'solid':
                if (this._onSolid) {
                    this._onSolid()
                }
                this._forceHide()
                break
            case 'gradient':
                if (this._onGradient) {
                    this._onGradient()
                }
                this._forceHide()
                break
            case 'transparent':
                if (this._onTransparent) {
                    this._onTransparent()
                }
                this._forceHide()
                break
        }
    }

    /**
     * Handle media file selection
     * @param {File} file - Selected file
     * @private
     */
    _handleMediaSelect(file) {
        const mediaType = this._detectMediaType(file)
        console.log('[OpenDialog] File:', file.name, 'Type:', file.type, 'MediaType:', mediaType)

        if (mediaType && this._onOpen) {
            console.log('[OpenDialog] Calling onOpen callback')
            this._onOpen(file, mediaType)
        } else {
            console.error('[OpenDialog] No mediaType or no callback!', { mediaType, hasCallback: !!this._onOpen })
        }

        this._forceHide()
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
export const openDialog = new OpenDialog()

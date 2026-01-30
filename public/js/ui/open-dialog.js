/**
 * Open Dialog
 * Initial file chooser for opening media (image/video)
 *
 * @module ui/open-dialog
 */

/**
 * OpenDialog - Modal for opening media files
 */
class OpenDialog {
    constructor() {
        this._dialog = null
        this._onOpen = null
    }

    /**
     * Show the open dialog
     * @param {object} options - Options
     * @param {function} options.onOpen - Callback when file is opened: (file, mediaType) => void
     * @returns {Promise<void>}
     */
    show(options = {}) {
        this._onOpen = options.onOpen

        // Create dialog if needed
        if (!this._dialog) {
            this._createDialog()
        }

        // Reset state
        const fileInput = this._dialog.querySelector('#open-file-input')
        if (fileInput) fileInput.value = ''

        const urlInput = this._dialog.querySelector('#open-url-input')
        if (urlInput) urlInput.value = ''

        // Show dialog
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
        this._dialog.className = 'open-dialog'
        this._dialog.innerHTML = `
            <div class="dialog-header">
                <h2>Open Media</h2>
                <button class="dialog-close" aria-label="Close">
                    <span class="icon-material">close</span>
                </button>
            </div>
            <div class="dialog-body">
                <div class="form-field">
                    <label for="open-file-input">Choose a file</label>
                    <input type="file" id="open-file-input" accept="image/*,video/*">
                </div>

                <div class="url-input-section disabled">
                    <div class="form-field">
                        <label>
                            Load from URL
                            <span class="coming-soon-badge">Coming Soon</span>
                        </label>
                        <input type="url" id="open-url-input" placeholder="https://..." disabled>
                    </div>
                </div>
            </div>
            <div class="dialog-actions">
                <button class="action-btn" id="open-cancel-btn">Cancel</button>
                <button class="action-btn primary" id="open-confirm-btn">Open</button>
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
        const cancelBtn = this._dialog.querySelector('#open-cancel-btn')
        const confirmBtn = this._dialog.querySelector('#open-confirm-btn')
        const fileInput = this._dialog.querySelector('#open-file-input')

        closeBtn.addEventListener('click', () => this.hide())
        cancelBtn.addEventListener('click', () => this.hide())

        confirmBtn.addEventListener('click', () => this._handleConfirm())

        // Handle file selection directly
        fileInput.addEventListener('change', () => {
            if (fileInput.files.length > 0) {
                this._handleConfirm()
            }
        })

        // Close on backdrop click
        this._dialog.addEventListener('click', (e) => {
            if (e.target === this._dialog) {
                this.hide()
            }
        })

        // Close on Escape
        this._dialog.addEventListener('cancel', (e) => {
            e.preventDefault()
            this.hide()
        })
    }

    /**
     * Handle confirm button click
     * @private
     */
    _handleConfirm() {
        const fileInput = this._dialog.querySelector('#open-file-input')
        console.log('[OpenDialog] _handleConfirm, files:', fileInput?.files?.length)

        if (fileInput.files.length > 0) {
            const file = fileInput.files[0]
            const mediaType = this._detectMediaType(file)
            console.log('[OpenDialog] File:', file.name, 'Type:', file.type, 'MediaType:', mediaType)

            if (mediaType && this._onOpen) {
                console.log('[OpenDialog] Calling onOpen callback')
                this._onOpen(file, mediaType)
            } else {
                console.error('[OpenDialog] No mediaType or no callback!', { mediaType, hasCallback: !!this._onOpen })
            }

            this.hide()
        }
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

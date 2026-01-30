/**
 * Share Modal
 * Posts to sharing.noisedeck.app API
 *
 * Adapted from polymorphic/public/js/shareModal.js
 *
 * @module ui/share-modal
 */

/**
 * ShareModal - Modal for sharing programs publicly
 */
class ShareModal {
    constructor() {
        this._dialog = null
        this._dsl = ''
        this._canvas = null
        this._screenshot = null
        this._sharedUrl = null
        this._isSharing = false
    }

    /**
     * Show the share modal
     * @param {object} options - Options
     * @param {string} options.dsl - DSL program to share
     * @param {HTMLCanvasElement} options.canvas - Canvas for screenshot
     */
    show(options = {}) {
        this._dsl = options.dsl || ''
        this._canvas = options.canvas || null
        this._sharedUrl = null
        this._isSharing = false

        if (!this._dialog) {
            this._createDialog()
        }

        // Reset state
        this._showForm()

        // Capture screenshot
        if (this._canvas) {
            this._captureScreenshot()
        }

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
        this._dialog.className = 'share-modal'
        this._dialog.innerHTML = `
            <div class="dialog-header">
                <h2>Share Publicly</h2>
                <button class="dialog-close" aria-label="Close">
                    <span class="icon-material">close</span>
                </button>
            </div>
            <div class="dialog-body">
                <!-- Form section -->
                <div id="share-form">
                    <div class="share-preview">
                        <canvas id="share-preview-canvas"></canvas>
                    </div>

                    <div class="form-field">
                        <label for="share-title">Title</label>
                        <input type="text" id="share-title" placeholder="Untitled">
                    </div>

                    <div class="form-field">
                        <label for="share-description">Description (optional)</label>
                        <textarea id="share-description" rows="2" placeholder="Describe your creation..."></textarea>
                    </div>

                    <div class="share-info">
                        <span class="icon-material">info</span>
                        <span>Your creation will be shared publicly. Links expire after 30 days.</span>
                    </div>
                </div>

                <!-- Result section -->
                <div id="share-result" style="display: none;">
                    <div class="share-success">
                        <span class="icon-material">check_circle</span>
                        <span>Shared successfully!</span>
                    </div>

                    <div class="share-url-field">
                        <input type="text" id="share-url" readonly>
                        <button class="action-btn" id="share-copy-btn">
                            <span class="icon-material">content_copy</span>
                        </button>
                    </div>

                    <div class="share-expires" id="share-expires"></div>
                </div>
            </div>
            <div class="dialog-actions" id="share-form-actions">
                <button class="action-btn" id="share-cancel-btn">Cancel</button>
                <button class="action-btn primary" id="share-submit-btn">Share</button>
            </div>
            <div class="dialog-actions" id="share-result-actions" style="display: none;">
                <button class="action-btn primary" id="share-done-btn">Done</button>
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
        const cancelBtn = this._dialog.querySelector('#share-cancel-btn')
        const submitBtn = this._dialog.querySelector('#share-submit-btn')
        const copyBtn = this._dialog.querySelector('#share-copy-btn')
        const doneBtn = this._dialog.querySelector('#share-done-btn')

        closeBtn.addEventListener('click', () => this.hide())
        cancelBtn.addEventListener('click', () => this.hide())
        doneBtn.addEventListener('click', () => this.hide())

        submitBtn.addEventListener('click', () => this._handleShare())
        copyBtn.addEventListener('click', () => this._copyUrl())

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
     * Show the form section
     * @private
     */
    _showForm() {
        const formSection = this._dialog.querySelector('#share-form')
        const resultSection = this._dialog.querySelector('#share-result')
        const formActions = this._dialog.querySelector('#share-form-actions')
        const resultActions = this._dialog.querySelector('#share-result-actions')

        formSection.style.display = 'block'
        resultSection.style.display = 'none'
        formActions.style.display = 'flex'
        resultActions.style.display = 'none'

        // Reset form
        this._dialog.querySelector('#share-title').value = ''
        this._dialog.querySelector('#share-description').value = ''
    }

    /**
     * Show the result section
     * @param {string} url - Shared URL
     * @param {string} expiresAt - Expiration date
     * @private
     */
    _showResult(url, expiresAt) {
        const formSection = this._dialog.querySelector('#share-form')
        const resultSection = this._dialog.querySelector('#share-result')
        const formActions = this._dialog.querySelector('#share-form-actions')
        const resultActions = this._dialog.querySelector('#share-result-actions')
        const urlInput = this._dialog.querySelector('#share-url')
        const expiresSpan = this._dialog.querySelector('#share-expires')

        formSection.style.display = 'none'
        resultSection.style.display = 'block'
        formActions.style.display = 'none'
        resultActions.style.display = 'flex'

        urlInput.value = url
        this._sharedUrl = url

        if (expiresAt) {
            const date = new Date(expiresAt)
            const dateStr = date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            })
            expiresSpan.textContent = `Expires: ${dateStr}`
        }
    }

    /**
     * Capture a screenshot from the canvas
     * @private
     */
    _captureScreenshot() {
        const previewCanvas = this._dialog.querySelector('#share-preview-canvas')
        if (!previewCanvas || !this._canvas) return

        // Calculate 16:9 crop from center
        const targetAspect = 16 / 9
        const sourceAspect = this._canvas.width / this._canvas.height

        let sx, sy, sw, sh

        if (sourceAspect > targetAspect) {
            sh = this._canvas.height
            sw = sh * targetAspect
            sx = (this._canvas.width - sw) / 2
            sy = 0
        } else {
            sw = this._canvas.width
            sh = sw / targetAspect
            sx = 0
            sy = (this._canvas.height - sh) / 2
        }

        // Set preview canvas size
        const previewWidth = 392 // Fit in modal
        const previewHeight = Math.round(previewWidth / targetAspect)

        previewCanvas.width = previewWidth
        previewCanvas.height = previewHeight

        const ctx = previewCanvas.getContext('2d')
        ctx.drawImage(this._canvas, sx, sy, sw, sh, 0, 0, previewWidth, previewHeight)

        // Store as base64 JPEG
        this._screenshot = previewCanvas.toDataURL('image/jpeg', 0.85)
    }

    /**
     * Handle share button click
     * @private
     */
    async _handleShare() {
        if (this._isSharing) return

        const titleInput = this._dialog.querySelector('#share-title')
        const descriptionInput = this._dialog.querySelector('#share-description')
        const submitBtn = this._dialog.querySelector('#share-submit-btn')

        const title = titleInput.value.trim() || 'Untitled'
        const description = descriptionInput.value.trim() || ''

        if (!this._dsl) {
            alert('No program to share')
            return
        }

        this._isSharing = true
        submitBtn.disabled = true
        submitBtn.textContent = 'Sharing...'

        try {
            const payload = {
                dsl: this._dsl,
                title,
                description,
                screenshot: this._screenshot || '',
                effects: []
            }

            const response = await fetch('https://sharing.noisedeck.app/api/embed/shorten', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            })

            if (!response.ok) {
                throw new Error(`Share failed: ${response.status}`)
            }

            const result = await response.json()

            if (!result.shortUrl) {
                throw new Error('No URL returned from share API')
            }

            this._showResult(result.shortUrl, result.expiresAt)
        } catch (error) {
            console.error('Share error:', error)
            alert('Failed to share. Please try again.')

            submitBtn.disabled = false
            submitBtn.textContent = 'Share'
        }

        this._isSharing = false
    }

    /**
     * Copy the shared URL to clipboard
     * @private
     */
    async _copyUrl() {
        if (!this._sharedUrl) return

        try {
            await navigator.clipboard.writeText(this._sharedUrl)

            const copyBtn = this._dialog.querySelector('#share-copy-btn')
            const originalHtml = copyBtn.innerHTML
            copyBtn.innerHTML = '<span class="icon-material" style="color: var(--color-success);">check</span>'

            setTimeout(() => {
                copyBtn.innerHTML = originalHtml
            }, 2000)
        } catch (err) {
            console.error('Copy failed:', err)
            alert('Failed to copy URL')
        }
    }
}

// Export singleton
export const shareModal = new ShareModal()

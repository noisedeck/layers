/**
 * About Dialog
 * About Layers modal
 *
 * @module ui/about-dialog
 */

/**
 * AboutDialog - About modal
 */
class AboutDialog {
    constructor() {
        this._dialog = null
    }

    /**
     * Show the about dialog
     */
    show() {
        if (!this._dialog) {
            this._createDialog()
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
        this._dialog.className = 'about-modal'
        this._dialog.innerHTML = `
            <div class="about-modal-content">
                <div class="about-modal-graphic">
                    <svg class="about-modal-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="currentColor">
                        <rect x="10" y="60" width="80" height="10" rx="2" opacity="0.4"/>
                        <rect x="10" y="45" width="80" height="10" rx="2" opacity="0.6"/>
                        <rect x="10" y="30" width="80" height="10" rx="2" opacity="0.8"/>
                        <rect x="10" y="15" width="80" height="10" rx="2"/>
                    </svg>
                </div>
                <div class="about-modal-details" tabindex="-1">
                    <h1 class="about-modal-title">Layers</h1>
                    <p class="about-modal-tagline">Layer-based media editor</p>
                    <p class="about-modal-copyright">
                        Powered by the
                        <a href="https://github.com/noisedeck/noisemaker" target="_blank" rel="noopener" class="about-modal-link">Noisemaker</a>
                        shader pipeline
                    </p>
                    <p class="about-modal-copyright">
                        Part of the <a href="https://noisedeck.app" target="_blank" rel="noopener" class="about-modal-link">Noisedeck</a> family
                    </p>
                </div>
            </div>
        `

        document.body.appendChild(this._dialog)

        // Close on click outside content
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

        // Close on any key press
        this._dialog.addEventListener('keydown', () => {
            this.hide()
        })
    }
}

// Export singleton
export const aboutDialog = new AboutDialog()

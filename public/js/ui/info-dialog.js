/**
 * Info Dialog
 * Modal for displaying informational messages (like Photoshop's "No pixels selected")
 *
 * @module ui/info-dialog
 */

/**
 * InfoDialog - Modal for showing informational messages
 */
class InfoDialog {
    constructor() {
        this._backdrop = null
        this._modal = null
        this._resolvePromise = null
    }

    /**
     * Show an info dialog
     * @param {object} options - Options
     * @param {string} options.message - The message to display
     * @param {string} options.okText - Text for OK button (default: 'OK')
     * @returns {Promise<void>} Resolves when dismissed
     */
    show(options = {}) {
        const {
            message = '',
            okText = 'OK'
        } = options

        if (!this._backdrop) {
            this._createModal()
        }

        this._modal.querySelector('.info-message').textContent = message
        this._modal.querySelector('#info-ok').textContent = okText

        this._backdrop.classList.add('visible')

        return new Promise(resolve => {
            this._resolvePromise = resolve
        })
    }

    /**
     * Hide the dialog
     * @private
     */
    _hide() {
        if (this._backdrop) {
            this._backdrop.classList.remove('visible')
        }
    }

    /**
     * Create the modal element
     * @private
     */
    _createModal() {
        this._backdrop = document.createElement('div')
        this._backdrop.className = 'info-dialog-backdrop'

        this._modal = document.createElement('div')
        this._modal.className = 'info-dialog'
        this._modal.setAttribute('role', 'alertdialog')
        this._modal.setAttribute('aria-modal', 'true')
        this._modal.innerHTML = `
            <div class="dialog-body">
                <p class="info-message"></p>
            </div>
            <div class="dialog-actions">
                <button class="action-btn primary" id="info-ok">OK</button>
            </div>
        `

        this._backdrop.appendChild(this._modal)
        document.body.appendChild(this._backdrop)
        this._setupEventListeners()
    }

    /**
     * Resolve and hide
     * @private
     */
    _resolve() {
        this._hide()
        if (this._resolvePromise) {
            this._resolvePromise()
            this._resolvePromise = null
        }
    }

    /**
     * Set up event listeners
     * @private
     */
    _setupEventListeners() {
        this._modal.querySelector('#info-ok').addEventListener('click', () => this._resolve())

        // Also close on backdrop click
        this._backdrop.addEventListener('click', (e) => {
            if (e.target === this._backdrop) {
                this._resolve()
            }
        })
    }
}

export const infoDialog = new InfoDialog()

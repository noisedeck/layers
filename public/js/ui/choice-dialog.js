/**
 * Choice Dialog
 * Modal for yes/no choices with abort capability
 *
 * @module ui/choice-dialog
 */

/**
 * ChoiceDialog - Modal for yes/no choices
 * Returns 'yes', 'no', or null (if aborted via backdrop/ESC)
 */
class ChoiceDialog {
    constructor() {
        this._backdrop = null
        this._modal = null
        this._resolvePromise = null
        this._onKeyDown = this._onKeyDown.bind(this)
    }

    /**
     * Show a choice dialog
     * @param {object} options - Options
     * @param {string} options.message - The message to display
     * @param {string} options.yesText - Text for yes button (default: 'Yes')
     * @param {string} options.noText - Text for no button (default: 'No')
     * @returns {Promise<'yes'|'no'|null>} Resolves to 'yes', 'no', or null if aborted
     */
    show(options = {}) {
        const {
            message = '',
            yesText = 'Yes',
            noText = 'No'
        } = options

        if (!this._backdrop) {
            this._createModal()
        }

        this._modal.querySelector('.choice-message').textContent = message
        this._modal.querySelector('#choice-yes').textContent = yesText
        this._modal.querySelector('#choice-no').textContent = noText

        this._backdrop.classList.add('visible')
        document.addEventListener('keydown', this._onKeyDown)

        return new Promise(resolve => {
            this._resolvePromise = resolve
        })
    }

    /**
     * Handle keydown for ESC
     * @private
     */
    _onKeyDown(e) {
        if (e.key === 'Escape') {
            e.preventDefault()
            this._resolve(null)
        }
    }

    /**
     * Hide the dialog
     * @private
     */
    _hide() {
        if (this._backdrop) {
            this._backdrop.classList.remove('visible')
        }
        document.removeEventListener('keydown', this._onKeyDown)
    }

    /**
     * Create the modal element
     * @private
     */
    _createModal() {
        this._backdrop = document.createElement('div')
        this._backdrop.className = 'choice-dialog-backdrop'

        this._modal = document.createElement('div')
        this._modal.className = 'choice-dialog'
        this._modal.setAttribute('role', 'alertdialog')
        this._modal.setAttribute('aria-modal', 'true')
        this._modal.innerHTML = `
            <div class="dialog-body">
                <p class="choice-message"></p>
            </div>
            <div class="dialog-actions">
                <button class="action-btn" id="choice-no">No</button>
                <button class="action-btn primary" id="choice-yes">Yes</button>
            </div>
        `

        this._backdrop.appendChild(this._modal)
        document.body.appendChild(this._backdrop)
        this._setupEventListeners()
    }

    /**
     * Resolve the dialog promise and hide
     * @param {'yes'|'no'|null} result - The result to resolve with
     * @private
     */
    _resolve(result) {
        this._hide()
        if (this._resolvePromise) {
            this._resolvePromise(result)
            this._resolvePromise = null
        }
    }

    /**
     * Set up event listeners
     * @private
     */
    _setupEventListeners() {
        this._modal.querySelector('#choice-no').addEventListener('click', () => this._resolve('no'))
        this._modal.querySelector('#choice-yes').addEventListener('click', () => this._resolve('yes'))

        // Backdrop click aborts
        this._backdrop.addEventListener('click', (e) => {
            if (e.target === this._backdrop) {
                this._resolve(null)
            }
        })
    }
}

export const choiceDialog = new ChoiceDialog()

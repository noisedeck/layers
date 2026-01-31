/**
 * Save Project Dialog
 * Web component for saving projects
 *
 * @module ui/save-project-dialog
 */

import { saveProject, checkProjectName } from '../utils/project-storage.js'

/**
 * SaveProjectDialog - Modal for saving projects
 */
class SaveProjectDialog {
    constructor() {
        this._dialog = null
        this._currentProjectId = null
        this._currentProjectName = null
        this._onSave = null
    }

    /**
     * Show the save dialog
     * @param {object} options - Options
     * @param {string} [options.projectId] - Current project ID (if updating)
     * @param {string} [options.projectName] - Current project name
     * @param {function} options.onSave - Callback: (projectId, projectName) => Promise<void>
     */
    show(options = {}) {
        this._currentProjectId = options.projectId || null
        this._currentProjectName = options.projectName || ''
        this._onSave = options.onSave

        if (!this._dialog) {
            this._createDialog()
        }

        // Reset form
        const nameInput = this._dialog.querySelector('#save-project-name')
        nameInput.value = this._currentProjectName
        this._clearError()
        this._setMode('form')

        // Update title
        const title = this._dialog.querySelector('.dialog-header h2')
        title.textContent = this._currentProjectId ? 'Save Project' : 'Save Project As'

        this._dialog.showModal()
        nameInput.focus()
        nameInput.select()
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
        this._dialog.className = 'save-project-dialog'
        this._dialog.innerHTML = `
            <div class="dialog-header">
                <h2>Save Project</h2>
                <button class="dialog-close" aria-label="Close">
                    <span class="icon-material">close</span>
                </button>
            </div>
            <div class="dialog-body">
                <!-- Form mode -->
                <div class="save-mode-form">
                    <div class="form-field">
                        <label for="save-project-name">Project Name</label>
                        <input type="text" id="save-project-name" placeholder="My Project" autocomplete="off">
                        <div class="form-error hidden" id="save-project-error"></div>
                    </div>
                </div>

                <!-- Confirm overwrite mode -->
                <div class="save-mode-confirm hidden">
                    <p class="confirm-message">
                        A project named "<span id="confirm-project-name"></span>" already exists. Do you want to replace it?
                    </p>
                </div>

                <!-- Saving mode -->
                <div class="save-mode-saving hidden">
                    <div class="saving-indicator">
                        <div class="loading-spinner"></div>
                        <span>Saving project...</span>
                    </div>
                </div>
            </div>
            <div class="dialog-actions">
                <button class="action-btn save-cancel-btn">Cancel</button>
                <button class="action-btn primary save-submit-btn">Save</button>
                <button class="action-btn confirm-cancel-btn hidden">Cancel</button>
                <button class="action-btn danger confirm-replace-btn hidden">Replace</button>
            </div>
        `

        document.body.appendChild(this._dialog)
        this._setupEventListeners()
    }

    /**
     * Set the dialog mode
     * @param {string} mode - 'form' | 'confirm' | 'saving'
     * @private
     */
    _setMode(mode) {
        const formSection = this._dialog.querySelector('.save-mode-form')
        const confirmSection = this._dialog.querySelector('.save-mode-confirm')
        const savingSection = this._dialog.querySelector('.save-mode-saving')

        const cancelBtn = this._dialog.querySelector('.save-cancel-btn')
        const submitBtn = this._dialog.querySelector('.save-submit-btn')
        const confirmCancelBtn = this._dialog.querySelector('.confirm-cancel-btn')
        const confirmReplaceBtn = this._dialog.querySelector('.confirm-replace-btn')

        formSection.classList.toggle('hidden', mode !== 'form')
        confirmSection.classList.toggle('hidden', mode !== 'confirm')
        savingSection.classList.toggle('hidden', mode !== 'saving')

        cancelBtn.classList.toggle('hidden', mode !== 'form')
        submitBtn.classList.toggle('hidden', mode !== 'form')
        confirmCancelBtn.classList.toggle('hidden', mode !== 'confirm')
        confirmReplaceBtn.classList.toggle('hidden', mode !== 'confirm')
    }

    /**
     * Show an error message
     * @param {string} message - Error message
     * @private
     */
    _showError(message) {
        const errorEl = this._dialog.querySelector('#save-project-error')
        errorEl.textContent = message
        errorEl.classList.remove('hidden')
    }

    /**
     * Clear error message
     * @private
     */
    _clearError() {
        const errorEl = this._dialog.querySelector('#save-project-error')
        errorEl.textContent = ''
        errorEl.classList.add('hidden')
    }

    /**
     * Set up event listeners
     * @private
     */
    _setupEventListeners() {
        const closeBtn = this._dialog.querySelector('.dialog-close')
        const cancelBtn = this._dialog.querySelector('.save-cancel-btn')
        const submitBtn = this._dialog.querySelector('.save-submit-btn')
        const confirmCancelBtn = this._dialog.querySelector('.confirm-cancel-btn')
        const confirmReplaceBtn = this._dialog.querySelector('.confirm-replace-btn')
        const nameInput = this._dialog.querySelector('#save-project-name')

        closeBtn.addEventListener('click', () => this.hide())
        cancelBtn.addEventListener('click', () => this.hide())

        submitBtn.addEventListener('click', () => this._handleSubmit())

        confirmCancelBtn.addEventListener('click', () => this._setMode('form'))
        confirmReplaceBtn.addEventListener('click', () => this._handleReplace())

        nameInput.addEventListener('input', () => this._clearError())
        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault()
                this._handleSubmit()
            }
        })

        // Close on backdrop click
        this._dialog.addEventListener('click', (e) => {
            if (e.target === this._dialog) {
                this.hide()
            }
        })
    }

    /**
     * Handle form submission
     * @private
     */
    async _handleSubmit() {
        const nameInput = this._dialog.querySelector('#save-project-name')
        const name = nameInput.value.trim()

        if (!name) {
            this._showError('Please enter a project name')
            nameInput.focus()
            return
        }

        // Check if name exists
        const check = await checkProjectName(name, this._currentProjectId)

        if (check.exists) {
            // Show confirmation
            this._pendingReplaceId = check.id
            this._pendingName = name
            this._dialog.querySelector('#confirm-project-name').textContent = name
            this._setMode('confirm')
        } else {
            // Save directly
            await this._doSave(name, null)
        }
    }

    /**
     * Handle replace confirmation
     * @private
     */
    async _handleReplace() {
        await this._doSave(this._pendingName, this._pendingReplaceId)
    }

    /**
     * Perform the save operation
     * @param {string} name - Project name
     * @param {string|null} replaceId - Project ID to replace
     * @private
     */
    async _doSave(name, replaceId) {
        this._setMode('saving')

        try {
            if (this._onSave) {
                await this._onSave(replaceId || this._currentProjectId, name)
            }
            this.hide()
        } catch (err) {
            console.error('[SaveProjectDialog] Save failed:', err)
            this._setMode('form')
            this._showError('Failed to save project: ' + err.message)
        }
    }
}

// Export singleton
export const saveProjectDialog = new SaveProjectDialog()

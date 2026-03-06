/**
 * Settings Dialog
 * App settings with theme selection.
 *
 * @module ui/settings-dialog
 */

import { SelectDropdown } from 'handfish'

const STORAGE_KEY = 'layers-theme'

const THEMES = [
    { value: 'system', text: 'System' },
    { value: 'gray-dark', text: 'Gray Dark' },
    { value: 'gray-light', text: 'Gray Light' },
    { value: 'neutral-dark', text: 'Neutral Dark' },
    { value: 'neutral-light', text: 'Neutral Light' },
    { value: 'corporate', text: 'Corporate' },
    { value: 'cyberpunk', text: 'Cyberpunk' },
    { value: 'earthy', text: 'Earthy' },
    { value: 'organic', text: 'Organic' },
    { value: 'terminal', text: 'Terminal' },
]

/**
 * Resolve "system" to a concrete theme based on prefers-color-scheme.
 * @returns {string} 'gray-dark' or 'gray-light'
 */
function resolveSystemTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'gray-dark'
        : 'gray-light'
}

/**
 * Apply a theme to the document.
 * @param {string} themeValue - Theme key from THEMES or 'system'
 */
function applyTheme(themeValue) {
    const resolved = themeValue === 'system' ? resolveSystemTheme() : themeValue
    document.documentElement.dataset.theme = resolved
}

/**
 * SettingsDialog - App settings modal
 */
class SettingsDialog {
    constructor() {
        this._dialog = null
        this._themeSelect = null
        this._mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
        this._systemListener = null
    }

    /**
     * Initialize theme on app startup (call once from app.js).
     * Reads localStorage and applies the saved theme.
     * Sets up system preference listener if in system mode.
     */
    initTheme() {
        const saved = localStorage.getItem(STORAGE_KEY) || 'system'
        applyTheme(saved)
        this._updateSystemListener(saved)
    }

    /**
     * Show the settings dialog.
     */
    show() {
        if (!this._dialog) {
            this._createDialog()
        }

        // Sync dropdown with current saved value
        const saved = localStorage.getItem(STORAGE_KEY) || 'system'
        this._themeSelect.value = saved

        this._dialog.showModal()
    }

    /**
     * Hide the dialog.
     */
    hide() {
        if (this._dialog) {
            this._dialog.close()
        }
    }

    /**
     * Create the dialog element.
     * @private
     */
    _createDialog() {
        this._dialog = document.createElement('dialog')
        this._dialog.className = 'settings-dialog'
        this._dialog.innerHTML = `
            <div class="dialog-header">
                <h2>Settings</h2>
                <button class="dialog-close" aria-label="Close">
                    <span class="icon-material">close</span>
                </button>
            </div>
            <div class="dialog-body">
                <div class="form-field">
                    <label class="form-label">Theme</label>
                    <select-dropdown class="settings-theme-select"></select-dropdown>
                </div>
            </div>
        `

        document.body.appendChild(this._dialog)

        // Set up theme dropdown
        this._themeSelect = this._dialog.querySelector('.settings-theme-select')
        this._themeSelect.setOptions(THEMES)

        const saved = localStorage.getItem(STORAGE_KEY) || 'system'
        this._themeSelect.value = saved

        // Theme change handler
        this._themeSelect.addEventListener('change', () => {
            const value = this._themeSelect.value
            localStorage.setItem(STORAGE_KEY, value)
            applyTheme(value)
            this._updateSystemListener(value)
        })

        // Close button
        this._dialog.querySelector('.dialog-close').addEventListener('click', () => {
            this.hide()
        })

        // Close on backdrop click
        this._dialog.addEventListener('click', (e) => {
            if (e.target === this._dialog) {
                this.hide()
            }
        })
    }

    /**
     * Add or remove the system preference change listener.
     * @param {string} themeValue - Current theme setting
     * @private
     */
    _updateSystemListener(themeValue) {
        if (this._systemListener) {
            this._mediaQuery.removeEventListener('change', this._systemListener)
            this._systemListener = null
        }

        if (themeValue === 'system') {
            this._systemListener = () => applyTheme('system')
            this._mediaQuery.addEventListener('change', this._systemListener)
        }
    }
}

export const settingsDialog = new SettingsDialog()

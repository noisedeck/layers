# App Settings Dialog Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an App Settings dialog with theme selection, persisted in localStorage.

**Architecture:** New `SettingsDialog` class follows the established `<dialog>` + `.dialog-header`/`.dialog-body` pattern. A `ThemeManager` handles theme application, localStorage persistence, and system preference detection. All handfish theme CSS files are loaded in index.html (inert unless `data-theme` matches).

**Tech Stack:** Handfish `<select-dropdown>` component, native `<dialog>`, `matchMedia`, `localStorage`

---

### Task 1: Add all handfish theme CSS links to index.html

**Files:**
- Modify: `public/index.html:59-62`

**Step 1: Add missing theme CSS links**

Replace the current handfish theme block:

```html
    <!-- Handfish Design System -->
    <link rel="stylesheet" href="https://handfish.noisefactor.io/0.9.0/styles/tokens.css">
    <link rel="stylesheet" href="https://handfish.noisefactor.io/0.9.0/styles/themes/neutral.css">
    <link rel="stylesheet" href="https://handfish.noisefactor.io/0.9.0/styles/themes/gray.css">
```

With:

```html
    <!-- Handfish Design System -->
    <link rel="stylesheet" href="https://handfish.noisefactor.io/0.9.0/styles/tokens.css">
    <link rel="stylesheet" href="https://handfish.noisefactor.io/0.9.0/styles/themes/neutral.css">
    <link rel="stylesheet" href="https://handfish.noisefactor.io/0.9.0/styles/themes/gray.css">
    <link rel="stylesheet" href="https://handfish.noisefactor.io/0.9.0/styles/themes/corporate.css">
    <link rel="stylesheet" href="https://handfish.noisefactor.io/0.9.0/styles/themes/cyberpunk.css">
    <link rel="stylesheet" href="https://handfish.noisefactor.io/0.9.0/styles/themes/earthy.css">
    <link rel="stylesheet" href="https://handfish.noisefactor.io/0.9.0/styles/themes/organic.css">
    <link rel="stylesheet" href="https://handfish.noisefactor.io/0.9.0/styles/themes/terminal.css">
```

**Step 2: Add settings menu item**

In the Layers logo menu (around line 113-115), add a "settings..." item after "about Layers":

```html
                    <div class="menu-items hide">
                        <div id="settingsMenuItem">settings...</div>
                        <div id="aboutMenuItem">about Layers</div>
                    </div>
```

**Step 3: Verify and commit**

Open the app in a browser. Confirm the menu now shows "settings..." above "about Layers". Confirm the app still loads with gray-dark theme (extra CSS links are inert).

```bash
git add public/index.html
git commit -m "feat: add all handfish theme CSS links and settings menu item"
```

---

### Task 2: Create settings-dialog.js

**Files:**
- Create: `public/js/ui/settings-dialog.js`

**Step 1: Create the file**

```js
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
```

**Step 2: Commit**

```bash
git add public/js/ui/settings-dialog.js
git commit -m "feat: add settings dialog with theme selection"
```

---

### Task 3: Wire up settings dialog in app.js

**Files:**
- Modify: `public/js/app.js`

**Step 1: Add import**

After the existing dialog imports (around line 14, after `import { aboutDialog }`), add:

```js
import { settingsDialog } from './ui/settings-dialog.js'
```

**Step 2: Initialize theme on app startup**

Find where the app initializes (the constructor or init method). Add early in initialization, before any rendering:

```js
settingsDialog.initTheme()
```

To find the right spot, search for `aboutDialog` usage or the app's `init` / `constructor` method. Place `settingsDialog.initTheme()` near the top of initialization.

**Step 3: Add menu click handler**

Find the aboutMenuItem click handler (around line 1989):

```js
        // Logo menu - About
        document.getElementById('aboutMenuItem')?.addEventListener('click', () => {
            aboutDialog.show()
        })
```

Add before it:

```js
        // Logo menu - Settings
        document.getElementById('settingsMenuItem')?.addEventListener('click', () => {
            settingsDialog.show()
        })
```

**Step 4: Remove hardcoded data-theme from index.html**

In `public/index.html` line 2, remove the hardcoded `data-theme="gray-dark"` since `settingsDialog.initTheme()` now handles this:

```html
<html lang="en">
```

**Step 5: Test manually**

1. Open the app — should load with gray-dark theme (system default for dark mode users, or gray-light for light mode)
2. Click Layers logo → "settings..." → dialog opens
3. Change theme to "Cyberpunk" → theme applies immediately
4. Reload page → Cyberpunk persists
5. Change to "System" → resolves to gray-dark or gray-light based on OS
6. Close dialog via X button, backdrop click — both work

**Step 6: Commit**

```bash
git add public/js/app.js public/index.html
git commit -m "feat: wire settings dialog into app with theme persistence"
```

import { getFontaineLoader } from '../layers/fontaine-loader.js'

/**
 * About Dialog
 *
 * Displays application info, version, and deployment metadata.
 *
 * @module ui/about-dialog
 */

/**
 * AboutDialog class
 */
class AboutDialog {
    constructor() {
        this._dialog = null
        this._metadata = null
        this._metadataFetched = false
        this._noisemakerVersion = null
    }

    /**
     * Show the about dialog
     */
    async show() {
        if (!this._dialog) {
            this._createDialog()
        }
        this._dialog.showModal()

        // Fetch deployment metadata if not already fetched
        if (!this._metadataFetched) {
            await this._fetchDeploymentMetadata()
        }

        await this._updateFontBundleInfo()
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
     * Fetch deployment metadata from server
     * @private
     */
    async _fetchDeploymentMetadata() {
        const defaults = { gitHash: 'LOCAL', deployed: 'n/a' }

        try {
            const response = await fetch('./deployment-meta.json', { cache: 'no-store' })
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`)
            }
            const data = await response.json()
            const rawHash = typeof data?.git_hash === 'string' ? data.git_hash.trim() : ''
            const normalizedHash = rawHash ? rawHash.replace(/\s+/g, '').slice(0, 8) : 'LOCAL'
            const normalizedTimestamp = this._normalizeTimestamp(data?.date)
            const formattedDate = typeof normalizedTimestamp === 'number'
                ? this._formatDate(normalizedTimestamp)
                : 'n/a'

            this._metadata = {
                gitHash: normalizedHash || 'LOCAL',
                deployed: formattedDate
            }
        } catch (error) {
            console.warn('[AboutDialog] Failed to fetch deployment metadata:', error)
            this._metadata = defaults
        }

        this._metadataFetched = true
        this._updateBuildInfo()

        // Fetch noisemaker version from vendor bundle
        await this._fetchNoisemakerVersion()
    }

    /**
     * Fetch noisemaker version from vendor bundle header
     * @private
     */
    async _fetchNoisemakerVersion() {
        try {
            const response = await fetch('https://shaders.noisedeck.app/0.8.0/noisemaker-shaders-core.esm.js', { cache: 'no-store' })
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`)
            }
            const reader = response.body.getReader()
            const { value } = await reader.read()
            reader.cancel()
            const headerText = new TextDecoder().decode(value).slice(0, 500)
            const match = headerText.match(/^\s*\*\s*Build:\s*(\S+)/m)
            if (match) {
                this._noisemakerVersion = match[1]
                this._updateBuildInfo()
            }
        } catch (error) {
            console.warn('[AboutDialog] Failed to fetch noisemaker version:', error)
        }
    }

    /**
     * Normalize timestamp value
     * @private
     */
    _normalizeTimestamp(value) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value
        }
        if (typeof value === 'string' && value.trim()) {
            const parsed = Number(value.trim())
            if (Number.isFinite(parsed)) {
                return parsed
            }
        }
        return null
    }

    /**
     * Format date from unix timestamp
     * @private
     */
    _formatDate(timestampSeconds) {
        if (!Number.isFinite(timestampSeconds)) return 'n/a'
        const date = new Date(timestampSeconds * 1000)
        if (Number.isNaN(date.getTime())) return 'n/a'

        const pad = (value, length = 2) => String(Math.trunc(value)).padStart(length, '0')
        const year = pad(date.getFullYear(), 4)
        const month = pad(date.getMonth() + 1)
        const day = pad(date.getDate())
        const hour = pad(date.getHours())
        const minute = pad(date.getMinutes())

        return `${year}-${month}-${day} ${hour}:${minute}`
    }

    /**
     * Update build info in the dialog
     * @private
     */
    _updateBuildInfo() {
        if (!this._dialog) return
        const buildInfoEl = this._dialog.querySelector('.about-modal-build:not(.noisemaker-version)')
        if (buildInfoEl && this._metadata) {
            const hash = this._metadata.gitHash
            if (hash && hash !== 'LOCAL') {
                buildInfoEl.innerHTML = `build: <a href="https://github.com/noisedeck/layers/tree/${hash}" class="about-modal-link" target="_blank" rel="noopener">${hash}</a> / deployed: ${this._metadata.deployed}`
            } else {
                buildInfoEl.textContent = `build: ${hash} / deployed: ${this._metadata.deployed}`
            }
        }
        const nmVersionEl = this._dialog.querySelector('.about-modal-build.noisemaker-version')
        if (nmVersionEl) {
            if (this._noisemakerVersion) {
                nmVersionEl.innerHTML = `noisemaker: <a href="https://github.com/noisedeck/noisemaker/tree/${this._noisemakerVersion}" class="about-modal-link" target="_blank" rel="noopener">${this._noisemakerVersion}</a>`
            } else {
                nmVersionEl.textContent = ''
            }
        }
    }

    /**
     * Update font bundle info in the dialog
     * @private
     */
    async _updateFontBundleInfo() {
        const loader = getFontaineLoader()
        const installed = await loader.isInstalled()
        const row = this._dialog?.querySelector('.font-bundle-row')
        if (!row) return

        if (installed) {
            await loader.loadFromCache()
            const info = loader.getVersionInfo()
            row.style.display = ''
            row.querySelector('.font-bundle-info').textContent = `${info.totalFonts} fonts (v${info.installed})`

            row.querySelector('.font-bundle-uninstall').onclick = async () => {
                if (confirm('Uninstall the font bundle? You can reinstall it from the text effect font picker.')) {
                    await loader.clearCache()
                    row.style.display = 'none'
                    document.dispatchEvent(new CustomEvent('font-bundle-changed'))
                }
            }
        } else {
            row.style.display = 'none'
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
                <div class="about-modal-graphic" role="presentation">
                    <svg class="about-modal-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" fill="currentColor">
                        <g transform="translate(0,600) scale(0.1,-0.1)">
                            <path d="M840 5478 c-10 -18 -120 -204 -244 -413 l-225 -380 1314 -3 c723 -1 1907 -1 2630 0 l1315 3 -236 390 c-130 215 -241 400 -247 413 l-10 22 -2139 0 -2139 0 -19 -32z"/>
                            <path d="M659 4118 c-111 -189 -222 -376 -246 -415 l-43 -73 2630 0 2630 0 -249 413 -249 412 -2135 3 -2135 2 -203 -342z"/>
                            <path d="M858 3403 c-8 -10 -90 -146 -183 -303 -92 -157 -199 -337 -237 -400 l-68 -115 1315 -3 c723 -1 1907 -1 2630 0 l1314 3 -251 418 -251 417 -2127 0 c-2013 0 -2128 -1 -2142 -17z"/>
                            <path d="M619 1959 c-134 -226 -245 -414 -247 -418 -1 -3 1179 -6 2623 -6 1743 0 2625 3 2625 10 0 6 -110 192 -244 415 l-244 405 -2135 3 -2134 2 -244 -411z"/>
                            <path d="M714 1073 c-81 -137 -191 -322 -245 -413 l-99 -165 1315 -3 c723 -1 1906 -1 2629 0 l1315 3 -248 410 -247 410 -2137 3 -2136 2 -147 -247z"/>
                        </g>
                    </svg>
                </div>
                <div class="about-modal-details" tabindex="-1">
                    <div class="about-modal-title">Layers</div>
                    <div class="about-modal-subtitle">Development Preview</div>
                    <div class="about-modal-copyright">&copy; 2026 <a href="https://noisefactor.io/" class="about-modal-link" target="_blank" rel="noopener">Noise Factor LLC.</a></div>
                    <div class="about-modal-build">build: local / deployed: n/a</div>
                    <div class="about-modal-build noisemaker-version"></div>
                    <div class="about-modal-ecosystem">Layers is a free tool by <a href="https://noisefactor.io/" target="_blank" rel="noopener">Noise Factor</a>, powered by the <a href="https://noisemaker.app/" target="_blank" rel="noopener">Noisemaker</a> open source engine. <a href="https://noisedeck.app/" target="_blank" rel="noopener">Noisedeck</a> is our video synth. Free to use, with a $4/mo subscription for pro features.</div>
                    <div class="about-modal-build font-bundle-row" style="display: none;">
                        fontaine: <span class="font-bundle-info"></span>
                        <button class="font-bundle-uninstall">uninstall</button>
                    </div>
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
    }
}

// Export singleton
export const aboutDialog = new AboutDialog()

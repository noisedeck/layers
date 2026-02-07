/**
 * Export Video Dialog
 * Frame-accurate video export with MP4/ZIP output.
 * Ported from Noisedeck ExportMode, adapted for Layers' video layer seeking.
 *
 * @module ui/export-video-dialog
 */

export class ExportVideoDialog {
    constructor(options) {
        this.files = options.files
        this.renderer = options.renderer
        this.canvas = options.canvas
        this.getResolution = options.getResolution
        this.setResolution = options.setResolution
        this.onComplete = options.onComplete || (() => {})
        this.onCancel = options.onCancel || (() => {})

        this.state = 'idle'
        this.currentFrame = 0
        this.totalFrames = 0
        this.abortController = null
        this.originalResolution = null
        this.wasRunning = false
        this.pausedNormalizedTime = 0
        this.startTime = 0

        this._dialog = null
        this._elements = {}

        this._handleKeydown = this._handleKeydown.bind(this)
        this._handleDialogClick = this._handleDialogClick.bind(this)
    }

    _cacheElements() {
        this._dialog = document.getElementById('exportModal')
        if (!this._dialog) return false

        this._elements = {
            widthInput: document.getElementById('exportWidth'),
            heightInput: document.getElementById('exportHeight'),
            framerateSelect: document.getElementById('exportFramerate'),
            durationInput: document.getElementById('exportDuration'),
            loopCountInput: document.getElementById('exportLoopCount'),
            formatSelect: document.getElementById('exportFormat'),
            qualitySelect: document.getElementById('exportQuality'),
            playFromSelect: document.getElementById('exportPlayFrom'),
            totalFramesDisplay: document.getElementById('exportTotalFrames'),
            estimatedSizeDisplay: document.getElementById('exportEstimatedSize'),
            beginBtn: document.getElementById('exportBeginBtn'),
            cancelBtn: document.getElementById('exportCancelBtn'),
            dialogView: document.getElementById('exportDialogView'),
            progressView: document.getElementById('exportProgressView'),
            progressBar: document.getElementById('exportProgressBar'),
            progressText: document.getElementById('exportProgressText'),
            progressElapsed: document.getElementById('exportProgressElapsed'),
            progressRemaining: document.getElementById('exportProgressRemaining'),
            progressCancelBtn: document.getElementById('exportProgressCancelBtn')
        }
        return true
    }

    open() {
        if (!this._cacheElements()) return

        this.wasRunning = this.renderer.isRunning
        if (this.wasRunning) {
            const inner = this.renderer._renderer
            const elapsedSeconds = (performance.now() - inner._loopStartTime) / 1000
            this.pausedNormalizedTime = (elapsedSeconds % inner._loopDuration) / inner._loopDuration
            this.renderer.stop()
        }

        this.state = 'dialog'

        const res = this.getResolution()
        this._elements.widthInput.value = res.width
        this._elements.heightInput.value = res.height

        this._loadPreferences()
        this._updateCalculations()

        this._elements.dialogView.style.display = 'block'
        this._elements.progressView.style.display = 'none'

        this._addEventListeners()
        this._dialog.showModal()
    }

    close() {
        if (!this._dialog) return
        this._removeEventListeners()
        this._dialog.close()

        if (this.wasRunning) {
            const inner = this.renderer._renderer
            const now = performance.now()
            const pausedElapsedSeconds = this.pausedNormalizedTime * inner._loopDuration
            inner._loopStartTime = now - (pausedElapsedSeconds * 1000)
            this.renderer.start()
        }

        this.state = 'idle'
    }

    async beginExport() {
        if (this.state !== 'dialog') return

        this.state = 'preparing'
        this.abortController = new AbortController()

        const settings = this._gatherSettings()
        this.totalFrames = Math.ceil(settings.framerate * settings.duration * settings.loopCount)
        this.currentFrame = 0

        this._savePreferences(settings)

        this._elements.dialogView.style.display = 'none'
        this._elements.progressView.style.display = 'block'
        this._updateProgress()

        this.originalResolution = this.getResolution()

        try {
            if (settings.width !== this.originalResolution.width || settings.height !== this.originalResolution.height) {
                this.setResolution(settings.width, settings.height)
                await this._waitFrame()
            }

            if (settings.playFrom === 'beginning') {
                await this._seekAllVideos(0)
            }

            const exportSettings = {
                width: settings.width,
                height: settings.height,
                framerate: settings.framerate,
                videoQuality: settings.quality,
                totalFrames: this.totalFrames
            }

            if (settings.format === 'mp4') {
                await this.files.startRecordingMP4(this.canvas, exportSettings)
            } else {
                this.files.saveZip(exportSettings)
            }

            this.state = 'exporting'
            this.startTime = performance.now()

            await this._runExportLoop(settings)

        } catch (err) {
            console.error('Export failed:', err)
            this._handleExportError(err)
            return
        } finally {
            if (this.originalResolution) {
                const current = this.getResolution()
                if (current.width !== this.originalResolution.width ||
                    current.height !== this.originalResolution.height) {
                    this.setResolution(this.originalResolution.width, this.originalResolution.height)
                }
            }
        }
    }

    async _runExportLoop(settings) {
        const frameDurationMs = 1000 / settings.framerate
        const exportDurationSec = settings.duration
        const timeOffset = settings.playFrom === 'beginning' ? 0 : this.pausedNormalizedTime

        for (let n = 0; n < this.totalFrames; n++) {
            if (this.abortController.signal.aborted) break

            this.currentFrame = n
            const targetTimeMs = n * frameDurationMs
            const targetTimeSec = targetTimeMs / 1000

            const timeInLoop = targetTimeSec % exportDurationSec
            const baseNormalizedTime = timeInLoop / exportDurationSec
            const normalizedTime = (baseNormalizedTime + timeOffset) % 1

            await this._seekAllVideos(targetTimeSec)
            this.renderer._updateVideoTextures()

            this.renderer.render(normalizedTime)
            await this._waitFrame()

            if (settings.format === 'mp4') {
                this.files.encodeVideoFrame(this.canvas, {
                    framerate: settings.framerate,
                    videoQuality: settings.quality
                })
            } else {
                const gl = this.canvas.getContext('webgl2')
                if (gl) {
                    const pixels = new Uint8Array(this.canvas.width * this.canvas.height * 4)
                    gl.readPixels(0, 0, this.canvas.width, this.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
                    this.files.addZipFrame(pixels, {
                        width: this.canvas.width,
                        height: this.canvas.height,
                        totalFrames: this.totalFrames
                    })
                }
            }

            if (n % 5 === 0) {
                this._updateProgress()
                await new Promise(resolve => setTimeout(resolve, 0))
            }
        }

        if (!this.abortController.signal.aborted) {
            await this._finalizeExport(settings)
        }
    }

    async _seekAllVideos(timeSec) {
        const mediaTextures = this.renderer._mediaTextures
        const promises = []

        for (const [, media] of mediaTextures) {
            if (media.type !== 'video') continue
            const video = media.element
            if (video.duration && isFinite(video.duration)) {
                const seekTime = timeSec % video.duration
                if (Math.abs(video.currentTime - seekTime) > 0.01) {
                    promises.push(new Promise(resolve => {
                        const onSeeked = () => {
                            video.removeEventListener('seeked', onSeeked)
                            resolve()
                        }
                        video.addEventListener('seeked', onSeeked)
                        video.currentTime = seekTime
                    }))
                }
            }
        }

        await Promise.all(promises)
    }

    async _finalizeExport(settings) {
        try {
            if (settings.format === 'mp4') {
                await this.files.endRecordingMP4()
            }
            this.close()
            this.onComplete(settings.format)
        } catch (err) {
            console.error('Export finalization failed:', err)
            this._handleExportError(err)
        }
    }

    async cancel() {
        if (this.state === 'dialog') {
            this.close()
            return
        }

        if (this.state !== 'preparing' && this.state !== 'exporting') return

        this.abortController?.abort()

        const settings = this._gatherSettings()
        if (settings.format === 'mp4') {
            await this.files.cancelMP4()
        } else {
            this.files.cancelZIP()
        }

        this.close()
        this.onCancel()
    }

    _ensureEven(value) {
        const floored = Math.floor(value)
        return Math.max(2, floored - (floored % 2))
    }

    _gatherSettings() {
        const rawWidth = parseInt(this._elements.widthInput.value, 10) || 1024
        const rawHeight = parseInt(this._elements.heightInput.value, 10) || 1024

        return {
            width: this._ensureEven(rawWidth),
            height: this._ensureEven(rawHeight),
            framerate: parseInt(this._elements.framerateSelect.value, 10) || 30,
            duration: parseFloat(this._elements.durationInput.value) || 15,
            loopCount: parseInt(this._elements.loopCountInput.value, 10) || 1,
            format: this._elements.formatSelect.value || 'mp4',
            quality: this._elements.qualitySelect.value || 'very high',
            playFrom: this._elements.playFromSelect?.value || 'beginning'
        }
    }

    _updateCalculations() {
        const settings = this._gatherSettings()
        const totalFrames = Math.ceil(settings.framerate * settings.duration * settings.loopCount)

        this._elements.totalFramesDisplay.textContent = `${totalFrames} frames`

        const pixels = settings.width * settings.height
        const qualityMultiplier = { 'low': 0.2, 'medium': 0.4, 'high': 0.6, 'very high': 0.8, 'ultra': 1.0 }
        const bytesPerFrame = (pixels / 1000) * 0.5 * (qualityMultiplier[settings.quality] || 0.8)
        const estimatedBytes = bytesPerFrame * totalFrames * 1024

        const sizeStr = estimatedBytes < 1024 * 1024
            ? `~${Math.round(estimatedBytes / 1024)} KB`
            : `~${(estimatedBytes / (1024 * 1024)).toFixed(1)} MB`
        this._elements.estimatedSizeDisplay.textContent = sizeStr
    }

    _updateProgress() {
        const percent = this.totalFrames > 0 ? (this.currentFrame / this.totalFrames) * 100 : 0

        this._elements.progressBar.style.width = `${percent}%`
        this._elements.progressText.textContent = `Frame ${this.currentFrame} of ${this.totalFrames}`

        const elapsed = performance.now() - this.startTime
        this._elements.progressElapsed.textContent = this._formatTime(elapsed)

        if (this.currentFrame > 0) {
            const msPerFrame = elapsed / this.currentFrame
            const remainingMs = msPerFrame * (this.totalFrames - this.currentFrame)
            this._elements.progressRemaining.textContent = this._formatTime(remainingMs)
        } else {
            this._elements.progressRemaining.textContent = '--:--'
        }
    }

    _formatTime(ms) {
        const totalSeconds = Math.floor(ms / 1000)
        const minutes = Math.floor(totalSeconds / 60)
        const seconds = totalSeconds % 60
        return `${minutes}:${seconds.toString().padStart(2, '0')}`
    }

    _waitFrame() {
        return new Promise(resolve => requestAnimationFrame(resolve))
    }

    _handleExportError(err) {
        this._elements.progressText.textContent = `Error: ${err.message}`
        this._elements.progressBar.style.background = 'var(--red, #e74c3c)'

        setTimeout(() => {
            this.close()
            this.onCancel()
        }, 3000)
    }

    _addEventListeners() {
        const inputs = [
            this._elements.widthInput,
            this._elements.heightInput,
            this._elements.framerateSelect,
            this._elements.durationInput,
            this._elements.loopCountInput,
            this._elements.qualitySelect
        ]

        for (const input of inputs) {
            if (input) {
                input.addEventListener('input', () => this._updateCalculations())
                input.addEventListener('change', () => this._updateCalculations())
            }
        }

        this._elements.beginBtn?.addEventListener('click', () => this.beginExport())
        this._elements.cancelBtn?.addEventListener('click', () => this.cancel())
        this._elements.progressCancelBtn?.addEventListener('click', () => this.cancel())

        document.addEventListener('keydown', this._handleKeydown)
        this._dialog.addEventListener('click', this._handleDialogClick)
    }

    _removeEventListeners() {
        document.removeEventListener('keydown', this._handleKeydown)
        this._dialog?.removeEventListener('click', this._handleDialogClick)
    }

    _handleKeydown(e) {
        if (e.key === 'Escape') {
            e.preventDefault()
            this.cancel()
        }
    }

    _handleDialogClick(e) {
        if (e.target === this._dialog && this.state === 'dialog') {
            this.cancel()
        }
    }

    _loadPreferences() {
        try {
            const saved = localStorage.getItem('layers-export-prefs')
            if (saved) {
                const prefs = JSON.parse(saved)
                if (prefs.framerate) this._elements.framerateSelect.value = prefs.framerate
                if (prefs.duration) this._elements.durationInput.value = prefs.duration
                if (prefs.loopCount) this._elements.loopCountInput.value = prefs.loopCount
                if (prefs.format) this._elements.formatSelect.value = prefs.format
                if (prefs.quality) this._elements.qualitySelect.value = prefs.quality
                if (prefs.playFrom && this._elements.playFromSelect) this._elements.playFromSelect.value = prefs.playFrom
            }
        } catch (err) {
            // ignore
        }
    }

    _savePreferences(settings) {
        try {
            localStorage.setItem('layers-export-prefs', JSON.stringify({
                framerate: settings.framerate,
                duration: settings.duration,
                loopCount: settings.loopCount,
                format: settings.format,
                quality: settings.quality,
                playFrom: settings.playFrom
            }))
        } catch (err) {
            // ignore
        }
    }
}

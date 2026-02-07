# Export Dialogs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Port "export image" and "export video" dialogs from Noisedeck into Layers, with MediaBunny MP4 encoding and ZIP frame export.

**Architecture:** Noisedeck's export system has three layers: dialog controllers (ExportMode, ExportImageMode), a Files class (MP4/ZIP recording via MediaBunny + WebCodecs), and dialog HTML/CSS. We port all three, adapting for Layers' renderer API (LayersRenderer wraps CanvasRenderer), video layer seeking during frame-by-frame export, and Layers' existing dialog/toast patterns.

**Tech Stack:** Native ES modules, HTML5 `<dialog>`, MediaBunny (WebCodecs/H.264), JSZip web worker, Playwright E2E tests.

---

### Task 1: Vendor Libraries

Copy three library files from Noisedeck into Layers.

**Files:**
- Create: `public/js/lib/mediabunny.min.mjs` (copy from `../noisedeck/app/js/lib/mediabunny.min.mjs`)
- Create: `public/js/lib/zipWorker.js` (copy from `../noisedeck/app/js/lib/zipWorker.js`)
- Create: `public/js/lib/jszip.min.js` (copy from `../noisedeck/app/js/lib/jszip.min.js`)

**Step 1: Create lib directory and copy files**

```bash
mkdir -p public/js/lib
cp ../noisedeck/app/js/lib/mediabunny.min.mjs public/js/lib/
cp ../noisedeck/app/js/lib/zipWorker.js public/js/lib/
cp ../noisedeck/app/js/lib/jszip.min.js public/js/lib/
```

**Step 2: Fix zipWorker import path**

The zipWorker.js uses `importScripts('./jszip.min.js')`. This path is relative to the worker file, which will be at `/js/lib/zipWorker.js`, so jszip at `/js/lib/jszip.min.js` is correct. No change needed.

**Step 3: Commit**

```bash
git add public/js/lib/
git commit -m "chore: vendor mediabunny, jszip, and zip worker from noisedeck"
```

---

### Task 2: Create Files Class

Port Noisedeck's `files.js` to `public/js/utils/files.js`. Drop GIF support, `getVideoFPS`, and `cancelExport`. Remove `eventBus` calls. Change import path for mediabunny. Change filename prefix to `layers-`.

**Files:**
- Create: `public/js/utils/files.js`

**Step 1: Write the Files class**

Create `public/js/utils/files.js` with this content:

```js
/**
 * Files - MP4/ZIP recording and image export
 * Ported from Noisedeck, adapted for Layers.
 *
 * @module utils/files
 */

import { Output, Mp4OutputFormat, BufferTarget, EncodedVideoPacketSource, EncodedPacket } from '../lib/mediabunny.min.mjs'

export class Files {
    constructor() {
        this.ready = false
        this.currentFrame = 0

        this.zipWorker = new Worker('./js/lib/zipWorker.js')
        this.zipWorker.onmessage = (msg) => {
            if (msg.data.ready) {
                this.ready = true
            } else if (msg.data.doneRecording) {
                this.createZip()
            } else if (msg.data.done) {
                this.downloadFile(msg.data.url, 'zip')
            }
        }

        this.output = null
        this.videoSource = null
        this.mp4Target = null
        this.pendingVideoPacketPromise = Promise.resolve()
        this.videoEncoder = null
        this.startTime = null
        this.recording = false
        this.lastKeyFrame = null
        this.framesGenerated = 0
        this.videoPacketsAdded = 0
        this.videoPacketsAddFailed = 0
    }

    saveImage(canvas, type, quality = 1) {
        const mimeTypes = { jpg: 'image/jpeg', webp: 'image/webp' }
        const mimeType = mimeTypes[type] || 'image/png'
        const url = canvas.toDataURL(mimeType, quality)
        this.downloadFile(url, type)
    }

    calculateBitrate(settings) {
        const motionFactors = {
            'low': 0.02,
            'medium': 0.04,
            'high': 0.07,
            'very high': 0.1,
            'ultra': 0.15
        }
        const compressionRatio = 0.1
        return settings.width * settings.height * settings.framerate * motionFactors[settings.videoQuality] / compressionRatio
    }

    async startRecordingMP4(canvas, settings) {
        if (typeof VideoEncoder === 'undefined') {
            throw new Error('Browser does not support VideoEncoder / WebCodecs API')
        }

        this.mp4Target = new BufferTarget()
        this.output = new Output({
            format: new Mp4OutputFormat({ fastStart: 'reserve' }),
            target: this.mp4Target
        })

        this.videoSource = new EncodedVideoPacketSource('avc')
        const estimatedFrames = settings?.totalFrames ?? 0
        const SAFETY_MULTIPLIER = 6
        const maximumPacketCount = Math.max(60, Math.ceil(estimatedFrames * SAFETY_MULTIPLIER)) || 600

        await this.output.addVideoTrack(this.videoSource, {
            frameRate: settings.framerate,
            maximumPacketCount
        })
        await this.output.start()

        this.pendingVideoPacketPromise = Promise.resolve()

        this.videoEncoder = new VideoEncoder({
            output: (chunk, meta) => {
                if (!this.videoSource) return
                const packet = EncodedPacket.fromEncodedChunk(chunk)
                this.pendingVideoPacketPromise = this.pendingVideoPacketPromise
                    .then(() => this.videoSource.add(packet, meta))
                    .then(() => { this.videoPacketsAdded++ })
                    .catch((error) => {
                        this.videoPacketsAddFailed++
                        console.error('Failed to add video packet', error)
                    })
            },
            error: e => console.error(e)
        })
        this.videoEncoder.configure({
            codec: 'avc1.4d0034',
            width: canvas.width,
            height: canvas.height,
            bitrate: this.calculateBitrate(settings)
        })

        this.startTime = document.timeline.currentTime
        this.recording = true
        this.lastKeyFrame = -Infinity
        this.framesGenerated = 0
        this.ready = true
    }

    encodeVideoFrame(canvas, settings) {
        const frameIndex = this.framesGenerated
        const timestampUs = Math.round(frameIndex * (1e6 / settings.framerate))
        let frame = new VideoFrame(canvas, {
            timestamp: timestampUs,
            duration: Math.round(1e6 / settings.framerate)
        })
        this.framesGenerated++

        const framesPerKeySpan = Math.max(1, Math.round(settings.framerate * 5))
        const forcePerFrameKeyFrame = settings?.videoQuality === 'ultra'
        const needsKeyFrame = forcePerFrameKeyFrame || (frameIndex % framesPerKeySpan === 0)
        this.videoEncoder.encode(frame, { keyFrame: needsKeyFrame })
        frame.close()
    }

    async endRecordingMP4() {
        this.recording = false

        await this.videoEncoder?.flush()
        this.videoEncoder?.close()

        try {
            await this.pendingVideoPacketPromise
        } catch (error) {
            console.error('Failed to add video packet', error)
        }

        if (this.output) {
            await this.output.finalize()
        }

        const buffer = this.mp4Target?.buffer
        if (buffer) {
            const url = window.URL.createObjectURL(new Blob([buffer]))
            this.downloadFile(url, 'mp4')
        } else {
            console.error('Unable to retrieve MP4 buffer from Mediabunny target')
        }

        this.videoEncoder = null
        this.output = null
        this.videoSource = null
        this.mp4Target = null
        this.pendingVideoPacketPromise = Promise.resolve()
        this.startTime = null
        this.ready = false
    }

    async cancelMP4() {
        this.recording = false

        try {
            this.videoEncoder?.close()
        } catch (error) {
            console.error('Error closing video encoder', error)
        }

        this.videoEncoder = null
        this.output = null
        this.videoSource = null
        this.mp4Target = null
        this.pendingVideoPacketPromise = Promise.resolve()
        this.startTime = null
        this.ready = false
        this.currentFrame = 0
        this.framesGenerated = 0
    }

    saveZip(settings) {
        this.zipWorker.postMessage({ settings })
    }

    addZipFrame(pixels, settings) {
        this.zipWorker.postMessage({ settings, pixels })
    }

    createZip() {
        this.ready = false
    }

    cancelZIP() {
        if (this.zipWorker) {
            this.zipWorker.terminate()
            this.zipWorker = new Worker('./js/lib/zipWorker.js')
            this.zipWorker.onmessage = (msg) => {
                if (msg.data.ready) {
                    this.ready = true
                } else if (msg.data.doneRecording) {
                    this.createZip()
                } else if (msg.data.done) {
                    this.downloadFile(msg.data.url, 'zip')
                }
            }
        }
        this.currentFrame = 0
        this.ready = false
    }

    downloadFile(url, extension) {
        const a = document.createElement('a')
        a.href = url
        a.setAttribute('download', `layers-${Date.now().toString()}.${extension}`)
        a.click()
    }
}
```

**Step 2: Commit**

```bash
git add public/js/utils/files.js
git commit -m "feat: add Files class for MP4/ZIP export"
```

---

### Task 3: Add CSS Variables and Export Dialog Styles

Add missing CSS variables to `menu.css` and export dialog styles to `components.css`.

**Files:**
- Modify: `public/css/menu.css:6-50` (add `--color1`, `--color3`, `--color5`, `--red` to all three theme blocks)
- Modify: `public/css/components.css:1159` (append export dialog styles at end)

**Step 1: Add CSS variables to menu.css**

In the `:root` block (dark mode defaults, line ~14), add after `--accent4`:

```css
    --color1: #2a2a2a;
    --color3: #666666;
    --color5: #999999;
    --red: #e74c3c;
```

In the `:root.light-mode` block (line ~28), add after `--accent4`:

```css
    --color1: #e0e0e0;
    --color3: #999999;
    --color5: #666666;
```

In the `@media (prefers-color-scheme: light)` block (line ~42), add after `--accent4`:

```css
        --color1: #e0e0e0;
        --color3: #999999;
        --color5: #666666;
```

**Step 2: Append export dialog CSS to components.css**

Add at end of `public/css/components.css`:

```css

/* =========================================================================
   Export Dialogs
   ========================================================================= */

.export-modal-title {
    background: linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%);
    border-bottom: 1px solid var(--color-border-muted, rgba(255,255,255,0.08));
    padding: 0 0.75em;
    min-height: 2.25em;
    height: 2.25em;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--color-text-primary, var(--color6));
    text-transform: lowercase;
    letter-spacing: 0.05em;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 0.5em;
    border-radius: var(--radius-xl, 0.5rem) var(--radius-xl, 0.5rem) 0 0;
}

.export-modal-close {
    background: transparent;
    border: none;
    color: var(--color-text-muted, var(--color5));
    cursor: pointer;
    font-size: 0.875rem;
    padding: 0.25em 0.5em;
    line-height: 1;
    opacity: 0.7;
    transition: opacity 0.15s ease;
    margin-left: auto;
}

.export-modal-close:hover {
    opacity: 1;
    color: var(--color-text-primary, var(--color6));
}

.export-modal-content {
    padding: 0.75rem;
}

.export-settings-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
}

.export-settings-grid .control-group {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
}

.export-settings-grid .control-group.full-width {
    grid-column: 1 / -1;
}

.export-settings-grid .control-label {
    font-size: 0.6875rem;
    color: var(--color-text-muted, var(--color5));
    text-transform: lowercase;
}

.export-settings-grid input,
.export-settings-grid select {
    width: 100%;
    padding: 0.375rem 0.5rem;
    background: var(--color1, #2a2a2a);
    border: 1px solid var(--color3, #666666);
    border-radius: var(--radius-sm, 0.375rem);
    color: var(--color-text-primary, var(--color6));
    font-family: var(--font-base, Nunito, sans-serif);
    font-size: 0.75rem;
}

.export-settings-grid input:focus,
.export-settings-grid select:focus {
    outline: none;
    border-color: var(--color-accent, var(--accent3));
}

.export-info-row {
    display: flex;
    justify-content: space-between;
    margin-top: 0.75rem;
    padding: 0.5rem;
    background: color-mix(in srgb, var(--color1, #2a2a2a) 50%, transparent 50%);
    border-radius: var(--radius-sm, 0.375rem);
    font-size: 0.6875rem;
    color: var(--color-text-muted, var(--color5));
}

.export-info-row span {
    color: var(--color-text-primary, var(--color6));
}

.export-warning-row {
    margin-top: 0.5rem;
    padding: 0.4rem 0.5rem;
    background: color-mix(in srgb, var(--color1, #2a2a2a) 50%, transparent 50%);
    border-radius: var(--radius-sm, 0.375rem);
    font-size: 0.625rem;
    color: var(--color-text-muted, var(--color5));
    font-style: italic;
}

.export-button-row {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.75rem;
}

.export-btn {
    flex: 1;
    padding: 0.5rem 1rem;
    border-radius: var(--radius-sm, 0.375rem);
    font-family: var(--font-base, Nunito, sans-serif);
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
}

.export-btn--primary {
    background: color-mix(in srgb, var(--color-accent, var(--accent3)) 40%, transparent 60%);
    border: 1px solid var(--color-accent, var(--accent3));
    color: var(--color-text-primary, var(--color7));
}

.export-btn--primary:hover {
    background: color-mix(in srgb, var(--color-accent, var(--accent3)) 60%, transparent 40%);
}

.export-progress-container {
    padding: 1rem;
}

.export-progress-bar-container {
    width: 100%;
    height: 8px;
    background: var(--color1, #2a2a2a);
    border-radius: 999px;
    overflow: hidden;
    margin-bottom: 0.75rem;
}

.export-progress-bar {
    height: 100%;
    background: linear-gradient(90deg, var(--color-accent, var(--accent3)), var(--accent4, #c0c0c0));
    border-radius: 999px;
    width: 0%;
    transition: width 0.1s ease-out;
}

.export-progress-text {
    font-size: 0.8125rem;
    color: var(--color-text-primary, var(--color6));
    text-align: center;
    margin-bottom: 0.5rem;
}

.export-progress-time {
    display: flex;
    justify-content: space-between;
    font-size: 0.6875rem;
    color: var(--color-text-muted, var(--color5));
    margin-bottom: 1rem;
}

.export-progress-cancel {
    width: 100%;
    padding: 0.5rem 1rem;
    background: color-mix(in srgb, var(--red, #e74c3c) 20%, transparent 80%);
    border: 1px solid color-mix(in srgb, var(--red, #e74c3c) 50%, transparent 50%);
    border-radius: var(--radius-sm, 0.375rem);
    color: var(--color-text-primary, var(--color6));
    font-family: var(--font-base, Nunito, sans-serif);
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
}

.export-progress-cancel:hover {
    background: color-mix(in srgb, var(--red, #e74c3c) 40%, transparent 60%);
    border-color: var(--red, #e74c3c);
}
```

**Step 3: Commit**

```bash
git add public/css/menu.css public/css/components.css
git commit -m "style: add export dialog CSS and missing color variables"
```

---

### Task 4: Add Dialog HTML and Menu Items to index.html

Add the two `<dialog>` elements and two new menu items.

**Files:**
- Modify: `public/index.html:86-89` (add menu items after saveJpgMenuItem)
- Modify: `public/index.html:244-247` (add dialog HTML before toast container)

**Step 1: Add menu items**

After line 88 (`<div id="saveJpgMenuItem">quick save as jpg</div>`), add:

```html
                        <hr class="menu-seperator">
                        <div id="exportImageMenuItem">export image...</div>
                        <div id="exportVideoMenuItem">export video...</div>
```

**Step 2: Add export dialogs HTML**

Before `<!-- Toast Container -->` (line 244), add:

```html
    <!-- Export Video Dialog -->
    <dialog id="exportModal" aria-labelledby="exportModalTitle">
        <div class="export-modal-title">
            <span class="material-symbols-outlined" style="font-size: 18px;">movie</span>
            <span id="exportModalTitle">export video</span>
            <button class="export-modal-close" id="exportCancelBtn">&#10005;</button>
        </div>
        <div id="exportDialogView" class="export-modal-content">
            <div class="export-settings-grid">
                <div class="control-group">
                    <label for="exportWidth" class="control-label">width</label>
                    <input type="number" id="exportWidth" value="1024" min="64" max="4096" step="1">
                </div>
                <div class="control-group">
                    <label for="exportHeight" class="control-label">height</label>
                    <input type="number" id="exportHeight" value="1024" min="64" max="4096" step="1">
                </div>
                <div class="control-group">
                    <label for="exportFramerate" class="control-label">framerate</label>
                    <select id="exportFramerate">
                        <option value="24">24 fps</option>
                        <option value="30" selected>30 fps</option>
                        <option value="60">60 fps</option>
                    </select>
                </div>
                <div class="control-group">
                    <label for="exportDuration" class="control-label">duration (sec)</label>
                    <input type="number" id="exportDuration" value="15" min="1" max="300" step="0.5">
                </div>
                <div class="control-group">
                    <label for="exportLoopCount" class="control-label">loop count</label>
                    <input type="number" id="exportLoopCount" value="1" min="1" max="10" step="1">
                </div>
                <div class="control-group">
                    <label for="exportFormat" class="control-label">format</label>
                    <select id="exportFormat">
                        <option value="mp4" selected>MP4</option>
                        <option value="zip">ZIP (frames)</option>
                    </select>
                </div>
                <div class="control-group full-width">
                    <label for="exportQuality" class="control-label">video quality</label>
                    <select id="exportQuality">
                        <option value="low">low</option>
                        <option value="medium">medium</option>
                        <option value="high">high</option>
                        <option value="very high" selected>very high</option>
                        <option value="ultra">ultra</option>
                    </select>
                </div>
                <div class="control-group full-width">
                    <label for="exportPlayFrom" class="control-label">play from</label>
                    <select id="exportPlayFrom">
                        <option value="beginning" selected>beginning (reset state)</option>
                        <option value="current">current position</option>
                    </select>
                </div>
            </div>
            <div class="export-info-row">
                <div>total: <span id="exportTotalFrames">450 frames</span></div>
                <div>est. size: <span id="exportEstimatedSize">~12 MB</span></div>
            </div>
            <div class="export-warning-row">
                Video layers use best-effort frame seeking. Exported frames may vary slightly from live preview.
            </div>
            <div class="export-button-row">
                <button class="export-btn export-btn--primary" id="exportBeginBtn">begin export</button>
            </div>
        </div>
        <div id="exportProgressView" class="export-modal-content" style="display: none;">
            <div class="export-progress-container">
                <div class="export-progress-bar-container">
                    <div class="export-progress-bar" id="exportProgressBar"></div>
                </div>
                <div class="export-progress-text" id="exportProgressText">Frame 0 of 450</div>
                <div class="export-progress-time">
                    <div>elapsed: <span id="exportProgressElapsed">0:00</span></div>
                    <div>remaining: <span id="exportProgressRemaining">--:--</span></div>
                </div>
                <button class="export-progress-cancel" id="exportProgressCancelBtn">cancel export</button>
            </div>
        </div>
    </dialog>

    <!-- Export Image Dialog -->
    <dialog id="exportImageModal" aria-labelledby="exportImageModalTitle">
        <div class="export-modal-title">
            <span class="material-symbols-outlined" style="font-size: 18px;">image</span>
            <span id="exportImageModalTitle">export image</span>
            <button class="export-modal-close" id="exportImageCancelBtn">&#10005;</button>
        </div>
        <div class="export-modal-content">
            <div class="export-settings-grid">
                <div class="control-group">
                    <label for="exportImageWidth" class="control-label">width</label>
                    <input type="number" id="exportImageWidth" value="1024" min="64" max="8192" step="1">
                </div>
                <div class="control-group">
                    <label for="exportImageHeight" class="control-label">height</label>
                    <input type="number" id="exportImageHeight" value="1024" min="64" max="8192" step="1">
                </div>
                <div class="control-group">
                    <label for="exportImageFormat" class="control-label">format</label>
                    <select id="exportImageFormat">
                        <option value="png" selected>PNG</option>
                        <option value="jpg">JPEG</option>
                        <option value="webp">WebP</option>
                    </select>
                </div>
                <div class="control-group" id="exportImageQualityGroup">
                    <label for="exportImageQuality" class="control-label">quality</label>
                    <select id="exportImageQuality">
                        <option value="low">low</option>
                        <option value="medium">medium</option>
                        <option value="high" selected>high</option>
                        <option value="very high">very high</option>
                        <option value="maximum">maximum</option>
                    </select>
                </div>
            </div>
            <div class="export-button-row">
                <button class="export-btn export-btn--primary" id="exportImageBeginBtn">export</button>
            </div>
        </div>
    </dialog>

```

**Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: add export dialog HTML and menu items"
```

---

### Task 5: Create Export Image Dialog Controller

Port Noisedeck's `ExportImageMode` as a Layers module. Uses the Files class for saving. Shows toast on completion.

**Files:**
- Create: `public/js/ui/export-image-dialog.js`

**Step 1: Write the controller**

Create `public/js/ui/export-image-dialog.js`:

```js
/**
 * Export Image Dialog
 * Configurable resolution, format, and quality image export.
 * Ported from Noisedeck ExportImageMode.
 *
 * @module ui/export-image-dialog
 */

export class ExportImageDialog {
    constructor(options) {
        this.files = options.files
        this.canvas = options.canvas
        this.getResolution = options.getResolution
        this.setResolution = options.setResolution
        this.onComplete = options.onComplete || (() => {})
        this.onCancel = options.onCancel || (() => {})

        this.originalResolution = null
        this._dialog = null
        this._elements = {}

        this._handleKeydown = this._handleKeydown.bind(this)
        this._handleDialogClick = this._handleDialogClick.bind(this)
        this._handleExport = this._export.bind(this)
        this._handleCancel = this._cancel.bind(this)
        this._handleFormatChange = this._updateQualityVisibility.bind(this)
    }

    _cacheElements() {
        this._dialog = document.getElementById('exportImageModal')
        if (!this._dialog) return false

        this._elements = {
            widthInput: document.getElementById('exportImageWidth'),
            heightInput: document.getElementById('exportImageHeight'),
            formatSelect: document.getElementById('exportImageFormat'),
            qualitySelect: document.getElementById('exportImageQuality'),
            qualityGroup: document.getElementById('exportImageQualityGroup'),
            exportBtn: document.getElementById('exportImageBeginBtn'),
            cancelBtn: document.getElementById('exportImageCancelBtn')
        }
        return true
    }

    open() {
        if (!this._dialog && !this._cacheElements()) return

        this.originalResolution = this.getResolution()
        this._elements.widthInput.value = this.originalResolution.width
        this._elements.heightInput.value = this.originalResolution.height

        this._loadPreferences()
        this._updateQualityVisibility()
        this._setupEventListeners()
        this._dialog.showModal()
    }

    close() {
        if (this._dialog) {
            this._removeEventListeners()
            this._dialog.close()
        }
    }

    _setupEventListeners() {
        this._elements.exportBtn?.addEventListener('click', this._handleExport)
        this._elements.cancelBtn?.addEventListener('click', this._handleCancel)
        this._elements.formatSelect?.addEventListener('change', this._handleFormatChange)
        document.addEventListener('keydown', this._handleKeydown)
        this._dialog.addEventListener('click', this._handleDialogClick)
    }

    _removeEventListeners() {
        this._elements.exportBtn?.removeEventListener('click', this._handleExport)
        this._elements.cancelBtn?.removeEventListener('click', this._handleCancel)
        this._elements.formatSelect?.removeEventListener('change', this._handleFormatChange)
        document.removeEventListener('keydown', this._handleKeydown)
        this._dialog?.removeEventListener('click', this._handleDialogClick)
    }

    _handleKeydown(e) {
        if (e.key === 'Escape') {
            e.preventDefault()
            this._cancel()
        } else if (e.key === 'Enter' && !e.repeat) {
            e.preventDefault()
            this._export()
        }
    }

    _handleDialogClick(e) {
        if (e.target === this._dialog) {
            this._cancel()
        }
    }

    _updateQualityVisibility() {
        const format = this._elements.formatSelect?.value || 'png'
        if (this._elements.qualityGroup) {
            this._elements.qualityGroup.style.display = format === 'png' ? 'none' : ''
        }
    }

    _gatherSettings() {
        return {
            width: parseInt(this._elements.widthInput.value, 10) || 1024,
            height: parseInt(this._elements.heightInput.value, 10) || 1024,
            format: this._elements.formatSelect.value || 'png',
            quality: this._elements.qualitySelect.value || 'high'
        }
    }

    _qualityToValue(quality) {
        const qualityMap = {
            'low': 0.5,
            'medium': 0.75,
            'high': 0.9,
            'very high': 0.95,
            'maximum': 1.0
        }
        return qualityMap[quality] || 0.9
    }

    _ensureEven(value) {
        const floored = Math.floor(value)
        return Math.max(2, floored - (floored % 2))
    }

    async _export() {
        const settings = this._gatherSettings()
        this._savePreferences(settings)

        const width = this._ensureEven(settings.width)
        const height = this._ensureEven(settings.height)
        const needsResize = width !== this.originalResolution.width ||
                          height !== this.originalResolution.height

        try {
            if (needsResize) {
                this.setResolution(width, height)
                await new Promise(resolve => requestAnimationFrame(resolve))
                await new Promise(resolve => requestAnimationFrame(resolve))
            }

            const qualityValue = settings.format === 'png' ? 1.0 : this._qualityToValue(settings.quality)
            this.files.saveImage(this.canvas, settings.format, qualityValue)

            this.close()

            if (needsResize) {
                this.setResolution(this.originalResolution.width, this.originalResolution.height)
            }

            this.onComplete(settings.format)
        } catch (err) {
            console.error('Export image failed:', err)
            if (needsResize) {
                this.setResolution(this.originalResolution.width, this.originalResolution.height)
            }
        }
    }

    _cancel() {
        this.close()
        this.onCancel()
    }

    _savePreferences(settings) {
        try {
            localStorage.setItem('layers-export-image-prefs', JSON.stringify({
                format: settings.format,
                quality: settings.quality
            }))
        } catch (err) {
            // ignore
        }
    }

    _loadPreferences() {
        try {
            const saved = localStorage.getItem('layers-export-image-prefs')
            if (saved) {
                const prefs = JSON.parse(saved)
                if (prefs.format) this._elements.formatSelect.value = prefs.format
                if (prefs.quality) this._elements.qualitySelect.value = prefs.quality
            }
        } catch (err) {
            // ignore
        }
    }
}
```

**Step 2: Commit**

```bash
git add public/js/ui/export-image-dialog.js
git commit -m "feat: add export image dialog controller"
```

---

### Task 6: Create Export Video Dialog Controller

Port Noisedeck's `ExportMode` with video layer seeking logic. This is the most complex file — it needs to pause/resume the renderer, seek video elements frame-by-frame, and coordinate MP4/ZIP encoding.

**Files:**
- Create: `public/js/ui/export-video-dialog.js`

**Step 1: Write the controller**

Create `public/js/ui/export-video-dialog.js`:

```js
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
        this.renderer = options.renderer       // LayersRenderer instance
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

        // Pause renderer, capture current time
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

        // Resume renderer
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

        const currentRes = this.getResolution()
        this.originalResolution = { width: currentRes.width, height: currentRes.height }

        try {
            // Resize if needed
            if (settings.width !== currentRes.width || settings.height !== currentRes.height) {
                this.setResolution(settings.width, settings.height)
                await this._waitFrame()
            }

            // Seek video layers
            if (settings.playFrom === 'beginning') {
                await this._seekAllVideos(0)
            }

            // Init recording
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

            // Export loop
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

            // Calculate normalized time for shader pipeline
            const timeInLoop = targetTimeSec % exportDurationSec
            const baseNormalizedTime = timeInLoop / exportDurationSec
            const normalizedTime = (baseNormalizedTime + timeOffset) % 1

            // Seek video layers to this frame's time
            await this._seekAllVideos(targetTimeSec)

            // Upload video textures manually (loop is stopped)
            this._uploadVideoTextures()

            // Render at this normalized time
            this.renderer.render(normalizedTime)
            await this._waitFrame()

            // Encode frame
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

            // Update progress every 5 frames
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

        if (promises.length > 0) {
            await Promise.all(promises)
        }
    }

    _uploadVideoTextures() {
        // Manually update video textures since the RAF loop is stopped
        this.renderer._updateVideoTextures()
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

        if (this.state === 'preparing' || this.state === 'exporting') {
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
```

**Step 2: Commit**

```bash
git add public/js/ui/export-video-dialog.js
git commit -m "feat: add export video dialog controller with video seeking"
```

---

### Task 7: Wire Up in app.js

Import the new modules and connect them to the menu items.

**Files:**
- Modify: `public/js/app.js:1-30` (add imports)
- Modify: `public/js/app.js:251-269` (instantiate in `init()`)
- Modify: `public/js/app.js:1253-1259` (add menu handlers after saveJpg handler)

**Step 1: Add imports**

At the top of `public/js/app.js`, after the existing import block (after line 30), add:

```js
import { Files } from './utils/files.js'
import { ExportImageDialog } from './ui/export-image-dialog.js'
import { ExportVideoDialog } from './ui/export-video-dialog.js'
```

**Step 2: Instantiate in init()**

In the `init()` method, after the renderer is initialized and started (find the line after `this._renderer.start()` — search for it), add:

```js
        // Export system
        this._files = new Files()
        this._exportImageDialog = new ExportImageDialog({
            files: this._files,
            canvas: this._canvas,
            getResolution: () => ({ width: this._canvas.width, height: this._canvas.height }),
            setResolution: (w, h) => this._resizeCanvas(w, h),
            onComplete: (format) => toast.success(`Exported as ${format.toUpperCase()}`),
            onCancel: () => {}
        })
        this._exportVideoDialog = new ExportVideoDialog({
            files: this._files,
            renderer: this._renderer,
            canvas: this._canvas,
            getResolution: () => ({ width: this._canvas.width, height: this._canvas.height }),
            setResolution: (w, h) => this._resizeCanvas(w, h),
            onComplete: (format) => toast.success(`Exported as ${format.toUpperCase()}`),
            onCancel: () => {}
        })
```

**Step 3: Add menu handlers**

After the `saveJpgMenuItem` click handler (around line 1259), add:

```js
        // File menu - Export Image
        document.getElementById('exportImageMenuItem')?.addEventListener('click', () => {
            this._exportImageDialog.open()
        })

        // File menu - Export Video
        document.getElementById('exportVideoMenuItem')?.addEventListener('click', () => {
            this._exportVideoDialog.open()
        })
```

**Step 4: Commit**

```bash
git add public/js/app.js
git commit -m "feat: wire up export dialogs in app.js"
```

---

### Task 8: Write E2E Test for Export Image Dialog

Test that the export image dialog opens, shows correct defaults, and can be cancelled.

**Files:**
- Create: `tests/export-image.spec.js`

**Step 1: Write the test**

Create `tests/export-image.spec.js`:

```js
import { test, expect } from 'playwright/test'

test.describe('Export Image Dialog', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        // Create a solid base layer
        await page.waitForSelector('.open-dialog-backdrop.visible')
        await page.click('.media-option[data-type="solid"]')
        await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
        await page.click('.canvas-size-dialog .action-btn.primary')
        await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
        await page.waitForTimeout(500)
    })

    test('opens via menu and shows current canvas dimensions', async ({ page }) => {
        // Open File menu
        await page.click('.menu-title:has-text("file")')
        await page.click('#exportImageMenuItem')

        // Dialog should be visible
        const dialog = page.locator('#exportImageModal')
        await expect(dialog).toBeVisible()

        // Width/height should match canvas (1024x1024 default)
        const width = await page.locator('#exportImageWidth').inputValue()
        const height = await page.locator('#exportImageHeight').inputValue()
        expect(width).toBe('1024')
        expect(height).toBe('1024')
    })

    test('closes on cancel button', async ({ page }) => {
        await page.click('.menu-title:has-text("file")')
        await page.click('#exportImageMenuItem')

        await expect(page.locator('#exportImageModal')).toBeVisible()

        await page.click('#exportImageCancelBtn')
        await expect(page.locator('#exportImageModal')).not.toBeVisible()
    })

    test('closes on Escape key', async ({ page }) => {
        await page.click('.menu-title:has-text("file")')
        await page.click('#exportImageMenuItem')

        await expect(page.locator('#exportImageModal')).toBeVisible()

        await page.keyboard.press('Escape')
        await expect(page.locator('#exportImageModal')).not.toBeVisible()
    })

    test('hides quality for PNG, shows for JPEG', async ({ page }) => {
        await page.click('.menu-title:has-text("file")')
        await page.click('#exportImageMenuItem')

        // PNG is default — quality should be hidden
        const qualityGroup = page.locator('#exportImageQualityGroup')
        await expect(qualityGroup).toBeHidden()

        // Switch to JPEG
        await page.selectOption('#exportImageFormat', 'jpg')
        await expect(qualityGroup).toBeVisible()

        // Switch back to PNG
        await page.selectOption('#exportImageFormat', 'png')
        await expect(qualityGroup).toBeHidden()
    })
})
```

**Step 2: Run the test**

```bash
npx playwright test tests/export-image.spec.js
```

Expected: All 4 tests pass.

**Step 3: Commit**

```bash
git add tests/export-image.spec.js
git commit -m "test: add export image dialog E2E tests"
```

---

### Task 9: Write E2E Test for Export Video Dialog

Test that the export video dialog opens, shows settings, updates calculations, and can be cancelled.

**Files:**
- Create: `tests/export-video.spec.js`

**Step 1: Write the test**

Create `tests/export-video.spec.js`:

```js
import { test, expect } from 'playwright/test'

test.describe('Export Video Dialog', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 })

        // Create a solid base layer
        await page.waitForSelector('.open-dialog-backdrop.visible')
        await page.click('.media-option[data-type="solid"]')
        await page.waitForSelector('.canvas-size-dialog', { timeout: 5000 })
        await page.click('.canvas-size-dialog .action-btn.primary')
        await page.waitForSelector('.open-dialog-backdrop.visible', { state: 'hidden', timeout: 5000 })
        await page.waitForTimeout(500)
    })

    test('opens via menu and shows current canvas dimensions', async ({ page }) => {
        await page.click('.menu-title:has-text("file")')
        await page.click('#exportVideoMenuItem')

        const dialog = page.locator('#exportModal')
        await expect(dialog).toBeVisible()

        const width = await page.locator('#exportWidth').inputValue()
        const height = await page.locator('#exportHeight').inputValue()
        expect(width).toBe('1024')
        expect(height).toBe('1024')
    })

    test('shows settings view initially, not progress', async ({ page }) => {
        await page.click('.menu-title:has-text("file")')
        await page.click('#exportVideoMenuItem')

        await expect(page.locator('#exportDialogView')).toBeVisible()
        await expect(page.locator('#exportProgressView')).not.toBeVisible()
    })

    test('updates total frames when settings change', async ({ page }) => {
        await page.click('.menu-title:has-text("file")')
        await page.click('#exportVideoMenuItem')

        // Default: 30fps * 15s * 1 loop = 450 frames
        await expect(page.locator('#exportTotalFrames')).toHaveText('450 frames')

        // Change duration to 10
        await page.fill('#exportDuration', '10')
        await expect(page.locator('#exportTotalFrames')).toHaveText('300 frames')

        // Change framerate to 60
        await page.selectOption('#exportFramerate', '60')
        await expect(page.locator('#exportTotalFrames')).toHaveText('600 frames')
    })

    test('closes on cancel button', async ({ page }) => {
        await page.click('.menu-title:has-text("file")')
        await page.click('#exportVideoMenuItem')

        await expect(page.locator('#exportModal')).toBeVisible()

        await page.click('#exportCancelBtn')
        await expect(page.locator('#exportModal')).not.toBeVisible()
    })

    test('closes on Escape key', async ({ page }) => {
        await page.click('.menu-title:has-text("file")')
        await page.click('#exportVideoMenuItem')

        await expect(page.locator('#exportModal')).toBeVisible()

        await page.keyboard.press('Escape')
        await expect(page.locator('#exportModal')).not.toBeVisible()
    })

    test('pauses and resumes renderer', async ({ page }) => {
        // Verify renderer is running before dialog
        const runningBefore = await page.evaluate(() => window.layersApp._renderer.isRunning)
        expect(runningBefore).toBe(true)

        // Open dialog — renderer should pause
        await page.click('.menu-title:has-text("file")')
        await page.click('#exportVideoMenuItem')
        await page.waitForTimeout(100)

        const runningDuring = await page.evaluate(() => window.layersApp._renderer.isRunning)
        expect(runningDuring).toBe(false)

        // Close dialog — renderer should resume
        await page.keyboard.press('Escape')
        await page.waitForTimeout(100)

        const runningAfter = await page.evaluate(() => window.layersApp._renderer.isRunning)
        expect(runningAfter).toBe(true)
    })
})
```

**Step 2: Run the test**

```bash
npx playwright test tests/export-video.spec.js
```

Expected: All 6 tests pass.

**Step 3: Commit**

```bash
git add tests/export-video.spec.js
git commit -m "test: add export video dialog E2E tests"
```

---

### Task 10: Run Full Test Suite

Verify all existing tests still pass with the new changes.

**Step 1: Run all tests**

```bash
npm test
```

Expected: All tests pass (existing 21 + new 10 = ~31 specs).

**Step 2: Fix any failures**

If any existing tests fail, investigate and fix. Common issues:
- Menu clicks may need updated selectors if menu structure changed
- Dialog HTML may conflict with existing IDs (unlikely — all export IDs are unique)

**Step 3: Final commit if fixes were needed**

```bash
git add -A
git commit -m "fix: resolve test failures from export dialog integration"
```

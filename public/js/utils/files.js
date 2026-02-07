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

        this._initZipWorker()
        this._resetMP4State()

        this.videoPacketsAdded = 0
        this.videoPacketsAddFailed = 0
    }

    _initZipWorker() {
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

    _resetMP4State() {
        this.output = null
        this.videoSource = null
        this.mp4Target = null
        this.pendingVideoPacketPromise = Promise.resolve()
        this.videoEncoder = null
        this.startTime = null
        this.recording = false
        this.lastKeyFrame = null
        this.framesGenerated = 0
        this.ready = false
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
        const frame = new VideoFrame(canvas, {
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

        this._resetMP4State()
    }

    async cancelMP4() {
        try {
            this.videoEncoder?.close()
        } catch (error) {
            console.error('Error closing video encoder', error)
        }

        this._resetMP4State()
        this.currentFrame = 0
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
            this._initZipWorker()
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

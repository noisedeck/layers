/**
 * Layers Renderer - Wrapper around Noisemaker CanvasRenderer
 *
 * Manages a layer stack and builds DSL programs to composite
 * media and effects using Noisemaker's blendMode effect.
 *
 * @module noisemaker/renderer
 */

import { CanvasRenderer, extractEffectNamesFromDsl, getAllEffects } from './bundle.js'

/**
 * LayersRenderer - Main rendering class for Layers
 *
 * Manages:
 * - Layer stack (media + effects)
 * - Building DSL from layers
 * - Compilation and rendering
 *
 * @class
 */
export class LayersRenderer {
    /**
     * Create a new LayersRenderer
     * @param {HTMLCanvasElement} canvas - Target canvas element
     * @param {object} [options={}] - Configuration options
     * @param {number} [options.width=1024] - Render width
     * @param {number} [options.height=1024] - Render height
     * @param {number} [options.loopDuration=10] - Animation loop duration in seconds
     * @param {function} [options.onFPS] - Callback when FPS updates
     * @param {function} [options.onError] - Callback on render error
     */
    constructor(canvas, options = {}) {
        this._canvas = canvas
        this.width = options.width || canvas?.width || 1024
        this.height = options.height || canvas?.height || 1024
        this.loopDuration = options.loopDuration || 10

        // Create internal CanvasRenderer
        this._renderer = new CanvasRenderer({
            canvas: canvas,
            canvasContainer: canvas?.parentElement || null,
            width: this.width,
            height: this.height,
            basePath: '/js/noisemaker/vendor',
            preferWebGPU: false,
            useBundles: true,
            bundlePath: '/js/noisemaker/vendor/effects',
            alpha: true,
            onFPS: options.onFPS,
            onError: options.onError
        })

        // State
        this._initialized = false
        this._layers = []
        this._currentDsl = ''

        // Media textures (loaded from files)
        this._mediaTextures = new Map()

        // Text canvases for filter/text effects (layerId -> canvas state)
        this._textCanvases = new Map()

        // Video update loop RAF handle
        this._videoUpdateRAF = null

        // Layer to step index mapping (populated after compile)
        this._layerStepMap = new Map()
    }

    // =========================================================================
    // Public Getters
    // =========================================================================

    /** @returns {HTMLCanvasElement} Current canvas element */
    get canvas() {
        return this._renderer.canvas || this._canvas
    }

    /** @returns {boolean} Whether the render loop is running */
    get isRunning() {
        return this._renderer.isRunning
    }

    /** @returns {string} Current DSL source */
    get currentDsl() {
        return this._currentDsl
    }

    /** @returns {object} Effect manifest */
    get manifest() {
        return this._renderer.manifest
    }

    /** @returns {Array} Current layer stack */
    get layers() {
        return this._layers
    }

    // =========================================================================
    // Lifecycle
    // =========================================================================

    /**
     * Initialize the renderer (load manifest)
     * @returns {Promise<void>}
     */
    async init() {
        if (this._initialized) return

        await this._renderer.loadManifest()
        this._renderer.setLoopDuration(this.loopDuration)
        this._initialized = true
    }

    /**
     * Start the render loop
     */
    start() {
        this._startVideoUpdateLoop()
        this._renderer.start()
    }

    /**
     * Stop the render loop
     */
    stop() {
        this._stopVideoUpdateLoop()
        this._renderer.stop()
    }

    /**
     * Start the video texture update loop
     * @private
     */
    _startVideoUpdateLoop() {
        if (this._videoUpdateRAF) return

        const updateVideoTextures = () => {
            this._updateVideoTextures()
            this._videoUpdateRAF = requestAnimationFrame(updateVideoTextures)
        }
        this._videoUpdateRAF = requestAnimationFrame(updateVideoTextures)
    }

    /**
     * Stop the video texture update loop
     * @private
     */
    _stopVideoUpdateLoop() {
        if (this._videoUpdateRAF) {
            cancelAnimationFrame(this._videoUpdateRAF)
            this._videoUpdateRAF = null
        }
    }

    /**
     * Update all video textures for the current frame
     * @private
     */
    _updateVideoTextures() {
        const pipeline = this._renderer.pipeline
        if (!pipeline?.graph?.passes) return

        // Find all media effect passes
        const mediaStepIndices = []
        for (const pass of pipeline.graph.passes) {
            if (pass.effectFunc === 'media' || pass.effectKey === 'media') {
                mediaStepIndices.push(pass.stepIndex)
            }
        }
        const uniqueStepIndices = [...new Set(mediaStepIndices)]

        // Get visible media layers in order
        const visibleMediaLayers = this._layers.filter(l => l.visible && l.sourceType === 'media')

        // Update video textures
        for (let i = 0; i < visibleMediaLayers.length && i < uniqueStepIndices.length; i++) {
            const layer = visibleMediaLayers[i]
            const stepIndex = uniqueStepIndices[i]
            const media = this._mediaTextures.get(layer.id)

            if (!media || media.type !== 'video') continue

            const textureId = `imageTex_step_${stepIndex}`
            try {
                if (this._renderer.updateTextureFromSource) {
                    this._renderer.updateTextureFromSource(textureId, media.element, { flipY: false })
                }
            } catch (err) {
                // Silently ignore texture update errors during playback
            }
        }
    }

    /**
     * Resize the renderer
     * @param {number} width - New width
     * @param {number} height - New height
     */
    resize(width, height) {
        this.width = width
        this.height = height
        if (this._renderer.resize) {
            this._renderer.resize(width, height)
        }
    }

    /**
     * Render a single frame at a specific time
     * @param {number} normalizedTime - Time value 0-1
     */
    render(normalizedTime) {
        this._renderer.render(normalizedTime)
    }

    // =========================================================================
    // Layer Management
    // =========================================================================

    /**
     * Set the layer stack and rebuild DSL
     * @param {Array} layers - Array of layer objects
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async setLayers(layers) {
        this._layers = layers
        return this.rebuild()
    }

    /**
     * Rebuild DSL from current layers and recompile
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async rebuild() {
        if (!this._initialized) {
            await this.init()
        }

        if (this._layers.length === 0) {
            this._currentDsl = ''
            return { success: true }
        }

        try {
            // Build DSL from layers
            const dsl = this._buildDsl()

            // Skip recompilation if DSL hasn't changed
            if (dsl === this._currentDsl) {
                return { success: true }
            }

            this._currentDsl = dsl

            console.debug('[LayersRenderer] Built DSL:', dsl)

            // Extract and load required effects
            const effectData = extractEffectNamesFromDsl(dsl, this._renderer.manifest || {})
            const effectIds = effectData.map(e => e.effectId)

            // Filter out effects already loaded
            const registeredEffects = getAllEffects()
            const effectIdsToLoad = effectIds.filter(id => {
                const dotKey = id.replace('/', '.')
                return !registeredEffects.has(id) && !registeredEffects.has(dotKey)
            })

            if (effectIdsToLoad.length > 0) {
                await this._renderer.loadEffects(effectIdsToLoad)
            }

            // Compile the DSL
            await this._renderer.compile(dsl)

            // Build layer-to-step mapping after compile
            this._buildLayerStepMap()

            // Upload media textures after compile (pipeline must exist first)
            this._uploadMediaTextures()

            // Upload text textures for filter/text effects
            this._uploadTextTextures()

            // Apply initial parameter values
            this._applyAllLayerParams()

            return { success: true }
        } catch (err) {
            console.error('[LayersRenderer] Compilation error:', err)
            return {
                success: false,
                error: err.message || String(err)
            }
        }
    }

    /**
     * Build mapping from layer IDs to pipeline step indices
     * @private
     */
    _buildLayerStepMap() {
        this._layerStepMap.clear()

        const pipeline = this._renderer.pipeline
        if (!pipeline?.graph?.passes) return

        const visibleLayers = this._layers.filter(l => l.visible)

        // Track how many times we've seen each effect type
        const effectTypeCounts = {}

        for (const layer of visibleLayers) {
            let effectName = null

            if (layer.sourceType === 'effect') {
                effectName = layer.effectId?.split('/')[1]
            } else if (layer.sourceType === 'media') {
                effectName = 'media'
            }

            if (!effectName) continue

            // How many of this effect type have we seen before?
            const seenCount = effectTypeCounts[effectName] || 0
            effectTypeCounts[effectName] = seenCount + 1

            // Find the Nth occurrence of this effect in the pipeline
            let matchCount = 0
            for (const pass of pipeline.graph.passes) {
                if (pass.effectFunc === effectName || pass.effectKey === effectName) {
                    if (matchCount === seenCount) {
                        this._layerStepMap.set(layer.id, pass.stepIndex)
                        break
                    }
                    matchCount++
                }
            }
        }

    }

    /**
     * Update parameters for a specific layer without recompiling
     * @param {string} layerId - Layer ID
     * @param {object} params - Parameter values to update
     */
    updateLayerParams(layerId, params) {
        const stepIndex = this._layerStepMap.get(layerId)
        if (stepIndex === undefined) {
            console.warn(`[LayersRenderer] No step index for layer ${layerId}`)
            return
        }

        const stepKey = `step_${stepIndex}`
        const stepParams = { [stepKey]: params }

        if (this._renderer.applyStepParameterValues) {
            this._renderer.applyStepParameterValues(stepParams)
        }

        // If this is a text effect, re-render the text texture
        const layer = this._layers.find(l => l.id === layerId)
        if (layer && this._isTextEffect(layer.effectId)) {
            // Merge with existing params to get full state
            const fullParams = { ...(layer.effectParams || {}), ...params }
            this._renderTextCanvas(layerId, fullParams)
        }
    }

    /**
     * Update the DSL string from current layers without recompiling.
     * Call this after parameter-only changes to keep DSL in sync and
     * prevent spurious rebuilds on subsequent structural changes.
     */
    syncDsl() {
        if (this._layers.length > 0) {
            this._currentDsl = this._buildDsl()
        }
    }

    /**
     * Update opacity for a layer (updates blendMode mixAmt)
     * @param {string} layerId - Layer ID
     * @param {number} opacity - Opacity 0-100
     */
    updateLayerOpacity(layerId, opacity) {
        // Opacity is applied via blendMode's mixAmt parameter
        const pipeline = this._renderer.pipeline
        if (!pipeline?.graph?.passes) return

        const layer = this._layers.find(l => l.id === layerId)
        if (!layer) return

        const visibleLayers = this._layers.filter(l => l.visible)
        const layerIndex = visibleLayers.indexOf(layer)
        if (layerIndex < 0) return

        // Check if base layer is a solid (which doesn't use blendMode for opacity)
        const baseLayer = visibleLayers[0]
        const baseSolid = baseLayer?.effectId === 'synth/solid'

        // Find the blendMode pass for this layer
        const blendPasses = pipeline.graph.passes.filter(p =>
            p.effectFunc === 'blendMode' || p.effectKey === 'blendMode'
        )

        // Calculate blend pass index:
        // - If base is solid: it has no blend pass, so non-base layers use index-1
        // - If base is not solid: all layers have blend passes, use index directly
        let blendPassIndex
        if (baseSolid) {
            // Solid base has no blend pass, skip it
            blendPassIndex = layerIndex - 1
        } else {
            // All layers including base have blend passes
            blendPassIndex = layerIndex
        }

        if (blendPassIndex >= 0 && blendPassIndex < blendPasses.length) {
            const blendPass = blendPasses[blendPassIndex]
            const mixAmt = this._opacityToMixAmt(opacity)
            const stepKey = `step_${blendPass.stepIndex}`

            if (this._renderer.applyStepParameterValues) {
                this._renderer.applyStepParameterValues({
                    [stepKey]: { mixAmt }
                })
            }
        }
    }

    /**
     * Apply all layer parameters to the pipeline
     * @private
     */
    _applyAllLayerParams() {
        for (const layer of this._layers) {
            const isBase = this._layers.indexOf(layer) === 0
            const isBaseSolid = isBase && layer.effectId === 'synth/solid'

            // Apply effect params for both effect and media layers
            if (layer.effectParams && Object.keys(layer.effectParams).length > 0) {
                // For base layer solid, skip alpha param (already baked into DSL with opacity)
                if (isBaseSolid) {
                    const paramsWithoutAlpha = { ...layer.effectParams }
                    delete paramsWithoutAlpha.alpha
                    if (Object.keys(paramsWithoutAlpha).length > 0) {
                        this.updateLayerParams(layer.id, paramsWithoutAlpha)
                    }
                } else {
                    this.updateLayerParams(layer.id, layer.effectParams)
                }
            }
            // Apply opacity via blendMode for all layers except base solid
            // (base solid uses alpha parameter, all others use blendMode)
            if (layer.visible && !isBaseSolid) {
                this.updateLayerOpacity(layer.id, layer.opacity)
            }
        }
    }

    /**
     * Upload all media textures to the renderer
     * @private
     */
    _uploadMediaTextures() {
        // Get the pipeline to find step indices for media effects
        const pipeline = this._renderer.pipeline
        if (!pipeline?.graph?.passes) {
            console.warn('[LayersRenderer] No pipeline graph, cannot upload textures')
            return
        }

        // Find all media effect passes and their step indices
        const mediaStepIndices = []
        for (const pass of pipeline.graph.passes) {
            // Check if this pass is from a 'media' effect
            if (pass.effectFunc === 'media' || pass.effectKey === 'media') {
                mediaStepIndices.push(pass.stepIndex)
            }
        }
        
        // Deduplicate (multiple passes may have same stepIndex)
        const uniqueStepIndices = [...new Set(mediaStepIndices)]

        // Get visible media layers in order (should match DSL generation order)
        const visibleMediaLayers = this._layers.filter(l => l.visible && l.sourceType === 'media')

        // Collect step parameter updates for imageSize
        const stepParameterValues = {}

        // Match layers to step indices and upload textures
        for (let i = 0; i < visibleMediaLayers.length && i < uniqueStepIndices.length; i++) {
            const layer = visibleMediaLayers[i]
            const stepIndex = uniqueStepIndices[i]
            const media = this._mediaTextures.get(layer.id)

            if (!media) {
                console.warn(`[LayersRenderer] No media loaded for layer ${layer.id}`)
                continue
            }

            // The texture ID format expected by the pipeline is: imageTex_step_N
            const textureId = `imageTex_step_${stepIndex}`

            try {
                if (this._renderer.updateTextureFromSource) {
                    this._renderer.updateTextureFromSource(textureId, media.element, { flipY: false })
                }
                
                // Set imageSize uniform for this media step
                if (media.width > 0 && media.height > 0) {
                    const stepKey = `step_${stepIndex}`
                    stepParameterValues[stepKey] = {
                        imageSize: [media.width, media.height]
                    }
                }
            } catch (err) {
                console.warn(`[LayersRenderer] Failed to upload texture ${textureId}:`, err)
            }
        }

        // Apply all step parameter updates at once
        if (Object.keys(stepParameterValues).length > 0 && this._renderer.applyStepParameterValues) {
            this._renderer.applyStepParameterValues(stepParameterValues)
        }
    }

    /**
     * Load media from a File object
     * @param {string} layerId - Layer ID
     * @param {File} file - Media file
     * @param {string} mediaType - 'image' or 'video'
     * @returns {Promise<void>}
     */
    async loadMedia(layerId, file, mediaType) {
        const url = URL.createObjectURL(file)
        let width = 0
        let height = 0

        if (mediaType === 'image') {
            const img = new Image()
            await new Promise((resolve, reject) => {
                img.onload = resolve
                img.onerror = reject
                img.src = url
            })
            width = img.naturalWidth || img.width
            height = img.naturalHeight || img.height
            this._mediaTextures.set(layerId, { type: 'image', element: img, url, width, height })
        } else if (mediaType === 'video') {
            const video = document.createElement('video')
            video.loop = true
            video.muted = true
            video.playsInline = true
            video.crossOrigin = 'anonymous'
            await new Promise((resolve, reject) => {
                video.onloadedmetadata = resolve
                video.onerror = () => {
                    const mediaError = video.error
                    const message = mediaError
                        ? `Video error: ${mediaError.message || 'Code ' + mediaError.code}`
                        : 'Unknown video error'
                    reject(new Error(message))
                }
                video.src = url
                video.load()
            })
            width = video.videoWidth
            height = video.videoHeight
            this._mediaTextures.set(layerId, { type: 'video', element: video, url, width, height })

            // Start playback - await to catch autoplay policy errors
            try {
                await video.play()
            } catch (playError) {
                console.warn('[LayersRenderer] Video autoplay blocked:', playError.message)
                // Video is still loaded, user interaction may start it later
            }
        }
        
        return { width, height }
    }

    /**
     * Unload media for a layer
     * @param {string} layerId - Layer ID
     */
    unloadMedia(layerId) {
        const media = this._mediaTextures.get(layerId)
        if (media) {
            if (media.url) {
                URL.revokeObjectURL(media.url)
            }
            if (media.type === 'video' && media.element) {
                media.element.pause()
                media.element.src = ''
            }
            this._mediaTextures.delete(layerId)
        }
    }

    // =========================================================================
    // Text Texture Management
    // =========================================================================

    /**
     * Check if an effect requires a text texture
     * @param {string} effectId - Effect ID
     * @returns {boolean}
     * @private
     */
    _isTextEffect(effectId) {
        if (!effectId) return false
        const manifest = this._renderer.manifest || {}
        const entry = manifest[effectId]
        return entry?.externalTexture === 'textTex'
    }

    /**
     * Initialize and upload text textures for all text effect layers
     * @private
     */
    _uploadTextTextures() {
        const pipeline = this._renderer.pipeline
        if (!pipeline?.graph?.passes) return

        // Find all filter/text effect passes (filter namespace with text func)
        const textPasses = []
        for (const pass of pipeline.graph.passes) {
            if (pass.effectNamespace === 'filter' && pass.effectFunc === 'text') {
                textPasses.push(pass.stepIndex)
            }
        }
        const uniqueStepIndices = [...new Set(textPasses)]

        // Get visible text effect layers
        const textLayers = this._layers.filter(l =>
            l.visible && l.sourceType === 'effect' && this._isTextEffect(l.effectId)
        )

        // Match layers to step indices
        for (let i = 0; i < textLayers.length && i < uniqueStepIndices.length; i++) {
            const layer = textLayers[i]
            const stepIndex = uniqueStepIndices[i]

            // Create canvas if needed
            if (!this._textCanvases.has(layer.id)) {
                const canvas = document.createElement('canvas')
                this._textCanvases.set(layer.id, {
                    canvas,
                    stepIndex
                })
            } else {
                // Update step index
                const state = this._textCanvases.get(layer.id)
                state.stepIndex = stepIndex
            }

            // Render text to canvas and upload
            this._renderTextCanvas(layer.id, layer.effectParams || {})
        }
    }

    /**
     * Render text to canvas and upload as texture
     * @param {string} layerId - Layer ID
     * @param {object} params - Text parameters
     * @private
     */
    _renderTextCanvas(layerId, params) {
        const state = this._textCanvases.get(layerId)
        if (!state || !this._renderer.pipeline) return

        const canvas = state.canvas
        const resolution = this.width

        canvas.width = resolution
        canvas.height = resolution

        const ctx = canvas.getContext('2d')

        // Parse parameters with defaults
        const text = String(params.text || 'Hello World')
        const font = params.font || 'Nunito'
        const size = params.size ?? 0.1
        const posX = params.posX ?? 0.5
        const posY = params.posY ?? 0.5
        const rotation = params.rotation ?? 0
        const color = params.color || '#ffffff'
        const bgColor = params.bgColor || '#000000'
        const bgOpacity = params.bgOpacity ?? 0
        const justify = params.justify || 'center'

        // Clear and draw background
        ctx.clearRect(0, 0, canvas.width, canvas.height)

        if (bgOpacity > 0) {
            const bgRgb = this._hexToRgb(bgColor)
            ctx.fillStyle = `rgba(${Math.round(bgRgb[0] * 255)}, ${Math.round(bgRgb[1] * 255)}, ${Math.round(bgRgb[2] * 255)}, ${bgOpacity})`
            ctx.fillRect(0, 0, canvas.width, canvas.height)
        }

        // Draw text
        const lines = text.split('\n')
        const fontSize = Math.round(size * canvas.height)
        const lineHeight = fontSize * 1.2
        const textRgb = this._hexToRgb(color)
        const rotationRad = rotation * Math.PI / 180

        ctx.font = `${fontSize}px ${font}`
        ctx.textAlign = justify
        ctx.textBaseline = 'middle'
        ctx.fillStyle = `rgba(${Math.round(textRgb[0] * 255)}, ${Math.round(textRgb[1] * 255)}, ${Math.round(textRgb[2] * 255)}, 1)`

        const x = posX * canvas.width
        const y = posY * canvas.height

        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(rotationRad)

        const totalHeight = (lines.length - 1) * lineHeight
        const startY = -totalHeight / 2

        for (let i = 0; i < lines.length; i++) {
            const lineY = startY + i * lineHeight
            ctx.fillText(lines[i], 0, lineY)
        }

        ctx.restore()

        // Upload texture
        const textureId = `textTex_step_${state.stepIndex}`
        try {
            if (this._renderer.updateTextureFromSource) {
                this._renderer.updateTextureFromSource(textureId, canvas, { flipY: true })
            }
        } catch (err) {
            console.warn(`[LayersRenderer] Failed to upload text texture ${textureId}:`, err)
        }
    }

    /**
     * Parse hex color to RGB array (0-1 range)
     * @param {string|Array} hex - Hex color string or RGB array
     * @returns {number[]} RGB values 0-1
     * @private
     */
    _hexToRgb(hex) {
        if (Array.isArray(hex)) {
            return hex.slice(0, 3)
        }
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
        return result ? [
            parseInt(result[1], 16) / 255,
            parseInt(result[2], 16) / 255,
            parseInt(result[3], 16) / 255
        ] : [1, 1, 1]
    }

    /**
     * Update text texture for a layer when parameters change
     * @param {string} layerId - Layer ID
     * @param {object} params - Updated text parameters
     */
    updateTextParams(layerId, params) {
        const layer = this._layers.find(l => l.id === layerId)
        if (!layer || !this._isTextEffect(layer.effectId)) return

        if (this._textCanvases.has(layerId)) {
            this._renderTextCanvas(layerId, params)
        }
    }

    // =========================================================================
    // DSL Building
    // =========================================================================

    /**
     * Build DSL from the current layer stack
     * @returns {string} DSL program
     * @private
     */
    _buildDsl() {
        const visibleLayers = this._layers.filter(l => l.visible)

        if (visibleLayers.length === 0) {
            return 'search synth\n\nsolid(color: #000000, alpha: 0).write(o0)\n\nrender(o0)'
        }

        // Collect namespaces used by effect layers
        const usedNamespaces = new Set(['synth', 'mixer']) // Always need synth for solid/media, mixer for blendMode
        for (const layer of visibleLayers) {
            if (layer.sourceType === 'effect' && layer.effectId) {
                const [namespace] = layer.effectId.split('/')
                usedNamespaces.add(namespace)
            }
        }

        const lines = []
        lines.push(`search ${[...usedNamespaces].join(', ')}`)
        lines.push('')

        let currentOutput = 0 // Track which output buffer we're using

        // Process each visible layer from bottom to top
        for (let i = 0; i < visibleLayers.length; i++) {
            const layer = visibleLayers[i]
            const isBase = i === 0

            lines.push('')

            if (isBase) {
                // Base layer - handle opacity via alpha or blending
                const baseAlpha = layer.opacity / 100

                if (layer.sourceType === 'effect' && layer.effectId === 'synth/solid') {
                    // Solid base - use alpha parameter for opacity
                    const params = layer.effectParams || {}
                    const color = params.color || [0.5, 0.5, 0.5]
                    const effectAlpha = (params.alpha !== undefined ? params.alpha : 1) * baseAlpha
                    const toHex = (v) => Math.round(v * 255).toString(16).padStart(2, '0')
                    const hex = `#${toHex(color[0])}${toHex(color[1])}${toHex(color[2])}`
                    lines.push(`solid(color: ${hex}, alpha: ${effectAlpha.toFixed(4)}).write(o${currentOutput})`)
                } else if (layer.sourceType === 'media') {
                    // Media base - blend over transparent background for opacity support
                    lines.push(`solid(color: #000000, alpha: 0).write(o${currentOutput})`)
                    lines.push(`media().write(o${currentOutput + 1})`)
                    const mixAmt = this._opacityToMixAmt(layer.opacity)
                    lines.push(`read(o${currentOutput}).blendMode(tex: read(o${currentOutput + 1}), mode: ${layer.blendMode}, mixAmt: ${mixAmt}).write(o${currentOutput + 2})`)
                    currentOutput += 2
                } else if (layer.sourceType === 'effect') {
                    // Other synth effect as base - blend over transparent background for opacity
                    const effectCall = this._buildEffectCall(layer)
                    lines.push(`solid(color: #000000, alpha: 0).write(o${currentOutput})`)
                    lines.push(`${effectCall}.write(o${currentOutput + 1})`)
                    const mixAmt = this._opacityToMixAmt(layer.opacity)
                    lines.push(`read(o${currentOutput}).blendMode(tex: read(o${currentOutput + 1}), mode: ${layer.blendMode}, mixAmt: ${mixAmt}).write(o${currentOutput + 2})`)
                    currentOutput += 2
                }
            } else {
                // Non-base layers - blend with previous
                const prevOutput = currentOutput
                currentOutput++
                const mixAmt = this._opacityToMixAmt(layer.opacity)

                if (layer.sourceType === 'media') {
                    lines.push(`media().write(o${currentOutput})`)
                } else if (layer.sourceType === 'effect') {
                    const effectCall = this._buildEffectCall(layer)
                    const isSynth = this._isEffectSynth(layer.effectId)

                    if (isSynth) {
                        lines.push(`${effectCall}.write(o${currentOutput})`)
                    } else {
                        lines.push(`read(o${prevOutput}).${effectCall}.write(o${currentOutput})`)
                    }
                }

                const nextOutput = currentOutput + 1
                lines.push(`read(o${prevOutput}).blendMode(tex: read(o${currentOutput}), mode: ${layer.blendMode}, mixAmt: ${mixAmt}).write(o${nextOutput})`)
                currentOutput = nextOutput
            }
        }

        lines.push('')
        lines.push(`render(o${currentOutput})`)

        return lines.join('\n')
    }

    /**
     * Build an effect call string from a layer
     * @param {object} layer - Layer object
     * @returns {string} Effect call DSL
     * @private
     */
    _buildEffectCall(layer) {
        const effectId = layer.effectId
        if (!effectId) return 'noise()'

        // Extract effect name from ID (namespace/name -> name)
        const parts = effectId.split('/')
        const effectName = parts[parts.length - 1]

        // Build parameter string
        const params = layer.effectParams || {}
        const paramPairs = Object.entries(params)
            .map(([key, value]) => {
                if (typeof value === 'string') {
                    return `${key}: "${value}"`
                }
                if (Array.isArray(value)) {
                    // Use vec constructors for array types (vec2, vec3, vec4)
                    const vecType = `vec${value.length}`
                    return `${key}: ${vecType}(${value.join(', ')})`
                }
                return `${key}: ${value}`
            })

        if (paramPairs.length > 0) {
            return `${effectName}(${paramPairs.join(', ')})`
        }

        return `${effectName}()`
    }

    /**
     * Convert layer opacity (0-100) to blendMode mixAmt (-100 to 100)
     * 100% opacity = mixAmt 100 (full effect)
     * 50% opacity = mixAmt 0 (50/50 blend)
     * 0% opacity = mixAmt -100 (invisible)
     * @param {number} opacity - Opacity 0-100
     * @returns {number} mixAmt -100 to 100
     * @private
     */
    _opacityToMixAmt(opacity) {
        return (opacity - 50) * 2
    }

    /**
     * Check if an effect can generate content standalone (synth) vs needs input (filter)
     * @param {string} effectId - Effect ID like 'filter/blur'
     * @returns {boolean} True if effect is a synth, false if it's a filter
     * @private
     */
    _isEffectSynth(effectId) {
        if (!effectId) return true
        const manifest = this._renderer.manifest || {}
        const entry = manifest[effectId]
        // Starter effects and synth namespace effects can generate content standalone
        if (entry && entry.starter) return true
        const [namespace] = effectId.split('/')
        return namespace === 'synth' || namespace === 'synth3d'
    }

    // =========================================================================
    // Effect Library
    // =========================================================================

    /**
     * Check if a namespace should be hidden from the UI
     * @param {string} namespace - Namespace to check
     * @param {Array<string>} hiddenList - List of namespaces to hide
     * @returns {boolean} True if namespace should be hidden
     * @private
     */
    _isHiddenNamespace(namespace, hiddenList) {
        return hiddenList.includes(namespace) ||
            namespace.startsWith('classic') ||
            namespace.includes('3d')
    }

    /**
     * Sort effects by namespace then name
     * @param {Array} effects - Effects array to sort
     * @private
     */
    _sortEffects(effects) {
        effects.sort((a, b) => {
            if (a.namespace !== b.namespace) {
                return a.namespace.localeCompare(b.namespace)
            }
            return a.name.localeCompare(b.name)
        })
    }

    /**
     * Get all starter effects from manifest
     * @returns {Array<{effectId: string, namespace: string, name: string, description?: string, tags?: string[]}>}
     */
    getStarterEffects() {
        const manifest = this._renderer.manifest || {}
        const effects = []
        const hiddenNamespaces = ['3d', 'points', 'render', 'synth', 'synth3d', 'mixer', 'filter3d']

        for (const [effectId, entry] of Object.entries(manifest)) {
            if (!entry.starter) continue

            const [namespace, name] = effectId.split('/')
            if (this._isHiddenNamespace(namespace, hiddenNamespaces)) continue

            effects.push({
                effectId,
                namespace,
                name,
                description: entry.description || '',
                tags: entry.tags || []
            })
        }

        this._sortEffects(effects)
        return effects
    }

    /**
     * Get all effects from manifest
     * @returns {Array<{effectId: string, namespace: string, name: string, description?: string, tags?: string[]}>}
     */
    getAllEffects() {
        const manifest = this._renderer.manifest || {}
        const effects = []
        const hiddenNamespaces = ['3d', 'points', 'render', 'synth', 'synth3d', 'mixer', 'filter3d']

        for (const [effectId, entry] of Object.entries(manifest)) {
            const [namespace, name] = effectId.split('/')
            if (this._isHiddenNamespace(namespace, hiddenNamespaces)) continue

            effects.push({
                effectId,
                namespace,
                name,
                description: entry.description || '',
                tags: entry.tags || [],
                starter: entry.starter || false
            })
        }

        this._sortEffects(effects)
        return effects
    }

    /**
     * Get effects suitable for layers (non-starter, non-mixer effects)
     * These are filter/processing effects that work on existing content
     * @returns {Array<{effectId: string, namespace: string, name: string, description?: string, tags?: string[]}>}
     */
    getLayerEffects() {
        const manifest = this._renderer.manifest || {}
        const effects = []
        const excludedNamespaces = ['synth', 'synth3d', 'mixer', 'points', 'render', '3d', 'filter3d']

        for (const [effectId, entry] of Object.entries(manifest)) {
            if (entry.starter) continue

            const [namespace, name] = effectId.split('/')
            if (this._isHiddenNamespace(namespace, excludedNamespaces)) continue

            effects.push({
                effectId,
                namespace,
                name,
                description: entry.description || '',
                tags: entry.tags || []
            })
        }

        this._sortEffects(effects)
        return effects
    }

    /**
     * Get effect definition by ID (loads if needed)
     * @param {string} effectId - Effect ID (namespace/name)
     * @returns {Promise<object|null>} Effect definition with globals, or null if not found
     */
    async getEffectDefinition(effectId) {
        if (!effectId) return null

        try {
            // Load the effect (this registers it too)
            const effect = await this._renderer.loadEffect(effectId)
            return effect?.instance || null
        } catch (err) {
            console.warn(`[LayersRenderer] Failed to load effect ${effectId}:`, err)
            return null
        }
    }
}

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
            onFPS: options.onFPS,
            onError: options.onError
        })

        // State
        this._initialized = false
        this._layers = []
        this._currentDsl = ''

        // Media textures (loaded from files)
        this._mediaTextures = new Map()
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
        this._renderer.start()
    }

    /**
     * Stop the render loop
     */
    stop() {
        this._renderer.stop()
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
            this._currentDsl = dsl

            console.log('[LayersRenderer] Built DSL:', dsl)

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

            // Upload media textures after compile (pipeline must exist first)
            this._uploadMediaTextures()

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
        console.log('[LayersRenderer] Found media step indices:', uniqueStepIndices)

        // Get visible media layers in order (should match DSL generation order)
        const visibleMediaLayers = this._layers.filter(l => l.visible && l.sourceType === 'media')

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
            console.log(`[LayersRenderer] Uploading texture ${textureId} for layer ${layer.id}`)

            try {
                if (this._renderer.updateTextureFromSource) {
                    this._renderer.updateTextureFromSource(textureId, media.element, { flipY: true })
                }
            } catch (err) {
                console.warn(`[LayersRenderer] Failed to upload texture ${textureId}:`, err)
            }
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

        if (mediaType === 'image') {
            const img = new Image()
            await new Promise((resolve, reject) => {
                img.onload = resolve
                img.onerror = reject
                img.src = url
            })
            this._mediaTextures.set(layerId, { type: 'image', element: img, url })
        } else if (mediaType === 'video') {
            const video = document.createElement('video')
            video.loop = true
            video.muted = true
            video.playsInline = true
            await new Promise((resolve, reject) => {
                video.onloadeddata = resolve
                video.onerror = reject
                video.src = url
            })
            video.play()
            this._mediaTextures.set(layerId, { type: 'video', element: video, url })
        }
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
            return 'search synth\n\nsolid(r: 0, g: 0, b: 0).write(o0)\n\nrender(o0)'
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

            if (layer.sourceType === 'media') {
                // Media layer - use media() effect
                // The external texture is bound via imageTex after compilation

                if (isBase) {
                    // Base layer - just write to output
                    lines.push(`media().write(o${currentOutput})`)
                } else {
                    // Non-base media layer - blend with previous
                    const prevOutput = currentOutput
                    currentOutput++
                    const mixAmt = this._opacityToMixAmt(layer.opacity)

                    lines.push('')
                    lines.push(`media().write(o${currentOutput})`)

                    const nextOutput = currentOutput + 1
                    lines.push(`read(o${prevOutput}).blendMode(tex: read(o${currentOutput}), mode: ${layer.blendMode}, mixAmt: ${mixAmt}).write(o${nextOutput})`)
                    currentOutput = nextOutput
                }
            } else if (layer.sourceType === 'effect') {
                // Effect layer
                const effectCall = this._buildEffectCall(layer)
                const isSynth = this._isEffectSynth(layer.effectId)

                if (isBase) {
                    // Base layer - effect must be a synth to work as base
                    if (isSynth) {
                        lines.push(`${effectCall}.write(o${currentOutput})`)
                    } else {
                        // Filter as base - generate solid color first, then apply filter
                        lines.push(`solid(r: 0, g: 0, b: 0).${effectCall}.write(o${currentOutput})`)
                    }
                } else {
                    // Non-base layer
                    const prevOutput = currentOutput
                    currentOutput++
                    const mixAmt = this._opacityToMixAmt(layer.opacity)

                    lines.push('')

                    if (isSynth) {
                        // Synth effect - generate independently then blend
                        lines.push(`${effectCall}.write(o${currentOutput})`)
                    } else {
                        // Filter effect - apply to previous output then blend
                        lines.push(`read(o${prevOutput}).${effectCall}.write(o${currentOutput})`)
                    }

                    const nextOutput = currentOutput + 1
                    lines.push(`read(o${prevOutput}).blendMode(tex: read(o${currentOutput}), mode: ${layer.blendMode}, mixAmt: ${mixAmt}).write(o${nextOutput})`)
                    currentOutput = nextOutput
                }
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
     * Get all starter effects from manifest
     * @returns {Array<{effectId: string, namespace: string, name: string, description?: string, tags?: string[]}>}
     */
    getStarterEffects() {
        const manifest = this._renderer.manifest || {}
        const effects = []

        for (const [effectId, entry] of Object.entries(manifest)) {
            if (entry.starter) {
                const [namespace, name] = effectId.split('/')
                effects.push({
                    effectId,
                    namespace,
                    name,
                    description: entry.description || '',
                    tags: entry.tags || []
                })
            }
        }

        // Sort by namespace then name
        effects.sort((a, b) => {
            if (a.namespace !== b.namespace) {
                return a.namespace.localeCompare(b.namespace)
            }
            return a.name.localeCompare(b.name)
        })

        return effects
    }

    /**
     * Get all effects from manifest
     * @returns {Array<{effectId: string, namespace: string, name: string, description?: string, tags?: string[]}>}
     */
    getAllEffects() {
        const manifest = this._renderer.manifest || {}
        const effects = []

        for (const [effectId, entry] of Object.entries(manifest)) {
            const [namespace, name] = effectId.split('/')
            effects.push({
                effectId,
                namespace,
                name,
                description: entry.description || '',
                tags: entry.tags || [],
                starter: entry.starter || false
            })
        }

        // Sort by namespace then name
        effects.sort((a, b) => {
            if (a.namespace !== b.namespace) {
                return a.namespace.localeCompare(b.namespace)
            }
            return a.name.localeCompare(b.name)
        })

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

        // Namespaces to exclude (starters generate content, mixers need two inputs)
        const excludedNamespaces = ['synth', 'synth3d', 'mixer', 'points', 'render']

        for (const [effectId, entry] of Object.entries(manifest)) {
            const [namespace, name] = effectId.split('/')

            // Skip excluded namespaces
            if (excludedNamespaces.includes(namespace)) {
                continue
            }

            // Skip starter effects (they generate content, not process it)
            if (entry.starter) {
                continue
            }

            effects.push({
                effectId,
                namespace,
                name,
                description: entry.description || '',
                tags: entry.tags || []
            })
        }

        // Sort by namespace then name
        effects.sort((a, b) => {
            if (a.namespace !== b.namespace) {
                return a.namespace.localeCompare(b.namespace)
            }
            return a.name.localeCompare(b.name)
        })

        return effects
    }
}

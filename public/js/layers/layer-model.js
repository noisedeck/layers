/**
 * Layer Model
 * Data structures for layers
 *
 * @module layers/layer-model
 */

let layerCounter = 0

/**
 * Convert camelCase to Human Case (Title Case with spaces)
 * @param {string} str - Input string in camelCase
 * @returns {string} Human-readable string
 */
function camelToHumanCase(str) {
    return str
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
        .replace(/^./, c => c.toUpperCase())
}

/**
 * Create a new layer object
 * @param {object} options - Layer options
 * @returns {object} Layer object
 */
export function createLayer(options = {}) {
    const id = options.id || `layer-${layerCounter++}`

    return {
        id,
        name: options.name || 'Untitled',
        visible: options.visible !== false,
        opacity: options.opacity ?? 100,
        blendMode: options.blendMode || 'mix',
        locked: options.locked || false,
        offsetX: options.offsetX || 0,
        offsetY: options.offsetY || 0,
        sourceType: options.sourceType || 'media', // 'media' | 'effect'

        // Media-specific
        mediaFile: options.mediaFile || null,
        mediaType: options.mediaType || null, // 'image' | 'video'

        // Effect-specific
        effectId: options.effectId || null,
        effectParams: options.effectParams || {},

        // Child effects (per-layer filter chain)
        children: options.children || []
    }
}

/**
 * Create a media layer
 * @param {File} file - Media file
 * @param {string} mediaType - 'image' or 'video'
 * @param {string} [name] - Layer name
 * @returns {object} Layer object
 */
export function createMediaLayer(file, mediaType, name) {
    return createLayer({
        name: name || file.name.replace(/\.[^.]+$/, ''),
        sourceType: 'media',
        mediaFile: file,
        mediaType
    })
}

/**
 * Create an effect layer
 * @param {string} effectId - Effect ID (namespace/name)
 * @param {string} [name] - Layer name
 * @param {object} [params] - Effect parameters
 * @returns {object} Layer object
 */
export function createEffectLayer(effectId, name, params = {}) {
    const effectName = effectId.split('/').pop()
    return createLayer({
        name: name || camelToHumanCase(effectName),
        sourceType: 'effect',
        effectId,
        effectParams: params
    })
}

/**
 * Create a child effect object (lightweight, no blend/opacity/media fields)
 * @param {string} effectId - Effect ID (namespace/name)
 * @param {string} [name] - Display name
 * @param {object} [params] - Effect parameters
 * @returns {object} Child effect object
 */
export function createChildEffect(effectId, name, params = {}) {
    const effectName = effectId.split('/').pop()
    return {
        id: `layer-${layerCounter++}`,
        name: name || camelToHumanCase(effectName),
        effectId,
        effectParams: params,
        visible: true
    }
}

/**
 * Clone a layer with a new ID
 * @param {object} layer - Layer to clone
 * @returns {object} Cloned layer
 */
export function cloneLayer(layer) {
    return {
        ...layer,
        id: `layer-${layerCounter++}`,
        name: `${layer.name} copy`,
        effectParams: JSON.parse(JSON.stringify(layer.effectParams)),
        children: (layer.children || []).map(child => ({
            ...child,
            id: `layer-${layerCounter++}`,
            effectParams: JSON.parse(JSON.stringify(child.effectParams))
        }))
    }
}

/**
 * Serialize layers for storage
 * @param {Array} layers - Layer array
 * @returns {string} JSON string
 */
export function serializeLayers(layers) {
    // Remove File objects (can't be serialized)
    const serializableLayers = layers.map(layer => ({
        ...layer,
        mediaFile: null // File objects can't be serialized
    }))
    return JSON.stringify(serializableLayers)
}

/**
 * Deserialize layers from storage
 * @param {string} json - JSON string
 * @returns {Array} Layer array
 */
export function deserializeLayers(json) {
    try {
        return JSON.parse(json)
    } catch {
        return []
    }
}

/**
 * Reset layer counter (for testing)
 */
export function resetLayerCounter() {
    layerCounter = 0
}

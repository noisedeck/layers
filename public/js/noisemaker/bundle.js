/**
 * ESM bundle loader for Noisemaker Shaders Core
 *
 * Dynamically imports from the appropriate ESM bundle:
 * - Non-minified for local development (localhost, 127.0.0.1, file://)
 * - Minified for production
 */

const BUNDLE_VERSION = '1.0.0'

// Detect if we're in local development
const isLocalDev = typeof window !== 'undefined' && (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.protocol === 'file:'
)

// Choose bundle based on environment
const bundlePath = isLocalDev
    ? './vendor/noisemaker-shaders-core.esm.js'
    : './vendor/noisemaker-shaders-core.esm.min.js'

// Dynamic import and re-export
const bundle = await import(bundlePath)
console.debug(`[bundle.js] Noisemaker bundle v${BUNDLE_VERSION} loaded from ${bundlePath}`)

// Re-export everything we need
export const CanvasRenderer = bundle.CanvasRenderer
export const ProgramState = bundle.ProgramState
export const registerEffect = bundle.registerEffect
export const getEffect = bundle.getEffect
export const getAllEffects = bundle.getAllEffects
export const registerOp = bundle.registerOp
export const registerStarterOps = bundle.registerStarterOps
export const mergeIntoEnums = bundle.mergeIntoEnums
export const stdEnums = bundle.stdEnums
export const compile = bundle.compile
export const validate = bundle.validate
export const lex = bundle.lex
export const parse = bundle.parse
export const unparse = bundle.unparse
export const extractEffectNamesFromDsl = bundle.extractEffectNamesFromDsl
export const extractEffectsFromDsl = bundle.extractEffectsFromDsl
export const cloneParamValue = bundle.cloneParamValue
export const isStarterEffect = bundle.isStarterEffect
export const hasTexSurfaceParam = bundle.hasTexSurfaceParam
export const is3dGenerator = bundle.is3dGenerator
export const is3dProcessor = bundle.is3dProcessor
export const isValidIdentifier = bundle.isValidIdentifier
export const sanitizeEnumName = bundle.sanitizeEnumName
export const groupGlobalsByCategory = bundle.groupGlobalsByCategory

// Debug: expose bundle for verification
export const _bundle = bundle

/**
 * Project Storage
 * IndexedDB-based storage for project data and media blobs
 *
 * @module utils/project-storage
 */

const DB_NAME = 'layers-projects'
const DB_VERSION = 1
const STORE_PROJECTS = 'projects'
const STORE_MEDIA = 'media'

let db = null

/**
 * Initialize the database
 * @returns {Promise<IDBDatabase>}
 */
async function initDB() {
    if (db) return db

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION)

        request.onerror = () => reject(request.error)

        request.onsuccess = () => {
            db = request.result
            resolve(db)
        }

        request.onupgradeneeded = (event) => {
            const database = event.target.result

            // Projects store
            if (!database.objectStoreNames.contains(STORE_PROJECTS)) {
                const projectStore = database.createObjectStore(STORE_PROJECTS, { keyPath: 'id' })
                projectStore.createIndex('name', 'name', { unique: false })
                projectStore.createIndex('modifiedAt', 'modifiedAt', { unique: false })
            }

            // Media blobs store
            if (!database.objectStoreNames.contains(STORE_MEDIA)) {
                database.createObjectStore(STORE_MEDIA, { keyPath: 'id' })
            }
        }
    })
}

/**
 * Generate a unique ID
 * @returns {string}
 */
function generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Generate a media ID from file content hash
 * @param {Blob} blob - Media blob
 * @returns {Promise<string>}
 */
async function generateMediaId(blob) {
    const buffer = await blob.arrayBuffer()
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
    return hashHex.substring(0, 16)
}

/**
 * Save a media blob to IndexedDB
 * @param {string} mediaId - Media ID
 * @param {Blob} blob - Media blob
 * @param {string} name - Original filename
 * @param {string} type - MIME type
 * @returns {Promise<void>}
 */
async function saveMedia(mediaId, blob, name, type) {
    const database = await initDB()

    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_MEDIA, 'readwrite')
        const store = tx.objectStore(STORE_MEDIA)

        const data = {
            id: mediaId,
            blob,
            name,
            type,
            savedAt: Date.now()
        }

        const request = store.put(data)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
    })
}

/**
 * Load a media blob from IndexedDB
 * @param {string} mediaId - Media ID
 * @returns {Promise<{blob: Blob, name: string, type: string}|null>}
 */
async function loadMedia(mediaId) {
    const database = await initDB()

    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_MEDIA, 'readonly')
        const store = tx.objectStore(STORE_MEDIA)

        const request = store.get(mediaId)
        request.onsuccess = () => {
            if (request.result) {
                resolve({
                    blob: request.result.blob,
                    name: request.result.name,
                    type: request.result.type
                })
            } else {
                resolve(null)
            }
        }
        request.onerror = () => reject(request.error)
    })
}

/**
 * Delete media blobs that are no longer referenced by any project
 * @param {Set<string>} usedMediaIds - Set of media IDs still in use
 * @returns {Promise<void>}
 */
async function cleanupUnusedMedia(usedMediaIds) {
    const database = await initDB()

    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_MEDIA, 'readwrite')
        const store = tx.objectStore(STORE_MEDIA)

        const request = store.openCursor()
        request.onsuccess = (event) => {
            const cursor = event.target.result
            if (cursor) {
                if (!usedMediaIds.has(cursor.key)) {
                    cursor.delete()
                }
                cursor.continue()
            } else {
                resolve()
            }
        }
        request.onerror = () => reject(request.error)
    })
}

/**
 * Get all media IDs referenced by all projects
 * @returns {Promise<Set<string>>}
 */
async function getAllUsedMediaIds() {
    const projects = await listProjects()
    const usedIds = new Set()

    for (const project of projects) {
        for (const layer of project.layers || []) {
            if (layer.mediaId) {
                usedIds.add(layer.mediaId)
            }
        }
    }

    return usedIds
}

/**
 * Project data structure
 * @typedef {object} Project
 * @property {string} id - Unique project ID
 * @property {string} name - Project name
 * @property {number} createdAt - Creation timestamp
 * @property {number} modifiedAt - Last modified timestamp
 * @property {number} canvasWidth - Canvas width
 * @property {number} canvasHeight - Canvas height
 * @property {Array} layers - Layer array (with mediaId instead of mediaFile)
 */

/**
 * Save a project
 * @param {object} projectData - Project data
 * @param {string} projectData.name - Project name
 * @param {number} projectData.canvasWidth - Canvas width
 * @param {number} projectData.canvasHeight - Canvas height
 * @param {Array} projectData.layers - Layer array
 * @param {Map} projectData.mediaTextures - Map of layerId -> {element, type, url}
 * @param {string} [existingId] - Existing project ID (for updates)
 * @returns {Promise<string>} Project ID
 */
export async function saveProject(projectData, existingId = null) {
    const database = await initDB()
    const projectId = existingId || generateId()
    const now = Date.now()

    // Process layers and save media
    const processedLayers = []
    for (const layer of projectData.layers) {
        const processedLayer = { ...layer, mediaFile: null }

        if (layer.sourceType === 'media' && layer.mediaFile) {
            // Generate media ID and save blob
            const mediaId = await generateMediaId(layer.mediaFile)
            await saveMedia(mediaId, layer.mediaFile, layer.mediaFile.name, layer.mediaFile.type)
            processedLayer.mediaId = mediaId
            processedLayer.mediaFileName = layer.mediaFile.name
            processedLayer.mediaFileType = layer.mediaFile.type
        } else if (layer.sourceType === 'media' && layer.mediaId) {
            // Already has a media ID (from previous save)
            processedLayer.mediaId = layer.mediaId
            processedLayer.mediaFileName = layer.mediaFileName
            processedLayer.mediaFileType = layer.mediaFileType
        }

        processedLayers.push(processedLayer)
    }

    const project = {
        id: projectId,
        name: projectData.name,
        createdAt: existingId ? (await getProject(existingId))?.createdAt || now : now,
        modifiedAt: now,
        canvasWidth: projectData.canvasWidth,
        canvasHeight: projectData.canvasHeight,
        layers: processedLayers
    }

    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_PROJECTS, 'readwrite')
        const store = tx.objectStore(STORE_PROJECTS)

        const request = store.put(project)
        request.onsuccess = () => resolve(projectId)
        request.onerror = () => reject(request.error)
    })
}

/**
 * Load a project by ID
 * @param {string} projectId - Project ID
 * @returns {Promise<Project|null>}
 */
export async function getProject(projectId) {
    const database = await initDB()

    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_PROJECTS, 'readonly')
        const store = tx.objectStore(STORE_PROJECTS)

        const request = store.get(projectId)
        request.onsuccess = () => resolve(request.result || null)
        request.onerror = () => reject(request.error)
    })
}

/**
 * Load a project with its media files restored
 * @param {string} projectId - Project ID
 * @returns {Promise<{project: Project, mediaFiles: Map<string, File>}|null>}
 */
export async function loadProject(projectId) {
    const project = await getProject(projectId)
    if (!project) return null

    const mediaFiles = new Map()

    // Load media for each layer
    for (const layer of project.layers) {
        if (layer.sourceType === 'media' && layer.mediaId) {
            const media = await loadMedia(layer.mediaId)
            if (media) {
                // Create a File object from the blob
                const file = new File([media.blob], media.name, { type: media.type })
                mediaFiles.set(layer.id, file)
            }
        }
    }

    return { project, mediaFiles }
}

/**
 * List all projects
 * @returns {Promise<Array<{id: string, name: string, modifiedAt: number}>>}
 */
export async function listProjects() {
    const database = await initDB()

    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_PROJECTS, 'readonly')
        const store = tx.objectStore(STORE_PROJECTS)
        const index = store.index('modifiedAt')

        const projects = []
        const request = index.openCursor(null, 'prev') // Most recent first

        request.onsuccess = (event) => {
            const cursor = event.target.result
            if (cursor) {
                projects.push({
                    id: cursor.value.id,
                    name: cursor.value.name,
                    modifiedAt: cursor.value.modifiedAt,
                    createdAt: cursor.value.createdAt
                })
                cursor.continue()
            } else {
                resolve(projects)
            }
        }
        request.onerror = () => reject(request.error)
    })
}

/**
 * Delete a project
 * @param {string} projectId - Project ID
 * @returns {Promise<void>}
 */
export async function deleteProject(projectId) {
    const database = await initDB()

    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_PROJECTS, 'readwrite')
        const store = tx.objectStore(STORE_PROJECTS)

        const request = store.delete(projectId)
        request.onsuccess = async () => {
            // Cleanup unused media
            try {
                const usedIds = await getAllUsedMediaIds()
                await cleanupUnusedMedia(usedIds)
            } catch (e) {
                console.warn('[ProjectStorage] Media cleanup failed:', e)
            }
            resolve()
        }
        request.onerror = () => reject(request.error)
    })
}

/**
 * Check if a project name already exists
 * @param {string} name - Project name to check
 * @param {string} [excludeId] - Project ID to exclude from check
 * @returns {Promise<{exists: boolean, id: string|null}>}
 */
export async function checkProjectName(name, excludeId = null) {
    const projects = await listProjects()
    const found = projects.find(p => p.name === name && p.id !== excludeId)
    return {
        exists: !!found,
        id: found?.id || null
    }
}

/**
 * Initialize the database on module load
 */
initDB().catch(err => {
    console.error('[ProjectStorage] Failed to initialize database:', err)
})

/**
 * Storage Utilities
 * localStorage helpers
 *
 * @module utils/storage
 */

const STORAGE_PREFIX = 'layers_'

/**
 * Get an item from localStorage
 * @param {string} key - Storage key
 * @param {*} [defaultValue=null] - Default value if not found
 * @returns {*} Stored value or default
 */
export function getItem(key, defaultValue = null) {
    try {
        const item = localStorage.getItem(STORAGE_PREFIX + key)
        if (item === null) return defaultValue
        return JSON.parse(item)
    } catch {
        return defaultValue
    }
}

/**
 * Set an item in localStorage
 * @param {string} key - Storage key
 * @param {*} value - Value to store
 */
export function setItem(key, value) {
    try {
        localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value))
    } catch (e) {
        console.error('Failed to save to localStorage:', e)
    }
}

/**
 * Remove an item from localStorage
 * @param {string} key - Storage key
 */
export function removeItem(key) {
    try {
        localStorage.removeItem(STORAGE_PREFIX + key)
    } catch (e) {
        console.error('Failed to remove from localStorage:', e)
    }
}

/**
 * Clear all items with the app prefix
 */
export function clearAll() {
    try {
        const keysToRemove = []
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i)
            if (key && key.startsWith(STORAGE_PREFIX)) {
                keysToRemove.push(key)
            }
        }
        keysToRemove.forEach(key => localStorage.removeItem(key))
    } catch (e) {
        console.error('Failed to clear localStorage:', e)
    }
}

/**
 * Check if localStorage is available
 * @returns {boolean}
 */
export function isAvailable() {
    try {
        const test = '__storage_test__'
        localStorage.setItem(test, test)
        localStorage.removeItem(test)
        return true
    } catch {
        return false
    }
}

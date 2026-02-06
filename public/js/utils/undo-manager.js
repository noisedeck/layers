/**
 * Undo Manager
 * Snapshot-based history stack for undo/redo
 *
 * @module utils/undo-manager
 */

export class UndoManager {
    constructor(maxSize = 50) {
        this._stack = []
        this._index = -1
        this._maxSize = maxSize
    }

    /**
     * Push a snapshot onto the stack.
     * Truncates any redo branch and trims oldest if over max.
     * @param {object} snapshot - { layers, canvasWidth, canvasHeight }
     */
    pushState(snapshot) {
        // Truncate redo branch
        this._stack.length = this._index + 1

        this._stack.push(snapshot)

        // Trim oldest if over max
        if (this._stack.length > this._maxSize) {
            this._stack.shift()
        }

        this._index = this._stack.length - 1
    }

    /**
     * Undo: move back one step and return the snapshot to restore.
     * @returns {object|null} The snapshot to restore, or null if nothing to undo
     */
    undo() {
        if (!this.canUndo()) return null
        this._index--
        return this._stack[this._index]
    }

    /**
     * Redo: move forward one step and return the snapshot to restore.
     * @returns {object|null} The snapshot to restore, or null if nothing to redo
     */
    redo() {
        if (!this.canRedo()) return null
        this._index++
        return this._stack[this._index]
    }

    canUndo() {
        return this._index > 0
    }

    canRedo() {
        return this._index < this._stack.length - 1
    }

    clear() {
        this._stack = []
        this._index = -1
    }
}

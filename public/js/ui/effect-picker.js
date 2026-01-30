/**
 * Effect Picker
 * Searchable effect selector adapted from slotEffectSelect
 *
 * @module ui/effect-picker
 */

/**
 * Convert camelCase to space-separated lowercase
 * @param {string} str - Input string
 * @returns {string} Space-separated string
 */
function camelToSpaceCase(str) {
    return str
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
        .toLowerCase()
}

/**
 * Normalize text for search
 * @param {string} str - Input string
 * @returns {string} Normalized string
 */
function normalizeForSearch(str) {
    return (str || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * EffectPicker - Searchable effect selection UI
 */
class EffectPicker {
    constructor() {
        this._container = null
        this._effects = []
        this._filteredEffects = []
        this._onSelect = null
        this._filterText = ''
    }

    /**
     * Show the effect picker in a container
     * @param {object} options - Options
     * @param {HTMLElement} options.container - Container element
     * @param {Array} options.effects - Available effects
     * @param {function} options.onSelect - Callback: (effectId) => void
     */
    show(options = {}) {
        this._container = options.container
        this._effects = options.effects || []
        this._filteredEffects = this._effects
        this._onSelect = options.onSelect
        this._filterText = ''

        this._render()
    }

    /**
     * Render the picker
     * @private
     */
    _render() {
        if (!this._container) return

        this._container.innerHTML = `
            <div class="effect-picker">
                <div class="effect-search">
                    <span class="icon-material">search</span>
                    <input type="text" class="effect-search-input" placeholder="Search effects..." autocomplete="off" spellcheck="false">
                    <button class="effect-search-clear hidden" type="button">
                        <span class="icon-material">close</span>
                    </button>
                </div>
                <div class="effect-list"></div>
            </div>
        `

        this._renderEffectList()
        this._setupEventListeners()

        // Focus search input
        const searchInput = this._container.querySelector('.effect-search-input')
        if (searchInput) {
            setTimeout(() => searchInput.focus(), 50)
        }
    }

    /**
     * Render the effect list
     * @private
     */
    _renderEffectList() {
        const listEl = this._container.querySelector('.effect-list')
        if (!listEl) return

        listEl.innerHTML = ''

        if (this._filteredEffects.length === 0) {
            listEl.innerHTML = '<div class="effect-empty">No effects found</div>'
            return
        }

        // Group by namespace
        const byNamespace = {}
        this._filteredEffects.forEach(effect => {
            const ns = effect.namespace || 'other'
            if (!byNamespace[ns]) {
                byNamespace[ns] = []
            }
            byNamespace[ns].push(effect)
        })

        // Render groups
        Object.keys(byNamespace).sort().forEach(ns => {
            const header = document.createElement('div')
            header.className = 'effect-group-header'
            header.textContent = camelToSpaceCase(ns)
            listEl.appendChild(header)

            byNamespace[ns].sort((a, b) => a.name.localeCompare(b.name)).forEach(effect => {
                const item = document.createElement('div')
                item.className = 'effect-item'
                item.dataset.effectId = effect.effectId

                const name = document.createElement('span')
                name.className = 'effect-name'
                name.textContent = camelToSpaceCase(effect.name)
                item.appendChild(name)

                if (effect.tags && effect.tags.length > 0) {
                    const tags = document.createElement('span')
                    tags.className = 'effect-tags'
                    effect.tags.slice(0, 3).forEach(tag => {
                        const tagEl = document.createElement('span')
                        tagEl.className = 'effect-tag'
                        tagEl.textContent = tag
                        tags.appendChild(tagEl)
                    })
                    item.appendChild(tags)
                }

                if (effect.description) {
                    const desc = document.createElement('span')
                    desc.className = 'effect-description'
                    desc.textContent = effect.description
                    item.appendChild(desc)
                }

                listEl.appendChild(item)
            })
        })
    }

    /**
     * Set up event listeners
     * @private
     */
    _setupEventListeners() {
        const searchInput = this._container.querySelector('.effect-search-input')
        const clearBtn = this._container.querySelector('.effect-search-clear')
        const listEl = this._container.querySelector('.effect-list')

        // Search input
        searchInput.addEventListener('input', () => {
            this._filterText = searchInput.value
            this._applyFilter()
            this._renderEffectList()

            // Show/hide clear button
            clearBtn.classList.toggle('hidden', !this._filterText)
        })

        // Clear button
        clearBtn.addEventListener('click', () => {
            searchInput.value = ''
            this._filterText = ''
            this._applyFilter()
            this._renderEffectList()
            clearBtn.classList.add('hidden')
            searchInput.focus()
        })

        // Effect selection
        listEl.addEventListener('click', (e) => {
            const item = e.target.closest('.effect-item')
            if (item && this._onSelect) {
                this._onSelect(item.dataset.effectId)
            }

            // Tag click adds to search
            const tag = e.target.closest('.effect-tag')
            if (tag) {
                e.stopPropagation()
                const tagText = tag.textContent
                if (!this._filterText.includes(tagText)) {
                    searchInput.value = (this._filterText + ' ' + tagText).trim()
                    this._filterText = searchInput.value
                    this._applyFilter()
                    this._renderEffectList()
                    clearBtn.classList.toggle('hidden', !this._filterText)
                }
            }
        })
    }

    /**
     * Apply the current filter
     * @private
     */
    _applyFilter() {
        const q = normalizeForSearch(this._filterText)

        if (!q) {
            this._filteredEffects = this._effects
            return
        }

        const terms = q.split(' ').filter(Boolean)

        this._filteredEffects = this._effects.filter(effect => {
            const haystack = normalizeForSearch([
                effect.namespace,
                camelToSpaceCase(effect.namespace),
                effect.name,
                camelToSpaceCase(effect.name),
                effect.description || '',
                (effect.tags || []).join(' ')
            ].join(' '))

            return terms.every(term => haystack.includes(term))
        })
    }
}

// Add styles
const EFFECT_PICKER_STYLES = `
.effect-picker {
    display: flex;
    flex-direction: column;
}

.effect-search {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    margin-bottom: 12px;
    position: sticky;
    top: 0;
    z-index: 1;
}

.effect-search .icon-material {
    font-size: 18px;
    color: var(--color-text-muted);
}

.effect-search-input {
    flex: 1;
    background: transparent;
    border: none;
    color: var(--color-text-primary);
    font-family: var(--font-body);
    font-size: 14px;
    outline: none;
}

.effect-search-input::placeholder {
    color: var(--color-text-placeholder);
}

.effect-search-clear {
    background: none;
    border: none;
    color: var(--color-text-muted);
    cursor: pointer;
    padding: 4px;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    transition: all var(--transition-fast);
}

.effect-search-clear:hover {
    color: var(--color-text-primary);
    background: var(--color-bg-hover);
}

.effect-search-clear.hidden {
    display: none;
}

.effect-list {
    flex: 1;
}

.effect-group-header {
    padding: 8px 12px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-accent);
    background: rgba(0, 0, 0, 0.2);
    border-bottom: 1px solid var(--color-border-muted);
}

.effect-item {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 8px;
    align-items: center;
    padding: 10px 12px;
    cursor: pointer;
    border-bottom: 1px solid var(--color-border-muted);
    transition: background var(--transition-fast);
}

.effect-item:hover {
    background: rgba(0, 212, 255, 0.1);
}

.effect-item:last-child {
    border-bottom: none;
}

.effect-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--color-text-primary);
}

.effect-tags {
    display: flex;
    gap: 4px;
}

.effect-tag {
    font-size: 10px;
    padding: 2px 6px;
    background: rgba(0, 212, 255, 0.15);
    color: var(--color-accent);
    border-radius: var(--radius-sm);
    cursor: pointer;
}

.effect-tag:hover {
    background: rgba(0, 212, 255, 0.25);
}

.effect-description {
    grid-column: 1 / -1;
    font-size: 11px;
    color: var(--color-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.effect-empty {
    padding: 24px;
    text-align: center;
    color: var(--color-text-muted);
    font-style: italic;
}
`

// Inject styles
if (!document.getElementById('effect-picker-styles')) {
    const styleEl = document.createElement('style')
    styleEl.id = 'effect-picker-styles'
    styleEl.textContent = EFFECT_PICKER_STYLES
    document.head.appendChild(styleEl)
}

// Export singleton
export const effectPicker = new EffectPicker()

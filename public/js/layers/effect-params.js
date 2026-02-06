/**
 * Effect Parameters Component
 * Displays parameter controls for an effect layer
 *
 * @module layers/effect-params
 */

import { getEffect } from '../noisemaker/bundle.js'

// Static effect loader function (set by app after renderer init)
let effectLoader = null

/**
 * EffectParams - Web component for effect parameter editing
 * Single-column layout inspired by noisedeck controls
 * @extends HTMLElement
 */
class EffectParams extends HTMLElement {
    /**
     * Set the effect loader function
     * @param {function} loader - Async function: (effectId) => effectDef
     */
    static setEffectLoader(loader) {
        effectLoader = loader
    }

    constructor() {
        super()
        this._effectId = null
        this._layerId = null
        this._params = {}
        this._effectDef = null
        this._controls = new Map()
        this._loading = false
    }

    connectedCallback() {
        this._render()
    }

    disconnectedCallback() {
        this._controls.clear()
    }

    /**
     * Set the effect to display parameters for
     * @param {string} effectId - Effect ID (e.g., 'filter/blur')
     * @param {string} layerId - Layer ID for events
     * @param {object} params - Current parameter values
     */
    async setEffect(effectId, layerId, params = {}) {
        this._effectId = effectId
        this._layerId = layerId
        this._params = { ...params }

        // Try synchronous first (already loaded)
        this._effectDef = effectId ? getEffect(effectId) : null

        // If not found and we have a loader, load async
        if (!this._effectDef && effectId && effectLoader) {
            this._loading = true
            this._render() // Show loading state
            try {
                this._effectDef = await effectLoader(effectId)
            } catch (err) {
                console.warn(`[effect-params] Failed to load ${effectId}:`, err)
            }
            this._loading = false
        }

        this._render()
    }

    /**
     * Clear the effect display
     */
    clear() {
        this._effectId = null
        this._layerId = null
        this._params = {}
        this._effectDef = null
        this._controls.clear()
        this._render()
    }

    /**
     * Get current parameter values
     * @returns {object} Current parameters
     */
    getParams() {
        return { ...this._params }
    }

    /**
     * Render the component
     * @private
     */
    _render() {
        this._controls.clear()

        // Loading state
        if (this._loading) {
            this.innerHTML = '<div class="effect-params-loading">Loading parameters...</div>'
            this.classList.remove('empty')
            return
        }

        if (!this._effectDef) {
            this.innerHTML = ''
            this.classList.add('empty')
            return
        }

        const globals = this._effectDef.globals || {}

        const unsupportedTypes = ['vec2', 'vec3']
        const isVisible = spec =>
            !spec.ui?.hidden && !spec.internal && !unsupportedTypes.includes(spec.type)

        const visibleParams = Object.entries(globals).filter(([_, spec]) => isVisible(spec))

        if (visibleParams.length === 0) {
            this.innerHTML = '<div class="effect-params-empty">No adjustable parameters</div>'
            this.classList.remove('empty')
            return
        }

        this.classList.remove('empty')

        this.innerHTML = `
            <div class="effect-params-header">
                <span class="effect-params-title">Parameters</span>
            </div>
            <div class="effect-params-controls"></div>
        `

        const controlsContainer = this.querySelector('.effect-params-controls')

        for (const [paramName, spec] of visibleParams) {
            const controlGroup = this._createControlGroup(paramName, spec)
            if (controlGroup) {
                controlsContainer.appendChild(controlGroup)
            }
        }
    }

    /**
     * Create a control group for a parameter
     * @param {string} paramName - Parameter name
     * @param {object} spec - Parameter specification
     * @returns {HTMLElement|null} Control group element
     * @private
     */
    _createControlGroup(paramName, spec) {
        const group = document.createElement('div')
        group.className = 'control-group'
        group.dataset.paramKey = paramName

        // Label
        const label = document.createElement('label')
        label.className = 'control-label'
        label.textContent = spec.ui?.label || paramName
        group.appendChild(label)

        // Get current value or default
        const currentValue = this._params[paramName] !== undefined
            ? this._params[paramName]
            : spec.default

        // Create appropriate control based on type
        const controlHandle = this._createControl(paramName, spec, currentValue)
        if (!controlHandle) return null

        // Append the control element(s)
        if (controlHandle.element) {
            group.appendChild(controlHandle.element)
        }

        // Value display for sliders
        if (spec.ui?.control === 'slider' || (spec.type === 'float' || spec.type === 'int') && !spec.choices) {
            const valueDisplay = document.createElement('span')
            valueDisplay.className = 'control-value'
            valueDisplay.textContent = this._formatValue(currentValue, spec)
            group.appendChild(valueDisplay)
            controlHandle.valueDisplay = valueDisplay
        }

        this._controls.set(paramName, controlHandle)
        return group
    }

    /**
     * Create a control element for a parameter
     * @param {string} paramName - Parameter name
     * @param {object} spec - Parameter specification
     * @param {*} currentValue - Current value
     * @returns {object|null} Control handle with element and getValue/setValue
     * @private
     */
    _createControl(paramName, spec, currentValue) {
        const controlType = spec.ui?.control || this._inferControlType(spec)

        switch (controlType) {
            case 'slider':
                return this._createSlider(paramName, spec, currentValue)
            case 'dropdown':
                return this._createDropdown(paramName, spec, currentValue)
            case 'checkbox':
            case 'toggle':
                return this._createToggle(paramName, spec, currentValue)
            case 'color':
                return this._createColorPicker(paramName, spec, currentValue)
            case 'button':
                return this._createButton(paramName, spec)
            case 'text':
            case 'textarea':
                return this._createTextInput(paramName, spec, currentValue)
            default:
                return null
        }
    }

    /**
     * Infer control type from spec
     * @param {object} spec - Parameter specification
     * @returns {string} Control type
     * @private
     */
    _inferControlType(spec) {
        if (spec.choices) return 'dropdown'
        if (spec.type === 'boolean') return 'toggle'
        if (spec.type === 'color' || spec.type === 'vec4') return 'color'
        if (spec.type === 'string') return 'text'
        if (spec.type === 'float' || spec.type === 'int') return 'slider'
        return 'slider'
    }

    /**
     * Create a slider control
     * @private
     */
    _createSlider(paramName, spec, currentValue) {
        const slider = document.createElement('input')
        slider.type = 'range'
        slider.className = 'control-slider'
        slider.min = spec.min ?? 0
        slider.max = spec.max ?? 100
        slider.step = spec.step ?? (spec.type === 'int' ? 1 : 0.01)
        slider.value = currentValue

        slider.addEventListener('input', () => {
            const value = spec.type === 'int'
                ? parseInt(slider.value, 10)
                : parseFloat(slider.value)
            this._handleValueChange(paramName, value, spec)

            // Update value display
            const handle = this._controls.get(paramName)
            if (handle?.valueDisplay) {
                handle.valueDisplay.textContent = this._formatValue(value, spec)
            }
        })

        return {
            element: slider,
            getValue: () => spec.type === 'int' ? parseInt(slider.value, 10) : parseFloat(slider.value),
            setValue: (v) => { slider.value = v }
        }
    }

    /**
     * Create a dropdown control
     * @private
     */
    _createDropdown(paramName, spec, currentValue) {
        const select = document.createElement('select')
        select.className = 'control-dropdown'

        // Handle choices object or array
        const choices = spec.choices || {}
        for (const [name, value] of Object.entries(choices)) {
            const option = document.createElement('option')
            option.value = value
            option.textContent = name
            if (value === currentValue || name === currentValue) {
                option.selected = true
            }
            select.appendChild(option)
        }

        select.addEventListener('change', () => {
            const value = spec.type === 'int'
                ? parseInt(select.value, 10)
                : select.value
            this._handleValueChange(paramName, value, spec)
        })

        return {
            element: select,
            getValue: () => spec.type === 'int' ? parseInt(select.value, 10) : select.value,
            setValue: (v) => { select.value = v }
        }
    }

    /**
     * Create a toggle/checkbox control
     * @private
     */
    _createToggle(paramName, spec, currentValue) {
        const toggle = document.createElement('button')
        toggle.type = 'button'
        toggle.className = `control-toggle ${currentValue ? 'active' : ''}`
        toggle.innerHTML = `<span class="toggle-track"><span class="toggle-thumb"></span></span>`

        let checked = !!currentValue

        toggle.addEventListener('click', () => {
            checked = !checked
            toggle.classList.toggle('active', checked)
            this._handleValueChange(paramName, checked, spec)
        })

        return {
            element: toggle,
            getValue: () => checked,
            setValue: (v) => {
                checked = !!v
                toggle.classList.toggle('active', checked)
            }
        }
    }

    /**
     * Create a color picker control
     * @private
     */
    _createColorPicker(paramName, spec, currentValue) {
        const container = document.createElement('div')
        container.className = 'control-color-container'

        const input = document.createElement('input')
        input.type = 'color'
        input.className = 'control-color'

        // Convert array value to hex
        const hexValue = this._arrayToHex(currentValue)
        input.value = hexValue

        const hexDisplay = document.createElement('span')
        hexDisplay.className = 'control-color-hex'
        hexDisplay.textContent = hexValue

        container.appendChild(input)
        container.appendChild(hexDisplay)

        input.addEventListener('input', () => {
            hexDisplay.textContent = input.value
            const arrayValue = this._hexToArray(input.value)
            this._handleValueChange(paramName, arrayValue, spec)
        })

        return {
            element: container,
            getValue: () => this._hexToArray(input.value),
            setValue: (v) => {
                const hex = this._arrayToHex(v)
                input.value = hex
                hexDisplay.textContent = hex
            }
        }
    }

    /**
     * Create a button control (for momentary actions like reset)
     * @private
     */
    _createButton(paramName, spec) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'control-button'
        button.textContent = spec.ui?.buttonLabel || paramName

        button.addEventListener('click', () => {
            // For buttons, trigger the action (usually sets a flag temporarily)
            this._handleValueChange(paramName, true, spec)
            // Reset after a frame
            requestAnimationFrame(() => {
                this._handleValueChange(paramName, false, spec)
            })
        })

        return {
            element: button,
            getValue: () => false,
            setValue: () => {}
        }
    }

    /**
     * Create a text input control
     * @private
     */
    _createTextInput(paramName, spec, currentValue) {
        const isMultiline = spec.ui?.multiline

        let input
        if (isMultiline) {
            input = document.createElement('textarea')
            input.className = 'control-textarea'
            input.rows = 3
        } else {
            input = document.createElement('input')
            input.type = 'text'
            input.className = 'control-text'
        }

        input.value = currentValue || ''
        if (spec.ui?.placeholder) {
            input.placeholder = spec.ui.placeholder
        }

        input.addEventListener('input', () => {
            this._handleValueChange(paramName, input.value, spec)
        })

        return {
            element: input,
            getValue: () => input.value,
            setValue: (v) => { input.value = v || '' }
        }
    }

    /**
     * Handle a parameter value change
     * @param {string} paramName - Parameter name
     * @param {*} value - New value
     * @param {object} spec - Parameter specification
     * @private
     */
    _handleValueChange(paramName, value, spec) {
        this._params[paramName] = value

        // Emit event for layer to handle
        this.dispatchEvent(new CustomEvent('param-change', {
            bubbles: true,
            detail: {
                layerId: this._layerId,
                paramName,
                value,
                params: this.getParams()
            }
        }))
    }

    /**
     * Format a value for display
     * @param {*} value - Value to format
     * @param {object} spec - Parameter specification
     * @returns {string} Formatted value
     * @private
     */
    _formatValue(value, spec) {
        if (typeof value === 'number') {
            if (spec.type === 'int') {
                return value.toString()
            }
            // Float: show 2 decimal places
            return value.toFixed(2)
        }
        return String(value)
    }

    /**
     * Convert RGB array [0-1] to hex string
     * @private
     */
    _arrayToHex(arr) {
        if (!Array.isArray(arr)) return '#ffffff'
        const hex = c => Math.round((c || 0) * 255).toString(16).padStart(2, '0')
        return `#${hex(arr[0])}${hex(arr[1])}${hex(arr[2])}`
    }

    /**
     * Convert hex string to RGB array [0-1]
     * @private
     */
    _hexToArray(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
        if (!result) return [1, 1, 1]
        return [
            parseInt(result[1], 16) / 255,
            parseInt(result[2], 16) / 255,
            parseInt(result[3], 16) / 255
        ]
    }
}

customElements.define('effect-params', EffectParams)

export { EffectParams }

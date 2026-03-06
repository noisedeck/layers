# Handfish UI Toolkit Port — Design

## Summary

Port Layers to the Handfish design system, following the same patterns established in the Noisedeck port. Layers is a simpler "single-column" version of the Noisedeck effects editor, making this a straightforward migration.

## Scope

### In Scope
- **CSS token migration**: Replace all `--color-*` / `--radius-*` / `--shadow-*` / `--transition-*` variables with `--hf-*` tokens across all CSS files
- **Effect parameter controls**: Replace custom controls in `effect-params.js` with handfish components (`<slider-value>`, `<select-dropdown>`, `<toggle-switch>`, `<color-picker>`)
- **Menu system**: Port menu CSS to handfish tokens
- **Dialogs**: Port dialog CSS to handfish tokens (export video, export image, font install, confirm, about)
- **Fonts**: Lean on handfish CDN for Nunito / Noto Sans Mono / Material Symbols; keep Cormorant Upright
- **Theme**: Hardcoded `neutral-dark` via `data-theme` attribute

### Out of Scope
- Theme switching UI (future work)
- Toolbar controls (stays bespoke)
- Drawing options bar controls (stays bespoke)
- Layer stack / layer item web components (domain components, unchanged)
- Tools, selection system, rendering pipeline

## Architecture

### CDN Integration

Same pattern as Noisedeck — load from CDN via importmap:

```html
<script type="importmap">
{ "imports": { "handfish": "https://handfish.noisefactor.io/0.9.0/handfish.esm.min.js" } }
</script>
<link rel="stylesheet" href="https://handfish.noisefactor.io/0.9.0/styles/tokens.css">
<link rel="stylesheet" href="https://handfish.noisefactor.io/0.9.0/styles/themes/neutral.css">
```

### CSS Variable Mapping

Delete `colors.css`. Create `theme.css` for computed variables built on handfish primitives.

Key mappings:
| Layers (`--color-*`) | Handfish (`--hf-*`) |
|---|---|
| `--color-bg` | `--hf-color-2` |
| `--color-bg-elevated` | `--hf-color-3` |
| `--color-bg-hover` | `--hf-color-3` |
| `--color-text-primary` | `--hf-color-7` |
| `--color-text-secondary` | `--hf-color-6` |
| `--color-text-muted` | `--hf-color-5` |
| `--color-border` | `--hf-color-3` |
| `--color-accent` | `--hf-accent-3` |
| `--color-ui` | `--hf-color-5` |
| `--color-error` | `--hf-red` |
| `--color-success` | `--hf-green` |
| `--color-warning` | `--hf-yellow` |
| `--radius-sm/md/lg` | `--hf-radius-sm/md/lg` |
| `--shadow-sm/md/lg` | `--hf-shadow-sm/md/lg` |
| Glass effects | `--hf-glass-blur`, `--hf-panel-opacity` |

### Control Migration in effect-params.js

| Current | Handfish |
|---|---|
| `<input type="range">` + `<span class="control-value">` | `<slider-value>` |
| `<select>` | `<select-dropdown>` with `setOptions()` |
| Custom toggle `<button>` | `<toggle-switch>` |
| `<input type="color">` + hex display | `<color-picker>` |

Text inputs and buttons stay as native elements.

### What Stays Unchanged

- `app.js` — event interface (`param-change`) is preserved
- `layer-stack.js`, `layer-item.js` — domain web components
- `font-select.js` — font picker
- All tools, selection, drawing, rendering code
- Toolbar HTML/CSS (bespoke)
- Drawing options bar (bespoke)

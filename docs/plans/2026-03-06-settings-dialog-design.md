# App Settings Dialog — Design

## Summary

Add an "App Settings" dialog to Layers with theme selection, accessible from the Layers logo menu.

## Scope

### In Scope
- Settings dialog with theme selector
- All handfish themes available
- "System" mode auto-selects gray-dark/gray-light via `prefers-color-scheme`
- Persist selection in localStorage
- Menu item in Layers logo menu

### Out of Scope
- Other settings (future work)
- Theme preview/thumbnails

## Architecture

### Theme Options

| Label | data-theme value |
|---|---|
| System (default) | `gray-dark` or `gray-light` via media query |
| Gray Dark | `gray-dark` |
| Gray Light | `gray-light` |
| Neutral Dark | `neutral-dark` |
| Neutral Light | `neutral-light` |
| Corporate | `corporate` |
| Cyberpunk | `cyberpunk` |
| Earthy | `earthy` |
| Organic | `organic` |
| Terminal | `terminal` |

### Persistence

- localStorage key: `layers-theme`
- Values: `"system"`, `"gray-dark"`, `"gray-light"`, `"neutral-dark"`, `"neutral-light"`, `"corporate"`, `"cyberpunk"`, `"earthy"`, `"organic"`, `"terminal"`
- Default (no key or `"system"`): resolve via `matchMedia('(prefers-color-scheme: dark)')` → `gray-dark` / `gray-light`

### Theme Application

- Set `document.documentElement.dataset.theme` on selection and on app load
- When in "system" mode, listen for `prefers-color-scheme` changes via `matchMedia.addEventListener('change', ...)`

### New Files

- `public/js/ui/settings-dialog.js` — `SettingsDialog` class, same pattern as `AboutDialog`

### Modified Files

- `public/index.html` — add menu item "settings...", add `<link>` tags for all handfish theme CSS files
- `public/js/app.js` — import SettingsDialog, wire menu click handler, apply theme on load

### Dialog Content

Single `<select-dropdown>` (handfish component) for theme selection. Dialog follows existing pattern: `<dialog>` with `.showModal()`, styled via `components.css`.

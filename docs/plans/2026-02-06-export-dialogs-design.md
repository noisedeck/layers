# Export Dialogs Design

Port "export image" and "export video" dialogs from Noisedeck, plus vendor the MediaBunny library for MP4 encoding.

## New Files

| File | Source | Notes |
|------|--------|-------|
| `public/js/ui/export-image-dialog.js` | Noisedeck `exportImageMode.js` | Adapted for Layers patterns |
| `public/js/ui/export-video-dialog.js` | Noisedeck `exportMode.js` | Adapted with video seeking |
| `public/js/utils/files.js` | Noisedeck `files.js` | MP4/ZIP recording, no GIF/FPS |
| `public/js/lib/mediabunny.min.mjs` | Vendored copy | MPL-2.0, 396KB |
| `public/js/lib/zipWorker.js` | Vendored copy | 42 lines |
| `public/js/lib/jszip.min.js` | Vendored copy | 96KB |

## Modified Files

| File | Changes |
|------|---------|
| `public/index.html` | Add menu items, add dialog HTML |
| `public/css/components.css` | Add export dialog CSS |
| `public/css/menu.css` | Add missing CSS variables |
| `public/js/app.js` | Wire up menu handlers, instantiate controllers |

## File Menu Structure

```
new...
open...
---
save project
save project as...
load project...
---
quick save as png
quick save as jpg
---
export image...
export video...
```

## Export Image Dialog

Native `<dialog>` element, singleton controller with lazy element caching.

Options: width/height (pre-filled from canvas, 64-8192), format (PNG/JPEG/WebP), quality (low-maximum, hidden for PNG).

Flow: open dialog -> configure -> export button -> temporarily resize canvas if needed (wait two frames) -> `Files.saveImage()` via `toDataURL()` -> restore resolution -> toast success -> close.

Preferences persisted to `layers-export-image-prefs` in localStorage.

## Export Video Dialog

Two-view dialog: settings view and progress view.

Settings: width/height (64-4096), framerate (24/30/60), duration (1-300s), loop count (1-10), format (MP4/ZIP), quality (low-ultra), play from (beginning/current).

Info row: total frames, estimated file size.

Progress view: progress bar, frame counter, elapsed/remaining time, cancel button.

### Export Flow

1. Open dialog, pause renderer (capture normalized time), stop video update loop
2. Configure settings, click "begin export"
3. Resize canvas if needed
4. If "beginning": seek all video elements to time 0. If "current": keep as-is
5. Init MP4 (via Files/MediaBunny) or ZIP recording
6. Frame-by-frame loop:
   - Calculate normalized time for this frame
   - Seek video elements to corresponding timestamp (`video.currentTime = t`, await `seeked` event)
   - Manually upload video textures via `updateTextureFromSource()`
   - Call `renderer.render(normalizedTime)`, wait one frame for GPU
   - Encode frame (MP4 via VideoEncoder, or ZIP via readPixels)
7. Finalize recording, trigger download
8. Restore resolution, resume renderer from paused time

### Video Seeking Warning

Display note in dialog: "Video layers use best-effort frame seeking. Exported frames may vary slightly from live preview."

## Files Class

Adapted from Noisedeck `files.js`. Keeps: `saveImage`, `savePNG`, `saveJPG`, `startRecordingMP4`, `encodeVideoFrame`, `endRecordingMP4`, `cancelMP4`, `saveZip`, `addZipFrame`, `createZip`, `cancelZIP`, `calculateBitrate`, `downloadFile`. Drops: GIF support, `getVideoFPS`, `cancelExport`. Uses `layers-` filename prefix. No `eventBus` calls.

## CSS Variables

Add to `menu.css` `:root`:

```css
--color1: #2a2a2a;
--color3: #666666;
--color5: #999999;
--red: #e74c3c;
```

Light mode overrides:

```css
--color1: #e0e0e0;
--color3: #999999;
--color5: #666666;
```

## Integration in app.js

- Import `ExportImageMode`, `ExportMode`, `Files`
- Instantiate in constructor with: `renderer`, `canvas`, `getResolution` (returns `{width, height}` from canvas), `setResolution` (calls `renderer.resize()` + updates canvas dims)
- Menu click handlers: `exportImageMenuItem` -> `open()`, `exportVideoMenuItem` -> `open()`
- `onComplete` callbacks show success toast

## Implementation Steps

1. Vendor libraries: copy `mediabunny.min.mjs`, `zipWorker.js`, `jszip.min.js` from Noisedeck
2. Create `public/js/utils/files.js` (adapted Files class)
3. Add CSS variables to `menu.css`
4. Add export dialog CSS to `components.css`
5. Add dialog HTML to `index.html`
6. Add menu items to `index.html`
7. Create `export-image-dialog.js` controller
8. Create `export-video-dialog.js` controller (with video seeking logic)
9. Wire up in `app.js`: imports, instantiation, menu handlers
10. Test: export image at current and different resolutions
11. Test: export video with and without video layers

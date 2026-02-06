# Layers

Layers is a browser-based media editor with non-destructive layer compositing, powered by the Noisemaker shader pipeline. It runs entirely client-side.

## Features

- Layer stack with opacity, blend modes, visibility, and locking
- GPU-accelerated effects via WebGL shaders (blur, warp, noise, edge detection, dither, and others)
- Selection tools: rectangle, oval, lasso, polygon, magic wand
- Selection operations: expand, contract, feather, smooth, border, color range
- Image and video layer support
- Copy/paste, crop to selection, canvas resize, image resize
- Project persistence via IndexedDB
- Undo/redo with debounced parameter tracking

## Requirements

- Node.js and npm
- A browser with WebGL2 support

## Development

```
npm install
npm run dev
```

This starts a local server on port 3002.

### Updating Noisemaker

The shader pipeline is vendored from the [Noisemaker](https://github.com/noisedeck/noisemaker) repository. To pull the latest build:

```
./pull-noisemaker
```

To pin a specific commit:

```
NOISEMAKER_SHA=abc123 ./pull-noisemaker
```

## Testing

End-to-end tests use Playwright:

```
npm test
```

## License

Layers is released under the [MIT License](LICENSE). Use of name in derivative products is subject to the [Trademark Policy](TRADEMARK.md).

Copyright 2026 [Noise Factor LLC](https://noisefactor.io/)

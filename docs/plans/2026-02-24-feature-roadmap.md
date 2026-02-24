# Layers Feature Roadmap

Date: 2026-02-24

Features considered during brainstorming to bring Layers up to a viable everyday media editing app. Organized by priority based on impact and dependency analysis.

## Phase 1: Transform System (Current)

On-canvas resize, rotate, flip with GPU-side bicubic interpolation. Foundational — compositing without transforms isn't compositing.

See: `2026-02-24-transform-system-design.md`

## Phase 2: Drawing & Annotation Tools

Basic tools for direct canvas interaction:
- **Brush tool** — round brush with variable size, opacity, color
- **Eraser tool** — removes pixels from current layer
- **Shape tools** — rectangle, ellipse, line, arrow
- **Fill tool** — flood fill with tolerance

Scope is annotation-level, not digital painting. Drawing creates new raster layers.

## Phase 3: Adjustment Workflow

Make existing Noisemaker effects more accessible for quick photo editing:
- Reorganized Image menu with clear adjustment categories
- Quick-access adjustment panel in the layer sidebar
- Auto-levels, auto-contrast, auto-white-balance shortcuts
- Streamlined sliders for brightness/contrast, hue/saturation, levels, curves
- Non-destructive adjustment layers (partially supported already via effect layers)

Mostly a UX reorganization of capabilities that already exist in the shader pipeline.

## Phase 4: Layer Masks

Non-destructive masking for compositing:
- Per-layer grayscale mask (white=visible, black=hidden)
- Paint on mask with brush/eraser tools (requires Phase 2)
- Use selections to create masks
- Mask visibility toggle (view mask as overlay)

Fundamental for professional compositing workflows. Depends on drawing tools for mask editing.

## Phase 5: History Panel

Visual undo history:
- Named steps shown in a panel
- Click any step to jump back
- Non-linear history navigation
- Branch-aware (optional — if you undo and make changes, old branch is preserved or discarded)

Improves confidence in experimentation. Currently only linear Cmd+Z/Shift+Z.

## Phase 6: Keyboard Shortcuts & Power User Features

Comprehensive shortcut system:
- Tool shortcuts: B=brush, V=move, T=transform, M=marquee, E=eraser, L=lasso, W=magic wand
- Action shortcuts: number keys for opacity, bracket keys for brush size
- Customizable shortcut mapping

## Phase 7: Drag-and-Drop File Import

Drop images/videos directly onto the canvas to add as new layers. Currently requires going through the File menu. Low effort, high convenience.

## Design Principles

Across all phases:
- **Keep the minimal feel** — add features without cluttering the UI
- **Non-destructive by default** — preserve source data, apply effects at render time
- **GPU-accelerated** — leverage the Noisemaker pipeline for performance
- **Backward compatible** — old projects load cleanly with sensible defaults
- **Quality interpolation** — bicubic or better for all resampling operations

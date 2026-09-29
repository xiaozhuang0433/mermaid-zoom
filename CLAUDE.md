# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Language Convention

- **Code comments** and **git commit messages** must be written in **English**.
- Other text output (docs, descriptions, user-facing strings) should prefer English where practical.

## Project

Fork of [xiaozhuang0433/mermaid-zoom](https://github.com/xiaozhuang0433/mermaid-zoom).
Obsidian plugin: Zoom & Pan for Mermaid diagrams.

## Commands

```bash
npm install
npm run dev    # Watch mode (esbuild, auto-rebuild on change)
npm run build  # Production build (tsc type-check + esbuild minified)
```

There are no tests.

## Architecture

- `main.ts` (~400 lines) — `MermaidZoomPlugin` (extends Obsidian `Plugin`): lifecycle, mermaid block detection (`MutationObserver` + workspace event sweeps), inline decoration (alignment/border classes, then a per-sweep idempotent `syncInlineZoom` call), and the fullscreen modal (normalizes inline-zoom styles off the clone, measures it at open time; owns all modal zoom/pan interaction and its control bar). Automatic decoration never sets sizes — user-initiated inline zoom is the one deliberate exception (see `inlineZoom.ts`).
- `inlineZoom.ts` — inline zoom on native `.mermaid` blocks, container-free: zooming sizes the native svg directly (width/height from its `viewBox`, re-read per event — nothing measured once and remembered), the block becomes a horizontal scroller past the column width, and a bottom-right cluster (zoom in/out/fit width/reset/lock/fullscreen) is kept in sync by the idempotent `syncInlineZoom`. Fit width scales the svg to the block's content width (one-shot); the zoom-out floor is `min(INLINE_MIN_SCALE, fit-width scale)` so very wide diagrams (Obsidian renders flowcharts with `useMaxWidth: false`) can always be zoomed out to fully visible. Per-block scale lives in `block.dataset.mzScale`; a lock toggle (default locked) gates gesture listeners — while locked a block carries zero listeners (the PR #8 scroll-hijack guarantee). Mermaid's pristine inline svg styles are snapshotted in a node-keyed `WeakMap` so reset restores them; `teardownInlineZoom` strips everything on unload.
- `settings.ts` — `MermaidZoomSettings` interface, `DEFAULT_SETTINGS`, and `MermaidZoomSettingTab` (settings UI). Uses a type-only import of `MermaidZoomPlugin` from `main.ts` (no runtime cycle). Alignment/border/inline-zoom-button changes call `decorateAllMermaidBlocks()` so open notes update immediately.
- `gestures.ts` — `ZoomState` interface plus free functions `addWheelZoom` / `addDragPan` / `addTouchGestures` / `zoom` / `updateTransform` / `wheelZoomFactor`. Pure functions of `(container, contentWrapper, state)` with no `this`/settings dependency; the transform machinery is only used by the fullscreen modal — `wheelZoomFactor` (delta normalization + exponential scaling with `sensitivity`) is shared with `inlineZoom.ts`. Wheel zoom scales exponentially with the actual `deltaY` magnitude so high-resolution devices (trackpad/Magic Mouse) don't feel hair-triggered.
- Lifecycle: modal gesture functions each return a `() => void` cleanup function, collected by the modal's `closeModal`. Inline gesture listeners (only present while unlocked) are torn down by `teardownInlineZoom` from `onunload`; buttons/classes live inside the native `.mermaid` block and die with it, while live-preview re-attach is healed by every-sweep `syncInlineZoom`.
- Build: esbuild → `main.js` (CommonJS), TypeScript strict mode (`noImplicitAny`, `strictNullChecks`)

## Release

> **Never cut a release on your own initiative.** Do not bump the version, push a tag, run `gh release`, or trigger `workflow_dispatch` unless the user explicitly asks. Publishing a public GitHub release is hard to undo — always wait for an explicit instruction (e.g. "发版" / "release X"). Preparing commits, version bumps, or release prep is fine, but the actual publish step requires confirmation.

GitHub Action (`.github/workflows/release.yml`) triggers on **tag push** (`on: push: tags`) and on `workflow_dispatch` (optional `version` input). It does NOT fire on pushes to `main`.
Release flow: bump `manifest.json` + `package.json` → commit → `git tag X.Y.Z` (must equal the manifest version) → `git push origin X.Y.Z`. The workflow runs lint + build, creates the tag if missing, and publishes the release.
BRAT-compatible: release assets are `main.js`, `manifest.json`, `styles.css`, and `mermaid-zoom.zip`.

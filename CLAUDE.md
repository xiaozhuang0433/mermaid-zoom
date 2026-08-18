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

- `main.ts` (~410 lines) — `MermaidZoomPlugin` (extends Obsidian `Plugin`): lifecycle, mermaid block detection (`MutationObserver` + workspace event sweeps), inline decoration (alignment/border classes + fullscreen button — the plugin never touches inline layout and never sets sizes), and the fullscreen modal (measures the cloned svg at open time; owns all zoom/pan interaction and its control bar).
- `settings.ts` — `MermaidZoomSettings` interface, `DEFAULT_SETTINGS`, and `MermaidZoomSettingTab` (settings UI). Uses a type-only import of `MermaidZoomPlugin` from `main.ts` (no runtime cycle). Alignment/border changes call `decorateAllMermaidBlocks()` so open notes update immediately.
- `gestures.ts` — `ZoomState` interface plus free functions `addWheelZoom` / `addDragPan` / `addTouchGestures` / `zoom` / `updateTransform`. Pure functions of `(container, contentWrapper, state)` with no `this`/settings dependency; only used by the fullscreen modal. `addWheelZoom`/`addTouchGestures` take an optional `sensitivity` multiplier (from the `zoomSensitivity` setting); wheel zoom scales exponentially with the actual `deltaY` magnitude so high-resolution devices (trackpad/Magic Mouse) don't feel hair-triggered.
- Lifecycle: gesture functions each return a `() => void` cleanup function, collected by the modal's `closeModal`. Inline decoration needs no cleanup — classes and the button live inside the native `.mermaid` block and die with it.
- Build: esbuild → `main.js` (CommonJS), TypeScript strict mode (`noImplicitAny`, `strictNullChecks`)

## Release

> **Never cut a release on your own initiative.** Do not bump the version, push a tag, run `gh release`, or trigger `workflow_dispatch` unless the user explicitly asks. Publishing a public GitHub release is hard to undo — always wait for an explicit instruction (e.g. "发版" / "release X"). Preparing commits, version bumps, or release prep is fine, but the actual publish step requires confirmation.

GitHub Action (`.github/workflows/release.yml`) triggers on **tag push** (`on: push: tags`) and on `workflow_dispatch` (optional `version` input). It does NOT fire on pushes to `main`.
Release flow: bump `manifest.json` + `package.json` → commit → `git tag X.Y.Z` (must equal the manifest version) → `git push origin X.Y.Z`. The workflow runs lint + build, creates the tag if missing, and publishes the release.
BRAT-compatible: release assets are `main.js`, `manifest.json`, `styles.css`, and `mermaid-zoom.zip`.

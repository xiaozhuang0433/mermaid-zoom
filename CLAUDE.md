# CLAUDE.md

## Projekt

Fork von [xiaozhuang0433/mermaid-zoom](https://github.com/xiaozhuang0433/mermaid-zoom).
Obsidian-Plugin: Zoom & Pan für Mermaid-Diagramme.

## Befehle

```bash
npm install
npm run dev    # Watch-Modus
npm run build  # Produktion (inkl. Type-Check)
```

## Architektur

- `main.ts` — einzige Quelldatei, enthält gesamte Plugin-Logik
- `MermaidZoomPlugin` — Hauptklasse, erbt von `Plugin`
- Diagramm-Erkennung via `MutationObserver` + `registerMarkdownCodeBlockProcessor`
- Zoom-State pro Diagramm in `Map<HTMLElement, ZoomState>`
- Build: esbuild → `main.js` (CommonJS)

## Release

GitHub Action (`.github/workflows/release.yml`) baut und releast automatisch bei Push auf `main`.
BRAT-kompatibel: Release enthält `main.js`, `manifest.json`, `styles.css`.
Version wird automatisch gebumpt falls Tag bereits existiert.

# Mermaid Zoom

An Obsidian plugin that adds zoom and pan functionality to Mermaid diagrams.

![Version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fxiaozhuang0433%2Fmermaid-zoom%2Fmain%2Fmanifest.json&query=$.version&prefix=v&label=version&color=2D9CDB)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

## Features

- **Mouse Wheel Zoom** - Scroll over any Mermaid diagram to zoom in and out
- **Drag to Pan** - Click and drag to move around your diagrams
- **Touch Gestures** - Pinch to zoom and drag to pan on mobile devices
- **Control Buttons** - Quick access to zoom in, zoom out, and reset buttons
- **Scale Indicator** - Real-time display of current zoom level
- **Fullscreen Mode** - Open diagrams in a modal for better viewing

## Installation

### Obsidian Plugin Market (Coming Soon)

Once approved, install directly from Obsidian's community plugins browser.

### Manual Installation

1. Download the latest release from [GitHub Releases](https://github.com/xiaozhuang0433/mermaid-zoom/releases)
2. Extract to your vault's plugins directory:
   ```
   <your-vault>/.obsidian/plugins/mermaid-zoom
   ```
3. Enable the plugin in Obsidian:
   - Settings → Community Plugins
   - Find "Mermaid Zoom" and enable it

## Usage

### Mouse Controls

| Action | Description |
|--------|-------------|
| **Zoom** | Hover over a Mermaid diagram and scroll the mouse wheel |
| **Pan** | Click and drag to move the diagram |
| **Fullscreen** | Click the fullscreen button to open in modal view |

### Touch Controls (Mobile)

| Action | Description |
|--------|-------------|
| **Zoom** | Pinch with two fingers |
| **Pan** | Drag with one finger |

### Control Buttons

Located in the bottom-right corner of each diagram:

- **`+`** - Zoom in
- **`-`** - Zoom out
- **`⟲`** - Reset to fit
- **`⛶`** - Toggle fullscreen

## Development

```bash
# Install dependencies
npm install

# Development mode (watch for changes)
npm run dev

# Production build
npm run build
```

## How It Works

The plugin automatically detects all Mermaid diagrams rendered in Obsidian and wraps each one in a zoomable container. Zoom range is configurable from 10% to 500%.

Original SVG dimensions are cached to ensure consistent scaling behavior when resetting or resizing.

## License

[MIT](LICENSE) © [Wang Xiao Zhuang](https://github.com/xiaozhuang0433)

## Support

- Issues: [GitHub Issues](https://github.com/xiaozhuang0433/mermaid-zoom/issues)
- Discussions: [GitHub Discussions](https://github.com/xiaozhuang0433/mermaid-zoom/discussions)

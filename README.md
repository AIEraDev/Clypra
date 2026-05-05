# Clypra

<div align="center">

![Clypra Logo](https://img.shields.io/badge/Clypra-Video%20Editor-blue?style=for-the-badge)

A modern, open-source video editor built with Tauri, React, and TypeScript featuring a professional timeline interface.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md) [![GitHub issues](https://img.shields.io/github/issues/AIEraDev/clypra)](https://github.com/AIEraDev/clypra/issues) [![GitHub stars](https://img.shields.io/github/stars/AIEraDev/clypra)](https://github.com/AIEraDev/clypra/stargazers)

[Features](#features) • [Installation](#installation) • [Usage](#usage) • [Contributing](#contributing) • [License](#license)

</div>

---

## Features

- 🎬 **Multi-Format Support** - Import MP4, MOV, WebM, MKV, M4V, AVI videos, MP3, WAV, AAC audio, and JPG, PNG, WebP images
- ✂️ **Precision Editing** - Frame-accurate trimming with visual timeline
- 📊 **Audio Visualization** - Real-time audio waveform display
- 🎞️ **Filmstrip Preview** - Thumbnail strip for easy navigation
- 🎯 **Professional Timeline** - Multi-track timeline with ruler and playhead
- ⚡ **Fast Processing** - FFmpeg-powered video processing
- 🖥️ **Native Performance** - Built with Tauri for desktop-class performance
- 🎨 **Modern UI** - Clean, intuitive interface with dark mode
- 🔄 **Cross-Platform** - Works on macOS, Windows, and Linux

## Project Structure

```
src/
├── components/          # Reusable UI components
│   ├── ui/             # Generic UI (icons, buttons, etc.)
│   └── video/          # Video-specific components
├── features/           # Feature modules
│   └── timeline/       # Timeline feature
│       ├── components/ # Timeline UI components
│       ├── hooks/      # Timeline hooks
│       └── utils/      # Timeline utilities
├── lib/                # Shared utilities
├── types/              # TypeScript types
├── constants/          # App constants
└── App.tsx             # Main app component
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed documentation.

## Getting Started

### Prerequisites

- **Node.js** 18+ and npm
- **Rust** and Cargo (latest stable)
- **macOS desktop builds**: FFmpeg and FFprobe are bundled as **Tauri sidecars** (`src-tauri/bin/`). The checked-in files are small wrappers that call `ffmpeg` / `ffprobe` from your **`PATH`** so local `cargo tauri dev` works without copying static binaries. For release DMGs, replace them with static builds per [`src-tauri/bin/README.md`](./src-tauri/bin/README.md) (GPL/LGPL compliance, **code-signing** / notarization for sidecars). Until Linux/Windows sidecars exist, install FFmpeg on those platforms as before.

### Install FFmpeg (dev / non-macOS)

```bash
# macOS (used by sidecar wrappers until you drop in static binaries)
brew install ffmpeg

# Ubuntu/Debian
sudo apt install ffmpeg

# Windows (using Chocolatey)
choco install ffmpeg

# Or download from https://ffmpeg.org/download.html
```

### Installation

```bash
# Clone the repository
git clone https://github.com/AIEraDev/clypra.git
cd clypra

# Install dependencies
npm install

# Run in development mode
npm run tauri dev
```

### Building from Source

```bash
# Build the frontend
npm run build

# Build the Tauri app
npm run tauri build

# The built app will be in src-tauri/target/release/
```

## Development

### Available Scripts

- `npm run dev` - Start Vite dev server
- `npm run build` - Build frontend
- `npm run preview` - Preview production build
- `npm run tauri dev` - Run Tauri app in development
- `npm run tauri build` - Build Tauri app for production

### Tech Stack

**Frontend:**

- React 19
- TypeScript
- Tailwind CSS 4
- Vite 7

**Backend:**

- Tauri 2
- Rust
- FFmpeg (via CLI)

## Usage

1. **Import Media** - Click "Import Media" to select video, audio, or image files
2. **Preview** - Use the video player controls to preview your content
3. **Edit Timeline** - Drag media to the timeline and arrange clips
4. **Trim & Adjust** - Adjust clip start/end times using the timeline
5. **Export** - Click "Export" to save your edited video

### Keyboard Shortcuts

- `Space` - Play/Pause video
- `Ctrl/Cmd + Scroll` - Zoom timeline
- `Trackpad Pinch` - Zoom timeline

## Screenshots

_Coming soon - Add screenshots of your app in action_

## Architecture Highlights

### Feature-Based Organization

The codebase is organized by features rather than file types, making it easy to understand and maintain:

- **Timeline Feature** - Self-contained module with components, hooks, and utilities
- **Shared Libraries** - Common utilities used across features
- **Type Safety** - Full TypeScript coverage with shared type definitions

### Clean Separation of Concerns

- **Components** - Pure UI rendering
- **Hooks** - Reusable stateful logic
- **Utils** - Pure functions for data transformation
- **Constants** - Configuration and theme values

### Performance Optimizations

- Memoized calculations for timeline rendering
- Canvas-based waveform for efficient visualization
- Async filmstrip generation to avoid blocking UI
- Proper cleanup to prevent memory leaks

## Contributing

We welcome contributions from the community! Whether it's:

- 🐛 Bug reports
- 💡 Feature requests
- 📝 Documentation improvements
- 🔧 Code contributions

Please read our [Contributing Guide](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md) before submitting a PR.

### Development

```bash
# Run tests
npm test

# Run tests with UI
npm run test:ui

# Lint code
npm run lint
```

## Roadmap

- [ ] Multi-track audio mixing
- [ ] Video effects and filters
- [ ] Transitions between clips
- [ ] Text and title overlays
- [ ] Export presets for different platforms
- [ ] Keyboard shortcut customization
- [ ] Plugin system

## Community

- **Issues**: [GitHub Issues](https://github.com/AIEraDev/clypra/issues)
- **Discussions**: [GitHub Discussions](https://github.com/AIEraDev/clypra/discussions)
- **Pull Requests**: [Contributing Guide](CONTRIBUTING.md)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Built with [Tauri](https://tauri.app) - Rust-powered desktop apps
- Video processing by [FFmpeg](https://ffmpeg.org)
- UI powered by [React](https://react.dev) and [Tailwind CSS](https://tailwindcss.com)
- Timeline design inspired by professional video editors

## Support

If you find this project useful, please consider:

- ⭐ Starring the repository
- 🐛 Reporting bugs
- 💡 Suggesting new features
- 🔧 Contributing code
- 📢 Sharing with others

---

<div align="center">

Made with ❤️ by the Clypra community

</div>

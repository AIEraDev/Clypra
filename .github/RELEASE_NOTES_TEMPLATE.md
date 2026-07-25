# VireoStudio v0.1.0-alpha.1 - First Alpha Release 🎉

Welcome to **VireoStudio** - a modern, open-source video editor built for creators who value performance, precision, and transparency.

## What is VireoStudio?

VireoStudio is a desktop video editor built with **Tauri**, **React**, and **TypeScript**, powered by **FFmpeg** for video processing. It combines the performance of native desktop apps with the flexibility of modern web technologies, delivering a smooth editing experience without the bloat of traditional video editors.

## Why VireoStudio?

✨ **Native Performance** - Built with Tauri and Rust for minimal memory footprint  
⚡ **GPU-Accelerated Preview** - Real-time video preview powered by WebGL  
🎯 **Frame-Accurate Editing** - Precision timeline with frame-level control  
🔓 **Open Source** - MIT licensed, inspect the code and contribute  
🌍 **Cross-Platform** - Works on macOS, Windows, and Linux

## What's New in Alpha 1

### Core Editing Features

- 🎬 Multi-format import (MP4, MOV, WebM, MKV, MP3, WAV, PNG, JPG, WebP)
- ✂️ Professional multi-track timeline with drag-and-drop
- 🎞️ Filmstrip preview with thumbnail strips
- 📊 Real-time audio waveform visualization
- 🎯 Frame-accurate clip trimming
- ⚡ Fast FFmpeg-powered export

### Text & Typography

- 📝 Production-ready text rendering with deterministic font loading
- 🎨 Rich text controls (font, size, weight, color, alignment, spacing)
- 🔒 Preview-export parity (no layout drift)
- ⚙️ Integrated font preloading system

### User Interface

- 🖥️ Modern editor layout with resizable panels
- 🌙 Professional dark theme
- 🎛️ Real-time properties panel
- 💾 Project persistence

## Known Limitations ⚠️

This is an **alpha release** - expect rough edges:

- No undo/redo system yet
- Limited effects and transitions
- Basic audio controls only
- Possible crashes with large projects
- Limited export format options

## Installation

### macOS (Apple Silicon & Intel)

The recommended way to install VireoStudio on macOS is via **Homebrew Cask** to automatically bypass the Gatekeeper security warnings:

```bash
# Add the custom tap and install the cask
brew install AIEraDev/tap/vireostudio
```

Alternatively, download `VireoStudio_<version>_universal.dmg`, drag VireoStudio to your `/Applications` folder, then Right-click (Control-click) the application icon and select **Open** to authorize execution.

### Windows

Download the `.msi` setup file and run it. If Windows SmartScreen blocks execution, click **More Info** and select **Run Anyway**.

### Linux

Download the `.AppImage` file and make it executable:

```bash
chmod +x VireoStudio*.AppImage
./VireoStudio*.AppImage
```

### Build from Source

```bash
git clone https://github.com/AIEraDev/vireostudio.git
cd vireostudio
npm install
npm run tauri build
```

## We Need Your Feedback! 🙏

This alpha is released to gather real-world feedback:

- **Try it out** - Download, import videos, test the workflow
- **Report bugs** - [Open an issue](https://github.com/AIEraDev/vireostudio/issues) if you find problems
- **Request features** - Tell us what's missing for your workflow
- **Contribute** - Check our [contributing guide](https://github.com/AIEraDev/vireostudio/blob/master/CONTRIBUTING.md)

## Reporting Issues 🐛

Please include:

- Operating system and version
- Steps to reproduce
- Expected vs actual behavior
- Screenshots or recordings
- Console logs (Help → Developer Tools → Console)

## What's Next? 🎯

For v0.1.0 stable release:

- Undo/redo system
- More export formats and presets
- Video transitions and effects
- Audio mixing and volume controls
- Performance optimizations
- Bug fixes from community feedback

## Technical Details 🔧

**Stack:**

- Frontend: React 19, TypeScript, Tailwind CSS 4, Vite 7
- Backend: Tauri 2.0, Rust, FFmpeg
- State: Zustand with optimized stores
- Rendering: WebGL + Canvas API
- Testing: Vitest + React Testing Library

**Performance:**

- Memoized timeline calculations
- Async thumbnail generation
- Efficient canvas-based waveforms
- Frame-accurate playback sync

## License 📄

VireoStudio is MIT licensed - free to use, modify, and distribute.

---

**Thank you for trying VireoStudio!** This is just the beginning. With your feedback and contributions, we'll build a video editor that's powerful, accessible, and truly open.

— The VireoStudio Team

### Full Changelog

See [CHANGELOG.md](https://github.com/AIEraDev/vireostudio/blob/master/CHANGELOG.md) for complete details.

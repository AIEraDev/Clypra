# Changelog

All notable changes to Clypra will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.0] - 2026-07-30

### 📺 Window Preview & WebGL Engine Fixes
- **Blank Window Preview Prevention**: Enforced positive viewport dimensions to prevent WebGL context loss and black/blank preview screens on resize or initialization.
- **Tauri v2 Asset Protocol & CORS**: Resolved `convertFileSrc` double-conversion issues and added CORS headers for WebGL asset loading.
- **Preview Media Pool Isolation**: Prevented query string pollution on Blob URLs in `PreviewMediaPool` and handled benign `AbortError` signals during video play operations gracefully.
- **Canvas & Viewport Background**: Restored Pixi canvas background rendering layer with full aspect ratio support and integrated Background & Canvas Inspector controls.

### 🎙️ Dual-Stream Recording Engine & Hardware Isolation
- **Dual-Buffering Strategy & RAM Optimization**: Implemented streaming disk writes and guaranteed dual-buffering to prevent 0-byte recording outputs and RAM overflow during long sessions.
- **WebAudio Hardware Isolation**: Routed microphone capture through a dedicated WebAudio graph for hardware isolation and unmuted preview playback.
- **WebM Duration & Metadata Prober**: Added HTML5 video metadata prober and seek-based duration detection to resolve infinite WebM duration issues.
- **Auto PiP Timeline Import**: Automatic timeline track creation with Picture-in-Picture layout for dual webcam/screen recordings.
- **macOS Fullscreen Space Handling**: Handled native macOS Space switching during active recording and added window management capabilities.

### ⚡ Export Engine & WebGL PBO Readback
- **WebGL2 PBO Async Readback**: Implemented Pixel Buffer Objects (PBO) async readback, direct WebGL readback, parallel seeks, and double buffering for high-throughput video export.
- **Animated GIF & WebM/VP9 Export Presets**: Added high-quality GIF palette generation and WebM/VP9 output options.
- **Complex Filtergraph Audio Mixing**: Added multi-track audio mixing subsystem with complex filtergraph rendering in FFmpeg exports.
- **Transition Frame Export**: Included transition windows in single-frame, image sequence, WebCodecs mobile, and desktop FFmpeg exports.

### 🎨 Color, GPU Filters & Keyframing
- **Visual Property Keyframing Engine**: Added visual property keyframing types, evaluation engine, and UI toggle controls to `TransformSection` and `PropertySlider`.
- **GPU Chroma Key & Shader Consolidation**: Added WebGL2 GPU chroma key filter and consolidated redundant vertex shader pipelines across effects.
- **3-Way Color Wheels & 3D LUT Importer**: Added professional 3-way color grading wheels and custom 3D LUT file import.

### 🎬 Timeline Precision & Subsystems
- **Sequence End Marker & Boundary Line**: Added sequence end marker and boundary indicator line on the timeline ruler.
- **Unified Coordinate Calculation**: Replaced split pixel calculations in Clip, Gap, and Transition components with single-expression right-edge calculations (`timeToPixel(startTime + duration, pps)`) eliminating 1px boundary drift.
- **Dynamic Viewport Canvas Padding**: Updated timeline canvas duration calculations to include a 5s minimum canvas baseline with 2s look-ahead padding (`getTimelineCanvasDuration`).
- **Clip & Ruler Markers**: Added clip-level markers, ruler markers, and quick navigation.
- **Keyboard Shortcut System & Presets**: Fully customizable key bindings with industry standard preset maps.
- **Built-in Creator Templates**: Added pre-packaged creator project templates.
- **Batch Subtitles & Presets**: Added batch subtitle formatting with custom style presets.

### 🌐 Internationalization (i18n)
- **Multi-Language Support**: Added I18nProvider into root with Traditional Chinese and bidirectional translation support.
- **Native Menu Integration**: Added native menu language commands in Tauri.

### 🧪 Back-to-Back Quality & Test Verification
- **100% Test Pass Rate**: Verified back-to-back testing passes across all 139 frontend test files (1,451 tests) and 77 Rust backend unit tests.
- **Zero Type Errors**: Verified TypeScript compilation clean across all modules (`npx tsc --noEmit`).

## [1.1.1] - 2026-07-13

### 🐛 Bug Fixes

**API Error Handling**

- Added comprehensive error handling and logging to all API clients (transitions, filters, stickers, audio, text effects, video effects)
- API errors now include HTTP status codes and full error messages for better debugging
- Added API key configuration logging on module load to help diagnose authentication issues
- Improved error messages shown to users with actionable information

### ⚡ Performance Improvements

**API Caching**

- Removed `cache: "reload"` from all API fetch calls to enable proper browser caching
- Reduces unnecessary network requests for frequently accessed resources
- Improves load times for media tabs (transitions, filters, stickers, etc.)

### 🔍 Developer Experience

**Debugging**

- All API requests now log detailed information to browser console
- Successful API responses log item counts for verification
- Failed requests show full error context including status codes and error text
- API key presence is verified and logged on application startup

## [1.1.0] - 2026-07-13

## [0.1.0-alpha.1] - 2026-05-11

### 🎉 First Alpha Release

Welcome to **Clypra** - a modern, open-source video editor built for creators who value performance, precision, and transparency. This alpha release marks the first public milestone in our journey to build a professional-grade video editor that's fast, native, and completely open.

**What is Clypra?**

Clypra is a desktop video editor built with Tauri, React, and TypeScript, powered by FFmpeg for video processing. It combines the performance of native desktop apps with the flexibility of modern web technologies, delivering a smooth editing experience without the bloat of traditional video editors.

**Why Clypra?**

- **Native Performance**: Built with Tauri and Rust, Clypra runs as a true desktop application with minimal memory footprint
- **GPU-Accelerated Preview**: Real-time video preview powered by WebGL for smooth playback
- **Frame-Accurate Editing**: Precision timeline with frame-level control for professional results
- **Open Source**: MIT licensed - inspect the code, contribute features, or fork for your own needs
- **Cross-Platform**: Works on macOS, Windows, and Linux from a single codebase

### ✨ What's Included in Alpha 1

**Core Editing Features:**

- 🎬 **Multi-Format Import**: Support for MP4, MOV, WebM, MKV, M4V, AVI videos, MP3, WAV, AAC audio, and JPG, PNG, WebP images
- ✂️ **Professional Timeline**: Multi-track timeline with drag-and-drop, visual ruler, and playhead sync
- 🎞️ **Filmstrip Preview**: Thumbnail strips on clips for easy visual navigation
- 📊 **Audio Waveforms**: Real-time waveform visualization for precise audio editing
- 🎯 **Precision Trimming**: Frame-accurate clip trimming with visual feedback
- ⚡ **Fast Export**: FFmpeg-powered rendering with quality presets

**Text & Typography:**

- 📝 **Production-Ready Text Rendering**: Deterministic font loading and canvas-based text rasterization
- 🎨 **Rich Text Controls**: Font family, size, weight, color, alignment, line height, letter spacing, and padding
- 🔒 **Preview-Export Parity**: Unified rendering path ensures text appears identical in preview and final export
- ⚙️ **Font Preloading**: Integrated font loading system prevents layout shifts and missing fonts

**User Interface:**

- 🖥️ **Modern Editor Layout**: Resizable panels with media library, preview, timeline, and properties
- 🌙 **Dark Mode**: Professional dark theme optimized for long editing sessions
- 🎛️ **Properties Panel**: Adjust clip properties with real-time preview updates
- 💾 **Project Persistence**: Save and load projects with full state restoration

**Developer Experience:**

- 🧪 **Comprehensive Tests**: Core systems covered with unit and integration tests
- 📦 **Type-Safe**: Full TypeScript coverage for maintainability and reliability
- 🏗️ **Clean Architecture**: Modular design with clear separation of concerns
- 📚 **Well-Documented**: Inline documentation and architecture guides

### 🔧 Technical Highlights

**Stack:**

- **Frontend**: React 19, TypeScript, Tailwind CSS 4, Vite 7
- **Backend**: Tauri 2.0, Rust, FFmpeg
- **State Management**: Zustand with optimized stores for timeline, playback, and project data
- **Rendering**: WebGL for GPU-accelerated preview, Canvas API for text and effects
- **Testing**: Vitest with React Testing Library

**Performance:**

- Memoized timeline calculations for smooth scrolling and zooming
- Async thumbnail generation to prevent UI blocking
- Efficient waveform rendering with canvas optimization
- Frame-accurate playback sync with minimal drift

### ⚠️ Known Limitations (Alpha Release)

This is an **alpha release** - it's functional but not feature-complete. Expect rough edges:

- **No Undo/Redo**: Changes are permanent until we implement history management
- **Limited Effects**: No transitions, filters, or advanced effects yet
- **Basic Audio**: No mixing, volume envelopes, or audio effects
- **Export Options**: Limited format and quality presets
- **Stability**: Possible crashes with large projects or unusual file formats
- **Missing Features**: No keyboard shortcut customization, timeline markers, or plugin system

### 🎯 What's Next

We're focused on stability and core functionality for the v0.1.0 release:

- Undo/redo system
- More export formats and presets
- Video transitions and effects
- Audio mixing and volume controls
- Performance optimizations for large projects
- Bug fixes based on community feedback

### 🙏 We Need Your Feedback

This alpha is released to gather real-world feedback from the community:

- **Try it out**: Download, import your videos, and test the editing workflow
- **Report bugs**: Found a crash or unexpected behavior? [Open an issue](https://github.com/AIEraDev/clypra/issues)
- **Request features**: What's missing for your workflow? Let us know
- **Contribute**: Check our [contributing guide](https://github.com/AIEraDev/clypra/blob/master/CONTRIBUTING.md) to get involved

### 📦 Installation

**Download:**

- macOS: `.dmg` installer (Apple Silicon and Intel)
- Windows: `.msi` installer
- Linux: `.AppImage` or `.deb` package

**Build from source:**

```bash
git clone https://github.com/AIEraDev/clypra.git
cd clypra
npm install
npm run tauri build
```

### 🐛 Reporting Issues

Please include:

- Operating system and version
- Steps to reproduce the issue
- Expected vs actual behavior
- Screenshots or screen recordings if applicable
- Console logs (Help → Developer Tools → Console)

### 📄 License

Clypra is MIT licensed - free to use, modify, and distribute.

---

**Thank you for trying Clypra!** This is just the beginning. With your feedback and contributions, we'll build a video editor that's powerful, accessible, and truly open.

— The Clypra Team

[Unreleased]: https://github.com/AIEraDev/Clypra/compare/v0.1.0-alpha.1...HEAD
[0.1.0-alpha.1]: https://github.com/AIEraDev/Clypra/releases/tag/v0.1.0-alpha.1

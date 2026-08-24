# Changelog

All notable changes to Clypra will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.4.2] - 2026-08-24

### 🖱️ Timeline Context Menus & Command Orchestration

- **Clip & Empty-Space Context Menus**: Introduced right-click context menus for timeline clips (`ClipContextMenu`) and empty track regions (`TimelineEmptySpaceContextMenu`), providing instant access to essential editing workflows (Cut, Copy, Duplicate, Split Clip at Playhead, Ripple Delete, Delete, Mute/Unmute, and Properties).
- **Viewport-Aware Context Menu Placement**: Upgraded `ContextMenu` with automated viewport collision detection and flip placement, grouped item support with visual dividers, disabled item states, and shortcut hint badges.
- **Unified Command Layer**: Added `useClipCommands` and `useTimelineCommands` hooks to centralize clip action execution across context menus, the timeline toolbar, and keyboard shortcuts.
- **Structured Clipboard Engine**: Introduced `ClipboardService` for structured multi-clip copy/paste and duplication with track index mapping, playhead offset calculation, and duplicate placement offsets.

### ⚡ Filmstrip & Thumbnail Decoding Optimizations

- **Single-Seek Forward GOP Sweep (`decode_frames_batch_full_res`)**: Accelerated batch thumbnail decoding in Rust by replacing repeated per-frame seeks with a single forward keyframe sweep per chunk.
- **Optimized Hardware Decoding & Color Conversion**: Added static HW-to-CPU frame transfers, format callbacks, `FAST_BILINEAR` 1:1 color conversion, and zero-swscale YUV420P→NV12 conversion paths.
- **Multi-Tier Raster & Pyramid Fallback**: Enhanced `webglRasterSurface` and `FilmstripTileCache` with L0 thumbnail protection/pinning during time-eviction, two-pass LRU cache eviction, and seamless pyramid fallback resolution during high-speed zoom and scrub.
- **Batch Serialization & Coalescing**: Added file-level mutex gating to prevent concurrent duplicate decodes of identical video files, normalized spatial tiers, and coalesced in-flight native batches.
- **Timeline Zoom Spring Synchronization**: Enhanced `useTimelineZoomSpring` and epoch debounce mechanisms to guarantee continuous zooming SLA (sub-150ms resolution) and prevent clip render churn.

### 📊 Real-Time Metrics & Performance HUD

- **Live Filmstrip Performance HUD (`FilmstripMetricsOverlay`)**: Added an in-editor diagnostics HUD toggled via `Cmd+Shift+M` (macOS) / `Ctrl+Shift+M` (Windows/Linux) showing real-time frontend render timings and native Rust backend stats.
- **Frontend Telemetry**: Added telemetry tracking per-tier decode rates, request dispatch frequencies, cache hits/misses, first-artifact latencies, and paint commit durations.
- **Rust Backend Metrics Snapshot**: Added `get_decode_metrics_snapshot` Tauri invoke command backed by atomic metrics accumulators in the thumbnail engine.

### 🎯 UI Polish & Frontend React Optimization

- **Selective Store Subscriptions & Memoization**: Applied granular store selectors and `React.memo` across `TopBar`, `PropertiesPanel`, `Sidebar`, and `TimelineToolbar` to eliminate redundant re-render cycles.
- **Playback Clock Decoupling (`usePlaybackStatus`)**: Replaced high-frequency requestAnimationFrame clock subscriptions in timeline containers with discrete playback status hooks, stopping timeline re-renders on pure time ticks.
- **Reusable Outside-Click Dismissal (`useClickOutside`)**: Unified outside-click and Escape dismissal across layout menus, speed/aspect/quality popovers, and context menus.
- **Popover Stacking & Positioning**: Resolved stacking context and clipping issues in `PreviewTransport` popovers.

### 🖼️ Project Thumbnail Service

- **Background Project Cover Generation**: Added `ProjectThumbnailService` to automatically generate and cache project preview thumbnails in the background during save without blocking the UI thread or marking projects as dirty.
- **Auto-Save Suppression on Hydration**: Suppressed auto-save triggers during initial project loading and state hydration.

### 🐛 Bug Fixes & Process Lifecycle

- **macOS Window Close Process Exit**: Fixed a process hang on macOS window close by listening to the `CloseRequested` window event and cleanly terminating the process across all project states.
- **Auto-Updater Manifest Public URLs**: Fixed auto-updater manifest generation in CI to rewrite GitHub API asset URLs to public download URLs, ensuring unauthenticated clients can fetch update binaries reliably.
- **Cleaned Up Diagnostic Logs**: Removed noisy console logs and `eprintln` spam from hot rendering and playback paths.

### 🧪 Test Verification

- **Comprehensive Test Suite**: Verified 100% pass rate across all 238 frontend test files (1,989 unit/integration tests) and 161 Rust backend unit and stress tests.

## [1.4.1] - 2026-08-23

### 🔊 Native Audio Playback

- **Native Audio Output**: Added native CPAL audio playback with FFmpeg PCM decoding, timeline clip mixing, volume and mute control, and output-device handling.
- **Reliable Seek and Transport**: Fixed stale native clock samples and queued play, pause, and seek commands that could rewind playback to 0s or leave audio silent after seeking.
- **Audio Timeline Synchronization**: Refreshes native audio when clips and assets arrive after startup and keeps native runtime time aligned with the audio clock.
- **Audio Diagnostics**: Added focused audio tracing for decoded clips, device state, callback execution, rendered frames, and non-silent mixer output.

## [1.4.0] - 2026-08-23

### 🚀 Deep Native Migration

- **Native-First Preview and Playback**: Completed the migration of preview, scrubbing, transport, transitions, and source rendering onto the Tauri/Rust native media path.
- **Full Native Media Pipeline**: Unified native decoding, geometry and aspect handling, frame delivery, raster-surface ownership, filmstrip atlases and caching, and export frame pooling for consistent desktop playback and rendering.
- **Native Timeline Integration**: Connected timeline precision, snapping, waveform and envelope editing, gap and transition indicators, and source-time calculations to the native playback contract.
- **Native-Supported Editor Surface**: Reworked desktop and mobile layout composition, resizable panels, sidebar navigation, properties and empty states, and cache and settings flows around the native runtime.
- **Legacy Path Retirement**: Removed the legacy timeline controls and documented the mathematical invariants and performance contracts required by the native pipeline.

### 🧪 Validation

- Verified the TypeScript build, frontend suite, Rust backend suite, Clippy, focused 4K scrub stress, and production build.
- CI validates the frontend, Rust backend, and release build checks on the release PR.

## [1.2.2] - 2026-08-06

### ♻️ Refactoring

- **Codebase Restructuring**: Consolidated `media-panel/` and `media-tabs/` into unified `sidebar/` module with clean `tabs/` submodules
- **Utility Consolidation**: Merged `src/lib/utils.ts` into `src/lib/utils/` with full barrel exports
- **Core Domain Unification**: Relocated playback and monitoring modules into `src/core/`; eliminated single-file folders (`lib/preview`, `lib/window`, `lib/transform`, `lib/sequence`, `lib/video`, `lib/debug`)
- **Hooks Organization**: Grouped timeline hooks into `src/hooks/timeline/` submodule with barrel exports
- **UI Component Hierarchy**: Categorized UI components into `modals/`, `cards/`, and `primitives/` submodules
- **Rust Test Organization**: Moved test files into `thumbnail_engine/` submodules (`tests.rs`, `proptest.rs`, `stress_test.rs`)
- **Worker Consolidation**: Moved `ThumbnailWorkerPool` into `src/workers/` with barrel export
- **Barrel Export Standardization**: Added `index.ts` barrel exports across all top-level `src/` directories (`components`, `constants`, `core`, `features`, `hooks`, `i18n`, `lib`, `services`, `store`, `types`, `workers`)
- **Debug Component Relocation**: Moved `PerformanceOverlay` into `src/components/editor/viewport/`

### 🐛 Bug Fixes

- **Windows Blank Video Preview**: Added `--allow-file-access-from-files` to WebView2 browser arguments and enforced `playsinline` + `crossOrigin=anonymous` on video elements to fix blank preview on Windows
- **Windows GPU Acceleration**: Enabled ANGLE D3D11 rendering and GPU rasterization flags for WebView2 on startup

## [1.2.1] - 2026-07-30

### 🐛 Bug Fixes

- **Rust Clippy Lint**: Resolved `manual_clamp` clippy lint in export.rs by replacing `.min(1.0).max(0.0)` with `.clamp(0.0, 1.0)` for audio panning calculations
- **CI Syntax and Type Errors**: Fixed syntax and type errors in export renderers and timeline toolbar to ensure clean CI builds

### ♻️ Refactoring

- **NPM Package Migration**: Updated from local file references to published NPM packages (`@clypra-studio/engine@^1.1.0`, `@clypra-studio/shaders@^0.1.5`)
- **Build System**: Removed dependency on local clypra-studio source, now using official NPM registry for engine packages

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

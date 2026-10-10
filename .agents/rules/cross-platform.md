# Clypra — Cross-Platform Engineering Constraints
# Loaded automatically from .agents/rules/ by all agent tools.
# Supplements AGENTS.md and .agents/skills/tauri-cross-platform-engineering/SKILL.md.

## 1. Supported Targets & Architecture
- Explicitly supported desktop targets:
  - **macOS**: `aarch64-apple-darwin` (Apple Silicon) and `x86_64-apple-darwin` (Intel) via WKWebView + Metal.
  - **Windows**: `x86_64-pc-windows-msvc` (Windows 10/11) via WebView2 (Chromium) + Direct3D 12.
  - **Linux**: `x86_64-unknown-linux-gnu` via WebKitGTK + Vulkan/Winit/X11/Wayland fallback.
- Never assume support for unverified platforms or mobile targets without explicit requirements.
- Never assume that a successful build or test run on macOS proves readiness on Windows or Linux.

## 2. Zero OS Branching in Core Domain Math
- Timeline calculations, timecode math, framerate conversion, SMPTE arithmetic, clip placement, gap detection, and project serialization must remain 100% platform-agnostic.
- Isolate all OS-specific differences behind localized native adapters, Tauri IPC commands, or environment capability detection.

## 3. WebView Engine Parity
- Keep frontend code resilient across three distinct web rendering engines:
  - Windows: **WebView2** (Chromium-based).
  - macOS: **WKWebView** (Safari WebKit).
  - Linux: **WebKitGTK** (Linux WebKit).
- Be vigilant for engine differences in:
  - Font rendering metrics and text measurement.
  - Color space and canvas alpha compositing.
  - Keyboard event properties (`e.key` vs `e.code`, `metaKey` vs `ctrlKey`).
  - Web Audio API context initialization and autoplay policies.
  - Dialog / focus behavior in popups and modals.

## 4. Filesystem & Path Discipline
- Never concatenate filesystem paths with raw string `/` or `\\` in TypeScript or Rust.
- In TypeScript: Always route file path operations through `nativeCore.ts` path normalization helpers.
- In Rust: Always use `std::path::Path` and `std::path::PathBuf` with canonicalize/strip_prefix guards.
- Respect Windows drive letters, UNC paths, and 260-character MAX_PATH limits where relevant.
- Validate paths against Tauri capabilities and security scopes (`src-tauri/src/commands/security.rs`).

## 5. Process & Sidecar Isolation
- Sidecar binaries (FFmpeg, FFprobe) must be invoked through Tauri's managed sidecar APIs with platform-appropriate executable extensions (`.exe` on Windows).
- Always verify sidecar presence and exit codes; handle missing or corrupt sidecars gracefully with actionable diagnostics rather than panics.

## 6. Three-Gate Cross-Platform Verification
- Changes to native Rust code, IPC protocols, window management, audio backends, or filesystem access must be evaluated for all three targets.
- Report any platform where a change was not physically executed as **unverified on that target**.

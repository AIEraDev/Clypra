# Clypra Platform Compatibility & Cross-Platform Engineering Specification

## 1. Overview & Platform Support Contract

Clypra is a high-performance native desktop video-editing application built with **Tauri v2** (`2.11`), **Rust** (`2021` edition), and a **React 19 / TypeScript 5.8** frontend.
Its core architecture combines native hardware-accelerated video decoding (FFmpeg, VideoToolbox, D3D11VA, VAAPI), a custom GPU compositor built on **wgpu 24** (Metal, DirectX 12, Vulkan), and a real-time low-latency audio engine (CPAL 0.18 + rtrb ring buffers + wsola time-stretching).

Because video editors demand deterministic frame decoding, sub-frame audio synchronization, high-throughput memory streaming, and direct interaction with platform graphics pipelines, Clypra treats cross-platform compatibility not as an incidental web abstraction, but as a **strict engineering contract**.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Clypra NLE Frontend                             │
│       React 19 + TypeScript 5.8 (Zustand v5, Tailwind, Web Audio)      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Webview Protocol & IPC
       ┌────────────────────────────┼────────────────────────────┐
       ▼                            ▼                            ▼
┌──────────────┐             ┌──────────────┐             ┌──────────────┐
│ macOS Engine │             │Windows Engine│             │ Linux Engine │
│ WKWebView    │             │ WebView2     │             │ WebKitGTK    │
│ Metal / wgpu │             │ DX12 / wgpu  │             │ Vulkan / wgpu│
│ VideoToolbox │             │ D3D11VA/DXGI │             │ VAAPI        │
│ CoreAudio    │             │ WASAPI       │             │ ALSA / Pulse │
└──────────────┘             └──────────────┘             └──────────────┘
```

---

## 2. Ten Mandatory Cross-Platform Implementation Requirements

All cross-platform engineering in Clypra must adhere to the following 10 non-negotiable rules:

1. **No implicit target assumptions**: Before adding platform-sensitive behavior, discover Clypra's declared OS and architecture targets. Never claim support for targets that have not been verified.
2. **No unverified platform dependencies**: Before introducing a Tauri plugin, native library, OS API, or WebView-dependent feature, validate its compatibility and document known limitations for every affected target.
3. **No Windows-only development assumptions**: Ensure that path handling, process invocation, permissions, keyboard interactions, media dependencies, and package configuration are evaluated for macOS and Linux whenever those targets are supported.
4. **No single-platform release claims**: A successful Windows build does not establish cross-platform readiness. Required target builds and tests must produce independent, traceable verification results. Any target that cannot be verified must be reported as unverified, and release policy must determine whether publication can proceed.
5. **Compatibility-aware design review**: Cross-platform requirements must be considered during feature planning and architecture reviews, not merely after implementation.
6. **Shared semantics, explicit differences**: Keep editing and project behavior consistent across platforms. Isolate genuine OS-specific differences behind justified adapters, native configuration, or explicit fallbacks.
7. **Platform compatibility is a maintained contract**: Update this document whenever a change adds support, introduces limitations, changes minimum requirements, or alters the tested platform matrix.
8. **Current documentation must be verified**: Use current official Tauri v2 documentation and relevant upstream documentation when determining plugin support, permissions, native dependencies, platform configuration, or WebView behavior. Do not rely on obsolete Tauri v1 assumptions.
9. **Separate support from verification**: Code that compiles is not proof that a feature works. A missing permission, unavailable native dependency, unsupported WebView API, or untested runtime path must be identified explicitly.
10. **Security settings remain restrictive**: Do not widen Tauri capabilities or filesystem scopes merely to make a feature work on a particular OS without a justified security review.

---

## 3. Declared Target Environments

| Target OS | Target Triple | Min OS Requirement | Architectures | Window / WebView Shell | Graphics / Compositor Backend | Media Decode & HW Accel |
|---|---|---|---|---|---|---|
| **macOS Desktop** | `aarch64-apple-darwin`<br>`x86_64-apple-darwin` | macOS 12 (Monterey)+ | Apple Silicon (M1+)<br>Intel 64-bit | WKWebView (`macOSPrivateApi: true`) | Metal (`wgpu 24`) via `CAMetalLayer` native surface | VideoToolbox (`VTDecompressionSession`), static FFmpeg 8.x |
| **Windows Desktop** | `x86_64-pc-windows-msvc` | Windows 10 (1809+, Build 17763) / 11 | x86_64 (64-bit) | Microsoft Edge WebView2 (Chromium Evergreen) | DirectX 12 (`wgpu 24`) | D3D11VA with DXGI zero-copy shared surface import, static FFmpeg 8.x |
| **Linux Desktop** | `x86_64-unknown-linux-gnu`<br>`aarch64-unknown-linux-gnu` | Ubuntu 22.04 LTS+, Debian 12+, Fedora 38+ (glibc 2.31+) | x86_64<br>AArch64 | WebKitGTK 4.1 (`libwebkit2gtk-4.1-dev`) | Vulkan (`wgpu 24`), Mesa Lavapipe software rasterizer fallback | VAAPI (`libva-dev`), static FFmpeg 8.x |
| **Mobile (iOS/Android)** | *N/A (Capacitor sync)* | Experimental / Roadmap | N/A | Capacitor Web Shell | WebGL / Canvas fallback | Web Audio / HTML5 Video (No native desktop engine) |

> [!NOTE]
> Mobile targets (Capacitor) exist in `package.json` for prospective remote workspace control and preview syncing, but are explicitly **excluded from desktop NLE release readiness validation**.

---

## 4. Platform Support & Capability Matrix

Statuses:
- **Fully supported**: Meets all documented functional requirements with automated test coverage and execution evidence.
- **Supported with limitations**: Functions reliably with documented platform-specific constraints, fallbacks, or performance characteristics.
- **Unsupported**: Not available or disabled by architectural design on this target.
- **Unverified**: Insufficient test execution or missing physical hardware validation.

| Feature Subsystem | Windows | macOS | Linux | Verification Evidence | Contract & Behavioral Differences |
|---|---|---|---|---|---|
| **Project creation and save** | **Fully supported** | **Fully supported** | **Fully supported** | `platformDeviceAndPaths.test.ts`, atomic swap tests | JSON project schemas (`.clypra`, atomic writes via temporary swap files). Case-sensitive filesystem considerations on Linux vs case-preserving on macOS (APFS) / Windows (NTFS). |
| **Media import and relinking** | **Fully supported** | **Fully supported** | **Fully supported** | `mediaTimelineRegression.test.ts`, native file access tests | Inverse conversion (`toNativePath`) handles `asset://localhost/` on macOS/Linux vs Windows drive letter mapping (`/C:/...` $\rightarrow$ `C:/...`). UNC paths supported on Windows. |
| **Video preview (Web & Native)**| **Fully supported** | **Fully supported** | **Supported with limitations** | `ProgramPreview.renderLoop.test.ts` (155 tests), `multi_track_compositor_tests.rs` (16 tests) | macOS uses Metal (`CAMetalLayer`). Windows uses DirectX 12. Linux uses Vulkan; in headless CI or VM environments without dedicated hardware, Mesa Lavapipe software rasterizer acts as fallback. |
| **Audio preview & sync** | **Fully supported** | **Fully supported** | **Fully supported** | `nativeAudioTimeline.test.ts`, `audioClipsExportRangeFades.test.ts`, `audio_callback_realtime_safety.rs` | macOS CoreAudio (low default buffer latency ~5.8ms). Windows WASAPI (exclusive/shared mode). Linux ALSA/PulseAudio (configured with fallback buffer padding to prevent underruns). |
| **Timeline and compositing** | **Fully supported** | **Fully supported** | **Fully supported** | `src/core/evaluation/` suites, `multi_track_compositor_tests.rs` | Pure, deterministic timeline mathematics with zero OS branching. EvaluatedScene emitted consistently across all targets. |
| **FFmpeg rendering & export** | **Fully supported** | **Fully supported** | **Supported with limitations** | `run_wgpu_smoke_test`, `videoExport.ts` unit tests | Hardware export encoders: VideoToolbox on macOS, NVENC/AMF/QSV/D3D11VA on Windows, VAAPI on Linux. Software CPU fallback available across all platforms. |
| **Keyboard shortcuts** | **Fully supported** | **Fully supported** | **Fully supported** | `shortcutStore.ts` unit tests, `windowPlatform.ts` | Command (`⌘`) on macOS vs Control (`Ctrl`) on Windows/Linux. Alternate modifier displays (`⌥` vs `Alt`). Accel parsing handled centrally in `shortcutStore.ts`. |
| **Installer, startup & smoke** | **Fully supported** | **Fully supported** | **Fully supported** | `npm run smoke:bundle` (`scripts/smoke-test-packaged-app.mjs`), `scripts/verify-msix-staging.mjs` | macOS: `.dmg` / `.app` with Developer ID signing & notarization. Windows: `.msi`, `.exe`, and Microsoft Store MSIX. Linux: `.deb` and `.AppImage`. Process startup validated via smoke script. |
| **Native permissions & access**| **Supported with limitations** | **Fully supported** | **Supported with limitations** | `src-tauri/src/commands/permissions.rs`, `Entitlements.plist` | macOS enforces strict TCC permissions (Camera, Microphone, Screen Recording via `Entitlements.plist`). Windows and Linux rely on OS-level device access without runtime TCC prompts. |
| **Bundled sidecars (FFmpeg)** | **Fully supported** | **Fully supported** | **Fully supported** | `scripts/verify-sidecars.mjs`, `scripts/ensure-sidecars.mjs` | Standalone GPL FFmpeg + FFprobe sidecars bundled in `src-tauri/bin/`. Validated against architecture naming triple and binary magic headers (`feedface`/`cafebabe` on macOS, `4d5a` on Windows, `7f454c46` on Linux). |
| **Application updater** | **Supported with limitations** | **Fully supported** | **Supported with limitations** | `tauri.conf.json`, `tauri.microsoftstore.conf.json` | Native Tauri updater (`latest.json`) enabled on GitHub release bundles. Explicitly disabled in Store package (`tauri.microsoftstore.conf.json`) to satisfy Store certification rules. |

---

## 5. WebView Engine Nuances & Behavioral Mitigations

Because Tauri relies on the platform's native webview component, subtle rendering, security, and DOM execution differences arise:

### 5.1 Microsoft Edge WebView2 (Windows)
- **Engine**: Chromium Evergreen.
- **Path Semantics**: Windows drive letters require slash normalization. `toNativePath()` strips leading slashes (`/C:/path` $\rightarrow$ `C:/path`).
- **Filesystem Locking**: Windows locks files open in other processes. Atomic project saves must retry on `EBUSY` / `EACCES` during file replacement.
- **GPU Acceleration**: WebView2 shares the DirectX swapchain. High-DPI scaling requires fractional pixel snapping guards to prevent subpixel hairline seams in the timeline ruler.

### 5.2 Apple WKWebView (macOS)
- **Engine**: Safari WebKit.
- **Window Decorations**: `titleBarStyle: "Overlay"` leaves the traffic-light buttons (close, minimize, zoom) floating over the web content. Clypra adds conditional CSS padding (`pl-[76px]`) in `TopBar.tsx` and `LaunchScreen.tsx` when `isMacOSPlatform()` is true.
- **Asset Protocol**: Uses `asset://localhost/<encoded-path>` instead of `http://asset.localhost/`.
- **Keyboard Handling**: WebKit traps certain `keydown` events (such as `Cmd+H` or `Cmd+Q`) at the menu layer before JavaScript receives them. Centralized accelerators must respect native menu bindings.

### 5.3 WebKitGTK 4.1 (Linux)
- **Engine**: GTK WebKit.
- **Display Server Interleaving**: Wayland versus X11 yields differing drag-and-drop MIME types and window positioning behavior. Drag-and-drop handlers parse both `text/uri-list` and raw file paths.
- **Headless Execution**: WebKitGTK crashes if executed without an active X11 display. In headless CI runners, tests and smoke scripts must execute wrapped with `xvfb-run -a`.
- **Readback Performance**: PBO / WebGL readback throughput is lower on Linux software rasterizers, necessitating the adaptive readback policy's lower tier cadences (15–24 fps).

---

## 6. Architectural Boundaries: Platform Independence vs Native Adapters

Clypra strictly isolates core editing domain models from operating system peculiarities:

```
┌────────────────────────────────────────────────────────┐
│               Core NLE Domain Logic                    │
│  - PlaybackClock (Single time source, microsecond ticks)│
│  - EvaluatedScene & MediaTimeline math                 │
│  - Timeline Command Pattern & History Store            │
│  - Audio-Video sync invariants                         │
│  (STRICTLY PLATFORM-INDEPENDENT — 0 OS branching)      │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│              Platform Boundary Interfaces              │
│  - PlatformInterface (`src/core/platform/platform.ts`)  │
│  - Path conversion (`src/lib/platform/pathConversion.ts`)│
│  - Native Audio Adapter (`src/core/audio/nativeAudio...`)│
│  - Rust Commands (`src-tauri/src/commands/`)           │
└───────────────────────────┬────────────────────────────┘
                            │
    ┌───────────────────────┼───────────────────────┐
    ▼                       ▼                       ▼
[ macOS Adapters ]   [ Windows Adapters ]   [ Linux Adapters ]
- VideoToolbox       - D3D11VA / DXGI       - VAAPI
- CAMetalLayer       - Direct3D 12          - Mesa Vulkan
- CoreAudio          - WASAPI               - ALSA / Pulse
- TCC Entitlements   - MSIX Manifest        - Linux deb/AppImage
```

### 6.1 The Four-Part Architectural Decision Framework

When designing or reviewing features in Clypra, all engineering decisions must be categorized according to the four-part architectural contract:

1. **Shared by default**:
   - Timeline mathematics, timecode conversion, gap calculation, split/trim logic.
   - Project data models, undo/redo history commands, and application state machines.
   - EvaluatedScene graph construction and rendering intent.
   - *Constraint*: Pure, deterministic logic with zero `cfg(target_os)` or platform branching allowed.

2. **Abstracted when necessary**:
   - Filesystem paths and directory structure normalization (`toNativePath`).
   - Native file pickers and dialog interactions (`dialog:default`).
   - Process execution and bundled sidecar management (`std::process::Command` without shell interpretation).
   - Low-level audio streaming and device selection (CPAL hardware abstraction).
   - *Constraint*: Must be isolated behind well-typed interfaces (`PlatformInterface`, centralized path helpers).

3. **Explicitly conditional**:
   - Hardware-accelerated video decoding (Apple VideoToolbox vs Microsoft D3D11VA vs Linux VAAPI).
   - Window styling and title bar decoration accommodations (macOS traffic lights `pl-[76px]` padding).
   - OS-level permission requests (macOS TCC Entitlements for camera, microphone, screen recording).
   - Packaging and distribution configurations (MSIX manifest vs DMG notarization).
   - *Constraint*: Must fail gracefully to documented cross-platform fallbacks (e.g. software CPU decode when HW accel is unavailable).

4. **Independently verified**:
   - Every claimed operating system, CPU architecture, and distribution package must produce traceable, reproducible verification evidence.
   - *Constraint*: Success on one OS (such as Windows) never establishes readiness on another (such as macOS or Linux).

### 6.2 Rules for Platform-Specific Code

1. **Zero `cfg(target_os)` in Timeline Math**: Calculations involving timecodes, frame rates, gap detection, split operations, or keyframe curves must never branch on operating system.
2. **Localized Native Adapters**: All Rust OS branching must be concentrated in `src-tauri/src/commands/native_surface.rs`, `src-tauri/src/wgpu_compositor/adapter_selector.rs`, `src-tauri/src/thumbnail_engine/decoder.rs`, and `src-tauri/src/commands/permissions.rs`.
3. **Safe Path Normalization**: All native paths passed across Tauri IPC or consumed from asset URLs must pass through `toNativePath()` on the frontend and `std::path::Path::canonicalize` or safe sanitization on Rust. Never concatenate path strings with `/` or `\`.
4. **Tauri v2 Plugin Verification**: Before adding or updating Tauri plugins, consult the official Tauri v2 plugin support table for macOS, Windows, and Linux. Never widen security capabilities beyond the strict least-privilege scope required for functionality.

---

## 7. Bundled Native Sidecars (FFmpeg Runtime)

Clypra bundles dedicated FFmpeg and FFprobe binaries in `src-tauri/bin/` to avoid requiring end-users to install external dependencies:

- **Naming Convention**: `ffmpeg-<target-triple>[.exe]` and `ffprobe-<target-triple>[.exe]`.
- **Verification Script**: [`scripts/verify-sidecars.mjs`](file:///Users/AIEraDev/Documents/clypra-family/clypra/scripts/verify-sidecars.mjs) validates executable status, minimum file size (>1 MB), and binary magic numbers before packaging.
- **Assurance Script**: [`scripts/ensure-sidecars.mjs`](file:///Users/AIEraDev/Documents/clypra-family/clypra/scripts/ensure-sidecars.mjs) runs during `npm run predev` and build stages to auto-provision verified binaries.

---

## 8. Cross-Platform Verification & CI Strategy

Clypra enforces a strict **Three-Gate CI Architecture** to ensure fast developer feedback while guaranteeing cross-platform correctness before release:

```
┌────────────────────────────────────────────────────────────────────────┐
│ Gate A — Pull Request Fast Validation (Every PR & Push)                │
│ - Strict type safety (`tsc --noEmit`: 0 errors)                        │
│ - Documentation integrity (`npm run docs:check`: 0 broken links)       │
│ - Append-only preview render loop regression suite (155 tests)         │
│ - Domain unit & integration suites (Clip, Track, Media, Audio)         │
│ - Linux Cargo tests & Windows compilation check (`cargo check`)        │
│ - Packaged application bundle smoke check (`npm run smoke:bundle`)     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ Gate B — Platform Regression Validation (Nightly / Core Native Engine) │
│ - Headless GPU compositor test suite using Mesa Lavapipe Vulkan        │
│ - Audio callback real-time safety & CPAL buffer underrun regression    │
│ - Native golden shader rendering parity across Metal, DX12, and Vulkan │
│ - Long-running export and thumbnail extraction stress tests            │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ Gate C — Release Candidate Validation (Version Tag / Distribution)    │
│ - Target-specific release package builds (.dmg, .msi, .deb, MSIX)      │
│ - Cryptographic sidecar binary verification (`verify-sidecars.mjs`)    │
│ - MSIX package staging & manifest validation (`verify-msix-staging.mjs`)│
│ - Native code signing (Apple Developer ID + Notarize, Authenticode)    │
│ - Real-platform smoke execution on native target runners               │
│ - Enforce Rule 4: No Single-Platform Release Claims                    │
└────────────────────────────────────────────────────────────────────────┘
```

### 8.1 Verification Tier Summary

| Verification Tier | Frequency | Executed On | Validation Target |
|---|---|---|---|
| **TypeScript & Lint** | Gate A (Every PR/Push) | `ubuntu-latest` | Strict zero-error type safety (`tsc --noEmit`), doc link integrity (`docs:check`) |
| **Render Loop Suite** | Gate A (Every PR/Push) | `ubuntu-latest` | Append-only preview render loop regression suite (155 tests) |
| **Domain Unit Tests** | Gate A (Every PR/Push) | `ubuntu-latest` | Vitest suites (`Clip`, `Track`, `nativeAudioTimeline`, `mediaTimelineRegression`) |
| **Rust Backend Tests** | Gate A (Every PR/Push) | `ubuntu-latest` | `cargo test` and `cargo clippy -D warnings` on Linux |
| **Headless GPU Tests** | Gate A / Gate B | `ubuntu-latest` | `cargo test --test multi_track_compositor_tests -- --ignored` using Mesa Lavapipe Vulkan |
| **Windows Compilation** | Gate A (Every PR/Push) | `windows-latest` | `cargo check` linking against static FFmpeg on Windows MSVC |
| **Native Golden Shaders**| Gate B (Shader changes) | macOS, Windows, Linux | `native-golden.yml` pixel-level shader and render fixture parity |
| **Package Smoke Test** | Gate A (Every PR/Push) | `ubuntu-latest` | `npm run smoke:bundle` verifying bundle mount node, MSIX staging, binary startup |
| **Release Artifacts** | Gate C (Release Tag) | macOS, Windows, Linux | Multi-target installer creation, sidecar validation, and signing |

---

## 9. Definition of Done for Cross-Platform Changes

A change touching platform-sensitive code is complete only when:
1. **Contract Consistency**: User-visible behavior meets the same functional specification across macOS, Windows, and Linux.
2. **Explicit Fallbacks**: Documented fallback mechanisms exist for hardware-dependent features (e.g. software decode when D3D11VA/VideoToolbox is unavailable).
3. **Zero TypeScript Errors**: `npx tsc --noEmit` passes with 0 errors.
4. **Link Integrity**: `npm run docs:check` validates documentation link consistency.
5. **No Regressions**: All 155 preview render loop tests pass without deletions or skips.
6. **Platform Matrix Updated**: Any changes in capability or limitations are recorded in this document.
7. **Traceable Verification**: Any unverified platform or capability is explicitly reported as unverified.

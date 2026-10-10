---
name: tauri-cross-platform-engineering
description: >-
  Guides AI agents through cross-platform engineering, Tauri v2 webview parity,
  platform-specific adapters, path resolution, and multi-OS verification in Clypra.
  Activate when implementing OS-sensitive features, modifying Tauri commands or plugins,
  handling filesystems or external processes, adjusting window or keyboard behavior,
  or resolving discrepancies between macOS, Windows, and Linux.
---

# Tauri Cross-Platform Engineering Skill

## Mission

Engineer Clypra as a reliable cross-platform application built with **Tauri v2**, preserving consistent product behavior across every explicitly supported operating system while accounting for genuine differences in native APIs, WebViews, dependencies, packaging, security, performance, and user experience.

This skill supplements the repository's `AGENTS.md`, architecture documentation, NLE engineering skill, senior-engineer decision-making skill, and testing requirements. It does not replace them.

The objective is not to make every line of code identical across operating systems. It is to ensure that each supported platform implements the same intended product contract, with explicit and verified exceptions where platform differences require them.

**Governing Principle**:
Never assume that code working on the current developer's machine is cross-platform correct.
*One product contract, explicit platform boundaries, independently verified target support, and no assumption that success on one operating system proves success on another.*

---

## Non-Negotiable Implementation Requirements

All agents and contributors must strictly enforce these 10 implementation invariants:

1. **No implicit target assumptions**: Before adding platform-sensitive behavior, discover Clypra's declared OS and architecture targets. Never claim support for targets that have not been verified.
2. **No unverified platform dependencies**: Before introducing a Tauri plugin, native library, OS API, or WebView-dependent feature, validate its compatibility and document known limitations for every affected target.
3. **No Windows-only development assumptions**: Ensure that path handling, process invocation, permissions, keyboard interactions, media dependencies, and package configuration are evaluated for macOS and Linux whenever those targets are supported.
4. **No single-platform release claims**: A successful Windows build does not establish cross-platform readiness. Required target builds and tests must produce independent, traceable verification results. Any target that cannot be verified must be reported as unverified, and release policy must determine whether publication can proceed.
5. **Compatibility-aware design review**: Cross-platform requirements must be considered during feature planning and architecture reviews, not merely after implementation.
6. **Shared semantics, explicit differences**: Keep editing and project behavior consistent across platforms. Isolate genuine OS-specific differences behind justified adapters, native configuration, or explicit fallbacks.
7. **Platform compatibility is a maintained contract**: Update [`docs/engineering/platform-compatibility.md`](file:///Users/AIEraDev/Documents/clypra-family/clypra/docs/engineering/platform-compatibility.md) whenever a change adds support, introduces limitations, changes minimum requirements, or alters the tested platform matrix.
8. **Current documentation must be verified**: Use current official Tauri v2 documentation and relevant upstream documentation when determining plugin support, permissions, native dependencies, platform configuration, or WebView behavior. Do not rely on obsolete Tauri v1 assumptions.
9. **Separate support from verification**: Code that compiles is not proof that a feature works. A missing permission, unavailable native dependency, unsupported WebView API, or untested runtime path must be identified explicitly.
10. **Security settings remain restrictive**: Do not widen Tauri capabilities or filesystem scopes merely to make a feature work on a particular OS without a justified security review.

---

## 1. Establish the Platform Support Contract

Before implementing platform-sensitive behavior, inspect the repository and establish which operating systems and architectures Clypra actually targets:
- **Windows Desktop**: Windows 10 (1809+, build 17763) and Windows 11, `x86_64-pc-windows-msvc`. WebView2, DirectX 12, D3D11VA with DXGI zero-copy shared surface import, WASAPI, `.msi`/`.exe`/MSIX.
- **macOS Desktop**: macOS 12 Monterey+, `aarch64-apple-darwin` (Apple Silicon) and `x86_64-apple-darwin` (Intel). WKWebView (`macOSPrivateApi: true`), Metal (`CAMetalLayer`), VideoToolbox, CoreAudio, `.dmg`/`.app`.
- **Linux Desktop**: Ubuntu 22.04 LTS+, Debian 12+, Fedora 38+ (glibc 2.31+), `x86_64-unknown-linux-gnu` and `aarch64-unknown-linux-gnu`. WebKitGTK 4.1 (`libwebkit2gtk-4.1-dev`), Vulkan (Mesa Lavapipe fallback), VAAPI, ALSA/PulseAudio, `.deb`/`.AppImage`.
- **Mobile (Capacitor)**: Experimental/Roadmap only — not part of desktop NLE release validation.

Always document and consult the authoritative record at:
[`docs/engineering/platform-compatibility.md`](file:///Users/AIEraDev/Documents/clypra-family/clypra/docs/engineering/platform-compatibility.md)

---

## 2. Treat the Platform Matrix as an Engineering Contract

For each important feature, record its support status separately for every supported platform using these explicit statuses:
- **Fully supported**: The feature meets its documented functional requirements and has appropriate verification evidence.
- **Supported with limitations**: The feature works with documented restrictions, fallbacks, or environment requirements.
- **Unsupported**: The product does not provide the feature on that platform.
- **Unverified**: There is insufficient evidence to make a support claim.

Do not label an untested feature fully supported simply because the code compiles.

The matrix covers:
- Application startup and window lifecycle.
- File open, save, import, export, and drag-and-drop.
- Filesystem paths, permissions, and project storage.
- Keyboard shortcuts, menus, focus, and accessibility.
- Clipboard, shell integration, notifications, and global shortcuts.
- WebView APIs, browser-specific CSS, fonts, and input behavior.
- Native Tauri commands and plugin support.
- Process execution and bundled FFmpeg binaries.
- Audio devices, video decoding, GPU acceleration, and rendering.
- Project compatibility and media relinking.
- Installation, signing, updates, and uninstallation.

---

## 3. Inspect Tauri and WebView Compatibility

Before relying on a platform-sensitive frontend or native API, verify its current support and limitations using official Tauri v2 documentation.

Account for actual host webview implementations:
- **Windows**: Microsoft Edge WebView2 (Chromium Evergreen). Normalized drive-letter paths, case-insensitive NTFS, process file locks (`EBUSY`), DirectX swapchain.
- **macOS**: Apple WKWebView (Safari WebKit). Custom title bar overlay padding (`pl-[76px]` for traffic lights in `TopBar.tsx`), TCC permissions (camera/mic/screen recording), `asset://localhost/` protocol.
- **Linux**: WebKitGTK 4.1. Display server nuances (Wayland vs X11), drag-and-drop MIME types (`text/uri-list`), headless execution requires `xvfb-run -a`, PBO/WebGL readback cadence limits.

Do not assume that a feature available in Chromium exists with equivalent behavior in WebKit.

For NLE preview and rendering, do not depend unnecessarily on browser-native media capabilities when Clypra's media engine is responsible for that behavior.

Choose an explicit strategy:
1. A common implementation supported across all declared targets.
2. A documented platform-specific adapter.
3. A justified feature fallback.
4. A clearly documented platform limitation.

---

## 4. Design Explicit Platform Boundaries

Keep core product logic independent of platform-specific implementation details:

### The Core Architectural Contract
- **Shared by default**: Timeline mathematics, project semantics, editing behavior, application-level state transitions, render graph construction, and rendering intent.
- **Abstracted when necessary**: Filesystem paths, native dialogs, external process management, OS integration, and platform-specific multimedia behavior.
- **Explicitly conditional**: Features that genuinely cannot be supported equally across declared targets.
- **Independently verified**: Every OS, supported architecture, and packaged runtime claimed to be supported.

### Boundary Rules
- **Zero OS branching in timeline math**: Keyframing, timecode calculation, gap management, split operations, and audio-video synchronization must never contain `cfg(target_os)`.
- **Localized native adapters**: Concentrate Rust OS branching in dedicated adapters: `src-tauri/src/commands/native_surface.rs`, `src-tauri/src/wgpu_compositor/adapter_selector.rs`, `src-tauri/src/thumbnail_engine/decoder.rs`, and `src-tauri/src/commands/permissions.rs`.
- **Typed Frontend Interfaces**: Use `PlatformInterface` ([`src/core/platform/platform.ts`](file:///Users/AIEraDev/Documents/clypra-family/clypra/src/core/platform/platform.ts)) and `toNativePath` ([`src/lib/platform/pathConversion.ts`](file:///Users/AIEraDev/Documents/clypra-family/clypra/src/lib/platform/pathConversion.ts)).

---

## 5. Handle Filesystem and Process Differences Deliberately

Never assume Windows, macOS, and Linux share filesystem semantics:
- **Path Separators & Canonicalization**: Never concatenate paths with `/` or `\`. In TypeScript, use `joinPaths` or standard URL parsing; in Rust, use `std::path::PathBuf`.
- **Inverse Path Conversion**: All webview URLs (`asset://...`, `file://...`, `http://asset.localhost/...`) must be normalized with `toNativePath()` before passing to Rust IPC. On Windows, strip leading slashes before drive letters (`/C:/...` $\rightarrow$ `C:/...`).
- **File Locking**: Windows enforces mandatory file locking on open files. Project saves must use atomic writes via temporary swap files and handle retry logic on `EBUSY`/`EACCES`.
- **Executable Discovery & Arguments**: Never invoke executables through shell interpolation (`sh -c` or `cmd /c`). Use direct argument arrays: `std::process::Command::new(binary).args(&[...])`.
- **Bundled Sidecars**: Bundled FFmpeg/FFprobe binaries in `src-tauri/bin/` must follow architecture naming triples and pass cryptographic/magic header verification (`scripts/verify-sidecars.mjs`).

---

## 6. Verify Plugin, Dependency, and Native Feature Support

Before adding or upgrading a Tauri plugin or native dependency:
1. Verify official support in Tauri v2 documentation for macOS, Windows, and Linux.
2. Determine whether support is complete, partial, or absent.
3. Inspect relevant native dependencies and build requirements (e.g. `libwebkit2gtk-4.1-dev`, `libasound2-dev`).
4. Identify runtime assumptions and security requirements.
5. Establish fallback behavior on unsupported targets.
6. Add appropriate compatibility tests.
7. Update [`docs/engineering/platform-compatibility.md`](file:///Users/AIEraDev/Documents/clypra-family/clypra/docs/engineering/platform-compatibility.md).

---

## 7. Preserve Consistent UX Without Erasing OS Conventions

Shared product workflows must remain conceptually consistent while respecting meaningful OS conventions:
- **Keyboard Shortcuts**: Use centralized accelerator resolution in `shortcutStore.ts`. Display `⌘` and `⌥` on macOS; display `Ctrl` and `Alt` on Windows and Linux.
- **Window Controls & Title Bars**: On macOS, respect the top-left traffic lights by offsetting header controls with `pl-[76px]` or `ml-[76px]`. On Windows and Linux, render window title bar controls according to system conventions.
- **Native File Pickers**: Use native Tauri dialogs (`dialog:default`) rather than web `<input type="file">` to ensure native system file pickers with correct OS file filtering.
- **Theme & Appearance**: Respect system dark/light mode preferences via standard media queries and theme stores.

---

## 8. Apply Compatibility Analysis to Every Feature

Before implementing any cross-platform feature, answer these 8 mandatory questions:
1. **User Contract**: What user-visible behavior must remain identical across all OS targets?
2. **OS Dependencies**: Which operating-system APIs or runtime libraries does it depend on?
3. **Declared Target Support**: Are those APIs supported on macOS 12+, Windows 10/11, and Ubuntu 22.04+?
4. **WebView Nuances**: Does the feature rely on behavior that differs between WKWebView, WebView2, and WebKitGTK?
5. **Plugins & Capabilities**: Does it introduce a new Tauri plugin or require capability permissions in `src-tauri/capabilities/`?
6. **Filesystem & Hardware**: Does it behave differently with case sensitivity, file locking, GPU adapters, or audio drivers?
7. **Graceful Fallbacks**: What happens when the preferred hardware or native capability is unavailable?
8. **Verification Evidence**: What automated test or CI job proves that the feature works on each target?

---

## 9. Cross-Platform Testing Strategy

Use several complementary forms of verification:
- **Static & Unit Testing**: Verify shared business logic, platform abstraction contracts, path handling, and error mapping (`tsc --noEmit`, Vitest).
- **Native Compilation**: Build separately for each supported OS and architecture.
- **Integration Testing**: Exercise native dialogs, filesystem access, process management, and platform adapters.
- **End-to-End Testing**: Run critical user workflows (startup, import, playback, audio sync, save, export) on actual platform environments.
- **Package Validation**: Validate the produced distribution package (`npm run smoke:bundle`, `scripts/smoke-test-packaged-app.mjs`) to verify process startup, entrypoint mounting, and sidecars.

---

## 10. Cross-Platform CI and Release Requirements (Three Gates)

Structure CI verification around three distinct gates:

```
┌────────────────────────────────────────────────────────────────────────┐
│ Gate A — Pull Request                                                  │
│ - Strict type checking (`tsc --noEmit`), doc link integrity            │
│ - Preview render loop regression suite (155 tests)                     │
│ - Linux Cargo tests & Windows `cargo check`                            │
│ - Packaged application bundle smoke check (`npm run smoke:bundle`)     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ Gate B — Platform Regression                                           │
│ - Deeper multimedia, filesystem, and native engine suites              │
│ - Headless GPU compositor suite with Mesa Lavapipe Vulkan              │
│ - Real-time audio callback safety & CPAL buffer regression tests       │
│ - Native golden shader rendering parity across Metal, DX12, Vulkan     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ Gate C — Release Candidate Validation                                  │
│ - Build target-specific release artifacts (.dmg, .msi, .deb, MSIX)     │
│ - Cryptographic sidecar binary verification (`verify-sidecars.mjs`)    │
│ - Code signing (Apple Developer ID + Notarization, Windows Authenticode)│
│ - Independent verification evidence required for every target          │
└────────────────────────────────────────────────────────────────────────┘
```

**Rule**: Do not publish a release for a declared target whose mandatory release checks failed or were never executed.

---

## 11. Architecture and Design Decisions

When a feature requires substantial platform-specific behavior, evaluate alternatives before implementation:
- Is a common implementation feasible?
- Is a small platform adapter sufficient?
- Does an existing Tauri v2 API or official plugin solve the problem?
- Would an additional dependency constrain supported targets?
- Is the fallback consistent with the product contract?
- Does platform-specific behavior introduce maintenance or testing debt?

For major decisions, record the selected approach, trade-offs, and verification plan in an ADR under `docs/architecture/adr/`.

---

## 12. Security and Failure Handling

Follow Tauri's capability-based security model:
1. **Restrictive Scopes**: Grant only specific filesystem scopes (e.g. `$APPCACHE`, `$APPDATA`, `$DOCUMENT`, `$VIDEO`) in `src-tauri/capabilities/default.json`. Never grant root filesystem access.
2. **Sidecar Restriction**: Sidecar permissions are isolated to `src-tauri/capabilities/sidecar.json` (`bin/ffmpeg`, `bin/ffprobe`).
3. **Store Policy Compliance**: For Microsoft Store MSIX distribution, disable automatic updater endpoints in `src-tauri/tauri.microsoftstore.conf.json`.
4. **Actionable Diagnostics**: Return user-safe, descriptive errors when a native operation fails. Never fail silently or discard project data.

---

## 13. Definition of Done Checklist

A platform-sensitive change is complete only when:
- [ ] User contract is identical across macOS, Windows, and Linux, with documented exceptions.
- [ ] Domain logic remains pure and platform-independent (no scattered `cfg(target_os)`).
- [ ] Path handling uses `toNativePath()` and supports Windows drive letters, Unix paths, and asset URLs.
- [ ] No shell interpolation is used for external process or sidecar invocation.
- [ ] `npx tsc --noEmit` passes with 0 errors.
- [ ] `npm run docs:check` passes with 0 broken links.
- [ ] Relevant Vitest suites and `cargo test` pass cleanly.
- [ ] `npm run smoke:bundle` passes all bundle, manifest, and process startup checks.
- [ ] [`docs/engineering/platform-compatibility.md`](file:///Users/AIEraDev/Documents/clypra-family/clypra/docs/engineering/platform-compatibility.md) is updated when support or limitations change.
- [ ] Every unverified target or environment is explicitly reported in the completion summary.

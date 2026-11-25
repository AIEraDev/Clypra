# ADR-0004: iOS Native Engine Spike and Shell Decision

## Status

Proposed

## Context & Problem Statement

Clypra's native preview (wgpu compositor, VideoToolbox decode, Metal zero-copy
import) runs on macOS. Mobile today is a frozen Capacitor web shell with no
native engine. We need to decide how to bring the engine to iPhone, and to find
out cheaply whether it can run there at all before committing to a full port.

iOS is the first mobile target because it shares the Apple media stack with
macOS (VideoToolbox, IOSurface-backed `CVPixelBuffer`, Metal). Android needs a
different decoder (MediaCodec) and GPU import path, and is out of scope here.

Verified facts (read from the repository at `perf/multi-tier-composite-automation`):

- `src-tauri/src/lib.rs` already has `#[cfg_attr(mobile, tauri::mobile_entry_point)]`
  and `Cargo.toml` builds `staticlib`, `cdylib` and `rlib`, so the crate is
  shaped for Tauri 2 mobile.
- There is no iOS project: no `ios/` directory and no `src-tauri/gen/`. The only
  mobile project is the Capacitor `android/` directory, which is frozen.
- No code path targets `ios` or `android` (`target_os = "ios"` and
  `"android"` do not appear in `src-tauri` or `crates`).
- The Apple-specific engine code is gated to macOS, not to Apple platforms.
  `wgpu_compositor/metal_import.rs` starts with `#![cfg(target_os = "macos")]`,
  the `objc2`, `metal` and `foreign-types` dependencies sit under
  `[target.'cfg(target_os = "macos")'.dependencies]`, and the native surface
  setup in `commands/native_surface/config.rs` uses `#[cfg(target_os = "macos")]`.
  On `target_os = "ios"` all of it compiles out.
- The macOS native surface is an AppKit child view managed on the main thread
  (invariants 6 and 16). iOS needs a `UIView` with a `CAMetalLayer` in the
  Tauri 2 `WKWebView` hierarchy. That is a different integration, not a
  re-gate.
- `ort` uses the `copy-dylibs` feature on every platform except Windows and
  x86_64 macOS, so an iOS build would select that branch, which cannot work on
  iOS.
- `[dependencies]` includes `tauri-plugin-shell`, `tauri-plugin-updater`,
  `tauri-plugin-process`, `whisper-rs`, `crabcamera` and `cpal`. Which of these
  build or make sense on iOS is unverified.
- `ffmpeg-next`/`ffmpeg-sys-next` use the `static` feature, and
  `scripts/setup-ffmpeg.sh` builds a static FFmpeg 8.x for the host. There is
  no iOS cross-build.
- `core/history`, `core/evaluation` and the edit-plan layer
  (ADR-0003) are platform-neutral TypeScript, so the editing model is not a
  mobile blocker. The on-device preview is.

Unknowns this ADR exists to resolve:

- Whether a Tauri 2 iOS app can host a wgpu/Metal surface that composites with
  the webview reliably, including across background and foreground cycles.
- Whether VideoToolbox decode into the existing Metal import path is portable
  to iOS or needs changes.
- Whether a phone sustains a 1080p, two-layer timeline without thermal
  throttling or a memory kill.
- Whether the static FFmpeg plus App Store distribution is acceptable under the
  LGPL. This needs legal review and is not decided here.

## Decision

Run a **time-boxed, gated spike** on a real iPhone before any production
integration. Each step has a stop rule: if a step fails, stop, record why, and
reconsider the shell choice. Nothing from the spike merges into the engine
until the exit criteria below are met.

### Shell decision

| Option | Verdict |
| --- | --- |
| **Tauri 2 iOS** | Try first. The crate already has a mobile entry point, all existing Tauri commands carry over, and the React UI stays one codebase. Risk: native surface layering with `WKWebView`. |
| **Thin SwiftUI/UIKit shell, Rust engine over FFI** | Fallback if the surface cannot be made reliable under Tauri. Native view control, but UI and IPC need a second implementation. |
| **Capacitor** (current) | Rejected for the engine path. It is a web shell with no native engine, and it is frozen. |
| **Flutter or React Native with FFI** | Rejected for now. It adds a second UI stack without removing the native-surface problem. |

### Spike steps

1. **Build.** Make the crate compile for `aarch64-apple-ios`.
   - Split macOS gates into `apple` (shared VideoToolbox, `CVPixelBuffer`,
     Metal import) versus `macos`-only (AppKit surface). Do this with
     `cfg(any(target_os = "macos", target_os = "ios"))` or a build-script alias
     for the shared parts, not by loosening the macOS-only code.
   - Gate or replace desktop-only dependencies (`tauri-plugin-updater`,
     `-shell`, `-process`, `crabcamera`) and give `ort` an iOS-compatible
     configuration or exclude it for the spike.
   - Cross-build static FFmpeg for iOS with VideoToolbox enabled.
   Stop rule: if FFmpeg or `wgpu` will not link, stop.
2. **Surface.** Render one wgpu/Metal frame on a real device from a Tauri 2
   iOS app, then composite it with a webview UI element on top.
   Stop rule: if layering or touch pass-through is unreliable, evaluate the
   SwiftUI-shell fallback before continuing.
3. **Decode to GPU.** Decode with VideoToolbox into an IOSurface-backed buffer
   and import it into wgpu through the existing `metal_import` path.
   Record the decode path decision and rejection reasons using the existing
   typed decode-path telemetry, so iOS fallbacks are traceable like macOS ones.
4. **Stress.** Play a 1080p30, two-layer timeline for 60 seconds, then run a
   background and foreground cycle, then import media through the system photo
   picker.

### Exit criteria

Proposed, to be agreed before step 1:

- No thermal-driven stall and no memory termination during the 60-second run.
- Frame drops and freeze duration within the desktop acceptance budget
  (desktop used a 200 ms freeze limit and 20% drop thresholds). If a phone
  cannot meet it, record the achieved numbers and decide whether a mobile
  budget is acceptable, rather than relaxing the number silently.
- Playback and the native surface recover after backgrounding without a
  restart.
- Zero-copy is verified from runtime telemetry (not inferred from flags),
  consistent with invariant 13.

### Evidence

- Reuse the v2 perf envelope and add device identity (model, OS version) to
  the session header, so iOS results are comparable and lintable like desktop
  results.
- Record `ProcessInfo.thermalState` and memory warnings as telemetry events
  during the stress step.
- Keep the spike on a branch and report results in this ADR (or a follow-up
  ADR) before any production work.

## Alternatives Considered

- **Skip the spike and port directly.** Fastest if it works, but a surface or
  thermal failure would be found after committing to a shell and a design.
  Rejected.
- **Simulator-only testing.** Hides the hardware decoder limits, thermal
  behavior and memory pressure that decide viability. Rejected as evidence,
  acceptable only for compile checks.
- **Android first.** Larger device fragmentation and a new decoder and import
  path before we know the engine fits a phone. Deferred.
- **WebCodecs/WebGL preview on mobile.** Possible fallback for preview, but it
  discards the native zero-copy path that is the reason for the engine. Keep
  as a degraded mode, not the target.

## Consequences & Trade-offs

- **Positive**: the main unknowns are answered on real hardware with stop
  rules; the macOS code is refactored toward a shared Apple layer that is
  useful either way; the result informs the Android plan.
- **Negative / Costs**: needs a physical iPhone, an Apple developer account
  and Xcode; the cfg split touches macOS-only code, so macOS regression checks
  are required; an iOS FFmpeg build adds maintenance.
- **Risks & Mitigations**:
  - Widening `cfg` gates breaks macOS. Mitigation: keep AppKit code under
    `macos` only, and run the macOS native-golden and full test suites on the
    same change.
  - LGPL and App Store distribution. Mitigation: legal review before any
    release, independent of the spike.
  - Thermal or memory limits make the full engine unviable on older phones.
    Mitigation: report achieved numbers and define a capability profile
    (proxy-only preview, layer cap), reusing `deviceCapabilities.ts`.
  - AI perception models (Whisper, ONNX) may be too heavy on device. Out of
    scope for this spike; the edit-plan layer works without them.

## Verification & Migration Strategy

- Step 1 passes when `cargo build --target aarch64-apple-ios` succeeds for the
  engine crate and the macOS build and tests are unchanged.
- Steps 2 to 4 pass on a physical device against the exit criteria above, with
  the telemetry session lint-clean.
- Migration: no change to desktop behavior or to project files. Rollback is
  deleting the spike branch; the shared `apple` cfg split is kept only if it
  passes the macOS suites.

## Open Questions

- Which iPhone model(s) and minimum iOS version are the target?
- Do we accept a mobile-specific perf budget if the desktop one is unreachable?
- Which desktop-only dependencies have an iOS-safe alternative versus being
  excluded from mobile builds?
- How are project files and media made available on iOS (photo library,
  Files app, security-scoped access)?
- What is the LGPL position for a statically linked FFmpeg in an App Store
  build?

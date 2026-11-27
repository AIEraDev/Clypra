# ADR-0004: Mobile Native Engine Spike with Native Shells (iOS and Android)

## Status

Proposed

This replaces the earlier draft that proposed trying Tauri 2 mobile first. The
mobile apps will be native shells around the Rust engine, so the Tauri-first
branch is dropped.

## Context & Problem Statement

Clypra's native preview (wgpu compositor, VideoToolbox decode, Metal zero-copy
import) runs on macOS. Mobile today is a frozen Capacitor web shell with no
native engine. The mobile apps will be native applications (SwiftUI/UIKit on
iOS, Kotlin/Compose on Android) that host a native render surface and call the
Rust engine over FFI. That choice is made for smoothness: no WebView
compositing, direct control of the render surface, and direct handling of
lifecycle and gestures.

Before any production work we need to know three things: whether the engine can
be separated from Tauri cleanly, whether it can sustain a timeline on a real
phone, and where the editing logic lives when the UI is no longer React.

Verified facts (read from the repository at `perf/multi-tier-composite-automation`):

- The engine lives inside the `src-tauri` crate, which carries all the Tauri
  dependencies. Files referencing `tauri` are few: 0 of 37 in
  `wgpu_compositor`, 1 of 62 in `engine`, 1 of 31 in `filmstrip_engine`. In
  `engine/telemetry.rs` the coupling is `Option<&AppHandle>` used to emit
  events, which is a small seam. File counts do not capture every kind of
  coupling (shared state, command modules), so Step 0 must confirm it.
- `crates/clypra-native-core` is small (font registry, glyph cache, SDF, golden
  tests) and does not contain the compositor, decoder or engine.
- There is no exported FFI interface (no UniFFI, no `cbindgen` output). The
  `extern "C"` matches in `metal_import.rs` and `filmstrip_engine/decoder/mod.rs`
  appear to declare system APIs and were not read in detail.
- No Rust type named `EvaluatedScene` exists. How the engine receives a scene
  today must be confirmed in Step 0.
- The Apple-specific engine code is gated to macOS, not to Apple platforms.
  `wgpu_compositor/metal_import.rs` starts with `#![cfg(target_os = "macos")]`,
  the `objc2`, `metal` and `foreign-types` dependencies are under
  `cfg(target_os = "macos")`, and native surface setup in
  `commands/native_surface/config.rs` uses `#[cfg(target_os = "macos")]`. On
  `target_os = "ios"` all of it compiles out.
- `ort` takes the `copy-dylibs` configuration on every platform except Windows
  and x86_64 macOS, so mobile targets would select a branch that cannot work
  on them. (Local commit `3266851b` already updated `ort` to `load-dynamic` on
  iOS and gated desktop-only plugins/crates.)
- `ffmpeg-next`/`ffmpeg-sys-next` use the `static` feature and
  `scripts/setup-ffmpeg.sh` builds a static FFmpeg 8.x for the host only. There
  is no iOS or Android cross-build.
- The decode policy already falls back in order from zero-copy to CPU
  (`DecodedFrame::{Cpu, Dxgi, Metal}` with a typed path decision). Android can
  start on the CPU frame path.
- The editing logic (command history, scene evaluation, the ADR-0003 edit-plan
  layer) is platform-neutral TypeScript (`core/history` has no Tauri imports).
  A native UI cannot run it directly.
- Verified locally on the developer's machine: the Android SDK/NDK is absent,
  the `aarch64-linux-android` Rust target is not installed, and `cpal` uses
  `oboe` on Android.

Unknowns this ADR exists to resolve:

- Whether the engine separates from Tauri without changing desktop behavior.
- Whether a phone sustains a 1080p, two-layer timeline without thermal
  throttling or a memory kill.
- Where the editing core lives for native UIs (see the open decision below).
- Whether a statically linked FFmpeg is acceptable for store distribution
  under the LGPL. This needs legal review and is not decided here.

## Decision

Build mobile as **native shells around a Tauri-free Rust engine**, validated by
a **time-boxed, gated spike** on real devices. Each step has a stop rule. Nothing
from the spike merges into the engine until the exit criteria are met.

### Shell decision

| Option | Verdict |
| --- | --- |
| **Native shells (SwiftUI/UIKit, Kotlin/Compose) + Rust engine over FFI** | Chosen. Direct `CAMetalLayer` and `SurfaceView` surfaces, no WebView compositing, full control of lifecycle and gestures. Cost: two native UIs and an FFI boundary. |
| Tauri 2 mobile | Rejected. It would reuse the React UI, but that is not the target. |
| Flutter or React Native + FFI | Rejected. A second UI stack plus video texture plumbing, without removing the native-surface problem. |
| Capacitor (current) | Rejected. A web shell with no native engine, and frozen. |

### Step 0: extract a Tauri-free engine crate (Refined by ADR-0005)

> [!NOTE]
> Step 0 is superseded and refined in detail by [ADR-0005: Portable Engine Architecture](0005-portable-engine-architecture.md).
> Rather than extracting only `wgpu_compositor`, `engine`, and `filmstrip_engine`, ADR-0005 establishes that playback orchestration, the lookahead scheduler, and session state currently in `commands/native_preview/` and `commands/native_playback/` must also be structured into instance-based engine components (`clypra-engine` and `clypra-engine-api`).

Move the compositor, decoder and engine into a new crate with no `tauri`
dependency. Desktop keeps working through a thin Tauri wrapper that depends on
it. iOS and Android link it as a library.

- Replace `Option<&AppHandle>` event emission with an event-sink trait that the
  Tauri wrapper implements.
- Expose a narrow public API: create engine, attach a native surface, load
  scene and media, play, seek, query state, and stream telemetry. Keep
  hot-path calls (frame submit, surface handle) free of per-call allocation or
  serialization.
- Pick the FFI binding approach with a short experiment: UniFFI for the control
  and query API (generated Swift and Kotlin bindings), and a small hand-written
  C ABI for the surface and frame hot path if UniFFI overhead is measurable.
  Not decided here.
- Desktop must be unchanged: `native-golden`, the full test suite and
  `npm run perf:cycle` pass before and after with no regression.

Stop rule: if the two `tauri`-referencing engine files hide deeper shared state
than the file counts suggest, report the real coupling before proceeding.

### Test harness, not the editor

Spike apps are minimal native harnesses, not the editor UI. They are driven by
launch arguments and a scenario file, write v2 perf NDJSON to the app container,
and the logs are pulled off the device for the existing `clypra-perf lint` and
acceptance tooling. Timelines come from fixed scene fixtures, so the spike does
not depend on the editing-core decision.

### iOS track

1. **Build.** Build the extracted engine for `aarch64-apple-ios`.
   - Split macOS gates into shared Apple code (VideoToolbox, `CVPixelBuffer`,
     Metal import) and macOS-only AppKit code, using
     `cfg(any(target_os = "macos", target_os = "ios"))` or a build-script alias
     for the shared parts, not by loosening the macOS-only code.
   - Give `ort` an iOS-compatible configuration or exclude it for the spike.
   - Cross-build static FFmpeg for iOS with VideoToolbox enabled.
   Stop rule: if FFmpeg or `wgpu` will not link, stop.
2. **Surface.** Render one wgpu/Metal frame to a `CAMetalLayer` in a UIKit or
   SwiftUI host on a real iPhone, with native controls overlaid.
3. **Decode to GPU.** VideoToolbox into an IOSurface-backed buffer, imported
   through the shared Metal path. Record the decode path decision and rejection
   reasons with the existing typed telemetry.
4. **Stress.** 60 seconds of a 1080p30 two-layer timeline, then a background
   and foreground cycle, then media import through the system photo picker.

### Android track

1. **Build.** Install the NDK and the `aarch64-linux-android` target, then build
   the extracted engine. Cross-build static FFmpeg with software decode.
   Verify audio (`cpal`) on Android.
   Stop rule: if FFmpeg or `wgpu` will not link, stop.
2. **Surface.** Render one wgpu Vulkan frame to an `ANativeWindow` from a
   `SurfaceView` in a Kotlin host on a real mid-range phone.
3. **CPU decode to GPU.** FFmpeg software decode into `DecodedFrame::Cpu`,
   uploaded to wgpu textures. MediaCodec with `AHardwareBuffer` import is
   deferred until the CPU path shows where the real bottleneck is.
4. **Stress.** The same 60-second scenario on a mid-range device, then a
   background and foreground cycle and storage access through the system
   picker. A flagship device hides the problems found in the field, so the
   mid-range result is the one that counts.

### Exit criteria

Proposed, to be agreed before Step 0 starts:

- No thermal-driven stall and no memory termination during the 60-second run.
- Frame drops and freeze duration within the desktop acceptance budget
  (desktop used a 200 ms freeze limit and 20% drop thresholds). If a device
  cannot meet it, record the achieved numbers and decide whether a mobile
  budget is acceptable, instead of relaxing the number silently.
- Playback and the native surface recover after backgrounding without a
  restart.
- Zero-copy (iOS) or the CPU path (Android) is verified from runtime
  telemetry, not inferred from flags (invariant 13).

### Evidence

- Reuse the v2 perf envelope. Add device identity (model, OS version, chipset)
  to the session header so mobile sessions are comparable and lintable.
- Record thermal state and memory warnings as telemetry events during the
  stress step (`ProcessInfo.thermalState` on iOS, the equivalent thermal and
  low-memory signals on Android).

### Open decision: where the editing core lives

A native UI cannot run the TypeScript editing core (command history, scene
evaluation, the ADR-0003 edit-plan layer). This ADR does not decide it. The
options:

| Option | Trade-off |
| --- | --- |
| **A. Port the editing core to Rust** and share it across desktop and mobile | One implementation and consistent behavior, but a large refactor and the desktop TypeScript would either call it or remain a duplicate. |
| **B. Embed a JS runtime and run the existing core headless** (JavaScriptCore is available on iOS; Android needs an engine such as QuickJS) | Reuses tested code and ADR-0003, but adds a runtime, a bridge and a start-up cost. Unproven here; it needs a benchmark. |
| **C. Reimplement in Swift and Kotlin** | Three implementations that can drift. Highest long-term cost. |

A decision is needed before production work and will be recorded in a
follow-up ADR, informed by the spike. Whatever is chosen must keep the project
file format compatible across desktop and mobile. ADR-0003's edit-plan layer
runs wherever the editing core runs; on mobile its capability profile comes from
the native layer, not from the web `deviceCapabilities.ts`.

## Alternatives Considered

- **Skip the spike and port directly.** Fastest if it works, but a surface,
  extraction or thermal failure would be found after the commitment. Rejected.
- **Simulator-only testing.** Hides hardware decoder limits, thermal behavior
  and memory pressure. Acceptable for compile checks only.
- **Android first.** More device fragmentation and a new decoder and import
  path before the engine is proven on a phone. Both tracks proceed, but iOS
  validates the zero-copy design and Android validates the CPU fallback and
  low-end limits. If the audience is mostly Android, the Android track can lead.
- **WebCodecs/WebGL preview on mobile.** A possible degraded mode, but it
  discards the native path that is the reason for the engine.

## Consequences & Trade-offs

- **Positive**: smoother UI and gestures than a WebView shell; the engine
  becomes reusable across desktop, iOS and Android; engine extraction removes
  most Tauri-specific mobile concerns at the source; real-device evidence
  decides viability.
- **Negative / Costs**: two native UIs to build and maintain; an FFI boundary
  to design and version; the editing-core decision and its cost; real devices,
  an Apple developer account and the Android toolchain are required.
- **Risks & Mitigations**:
  - Extraction changes desktop behavior. Mitigation: `native-golden`, the full
    test suite and `perf:cycle` before and after, and a thin desktop wrapper.
  - Widening `cfg` gates breaks macOS. Mitigation: AppKit code stays under
    `macos` only.
  - Thermal or memory limits make full-quality playback unviable on mid-range
    phones. Mitigation: report achieved numbers and define device capability
    profiles (proxy-only preview, layer cap).
  - LGPL and store distribution of static FFmpeg. Mitigation: legal review
    before any release, independent of the spike.
  - AI perception models (Whisper, ONNX) may be too heavy on device. Out of
    scope here; the edit-plan layer works without them.

## Verification & Migration Strategy

- Step 0 passes when the engine crate builds with no `tauri` dependency, the
  desktop app is rebuilt on it, and `native-golden`, the full tests and
  `perf:cycle` show no regression.
- Each platform's Step 1 passes when the engine builds for the target
  (`aarch64-apple-ios`, `aarch64-linux-android`) and the macOS build and tests
  are unchanged.
- Steps 2 to 4 pass on physical devices against the exit criteria, with the
  telemetry session lint-clean.
- Migration: no change to project files or desktop behavior. Rollback is
  deleting the spike branches; the engine extraction and shared Apple cfg split
  are kept only if they pass the desktop checks.

## Open Questions

- Which iPhone model and minimum iOS version, and which mid-range Android
  device and minimum API level, are the targets?
- Native UI via SwiftUI/Compose with which editing-core option (A, B or C)?
- UniFFI, hand-written C ABI, or both for the FFI boundary?
- Do we accept a mobile-specific perf budget if the desktop one is unreachable?
- How are project files and media made available on each platform (photo
  library, Files app, scoped storage, security-scoped access)?
- What is the LGPL position for statically linked FFmpeg in store builds?

# Changelog

All notable changes to Clypra will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.5.9] - 2026-10-04

### ⏱️ Cold-Start Observability & Launch Milestones (Phase 1)

- **Native Cold-Start Span Recorder (`cold_start.rs`)** — introduced zero-overhead startup telemetry capturing microsecond spans across the cold-start lifecycle (C0–C4). Features RAII `SpanGuard` for auto-recording on scope exit (capturing failed probes with `ok: false`), OS-measured pre-main process creation times (`GetProcessTimes` on Windows, `proc_pidinfo` with `PROC_PIDTBSDINFO` on macOS), bounded 512-span ring-buffer storage, and cumulative stage aggregates (#488).
- **Interactive Wait & Contention Tracking** — tracks `waitedByInteractiveUs` independently from `workUs` to isolate true interactive UI blockage from background threads (e.g. `c0_gpu_init` contention calculated from user frame request overlap) (#488).
- **Subsystem Purpose Tagging on Media Probes** — tagged container opens, codec creations, and hardware contexts with explicit functional purposes (`preview`, `filmstrip`, `waveform`, `export`, `probe`) to prevent background thumbnail generation from contaminating interactive cold playback metrics (#488).
- **Frontend Launch Milestones & Low-End GPU Fallbacks** — recorded user-visible milestones (`windowCreatedAtUs`, `windowShownAtUs`, `domContentLoadedMs`, `appMountedMs`, `shellPaintedMs` via double rAF, `interactiveAtUs`, `firstSoundAtUs`, `firstFrameAtUs`). Added `firstFramePaintedMs` canvas fallback for low-end graphics adapters (e.g. Intel HD 520) where native presentation surface is disabled, and continuous 1.0-second smooth playback detection ($\ge 0.9 \times \text{target FPS}$) (#488).
- **Audio Cold-Path Counters & Output Latency** — tracked `pcmBytes`, 256 MiB cap truncations (`capTruncations`), and external CLI fallbacks (`cliFallbacks`). Real-time non-silent audio callback stamps `firstSoundAtUs` alongside hardware output device latency (`firstSoundLatencyUs`) (#488).
- **Privacy Protections & Schema Constraints** — quantized file sizes into 64 MiB buckets (`fileSizeBucketMb`) and classified drive locations (`fixed`, `removable`, `network`, `ramdisk`) without logging, storing, or transmitting file paths. Added strict nested allowlist test enforcement (#488).

### 🛠️ CI & Diagnostic Benchmarking Tooling

- **Windows CI Validation** — added `check-windows` job running `cargo check` on `windows-latest` with cached vcpkg static FFmpeg (#488).
- **Resilient Asset Test Suite** — marked large testing asset performance suites as `#[ignore]` with loud panics if `CLYPRA_TEST_ASSETS_DIR` is missing when run with `-- --ignored`, and replaced brittle wall-clock assertions with steady-state vs cold relative ratios (#488).
- **Pilot Benchmark Suite & Tooling** — added synthetic fixture generator (`scripts/generate-bench-fixtures.sh`), cross-platform hardware specification collectors (`scripts/collect-mac-hardware.sh`, `scripts/collect-windows-hardware.ps1`), and automated median/IQR report summarizer (`scripts/summarize_reports.py`) (#488).

## [1.5.8] - 2026-10-02

### 🎬 Professional NLE Tools & Architecture

- **J/K/L Shuttle Transport & Frame Jogging** — added professional multi-speed playback and transport navigation. Supports forward (L) and reverse (J) shuttle at 1x, 2x, 4x, 8x, and 16x speeds, pause/stop (K), single-frame jogging, and smooth speed step-downs. Fully integrated with playback clock and native audio-drift synchronization (#467).
- **OpenTimelineIO (.otio) Interchange** — native bidirectional import and export for the industry-standard OpenTimelineIO interchange format. Preserves track stacks, rational time boundaries, clip sources, markers, transitions, and metadata across third-party NLEs (DaVinci Resolve, Premiere Pro, Final Cut Pro) (#467).
- **SMPTE 12M Timecode & Click-to-Jump Navigation** — implemented strict SMPTE 12M timecode parsing, formatting, and rational time arithmetic. Users can click any timecode readout in the transport or timeline HUD to directly input timecodes (e.g. `01:23:45:12` or frame offsets) to jump the playhead instantly (#467).
- **Precision NLE Editing Modes (Slip, Slide, Roll)** — added dedicated professional trimming tools:
  - *Slip Tool (Y)*: Adjusts clip in/out points while preserving duration and position on the timeline.
  - *Slide Tool (U)*: Moves clip position on the timeline while adjusting neighboring adjacent heads/tails without affecting project duration.
  - *Roll Tool (N)*: Trims the edit point between two adjacent clips simultaneously (#467).

### ⚡ Realtime Playback & Throughput Optimizations

- **Short-Circuit Unchanged Playback Frames (Phase 1c / Commit D)** — in continuous playback on constrained hardware, up to 83% of presentation requests are repeat frames while waiting for new decodes. Clypra now returns a 12-byte `UNCH` sentinel (`[0x55, 0x4E, 0x43, 0x48]` + `u64` frame index), bypassing wgpu fragment compose, staging buffer copies, and 22–75ms of CPU `map_async` wait per repeat frame. The frontend skips redundant canvas repaints while maintaining full transport pacing (#471).
- **Selective Producer Hardware Download for Lookahead Priming (Phase 2 / Arm 2b)** — production implementation of Arm 2b lookahead priming. Intermediate lookahead frames are decoded directly into the GPU's hardware DPB surface without triggering costly `av_hwframe_transfer_data` PCIe host downloads (0.6ms GPU decode vs 32–40ms host transfer on Windows D3D11VA). Only display-targeted frames undergo host transfer. Nearly doubles lookahead priming throughput (up to 647 FPS on Intel iGPUs), tripling buffer depth and preventing playback starvations (#472).
- **Standalone 4-Arm Decode Throughput Benchmark (Phase 1b)** — added an in-engine standalone benchmark measuring raw hardware decode throughput across 4 architectural strategies:
  - *Arm 1*: Pure GPU decode without host download (~1,350+ FPS).
  - *Arm 2*: GPU decode with sequential host download (~340 FPS).
  - *Arm 2b*: GPU decode with selective download every N frames (~650 FPS).
  - *Arm 3*: Software decode fallback.
  Includes automated validation checks, git commit/dirty status tracking, and reportVersion 2 formatting (#469, #470).
- **Playback Generation & Cold-Start Stabilization** — fixed playback generation synchronization during rapid seeking and start transitions. Eliminates packet rejections on cold start and prevents video dropouts (#473).
- **Granular Frame Delivery Attribution & Unaccounted Time Tracking** — added `ServedFrom` enum (`decoded-in-request`, `ready-cache`, `reused-current`, `short-circuit-unchanged`) and sub-millisecond stage unaccounted latency percentiles to pinpoint exact pipeline bottlenecks (#468, #469).

### 🖥️ Hardware-Aware Preview Quality & GPU Guardrails

- **Dynamic Project-Resolution Quality Tiers** — replaced hardcoded preview quality options with dynamic tiers calculated from the project canvas resolution (Full, High, Medium, Low) for 4K, 1440p, 1080p, 720p, and vertical video (9:16).
- **Hardware Capability Guardrails & GPU Recommendations** — automatically classifies the host GPU tier (`legacy-igpu`, `mid-tier`, `discrete`, `apple-silicon`) and enforces hardware capability policies. Highlights constrained tiers (e.g. amber "Limited by GPU" badge when attempting 4K preview on legacy Intel iGPUs) and highlights the "Recommended" tier (e.g. 720p for Intel HD 520) (#474).

### 📊 Telemetry & Continuous Fleet Analysis

- **Full Native Performance & Benchmark Report Telemetry** — added `preview-benchmark-report` kind to the session NDJSON pipeline. Automatically captures the full native diagnostics report (seek percentiles, cache hit rates, Phase 1c UNCH short-circuit counts, Phase 2 Arm 2b skipped downloads, push bridge metrics, stage percentiles) on session close and whenever a user copies diagnostics. Uploads directly to Cloudflare R2 via `/performance/telemetry/ingest/session` (#475, #476).
- **Preview Quality Hardware Benchmark Telemetry** — added `preview-quality-benchmark` one-shot telemetry event recording the host GPU tier, capability policy, project resolution, and quality options on app load (#475).
- **Session Performance Analyzer Upgrades (`clypra-api`)** — extended `scripts/analyze-sessions.ts` to extract and report seek SLA compliance (p50/p95/p99), preview cache hit rates, pipeline optimization gains (unchanged short-circuits and skipped downloads), dominant stage bottlenecks, and stage diagnoses across sessions (#133).

### 🛠️ CI & Build Hygiene

- **Clippy `-D warnings` Clean** — resolved all compiler and benchmark lint warnings in the native engine and test harness (#470).
- **Strict TypeScript Validation** — 100% clean `tsc --noEmit` check across all components, hooks, and services.

## [1.5.7] - 2026-09-29

### 🐛 Bug Fixes

- **Windows readback telemetry always null** — readback telemetry (readbackMaxDimension, readbackTier, readbackCadenceFps) was always null in Windows performance logs because spans were created inside the scheduler's `load()` function, which only runs on cache MISSES. On Windows with EMBEDDED_PREVIEW_ONLY=true and mostly paused/seek sessions, cache hits dominate — `load()` never fires, no spans are created, `totalFrames` stays 0, and no frontend-rollup entries are written to the log. Fixed by moving span creation to before `requestVisible()` in both the playback path and the paused/seek path so every dispatch — cache hit or miss — is recorded. macOS was unaffected because it uses the native surface path (Metal shared texture, no CPU readback bridge) whose spans are created before any cache lookup (#436).

- **Readback policy not bound to all span completion paths** — readback policy (maxDimension, tier, cadenceFps) was only passed in selected completion callbacks, causing some code paths to miss telemetry. Fixed by capturing policy at request dispatch time and inheriting it in all completion handlers (success, error, cancel) (#435).

- **Session startup performance log not serialized** — fixed session startup performance log serialization to ensure proper session tracking from app launch (#435).

### 📊 Telemetry

- **Added readback telemetry fields** — frontend-rollup events now include `readbackMaxDimension` (OS-specific limit: 960px macOS, 480px Windows), `readbackTier` (quality tier 0-5 for 320-960px), and `readbackCadenceFps` (adaptive request rate: 10/20/24/30 FPS) in workload object. Enables accurate tracking of adaptive CPU RGBA bridge performance (#433, #434).

## [1.5.6] - 2026-09-29

### 🐛 Bug Fixes

- **Native preview embedded in editor canvas** — native preview is now always rendered inside Clypra's main editor canvas instead of a separate Tauri/OS child window. Prevents the preview from escaping and overlapping dialogs, appearing on a different Space/desktop on macOS, or failing to track the app window on Windows, X11, and Wayland. Covers `nativeCore.ts`, `useNativeSurfaceController.ts`, `NativeProgramPreview.tsx`, and `nativeSurfaceLifecycle.ts` (#428).

- **Source preview timecode no longer shows frame counter** — replaced `formatTimecode` (MM:SS:FF) with `formatTime` (MM:SS / HH:MM:SS) in `SourcePreview` so the player transport no longer shows a rapidly counting frames segment next to current and total time (#427).

- **QoS oscillation causing audio cracking** — QoS controller was evaluating on every RAF tick (every 16ms) instead of complete non-overlapping 250ms windows, causing Full→Half→Quarter→Full quality thrashing hundreds of times per minute. Surface resize churn from the oscillation interrupted the CPAL audio pipeline. Fixed by requiring `window_capacity` (15) new samples between evaluations (#429).

- **Audio stops near end of clip** — when video reached the terminal frame the CPAL stream was not closed promptly, draining to silence and stalling. Fixed with explicit terminal-frame stream close emitting `clypra://playback-ended` (#429).

- **Restart desync after silence gap** — on restart after the audio dropout, the video clock was not re-anchored to the new CPAL stream. `begin_transport()` now resets the full QoS state (window, counters, decision) before each new play run (#429).

- **Persistent -12ms AV drift from first frame** — CPAL `firstAudibleUs=51ms` was not fed into the video clock anchor. `nativeAudioPreviewController` now hard-reanchors the UI clock to the first non-silent hardware callback, eliminating inherited extrapolation from any prior stream (#430).

- **Preview transport stuck at 00:00** — `NativeProgramPreview` was reading transport time from a React subscription snapshot that could remain stale after a project reset. Transport time is now driven from a 30 Hz RAF read of `getPlaybackClock()` — the same singleton used by the timeline playhead. Project resets reset state on the existing clock instance so mounted controls retain valid subscriptions (#430).

- **Seek storm at 00:02 (130ms repeated seeks)** — `nativeAudioPreviewController` fired one native audio seek per RAF notification while a frame was settling. Transport acknowledgement is now separated from visual-frame settlement; native audio receives exactly one seek per monotonic `seekRevision` increment (#430).

- **Audio goes silent before end of long clips** — in-process FFmpeg resampler tail samples were not drained at EOF and any decode shortfall >100ms was silently accepted, causing long clips to lose seconds of audio. Decoder now drains the resampler at EOF, treats shortfall >100ms as invalid, and recovers through the independent CLI FFmpeg decoder before installing audio into the mixer (#430).

### ⚡ Performance

- **Filmstrip no longer competes with playback** — filmstrip thumbnail batch jobs are deferred and cancelled while playback is running, preventing thumbnail decoding from competing with the audio/video decoder for memory bandwidth. Session data showed a 659ms filmstrip artifact job causing max AV drift to grow from 38ms to 157ms over a session (#430).

- **Adaptive embedded-preview readback cap** — new `adaptiveReadbackPolicy.ts` monitors WebView readback/IPC duration and automatically steps the canvas resolution cap down under pressure: 960→840→720→600→480px. Fallback FPS paces at 30fps, dropping to 24/20fps at reduced tiers. Quality recovers only after 90 consecutive fast transfers, preventing oscillation. Affects only the CPU-RGBA embedded canvas fallback path (#430).

### 🔧 Architecture

- **PlaybackClock monotonic `seekRevision`** — `PlaybackClock` exposes a monotonic seek identity counter. Consumers deduplicate seek side effects (native audio seeks, decoder seeks, telemetry) by identity rather than reacting to every `isSeeking` notification. Global clock identity now survives project resets (#430).

- **Apple Silicon `HighEnd` capability tier** — Apple Silicon with VideoToolbox is now classified as `HighEnd` (was `Constrained`/`Moderate`), starting at full quality with QoS degrading only under real measured pressure (#429, #430).

- **Intel GPU detection case-insensitive** — driver strings reporting `intel` (lowercase) were bypassing constrained policies. Detection is now case-insensitive (#430).

- **UHD 630 2GB boundary corrected to `Moderate`** (#430).

- **Low-end Windows discrete GPUs start constrained** — entry-level discrete GPUs (GT 1030, GTX 750 Ti class) no longer assumed fast just because they are discrete. Quality degrades only under sustained measured frame pressure (#430).

### 🛠️ CI / Testing

- **Clippy `-D warnings` clean across all engine v2 Rust code** — 20 Clippy lint errors in the native realtime engine v2 code fixed: `derivable_impls`, `collapsible_match`, `needless_borrow`, `borrowed_box`, `get_first`, `module_inception`, `large_enum_variant`, `cast_lossless`, `clone_on_copy` (#426).

## [1.5.5] - 2026-09-28

### � Features & Architecture

- **Native Realtime Playback Engine v2 (Phases A–J)** — complete architectural overhaul of the realtime playback and presentation pipeline (#418, #419, #420):
  - _Phase A_: Engine contracts and core foundation.
  - _Phase B_: Native `ProjectState` and `TimelineEvaluator` — authoritative zero-IPC evaluation model.
  - _Phase C_: Native `PlaybackController` with monotonic audio-master clock.
  - _Phase D_: Hardware decode contracts for D3D12VA / VideoToolbox with same-adapter topology enforcement.
  - _Phase E_: `VideoSurface` ownership, fence synchronization, and swapchain presentation.
  - _Phase F_: Prioritized work planner with bounded prefetch queue.
  - _Phase G_: Temporal navigation and seek/scrub state machine with cancellation and keyframe recovery.
  - _Phase H_: Render graph DAG, transient resource pooling, and barrier scheduling.
  - _Phase I_: Dynamic QoS governor with non-blocking bottleneck diagnosis.
  - _Phase J_: Telemetry integration, zero-copy audit, and live hardware verification.
  - Verified with 191 Rust engine unit tests and 57 frontend preview tests.

- **Hardware Capability Profiling Module** — new `engine::hardware::capability` module profiles runtime GPU capabilities (vendor, VRAM, decode acceleration, zero-copy support) and feeds results into the QoS controller and telemetry pipeline (#421, #422).

- **NLE-Grade Media Presence Watchdog & GPU Invalidation Pipeline** — full offline/relink lifecycle for media assets (#417):
  - Heartbeat watchdog detects files that disappear at runtime (unmounted drives, moved folders) and marks `isMissing` on the affected asset.
  - New `unregister_native_raster_asset` Tauri command evicts the GPU texture slot and purges the in-memory raster cache entry when an asset goes offline.
  - `evictMissingAsset` in `PreviewMediaPool` removes the pool entry, preventing stale frames from compositing.
  - Relinking clears the missing flag and triggers an immediate GPU re-upload.
  - `isMissing` busts the evaluator asset version hash so missing layers are skipped immediately.

### 🐛 Bug Fixes

- **Bundled FFmpeg Pipeline Always Falling Back to System Decode** — three root causes fixed (#424):
  - `is_real_executable()` accepted 316-byte `#!/bin/sh` stubs on macOS/Linux (only validated PE headers on Windows). Fix: reject files whose first two bytes are `#!` and enforce a 1 MB minimum size floor.
  - `is_bundled_path()` only matched the triple-qualified name (e.g. `ffmpeg-aarch64-apple-darwin`), missing plain `ffmpeg` copies. Fix: accept both forms.
  - `ensure-sidecars.mjs` was a stub from May that never copied the real sidecar into `target/{debug,release}/`. Fix: now syncs stale copies whenever the destination is missing, under 1 MB, or older than the source.
  - Verified: session perf log confirms `ffmpegRuntime='bundled'`, D3D12VA hardware decode, `is_zero_copy=true`.

- **Temporal Discontinuity and Restart Desync in Native Playback** — seven targeted fixes (#420):
  - Temporal discontinuity detection in `NativePreviewFrameQueue` (`discard_discontinuity`) discards stale lookahead frames on backward jumps.
  - `cancel_native_preview_requests` now invalidates the generation and aborts in-flight lookahead workers.
  - `schedule_lookahead_predecode` deadlock resolved — `start > target_end` on backward jumps no longer hangs.
  - Lookahead worker active range `[start_frame..=end_frame]` tracked to abort out-of-range workers immediately.
  - `NativeRenderSession` re-anchors from snapshot when audio clock regresses backwards.
  - `last_materialized` cleared and render loop notified on re-start or seek from audio.
  - Seek controller generation synced in frontend RAF loop; request key cache cleared on seek.

- **QoS Decode vs Render Scaling Separation & Authoritative Native Policy** — forensic analysis of session `launch-1790581694397-4qx5x7` revealed Intel HD 520 render scaling (Half/Quarter) reduced canvas compositing but did not alleviate decode starvation (#419):
  - `RenderQuality` (canvas compositing) separated from `MediaVariant` (decode scaling via proxy stream) in engine QoS hierarchy.
  - `probe_machine_identity()` replaced hardcoded `'Primary Display GPU'` with probed DXGI `GpuAdapterIdentity` (vendor ID, device ID, LUID, VRAM) — the misclassification was treating the Intel HD 520 as `discrete` and bypassing all backpressure escalation.
  - Severe A/V drift recovery: when video lags >120 ms behind audio, stale backlogs are purged and predecoders re-anchored to the live playhead.
  - `PlaybackPolicySnapshot`, `PerformanceEnvelope`, `PlaybackResolutionDemand`, and `DecodeStrategy` added to `engine::qos`.
  - Frontend GPU-vendor guessing removed; `get_playback_policy` Tauri command and `listenForEngineQoSDecision` make native QoS the sole authority.

- **Windows Blank Video (HEVC Codec)** — HEVC+AAC proxy was cached by hash; WebView2 decoded audio but rendered blank video because no HEVC codec was available and `onError` never fired. `can_stream_copy_video` now returns `false` on non-macOS for `hevc/hvc1/av1/prores`; cached proxies are revalidated to confirm browser playability (#415).

- **Windows Video Preview Platform-Aware Codec Rules** — added `probe_audio_codec()` and `is_browser_playable_audio()` to detect E-AC-3/AC-3 streams incompatible with WebView2. H.264 + E-AC-3 on Windows now takes a stream-copy + audio transcode path instead of a full re-encode (#414).

- **Blocking 'Preparing Video' Spinner Removed** — video elements now render immediately against the raw file path on all platforms. Background optimization runs silently; when the H.264 proxy is ready the `src` switches seamlessly. `isOptimizingPreview` state, pre-emptive transcoding gate, and the spinner block removed entirely (#416).

- **CI Test Suite Fully Green** — resolved 3 failing tests blocking CI on every PR (#425):
  - _Frontend_: `previewHardwarePolicy.test.ts` updated — the test expected `full` for Intel HD 520 on 1080p canvas but the policy unconditionally returns `proxy` for all `legacy-igpu` regardless of canvas size.
  - _Rust J14 / J15_: Fixed stale ring-buffer contamination in `run_qos_scenario`. After degradation filled the 15-slot ring, the first recovery window still saw `miss_ratio > 0.25`, triggering a second degradation step (`Half → Quarter`). Fix: pre-flush the ring with `window_capacity` clean frames before the recovery loop.

### ⚡ Performance

- **Legacy iGPU Unconditional Proxy** — `legacy-igpu` tier (Intel HD/UHD, AMD Vega 8/11, Nvidia MX 1xx) now always returns `PROXY_POLICY` for preview regardless of canvas size, removing the 2500px dimension gate that allowed these adapters into native compositor mode and caused stutter (#423).

- **Text Alpha Channel Scan Cache** — `hasVisibleAlpha` results in `textRasterizer.ts` are now cached in a module-level `Map<string, boolean>` (capped at 256 entries, LRU eviction). The synchronous `getImageData` + full-pixel scan runs once per unique layer state instead of every frame (#423).

- **Rasterization Hot-Path Console Logs Removed** — two `console.log` calls firing on every text layer rasterization removed from `nativeTextPreview.ts`, recovering 1–3 ms per text layer per frame on Tauri's WebView console channel (#423).

- **Faster Legacy iGPU Backpressure Escalation** — `legacy-igpu` tier escalates after 5 samples / 2 overloaded (down from 12 / 3), dropping quality within ~85 ms of the first bad burst instead of several hundred ms (#423).

## [1.5.4] - 2026-09-27

### 🚀 Features & Architecture

- **Creative Random Project Name Generator** — new projects automatically receive creative, aesthetic cinematic titles (e.g., "Velvet Horizon", "Solar Drift", "Amber Echo", "Crimson Peak") sampled from a curated pool of 77 adjectives and 80 nouns (>6,160 combinations) with collision avoidance against existing projects, replacing generic "Untitled Project" placeholders (#412).
- **Playback Speed, Freeze Frames & Speed Ramps** — introduced the unified `PlaybackMapping` contract with full timeline visualization and inspector controls for variable playback speed (0.1×–100×), freeze frame insertion, and reverse playback support (#383, #384).
- **Inspector Fit & Fill Aspect Controls** — added dedicated Fit (letterbox/pillarbox to show 100% of media) and Fill (crop to fill canvas) toggle buttons to the clip inspector transform section, synchronizing both `fitMode` and `conform` atomically via undo/redo command (#410).
- **Microsoft Store MSIX Packaging Pipeline** — automated sidecar verification, MSIX packaging scripts, manifest generation, and GitHub Actions CI workflow for Microsoft Store distribution (#385, #386).

### 🐛 Bug Fixes

- **macOS Cocoa Child Window Locking** — locked the native preview surface window to the parent Clypra window using `addChildWindow:ordered:1isize` (`NSWindowAbove`). Fixed the issue where moving, resizing, or switching spaces left the native surface floating independently as a detached "Tauri App" on the desktop while the timeline canvas froze (#410).
- **App Lifecycle & Background Resync** — added `AppLifecycleCoordinator` to handle `visibilitychange`, `window.focus`/`blur`, and Tauri `onFocusChanged`. Cleanly pauses/sleeps rendering during background transitions and immediately resyncs hardware audio DAC clock drift (`resyncFromHardwareAudio()`) and resets circuit-breaker failure counts on foreground wakeups (#409, #410).
- **Conform & Canvas Refit Split-Brain Resolved** — unified default visual fit policy to `"contain"` and conform mode to `"fit"`. Switching project canvas aspect ratio (e.g. 9:16 to 16:9) now letterboxes/pillarboxes instead of mutating into `"fill"` and cropping subjects (#410).
- **Spacebar Replay Flash & Jump-to-End Race Condition** — fixed the race condition on Windows/Intel where pressing Spacebar at timeline end briefly restarted playback for 1 frame and immediately jumped back to the end due to stale atomic terminal position samples (#406, #408).
- **100ms Redundant Seek Storm Eliminated** — corrected `isPlayingJump` in `nativeAudioPreviewController.ts` which was erroneously firing redundant IPC seek commands every 100ms during normal continuous playback (#408).
- **1,664 Stale Frames Infinite Render Loop Fixed** — removed obsolete `forceRenderNeeded = true` flags on stale/superseded frame errors that were causing continuous 30fps re-requests while paused (#408).
- **Silent Media Playback Hitch Eliminated** — resolved a 500ms audio stutter on clips with no audio tracks by integrating an active audio clip check that bypasses CPAL audio stream probes when no audible clips exist (#406).
- **Native Preview Surface Initialization Fix** — imported `tracePlayback` in `useNativeSurfaceController.ts`, fixing a runtime `ReferenceError` that prevented the retained WGPU surface from initializing on startup (#411).

### ⚡ Performance

- **Apple Silicon Backpressure Exemption** — exempted Apple Silicon M1/M2/M3 GPUs from scrub-induced proxy quality downgrades, preventing false degradation to CPU-RGBA software decode and eliminating dropped frames (#405).
- **Scrubbing IPC Throttling & Decoupled Playhead** — throttled IPC seek dispatches to ~30fps on constrained GPUs while keeping DOM playhead needle updates at 60fps, preventing decoder mutex saturation on Intel HD 520 hardware (#408).
- **Filmstrip Priority Preemption & Deferral** — deferred coarse baseline thumbnail prewarming until after session open and added visible-viewport priority preemption, reducing project load time to under 100ms and achieving 100% cache hit rates on subsequent scrubs (#404, #405).
- **Dynamic Intel iGPU Proxy Tiering** — implemented Phase 2 dynamic proxy resolution scaling and GPU JIT pipeline pre-warming to prevent stutter during scrub bursts on integrated graphics (#400, #402).

## [1.5.3] - 2026-09-22

### 🐛 Bug Fixes

- **Native OS window controls restored (Windows & Linux)** — removed the custom close/minimize/maximize overlay and the startup override that forced borderless decoration. Real OS window controls are now used on Windows and Linux. Editor and launch top bars retain their fixed heights; macOS keeps its traffic-light space and native drag region unchanged (#368).
- **Sticky playhead handle + full-height needle** — the scrubber handle no longer scrolls off-screen when the user scrolls vertically through a tall track stack. The handle stays docked in the sticky ruler (24 px) and the needle spans the full content height including all tracks. Snap guides extend to the same height, eliminating premature clipping at horizontal scrollbar boundaries (#360).
- **Windows TLS upload failure resolved** — telemetry session uploads were failing silently on Windows machines with enterprise root certificates, antivirus SSL inspection, or system proxies (`UnknownIssuer` TLS error). Fixed by adding `rustls-tls-native-roots` to reqwest, which reads the Windows CryptoAPI certificate store. Added a 3-attempt retry loop with exponential backoff (1 s, 2 s) and a gzip → uncompressed JSON fallback on the third attempt. If the native Rust upload still fails, the frontend falls back to browser `fetch()` inside the WebView (#359).
- **Windows startup perf-log noise silenced** — eliminated spurious `file not found` diagnostic errors on Windows when the session log file was not yet created at startup (#363).
- **3 Rust compiler warnings eliminated** — removed an unused `tokio::process::Command` import (guarded to macOS/Linux), a dead `dxgi_active` mutable variable, and a duplicate `render_path` assignment that was overwritten before being read (#359).

### ⚡ Performance

- **Adaptive Intel GPU preview quality stepping** — introduced a hardware-aware preview quality policy for Intel GPUs:
  - _Intel HD 520 + 4K canvas_ → pinned to 1280 px proxy preview (no stepping).
  - _Intel UHD 630 + 4K canvas_ → starts at 720 p proxy; can step down to a lower proxy under sustained frame pressure.
  - _Intel Iris Xe (modern)_ → starts full quality; steps down to reduced after 3 budget misses in a 12-sample sliding window, preventing queue buildup during scrub bursts.
  - Policy is session-stable; a single cold frame does not trigger oscillation. Export and source media are never affected (#364, #365, #367).
- **Parallelized project-session loading** — startup load time reduced by parallelizing store-module setup and deferring non-critical native raster prewarm:
  - First 3 native text/image shader boundaries remain startup-critical.
  - Remaining boundaries prewarm asynchronously after editor activation with yields between batches to avoid starving the main thread.
  - A single in-flight guard prevents concurrent raster-prewarm walks from contending for the native GPU session.
  - Per-stage timing added for stores, preview runtime, font loading, audio initialization, and native raster prewarm (#369).

### 📡 Telemetry

- **Transfer-path classification per frame** — every presented native frame is now tagged with its actual render path: `dxgi-zero-copy`, `cpu-nv12`, `cpu-rgba`, `mixed`, or `gpu-raster`. Pre-render drops remain unlabelled. Path flows through the Rust performance contract → TypeScript interface → telemetry events, enabling fleet analytics to break down decode and upload costs by render path (#366).
- **Telemetry integrity fixes** — three data-quality issues resolved:
  - Aggregate `droppedFramesRatio` now clamped to 1.0; impossible >100 % drop rates no longer reach the database.
  - Native frames no longer double-count in session rollups when both native and frontend traces fire for the same frame.
  - Seek telemetry no longer fabricates 60 / 20 / 20 % decode/upload/compose splits; records only the measured end-to-end latency and marks stage attribution as unavailable (#364).
- **Effective preview policy in telemetry** — every native performance sample carries the current `capabilityPolicy` (`full` / `reduced` / `proxy`), enabling fleet reports to measure whether Intel quality mitigation is working (#365).
- **End-to-end worker performance telemetry** — unified `WorkerPerfCollector` tracking p50/p95/p99 round-trip and worker-internal compute times across all Web Workers: `KeyframeEval`, `TimelineSnap`, `Project`, `ColorScopes`, `WaveformLod`, `SubtitleParser`, sticker/template rasterizers, and body-segmentation ML inference. Worker errors are written to the session NDJSON log in real time (#356).
- **Session load timing in lifecycle diagnostics** — total load duration, per-stage breakdown, and failure duration are now recorded in lifecycle diagnostics and session performance logs without capturing any content (#369).

### 🛠️ Developer / CI

- **`test:all` unified test runner** — added a single `pnpm test:all` script that runs the full Vitest suite, TypeScript typecheck, and focused Rust unit tests in sequence (#362).
- **RC1 benchmark suite** — added a release-gate benchmark suite with a YouTube upload acceptance scenario for automated performance regression detection (#361).

## [1.5.2] - 2026-09-21

### 🎨 Spatial Motion Paths & GPU Shutter Motion Blur

- **2D Spatial Motion Paths** — added interactive on-canvas Bézier motion paths directly overlaid on the Program Preview. Visual creators can adjust multi-point trajectories using draggable diamond anchor nodes, centripetal Catmull-Rom auto-tangents for curvature smoothing, and directional tangent handles (blue for incoming, orange for outgoing) with sub-pixel snapping.
- **Direction-Aware GPU Shutter Motion Blur** — implemented a dedicated WGSL post-processing compute pass that calculates instantaneous velocity vectors from spatial trajectory derivatives. Simulates real camera shutter motion blur with configurable shutter angle (`0°`–`360°`), configurable sampling quality (8, 16, or 32 samples per pixel), and automatic velocity scaling based on clip playback rate.
- **Inline Timeline Keyframe Lane** — added collapsible, per-clip keyframe tracks below timeline clips with diamond keyframe indicators, multi-property keyframe selection, inline value scrubbing, ease curve visualizers, and right-click curve type assignment.

### ✨ Advanced Animation Engine: Cubic Bézier, Spring Physics & Time Anchoring

- **Custom Cubic Bézier Curves** — full CSS-compatible cubic Bézier easing engine (`cubic-bezier(x1, y1, x2, y2)`) featuring an 8-iteration Newton-Raphson solver with a 14-iteration bisection fallback for inflection points and near-zero derivative boundaries. Built-in presets include standard easings, kinetic character curves (`easeOutBack` with overshoot, `easeInBack` with anticipation), and CapCut-style speed profiles (`speedHero`, `jumpCut`, `bullet`).
- **Closed-Form Physical Spring Dynamics** — integrated a damped harmonic oscillator spring model (`springPhysics.ts`) solving underdamped, critically damped, and overdamped motion analytically in \(O(1)\) time without numerical Euler drift. Provides intuitive physics parameters (`stiffness`, `damping`, `mass`, `initialVelocity`) and preset configurations (`snappy`, `bouncy`, `wobbly`, `gentle`, `stiff`) for natural, organic motion graphics.
- **Responsive Time Anchoring (Build-In / Build-Out)** — introduced intelligent keyframe time anchoring (`timeAnchor.ts`) supporting `start` (anchored to clip in-point) and `end` (projected backwards from clip out-point). Includes an elastic compression guard that proportionally scales animation segments when clips are trimmed shorter than their intro and outro durations, preventing keyframe collisions, clipping, or inverted timing.

### ⚡ Zero-Copy Direct GPU Pipeline & Windows D3D11VA → DX12 Interop

- **Zero-Copy D3D11VA → wgpu DX12 Texture Pipeline (Windows)** — decoded NV12 frames flow directly from FFmpeg D3D11VA hardware decoders into the wgpu DirectX 12 compositor via NT shared handles (`render_nv12_from_imported_texture`). Eliminates host memory roundtrips, CPU RAM PCIe copies, and CPU NV12-to-RGBA conversion from the critical path.
- **Physical Adapter Matching on Hybrid/Optimus GPUs** — DXGI adapter enumeration via `CreateDXGIFactory1` automatically matches `VendorId` and `DeviceId` to wgpu's selected GPU, binding FFmpeg hardware decoding and wgpu presentation to the exact same physical graphics adapter on dual-GPU laptops.
- **Win32 NT Handle Duplication** — enabled `Win32_System_Threading` with `DuplicateHandle` in `D3d11SharedFrame::duplicate()`, allowing safe, independent NT shared handles across lookahead queues and multi-layer presentation passes without handle exhaustion or drop races.
- **Targeted Surface Pipeline Warmup** — optimized native-surface initialization on Windows to compile only the active `Bgra8UnormSrgb` compositor pipeline rather than compiling 5 unused RGBA readback pipelines. Slashes render graph readiness latency from 17.9 seconds to 26 milliseconds on low-power Intel HD graphics.

### 🚀 Hardware-Accelerated Export Engine & Real-Time Direct Pipe

- **Direct Native GPU Export Pipeline** — implemented an end-to-end GPU render-to-encoder pipeline that feeds composition frames directly from the wgpu render target into native hardware encoders without host RAM staging. Delivers Real-Time Factors (RTF) exceeding 2.0x on 4K HEVC exports with zero dropped frames.
- **Platform Hardware Encoders** — integrated native platform encoders via VideoToolbox (macOS) and NVENC / AMF / Intel QSV (Windows), supporting high-efficiency H.264 and HEVC output.
- **Standard Rec.709 & BT.2020 Colorimetry Tagging** — injected standard color space, transfer characteristics, and color primaries metadata into native MP4 and MOV container headers, ensuring color-accurate reproduction across QuickTime, YouTube, and browser players.
- **Export Throughput & RTF Telemetry** — added comprehensive export stage tracking measuring encode FPS, cumulative encoding time, frame delivery latency, and rolling peak memory usage.

### 🎞️ Native Preview & Playback Stability Remediation (macOS & Windows)

- **Six Critical Playback Instability Fixes (BUG-1 through BUG-6)**:
  - _BUG-1_: Eliminated audio pops and glitches during timeline split operations under active playback.
  - _BUG-2B_: Resolved timeline playhead drift during rapid scrubbing.
  - _BUG-3_: Fixed timeline scrub stutter and decoder stalls when crossing clip boundaries.
  - _BUG-4_: Eliminated playhead jumps when clicking to seek during active playback.
  - _BUG-5_: Fixed track desynchronization following gap deletion.
  - _BUG-6_: Resolved race conditions between transport state transitions and decoder thread pools.
- **Backward Seek & Clock Re-anchoring** — resolved backward seek freezes caused by monotonic clock (`Instant`) and epoch timestamp (`request_started_at`) mismatches. Stabilized A/V sync drift to sub-millisecond tolerances (-0.67 ms average).
- **Lock-Free Live Timeline Editing** — replaced `Mutex<FrameRequest>` with `parking_lot::RwLock<Arc<FrameRequest>>` in `NativeRenderSession`. Render ticks read double-buffered snapshots in ~5 ns without locking, allowing seamless clip trimming, splitting, and movement during active 60fps playback without audio glitches or lookahead flushes.
- **Lookahead Timing Re-attribution** — re-anchored lookahead cache hits to presentation start time rather than queue residency, eliminating 13,657 false frame-anomalies and saving ~48 MB of telemetry log bloat per editing session.
- **Fallback Readback Clamping** — capped RGBA fallback readback requests to 1080p maximum, reducing uncompressed frame transfers from 33.17 MB to 8.29 MB and eliminating 350–760 ms seek freezes on 4K/8K sources.
- **Pipelined Audio Startup** — consolidated 6 discrete synchronous IPC commands into a single pipelined audio initialization pass, eliminating 18 ms startup latency and startup audio pops.
- **macOS WindowServer Contention Elimination** — atomic surface visibility caching eliminates redundant `show_surface` calls, preventing macOS WindowServer display-sync locks at 60 Hz.
- **Native Swapchain Prewarming** — added immediate swapchain texture acquisition and clear in `configure_surface`, absorbing initial `CAMetalLayer` and DXGI backbuffer lock overhead on initialization and collapsing cold surface acquire latency from 284 ms to ~2 ms.
- **High-Efficiency MKV/MP4 Demuxer** — introduced `AVDISCARD_ALL` stream filtering at the libavformat layer to discard non-video streams during demuxing, eliminating memory allocations and packet handling for non-video streams.
- **Canonical POSIX Path Normalization** — unified path normalization across frontend bridge and Rust backend, preventing WebKit `asset://` URI leakage into FFmpeg demuxers.

### ⏩ Two-Stage Coarse-to-Fine Seeking & Proxy Scrubbing

- **Two-Stage Coarse-to-Fine Seeking Pipeline** — timeline scrubbing and seek clicks default to `allowKeyframeApprox=true` for instant visual response (<15 ms). A debounced refinement timer (60 ms) automatically performs exact decoding (`quality=full`, `allowKeyframeApprox=false`) once playhead dragging settles.
- **Quarter-Resolution Proxy Fast-Path** — coarse seeks downscale to quarter quality (capped at 480px width) during active scrubbing, collapsing cold-jump keyframe seek latency on long-GOP 4K media from 1,421 ms to under 20 ms.
- **DPB Packet Draining Optimization** — wrapped decoder DPB buffer draining inside `if !found` guards in `decode_frame_raw_nv12_with_options` and `decode_frame_dxgi_windows`, exiting immediately upon keyframe match rather than traversing trailing GOP packets.
- **Cache Pollution Separation** — tagged NV12 ring-buffer and prime cache entries with approximation flags (`is_approximate`), guaranteeing approximate scrub frames never contaminate exact paused frame requests.
- **Seamless Seek-Without-Pause** — timeline clicking and arrow key navigation seamlessly update playhead position without forcing transport pause; audio and video clocks re-anchor continuously.

### 🎥 AV1 Media Engine, Proxies & Sidecar Diagnostics

- **CLI FFmpeg Fallback with libdav1d** — added automated fallback to CLI FFmpeg with `libdav1d` when in-process AV1 decoders fail, generating WebP poster frames in under 200 ms.
- **Hardware AV1 Decode Detection** — queries macOS VideoToolbox at runtime to accurately detect hardware AV1 support (Apple Silicon M3+), routing older platforms to optimized software pipelines.
- **Automatic AV1 Proxy Generation** — automatically generates lightweight H.264 proxies (`ultrafast`, `crf 24`, `yuv420p`) for AV1 assets on WebKit-incompatible platforms.
- **Self-Healing Media Library** — `MediaCard` automatically detects stuck gray placeholder thumbnails and re-triggers poster frame extraction on mount.
- **MediaRuntime Diagnostics API** — added `MediaRuntime` with engine availability, bundled-sidecar provenance, and versioning, exposing clean status in the UI ('Export engine ready (v8.0)').
- **Sidecar Verification Gate** — added `scripts/verify-sidecars.mjs` to validate bundled FFmpeg binaries and reject stub wrappers during CI and release packaging.

### ⌨️ Keyboard Shortcuts & Cross-Platform Modifier Parity

- **Cross-OS Modifier Normalization** — unified shortcut listeners using `isMeta = e.ctrlKey || e.metaKey`, ensuring `Cmd` on macOS and `Ctrl` on Windows/Linux work interchangeably across all editing commands.
- **International Keyboard Layout Parity** — added physical `e.code` fallbacks across all shortcut handlers, guaranteeing full functionality on AZERTY, QWERTZ, Dvorak, and Cyrillic keyboard layouts for Split, Duplicate, Ripple Delete, Nudge, and Cut/Copy/Paste.
- **Project Save Shortcut** — added `Cmd+S` / `Ctrl+S` quick save with non-intrusive toast feedback.
- **Zoom-to-Fit Shortcut** — added `Cmd+0` / `Ctrl+0` alias alongside `Shift+Z` to fit the entire timeline within the viewport.
- **Arrow Keyboard Seeking & Frame Stepping**:
  - While paused: `ArrowLeft` / `ArrowRight` steps 1 frame; `Shift+Arrow` jumps 1.0 second.
  - While playing: `ArrowLeft` / `ArrowRight` jumps 1.0 second; `Shift+Arrow` jumps 5.0 seconds without interrupting playback.
  - `Alt+Arrow` nudging preserved without shortcut collision.

### 📊 End-to-End Worker & Engine Performance Telemetry

- **Unified Worker Performance Collector (`WorkerPerfCollector`)** — added a centralized worker performance collector tracking computation and IPC round-trip duration (`durationMs`), internal worker execution (`workerDurationMs`), processed item counts, budget breaches (>16.67 ms frame deadline), and unhandled worker errors.
- **Live Diagnostics Surface** — exposed real-time worker metrics on `window.__clypra_diagnostics.workerPerf`, providing windowed percentiles (P50, P95, P99, Max, Avg) and an anomaly ring buffer for live debugging.
- **Auto-Instrumented WorkerBus** — automatically captures execution metrics across all WorkerBus domains: `ComputeWorker:KeyframeEval` (`evalMs`), `ComputeWorker:TimelineSnap` (`durationMs`), `ComputeWorker:Project` (`serializeMs`, `diffMs`), `MediaAnalysisWorker` (`analysisMs`), `WaveformLodWorker`, and `SubtitleParserWorker` (`parseMs`).
- **Dedicated Worker Instrumentation** — added timing attribution to `stickerRasterizerWorkerClient` (Lottie/GIF rasterization), `templateRasterizerWorkerClient` (text template layout and render passes), and `bodySegmentationWorkerClient` (MediaPipe segmentation inference and mask transfer).
- **Animation Evaluation Budget Monitoring** — instrumented `evaluateTimelineScene` in `evaluator.ts` with scene evaluation timing, occluded layer culling duration, and culled layer counts against the 16.67 ms display budget.
- **Snap, Ripple & Serialization Profiling** — timing attribution for timeline snapping queries, ripple calculations, and project autosave cycles.
- **Filmstrip & Color Scopes Telemetry** — forwarded tile generation and `recordPaintCommit` metrics to `WorkerPerfCollector` under `filmstrip:artifact`, `filmstrip:cache`, and `filmstrip:paint` domains.
- **Real Process Memory Tracking** — introduced `get_process_memory_mb` Tauri command backed by `libc::getrusage(RUSAGE_SELF)` on macOS and Linux, replacing static memory placeholders with live rolling peak RAM metrics across all telemetry events.
- **Session Log Gzip Streaming** — implemented gzip compression for session NDJSON upload streaming, preventing upload timeouts on slow connections.
- **Local Anomaly Throttling with Peak Preservation** — intelligent local filtering throttles high-frequency frame and seek anomalies to prevent log bloat while guaranteeing the highest latency outliers are preserved.

### 🛠️ CI Pipeline & Cross-Platform Build Hardening

- **Rust Clippy Cross-Platform Remediation** — added `#[allow(unused_variables)]` to `ctx` in `decoder.rs`, resolving `-D warnings` compilation failures on Linux runners while preserving macOS/Windows hardware context usage.
- **Timeline Clip Test Hardening** — added safe optional chaining for `expandedKeyframeClipIds` in `Clip.tsx` and updated test mock suites in `Clip.test.tsx`.
- **Windows DXGI CLI Compatibility** — resolved compilation issues for `clypra-native-cli` on Windows runners.

## [1.5.1] - 2026-09-17

### 🧠 AI Body Effects & WebKit Worker Reliability

- **Classic worker fallback for MediaPipe body segmentation** — migrated `bodySegmentation.worker.ts` from module worker (`{ type: "module" }`) to classic worker (`{ type: "classic" }`). Resolves the `"ModuleFactory not set."` WASM loader failure under WKWebView (macOS) that triggered silent degradation to heuristic body segmentation in v1.5.0.
- **Inference resolution clamping & adaptive mask upscaling** — clamped segmentation inference dimension to 512px with hardware-accelerated Canvas2D bilinear upscaling, maintaining responsive scrub FPS.
- **Per-clip serial worker dispatch** — added `dispatchOrQueue` with timeout protection in `bodySegmentationWorkerClient.ts` to prevent out-of-order mask responses during rapid playhead scrubbing.

### 🔤 Text Effects & Templates Enhancements

- **Text transform styling** — added comprehensive support for CSS-style `uppercase`, `lowercase`, and `capitalize` text transforms in text effects and template layout calculations (`applyTextTransform`).
- **Template document node font preloading** — updated `templateStore.ts` to automatically extract and preload fonts from document nodes in text template artifacts.
- **Sanitized text style updates** — fixed text clip style updates to preserve cleaned position and dimension recalculations when modifying typography properties.

## [1.5.0] - 2026-09-12

### ⚡ Zero-Copy Hardware Acceleration & Performance (Windows & Cross-Platform)

- **Zero-copy DXGI shared texture pipeline on Windows** — D3D11VA hardware-decoded frames are imported directly into wgpu through DXGI shared NT handles and Direct3D 12 HAL interop. Decoded frames remain entirely in GPU VRAM, eliminating the 10–14ms PCIe round-trip (`av_hwframe_transfer_data` to CPU RAM + `queue.write_texture` back to GPU) on discrete NVIDIA RTX and AMD Radeon graphics cards.
- **16-frame decoded NV12 LRU ring-buffer cache** — decoders now retain up to 16 recent raw NV12 frames in an in-memory ring-buffer. Repeated queries and fine-scrub backward adjustments within 15ms hit the cache in **0ms** with zero decoding and zero heap allocations via shared `Arc<[u8]>` pointer reuse.
- **Keyframe-only fast scrub decoding** — during active timeline scrubbing, seeks to non-keyframe timestamps return the preceding keyframe (I-frame) immediately without sequential decoding of 30–60 delta P/B-frames. Collapses scrub seek latency from 600ms–1.5s down to 1–2ms on NVIDIA RTX.
- **Adaptive scrub velocity & 150ms exact settle debounce** — dragging the playhead dynamically selects resolution quality based on pointer speed, settling to an exact full-quality frame within 150ms of the pointer pausing or releasing.
- **DirectX 12 adapter preference on Windows** — WGPU adapter scoring prioritizes the DX12 backend (+500 score boost) over Vulkan on dual-backend Windows discrete GPUs to ensure zero-copy DXGI texture sharing succeeds out of the box.

### 🐧 Cross-Platform Reliability & Linux Telemetry

- **Pure-Rust statically-linked TLS with bundled certificates** — switched `reqwest` to `rustls-tls` with bundled Mozilla roots (`webpki-roots`), removing dependencies on host-system `libssl.so`. Ensures HTTPS telemetry uploads succeed reliably across diverse Linux distributions (Ubuntu, Fedora, Arch, Alpine) regardless of system OpenSSL ABIs.
- **Pending session log auto-recovery on startup** — added `upload_pending_perf_logs` in Rust and wired `retryPendingUploads()` into `perfLogService.openSession()`. Un-uploaded session NDJSON files left behind by app force-close, crash, or offline sessions are automatically detected and uploaded on subsequent app launch.
- **Zero-duplicate telemetry ingestion** — completed session logs are renamed to `.uploaded` on successful ingestion, and `purge_perf_logs` prunes aged files past retention limits.
- **Optimus laptop presentation pacing** — `choose_present_mode()` prioritizes `Mailbox` (triple-buffered, non-blocking) and `FifoRelaxed` over strict `Fifo`, eliminating the 60fps → 30fps DWM cross-adapter stutter cliff on hybrid graphics laptops (59.4% of Windows fleet).
- **Hybrid GPU telemetry detection** — tagged `isHybridGpu` in `TelemetryHardwareContext` to monitor Optimus laptop presentation in production metrics.
- **Telemetry verification CLI tool** — added `scripts/verify-telemetry-delta.mjs` to validate live production telemetry against baseline metrics and falsification thresholds.

### ✂️ Timeline Editing

- **Select all clips in track** — right-click any track label to open the new track context menu and choose **Select All Clips in Track**. All clips on that track are added to the multi-selection in one action; gap and transition selections are cleared. The shortcut **⌘A** (macOS) / **Ctrl+A** (Windows/Linux) also works when the mouse is hovering over a track row, scoping the selection to that track only rather than selecting every clip across all tracks.
- **Delete all clips in track** — the same track context menu exposes **Delete All Clips in Track**, which ripple-deletes every clip on the track in a single undoable step. The command is disabled if the track is locked or already empty.
- **Track context menu on label right-click** — right-clicking the sticky track label column now opens a dedicated track context menu (distinct from the existing empty-space context menu). It surfaces track-scoped commands alongside the existing lock / mute / visibility toggles.

## [1.4.5] - 2026-08-27

### 🔤 Native GPU SDF Text Engine & Font Registry

- **Native Signed Distance Field (SDF) text rendering** — migrated text rendering from browser canvas to GPU-accelerated wgpu/WGSL SDF shaders for razor-sharp typography at any preview scale.
- **Native font registry & WOFF2 support** — added `register_native_font` / `register_native_font_bytes` IPC commands; native core automatically decodes bundled WOFF2 and TTF fonts via `woff2-patched`.
- **Per-glyph font fallback & Noto Emoji** — `render_text_sdf_aligned_with_fallback` seamlessly resolves missing glyphs to the bundled `@fontsource/noto-emoji` fallback font.
- **Synthetic weight & italic transforms** — pre-SDF bitmap dilation and skewing synthesize bold and italic styles for single-weight fonts.
- **Contract v2 text snapshots** — extended native contract to v2, introducing text runs for timed karaoke/captions, vertical alignment, and multi-pass text shaders.
- **Native text templates & compound clip reuse** — text templates instantiate natively with full styling and shader passes preserved across export and preview.
- **Retired browser text rasterization** — desktop preview and export render text layers directly via wgpu, removing canvas raster roundtrips and DOM bottlenecks.

### 🔊 Professional Audio Engine & Timeline Controls

- **Extended native audio mixer** — Rust mixer supports fade-in / fade-out curves, keyframe interpolation, pan, channel routing, and pitch preservation.
- **Interactive audio envelope editor** — CapCut-style volume rubber bands and fade handle knobs directly on clips with cubic Bézier curves.
- **J/L-cut audio unlinking** — added `UnlinkAudioCommand` and `RelinkAudioCommand` for independent audio/video trimming and J/L cut workflows.
- **Atomic audio graph updates** — `replaceNativeAudioClips` IPC synchronizes audio edits in-place without restarting playback decoders.
- **Desktop Web Audio engine** — browser desktop audio path honors clip-level `preservePitch` with smooth time-stretching.
- **Waveform fade curves & solo button** — waveforms render overlaid fade curves with source-scoped peak caching and per-track solo controls.

### 🔄 Session-Safe Deferred Updates & Auto-Updater Pipeline

- **Two-stage update lifecycle** — separated update download from installation via `AutoUpdateManager` singleton; active editing sessions are never interrupted.
- **Save-before-update verification** — transport playback is paused and project state is atomically saved and verified before update restart; save failures abort installation safely.
- **Unified updater state** — synchronized update notifications, downloading status, and restart prompts across SettingsModal and UpdateBanner.

### 💾 Project Persistence Reliability & Crash Recovery

- **Atomic save pipeline** — verified candidate write (`.tmp`), generation rotation (`.bak`), and atomic file replacement with save receipt verification.
- **Transactional project hydration** — `validateAndMigrateProjectPayload` safely migrates legacy project fields; hydration failures roll back to the previously active project.
- **Failure-isolated recent projects** — corrupt or unreadable projects no longer hide valid projects and offer one-click recovery from verified backup files.
- **Crash recovery snapshot v2** — IndexedDB snapshot persists timeline gaps, markers, and schema version.
- **Cross-platform save hardening** — resolved Windows backup rename races and mobile Capacitor overwrite/rename paths.

### 🖥️ Dual-Monitor Workspace & Preview Layouts

- **Dual-monitor preview workspace** — added `PreviewMonitorWorkspace` supporting configurable side-by-side row and stacked column orientations for Source and Program monitors.
- **Independent preview panels** — `PreviewPanel` supports an explicit `mode` prop ("program" vs "source") regardless of global preview state.
- **Interaction-deferred transport context** — `SourcePreview` defers transport claiming until user interaction, preventing accidental playback hijacking on mount.

### 🎨 Design System, Semantic Tokens & Clip Palettes

- **Per-theme clip palettes** — clip colors derive from dynamic semantic design tokens (`--clypra-clip-*`) mapped 1-to-1 with UI themes.
- **Full palette fidelity** — eliminated heavy CSS saturation and opacity filters that dulled theme palette colors.
- **Live theme preview swatches** — Settings theme swatches preview actual built-in clip palette color schemes.

### 📐 Timeline Viewport Precision & Interactions

- **Sub-pixel alignment & 20px clip-start offset** — consistent timeline coordinates across Ruler, Clips, Playhead, Gaps, and mouse/wheel seek anchors via `TIMELINE_CLIP_START_OFFSET_PX`.
- **Refined visual hierarchy** — distinct A-roll (primary) and B-roll visual roles with dedicated track heights.
- **Visual track ordering guards** — visual tracks are prevented from being placed below the main video track, enforced across drag/drop and history undo/redo.
- **CapCut-style ruler** — clean ticks with compact `MM:SS` formatting under one hour and `HH:MM:SS` timecodes for longer projects.
- **Spring-animated zoom & canonical overview** — buttery-smooth anchored wheel zoom with spring physics; projects reliably open at standard minimum zoom.

### ⚡ Performance, Telemetry & Lookahead Pre-fetching

- **Zero-PII performance telemetry** — lightweight client and collector reporting stage timings and dropped frames with adaptive sampling.
- **Bounded lookahead pre-fetching** — predictive decoding warms upcoming clip assets within a 3-second horizon without saturating GPU presentation.
- **Event-driven paused render loop** — native preview pauses RAF loops while stopped, waking instantaneously on state and transform changes.
- **24-track compositor density** — validated multi-track layer pooling and composition stability up to 24 concurrent tracks.

### 🛠️ UI Polish & Workflow Shortcuts

- **Collapsible properties panel** — 44px collapsed rail with expand button and shortcut icons; `Alt+P` / `Cmd+Shift+P` toggle shortcut.
- **Media library shortcut** — `Cmd+B` toggles the media library drawer.
- **Transform overlay polish** — RAF-throttled gizmo tracking, enlarged hit targets, and diagonal resize cursors.

## [1.4.4] - 2026-08-25

### ⚡ Program Preview Performance

- **Smoother native Program Preview playback and scrubbing** — removed high-frequency decoder console I/O from the frame path and kept native-surface diagnostics from blocking presentation.
- **Native-surface playback telemetry** — added optional timings for decoder wait/decode, YUV conversion/upload, composition, surface acquisition, and present submission.
- **RGBA readback telemetry** — separated compositor time from GPU readback/map time for paused seeking and scrubbing.
- **Mode-aware preview statistics** — performance data is partitioned across playback, lookahead, seek, scrub, frame-step, and prefetch with P50/P95/P99 stage percentiles.
- **Frontend preview tracing** — added bounded dispatch, IPC, and canvas-paint measurements keyed by request ID, generation, and frame index.
- **Accurate cache metrics** — native-surface staging frames are no longer counted as RGBA frame-cache hits.

## [1.4.3] - 2026-08-25

### ✂️ Timeline Editing

- **Ripple-left trim no longer creates a gap** — left-edge ripple trim now keeps the clip anchored at its start time; only `trimIn` and duration are updated, and downstream clips shift left cleanly.
- **Atomic undo/redo for trim gestures** — every trim (including ripple-trim) is committed as one `TimelineTrimCommand` that restores clips, gaps, and downstream positions together.
- **Atomic undo/redo for clip drag** — moving or dropping clips — including onto a new track — creates a single `TimelineDragCommand` entry; undo restores tracks, clips, gaps, and ordering exactly.
- **New-track drops land at the pointer position** — clips no longer jump to `startTime = 0`; snapping remains active within 8 px of valid targets.
- **Departure-gap closure** — when a clip moves to a new track only the gap it leaves behind is closed; earlier gaps on the source track are preserved.
- **Split selects only the right clip** — after splitting, only the continuation clip is selected so Delete removes just the new half.
- **Atomic split-all at playhead** — splitting all clips at once is wrapped in a single history transaction for a one-step undo.
- **Swap clips is undoable** — `SwapClipsCommand` validates locks, same-track moves, and collisions before committing and updates transition references.
- **Duplicate clips is undoable** — `DuplicateClipsCommand` regenerates IDs recursively through compound clip trees.

### 🗂️ Clip Organisation

- **Compound Clips (Group Clips)** — select multiple clips and press **Alt+G** (or use the context menu) to collapse them into one movable unit. Ungroup restores the originals. Compound clips are single-track only.
- **Clip rename** — right-click any clip and choose **Rename Clip**, or use the context menu's rename item; the change is fully undoable.
- **A-roll / B-roll visual hierarchy** — video tracks are now classified as A-roll (main, accent border) or B-roll (secondary, muted saturation) using `TrackVisualSpec`. Each track label shows a role icon.
- **Media type labeling** — audio tracks display a waveform icon; text, sticker, effect, and filter tracks each have their own icon in the track label.
- **Resize handles are selection-only** — trim handles are hidden on unselected clips, removing accidental resize interactions.

### 🔊 Audio

- **Detach Audio** — right-click a video clip and choose **Detach Audio** to split the embedded audio into an independent audio clip on its own track. The operation is undoable.
- **Audio Extraction pipeline** — backend Tauri commands (`probe_media_streams`, `start_audio_extraction`, `cancel_media_job`, `get_media_job_result`) and a `mediaJobStore` lay the groundwork for background format-aware audio extraction.
- **Audio decoder seek fix** — the native audio seek now uses the global microseconds time-base (`AV_TIME_BASE`) instead of the stream's sample-rate time-base, preventing mis-seeks on clips with non-zero `trimIn`.
- **Preroll trimming** — decoded PCM preroll from keyframe-aligned seeks is trimmed before mixing so the audio starts at the exact requested source position.
- **Detached audio is invisible to the compositor** — clips with `kind === "audio"` are excluded from the visual evaluator and `PreviewMediaPool` video-element allocation.

### ⚡ Performance & Playback

- **Adaptive scrub quality** — playhead drag velocity is tracked in real time; fast scrubs request `quarter` or `half` quality and settle on a full-quality frame on release.
- **Seek generation tracking** — `SeekController` assigns a monotonically increasing generation to every seek so stale decode results can never overwrite a newer frame.
- **Native batch cancel** — `cancel_native_preview_requests` stops FFmpeg work at packet and frame boundaries when a newer seek arrives, with per-request `AbortController` cancellation in the JS scheduler.
- **Hardware acceleration re-enabled** — VideoToolbox (macOS), D3D11VA (Windows), and VAAPI (Linux) are active again with a `get_format` callback for per-frame pixel format negotiation.
- **Native playback queue doubled** — queue capacity increased from 3 to 6 frames for smoother continuous playback.
- **Filmstrip batch decode** — missing tiles are collected across an entire request, sorted chronologically, and decoded in chunks of 12 with a single GOP seek per chunk.
- **L0 tile pinning** — coarse filmstrip tiles (L0) are protected from LRU eviction; dense L1–L3 tiles absorb all eviction pressure first.
- **Per-file decode mutex** — concurrent zoom/scroll batch requests queue behind a per-file async mutex so the decoder is never stampeded.
- **RAF-coalesced zoom slider** — toolbar zoom drag now coalesces pointer move events to one update per animation frame.
- **Fit-sequence clamping fix** — "Fit Sequence" no longer clamps the zoom floor away; the overview level is preserved.

### 📊 Metrics & Telemetry

- **A/V sync metrics** — frontend (`syncMetrics.ts`) and Rust (`sync_metrics.rs`) modules track clock/poll drift, frame pacing jank, dropped frames, and end-to-end seek latency.
- **Filmstrip metrics HUD** — press **Cmd+Shift+M** to open the live debug overlay showing per-tier decode/convert timing (SRC, L0–L3), cache hit rates, A/V drift p95, UI playhead drift, and native seek correctness.
- **5-second aggregate logs** — both the Rust and JS metric collectors emit structured summaries every 5 seconds for profiling without log flood.
- **Per-stage timing** — batch decode now records separate seek, decode, convert, and serialize durations per tier.

### 🛠️ Editor & UX

- **Right-click context menus** — clip and empty-space context menus are available throughout the timeline with viewport-aware flip placement, grouped items, disabled-state hints, and keyboard shortcut labels.
- **Command registry** — all timeline editing actions (split, trim, delete, duplicate, swap, group, rename, close gaps) are routed through a shared `clipCommands`/`timelineCommands` registry for consistent keyboard, toolbar, and context-menu behavior.
- **Close All Gaps** — new toolbar command packs every unlocked track in one undoable transaction.
- **Preview scrub follows timeline** — paused preview scrubs keep the timeline playhead visible; selecting a clip from the program monitor scrolls it into view without jumping if it is already partially visible.
- **Active clip highlight** — clips under the program preview playhead glow with a subtle accent ring in program mode.
- **Full process exit on window close** — closing the app now calls `exit(0)` (macOS: `CloseRequested` handler) so the process does not linger after the window is dismissed.
- **Updater manifest URL rewrite** — CI now rewrites GitHub API asset URLs to direct public download URLs in `latest.json` and `updater.json` before publishing, fixing auto-update on all platforms.

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

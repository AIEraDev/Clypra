---
name: clypra-dev
description: >-
  Master engineering guide for Clypra — a Tauri/React/Rust desktop video editor.
  Activate when: making architectural decisions, implementing new subsystems,
  debugging performance/playback issues, reading perf session logs, adding bug
  fixes to any part of the system, designing features, or onboarding to the project.
  Required reading for: KIRO, Codex, Cursor, Copilot, and all agents joining for the first time.
---

# Clypra Engineering Skill — Full System Reference

> This skill covers the ENTIRE Clypra system. Read the section(s) relevant to your task.
> For subsystem-specific docs, see `docs/preview/` for native preview deep dives.

---

## 1. What Clypra Is

Clypra is a **native desktop video editor** (v1.5.9) — macOS/Windows.
- Non-linear editing (NLE) with a track-based timeline
- Multi-track video, audio, text, sticker, caption, and effects support
- Native GPU rendering via wgpu/Metal/DX12
- AI-assisted features: auto-captions (Whisper), auto-reframe, background matting (ClyMatte)
- Export via FFmpeg (MP4, MOV, WebM, GIF) with cloud export option
- Device transfer (AirDrop-style local transfer)

---

## 2. Technology Stack

| Layer | Technology | Location |
|---|---|---|
| **Desktop shell** | Tauri 2.x | `src-tauri/` |
| **Frontend** | React 18 + TypeScript + Vite | `src/` |
| **State management** | Zustand stores | `src/store/` |
| **GPU renderer** | wgpu + Metal (macOS) / DX12 (Win) | `src-tauri/src/wgpu_compositor/` |
| **Video decode** | FFmpeg (via ffmpeg-next) + VideoToolbox (macOS HW accel) | `src-tauri/src/engine/` |
| **Audio engine** | CPAL (cross-platform audio) | `src-tauri/src/audio/`, `src-tauri/src/native_audio.rs` |
| **AI / ML** | ONNX Runtime (ort), Whisper.cpp | `src-tauri/src/commands/whisper.rs`, `src-tauri/src/commands/ai.rs` |
| **Thumbnail engine** | Custom Rust tile pyramid | `src-tauri/src/thumbnail_engine/` |
| **Export** | FFmpeg H.264/H.265/WebM + cloud | `src/lib/export/`, `src-tauri/src/commands/export.rs` |
| **IPC bridge** | Tauri `invoke()` + binary push channel | `src/lib/platform/tauri.ts` |
| **Background matting** | ClyMatte (custom ML model) | `src-tauri/src/clymatte/` |

---

## 3. Repository Layout

```
clypra/
├── src/                              # TypeScript/React frontend
│   ├── main.tsx                      # App entry point
│   ├── components/
│   │   ├── editor/
│   │   │   ├── preview/              # Preview engine (NativeProgramPreview, etc.)
│   │   │   ├── timeline/             # Timeline UI (tracks, clips, playhead)
│   │   │   ├── properties/           # Inspector panel (transform, audio, effects)
│   │   │   ├── sidebar/              # Asset browser (media, text, stickers, etc.)
│   │   │   ├── toolbar/              # Top toolbar
│   │   │   ├── transform/            # On-canvas transform overlay
│   │   │   ├── scopes/               # Video scopes (waveform, vectorscope)
│   │   │   └── viewport/             # Viewport controls (zoom, safe zones)
│   │   ├── screens/
│   │   │   ├── EditorScreen.tsx      # Main editor layout
│   │   │   └── LaunchScreen.tsx      # Project picker
│   │   └── ui/                       # Design system primitives
│   ├── core/                         # NLE engine (no React deps)
│   │   ├── animation/                # Keyframe interpolation, motion presets, spring physics
│   │   ├── audio/                    # Native audio controller, AudioEngine (Web Audio API)
│   │   ├── compositor/               # Semantic scene graph (JS-side)
│   │   ├── evaluation/               # Timeline → EvaluatedScene (canonical rendering currency)
│   │   ├── fonts/                    # Deterministic font loading
│   │   ├── history/                  # Command pattern undo/redo
│   │   ├── media/                    # Audio detection, crop math, focal point
│   │   ├── playback/                 # PlaybackClock (single time source)
│   │   ├── render/                   # Render engine, raster surfaces, schedulers
│   │   ├── runtime/                  # ProjectSession, AppLifecycleCoordinator
│   │   ├── storage/                  # Project serialization/deserialization
│   │   ├── telemetry/                # Client-side performance metrics
│   │   ├── timeline/                 # Audio clip builders, gap engine
│   │   └── workers/                  # Web Worker pool management
│   ├── store/                        # Zustand stores (see §5)
│   ├── types/                        # Shared TypeScript type definitions
│   ├── lib/                          # Pure utility libraries
│   │   ├── export/                   # Export pipeline (video, audio, OTIO)
│   │   ├── filmstrip/                # Thumbnail filmstrip (tiles, layout, tiers)
│   │   ├── platform/                 # Tauri bridge, device capabilities
│   │   ├── renderEngine/             # WebGL raster surface, render scheduler
│   │   ├── timeline/                 # Placement engine, gap manager, snap targets
│   │   └── text/                     # Text clip builders, text animations
│   ├── features/                     # Self-contained features
│   │   ├── captions/                 # AI captions (Whisper-based)
│   │   ├── text-templates/           # Animated text template system
│   │   ├── transitions/              # Transition renderer
│   │   └── video-effects/            # Video effect picker + API
│   ├── hooks/                        # React hooks (usePlayback, useTimeline, etc.)
│   ├── services/                     # App-level services (telemetry, perf logging, updater)
│   └── workers/                      # Web Workers (compute, mediaAnalysis, rasterizers)
├── src-tauri/src/                    # Rust backend
│   ├── engine/                       # Core render + decode engine
│   │   ├── graph/                    # Render graph (DAG executor, resource pool)
│   │   ├── planner/                  # Frame planning + lookahead queue
│   │   ├── playback/                 # Playback controller state machine
│   │   ├── qos/                      # Quality-of-service, adaptive decode
│   │   ├── temporal/                 # Temporal cache (decoded frame reuse)
│   │   ├── timeline/                 # Rust-side timeline model + evaluator
│   │   ├── decoder.rs                # VideoToolbox / FFmpeg decoder
│   │   ├── presenter.rs              # wgpu surface present
│   │   └── telemetry.rs              # Engine-side metrics
│   ├── wgpu_compositor/              # GPU compositing pipeline
│   │   ├── multi_track_composer.rs   # Multi-track blend & composite
│   │   ├── text_effect_pipeline.rs   # GPU text effect rendering
│   │   ├── transition_pipeline.rs    # GPU transition rendering
│   │   ├── chroma_key.rs             # Chroma key shader
│   │   ├── lut_texture.rs            # LUT (color grading) support
│   │   ├── frame_scheduler.rs        # Frame deadline management
│   │   └── yuv_ring_buffer.rs        # YUV frame ring buffer
│   ├── audio/                        # CPAL audio graph
│   ├── thumbnail_engine/             # Tile pyramid + mmap cache
│   ├── clymatte/                     # Background matting ML pipeline
│   ├── commands/                     # Tauri IPC command handlers
│   ├── native_core/                  # Native preview session lifecycle
│   ├── transfer/                     # Device-to-device transfer server
│   └── sync_metrics.rs               # Frame pacing + AV drift accumulator
└── docs/preview/                     # Deep-dive docs for the preview subsystem
```

---

## 4. Core Data Model

### Project
```typescript
interface Project {
  id: string;
  name: string;
  aspectRatio: AspectRatio;     // "16:9" | "9:16" | "1:1" | "4:3" | "21:9"
  frameRate: number;            // e.g. 30, 60
  tracks: Track[];
  assets: MediaAsset[];
  creatorThumbnail?: CreatorThumbnail;
}
```

### Track
```typescript
interface Track {
  id: string;
  type: TrackType; // "video" | "audio" | "text" | "sticker" | "filter" | "caption" | ...
  clips: Clip[];
}
```

### Clip (base)
```typescript
interface Clip {
  id: string;
  kind: ClipKind;             // "video" | "audio" | "image" | "text" | "sticker" | ...
  startTime: number;          // seconds on project timeline
  duration: number;           // seconds
  sourceOffset: number;       // seconds into the source asset
  playbackMapping: PlaybackMapping; // normal | reverse | freeze | speed-ramp
  effects: ClipEffect[];
  keyframes: Record<VisualPropertyKey, VisualPropertyKeyframe[]>;
  // ...plus kind-specific fields on VideoClip, AudioClip, TextClip, etc.
}
```

### MediaAsset
```typescript
interface MediaAsset {
  id: string;
  path: string;               // native FS path — may be "" until hydrated
  streams: MediaStreamInfo[];
  width?: number;
  height?: number;
  // ...
}
```

**Critical**: `asset.path` may be empty (`""`) when a project is first loaded — the asset hasn't been probed/hydrated yet. Always guard for this before passing paths to Rust IPC.

---

## 5. State Management — Zustand Stores

All stores live in `src/store/`. Each store has a clear ownership contract:

| Store | Owns | Persisted |
|---|---|---|
| `timelineStore` | Track/clip composition, zoom, scroll, selection | Yes (via projectStore) |
| `projectStore` | Active project metadata, save/load lifecycle | Yes (disk) |
| `historyStore` | Undo/redo command stack | No (session only) |
| `uiStore` | Panel sizes, active tabs, modal visibility | Partially |
| `exportStore` | Current export job state + progress | No |
| `exportHistoryStore` | Past export records | Yes |
| `settingsStore` | User preferences (theme, quality, shortcuts) | Yes |
| `mediaJobStore` | Background media analysis jobs (probe, waveform) | No |
| `captionStore` | Caption segments and style | Yes (via projectStore) |
| `cameraStore` | Camera recording state | No |
| `recordingStore` | Screen/voiceover recording state | No |
| `dragStateStore` | Active drag operation (timeline drag, media drop) | No |
| `favoritesStore` | Starred effects/templates | Yes |
| `presetStore` | Export presets | Yes |

**Rules:**
- Never put runtime/ephemeral state in a persisted store
- Timeline mutations go through `timelineStore` actions — never mutate clip arrays directly
- `historyStore` wraps mutations in commands (see `src/core/commands/`)
- `projectStore` owns serialization — do not call Tauri file APIs from other stores

---

## 6. Rendering Architecture

### The canonical rendering pipeline

```
timelineStore (source of truth)
      ↓
evaluateTimelineSceneCached()           ← core/evaluation/evaluator.ts
      ↓
EvaluatedScene (universal currency)     ← typed scene graph for a given time T
      ↓
  ┌─────────────────────────────────────────────────────────────────┐
  │  Render targets (consume EvaluatedScene):                       │
  │  • Preview (NativeProgramPreview)   → wgpu Metal surface        │
  │  • Export (videoExport.ts)          → FFmpeg frame sequence     │
  │  • Thumbnail (thumbnail_engine)     → mmap tile cache           │
  │  • Filmstrip (filmstripTileCache)   → timeline filmstrip tiles  │
  └─────────────────────────────────────────────────────────────────┘
```

**Rule**: All rendering paths consume `EvaluatedScene`. Never build ad-hoc renderers that re-read `timelineStore` directly — always go through `evaluateTimelineSceneCached()`.

### Preview path selection

```
EMBEDDED_PREVIEW_ONLY (defaults to false unless VITE_CLYPRA_NATIVE_SURFACE=0)?
  ├── Yes (disabled) → web-canvas (IPC readback path)
  └── No  (default)  → native Metal/DirectX 12 surface path:

    nativeAudioClockReady = !isTauriRuntime() || clock.hasNativeClockPosition
    nativePlaybackPath    = isTauriRuntime() && playing && nativeAudioClockReady
    nativeDirectSurface   = nativeSurfaceUsable && nativeRequest && (playing || paused)
```

Full preview architecture: `docs/preview/NATIVE_SURFACE_ARCHITECTURE.md`

### WebGL render engine (web-canvas path)

`src/lib/renderEngine/renderEngine.ts` — manages the WebGL context, texture cache, and compositing pipeline for the web-canvas preview and export fallback. Key types: `RasterSurface`, `RenderScheduler`, `ISM` (incremental scene model).

---

## 7. Timeline System

### Placement engine (`src/lib/timeline/placementEngine.ts`)
Handles where clips land when dragged/dropped. Implements magnetic snapping, ripple-insert, and gap-aware placement. Depends on `snapTargets.ts` for snap point computation.

### Gap engine (`src/lib/timeline/gapEngine.ts`)
Gaps are first-class timeline objects (`Gap` type). Operations:
- `detectGaps()` — scan track for implicit gaps
- `insertGapWithRipple()` — push clips forward
- `removeGapWithRipple()` — pull clips back
- `packTrack()` — collapse all gaps

### History / undo-redo (`src/core/history/`)
Command pattern. Every timeline mutation that should be undoable is wrapped in a `Command` object with `execute()` / `undo()`. Commands are dispatched via `historyStore.dispatch(command)`.

### Keyframe system (`src/types/keyframes.ts`)
Clips can have per-property keyframe tracks (`VisualPropertyKeyframe[]`). Evaluated by `src/core/animation/keyframeTrackOps.ts` at render time. Supported easing: linear, bezier, spring, step.

---

## 8. Audio Architecture

### Dual audio mode

| Mode | When | Stack |
|---|---|---|
| **Web Audio API** | Browser / web-canvas preview | `AudioEngine.ts`, `AudioPlaybackAdapter.ts`, `AudioFXNodeChain.ts` |
| **CPAL native audio** | Tauri runtime + native surface | `NativeAudioPreviewController`, `native_audio.rs`, `audio/mod.rs` |

### Web Audio path (`src/core/audio/AudioEngine.ts`)
- Uses the Web Audio API `AudioContext` for decoding and mixing
- `AudioFXNodeChain` — per-clip gain + pan + fade
- `AudioBufferPool` — decoded buffer reuse
- Clock: `AudioContext.currentTime` (high-resolution, drift-free)

### Native CPAL path (`src/core/audio/nativeAudioPreviewController.ts`)
- Drives CPAL (Rust) via IPC: `replaceNativeAudioClips`, `seekNativeAudio`, `nativePlayFromAudio`
- `syncNativeAudioTimeline()` — builds clip layout from timeline, installs into Rust graph
- `getActiveAudioClips()` — filters clips to those with resolvable paths (guards empty `""` paths)
- Clock: CPAL hardware clock → `setNativeClockPosition()` → `PlaybackClock.hasNativeClockPosition`
- **Gate**: `nativeAudioClockReady = !isTauriRuntime() || clock.hasNativeClockPosition`

### PlaybackClock (`src/core/playback/PlaybackClock.ts`)
Single source of truth for playback position. Singleton per app session.
- `state`: `"idle" | "playing" | "paused"`
- `time`: current playback position in seconds
- `hasNativeClockPosition`: true when CPAL position received OR `markNativeAudioUnavailable()` called
- `markNativeAudioUnavailable()` / `clearNativeAudioUnavailable()` — for projects with no audio clips
- `nativeAudioWasUnavailable` getter — read-before-clear for transition detection
- After any change to this file: **restart the dev server** (it's a module-level singleton, HMR won't update it)

---

## 9. Export Pipeline

### Flow
```
ExportDialog → exportPreflight() → verifyExportDependencies()
             → evaluateTimelineSceneCached() per frame
             → renderNativeFrame() (Tauri) OR WebGL fallback
             → FFmpeg encoder (via native_export Tauri command)
             → output file
```

### Key files
| File | Role |
|---|---|
| `src/lib/export/videoExport.ts` | High-level export orchestration |
| `src/lib/export/exportSequence.ts` | Frame-by-frame render loop |
| `src/lib/export/exportPreflight.ts` | Pre-flight dependency check |
| `src/lib/export/exportPresets.ts` | Preset configs (H.264 1080p, 4K, etc.) |
| `src/lib/export/frameBatching.ts` | Batched frame submission for throughput |
| `src/lib/export/nativeTimelineExport.ts` | Native (Rust-side) export path |
| `src/lib/export/cloudExport.ts` | Cloud export API integration |
| `src/lib/export/otioExporter.ts` | OpenTimelineIO export |
| `src-tauri/src/commands/export.rs` | Rust FFmpeg encoding commands |
| `src-tauri/src/commands/native_export.rs` | Native frame rendering for export |

### Rules for export
- Always call `exportPreflight()` before starting — it checks for missing text effects, unsupported codecs, disk space
- Frame batching is critical for throughput on high-fps exports — use `frameBatching.ts`
- Export must drain the `historyStore` undo stack before starting (prevents mid-export state mutation)
- Progress is reported via `ExportProgress` callbacks — never block the UI thread

---

## 10. Thumbnail & Filmstrip System

### Thumbnail engine (Rust)
`src-tauri/src/thumbnail_engine/` — tile-based pyramid system:
- `stream_actor.rs` — async decode actor per video stream
- `pyramid.rs` — multi-resolution tile pyramid (low → high res tiers)
- `mmap_cache.rs` — memory-mapped disk cache for decoded tiles
- `atlas.rs` — GPU texture atlas for efficient tile upload
- `queue.rs` — priority queue for decode requests

### Filmstrip (JS)
`src/lib/filmstrip/` — manages which tiles to request:
- `filmstripTiers.ts` — quality tiers based on timeline zoom level
- `filmstripLayout.ts` — visible tile geometry calculation
- `FilmstripTileCache.ts` — JS-side tile cache (prevents re-requesting cached tiles)
- `useFilmstrip.ts` — React hook for timeline clip filmstrip

**Rule**: Filmstrip requests are rate-limited and prioritised by viewport visibility. Never request tiles for off-screen clips at high resolution.

---

## 11. AI / ML Features

### Auto-captions (Whisper)
`src-tauri/src/commands/whisper.rs` + `src/features/captions/`
- Runs Whisper.cpp on-device for transcription
- `WhisperSettings` in settings store: model size, language
- Output: word-level timestamps → `CaptionWord[]` → `captionStore`
- Export: SRT, VTT, or burned-in via `src/lib/captions/exportSidecar.ts`

### Background matting (ClyMatte)
`src-tauri/src/clymatte/` + `src-tauri/src/commands/native_clymatte.rs`
- Custom ML model for real-time background removal
- Applied as a clip effect in the render pipeline
- ONNX Runtime (ort) for inference

### Auto-reframe
`src-tauri/src/commands/auto_reframe.rs`
- Detects subject and reframes for target aspect ratio
- Uses ONNX-based object detection

---

## 12. Device Transfer

`src-tauri/src/transfer/` — local network transfer:
- `server.rs` — Axum HTTP server (localhost)
- `discovery.rs` — mDNS/Bonjour device discovery
- `session.rs` — chunked file transfer session
- `device.rs` — paired device registry
- Frontend: `src/components/ui/TransferPanel.tsx`

---

## 13. Text & Captions System

### Text clips (`TextClip`)
- Rendered via `TextSourcePreview.tsx` (canvas-based text renderer)
- Animated text: `src/lib/text/textAnimation.ts`
- Text templates: `src/features/text-templates/` (pre-built animated text sequences)

### Caption system
- `src/store/captionStore.ts` — segments + style
- `src/lib/captions/captionEvaluator.ts` — renders active caption at frame T
- `src/lib/captions/captionStyle.ts` — caption style properties
- Safe zone enforcement: `src/lib/captions/safeZone.ts`

---

## 14. IPC Contract & Bridge

All Rust↔JS communication goes through `src/lib/platform/tauri.ts`.

### Rules
- Every `invoke()` call is a promise. Always `await` and handle rejection.
- Cold IPC (first call after process start) costs 50–500ms. Don't assert tight timing.
- Never call `invoke()` inside a RAF callback for non-frame-essential work — batch or debounce.
- Binary push channel (`playbackPushBridge.ts`) bypasses invoke for high-frequency frame data.
- The IPC security layer (`src-tauri/src/commands/security.rs`) validates all incoming paths — never pass unvalidated user strings as file paths.

### Key IPC commands
| Command | Purpose |
|---|---|
| `render_native_frame` | Render a single frame for export/preview |
| `configure_native_playback` | Set frame rate, duration, project revision |
| `replace_native_audio_clips` | Install audio clip graph in CPAL |
| `seek_native_audio` | Seek CPAL position |
| `native_play_from_audio` | Start CPAL playback |
| `get_native_audio_diagnostics` | Poll audio engine state |
| `request_thumbnail` | Request a thumbnail tile decode |
| `start_native_export` | Begin FFmpeg encoding session |
| `get_sync_metrics` | Read frame pacing + AV drift |

---

## 15. Telemetry & Performance Logging

### Session logs
Written to: `~/Library/Application Support/com.deenminder.clypra/perf_logs/` (macOS)
Format: NDJSON (one event per line). Uploaded as `.ndjson.uploaded`.

### Key event kinds for debugging
| Kind | What it tells you |
|---|---|
| `native-session-telemetry` | `framesProduced` — if stuck at 2, Rust render loop never ran |
| `engine-telemetry` | Decode/render/present latency, zero-copy status |
| `native-sync` | Rust frame pacing (jank rate, AV drift) |
| `audio-snapshot` | Audio engine state (installed clips, callbacks, outcome) |
| `frontend-rollup` | JS-side fps, render path, frame anomalies |
| `frontend-av-sync` | JS playhead jitter and drift |
| `seek-span` | Per-seek cold/warm latency breakdown |
| `engine-qos-decision` | QoS adaptive quality decisions |

### Healthy session signature
```
framesProduced ≈ sessionDurationSecs × nominalFps
frame_pacing.jank_events / n < 0.05      (< 5% jank)
mean_decode_us < 5,000                   (warm VT decoder)
mean_present_us < 100                    (Metal surface healthy)
cpu_readback_bytes = 0                   (zero-copy active)
audio.outcome = "audible"
```

---

## 16. Bug History — Never Re-introduce

All bugs tested in `src/components/editor/preview/__tests__/ProgramPreview.renderLoop.test.ts` (131 tests, append-only).

| Bug | File(s) | Root Cause | Fix |
|---|---|---|---|
| **1** | `NativeProgramPreview.tsx` | `renderInFlight` released before async overlay work finished | Early release + `scheduleNextFrame()` + `return` |
| **2** | `NativeProgramPreview.tsx` | `setTimeout` + RAF double-scheduling | Removed `setTimeout`; single `scheduleNextFrame()` |
| **3** | `NativeProgramPreview.tsx` | `syncPreviewMedia` called every RAF tick | `needsSync` guard |
| **4** | `adaptiveReadbackPolicy.ts` | Cadence caps too low (30fps max), recovery threshold too high | Caps: 15/24/30/60fps; recovery threshold 90→30 |
| **5** | `nativePreviewScheduler.ts` | `requestVisible()` aborted in-flight prefetch | Only cancel visible in-flight; let prefetch complete |
| **6** | `playbackPushBridge.ts` | `receive()` called `requestAnimationFrame()` per packet | Removed RAF; synchronous tracking state |
| **7** | `NativeProgramPreview.tsx` | `lastNativePlaybackRequestKey` set before snapshot-ready guard | Key only assigned after `submitNativePlaybackDemand()` fires |
| **8A** | `PlaybackClock.ts`, `nativeAudioPreviewController.ts` | Silent projects: `hasNativeClockPosition` stays false → video frozen | `markNativeAudioUnavailable()` / `clearNativeAudioUnavailable()` |
| **8B** | `audioClips.ts` | Empty asset paths passed to Rust → `no-native-audio-clips-installed` | `.filter(c => Boolean(c.path))` at end of `getActiveAudioClips()` |
| **9** | `nativeAudioPreviewController.ts`, `PlaybackClock.ts` | Late audio install → seek-back to position 0 | Read `wasUnavailable` before clearing; enqueue `seekNativeAudio(clock.time)` + `nativePlayFromAudio()` if clock was playing |

---

## 17. Key Architectural Invariants (All Agents Must Know)

1. **One time source per session.** `PlaybackClock` is the single authority. No secondary clocks.

2. **`EvaluatedScene` is the rendering currency.** All render targets (preview, export, thumbnail, filmstrip) must consume it. Never re-read `timelineStore` directly in render hot paths.

3. **Timeline mutations go through commands.** Use `historyStore.dispatch(command)` for anything that should be undoable. Direct store mutations bypass history.

4. **Asset paths are async.** `asset.path` is `""` until the probe completes. Guard before passing to Rust. The `getActiveAudioClips()` filter (`Boolean(config.path)`) is the canonical enforcement point.

5. **IPC is expensive.** Every `invoke()` costs 0.5–2ms warm, 50–500ms cold. Batch, debounce, and use the push bridge for high-frequency data.

6. **TypeScript errors silently break the Vite bundle.** Run `npx tsc --noEmit` after every change. The dev server will appear to hot-reload but serve stale code.

7. **`PlaybackClock` is a module-level singleton.** HMR cannot update it. Always restart the dev server after changes to `PlaybackClock.ts` or `nativeAudioPreviewController.ts`.

8. **The render loop is a pure closure.** `NativeProgramPreview.tsx` uses captured `let` variables, not class state. Every new stateful variable needs an epoch guard and a cleanup reset.

9. **`renderInFlight` must be reset in every exit path.** Missing resets cause permanent render loop freeze. Same for `scheduleNextFrame()` — it must be called in every path that expects the loop to continue.

10. **Export must not mutate timeline state.** Export runs concurrently with the UI. Never modify `timelineStore` from the export pipeline.

---

## 18. Environment Variables

| Variable | Default | Effect |
|---|---|---|
| `VITE_CLYPRA_NATIVE_SURFACE` | unset (enabled) | Set to `"0"` to force WebGL/web-canvas bridge fallback |

Set in `.env.local` (never commit) or inline:
```bash
# Force fallback to web-canvas bridge mode:
VITE_CLYPRA_NATIVE_SURFACE=0 pnpm tauri dev
```

---

## 19. Testing Conventions

### Test locations
| Area | Test file |
|---|---|
| Preview render loop | `src/components/editor/preview/__tests__/ProgramPreview.renderLoop.test.ts` |
| Timeline store | `src/store/__tests__/` |
| Core types | `src/types/__tests__/` |
| Engine (Rust) | `src-tauri/src/engine/*_tests.rs` |
| Thumbnail engine | `src-tauri/src/thumbnail_engine/tests.rs` |
| IPC security | `src-tauri/src/commands/ipc_security_tests.rs` |

### JS/TS test rules
- `ProgramPreview.renderLoop.test.ts` is **append-only**. Current baseline: **131 tests, 0 failures**.
- Every bug fix → a `describe("Bug N — Title")` block appended to the test file.
- Run: `npx vitest run src/components/editor/preview/__tests__/ProgramPreview.renderLoop.test.ts`

### Rust test rules
- `cargo test` in `src-tauri/`
- Golden frame tests: `src-tauri/src/preview_golden.rs` / `golden_harness/`
- Proptest (property-based): `thumbnail_engine/proptest.rs`

---

## 20. Key Commands

```bash
# Frontend dev server (web-canvas path)
pnpm dev

# Full Tauri dev (native surface by default)
pnpm tauri dev

# TypeScript check (must pass before any commit)
npx tsc --noEmit

# Run render loop tests
npx vitest run src/components/editor/preview/__tests__/ProgramPreview.renderLoop.test.ts

# Run all JS tests
pnpm test

# Rust tests
cargo test --manifest-path src-tauri/Cargo.toml

# Rust engine benchmark
cargo run --example clypra-engine-benchmark --manifest-path src-tauri/Cargo.toml

# Build production
pnpm tauri build
```

---

## 21. Quick Subsystem Decision Guide

| Task | Start here |
|---|---|
| Adding a clip type | `src/types/index.ts` → `timelineStore` → `evaluator.ts` → render target |
| Timeline edit operation | `src/core/commands/` → `historyStore.dispatch()` |
| New effect / filter | `src/types/compositor.ts` → `wgpu_compositor/effect_interpreter.rs` |
| New AI feature | `src-tauri/src/commands/ai.rs` → ONNX model integration |
| Audio feature | `nativeAudioPreviewController.ts` (native) or `AudioEngine.ts` (web) |
| Export format | `src/lib/export/exportPresets.ts` + `src-tauri/src/commands/export.rs` |
| New IPC command | `src-tauri/src/commands/mod.rs` + `src/lib/platform/tauri.ts` |
| Performance regression | Read perf logs (§15), check `framesProduced`, `mean_decode_us`, `jank_events` |
| Preview bug | Read `docs/preview/NATIVE_SURFACE_ARCHITECTURE.md` first |
| Text/caption feature | `src/features/captions/` + `src/lib/text/` + `src/lib/captions/` |
| Thumbnail quality | `src-tauri/src/thumbnail_engine/pyramid.rs` + `src/lib/filmstrip/filmstripTiers.ts` |

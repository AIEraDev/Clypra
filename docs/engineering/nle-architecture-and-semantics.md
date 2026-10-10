# Clypra NLE Architecture & Editorial Semantics

## 1. Overview: The Three-Protection Architecture Model

Non-linear video editing (NLE) introduces specialized engineering challenges that differ fundamentally from standard CRUD desktop applications: media timing, multi-track compositing, dual-pipeline audio/video synchronization, asynchronous asset hydration, and frame-accurate rendering consistency.

To prevent coding agents and developers from introducing subtle regressions, Clypra enforces a **Three-Protection Engineering Model**:

```
┌────────────────────────────────────────────────────────────────────────┐
│ Protection 1 — Domain Guidance                                         │
│ (.agents/skills/nle-domain-engineering/SKILL.md)                       │
│ Encodes universal NLE principles, timecode rules, and domain concepts. │
│ Prevents agents from making simplistic web-app assumptions.            │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ Protection 2 — Architecture Specification                              │
│ (docs/engineering/nle-architecture-and-semantics.md)                   │
│ Documents how Clypra CURRENTLY represents time, owns state, and        │
│ coordinates media pipelines. Prevents agents from ignoring the engine. │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ Protection 3 — Automated Verification Suites                           │
│ (Vitest & Cargo regression tests)                                      │
│ Mechanically proves that timing, sync, and rendering behave correctly. │
│ Catches violations regardless of which AI agent produced the code.     │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Time Representation & Temporal Mathematics

### 2.1 Canonical Time Domains in Clypra

Clypra coordinates time across four distinct representations:

| Time Domain | Unit / Representation | Primary Owner | Module Location | Constraints & Invariants |
|---|---|---|---|---|
| **Timeline Session Time** | Floating-point seconds ($t \ge 0.0$) | `PlaybackClock` (Singleton) | [`src/core/playback/PlaybackClock.ts`](file:///Users/AIEraDev/Documents/clypra-family/clypra/src/core/playback/PlaybackClock.ts) | Monotonic wall-clock or hardware audio clock. Sole authority for session playhead position. |
| **Microsecond IPC Timestamp** | Integer microseconds ($\mu\text{s}$) | Rust IPC Dispatcher | `src-tauri/src/commands/native_playback.rs` | Integer microsecond coordinates passed across Tauri IPC to avoid float precision loss during native decode scheduling. |
| **SMPTE Display Timecode** | Formatted string (`HH:MM:SS:FF` or `HH:MM:SS;FF`) | Presentation Layer | [`src/lib/timecode/smpteTimecode.ts`](file:///Users/AIEraDev/Documents/clypra-family/clypra/src/lib/timecode/smpteTimecode.ts) | UI display only. Never used as internal lookup keys or timestamps. Handles drop-frame calculation for 29.97 / 59.94 fps. |
| **Discrete Audio Samples** | Integer samples ($i_{sample} = \lfloor t \cdot f_s \rfloor$) | CPAL Ring Buffer | `src-tauri/src/audio/` | $48\,000\text{Hz}$ or $44\,100\text{Hz}$ sample indices for frame-accurate audio alignment. |

### 2.2 Mathematical Invariants
1. **Zero Accumulated Floating-Point Error**: Playhead advancement must never use iterative delta addition ($t \mathrel{+}= \Delta t$). Session time is always calculated from monotonic wall-clock anchors (`performance.now()`) or CPAL sample counts.
2. **Rational Frame Snapping**: Frame boundaries are derived from the sequence frame rate:
   $$\text{frameIndex} = \operatorname{round}(t \times \text{fps})$$
3. **Sequence Frame Rates Supported**: `23.976`, `24.0`, `25.0`, `29.97` (DF/NDF), `30.0`, `50.0`, `59.94` (DF/NDF), `60.0` fps.

---

## 3. Timeline Composition & Track Semantics

### 3.1 Track Layering & Compositing Hierarchy
- **Video Tracks**: Composited strictly bottom-to-top (higher track index = foreground layer). Video clips on track $V_{n+1}$ occlude clips on track $V_n$ unless blending, opacity, or spatial transforms permit background visibility.
- **Audio Tracks**: Mixed additively across all unmuted tracks. Volume and pan automation curves are applied per clip before track summing.

### 3.2 Gaps as First-Class Editorial Entities
- Gaps represent explicit unpopulated intervals on a track.
- The gap management engine ([`src/lib/timeline/gapEngine.ts`](file:///Users/AIEraDev/Documents/clypra-family/clypra/src/lib/timeline/gapEngine.ts)) handles ripple deletions, gap closures, and magnetic snapping.

### 3.3 Clip Invariants
- $\text{duration} > 0.0$ (zero or negative clip durations are strictly prohibited).
- $\text{trimIn} \ge 0.0$ and $\text{trimOut} \le \text{asset.duration}$.
- Timeline range $[\text{startTime}, \text{startTime} + \text{duration}]$ must be clamped within track boundaries.

### 3.4 Command-Pattern Mutations
- Direct array mutations on `timelineStore` are forbidden.
- All timeline edits must be dispatched through `historyStore.dispatch(command)` using command objects in [`src/core/commands/`](file:///Users/AIEraDev/Documents/clypra-family/clypra/src/core/commands/).

---

## 4. Audio and Playback Synchronization Architecture

### 4.1 Dual-Pipeline Independence
Video decoding and audio output run in parallel on separate native pipelines:
- **Video Pipeline**: FFmpeg / VideoToolbox / D3D11VA $\rightarrow$ `wgpu` multi-track compositor $\rightarrow$ Metal / DX12 / WebGL.
- **Audio Pipeline**: CPAL 0.18 native hardware stream $\rightarrow$ `rtrb` lock-free ring buffer $\rightarrow$ `wsola` time-stretching.

### 4.2 Independent Media Readiness & Silent Projects
- **Rule**: Video preview must **never** hang waiting for audio initialization.
- If audio is unprobed, unavailable, or the project contains no audio tracks, `PlaybackClock` activates high-resolution wall-clock mode via `markNativeAudioUnavailable()`.
- When an audio device initializes or active audio clips become available, `PlaybackClock` seamlessly transitions authority without jumping playhead position.

### 4.3 Seek Revision & Stale Frame Rejection
- Every user seek increments `seekIntentRevision`.
- Asynchronous decoders and push bridges check the revision before presenting frames to prevent out-of-order frame flashing during rapid scrubbing.

---

## 5. Media Asset Hydration & Lifecycle

### 5.1 The Four-Stage Asset Lifecycle
Media assets progress through four explicit lifecycle states:

```
[1. Registered]  ──>  [2. Probed]  ──>  [3. Decoder Ready]  ──>  [4. Playback Active]
(id created,         (streams, duration,   (FFmpeg / HW codec      (frames actively
 path may be "")      dimensions known)     pool initialized)       streaming)
```

### 5.2 Asynchronous Path Hydration Rule
- When a project is loaded, `MediaAsset.path` is initially empty (`""`) until database verification and probing complete.
- **Invariant**: Frontend timeline and audio helpers must never pass unhydrated paths to native Rust commands. Always filter via `.filter(c => Boolean(c.path))`.

---

## 6. Preview & Rendering Consistency: EvaluatedScene

### 6.1 The Canonical Currency Rule
Both the real-time interactive preview viewport and the background FFmpeg export pipeline consume the **exact same** scene representation:
$$\text{EvaluatedScene} = \operatorname{evaluateTimelineSceneCached}(\text{timelineStore}, t)$$

- **Preview Path**: EvaluatedScene $\rightarrow$ WebGL / native `wgpu` surface presentation.
- **Export Path**: EvaluatedScene $\rightarrow$ frame-by-frame offline render $\rightarrow$ FFmpeg pipe.
- Differences are strictly limited to render resolution, color space, and frame pacing. Transform matrices, opacity, transitions, and clip selections must be mathematically identical.

### 6.2 Export Verification Rule
- Successful export must never be inferred solely from exit code 0 or file existence.
- Export preflight verifies disk space and codecs. Post-export validation verifies stream count, audio channel layout, duration, and container header integrity.

---

## 7. Project Persistence & Schema Migration

### 7.1 Format & Atomic Writes
- Project documents use JSON serialization (`.clypra`).
- Saves use atomic temporary file replacement (`<project>.tmp` $\rightarrow$ `<project>.clypra`) with retry loops on Windows to handle OS file locking (`EBUSY`).

### 7.2 Schema Versioning
- Schema version is tracked in `project.version`.
- Forward compatibility preserves unknown fields during JSON deserialization.
- Backward migrations are implemented as pure, deterministic transformation functions with automated regression tests.

---

## 8. Editorial Interoperability & OpenTimelineIO (OTIO)

### 8.1 Interchange Contract vs Internal Runtime Model
- **OpenTimelineIO (OTIO)** is recognized as an industry standard for editorial timeline interchange between NLEs (tracks, clips, gaps, transitions, nested sequences).
- **Architectural Boundary**: OTIO is an **interchange format**, not Clypra's internal runtime execution engine. Clypra does not constrain its internal GPU compositor, audio ring buffer, or shader pipeline to OTIO abstractions.
- OTIO import/export adapters translate between OTIO schemas and Clypra's `timelineStore`, testing round-trip fidelity for supported features and explicitly reporting unsupported effects.

---

## 9. Verification Mapping: Enforceable Quality Tests

| NLE Domain Requirement | Implementation Subsystem | Automated Verification Suite |
|---|---|---|
| **Render loop & playhead sync** | `PlaybackClock`, `NativeProgramPreview` | `src/components/editor/preview/__tests__/ProgramPreview.renderLoop.test.ts` (155 tests) |
| **Timeline clip boundaries** | `timelineStore`, `Clip.tsx` | `src/components/editor/timeline/__tests__/Clip.test.tsx` |
| **Track ordering & gaps** | `gapEngine.ts`, `Track.tsx` | `src/components/editor/timeline/__tests__/Track.test.tsx` |
| **Audio timeline & sync** | `nativeAudioTimeline.ts`, `nativeAudioPreviewController.ts` | `src/core/audio/__tests__/nativeAudioTimeline.test.ts` |
| **Audio hydration & probe** | `mediaAudioDetection.ts` | `src/core/media/__tests__/mediaAudioDetection.test.ts` |
| **Export fades & range** | `audioClipsExportRangeFades.ts` | `src/core/timeline/__tests__/audioClipsExportRangeFades.test.ts` |
| **EvaluatedScene generation** | `evaluateTimelineSceneCached()` | `src/core/evaluation/__tests__/mediaTimelineRegression.test.ts` |
| **Rust GPU compositor** | `wgpu MultiTrackCompositor` | `src-tauri/tests/multi_track_compositor_tests.rs` |
| **Audio callback safety** | CPAL real-time audio thread | `src-tauri/tests/audio_callback_realtime_safety.rs` |

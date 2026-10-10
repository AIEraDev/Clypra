---
name: nle-domain-engineering
description: >-
  Guides domain-specific Non-Linear Editor (NLE) engineering in Clypra.
  Activate when implementing or modifying timeline logic, timecode/framerate math, audio-video synchronization,
  clip trimming/splitting, playback state machines, media probing/import, project persistence, or export rendering.
---

# NLE Domain Engineering Workflow

## Mission & Scope

This skill codifies domain knowledge for non-linear video editing (NLE) systems.
Unlike generic web or CRUD applications, a professional video editor operates under strict temporal mathematics, multi-track compositing hierarchies, independent audio/video hardware pipelines, asynchronous asset lifecycles, and frame-accurate rendering invariants.

This skill guides coding agents through applying verified media-engineering concepts and domain standards without inventing unsupported industry standards or making simplistic web-app assumptions.

> [!IMPORTANT]
> **Separation of Domain Guidance vs Current Implementation**:
> This skill defines universal NLE domain principles and constraints.
> For Clypra's *current* module ownership, time representations, and concrete implementations, consult the companion specification:
> [`docs/engineering/nle-architecture-and-semantics.md`](file:///Users/AIEraDev/Documents/clypra-family/clypra/docs/engineering/nle-architecture-and-semantics.md)

---

## When to Activate This Skill

Activate this skill whenever a task touches:
- Timeline clip positioning, trimming, splitting, ripple edits, magnetic snapping, or gaps.
- SMPTE timecode, rational time arithmetic, or frame rate conversions (23.976, 24, 25, 29.97, 30, 50, 59.94, 60 fps).
- Playback synchronization (`PlaybackClock`), seek handling, audio/video drift correction.
- Audio graph setup, volume automation, pan, crossfades, or CPAL / Web Audio engines.
- Media importing, probing, codec inspection, offline asset relinking, or asset hydration.
- Render graph generation, `EvaluatedScene` evaluation, transition calculation, or FFmpeg export.
- Project persistence format changes, serialization, version migrations, or undo/redo command execution.
- Editorial interchange formats such as OpenTimelineIO (OTIO).

## When NOT to Activate This Skill
- Application theme or styling changes unrelated to timeline visuals.
- Packaging scripts, CI pipeline configuration, or non-media documentation.
- Small localized bug fixes where domain behavior is already established (use `bugfix-regression`).

---

## 1. Timeline & Time Representation

### 1.1 Establish the Canonical Time Representation
Before changing any timing logic, establish the existing canonical time representation in the affected subsystem. Never guess timebases or assume that all media and project sequences share the same clock.

Distinguish between these distinct temporal domains:
1. **Source-Media Time ($t_{source}$)**: Absolute timestamp within the original media file.
   $$t_{source} = \text{trimIn} + (t_{timeline} - \text{startTime}) \times \text{playbackRate}$$
2. **Timeline Time ($t_{timeline}$)**: Project-global time in seconds, starting from 0.0 at sequence head.
3. **Sequence Frame Index ($f_{seq}$)**: Integer frame count derived from the project sequence frame rate ($f_{seq} = \operatorname{round}(t_{timeline} \times \text{fps})$).
4. **Media Timebases & Presentation Timestamps (PTS)**: Container/codec packet timebases (e.g. $1/90000$ in MPEG-TS or $1/1000$ in MP4/MKV).
5. **Audio Sample Position**: Discrete sample index based on sample rate ($i_{sample} = \lfloor t \times f_s \rfloor$ where $f_s \in \{44100, 48000\}$).
6. **SMPTE Display Timecode**: Formatted human-readable string (`HH:MM:SS:FF` or `HH:MM:SS;FF` for drop-frame).
7. **Constant vs Variable Frame Rates (CFR vs VFR)**: Account for timing variations in mobile/screen-recorded VFR media; do not assume a constant frame duration $\Delta t = 1/\text{fps}$.

### 1.2 Mathematical Invariants & Precision Rules
- **Never Accumulate Floating-Point Seconds**: Avoid iterative float addition for playhead advance ($t \mathrel{+}= \Delta t$). Iterative addition accumulates IEEE-754 rounding errors that cause frame drift over long sequences. Compute session time from integer frame counts, sample indices, or monotonic reference clocks (`performance.now()`).
- **Exact Coordinates**: Prefer exact rational representations ($N/D$) or integer frame/sample coordinates at boundaries. Make conversions explicit and test rounding, boundary conditions, and supported frame rates.
- **Display Timecode is Presentation-Only**: Never treat display timecode strings as internal lookup keys or absolute timestamps.
- **Drop-Frame (DF) vs Non-Drop-Frame (NDF)**: Handle drop-frame timecode for NTSC rates (29.97, 59.94 fps), which drop frame numbers 0 and 1 at the start of each minute except every 10th minute to match real clock time.

---

## 2. Timeline Semantics & Compositing

### 2.1 Editorial Entities & Invariants
- **Tracks, Clips, and Gaps**:
  - Video tracks composite bottom-to-top (higher track index = foreground layer).
  - Audio tracks mix additively across all unmuted tracks.
  - Gaps are first-class editorial intervals; do not assume an overlapping clip, a transition, a gap, and a paused clip share identical semantics.
- **Source vs Timeline Range**:
  - Source range: $[\text{trimIn}, \text{trimOut}]$ where $0 \le \text{trimIn} < \text{trimOut} \le \text{asset.duration}$.
  - Timeline range: $[\text{startTime}, \text{startTime} + \text{duration}]$ where $\text{duration} = (\text{trimOut} - \text{trimIn}) / \text{speed}$.
- **Boundary Invariants**: Duration must always be strictly positive ($\text{duration} > 0$). Negative durations and out-of-bounds trims must be rejected with deterministic validation errors.
- **Edit Operations**: Trimming, splitting, ripple moving, slipping, and sliding must preserve source media duration limits.
- **UI Isolation**: Keep timeline arithmetic and evaluation logic strictly decoupled from React UI components so that calculations can be verified deterministically in isolated unit tests.

### 2.2 Transactional Edit History
- All undoable timeline edits must be encapsulated in a `Command` with `execute()` and `undo()` methods.
- Mutations must be dispatched via `historyStore.dispatch(command)`. Direct in-place array modifications bypass the undo history.

---

## 3. Audio & Playback Architecture

### 3.1 Dual-Pipeline Independence
Treat audio and video as related but independently managed media execution pipelines:
- **Video Pipeline**: Decoder pool $\rightarrow$ wgpu GPU compositor $\rightarrow$ display surface.
- **Audio Pipeline**: Hardware CPAL stream $\rightarrow$ lock-free ring buffer $\rightarrow$ WSOLA time-stretcher.

### 3.2 Decoupled Readiness Rule
- **Rule**: Video preview must **never** hang waiting for audio initialization unless a documented product requirement demands that behavior.
- Define what the user sees and what the engine does when only one pipeline is ready or has failed:
  - If audio is uninitialized, delayed, or absent (silent projects), `PlaybackClock` must advance via high-resolution monotonic wall-clock time (`markNativeAudioUnavailable()`).
  - When the audio pipeline recovers or clips hydrate, clock authority transitions seamlessly without jumping or resetting the playhead.

### 3.3 Playback Synchronization, Seeking & Latency
- **Single Authority**: `PlaybackClock` is the sole session authority for playhead position. Never create secondary playback clocks.
- **Edge-Triggered Seeks**: Seeks increment a monotonic `seekIntentRevision`. Asynchronous decoders must discard in-flight decoded frames matching older revisions to prevent temporal flashing or stutter.
- **Rapid User Scrubbing**: When the user rapidly scrubs, cancel or drop in-flight visible requests and present only the latest requested frame.
- **Resource Lifetime**: Prevent duplicate playback sessions, unmanaged decoder threads, and resource leaks during rapid play/pause transitions.

---

## 4. Media Import & Lifecycle Management

### 4.1 Distinct Asset Readiness States
Never treat media presence as a single boolean flag. Media transitions through four distinct stages:
1. **Registered / File Selected**: Asset metadata record exists, but `path` may be empty (`""`) and streams are unprobed.
2. **Probed**: Container format, streams, duration, resolution, audio channels, and sample rate are verified.
3. **Decoder Ready**: Codec is initialized; hardware decoders (VideoToolbox / D3D11VA / FFmpeg) are allocated.
4. **Playback Active**: Media frames and audio samples are actively decoding and streaming.

### 4.2 Robustness & Irregularities
- **Asynchronous Path Hydration**: `MediaAsset.path` is initially empty until disk hydration completes. Always guard native IPC invocations with `.filter(c => Boolean(c.path))`.
- **Missing or Moved Media**: Missing assets must enter an explicit offline/unlinked state with placeholder rendering. Never crash or corrupt project files due to missing media.
- **Format Integrity**: Validate codecs, containers, variable frame rates, corrupted packets, and missing audio tracks during probing. Provide actionable diagnostics to the user.
- **Resource Cleanup**: Ensure background probing processes, temporary files, and decoder resources are cleanly disposed on cancellation or project close.

---

## 5. Preview & Rendering Consistency: EvaluatedScene

### 5.1 Shared Behavioral Contract
The preview system and export system must interpret the exact same project semantics:
- **Canonical Currency**: All render targets (preview viewport, export pipeline, thumbnail generation, filmstrip cache) consume `EvaluatedScene` emitted by `evaluateTimelineSceneCached()`. No renderer ever reads raw `timelineStore` state directly.
- **Permitted Differences**: Preview and export may differ in render resolution, color space, and frame pacing. They must **never** differ in clip selection, layer ordering, spatial transforms, crop boxes, opacity, transitions, or audio volume.

### 5.2 Export Pipeline Rigor
- Run `exportPreflight()` before starting encoding to verify codecs, available disk space, and asset availability.
- Use frame batching (`frameBatching.ts`) to maximize throughput for high-fps exports.
- **Output Validation**: Never infer successful rendering solely from a zero exit code or file existence. Always inspect container metadata (stream count, duration, resolution, audio channels) to guarantee file integrity.

---

## 6. Project Persistence & Editing History

### 6.1 Schema Evolution & Migrations
- Project documents must remain recoverable and forward-compatible.
- Schema version must be tracked in `project.version`.
- Deserialization must preserve unknown fields to allow roundtripping between different Clypra versions.
- When introducing schema changes, write pure, testable migration functions with automated regression tests covering historical project JSON fixtures.
- Protect against interrupted writes by using atomic temporary file swaps (`.tmp` $\rightarrow$ final).

---

## 7. NLE Standards & Interoperability (OpenTimelineIO)

### 7.1 Scope of Industry Formats
- Never claim Clypra conforms to an industry standard without concrete, verifiable evidence.
- **OpenTimelineIO (OTIO)** is an established specification for editorial interchange (timelines, tracks, clips, gaps, transitions, nested sequences).
- **Interchange vs Runtime Engine**:
  - Treat OTIO as an **interoperability interchange format**, not automatically as Clypra's internal runtime data model.
  - OTIO models editorial structure, but does not specify Clypra's real-time GPU compositor, audio ring buffers, or hardware decoding pipeline.
- When implementing import/export adapters, test round-trip fidelity for the features Clypra supports, and explicitly identify and report unsupported features.

---

## 8. Required NLE Verification Matrix

Every change touching NLE capabilities must be validated against the applicable items in this checklist:

- [ ] **Frame & Sample Boundaries**: Clip start, end, and duration align precisely with project sequence frame rate.
- [ ] **Mixed Frame Rates**: Clips with differing frame rates conform correctly without timing drift.
- [ ] **Boundary Clamping**: Negative durations and out-of-bounds trims are rejected deterministically.
- [ ] **Audio/Video Synchronization**: Playback start, pause, seek, and loop maintain AV sync within $\pm 2\text{ms}$.
- [ ] **Silent Projects**: Projects with no audio tracks play video smoothly without stalling on audio clocks.
- [ ] **Stale Frame Rejection**: Rapid scrub operations do not flash previous frames out of order.
- [ ] **Undo/Redo Invariants**: Applying an edit, undoing, and redoing restores identical timeline state.
- [ ] **Serialization & Migration**: Saving to JSON and reloading reconstructs an equivalent `EvaluatedScene`.
- [ ] **Preview/Export Parity**: Rendered export frames match preview composition pixel-for-pixel at equivalent resolutions.
- [ ] **Output Validation**: Exported media files are verified for container headers, stream counts, duration, and audio tracks.

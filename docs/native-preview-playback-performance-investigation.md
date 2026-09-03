# Native Preview Playback Performance Investigation & Engineering Runbook

**Status**: Permanent Canonical Architecture & Investigation Record  
**Target Scope**: Native Preview, Playback Clock, Lookahead Pre-decoder, FFmpeg Video Decoder, Multi-Track Compositor, and A/V Sync Telemetry.

---

## 1. Executive Summary

This document permanently records the forensic findings, mathematical models, root causes, and architectural solutions for the playback stutter, lookahead starvation, and decoder thrashing issues resolved in Clypra's native playback engine.

Future contributors and AI agents **must review this runbook** prior to modifying:
- `src-tauri/src/commands/native_preview.rs`
- `src-tauri/src/thumbnail_engine/decoder.rs`
- `src-tauri/src/commands/native_playback.rs`
- `src-tauri/src/sync_metrics.rs`
- `src/components/editor/preview/NativeProgramPreview.tsx`

---

## 2. Forensic Investigation & Bugs Resolved

### Bug 1: Cold Playback Jitter & Lookahead Starvation
- **Symptom**: Scrubbed playback was smooth, but pressing "Play" for the first time resulted in audio playing while video stuttered and jumped.
- **Root Cause**: Playback started with an empty cache. Presentation threads competed with cold decoding on every frame.
- **Solution**:
  1. Lookahead buffer priming: On playback session start (`NativeRenderSession::start`), the lookahead engine eagerly primes 16 frames into `NativePreviewFrameQueue` before presentation deadlines hit.
  2. Pause-on-seek predecoding: Seeking triggers immediate predecoding around the target playhead position so the cache is warm before playback resumes.

---

### Bug 2: The Backward Seek Trap (Frame #41 Anomaly)
- **Symptom**: During 4K 60fps playback (`Mod - Is Jude Bellingham...`), frames #1 through #40 ran smoothly via `[QUEUE_HIT]` at ~11ms decode. At Frame #41, playback collapsed into repeated cold decodes and dropped frames.
- **Root Cause**:
  1. Lookahead pre-decoded up to Frame 40 ($28 + 12 = 40$). The FFmpeg decoder state was parked at Frame 40.
  2. Lookahead worker finished its batch and exited.
  3. Presentation progressed to Frame 33 and scheduled a new lookahead worker.
  4. The new worker read `audio_clock_time` (Frame 33) and checked `queue.contains(33)`. Because presentation had already `take()`n Frame 33, it was absent.
  5. The new worker requested Frame 33!
  6. Asking FFmpeg for Frame 33 when parked at Frame 40 forced a **backward keyframe seek**, costing **349.57ms** on 4K footage.
  7. This 350ms seek held the decoder mutex, starving presentation of Frame 41 and causing an irrecoverable domino of cold decodes.
- **Architectural Rule**:
  - **Lookahead must ALWAYS be strictly forward**:
    $$\text{start} = \max(\text{audio\_frame} + 1, \text{highest\_frame\_index} + 1)$$
  - Never allow a lookahead worker to decode a frame index $\le$ any frame already decoded or in flight.

---

### Bug 3: The 16-Frame Boundary Stall & Sub-Millisecond Jitter
- **Symptom**: Every 16 frames (Frames 821, 837, 901, 965, 982, 997, 1013, 1029, 1045, etc.), lookahead hit a 250ms–450ms decode spike on boundary frames.
- **Root Causes**:
  1. `target_source_secs` was computed using floating-point `audio_clock_time` differences across worker boundaries:
     $$\Delta t = \text{target\_time\_secs} - \text{base\_timeline\_secs}$$
     Microsecond clock jitter between ticks caused newly spawned workers to request timestamps fractionally earlier ($0.0005\text{s}$) than where the decoder had finished.
  2. In `decoder.rs`, `can_decode_forward` checked `target_pts <= self.current_pts`. Even a 1-tick PTS difference triggered `av_seek_frame(..., AVSEEK_FLAG_BACKWARD)` and `self.decoder.flush()`, seeking backwards to the previous GOP keyframe.
  3. Boundary frames were decoded twice because `highest_frame_index` was only updated on `complete()`.
- **Architectural Rules**:
  - **Integer Frame Math Only**: Source time in lookahead must be strictly derived from integer frame offsets:
    $$\text{target\_source\_frame} = \text{base\_source\_frame} + (\text{target\_frame\_index} - \text{base\_frame\_index})$$
    $$\text{target\_source\_secs} = \frac{\text{target\_source\_frame}}{\text{fps}}$$
  - **Immediate In-Flight Reservation**: `NativePreviewFrameQueue::begin` advances `highest_frame_index` the moment a frame starts decoding.

---

### Bug 4: Terminal Backpressure & Global `eprintln!` Contention
- **Symptom**: Presentation total time spiked to 400ms+ even when `decode + upload + compose + present` only totaled 3.5ms.
- **Root Cause**:
  1. Rust's `eprintln!` acquires a global mutex (`io::stderr().lock()`). Multiple Tokio tasks and the render loop blocked each other waiting for stderr.
  2. Synchronous `write(2)` syscalls (60–120/sec) saturated the OS pipe buffer between Tauri and the terminal emulator (Vite / Terminal.app / VSCode). Once the pipe buffer filled, `write()` blocked the render thread for up to 50ms.
- **Architectural Rules**:
  - **Log by Exception**: Only log when a frame violates the 33.33ms budget (`total_ms > 33.33` or `predecode_ms > 33.33`) or cold-decodes (`!queue_hit`). Smooth 60fps playback must produce **zero per-frame stderr I/O**.
  - **Periodic Rollups**: Summary logs (`📊 [NativePlayback Summary]`) only print once every 60 frames (every 2s).
  - **In-Memory Telemetry**: Real-time metrics are tracked via `SYNC_METRICS` (atomic counters and percentiles) and emitted via Tauri event `"native-playback-stats"`.
  - **Override Flag**: Full verbose logs can be enabled via `CLYPRA_VERBOSE_PREVIEW=1`.

---

### Bug 5: 23.976 FPS Pulldown Cadence & Ultra-Long GOP Thrashing (`Video by jomakaze`)
- **Symptom**: `Video by jomakaze [DaUvB4QJzOk].mp4` (1080x1920 VP9) stuttered severely with decode times growing linearly from 40ms to 500ms, while all other videos played smoothly.
- **Root Cause**:
  1. `Video by jomakaze` is 23.976 FPS with a **120-frame (5-second) keyframe interval**.
  2. On a 30 FPS timeline, 4 video frames span 5 timeline ticks ($\frac{30}{24} = 1.25$). Exactly once every 5 timeline frames, a video frame is held (repeated).
  3. The requested timestamp on repeated frames had a backward distance of $\sim 19.7\text{ms}$ (237 PTS ticks).
  4. Hardcoded `pts_tolerance` assuming 30fps was only 16.6ms ($0.5 / 30.0$).
  5. Because $19.7\text{ms} > 16.6\text{ms}$, the decoder treated the repeated frame as a backward seek. It sought back to **Frame 0 (up to 5 seconds in the past)** and decoded 80+ frames of 1080x1920 VP9 from the beginning, only to arrive at the exact frame it already had!
- **Architectural Rules**:
  - **Stream-Aware PTS Tolerance**: Derive tolerance from the actual video stream's frame rate:
    $$\text{pts\_tolerance} = (0.95 \times \text{frame\_duration}) \times \frac{\text{time\_base.den}}{\text{time\_base.num}}$$
  - If requested PTS is within `pts_tolerance` of `last_raw_nv12`, return the cached frame in **0.01ms** without seeking.
  - Backward seek is ONLY triggered if `backward_distance > pts_tolerance`.

---

## 3. Verification & Benchmark Test Suite

To verify that regressions have not been introduced, execute the automated benchmark suites:

### Rust Native Multi-Asset Performance Suite
```bash
cargo test --test testing_assets_performance_tests -- --test-threads=1
```
Verifies:
1. `test_single_video_sequential_playback_performance_all_assets`: Validates open time, cold decode, steady-state FPS (>60 FPS, >2x real-time), and P95 latency across all media in `clypra-testing-assets`.
2. `test_long_range_continuous_playback_120_frames`: Validates 120 consecutive frames across GOP boundaries (0 spikes >30ms).
3. `test_multi_stacked_concurrent_playback_performance`: Validates isolated multi-stream decoding for stacked video layers.
4. `test_occlusion_culling_performance_delta`: Validates GPU/CPU savings when opaque top layers cull underlying tracks.
5. `test_random_seeking_and_forward_resumption_performance`: Validates seek recovery latency.

### TypeScript Timeline Evaluation Suite
```bash
npx vitest run src/core/evaluation/__tests__/timelineAssetsPerformance.test.ts
```
Verifies:
- 500 frames evaluated in <25ms (>20,000 FPS throughput).
- Multi-track timeline evaluation and transport state validation.

---

## 4. Engineering Invariants (Rules of Thumb)

1. **Never Seek Backward for Intra-Frame Jitter**: If `target_pts < current_pts`, verify whether the delta is within the stream's frame duration. Never flush the decoder for intra-frame rounding or pulldown repetition.
2. **Never Call `eprintln!` on Per-Frame Hot Paths**: All per-frame logging must be gated by anomaly thresholds (`> 33.33ms`) or `VERBOSE_LOGS`.
3. **Always Advance Lookahead Strictly Forward**: Never calculate lookahead start from scratch without checking `highest_frame_index`.
4. **Drain Decoder DPB Before Demuxing**: In `decode_frame_raw_nv12_with_cancel`, always drain frames already decoded in the codec buffer before feeding new packets from the container.
5. **Preserve Stream Decoder Isolation**: Stacked video clips must use distinct stream decoder handles (`get_preview_decoder_for_stream`) to avoid GOP mutex thrashing across layers.

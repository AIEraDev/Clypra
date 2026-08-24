# Program Preview Performance Runbook

Status: required guidance for every native Program Preview performance change.

This document records the failures found during the Program Preview investigation
and the rules that prevent repeating them. It applies only to the Program Preview
pipeline: timeline input, transport, native decode, YUV conversion, composition,
surface/readback, and final presentation.

## Scope and source of truth

The canonical implementation is split across these files:

- React request and presentation paths:
  `src/components/editor/preview/NativeProgramPreview.tsx`
- Request scheduling and obsolete-request handling:
  `src/components/editor/preview/nativePreviewScheduler.ts`
- Timeline transport and seek identity:
  `src/core/playback/TransportAuthority.ts`,
  `src/core/playback/seekController.ts`, and
  `src/core/playback/PlaybackClock.ts`
- Native commands and queue:
  `src-tauri/src/commands/native_preview.rs`
- Native performance contract and aggregation:
  `src-tauri/src/native_core/performance.rs` and
  `src-tauri/src/native_core/service.rs`
- Native compositor and RGBA readback:
  `src-tauri/src/wgpu_compositor/multi_track_composer.rs`
- Contract documentation:
  `docs/performance-contract.md`

Extend these existing contracts. Do not create a second `PerformanceSample`,
stats command, request-ID type, mode parser, or telemetry ring buffer without an
architecture decision and a migration plan.

## The two real preview paths

Playback and paused interaction are not one performance path:

```text
Timeline input
  -> TransportAuthority
  -> SeekController (requestId + generation + mode)
  -> PlaybackClock / NativeProgramPreview render loop
       |
       | playback / lookahead
       v
  queue_native_frame
    -> decoder + decoder mutex
    -> bounded decoded-frame queue
  present_native_frame
    -> NV12/YUV conversion and upload
    -> native compositor
    -> native surface acquire
    -> queue submit / surface present
    -> retained native surface

       |
       | paused seek / scrub / frame step
       v
  render_native_frame
    -> RGBA frame cache
    -> decoder + decoder mutex
    -> NV12/YUV conversion and upload
    -> compositor
    -> GPU copy and RGBA readback/map
    -> IPC response
    -> canvas ImageData / putImageData
```

The direct native-surface path must remain the continuous playback path. The
RGBA bridge is a paused-frame fallback and diagnostic path, not a playback
target.

## Failure modes and permanent fixes

### 1. High-frequency logging was inside the frame path

The decoder printed one `eprintln!` for every preview frame. Console I/O is not
free and can contend with decode, async scheduling, and the desktop runtime.
That made the observed preview less smooth and polluted any timing collected
around the path.

Permanent rule:

- No `println!`, `eprintln!`, or `console.log` per preview frame in normal mode.
- High-volume events must go through the existing gated trace mechanism.
- Diagnostic logging must be disabled for benchmark runs unless the benchmark
  explicitly measures logging overhead.

### 2. Playback, seeking, and scrubbing were easy to conflate

Playback can use a retained native surface and a decoded lookahead queue.
Paused seeking and scrubbing can require decode, composition, GPU readback, IPC,
and canvas paint. A single average across those paths hides the actual cost.

Permanent rule:

- Every sample has an explicit mode: `Playback`, `PlaybackLookahead`, `Seek`,
  `Scrub`, `FrameStep`, or `Prefetch`.
- Do not infer mode by parsing a request ID.
- Do not compare playback surface timings with paused readback timings as one
  population.

### 3. Obsolete work was not the same as cancelled work

A newer seek can make an older request obsolete even when FFmpeg or GPU work
cannot stop immediately. Ignoring a result after it finishes is not equivalent
to cancelling the work, and both facts must be visible in diagnostics.

Permanent rule:

- `SeekController` generations identify the current intent.
- Scheduler abort signals cancel work where the underlying operation supports it.
- Native generation checks prevent old decoded frames entering the queue or
  surface presentation path.
- Record `stale`, `cancelled`, and `dropped` separately.

### 4. A stale frame must never become the visible target

Keeping the last valid frame visible during a seek is valid visual continuity.
Treating that frame as the newly requested frame is not. The exact request key,
project revision, frame index, and generation must still match after every
`await` before committing a paused frame.

Permanent rule:

- Stale responses may be discarded or retained only as non-visible cache data.
- Seek completion requires the exact current target.
- A failed request preserves the last valid frame and records the failure.

### 5. `lastSample` was mistaken for an average

`lastSample` is one sample. It is not a mean, median, or percentile. A latest
sample overlay can look healthy while the preceding requests were slow.

Permanent rule:

- Label latest values as latest.
- Use the existing five-second window and P50/P95/P99 values for claims about
  performance.
- Percentile `sampleCount` counts only samples that contain that optional stage.

### 6. Seek telemetry mixed unrelated requests

Pooling all samples into a seek statistic lets playback, lookahead, cache hits,
and prefetch change the reported seek latency.

Permanent rule:

- Seek summaries include only `Seek`, `Scrub`, and `FrameStep` samples.
- Playback and lookahead have separate mode buckets.
- Cold/warm cache state, quality, output size, and media characteristics are
  included in every benchmark report.

### 7. Direct native-surface playback was missing from detailed statistics

The retained surface path can be the visible playback path while the detailed
RGBA frame-service stats describe only readback frames. That makes the overlay
look incomplete exactly when the important path is active.

Permanent rule:

- Surface playback records decode, conversion/upload, composition, surface
  acquisition, submit/present, total time, and queue staging wait.
- Surface staging is not an RGBA frame-cache hit.
- `window_cache_hit_rate` remains scoped to the RGBA cache population.

### 8. Missing stages were represented as zero

A native-surface frame has no canvas paint or RGBA readback. A readback frame has
no surface acquisition or native submit. Recording zero makes an absent stage
look like a measured zero and corrupts percentiles.

Permanent rule:

- Path-specific stage fields are `Option`/nullable.
- `None` means the stage did not exist or was not measured.
- Zero is used only when zero work was actually measured.

### 9. Rust and browser clocks cannot be aligned directly

Rust `Instant` and browser `performance.now()` have no defined shared epoch.
Joining them as one timestamp stream creates false queue and presentation
latencies.

Permanent rule:

- Record durations locally in each process.
- Correlate reports by string `requestId`, generation, and frame index.
- Never subtract a Rust timestamp from a browser timestamp.

### 10. Instrumentation must not become the bottleneck

Telemetry that waits on the frame-service mutex or logs synchronously can change
the behavior it is intended to measure.

Permanent rule:

- Frontend telemetry is disabled by default and stored in a bounded ring buffer.
- Native-surface sample recording uses a non-blocking service-mutex attempt.
- A missed diagnostic sample is preferable to delaying frame presentation.
- Never stream one JSON log line per frame during a benchmark.

## Required investigation procedure

Before changing React scheduling, UI rendering, or native policy:

1. Confirm the actual repository types and call sites. Read the canonical files
   above; do not write speculative standalone modules against guessed fields.
2. Trace one frozen playback, seek, and scrub scenario end to end.
3. Capture the mode, request ID, generation, frame index, queue state, stale/
   cancelled/dropped outcome, and each applicable native/frontend duration.
4. Compare P50/P95/P99 by mode and path. Do not rank a bottleneck from symptoms
   or from code structure alone.
5. Change the smallest diagnostic surface that distinguishes the leading
   candidates.
6. Re-run the same scenario with logging disabled and enabled separately if
   logging is suspected.
7. Only after native timings identify the cost should UI or React work be
   considered.

## Benchmark record

Every meaningful preview performance change must attach a table like this to the
investigation or release notes:

| Scenario | Path | Mode | Warm/cold | P50 total | P95 total | P95 decode | P95 compose | P95 readback | P95 surface acquire | Drops/stale |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Playback | Native surface | Playback |  |  |  |  |  | N/A |  |  |
| Seek | RGBA readback | Seek |  |  |  |  |  |  | N/A |  |
| Scrub | RGBA readback | Scrub |  |  |  |  |  |  | N/A |  |

Record OS, GPU adapter, backend, driver, DPR, source codec/dimensions, CFR/VFR
status, color metadata, project dimensions, quality, and whether the native
surface was ready. A benchmark without those details is not a regression
baseline.

## Safe change and release checklist

- [ ] `git status` and the existing diff were inspected before editing.
- [ ] Only files in the traced preview path were changed.
- [ ] Existing request IDs remain strings and existing wire spellings remain
      compatible (`frameStep` is normalized at the boundary).
- [ ] No duplicate performance type or diagnostics command was added.
- [ ] Playback, seek, scrub, frame-step, and prefetch remain separate modes.
- [ ] Optional stages remain nullable and are excluded from unrelated
      percentiles.
- [ ] Direct native-surface frames are represented in performance statistics.
- [ ] Cache-hit statistics exclude surface staging frames.
- [ ] High-volume logging is gated or disabled for benchmarks.
- [ ] Stale results cannot present or complete a newer seek.
- [ ] `cargo check --lib`, Rust tests, and `npm run typecheck` pass.
- [ ] The same fixed benchmark scenarios were repeated after the change.
- [ ] No optimization is claimed until the native timings identify the cost.

## Current implementation references

The current instrumentation is implemented in:

- `src-tauri/src/native_core/performance.rs`
- `src-tauri/src/native_core/service.rs`
- `src-tauri/src/commands/native_preview.rs`
- `src-tauri/src/wgpu_compositor/multi_track_composer.rs`
- `src/core/playback/nativePerfTelemetry.ts`
- `src/components/editor/preview/NativeProgramPreview.tsx`

The contract and budgets remain in
[`docs/performance-contract.md`](performance-contract.md).

# Native Performance Contract

For the investigation history, path-specific failure modes, and safe-change
checklist, read [Program Preview Performance Runbook](program-preview-performance-runbook.md).

## Baseline

The current smooth editing path is the performance baseline. A native change
must be compared against the same project, source media, preview dimensions,
quality tier, and seek/playback action. Do not compare cold native startup with
warm legacy playback and call the result a regression or an improvement.

## Budgets

| Metric | Initial budget | Scope |
| --- | ---: | --- |
| Preview cadence | 60 FPS target | Native playback after surface cutover |
| Frame render time | 16,667 us | Decode + graph + presentation budget |
| Seek response | 100 ms | Visible paused frame, warm or cold stated separately |
| Audio/video drift | +/-16 ms | Native playback |
| Late video drop | 20 ms behind audio | Never delay audio |
| Audio buffer | at least 100 ms | Native audio |
| Video lookahead | at most 200 ms | Native playback |
| Native media cache | 1 GiB default | Per project, CPU and GPU tracked separately |
| CPU frame bridge | 500 MB/s guardrail | Paused frames only; never a playback target |
| Filmstrip visible frame | 150 ms (P95) | Radial playhead-near tiles on timeline view |
| Filmstrip scroll latency | 0 ms (100% cache hit) | Pure horizontal scroll with preloaded L0 coarse baseline |
| Filmstrip coarse preload | ≤ 300 tiles / ≤ 1.8 MB | Asset-wide coarse baseline (10s to 3h media) |
| Filmstrip warm session restore | < 10 ms (0 video decodes)| Zero-decode restore from Rust TIER_CACHE / WebP atlas |

## Filmstrip & thumbnail pipeline scheduling

The timeline filmstrip decouples background coarse baseline extraction from viewport-bounded
rendering. Media import extracts only a single poster frame (<150ms). Adding a clip to the
timeline triggers a bounded L0 coarse preload (≤300 tiles) sorted playhead-first (|t - t_playhead|
or visible start reading order). Normal 1.0x zoom maps to L1 (1.0s interval) matching 50px visual slots.
Pure horizontal scrolling blits from the resident L0 cache with zero decode invocations.
Zoom transitions into dense tiers sample lower-tier tiles via bicubic stretch fallback while
dense frames are in flight, eliminating empty dead blocks and visual stutter.
See `docs/filmstrip-architecture-and-caching.md` for the full specification.

## Program preview scheduling

Paused native preview has one strict visible-frame priority lane and a bounded
lookahead cache. The scheduler keeps up to 12 validated RGBA frames, allows at
most two prefetch decodes at once, and prefetches six frames ahead plus two
frames behind only after the visible frame is ready. A visible seek may start
immediately even when lookahead work is in flight.

The previous displayed frame may remain on screen while a seek is decoding, but
it is never treated as the requested frame. Seek completion requires the exact
request key, project revision, frame index, and generation to still match when
the native response arrives. Stale responses may populate the cache but can
never replace the visible target.

## Measurement

The native frame service records request count, cache hit/miss count, cache
bytes, transferred bytes, and the latest end-to-end sample. It also keeps a
five-second, mode-partitioned window for `playback`, `playback-lookahead`,
`seek`, `scrub`, `frame-step`, and `prefetch`.

Native samples expose optional stage timings. The readback path records decode,
decoder-mutex wait, conversion/upload, composition, and RGBA readback. The
retained native-surface path records decode, decoder-mutex wait, conversion /
upload, composition, surface acquisition, and CPU submit/present. A stage that
does not exist on a path is `null`, not zero. Percentiles filter out nulls and
report the number of samples that actually contained that stage.

The diagnostics command is `get_native_frame_service_stats`. Frontend-only
dispatch, IPC, and canvas-paint spans are kept in a bounded in-memory ring
buffer by `nativePerfCollector`; they use the same request ID, generation, and
frame index for offline joining. Rust `Instant` values and browser
`performance.now()` values must never be aligned as shared timestamps.

Native-surface telemetry records with a non-blocking service-mutex attempt so
diagnostics cannot add a presentation wait. A sample can therefore be omitted
if a stats read is holding the service mutex. Per-frame decode logging is gated
through the existing trace event path; the default path does not print a
decoder line for every frame.

Every benchmark report must include:

- OS, GPU adapter, backend, driver, and DPR.
- Source codec, dimensions, frame rate, VFR/CFR status, and color metadata.
- Cold/warm state, cache state, quality tier, and output dimensions.
- P50/P95 seek latency and P50/P95 frame time.
- Dropped frames, buffering time, and A/V drift for playback.

## Non-regression rules

1. Native playback is not enabled through per-frame CPU IPC.
2. Cache growth is bounded and visible frames receive eviction priority.
3. A slow native request cannot replace a newer request.
4. A failed native frame preserves the last valid frame and reports the error.
5. Performance optimizations cannot change the color or frame-index contract.
6. Prefetch cannot delay or supersede the exact visible seek target.

## Profiling order

Measure in this order: decode, YUV normalization, graph composition, GPU
readback/transport, presentation, then audio synchronization. This prevents
optimizing React scheduling while the actual bottleneck is a decoder seek or
CPU readback.

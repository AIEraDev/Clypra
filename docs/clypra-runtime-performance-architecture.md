# Clypra Runtime Performance Architecture

Status: active architectural contract  
Scope: desktop editor runtime, Program Preview, audio playback, text rendering,
performance telemetry, and Studio analysis

This document records the architecture and decisions established during the
Program Preview, audio, and text-performance investigations. It is the
high-level map for implementation and review. Detailed contracts remain in
[Program Preview Performance Runbook](program-preview-performance-runbook.md),
[Program Preview Interaction Architecture](program-preview-interaction-architecture.md),
[Performance Telemetry](performance-telemetry.md),
[Native Architecture](native-architecture.md), and
[Text Effects Architecture](text-effects-architecture.md).

## 1. Executive decisions

1. Rust/Tauri owns desktop playback timing, native decoding, native
   composition, native audio, and continuous native-surface presentation.
2. The CPAL audio sample clock is the authoritative playback clock. Video is
   selected against that clock; audio is never delayed for late video.
3. Program Preview is one logical preview with two physical output paths:
   Native surface for continuous playback, and WebView/DOM canvas for paused,
   seeking, editing, and fallback work.
4. The paths share interaction and generation semantics, but their physical
   schedulers remain separate. Native uses a Rust latest-value demand slot;
   WebView uses a bounded latest-request scheduler.
5. A preview frame is rejected in this order: generation/recency first,
   audio-clock lateness second. These are different failure modes and must
   remain different telemetry reasons.
6. Text rendering is part of the preview budget. Normal title text is point
   text by default; explicit newlines are preserved, while captions and
   explicitly constrained text may wrap.
7. Live text editing uses an in-memory RAF-coalesced draft and one final
   history/autosave commit. A pointer or slider event must not create a full
   history command and autosave operation for every input event.
8. All performance evidence is sent to the real Clypra API and inspected from
   Studio Admin. No editor HUD, local fixture, localStorage switch, or
   synthetic fallback is a source of truth.

## 2. System ownership

```text
React editor controls and interaction intent
        |
        | configure, play, pause, seek, speed, geometry, edit intent
        v
Tauri command boundary
        |
        +--> NativePlaybackRuntime
        |      audio-clock frame demand
        |      decoder leases
        |      decode -> compose -> native surface present
        |
        +--> NativeAudioRuntime
        |      FFmpeg PCM decode -> mixer -> CPAL callback
        |
        +--> Paused WebView bridge
               decode/compose -> readback -> transfer -> canvas paint

All runtimes emit bounded numerical telemetry
        |
        v
clypra-api -> Neon performance_telemetry_events
        |
        v
clypra-studio Admin performance pages
```

### React owns

- editor controls, selection, overlays, property panels, and visual state;
- user intents such as play, pause, seek, edit, undo, and redo;
- the WebView editing surface and its DOM hit-testing;
- bounded client telemetry buffering and asynchronous API upload.

React does not choose the native playback frame on every display tick and does
not issue a heavy Tauri command for every native frame.

### Rust/Tauri owns

- the native audio clock and playback state integration;
- native media decode, decoder-pool ownership, composition, and presentation;
- native preview generation and stale-frame rejection;
- native text/font registration and native-surface lifecycle;
- native audio decode, mixing, output callback, and audio diagnostics.

`PlaybackSession` remains a deterministic, platform-neutral timing/state
machine. It intentionally has no decoder, Tauri, or wgpu dependencies. The
Native render session owns platform presentation and decoder leases so the
core timing machine remains independently testable.

## 3. Program Preview output contract

| State or operation | Authoritative output | Interaction behavior |
| --- | --- | --- |
| Continuous playback | Native child surface | Surface is pointer-transparent; DOM capture plane handles an edit intent |
| Paused | WebView/DOM canvas | Selection, handles, focus, and accessibility are active |
| Seeking/scrubbing | WebView/DOM canvas | Latest seek wins; stale responses cannot present |
| Transform/edit gesture | WebView/DOM canvas plus DOM overlay | Optimistic local movement; one commit on release |
| Native initialization failure | Existing bounded runtime fallback only | No persistent user mode; failure remains diagnosable |
| Qualification | Explicit diagnostics workflow | Uses the same snapshot and settings for each path |

The Native surface is a retained session resource, not a React component side
effect. `nativeSurfaceLifecycle` owns configure, resize, presentation ordering,
and release. CSS `z-index` cannot route pointer events between a native child
window and a WebView; click-through hardening is a separate platform action.

### Native continuous playback

The native render session receives the complete immutable render snapshot once
per project/timeline revision. Per-frame work contains only compact demand
information. The session owns:

- one active decode/compose/present operation;
- one latest pending frame demand;
- project and timeline generation state;
- active leases from `PREVIEW_DECODER_POOL`;
- native surface presentation and stage telemetry.

Decoder mutexes are held only during decode. Composition and presentation occur
after the decoder lock is released. An active playback decoder is leased/pinned
so filmstrip and other-video activity can evict only unleased LRU entries.
Leases release on source removal, session reset, and project close.

### WebView paused/editing path

The WebView path is intentionally separate because readback and transfer are
not playback-quality operations. It is allowed to use:

```text
decode/cache -> composition -> RGBA readback -> transfer -> canvas paint
```

The path uses reusable buffers, bounded output dimensions, stable canvas
allocation, and no per-frame React render. During visible playback fallback,
the last complete text bitmap may remain visible while a changed bitmap is
rasterized. Paused and interactive renders remain exact and wait for the
requested result.

## 4. Scheduling and stale work

The two schedulers have the same contract but different implementations:

- Native: Rust latest-value demand slot (`watch` or equivalent bounded slot).
- WebView: one active request and one latest pending request.
- Neither path queues obsolete playback frames.
- Tauri `Channel` is reserved for Rust-to-WebView streaming use cases such as
  filmstrip output; it is not a WebView-to-Rust per-frame command mechanism.

Every request carries a project/timeline generation. The decision sequence is:

```text
1. Validate project, timeline, and interaction generation.
   Reject obsolete work as stale or cancelled.
2. Ask the native audio timing function whether the wanted frame is late.
   Reject it as late-for-audio when the timing threshold is exceeded.
3. Decode, compose, and present only if the frame is current and on time.
```

The queue does not implement a second audio-lateness policy. The extracted
`native_presentation_timing()` decision remains the only authority for
audio-relative lateness. Telemetry keeps these reasons separate:

- `stale`: a newer generation or request superseded the work;
- `cancelled`: the operation was explicitly cancelled;
- `late-for-audio`: the wanted frame was current but missed its audio deadline;
- presentation failure: the current frame could not be presented.

## 5. Interaction architecture

`PreviewInteractionCoordinator` is the shared coordinator for transport,
timeline, preview overlays, and property editors. Only one
preview-affecting interaction may be active.

Content-changing interactions use the standard boundary:

```text
begin interaction
  -> pause if playback was active
  -> invalidate obsolete render generations
  -> update an optimistic or draft signal
  -> commit one history command on completion
  -> resume only if playback was active before the interaction
```

This applies to timeline scrub, clip move/trim/split, audio envelope/fade,
text properties, effects, styles, and template controls. Undo/redo cancels an
active gesture first. A conflicting gesture cancels the previous gesture
before starting.

Transform dragging uses the established two-speed model:

- pointer movement updates an imperative signal at RAF cadence;
- there are no store writes, history commands, or IPC calls per pointer move;
- pointer-up performs one authoritative history commit;
- cancellation discards optimistic geometry.

## 6. Text rendering and layout contract

Text is a preview workload, not merely an inspector concern. Its measured
stages are font wait, compile/effect preparation, raster, readback, transfer,
and paint.

### Text modes

- **Normal title text** is point text by default. The renderer preserves only
  authored newline characters and does not silently wrap a long line to the
  renderer's internal safe-area width.
- **Caption text** may wrap automatically within its caption safe area.
- **Explicitly constrained text** may wrap when the clip has a positive
  authored `maxWidth`.
- **Studio effects and templates** retain their own published layout rules.

`TextClip.maxWidth` is optional. Normal editor text is not assigned an
implicit hard max width. This avoids the previous mismatch where bounds were
calculated as one line but the renderer wrapped against a smaller internal
safe rectangle, producing unexpected second lines and alignment drift.

Explicit multiline text is measured per paragraph. Width and height use the
same line model as the renderer, so font family, font size, line height,
letter spacing, and alignment changes do not calculate a different box from
the rasterized result.

### Live text property updates

The properties panel maintains a temporary text draft during a burst of
changes:

```text
color/font/spacing input
  -> latest values stored in memory
  -> at most one timeline preview update per RAF
  -> no history/autosave per input event
  -> one final TransformClipCommand after the burst
```

The draft is flushed before selection, transport, undo/redo, project reset, or
a conflicting interaction can reorder state. Caption “apply to all” remains
an explicit history transaction.

### Text performance evidence

Text telemetry has two bounded layers. Raster work is accumulated into a
five-second development or thirty-second production window; completed typing,
style, transform, and resize bursts emit one interaction span at gesture end.
Raw pointer movement never performs a network request. Every record carries
the text kind, renderer path, phase, operation, and optional property, so
normal text, effects, templates, entrance/exit animation, and editing work do
not share a percentile cohort accidentally.

The operation dimension is deliberately explicit:

```text
prefetch | render | entrance | animation | exit
content-edit | property-edit | transform | resize
```

The Admin text page queries and displays these cohorts separately. Frame work
uses the 16.67 ms P95 budget; completed editing interactions use the 100 ms
P95 responsiveness budget. API rows retain the existing idempotent
`measurementId` contract and remain the only durable source of truth.

### Audio source-end recovery

Native audio initializes the FFmpeg metadata layer before decoding. A short
in-process decode is accepted when the requested source range genuinely ends
at the container duration; only a short decode with additional source media
remaining retries through the CLI decoder. This prevents expected final audio
segments from producing repeated warning output while preserving recovery for
real decoder truncation.

Text raster cache keys include all visual inputs that can change pixels,
including text, font properties, color, per-run colors, alignment, geometry,
effect/template revision identity, customization, stroke, shadow, and
background. A color change therefore cannot reuse a stale bitmap until the
project is reopened.

## 7. Audio architecture and startup preparation

Native audio follows:

```text
timeline clip discovery
  -> bounded FFmpeg-to-f32 PCM decoder
  -> multi-clip mixer with gain, fades, panning, and automation
  -> CPAL callback
  -> authoritative sample clock
```

The real-time callback must remain free of file I/O, allocation-heavy work,
blocking locks, network requests, and logging. Audio telemetry is sampled in
bounded windows away from the callback and includes callback work, decoder
work, mixer contention, output handoff, buffer misses, underruns, seek
response, and audio-clock drift.

Session startup may prefetch/prewarm text and audio dependencies so first-use
latency is paid before playback. Prefetch must be bounded, cancellable, and
isolated from the callback and visible frame loop. An idle session must not
continue producing duplicate windows or growing telemetry indefinitely.

## 8. Telemetry and analysis source of truth

The existing `performance_telemetry_events` table in `clypra-api` remains the
storage foundation. Events and rollups carry the identity needed to prevent
cross-path contamination:

- `sessionId`;
- `qualificationRunId` when applicable;
- scenario, path, environment, and measurement source;
- `measurementId` for idempotent insertion;
- frame sequence/sample kind/drop reason/deadline where applicable.

The API accepts batches asynchronously, reports `persisted` and
`deduplicated`, and uses the unique measurement identity to ignore duplicate
logical measurements. Percentiles never mix unrelated measurement sources.

The canonical inspection surfaces are:

- `/studio/admin/performance/preview` for Native versus WebView preview;
- the Studio Admin audio performance page for Native CPAL versus Web Audio;
- the Studio Admin text performance page for normal text, effects, and
  templates, including cross-system audio/preview context.

These pages are live-API-only. Empty data is displayed as empty. No local
fixture or synthetic performance value may appear in an Admin performance
surface.

### Confidence and SLA policy

| Measurement | Target |
| --- | ---: |
| Continuous playback render P95 | <= 16.67 ms |
| Session dropped-frame ratio | <= 1% |
| Seek/paused interaction P95 | <= 100 ms |
| Native present P95 | near zero |
| Audio callback work P95 | below the device callback budget |
| Text total render P95 | <= 16.67 ms for the qualified playback cohort |

Confidence is based on measured frames, not API row count:

- fewer than 300 frames: `Insufficient data`;
- 300–1,499 frames: `Preliminary`;
- 1,500 or more frames: `Qualified comparison`.

An API rollup is an observation window. It is not a frame count and must not be
used as evidence that a qualification run has enough samples.

## 9. Evidence from development investigation

The following findings are development evidence, not production guarantees:

| Area | Observed evidence | Architectural conclusion |
| --- | --- | --- |
| Native preview | Approximately 7–9 ms render P95 in later runs; present cost near zero | Keep Native as the continuous playback path |
| WebView preview | Transfer/readback observations around 189–242 ms P95; paused interaction also showed large decode tails | Do not unify WebView readback with Native playback |
| Native audio | Approximately 2.25–2.75 ms callback P95 with zero underruns in observed runs | Audio callback is not the reported text freeze bottleneck in those runs |
| Text interactive preview | Approximately 91 ms P95 in a small normal-text sample | Text edit/raster path needs coalescing and better warm-cache behavior |
| Text session prewarm | Approximately 186 ms cold sample with most time in font wait/raster | Pay cold font work at bounded startup/prewarm, not during repeated edits |
| Text cache behavior | Color was previously absent from the raster key | Immediate cache-key invalidation is required for visual correctness |

Small samples must remain visibly marked as insufficient or preliminary. They
are useful for finding a bottleneck, but not for declaring a path qualified.

## 10. Qualification protocol

Qualification is a controlled diagnostics operation, not an automatic side
effect of ordinary playback.

For each environment and path:

1. Use the same timeline, scene snapshot, resolution, FPS, quality, and
   duration.
2. Run Native for 30 seconds.
3. Run WebView for 30 seconds.
4. Require at least 1,500 measured frame observations per path.
5. Verify P95 render, dropped ratio, stage bottleneck, and first-frame latency.
6. Verify no duplicate `measurementId` values and no sustained idle growth.
7. Inspect only the corresponding filtered cohort in Studio Admin.

User edits, transport changes, project changes, or surface reset cancel a
qualification run. Cancelled qualification data remains identified by its run
ID and cannot contaminate ordinary playback statistics.

## 11. Implementation and rollout order

1. Preserve source separation and accurate stale/cancelled/late semantics.
2. Keep the Native Rust render session on the audio-clock path.
3. Protect decoder leases under filmstrip and multi-source pressure.
4. Keep native playback free of CPU readback and per-frame heavy IPC.
5. Optimize text cold-start and live property updates.
6. Optimize WebView resolution, buffer reuse, readback, transfer, and paint.
7. Validate audio and preview cohorts independently in development.
8. Run identical production qualification runs.
9. Use Studio Admin as the single analysis surface.

## 12. Explicitly deferred work

### Action 4: native click-through hardening

This is separate from the performance work. The required behavior is:

- Native surface remains pointer-transparent during playback;
- DOM overlays remain interactive after pause;
- paused/seeking states use the DOM canvas;
- pointer routing is tested on macOS, Windows, and Linux;
- resize, focus, modal opening, play/pause transitions, and surface recreation
  are covered;
- no second preview window is introduced.

### Remaining measurement work

- Complete 30-second, 1,500-frame Native and WebView runs in development and
  production.
- Exercise normal text, Studio effects, and Studio templates separately.
- Include multiline, alignment, font-family, font-weight, line-height,
  letter-spacing, color, and per-run color edits in text validation.
- Re-check audio and preview cohorts while text is actively rendering to
  distinguish shared stalls from text-only stalls.

## 13. Review checklist

Before merging a change in this area, reviewers should be able to answer yes
to all of the following:

- Is the owning runtime explicit: React, Rust playback, Rust audio, API, or
  Studio analysis?
- Does the change preserve Native playback and WebView editing separation?
- Can stale, cancelled, and late-for-audio work be distinguished?
- Is there still at most one active and one pending frame operation per path?
- Does the callback/frame loop avoid blocking I/O, logging, and unnecessary
  allocations?
- Are cache keys complete for every pixel-affecting input?
- Are text bounds and raster layout driven by the same wrapping rules?
- Does an edit create one history/autosave commit rather than a command storm?
- Is telemetry real, bounded, idempotent, source-separated, and visible in
  Studio without synthetic fallback data?
- Are tests and qualification evidence appropriate to the claim being made?

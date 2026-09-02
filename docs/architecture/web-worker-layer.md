# Web Worker Layer — Architecture Design

**Status:** Design complete · Implementation in progress  
**Last updated:** 2026-09-02  
**Scope:** All compute-heavy frontend work that must not block the React main thread

---

## Table of Contents

1. [System Context](#1-system-context)
2. [Existing Workers (Live)](#2-existing-workers-live)
3. [Shared Infrastructure](#3-shared-infrastructure)
4. [Domain 1 — Color Scopes & Video Analysis](#4-domain-1--color-scopes--video-analysis)
5. [Domain 2 — Audio Waveform LOD Generation](#5-domain-2--audio-waveform-lod-generation)
6. [Domain 3 — Keyframe Curve Evaluation Engine](#6-domain-3--keyframe-curve-evaluation-engine)
7. [Domain 4 — Timeline Snapping, Ripple Math & Collision Detection](#7-domain-4--timeline-snapping-ripple-math--collision-detection)
8. [Domain 5 — Project History, Diffing & Auto-Save Serialization](#8-domain-5--project-history-diffing--auto-save-serialization)
9. [Domain 6 — Subtitle & Timed-Text Parsing / Layout](#9-domain-6--subtitle--timed-text-parsing--layout)
10. [Worker Lifecycle & ProjectSession Integration](#10-worker-lifecycle--projectsession-integration)
11. [Safari / Browser Compatibility Notes](#11-safari--browser-compatibility-notes)
12. [What Stays on the Main Thread](#12-what-stays-on-the-main-thread)
13. [Migration Checklist](#13-migration-checklist)

---

## 1. System Context

Clypra is a Tauri v2 desktop video editor. The full compute stack is:

```
React 19 main thread  ←→  Web Workers  ←→  Rust/Tauri (wgpu · FFmpeg · CPAL)
```

The main thread owns:
- DOM event dispatch and React reconciliation
- Zustand store mutations (`timelineStore`, `projectStore`, `uiStore`, …)
- `ProjectSession` lifecycle (init / dispose of all runtime resources)
- Tauri IPC calls (`invoke()`, `Channel<T>`) — workers must never call these directly

The Rust/Tauri side owns:
- Video decode: `NativeFrameService` (FFmpeg decoder pool, 1 GB LRU)
- GPU compositing: `NativePreviewSession` (wgpu `MultiTrackCompositor`)
- Audio: `NativeAudioClock` (CPAL hardware clock)
- Export: `native_export` commands
- File I/O, disk cache, asset ingestion

Web Workers own everything in between: compute that is heavy enough to block
the 16 ms frame budget, operates on browser-native data structures
(`Float32Array`, `ImageBitmap`, `ArrayBuffer`), and has no need to touch the
DOM or call Tauri IPC directly.

### Relevant source paths

| Path | Role |
|---|---|
| `src/workers/` | Worker entry points (`*.worker.ts`) |
| `src/core/workers/` | Main-thread client wrappers and `WorkerBus` |
| `src/core/render/templateRasterizerWorkerClient.ts` | Reference client implementation |
| `src/core/render/latestTextPreparationScheduler.ts` | Reference back-pressure scheduler |
| `src/core/runtime/ProjectSession.ts` | Worker instantiation and disposal owner |
| `src/core/evaluation/evaluator.ts` | `evaluateTimelineScene` — candidate for partial off-loading |
| `src/core/audio/waveformService.ts` | Current waveform service (browser PCM path) |
| `src/store/timelineStore.ts` | Zustand source of truth; epoch-based invalidation |
| `src-tauri/src/wgpu_compositor/scopes.rs` | Native scope implementation (reference for data contract) |

---

## 2. Existing Workers (Live)

### 2.1 `templateRasterizer.worker.ts`

Renders animated text templates and styled text effects entirely off-thread
using `OffscreenCanvas`. This is the **canonical reference** for all new workers.

**Message protocol:**
```
Main → Worker
  RENDER_TEMPLATE  { id, artifact, localTime, clipDuration, layerWidth,
                     layerHeight, controlValues }
  RENDER_EFFECT    { id, sceneDocument, time, evalWidth, evalHeight }
  DISPOSE

Worker → Main
  FRAME_READY      { id, bitmap: ImageBitmap, offsetX, offsetY,
                     croppedWidth, croppedHeight, workerRasterMs }
  FRAME_FAILED     { id, error: string }
```

**Key design decisions:**
- Stateless per frame — every message is independent; no shared state between calls
- `findVisibleBounds` crops the `OffscreenCanvas` to only non-transparent pixels
  before `transferToImageBitmap()`, minimising the GPU upload footprint
- `LatestTextPreparationScheduler` on the main thread limits back-pressure to
  one active + one queued job per layer during real-time playback

**Client:** `src/core/render/templateRasterizerWorkerClient.ts`  
**Scheduler:** `src/core/render/latestTextPreparationScheduler.ts`

---

### 2.2 `mediapipe.worker.ts`

Runs MediaPipe `FaceDetector` (ONNX, GPU delegate) off the main thread for
the AI auto-reframe feature.

**Message protocol:**
```
Main → Worker
  INIT          { modelUrl: string }
  DETECT_FRAME  { imageBitmap: ImageBitmap, timestampMs: number }
  DESTROY

Worker → Main
  INITIALIZED
  DETECTION_RESULT  { timestampMs, detections: Detection[] }
  ERROR             { message: string }
```

**Key design decisions:**
- `imageBitmap.close()` called immediately after `detector.detect()` to release
  GPU memory before the next frame arrives
- `WASM` bundle URL is pinned to the installed `@mediapipe/tasks-vision` version
- Worker is long-lived across an entire face-tracking session; `DESTROY` triggers
  `detector.close()` then `self.close()`

---

## 3. Shared Infrastructure

### 3.1 `WorkerBus` (`src/core/workers/workerBus.ts`)

A reusable request/response wrapper that every new worker client uses. Eliminates
the copy-paste of the `pending: Map<id, {resolve, reject}>` pattern seen in
`TemplateRasterizerWorkerClient`.

**Responsibilities:**
- Assign monotonically increasing request IDs
- Route `postMessage` responses back to the waiting `Promise`
- Drain pending promises on `dispose()` with a cancellation error
- Re-initialize the worker on unrecoverable `onerror` (configurable)

See `src/core/workers/workerBus.ts` for the full implementation.

---

### 3.2 Shared message types (`src/workers/types.ts`)

All worker message unions are defined in a single file imported by both the
worker entry point and its main-thread client. This ensures TypeScript catches
protocol mismatches at compile time before they become runtime bugs.

The convention for every domain is:

```ts
// Inbound (main → worker)
export type <Domain>WorkerRequest =
  | <Domain>RequestA
  | <Domain>RequestB
  | WorkerDisposeMessage;  // from WorkerBus shared types

// Outbound (worker → main)
export type <Domain>WorkerResponse =
  | <Domain>ResponseA
  | <Domain>ResponseB
  | WorkerErrorMessage;    // from WorkerBus shared types
```

---

## 4. Domain 1 — Color Scopes & Video Analysis

### Problem

Real-time scopes (Vectorscope, RGB Parade, Histogram, Waveform Monitor) must
sample every pixel of the current preview frame at up to 60 fps. A single
1920×1080 frame is ~8 MB of RGBA data. Running `getImageData` and binning
algorithms on the main thread blocks React's event loop for 10–40 ms per frame.

The Rust side already implements scopes in `src-tauri/src/wgpu_compositor/scopes.rs`
and exposes a `get_video_scopes` Tauri command. That path requires a full IPC
round-trip (serialise → IPC → Rust readback → deserialise). For live preview
where the decoded frame is already in the browser as an `ImageBitmap` or
`VideoFrame`, the Worker path is strictly faster.

### Design

```
PreviewPanel (main thread)
  │
  │  postMessage([frame], [frame])   ← zero-copy transfer
  ▼
colorScopes.worker.ts
  │  OffscreenCanvas.getContext('2d')
  │  ctx.drawImage(frame)
  │  ctx.getImageData()     ← pixel readback in worker thread
  │
  │  binHistogram()  buildVectorscope()  buildWaveform()
  │
  │  postMessage({ histograms, vectorscope, waveformLines }, [typed arrays])
  ▼
ColorScopesWorkerClient (main thread)
  │  latest-result cache (drop stale frames)
  ▼
ScopePanel components (React)
  CanvasRenderer draws the scope bitmaps
```

**Worker file:** `src/workers/colorScopes.worker.ts`  
**Client file:** `src/core/workers/colorScopesWorkerClient.ts`

### Message protocol

```ts
// Main → Worker
interface ScopeAnalyzeRequest {
  type: 'ANALYZE';
  id: string;
  frame: ImageBitmap;          // transferred (zero-copy)
  enabledScopes: ScopeKind[];  // 'histogram' | 'vectorscope' | 'waveform' | 'parade'
  downsampleFactor?: number;   // 1 (full-res) to 4 (quarter-res preview); default 2
}

// Worker → Main
interface ScopeAnalyzeResult {
  type: 'SCOPE_RESULT';
  id: string;
  histogram?: { r: Uint32Array; g: Uint32Array; b: Uint32Array };
  vectorscope?: Float32Array;  // packed [u, v, weight] triples
  waveformLines?: Float32Array; // packed [x, luminance] pairs per column
  analysisMs: number;
}
```

**Back-pressure:** Latest-wins. If a new frame arrives before the previous
analysis completes the old `ImageBitmap` is `close()`d and the new one takes
its place.

### Integration points

- `NativeProgramPreview.tsx` — captures the current `ImageBitmap` from the
  wgpu surface after `present_native_frame` and posts it to the worker
- `ProgramPreview.tsx` — captures from the `<canvas>` element after each
  composite step
- `ScopePanel` components in `src/components/editor/scopes/` — subscribe to
  the `ColorScopesWorkerClient` via a `useScopeData()` hook

### Why not Rust for this?

The `get_video_scopes` Tauri command exists and is used for export-time analysis.
For live preview, the decoded frame is already a browser-side `ImageBitmap`.
Round-tripping it through Tauri IPC (RGBA bytes → serialize → IPC → Rust →
compute → serialize → IPC back) adds 3–8 ms of serialisation latency on top
of the actual scope math. The Worker path reads pixels directly from the GPU
texture that is already in the WebView process.

---

## 5. Domain 2 — Audio Waveform LOD Generation

### Problem

The timeline renders per-pixel waveform peaks for every audio track across
potentially hours of content. Zooming in/out changes the samples-per-pixel
ratio dramatically. Pre-computing peaks at multiple Levels of Detail (LODs)
and slicing the visible viewport from the correct LOD is the only way to keep
waveform rendering under 1 ms on the draw call.

The current `waveformService.ts` fetches `WaveformBucket[]` from Rust via
`extract_waveform_data`. That Tauri command does the heavy extraction on the
first call, but the browser-side path (`computeWaveformBuckets` in the same
file) runs on the main thread and scales poorly with large files or rapid
zooming.

### Design

```
waveformService.ts (main thread)
  │  getNativeWaveformData() → Float32 PCM from Rust (first time only)
  │  cacheWaveformData()
  │
  │  postMessage({ pcm: Float32Array, ... }, [pcm.buffer])
  ▼
waveformLod.worker.ts
  │  buildLodPyramid(pcm, sampleRate, lodSteps)
  │    → Map<samplesPerPixel, { peaks: Float32Array, rms: Float32Array }>
  │
  │  sliceViewport(pyramid, startSample, endSample, targetPixelWidth, lodStep)
  │    → { peaks: Float32Array, rms: Float32Array }   ← transferred
  │
  │  postMessage({ id, peaks, rms }, [peaks.buffer, rms.buffer])
  ▼
WaveformLodWorkerClient (main thread)
  │  Caches pyramid per mediaId
  │  Handles viewport-slice requests on zoom/scroll
  ▼
AudioWaveformLayer / TimelineTrack (React)
  Canvas draws transferred Float32Arrays directly
```

**Worker file:** `src/workers/waveformLod.worker.ts`  
**Client file:** `src/core/workers/waveformLodWorkerClient.ts`

### LOD pyramid spec

| LOD step | Samples per output pixel | Use case |
|---|---|---|
| 0 | 100 | Very zoomed in (>= 100 px/s) |
| 1 | 1,000 | Normal timeline view |
| 2 | 10,000 | Zoomed out (hours of content) |
| 3 | 100,000 | Overview / filmstrip |

The worker holds the pyramid in memory for the session duration. The client
dispatches `SLICE_VIEWPORT` messages on scroll/zoom; only the slice
(`~4 KB Float32Array` for a typical viewport) is transferred back.

### Message protocol

```ts
// Main → Worker
interface WaveformBuildRequest {
  type: 'BUILD_LOD';
  mediaId: string;
  pcm: Float32Array;      // transferred
  sampleRate: number;
  channelCount: number;
  lodSteps: number[];     // e.g. [100, 1000, 10000, 100000]
}

interface WaveformSliceRequest {
  type: 'SLICE_VIEWPORT';
  id: string;
  mediaId: string;
  startSample: number;
  endSample: number;
  pixelWidth: number;     // target column count
}

interface WaveformEvictRequest {
  type: 'EVICT';
  mediaId: string;
}

// Worker → Main
interface WaveformBuildReady {
  type: 'LOD_READY';
  mediaId: string;
}

interface WaveformSliceResult {
  type: 'SLICE_RESULT';
  id: string;
  peaks: Float32Array;    // transferred
  rms: Float32Array;      // transferred
  samplesPerPixel: number;
}
```

### Integration points

- `waveformService.ts` — existing service becomes a thin bridge; it fetches
  raw PCM via `extract_waveform_data` once and hands the buffer to the worker
- `AudioWaveformLayer` and track row components — call `sliceViewport()` on
  `timelineStore.scrollLeft` or `pixelsPerSecond` change events

---

## 6. Domain 3 — Keyframe Curve Evaluation Engine

### Problem

`evaluateTimelineScene` in `src/core/evaluation/evaluator.ts` runs on every
RAF tick during playback and on every scrub event. With tens of clips — each
potentially carrying animated `visualKeyframes` (x, y, width, height, rotation,
opacity) and `volumeKeyframes` — evaluating cubic Bezier easing for every
property every frame accumulates to 2–8 ms of pure JS execution on the main
thread. That is directly subtracted from the 16 ms frame budget.

### Design

The full `evaluateTimelineScene` cannot be moved to a worker because it calls
`resolveTextTemplateArtifact`, `resolveConform`, and `resolveTextEffectDefinition`
from `@clypra-studio/engine` — these resolve against in-memory caches and font
registries that are main-thread singletons. Only the **keyframe evaluation
sub-task** (computing animated property values at time `t`) is a pure
mathematical function with no side effects.

```
timelineStore.epoch change (main thread)
  │  Serialise: clips[], keyframeGraphs[]
  │  postMessage({ clips, time, frameRate }, [])   ← structured clone (small)
  ▼
keyframeEval.worker.ts
  │  evaluateKeyframeCurves(clips, time, frameRate)
  │    → for each clip:
  │       for each animated property:
  │         solveCubicBezier(p0, p1, p2, p3, t)  → value
  │
  │  pack into Float32Array:
  │    [clipIndex, propEnum, value,  clipIndex, propEnum, value, ...]
  │
  │  postMessage({ id, results: Float32Array }, [results.buffer])
  ▼
KeyframeEvalWorkerClient (main thread)
  │  unpack Float32Array → Map<clipId, Record<prop, number>>
  │  merge into evaluateTimelineScene input (pre-resolved keyframe values)
  ▼
evaluateTimelineScene() uses pre-resolved values instead of re-evaluating Bezier
```

**Worker file:** `src/workers/keyframeEval.worker.ts`  
**Client file:** `src/core/workers/keyframeEvalWorkerClient.ts`

### Message protocol

```ts
// Main → Worker
interface KeyframeEvalRequest {
  type: 'EVALUATE';
  id: string;
  time: number;
  frameRate: number;
  clips: SerializedKeyframeClip[];  // stripped-down clip shape, no DOM refs
}

interface SerializedKeyframeClip {
  clipId: string;
  startTime: number;
  duration: number;
  visualKeyframes?: VisualPropertyKeyframe[];  // from src/types/index.ts
  volumeKeyframes?: AudioKeyframe[];
}

// Worker → Main
interface KeyframeEvalResult {
  type: 'EVAL_RESULT';
  id: string;
  results: Float32Array;  // transferred; packed [clipIdx, propEnum, value, ...]
  evalMs: number;
}
```

**Property enum layout** (packed into Float32Array index 1 of each triple):

| Value | Property |
|---|---|
| 0 | x |
| 1 | y |
| 2 | width |
| 3 | height |
| 4 | rotation |
| 5 | opacity |
| 6 | volume |

### Back-pressure

The RAF loop posts a new `EVALUATE` request every frame. If the previous result
has not arrived, the main thread uses the **last known result** (stale by at
most one frame). The worker always processes the latest request ID and discards
superseded ones. This is a latest-wins pattern with no queue.

---

## 7. Domain 4 — Timeline Snapping, Ripple Math & Collision Detection

### Problem

During clip dragging and trim operations, every `mousemove` event triggers:
1. Snap-target computation (find nearest playhead, clip edge, or marker within
   the snap radius)
2. Ripple offset propagation (update all downstream clips' `startTime`)
3. Collision detection (prevent overlaps respecting track lock state)

With 50+ clips across 10+ tracks, the naive O(n) scan runs in 3–10 ms per
`mousemove`. At 60 fps mouse polling that is 180–600 ms of wasted main-thread
time per second of dragging.

The current implementation lives in drag event handlers in the timeline
components and in the `gapEngine.ts` library — all synchronous, all on the
main thread.

### Design

```
TimelineTrack drag handlers (main thread)
  │  read: clips[], markers[], playheadTime, snapEnabled
  │  postMessage({ type: 'SNAP_QUERY', draggedClipId, proposedStartTime,
  │                 allClips, markers, pixelsPerSecond })
  ▼
timelineSnap.worker.ts
  │  buildIntervalTree(clips)  ← cached; rebuilt only on epoch change
  │
  │  For SNAP_QUERY:
  │    findSnapTargets(proposedTime, snapRadius, tree, markers, playheadTime)
  │    resolveCollisions(draggedClip, proposedTime, tree)
  │    → { snappedTime, snapIndicators[], collidingClipIds[] }
  │
  │  For RIPPLE_COMPUTE:
  │    computeRippleDeltas(anchorClipId, deltaTime, clips, tracks)
  │    → { clipDeltas: Map<id, deltaTime> }
  │
  │  postMessage(result)
  ▼
TimelineSnapWorkerClient (main thread)
  │  debounce 8 ms on drag (drop superseded requests)
  │  apply snappedTime to dragStateStore
  │  render snap indicators via snapGuides in timelineStore
```

**Worker file:** `src/workers/timelineSnap.worker.ts`  
**Client file:** `src/core/workers/timelineSnapWorkerClient.ts`

### Message protocol

```ts
// Main → Worker
interface SnapSyncMessage {
  type: 'SYNC_STATE';       // sent on epoch change; rebuilds interval tree
  clips: SnapClip[];
  markers: TimelineMarker[];
}

interface SnapQueryMessage {
  type: 'SNAP_QUERY';
  id: string;
  draggedClipId: string;
  proposedStartTime: number;
  trackId: string;
  snapEnabled: boolean;
  snapRadiusSeconds: number;
  playheadTime: number;
}

interface RippleComputeMessage {
  type: 'RIPPLE_COMPUTE';
  id: string;
  anchorClipId: string;
  side: 'left' | 'right';
  deltaSeconds: number;
  lockedTrackIds: string[];
}

// Worker → Main
interface SnapResult {
  type: 'SNAP_RESULT';
  id: string;
  snappedTime: number;
  snapGuides: Array<{ time: number; type: 'clip-start' | 'clip-end' | 'playhead' | 'marker' }>;
  collidingClipIds: string[];
}

interface RippleResult {
  type: 'RIPPLE_RESULT';
  id: string;
  clipDeltas: Array<{ clipId: string; deltaSeconds: number }>;
}
```

### Interval tree

The worker maintains an in-memory augmented interval tree keyed on
`[startTime, startTime + duration]`. It is rebuilt via `SYNC_STATE` whenever
`timelineStore.epoch` changes. The main thread debounces epoch changes before
sending `SYNC_STATE` to avoid rebuilding on every keypress during a rename.

### Integration with `timelineStore`

The snap worker returns **proposed positions**. The actual `updateClip()` mutation
in `timelineStore` still runs on the main thread after the user releases the
drag. The worker only drives the *visual preview* (snap guides, ghost clip
position) — it never writes to the store directly.

---

## 8. Domain 5 — Project History, Diffing & Auto-Save Serialization

### Problem

`autoSaveMiddleware.ts` triggers `saveCurrentProject()` after every timeline
mutation. `saveCurrentProject()` calls `JSON.stringify` on the full project
state tree (tracks, clips, gaps, transitions, caption tracks, media assets).
On large projects this can serialize 5–30 MB of JSON, taking 20–80 ms on the
main thread and causing a visible jank spike every time the user edits a clip.

Similarly, the `historyStore` (undo/redo) stores full state snapshots.
Diffing between snapshots to generate undo patches (JSON Patch / RFC 6902)
is O(n) in project size and currently runs synchronously before every mutation.

### Design

```
autoSaveMiddleware (main thread)
  │  clones project state (shallow, fast)
  │  postMessage({ type: 'SERIALIZE', state })  ← structured-clone copy
  ▼
projectWorker.worker.ts
  │  SERIALIZE:
  │    JSON.stringify(state)
  │    → postMessage({ type: 'SERIALIZED', json })  ← plain string, no transfer
  │
  │  DIFF:
  │    computeJsonPatch(prevState, nextState)  ← RFC 6902 patch generation
  │    → postMessage({ type: 'PATCH_READY', patch })
  │
  │  WRITE_OPFS:
  │    navigator.storage.getDirectory()  ← OPFS available in workers
  │    write JSON to Origin Private File System (auto-save backup)
  │    → postMessage({ type: 'WRITE_COMPLETE' })
  ▼
ProjectWorkerClient (main thread)
  │  SERIALIZED → platform.saveProject(json)   ← Tauri IPC
  │  PATCH_READY → historyStore.pushPatch(patch)
  │  WRITE_COMPLETE → log / metrics
```

**Worker file:** `src/workers/projectWorker.worker.ts`  
**Client file:** `src/core/workers/projectWorkerClient.ts`

### Message protocol

```ts
// Main → Worker
interface SerializeRequest {
  type: 'SERIALIZE';
  id: string;
  state: SerializableProjectState;  // structured-clone safe
}

interface DiffRequest {
  type: 'DIFF';
  id: string;
  previous: SerializableProjectState;
  next: SerializableProjectState;
}

interface WriteOpfsRequest {
  type: 'WRITE_OPFS';
  id: string;
  filename: string;
  json: string;
}

// Worker → Main
interface SerializedResult {
  type: 'SERIALIZED';
  id: string;
  json: string;
  serializeMs: number;
}

interface PatchResult {
  type: 'PATCH_READY';
  id: string;
  patch: JsonPatchOperation[];
  diffMs: number;
}

interface WriteComplete {
  type: 'WRITE_COMPLETE';
  id: string;
}
```

### Auto-save flow (revised)

```
User edits clip (main thread)
  → timelineStore.updateClip()  [epoch++]
  → autoSaveMiddleware fires (debounced 500 ms)
  → projectWorkerClient.serialize(state)
  → ... (worker serializes in background) ...
  → main thread receives SERIALIZED
  → platform.saveProject(json)   [Tauri IPC → disk write in Rust]
```

The main thread is never blocked by `JSON.stringify`. The `platform.saveProject`
Tauri call is async and already non-blocking.

### OPFS crash-recovery backup

`projectStore` currently writes crash snapshots to IndexedDB with a 250 ms
debounce. The worker can instead write directly to OPFS (Origin Private File
System), which is available inside workers and is 3–5× faster than IndexedDB
for sequential writes. This requires no Tauri IPC at all.

---

## 9. Domain 6 — Subtitle & Timed-Text Parsing / Layout

### Problem

Loading an Advanced SubStation Alpha (`.ass`) or WebVTT (`.vtt`) file, or
processing raw Whisper word-level transcription output, involves:
- String parsing (potentially MB-scale `.ass` files)
- Building an interval tree of cue timestamps for O(log n) playback lookup
- Word-wrapping and bounding-box calculation per cue (requires font metrics)
- Handling per-word karaoke timing (CaptionWord[] model in `src/types/captions.ts`)

All of this runs on the main thread today, blocking the editor during import.

### Design

```
CaptionImportPanel / auto-caption result (main thread)
  │  raw file content (string) or Whisper WordSegment[]
  │  postMessage({ type: 'PARSE_SUBTITLES', ... })
  ▼
subtitleParser.worker.ts
  │  parseAss(rawText)   /   parseVtt(rawText)   /   fromWhisper(segments)
  │    → CaptionCue[]  with  { startTime, endTime, text, words?: CaptionWord[] }
  │
  │  buildCueIntervalTree(cues)   ← for O(log n) getActiveCues(time)
  │
  │  layoutCues(cues, style, maxWidth)
  │    → CaptionCue[]  with  { boundingBox, wordBoxes[] }
  │    (uses OffscreenCanvas measureText for font metrics)
  │
  │  postMessage({ type: 'PARSE_RESULT', cues, tree }, [])
  ▼
SubtitleParserWorkerClient (main thread)
  │  captionStore.setCues(cues)
  │  or: timelineStore with batch insert of CaptionTrack
```

**Worker file:** `src/workers/subtitleParser.worker.ts`  
**Client file:** `src/core/workers/subtitleParserWorkerClient.ts`

### Message protocol

```ts
// Main → Worker
interface ParseSubtitlesRequest {
  type: 'PARSE_SUBTITLES';
  id: string;
  format: 'ass' | 'vtt' | 'srt' | 'whisper';
  rawText?: string;                   // for file formats
  whisperSegments?: WhisperSegment[]; // for transcription output
  style?: CaptionStyle;               // for layout pre-computation
  canvasWidth?: number;               // for word-wrap layout
}

interface LayoutCuesRequest {
  type: 'LAYOUT_CUES';
  id: string;
  cues: CaptionCue[];
  style: CaptionStyle;
  canvasWidth: number;
  canvasHeight: number;
}

// Worker → Main
interface ParseResult {
  type: 'PARSE_RESULT';
  id: string;
  cues: CaptionCue[];
  durationSeconds: number;
  parseMs: number;
}

interface LayoutResult {
  type: 'LAYOUT_RESULT';
  id: string;
  cues: LayoutedCaptionCue[];
  layoutMs: number;
}
```

### Integration with `CaptionTrack` model

The worker produces plain `CaptionCue[]` arrays that map directly onto the
`CaptionTrack.cues[]` field in `src/types/captions.ts`. The main thread wraps
them in the standard `setCaptionTracks` / `addCaptionTrack` store mutations.
The worker never writes to the store directly.

---

## 10. Worker Lifecycle & `ProjectSession` Integration

All workers are instantiated inside `ProjectSession` and disposed when the
project closes. This mirrors the existing pattern for `RenderEngine`,
`PreviewMediaPool`, `AudioEngine`, and `NativeRasterBridge`.

```ts
// src/core/runtime/ProjectSession.ts  (proposed additions)

export class ProjectSession {
  // … existing fields …

  // New worker clients — created in constructor, disposed in dispose()
  readonly colorScopesClient: ColorScopesWorkerClient;
  readonly waveformLodClient: WaveformLodWorkerClient;
  readonly keyframeEvalClient: KeyframeEvalWorkerClient;
  readonly timelineSnapClient: TimelineSnapWorkerClient;
  readonly projectWorkerClient: ProjectWorkerClient;
  readonly subtitleParserClient: SubtitleParserWorkerClient;

  constructor(project: Project) {
    // … existing init …
    this.colorScopesClient    = new ColorScopesWorkerClient();
    this.waveformLodClient    = new WaveformLodWorkerClient();
    this.keyframeEvalClient   = new KeyframeEvalWorkerClient();
    this.timelineSnapClient   = new TimelineSnapWorkerClient();
    this.projectWorkerClient  = new ProjectWorkerClient();
    this.subtitleParserClient = new SubtitleParserWorkerClient();
  }

  dispose(): void {
    // … existing disposal …
    this.colorScopesClient.dispose();
    this.waveformLodClient.dispose();
    this.keyframeEvalClient.dispose();
    this.timelineSnapClient.dispose();
    this.projectWorkerClient.dispose();
    this.subtitleParserClient.dispose();
  }
}
```

Workers that need to stay in sync with `timelineStore.epoch` subscribe via a
thin Zustand `subscribe()` listener set up in `ProjectSession`, not in React
components. This avoids React re-renders for internal sync messages.

---

## 11. Safari / Browser Compatibility Notes

`main.tsx` already runs an `OffscreenCanvas` filter-capability probe at startup
and nulls out `globalThis.OffscreenCanvas` on Safari builds where CSS `filter`
is not supported inside an `OffscreenCanvas` 2D context.

Every new worker that uses Canvas 2D filters **must** check:

```ts
if (typeof OffscreenCanvas === 'undefined') {
  // Fall back to HTMLCanvasElement on main thread
}
```

Workers that use `OffscreenCanvas` only for pixel readback (color scopes,
waveform) or pure math (keyframe eval, timeline snap, project serialization,
subtitle parsing) are **not affected** by the Safari filter limitation and
will work on all platforms.

The `subtitleParser` worker uses `OffscreenCanvas.measureText` for font metrics.
This is supported on all platforms. No filter workaround needed.

---

## 12. What Stays on the Main Thread

These tasks must never be moved to a worker. They are listed explicitly to
prevent well-intentioned refactors from breaking the architecture.

| Task | Why it must stay on main thread |
|---|---|
| `timelineStore` mutations (`addClip`, `updateClip`, …) | Zustand is synchronous; React requires mutations on the render thread |
| `projectStore.saveCurrentProject()` orchestration | Reads multiple stores, calls Tauri IPC after serialization |
| `ProjectSession` constructor / `dispose()` | Owns DOM handles (`HTMLVideoElement`), Tauri listeners, `AudioContext` |
| `NativeRasterBridge.register()` | Calls `registerNativeRasterAsset` (Tauri IPC) |
| `PreviewPlaybackScheduler.reconcile()` **result application** | Applies to `PreviewMediaPool` which holds `HTMLVideoElement` references |
| `NativeSurfaceRuntime` position sync | Calls `resize_native_surface` (Tauri IPC) |
| React event handlers and component effects | React requirement |
| `evaluateTimelineScene()` orchestration | Calls `resolveTextTemplateArtifact`, font registries — main-thread singletons |

---

## 13. Migration Checklist

Use this as the implementation tracker when building out the worker layer.

### Infrastructure (prerequisite)
- [ ] `src/workers/types.ts` — shared message type unions
- [ ] `src/core/workers/workerBus.ts` — `WorkerBus<Req, Res>` generic

### Domain workers (can be built in parallel)
- [x] `templateRasterizer.worker.ts` — **live**
- [x] `mediapipe.worker.ts` — **live**
- [ ] `colorScopes.worker.ts` + `ColorScopesWorkerClient`
- [ ] `waveformLod.worker.ts` + `WaveformLodWorkerClient`
- [ ] `keyframeEval.worker.ts` + `KeyframeEvalWorkerClient`
- [ ] `timelineSnap.worker.ts` + `TimelineSnapWorkerClient`
- [ ] `projectWorker.worker.ts` + `ProjectWorkerClient`
- [ ] `subtitleParser.worker.ts` + `SubtitleParserWorkerClient`

### Integration
- [ ] `ProjectSession` — instantiate and dispose all new clients
- [ ] `autoSaveMiddleware` — route serialization through `ProjectWorkerClient`
- [ ] `waveformService.ts` — hand PCM buffer to `WaveformLodWorkerClient`
- [ ] `PreviewPanel` — post `ImageBitmap` to `ColorScopesWorkerClient`
- [ ] Timeline drag handlers — replace inline snap math with `TimelineSnapWorkerClient`
- [ ] Caption import flow — route file parsing through `SubtitleParserWorkerClient`
- [ ] RAF playback loop — use `KeyframeEvalWorkerClient` pre-resolved values

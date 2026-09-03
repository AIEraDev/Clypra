# Web Worker Layer — Architecture Design

**Status:** Consolidated Domain Worker Architecture Implemented & Verified  
**Last updated:** 2026-09-03  
**Scope:** All compute-heavy frontend work that must not block the React main thread

---

## Table of Contents

1. [System Context & Architecture](#1-system-context--architecture)
2. [Consolidated Domain Worker Topology](#2-consolidated-domain-worker-topology)
3. [Shared Infrastructure & WorkerBus](#3-shared-infrastructure--workerbus)
4. [Domain 1 — Keyframe Curve Evaluation Engine](#4-domain-1--keyframe-curve-evaluation-engine)
5. [Domain 2 — Timeline Snapping, Ripple Math & Collision Detection](#5-domain-2--timeline-snapping-ripple-math--collision-detection)
6. [Domain 3 — Project History, Diffing & OPFS Auto-Save](#6-domain-3--project-history-diffing--opfs-auto-save)
7. [Domain 4 — Audio Waveform Multi-LOD Generation](#7-domain-4--audio-waveform-multi-lod-generation)
8. [Domain 5 — Color Scopes & Real-Time Video Analysis](#8-domain-5--color-scopes--real-time-video-analysis)
9. [Domain 6 — Subtitle & Timed-Text Parsing / Layout](#9-domain-6--subtitle--timed-text-parsing--layout)
10. [Specialized Standalone Workers](#10-specialized-standalone-workers)
11. [Worker Lifecycle & Shared Domain Management](#11-worker-lifecycle--shared-domain-management)
12. [Browser / WebView Compatibility & Fallbacks](#12-browser--webview-compatibility--fallbacks)
13. [What Stays on the Main Thread](#13-what-stays-on-the-main-thread)

---

## 1. System Context & Architecture

Clypra is a high-performance desktop video editor built with Tauri v2. The complete compute stack is organized into three distinct tiers:

```text
React 19 Main Thread  ←──→  Consolidated Web Workers  ←──→  Rust / Tauri Backend
(UI, DOM, Stores)           (Math, Buffers, Analysis)      (wgpu, FFmpeg, CPAL)
```

- **React Main Thread**:
  - DOM event dispatch, gestures, and UI reconciliation.
  - Zustand stores (`timelineStore`, `projectStore`, `uiStore`).
  - Tauri IPC invocation and event subscriptions.
- **Rust / Tauri Core**:
  - Hardware audio output and sample clock (`NativeAudioClock` via CPAL).
  - Background decode and persistent GPU presentation (`NativeRenderSession`, `wgpu`).
  - Video stream decoders (FFmpeg decoder pool, 1 GB bounded LRU).
  - File I/O, asset persistence, and native export.
- **Web Worker Layer**:
  - Heavy CPU compute that would otherwise violate the 16.6ms (60 FPS) frame budget.
  - Pure mathematical evaluations (Bézier curves, 1D interval trees).
  - Heavy array and buffer operations (`Float32Array` audio PCM, `ImageBitmap` pixel readback).
  - Off-thread JSON serialization, RFC 6902 patch diffing, and OPFS storage.

### Relevant source paths

| Path | Role |
|---|---|
| `src/workers/compute.worker.ts` | Consolidated Domain 1: Keyframe evaluation, timeline snap/ripple, project diffing |
| `src/workers/mediaAnalysis.worker.ts` | Consolidated Domain 2: Waveform LOD pyramids, real-time color scopes, subtitle layout |
| `src/workers/templateRasterizer.worker.ts` | Specialized: OffscreenCanvas font & template rasterization |
| `src/workers/mediapipe.worker.ts` | Specialized: MediaPipe ONNX face detection & auto-reframe |
| `src/core/workers/workerBus.ts` | `WorkerBus`, `LatestOnlyQueue`, and `getSharedDomainWorkerBus` |
| `src/core/workers/` | Domain client wrappers (`waveformLod`, `colorScopes`, `keyframeEval`, etc.) |
| `src/workers/types.ts` | Shared TypeScript request/response contracts |

---

## 2. Consolidated Domain Worker Topology

### Why Consolidation Replaced "One Worker Per Feature"

In early designs, spawning a dedicated Web Worker isolate for every single feature (`colorScopes.worker.ts`, `waveformLod.worker.ts`, `keyframeEval.worker.ts`, `timelineSnap.worker.ts`, `projectWorker.worker.ts`, `subtitleParser.worker.ts`) introduced architectural bottlenecks:

1. **Thread Pool Contention**: Spawning 6+ persistent worker threads inside a WebView (WebKit on macOS, WebView2 on Windows) created thread contention with Rust's tokio runtime, audio callback threads, and wgpu presentation threads.
2. **Excessive Memory Overhead**: Each V8 / JavaScriptCore isolate carries base heap overhead (~15–30 MB per isolate), multiplying memory consumption.
3. **Context Switching & Cold Starts**: Managing 6 distinct worker lifecycles led to staggered initialization times and complex teardown sequencing on project changes.

### The Production Topology: 2 Consolidated Domain Isolates + 2 Specialized Workers

Clypra groups off-thread tasks into **two primary multi-task domain isolates** and **two specialized standalone workers**:

```text
src/workers/
├── compute.worker.ts           ← Domain 1: Math, Keyframes, Snapping, Serialization
├── mediaAnalysis.worker.ts     ← Domain 2: Waveforms, Color Scopes, Subtitles
├── templateRasterizer.worker.ts← Specialized: OffscreenCanvas font & template rasterization
└── mediapipe.worker.ts         ← Specialized: ONNX / WASM AI Face Detection
```

| Worker File | Domain Role | Operations Handled | Memory Model |
|---|---|---|---|
| `compute.worker.ts` | **Compute Engine** | • Keyframe Bézier curve solving<br>• Timeline magnetic snapping & ripple math<br>• Project serialization, JSON diffing & OPFS write | Zero DOM, pure algorithmic math, structural JSON |
| `mediaAnalysis.worker.ts` | **Media Analysis Engine** | • Waveform multi-LOD peak/RMS generation<br>• Real-time 60fps Color Scopes (Vectorscope/RGB Parade/Histogram)<br>• Subtitle parsing & cue text layout | `Transferable` arrays (`Float32Array`, `ImageBitmap`), `OffscreenCanvas` |
| `templateRasterizer.worker.ts` | **Template Rasterizer** | • Dynamic font loading & layout<br>• OffscreenCanvas text effect rasterization | `OffscreenCanvas`, `ImageBitmap` output |
| `mediapipe.worker.ts` | **ML Inference** | • MediaPipe face detection & auto-reframe tracking | GPU delegate / WASM model |

---

## 3. Shared Infrastructure & WorkerBus

### 3.1 `WorkerBus<TRequest, TResponse>` (`src/core/workers/workerBus.ts`)

A reusable, typed request/response infrastructure that all worker clients build upon:

- **Monotonic Request IDs**: Injects unique string IDs into outgoing payloads and correlates responses back to waiting promises.
- **Transferable Object Support**: Automatically passes transferables (`ArrayBuffer`, `ImageBitmap`) across thread boundaries without structured clone copying.
- **Graceful Lifecycle Management**: `dispose()` rejects all pending promises with `WorkerBusDisposedError`, posts a `DISPOSE` message to the worker, and terminates the thread.
- **Resilience & Auto-Restart**: Optional `autoRestart` (with configurable `maxRestarts`) recovers crashed workers while cleanly rejecting orphaned promises.

### 3.2 `LatestOnlyQueue`

For high-frequency frame-driven tasks (such as real-time color scopes or continuous keyframe evaluation during playback), `LatestOnlyQueue` ensures a latest-wins policy: if a newer request is submitted before an in-flight request resolves, the older result is superseded and dropped without throwing errors.

### 3.3 `getSharedDomainWorkerBus` Registry

Rather than instantiating a new `Worker` every time a client is created, domain clients request their bus from the shared registry:

```ts
export function getSharedDomainWorkerBus<TReq, TRes>(
  domainKey: string,
  factory: () => Worker,
  options?: WorkerBusOptions,
): WorkerBus<TReq, TRes>
```

- Clients for `keyframeEval`, `timelineSnap`, and `projectWorker` all share the `"compute"` domain isolate.
- Clients for `waveformLod`, `colorScopes`, and `subtitleParser` all share the `"mediaAnalysis"` domain isolate.
- Single global reset via `resetSharedDomainWorkerBuses()` allows instant, complete cleanup during project teardown or automated testing.

---

## 4. Domain 1 — Color Scopes & Video Analysis

### Problem
Real-time scopes (Vectorscope, RGB Parade, Histogram, Waveform Monitor) must sample every pixel of the current preview frame at up to 60 fps. A single 1920×1080 frame is ~8 MB of RGBA data. Running `getImageData` and binning algorithms on the main thread blocks React's event loop for 10–40 ms per frame.

### Design
Hosted inside `mediaAnalysis.worker.ts`, managed by `ColorScopesWorkerClient` over the shared `"mediaAnalysis"` domain bus. Transferred `ImageBitmap` frames are read and processed off-thread using `OffscreenCanvas`.

**Worker file:** `src/workers/mediaAnalysis.worker.ts`  
**Client file:** `src/core/workers/colorScopesWorkerClient.ts`  
**Shared Bus Key:** `"mediaAnalysis"`

### Message protocol 
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

**Worker file:** `src/workers/mediaAnalysis.worker.ts`  
**Client file:** `src/core/workers/waveformLodWorkerClient.ts`  
**Shared Bus Key:** `"mediaAnalysis"`

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

**Worker file:** `src/workers/compute.worker.ts`  
**Client file:** `src/core/workers/keyframeEvalWorkerClient.ts`  
**Shared Bus Key:** `"compute"`

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

**Worker file:** `src/workers/compute.worker.ts`  
**Client file:** `src/core/workers/timelineSnapWorkerClient.ts`  
**Shared Bus Key:** `"compute"`

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

**Worker file:** `src/workers/compute.worker.ts`  
**Client file:** `src/core/workers/projectWorkerClient.ts`  
**Shared Bus Key:** `"compute"`

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

**Worker file:** `src/workers/mediaAnalysis.worker.ts`  
**Client file:** `src/core/workers/subtitleParserWorkerClient.ts`  
**Shared Bus Key:** `"mediaAnalysis"`

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

## 10. Specialized Standalone Workers

Two tasks retain dedicated standalone worker entry points due to external library dependencies:

### 10.1 `templateRasterizer.worker.ts`
- **Location:** `src/workers/templateRasterizer.worker.ts`
- **Client:** `src/core/render/templateRasterizerWorkerClient.ts`
- **Role:** Renders dynamic text animations, typography presets, and templates via `OffscreenCanvas`.
- **Flow Control:** Paired with `LatestTextPreparationScheduler` to restrict in-flight raster jobs to 1 active + 1 queued per layer.

### 10.2 `mediapipe.worker.ts`
- **Location:** `src/workers/mediapipe.worker.ts`
- **Client:** `src/features/auto-reframe/mediapipeWorkerClient.ts`
- **Role:** Executes MediaPipe Vision face detection models off-thread using WebAssembly / WebGL GPU delegates.
- **Lifecycle:** Session-scoped; closes detector and shuts down isolate when auto-reframe tracking completes.

---

## 11. Worker Lifecycle & Shared Domain Management

### Shared Domain Bus Pattern
Instead of instantiating 6+ independent Worker instances that compete for WebView thread pool quotas and duplicate isolate memory, all domain clients connect via `getSharedDomainWorkerBus`:

```ts
// src/core/workers/keyframeEvalWorkerClient.ts
export class KeyframeEvalWorkerClient {
  private readonly bus: WorkerBus<KeyframeEvalWorkerRequest, KeyframeEvalWorkerResponse>;

  constructor() {
    this.bus = getSharedDomainWorkerBus(
      "compute",
      () =>
        new Worker(
          new URL("../../workers/compute.worker.ts", import.meta.url),
          { type: "module" },
        ),
      { name: "ComputeWorker:KeyframeEval", autoRestart: true },
    );
  }
}
```

```ts
// src/core/workers/waveformLodWorkerClient.ts
export class WaveformLodWorkerClient {
  private readonly bus: WorkerBus<WaveformLodWorkerRequest, WaveformLodWorkerResponse>;

  constructor() {
    this.bus = getSharedDomainWorkerBus(
      "mediaAnalysis",
      () =>
        new Worker(
          new URL("../../workers/mediaAnalysis.worker.ts", import.meta.url),
          { type: "module" },
        ),
      { name: "MediaAnalysisWorker:WaveformLod", autoRestart: true },
    );
  }
}
```

### Clean Teardown Protocol
When switching projects or disposing the editor runtime:
1. `resetSharedDomainWorkerBuses()` drains all pending requests across all domains with cancellation errors.
2. Posts `DISPOSE` to allow workers to close file handles and release memory.
3. Invokes `worker.terminate()` on both `compute` and `mediaAnalysis` isolates.

---

## 12. Browser / WebView Compatibility & Fallbacks

All worker clients include seamless synchronous fallbacks for headless testing environments (e.g. Node / Vitest) and restricted WebView configurations:

```ts
if (this.bus.status === "error" || typeof Worker === "undefined") {
  return this.fallbackSynchronousExecution(payload);
}
```

- **OffscreenCanvas CSS Filters**: Safari WebKit builds without filter support fall back gracefully.
- **OPFS Availability**: When `navigator.storage.getDirectory()` is restricted, `ProjectWorkerClient` falls back to standard main-thread serialization.

---

## 13. What Stays on the Main Thread

These tasks must **never** be delegated to a worker:

| Task | Rationale |
|---|---|
| Zustand store mutations (`timelineStore`, `projectStore`) | State changes must be synchronous for React component reconciliation |
| Tauri IPC commands (`invoke()`, `Channel<T>`) | IPC bridges require main WebView thread access |
| DOM element manipulation (`HTMLVideoElement`, Canvas 2D overlays) | DOM references cannot cross Web Worker boundary |
| Hardware audio clock control (`NativeAudioClock`) | Native audio handles are managed via Tauri commands on main thread |
| Active WGPU child surface presentation | Owned by Rust background render worker via native OS window handles |

---

## 14. Migration Status & Verification

All core domain workers and infrastructure are implemented and covered by automated test suites:

- [x] `src/workers/types.ts` — shared message contracts
- [x] `src/core/workers/workerBus.ts` — `WorkerBus`, `LatestOnlyQueue`, `getSharedDomainWorkerBus`
- [x] `src/workers/compute.worker.ts` — Consolidated Domain 1 (Keyframes, Snapping, Serialization)
- [x] `src/workers/mediaAnalysis.worker.ts` — Consolidated Domain 2 (Waveforms, Scopes, Subtitles)
- [x] `src/workers/templateRasterizer.worker.ts` — Specialized OffscreenCanvas text rasterizer
- [x] `src/workers/mediapipe.worker.ts` — Specialized MediaPipe AI face detector
- [x] Main-thread domain clients:
  - `ColorScopesWorkerClient`
  - `WaveformLodWorkerClient`
  - `KeyframeEvalWorkerClient`
  - `TimelineSnapWorkerClient`
  - `ProjectWorkerClient`
  - `SubtitleParserWorkerClient`
- [x] Automated test suites in `src/core/workers/__tests__/` passing 100% cleanly.

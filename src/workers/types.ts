/**
 * Web Worker Message Protocol — Shared Type Contracts
 *
 * This file is the single authoritative source for every message type that
 * crosses the main-thread ↔ worker boundary. Import from here in both the
 * worker entry point and its main-thread client wrapper so TypeScript catches
 * protocol mismatches at compile time.
 *
 * Naming convention
 * ─────────────────
 * Inbound  (main → worker): <Domain>WorkerRequest  (union of request variants)
 * Outbound (worker → main): <Domain>WorkerResponse (union of response variants)
 *
 * Every request variant that expects a reply carries a string `id` field.
 * The matching response echoes the same `id` so the WorkerBus can resolve
 * the waiting Promise.
 *
 * Shared base types
 * ─────────────────
 * WorkerDisposeMessage  — included in every inbound union; worker must call
 *                         self.close() on receipt
 * WorkerErrorResponse   — included in every outbound union; emitted when a
 *                         request handler throws
 *
 * Transfer list guidance
 * ──────────────────────
 * Fields annotated with [TRANSFER] must be listed in the transferables array
 * of postMessage() to avoid copying:
 *   postMessage(msg, [msg.field])
 * Fields annotated with [CLONE] are structured-cloned automatically; no
 * transferables entry is needed.
 */

// ─── Shared base messages ─────────────────────────────────────────────────────

/** Sent by every client's dispose() to trigger deterministic worker shutdown. */
export interface WorkerDisposeMessage {
  type: "DISPOSE";
}

/** Emitted by a worker when a request handler throws an unhandled error. */
export interface WorkerErrorResponse {
  type: "ERROR";
  /** Echo of the request id that caused the error, if available. */
  id?: string;
  message: string;
}

// ─── Domain 1: Color Scopes & Video Analysis ─────────────────────────────────
//
// Worker file:  src/workers/colorScopes.worker.ts
// Client file:  src/core/workers/colorScopesWorkerClient.ts

export type ScopeKind = "histogram" | "vectorscope" | "waveform" | "parade";

export interface ScopeAnalyzeRequest {
  type: "ANALYZE";
  id: string;
  /** [TRANSFER] Zero-copy frame from OffscreenCanvas or captured preview bitmap. */
  frame: ImageBitmap;
  enabledScopes: ScopeKind[];
  /**
   * @deprecated No longer used. The worker now pre-scales the frame to
   * 256×144 via GPU `drawImage` before `getImageData`, giving a 54× pixel
   * reduction without quality loss. Field kept for API compatibility.
   */
  downsampleFactor?: number;
}

export interface ScopeAnalyzeResult {
  type: "SCOPE_RESULT";
  id: string;
  /**
   * Histogram channel bins (256 buckets per channel).
   * [TRANSFER] each Uint32Array
   */
  histogram?: {
    r: Uint32Array;
    g: Uint32Array;
    b: Uint32Array;
    luma: Uint32Array;
  };
  /**
   * Vectorscope points: packed Float32Array of [u, v, weight] triples.
   * Length = (number of sampled pixels) × 3.
   * [TRANSFER]
   */
  vectorscope?: Float32Array;
  /**
   * Waveform monitor: packed Float32Array of [column, luminance] pairs.
   * One pair per horizontal pixel column, sampled from all rows in that column.
   * [TRANSFER]
   */
  waveformLines?: Float32Array;
  /**
   * RGB parade: packed Float32Array of [column, r, g, b] quads.
   * [TRANSFER]
   */
  parade?: Float32Array;
  analysisMs: number;
}

export type ColorScopesWorkerRequest =
  | ScopeAnalyzeRequest
  | WorkerDisposeMessage;
export type ColorScopesWorkerResponse =
  | ScopeAnalyzeResult
  | WorkerErrorResponse;

// ─── Domain 2: Audio Waveform LOD Generation ──────────────────────────────────
//
// Worker file:  src/workers/waveformLod.worker.ts
// Client file:  src/core/workers/waveformLodWorkerClient.ts

/**
 * Instructs the worker to decode and build a multi-LOD peak pyramid for a
 * given media asset. The PCM buffer is transferred zero-copy.
 */
export interface WaveformBuildRequest {
  type: "BUILD_LOD";
  mediaId: string;
  /** [TRANSFER] Raw mono or interleaved PCM samples (32-bit float, normalised -1..1). */
  pcm: Float32Array;
  sampleRate: number;
  channelCount: number;
  /**
   * Samples-per-output-pixel breakpoints defining the LOD levels.
   * Default: [100, 1_000, 10_000, 100_000]
   */
  lodSteps?: number[];
}

export interface WaveformBuildReady {
  type: "LOD_READY";
  mediaId: string;
  /** Total number of samples in the PCM buffer (after channel collapse). */
  totalSamples: number;
  /** Duration in seconds derived from totalSamples / sampleRate. */
  durationSeconds: number;
}

/**
 * Requests a viewport slice from the pre-built LOD pyramid.
 * The worker picks the best LOD for the requested pixel width automatically.
 */
export interface WaveformSliceRequest {
  type: "SLICE_VIEWPORT";
  id: string;
  mediaId: string;
  /** Start of the visible window in sample units. */
  startSample: number;
  /** End of the visible window in sample units. */
  endSample: number;
  /** Width of the target draw surface in pixels (output column count). */
  pixelWidth: number;
}

export interface WaveformSliceResult {
  type: "SLICE_RESULT";
  id: string;
  /** [TRANSFER] Peak amplitude per column (0..1). */
  peaks: Float32Array;
  /** [TRANSFER] RMS amplitude per column (0..1). */
  rms: Float32Array;
  /** Actual samples-per-pixel ratio used (from the selected LOD level). */
  samplesPerPixel: number;
}

/** Remove the pyramid for a media asset that has been removed from the project. */
export interface WaveformEvictRequest {
  type: "EVICT";
  mediaId: string;
}

export type WaveformLodWorkerRequest =
  | WaveformBuildRequest
  | WaveformSliceRequest
  | WaveformEvictRequest
  | WorkerDisposeMessage;

export type WaveformLodWorkerResponse =
  | WaveformBuildReady
  | WaveformSliceResult
  | WorkerErrorResponse;

// ─── Domain 3: Keyframe Curve Evaluation Engine ───────────────────────────────
//
// Worker file:  src/workers/keyframeEval.worker.ts
// Client file:  src/core/workers/keyframeEvalWorkerClient.ts

/**
 * Animated visual properties that the keyframe evaluator resolves.
 * Must stay in sync with the `VisualPropertyKeyframe` property names in
 * src/types/index.ts.
 */
export type AnimatedVisualProperty =
  | "x"
  | "y"
  | "width"
  | "height"
  | "rotation"
  | "opacity";

/**
 * Integer index used in the packed Float32Array result to identify which
 * property a value belongs to. Matches the order of AnimatedVisualProperty.
 */
export const VISUAL_PROP_INDEX: Record<AnimatedVisualProperty, number> = {
  x: 0,
  y: 1,
  width: 2,
  height: 3,
  rotation: 4,
  opacity: 5,
} as const;

/** Volume property index (packed alongside visual props in the result buffer). */
export const VOLUME_PROP_INDEX = 6;

/** A stripped-down keyframe descriptor safe to structured-clone into a worker. */
export interface SerializedVisualKeyframe {
  property: AnimatedVisualProperty;
  time: number; // seconds from clip start
  value: number;
  /** Bezier control points for easing: [x1, y1, x2, y2] or undefined for linear. */
  easing?: [number, number, number, number];
}

export interface SerializedVolumeKeyframe {
  time: number; // seconds from clip start
  gain: number; // 0..1 (matches AudioKeyframe.gain in src/types/audio.ts)
  easing?: "linear" | "ease-in" | "ease-out" | "ease-in-out";
}

/** Minimal clip shape passed to the keyframe eval worker. No DOM or store refs. */
export interface SerializedKeyframeClip {
  clipId: string;
  startTime: number;
  duration: number;
  visualKeyframes?: SerializedVisualKeyframe[];
  volumeKeyframes?: SerializedVolumeKeyframe[];
}

export interface KeyframeEvalRequest {
  type: "EVALUATE";
  id: string;
  /** Timeline presentation time in seconds. */
  time: number;
  frameRate: number;
  /** [CLONE] Plain serializable clip data — no DOM refs allowed. */
  clips: SerializedKeyframeClip[];
}

export interface KeyframeEvalResult {
  type: "EVAL_RESULT";
  id: string;
  /**
   * [TRANSFER] Packed result buffer.
   * Layout: triplets of [clipIndex: f32, propIndex: f32, value: f32]
   * clipIndex is the index into the original `clips` array.
   * propIndex maps to VISUAL_PROP_INDEX or VOLUME_PROP_INDEX.
   * Length = (number of resolved keyframe values) × 3.
   */
  results: Float32Array;
  evalMs: number;
}

export type KeyframeEvalWorkerRequest =
  | KeyframeEvalRequest
  | WorkerDisposeMessage;
export type KeyframeEvalWorkerResponse =
  | KeyframeEvalResult
  | WorkerErrorResponse;

// ─── Domain 4: Timeline Snapping, Ripple Math & Collision Detection ───────────
//
// Worker file:  src/workers/timelineSnap.worker.ts
// Client file:  src/core/workers/timelineSnapWorkerClient.ts

/** Minimal clip shape for interval-tree construction. */
export interface SnapClip {
  clipId: string;
  trackId: string;
  startTime: number;
  duration: number;
  locked: boolean;
}

export interface SnapMarker {
  markerId: string;
  time: number;
}

/**
 * Synchronises the worker's internal interval tree whenever the timeline
 * epoch changes. Send this after every `timelineStore.epoch` increment
 * (debounced ~16 ms to avoid thrashing on multi-clip operations).
 */
export interface SnapSyncMessage {
  type: "SYNC_STATE";
  /** [CLONE] Full clip list for interval tree rebuild. */
  clips: SnapClip[];
  markers: SnapMarker[];
}

export interface SnapQueryMessage {
  type: "SNAP_QUERY";
  id: string;
  draggedClipId: string;
  /** Proposed clip start time in seconds (where the user dropped it). */
  proposedStartTime: number;
  trackId: string;
  snapEnabled: boolean;
  /** Maximum distance in seconds within which a snap target is considered. */
  snapRadiusSeconds: number;
  playheadTime: number;
}

export interface RippleComputeMessage {
  type: "RIPPLE_COMPUTE";
  id: string;
  /** The clip being trimmed or moved — all clips after it ripple. */
  anchorClipId: string;
  side: "left" | "right";
  deltaSeconds: number;
  /** Track IDs that are locked and must not be rippled. */
  lockedTrackIds: string[];
}

export type SnapGuideType = "clip-start" | "clip-end" | "playhead" | "marker";

export interface SnapResult {
  type: "SNAP_RESULT";
  id: string;
  /** Final snapped position (may equal proposedStartTime if no snap target found). */
  snappedTime: number;
  /** Visual alignment indicators to render on the timeline ruler. */
  snapGuides: Array<{ time: number; guideType: SnapGuideType }>;
  /** Clip IDs that would overlap at snappedTime (for collision highlight). */
  collidingClipIds: string[];
}

export interface RippleResult {
  type: "RIPPLE_RESULT";
  id: string;
  /** Per-clip time deltas to apply via timelineStore.withBatch(). */
  clipDeltas: Array<{ clipId: string; deltaSeconds: number }>;
}

export type TimelineSnapWorkerRequest =
  | SnapSyncMessage
  | SnapQueryMessage
  | RippleComputeMessage
  | WorkerDisposeMessage;

export type TimelineSnapWorkerResponse =
  | SnapResult
  | RippleResult
  | WorkerErrorResponse;

// ─── Domain 5: Project History, Diffing & Auto-Save Serialization ─────────────
//
// Worker file:  src/workers/projectWorker.worker.ts
// Client file:  src/core/workers/projectWorkerClient.ts

/**
 * JSON Patch operation (RFC 6902).
 * Used by the history store to build compact undo/redo patches.
 */
export interface JsonPatchOperation {
  op: "add" | "remove" | "replace" | "move" | "copy" | "test";
  path: string;
  value?: unknown;
  from?: string;
}

/**
 * The project state shape that the worker receives for serialization and
 * diffing. Must contain only structured-clone-safe values (no DOM refs,
 * no functions, no class instances).
 *
 * Mirrors the shape of the object assembled by projectStore before calling
 * platform.saveProject().
 */
export interface SerializableProjectState {
  version: number;
  project: Record<string, unknown>;
  tracks: unknown[];
  clips: unknown[];
  gaps: unknown[];
  transitions: unknown[];
  markers: unknown[];
  captionTracks: unknown[];
  mediaAssets: unknown[];
}

export interface SerializeRequest {
  type: "SERIALIZE";
  id: string;
  /** [CLONE] Plain project state — no DOM refs. */
  state: SerializableProjectState;
}

export interface DiffRequest {
  type: "DIFF";
  id: string;
  previous: SerializableProjectState;
  next: SerializableProjectState;
}

export interface WriteOpfsRequest {
  type: "WRITE_OPFS";
  id: string;
  /** Filename within the Origin Private File System (no directory separators). */
  filename: string;
  json: string;
}

export interface SerializedResult {
  type: "SERIALIZED";
  id: string;
  json: string;
  serializeMs: number;
}

export interface PatchResult {
  type: "PATCH_READY";
  id: string;
  patch: JsonPatchOperation[];
  diffMs: number;
}

export interface WriteComplete {
  type: "WRITE_COMPLETE";
  id: string;
}

export type ProjectWorkerRequest =
  | SerializeRequest
  | DiffRequest
  | WriteOpfsRequest
  | WorkerDisposeMessage;

export type ProjectWorkerResponse =
  | SerializedResult
  | PatchResult
  | WriteComplete
  | WorkerErrorResponse;

// ─── Domain 6: Subtitle & Timed-Text Parsing / Layout ────────────────────────
//
// Worker file:  src/workers/subtitleParser.worker.ts
// Client file:  src/core/workers/subtitleParserWorkerClient.ts

export type SubtitleFormat = "ass" | "vtt" | "srt" | "whisper";

/**
 * A single Whisper word-level segment as returned by generate_auto_captions /
 * transcribe_audio_local (src-tauri/src/commands/whisper.rs).
 */
export interface WhisperWordSegment {
  word: string;
  startTime: number; // seconds
  endTime: number; // seconds
  probability: number;
}

/**
 * A single caption cue before layout computation.
 * Mirrors the CaptionCue shape in src/types/captions.ts.
 */
export interface ParsedCaptionCue {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
  /** Word-level timing for karaoke / word-highlight effects. */
  words?: Array<{ word: string; startTime: number; endTime: number }>;
  /** Per-cue style overrides (e.g. from ASS \an tags). */
  styleOverrides?: Record<string, unknown>;
}

/**
 * A caption cue after bounding-box layout has been computed.
 * Ready to hand directly to the text-rendering engine.
 */
export interface LayoutedCaptionCue extends ParsedCaptionCue {
  boundingBox: { x: number; y: number; width: number; height: number };
  wordBoxes?: Array<{
    word: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
}

export interface ParseSubtitlesRequest {
  type: "PARSE_SUBTITLES";
  id: string;
  format: SubtitleFormat;
  /** Raw file content for file-based formats (ass / vtt / srt). */
  rawText?: string;
  /** Word-level segments for Whisper transcription output. */
  whisperSegments?: WhisperWordSegment[];
}

/**
 * Compute bounding boxes and word-wrapping for already-parsed cues.
 * Requires OffscreenCanvas.measureText for font metrics.
 */
export interface LayoutCuesRequest {
  type: "LAYOUT_CUES";
  id: string;
  cues: ParsedCaptionCue[];
  fontFamily: string;
  fontSize: number;
  canvasWidth: number;
  canvasHeight: number;
  /** Max line width as a fraction of canvasWidth (0..1). Default: 0.85. */
  maxLineWidthRatio?: number;
}

export interface ParseResult {
  type: "PARSE_RESULT";
  id: string;
  cues: ParsedCaptionCue[];
  /** Total duration inferred from the last cue's endTime (seconds). */
  durationSeconds: number;
  parseMs: number;
}

export interface LayoutResult {
  type: "LAYOUT_RESULT";
  id: string;
  cues: LayoutedCaptionCue[];
  layoutMs: number;
}

export type SubtitleParserWorkerRequest =
  | ParseSubtitlesRequest
  | LayoutCuesRequest
  | WorkerDisposeMessage;

export type SubtitleParserWorkerResponse =
  | ParseResult
  | LayoutResult
  | WorkerErrorResponse;

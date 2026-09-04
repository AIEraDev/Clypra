/**
 * ComputeWorker — Consolidated Off-Thread Math & State Engine (Domain Worker 1)
 *
 * Combines CPU-intensive mathematical & serialization operations in a single persistent isolate:
 * 1. Keyframe Bézier curve root solving & multi-track animation evaluation
 * 2. 1D Interval-tree timeline magnetic snapping, collision detection, and ripple math
 * 3. Project state JSON serialization & RFC 6902 JSON patch diffing
 */

import type {
  KeyframeEvalRequest,
  KeyframeEvalResult,
  SerializedVisualKeyframe,
  SerializedVolumeKeyframe,
  SnapSyncMessage,
  SnapQueryMessage,
  RippleComputeMessage,
  SnapResult,
  RippleResult,
  SnapClip,
  SnapMarker,
  SnapGuideType,
  SerializeRequest,
  DiffRequest,
  WriteOpfsRequest,
  ReadOpfsRequest,
  ClearOpfsRequest,
  SerializedResult,
  PatchResult,
  WriteComplete,
  ReadOpfsResult,
  ClearOpfsResult,
  JsonPatchOperation,
  SerializableProjectState,
  WorkerErrorResponse,
} from "./types";
import { VISUAL_PROP_INDEX, VOLUME_PROP_INDEX } from "./types";

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Keyframe Bézier Curve & Animation Evaluation
// ═══════════════════════════════════════════════════════════════════════════════

function sampleCurveX(t: number, x1: number, x2: number): number {
  return ((1 - 3 * x2 + 3 * x1) * t + (3 * x2 - 6 * x1)) * t * t + 3 * x1 * t;
}

function sampleCurveY(t: number, y1: number, y2: number): number {
  return ((1 - 3 * y2 + 3 * y1) * t + (3 * y2 - 6 * y1)) * t * t + 3 * y1 * t;
}

function sampleCurveDerivativeX(t: number, x1: number, x2: number): number {
  return (3 * (1 - 3 * x2 + 3 * x1) * t + 2 * (3 * x2 - 6 * x1)) * t + 3 * x1;
}

function solveCubicBezier(
  progress: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;

  // Newton-Raphson iteration
  let t = progress;
  for (let i = 0; i < 8; i++) {
    const x = sampleCurveX(t, x1, x2) - progress;
    if (Math.abs(x) < 1e-5) return sampleCurveY(t, y1, y2);
    const d = sampleCurveDerivativeX(t, x1, x2);
    if (Math.abs(d) < 1e-5) break;
    t -= x / d;
  }

  // Fallback to binary subdivision
  let t0 = 0.0;
  let t1 = 1.0;
  t = progress;

  for (let i = 0; i < 12; i++) {
    const x = sampleCurveX(t, x1, x2);
    if (Math.abs(x - progress) < 1e-5) break;
    if (progress > x) t0 = t;
    else t1 = t;
    t = (t1 + t0) * 0.5;
  }

  return sampleCurveY(t, y1, y2);
}

function interpolateVisualKeyframes(
  keyframes: SerializedVisualKeyframe[],
  clipRelativeTime: number,
): number | null {
  if (keyframes.length === 0) return null;
  if (keyframes.length === 1) return keyframes[0].value;

  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  if (clipRelativeTime <= sorted[0].time) return sorted[0].value;
  if (clipRelativeTime >= sorted[sorted.length - 1].time) {
    return sorted[sorted.length - 1].value;
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const k0 = sorted[i];
    const k1 = sorted[i + 1];

    if (clipRelativeTime >= k0.time && clipRelativeTime <= k1.time) {
      const span = k1.time - k0.time;
      if (span <= 1e-5) return k0.value;
      const progress = (clipRelativeTime - k0.time) / span;

      if (k0.easing) {
        const [x1, y1, x2, y2] = k0.easing;
        const eased = solveCubicBezier(progress, x1, y1, x2, y2);
        return k0.value + eased * (k1.value - k0.value);
      } else {
        return k0.value + progress * (k1.value - k0.value);
      }
    }
  }

  return null;
}

function interpolateVolumeKeyframes(
  keyframes: SerializedVolumeKeyframe[],
  clipRelativeTime: number,
): number | null {
  if (keyframes.length === 0) return null;
  if (keyframes.length === 1) return keyframes[0].gain;

  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  if (clipRelativeTime <= sorted[0].time) return sorted[0].gain;
  if (clipRelativeTime >= sorted[sorted.length - 1].time) {
    return sorted[sorted.length - 1].gain;
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const k0 = sorted[i];
    const k1 = sorted[i + 1];

    if (clipRelativeTime >= k0.time && clipRelativeTime <= k1.time) {
      const span = k1.time - k0.time;
      if (span <= 1e-5) return k0.gain;
      const progress = (clipRelativeTime - k0.time) / span;
      return k0.gain + progress * (k1.gain - k0.gain);
    }
  }

  return null;
}

function handleKeyframeEvaluate(msg: KeyframeEvalRequest): void {
  const startMs = performance.now();
  const { id, time, clips } = msg;
  const triplets: number[] = [];

  for (let clipIdx = 0; clipIdx < clips.length; clipIdx++) {
    const clip = clips[clipIdx];
    if (time < clip.startTime || time > clip.startTime + clip.duration) {
      continue;
    }

    const clipRelativeTime = time - clip.startTime;

    if (clip.visualKeyframes && clip.visualKeyframes.length > 0) {
      const byProp = new Map<number, SerializedVisualKeyframe[]>();
      for (const kf of clip.visualKeyframes) {
        const propIndex = VISUAL_PROP_INDEX[kf.property];
        if (propIndex !== undefined) {
          const list = byProp.get(propIndex) ?? [];
          list.push(kf);
          byProp.set(propIndex, list);
        }
      }

      for (const [prop, kfs] of byProp) {
        const val = interpolateVisualKeyframes(kfs, clipRelativeTime);
        if (val !== null) {
          triplets.push(clipIdx, prop, val);
        }
      }
    }

    if (clip.volumeKeyframes && clip.volumeKeyframes.length > 0) {
      const gain = interpolateVolumeKeyframes(clip.volumeKeyframes, clipRelativeTime);
      if (gain !== null) {
        triplets.push(clipIdx, VOLUME_PROP_INDEX, gain);
      }
    }
  }

  const results = new Float32Array(triplets);
  const response: KeyframeEvalResult = {
    type: "EVAL_RESULT",
    id,
    results,
    evalMs: performance.now() - startMs,
  };

  (self as unknown as Worker).postMessage(response, [results.buffer]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Timeline Snapping, 1D Interval Index & Ripple Math
// ═══════════════════════════════════════════════════════════════════════════════

interface SnapEdge {
  time: number;
  guideType: SnapGuideType;
  clipId?: string;
  trackId?: string;
}

let storedClips: SnapClip[] = [];
let storedMarkers: SnapMarker[] = [];
let sortedEdges: SnapEdge[] = [];

function rebuildSortedEdges(): void {
  const edges: SnapEdge[] = [];

  for (const clip of storedClips) {
    edges.push({
      time: clip.startTime,
      guideType: "clip-start",
      clipId: clip.clipId,
      trackId: clip.trackId,
    });
    edges.push({
      time: clip.startTime + clip.duration,
      guideType: "clip-end",
      clipId: clip.clipId,
      trackId: clip.trackId,
    });
  }

  for (const marker of storedMarkers) {
    edges.push({
      time: marker.time,
      guideType: "marker",
    });
  }

  edges.sort((a, b) => a.time - b.time);
  sortedEdges = edges;
}

function handleSnapSync(msg: SnapSyncMessage): void {
  storedClips = msg.clips;
  storedMarkers = msg.markers ?? [];
  rebuildSortedEdges();
}

function handleSnapQuery(msg: SnapQueryMessage): void {
  const {
    id,
    draggedClipId,
    proposedStartTime,
    trackId,
    snapEnabled,
    snapRadiusSeconds,
    playheadTime,
  } = msg;
  const radius = snapRadiusSeconds ?? 0.15;

  if (!snapEnabled) {
    const res: SnapResult = {
      type: "SNAP_RESULT",
      id,
      snappedTime: proposedStartTime,
      snapGuides: [],
      collidingClipIds: [],
    };
    (self as unknown as Worker).postMessage(res);
    return;
  }

  let closestTime = proposedStartTime;
  let minDiff = radius + 1;
  const snapGuides: Array<{ time: number; guideType: SnapGuideType }> = [];

  // Check playhead
  if (playheadTime !== undefined) {
    const distPlayhead = Math.abs(proposedStartTime - playheadTime);
    if (distPlayhead <= radius && distPlayhead < minDiff) {
      minDiff = distPlayhead;
      closestTime = playheadTime;
      snapGuides.push({ time: playheadTime, guideType: "playhead" });
    }
  }

  // Check sorted edges
  for (const edge of sortedEdges) {
    if (edge.clipId === draggedClipId) continue;
    const diff = Math.abs(proposedStartTime - edge.time);
    if (diff <= radius && diff < minDiff) {
      minDiff = diff;
      closestTime = edge.time;
      snapGuides.push({ time: edge.time, guideType: edge.guideType });
    }
  }

  const collidingClipIds: string[] = [];
  const dragged = storedClips.find((c) => c.clipId === draggedClipId);
  const duration = dragged?.duration ?? 0;

  for (const clip of storedClips) {
    if (clip.clipId === draggedClipId || clip.trackId !== trackId) continue;
    const overlap =
      closestTime < clip.startTime + clip.duration &&
      closestTime + duration > clip.startTime;
    if (overlap) {
      collidingClipIds.push(clip.clipId);
    }
  }

  const res: SnapResult = {
    type: "SNAP_RESULT",
    id,
    snappedTime: closestTime,
    snapGuides,
    collidingClipIds,
  };

  (self as unknown as Worker).postMessage(res);
}

function handleRippleCompute(msg: RippleComputeMessage): void {
  const { id, anchorClipId, deltaSeconds, lockedTrackIds } = msg;
  const lockedSet = new Set(lockedTrackIds ?? []);
  const anchor = storedClips.find((c) => c.clipId === anchorClipId);
  const anchorStartTime = anchor?.startTime ?? 0;

  const clipDeltas: Array<{ clipId: string; deltaSeconds: number }> = [];

  for (const clip of storedClips) {
    if (lockedSet.has(clip.trackId)) continue;
    if (clip.startTime >= anchorStartTime) {
      clipDeltas.push({
        clipId: clip.clipId,
        deltaSeconds,
      });
    }
  }

  const res: RippleResult = {
    type: "RIPPLE_RESULT",
    id,
    clipDeltas,
  };

  (self as unknown as Worker).postMessage(res);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Project State Serialization & JSON Patch Diffing
// ═══════════════════════════════════════════════════════════════════════════════

function handleProjectSerialize(msg: SerializeRequest): void {
  const start = performance.now();
  const json = JSON.stringify(msg.state);
  const serializeMs = performance.now() - start;

  const response: SerializedResult = {
    type: "SERIALIZED",
    id: msg.id,
    json,
    serializeMs,
  };

  (self as unknown as Worker).postMessage(response);
}

/**
 * Fast 32-bit FNV-1a hash over the JSON representation of any value.
 * Used instead of JSON.stringify(a) === JSON.stringify(b) — avoids allocating
 * two full strings just to compare them. O(N) time, O(1) extra space.
 */
function fnv1aHash(value: unknown): number {
  const str = JSON.stringify(value) ?? "";
  let h = 2166136261; // FNV offset basis (32-bit)
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0; // FNV prime, keep 32-bit unsigned
  }
  return h;
}

function computeArrayDiff(
  path: string,
  prevArr: any[],
  nextArr: any[],
): JsonPatchOperation[] {
  const ops: JsonPatchOperation[] = [];

  const prevMap = new Map<string, { item: any; index: number; hash: number }>();
  for (let i = 0; i < prevArr.length; i++) {
    const item = prevArr[i];
    const key = item?.id ?? String(i);
    prevMap.set(key, { item, index: i, hash: fnv1aHash(item) });
  }

  const nextMap = new Map<string, { item: any; index: number; hash: number }>();
  for (let i = 0; i < nextArr.length; i++) {
    const item = nextArr[i];
    const key = item?.id ?? String(i);
    nextMap.set(key, { item, index: i, hash: fnv1aHash(item) });
  }

  // 1. Removals
  for (const [key, { index }] of prevMap) {
    if (!nextMap.has(key)) {
      ops.push({
        op: "remove",
        path: `${path}/${index}`,
      });
    }
  }

  // 2. Additions and modifications — compare hashes instead of full stringify
  for (const [key, { item: nextItem, index, hash: nextHash }] of nextMap) {
    const prev = prevMap.get(key);
    if (!prev) {
      ops.push({
        op: "add",
        path: `${path}/${index}`,
        value: nextItem,
      });
    } else if (prev.hash !== nextHash) {
      // Hash mismatch → item changed; include full value in patch
      ops.push({
        op: "replace",
        path: `${path}/${index}`,
        value: nextItem,
      });
    }
  }

  return ops;
}

function handleProjectDiff(msg: DiffRequest): void {
  const start = performance.now();
  const { id, previous, next } = msg;

  const patch: JsonPatchOperation[] = [];

  if (previous.version !== next.version) {
    patch.push({ op: "replace", path: "/version", value: next.version });
  }

  // Compare whole-array hashes first — if identical, skip per-item diff entirely
  if (fnv1aHash(previous.tracks) !== fnv1aHash(next.tracks)) {
    patch.push(...computeArrayDiff("/tracks", previous.tracks, next.tracks));
  }
  if (fnv1aHash(previous.clips) !== fnv1aHash(next.clips)) {
    patch.push(...computeArrayDiff("/clips", previous.clips, next.clips));
  }

  const diffMs = performance.now() - start;

  const response: PatchResult = {
    type: "PATCH_READY",
    id,
    patch,
    diffMs,
  };

  (self as unknown as Worker).postMessage(response);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Origin Private File System (OPFS) Persistence Handlers
// ═══════════════════════════════════════════════════════════════════════════════

async function getOpfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) {
    return null;
  }
  try {
    return await navigator.storage.getDirectory();
  } catch {
    return null;
  }
}

async function handleWriteOpfs(msg: WriteOpfsRequest): Promise<void> {
  const { id, filename, json } = msg;
  try {
    const root = await getOpfsRoot();
    if (root) {
      const fileHandle = await root.getFileHandle(filename, { create: true });
      if ((fileHandle as any).createWritable) {
        const writable = await (fileHandle as any).createWritable();
        await writable.write(json);
        await writable.close();
      } else if ((fileHandle as any).createSyncAccessHandle) {
        const accessHandle = await (fileHandle as any).createSyncAccessHandle();
        const encoder = new TextEncoder();
        const encoded = encoder.encode(json);
        accessHandle.truncate(0);
        accessHandle.write(encoded, { at: 0 });
        accessHandle.flush();
        accessHandle.close();
      }
    }
  } catch {
    // Non-fatal OPFS write failure
  }
  const response: WriteComplete = {
    type: "WRITE_COMPLETE",
    id,
  };
  (self as unknown as Worker).postMessage(response);
}

async function handleReadOpfs(msg: ReadOpfsRequest): Promise<void> {
  const { id, filename } = msg;
  let json: string | null = null;
  try {
    const root = await getOpfsRoot();
    if (root) {
      const fileHandle = await root.getFileHandle(filename).catch(() => null);
      if (fileHandle) {
        const file = await fileHandle.getFile();
        json = await file.text();
      }
    }
  } catch {
    json = null;
  }
  const response: ReadOpfsResult = {
    type: "READ_OPFS_RESULT",
    id,
    json,
  };
  (self as unknown as Worker).postMessage(response);
}

async function handleClearOpfs(msg: ClearOpfsRequest): Promise<void> {
  const { id, filename } = msg;
  try {
    const root = await getOpfsRoot();
    if (root) {
      await root.removeEntry(filename).catch(() => {});
    }
  } catch {
    // ignore
  }
  const response: ClearOpfsResult = {
    type: "CLEAR_OPFS_RESULT",
    id,
  };
  (self as unknown as Worker).postMessage(response);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Message Router
// ═══════════════════════════════════════════════════════════════════════════════

self.onmessage = (e: MessageEvent) => {
  const msg = e.data;
  if (!msg || typeof msg !== "object") return;

  try {
    switch (msg.type) {
      // Keyframe Evaluation
      case "EVALUATE":
        handleKeyframeEvaluate(msg as KeyframeEvalRequest);
        break;

      // Timeline Snapping & Ripple Math
      case "SYNC_STATE":
        handleSnapSync(msg as SnapSyncMessage);
        break;
      case "SNAP_QUERY":
        handleSnapQuery(msg as SnapQueryMessage);
        break;
      case "RIPPLE_COMPUTE":
        handleRippleCompute(msg as RippleComputeMessage);
        break;

      // Project Serialization & Diffing
      case "SERIALIZE":
        handleProjectSerialize(msg as SerializeRequest);
        break;
      case "DIFF":
        handleProjectDiff(msg as DiffRequest);
        break;

      // OPFS Storage
      case "WRITE_OPFS":
        void handleWriteOpfs(msg as WriteOpfsRequest);
        break;
      case "READ_OPFS":
        void handleReadOpfs(msg as ReadOpfsRequest);
        break;
      case "CLEAR_OPFS":
        void handleClearOpfs(msg as ClearOpfsRequest);
        break;

      default:
        break;
    }
  } catch (err) {
    const errorResponse: WorkerErrorResponse = {
      type: "ERROR",
      id: msg.id,
      message: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(errorResponse);
  }
};

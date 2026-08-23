/**
 * transport.ts — Tauri IPC transport layer for the Render Engine
 *
 * Responsibilities:
 *   1. Epoch registry — tracks which epochId is active per clipId
 *   2. RGBA → ImageBitmap conversion (SAB fast-path or copy-path)
 *   3. requestRenderArtifacts — single timestamp, epoch-gated delivery
 *   4. requestBatchArtifacts  — concurrent multi-timestamp, epoch-gated
 *   5. requestProgressiveTiers — L0 fast-paint → target tier upgrade sequence
 *
 * All artifact delivery is silently dropped when the epoch has become stale.
 */

import { invoke, Channel } from "@tauri-apps/api/core";
import { SpatialTier, SPATIAL_TIER_DIMS } from "./types";
import type { RenderEpochId } from "./types";
import { generateId } from "@/lib/utils/id";
import { isTauriRuntime, renderNativeFrame } from "@/lib/platform/tauri";
import {
  DEFAULT_NATIVE_COLOR_POLICY,
  frameIndexToNativeTime,
  secondsToNativeTime,
  NATIVE_CORE_CONTRACT_VERSION,
} from "@/lib/platform/nativeCore";

// ─── SAB Detection ────────────────────────────────────────────────────────────

/**
 * True when SharedArrayBuffer is available and cross-origin-isolated.
 * Evaluated once at module load so it's toggleable via vi.stubGlobal in tests.
 */
export const SAB_SUPPORTED: boolean = (() => {
  try {
    return typeof crossOriginIsolated !== "undefined" && crossOriginIsolated === true && typeof SharedArrayBuffer !== "undefined";
  } catch {
    return false;
  }
})();

// ─── Spatial Tier Label Conversion ────────────────────────────────────────────

/**
 * Convert SpatialTier enum to Rust-compatible string label.
 * L0 → "l0", L1 → "l1", L2 → "l2", L3 → "l3"
 */
function spatialTierToLabel(tier: SpatialTier): string {
  return `l${tier}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Backend RenderArtifact - raw RGBA data from Rust.
 *
 * This is the BACKEND representation received from Tauri commands.
 * Must be converted to frontend RenderArtifact (with ImageBitmap) before use.
 *
 * Conversion: rgbaToImageBitmap() creates ImageBitmap from rgba_data.
 *
 * CRITICAL: Field names are snake_case to match Rust serde serialization.
 * See: src-tauri/src/thumbnail_engine/pyramid.rs RenderArtifact struct
 */
export interface BackendRenderArtifact {
  frame_id: string;
  content_hash: string;
  spatial_tier: SpatialTier;
  /** RGBA bytes — length must equal width * height * 4 */
  rgba_data: number[] | Uint8ClampedArray;
  width: number;
  height: number;
  timestamp_ms: number;
  /** Optional: present when epoch is embedded in the response */
  epoch_id?: string;
  source?: string;
}

/**
 * Frontend-ready artifact: RGBA decoded into an ImageBitmap,
 * stamped with the requesting epoch for downstream validation.
 */
export interface TransportArtifact {
  frameId: string;
  contentHash: string;
  spatialTier: SpatialTier;
  bitmap: ImageBitmap;
  width: number;
  height: number;
  timestampMs: number;
  epochId: RenderEpochId;
  // Optional source identifier for debugging / test assertions
  source?: string;
}

/** Check if a TransportArtifact has a valid non-empty bitmap. */
export function isValidArtifact(artifact: TransportArtifact | null | undefined): boolean {
  if (!artifact) return false;
  if (!artifact.bitmap) return false;
  if (typeof artifact.bitmap.width !== "number" || typeof artifact.bitmap.height !== "number") return false;
  return artifact.bitmap.width > 0 && artifact.bitmap.height > 0;
}

// ─── Epoch Registry ───────────────────────────────────────────────────────────

/**
 * Maps clipId → currently active epochId.
 * Used to gate artifact delivery: any artifact arriving after the epoch has
 * changed is silently dropped.
 */
// Export type for tests

const _activeEpochs = new Map<string, RenderEpochId>();

/** Register (or replace) the active epoch for a clip. */
export function registerActiveEpoch(clipId: string, epochId: RenderEpochId): void {
  const prev = _activeEpochs.get(clipId);
  _activeEpochs.set(clipId, epochId);
}

/** Unregister the active epoch when a clip is unmounted. */
export function unregisterActiveEpoch(clipId: string): void {
  _activeEpochs.delete(clipId);
}

/**
 * Returns true if the given epochId is still the active epoch.
 * When clipId is provided, validates strictly for that clip (prevents cross-clip stale artifacts).
 * Without clipId, checks if ANY clip holds this epoch (backward compat).
 */
export function isEpochStillValid(epochId: RenderEpochId, clipId?: string): boolean {
  if (clipId) {
    return _activeEpochs.get(clipId) === epochId;
  }
  for (const active of _activeEpochs.values()) {
    if (active === epochId) return true;
  }
  return false;
}

// ─── RGBA → ImageBitmap ───────────────────────────────────────────────────────

/**
 * Convert raw RGBA bytes to an ImageBitmap.
 *
 * Copies into ImageData and uses createImageBitmap.
 */
async function rgbaToImageBitmap(
  rgba: number[] | Uint8ClampedArray | ArrayBuffer,
  width: number,
  height: number,
  _tileKey?: string,
): Promise<ImageBitmap> {
  const clamped = rgba instanceof ArrayBuffer ? new Uint8ClampedArray(rgba) : new Uint8ClampedArray(rgba.length);
  if (!(rgba instanceof ArrayBuffer)) clamped.set(rgba);

  const imageData = new ImageData(clamped, width, height);
  return createImageBitmap(imageData);
}

// ─── requestRenderArtifacts ───────────────────────────────────────────────────

export interface RequestRenderArtifactsOptions {
  videoPath: string;
  timestampMs: number;
  spatialTiers: SpatialTier[];
  epochId: RenderEpochId;
  clipId: string;
  onArtifact: (artifact: TransportArtifact) => void;
  onComplete?: () => void;
  onError?: (err: unknown) => void;
}

export interface RequestNativeFilmstripArtifactsOptions {
  videoPath: string;
  timestampsMs: number[];
  spatialTier: SpatialTier;
  epochId: RenderEpochId;
  clipId: string;
  onArtifact: (artifact: TransportArtifact) => void;
  onComplete?: () => void;
  onError?: (err: unknown) => void;
  concurrency?: number;
}

/**
 * Native-core filmstrip transport. Filmstrip tiles use the same versioned
 * FrameRequest and native decode/color path as paused program frames. The
 * existing epoch/cache ownership remains in FilmstripCache; this function is
 * only an IPC adapter and never owns a bitmap after delivery.
 */
export function requestNativeFilmstripArtifacts(opts: RequestNativeFilmstripArtifactsOptions): () => void {
  const { videoPath, timestampsMs, spatialTier, epochId, clipId, onArtifact, onComplete, onError, concurrency = 3 } = opts;
  const [width, height] = SPATIAL_TIER_DIMS[spatialTier];
  let cancelled = false;
  let nextIndex = 0;
  let active = 0;
  let completed = 0;
  const total = timestampsMs.length;

  const cancel = () => {
    cancelled = true;
  };

  if (total === 0) {
    onComplete?.();
    return cancel;
  }

  const dispatch = () => {
    while (!cancelled && active < Math.max(1, concurrency) && nextIndex < total) {
      const timestampMs = Math.max(0, Math.round(timestampsMs[nextIndex++]));
      active++;
      const seconds = timestampMs / 1000;
      const frameIndex = Math.max(0, Math.round(seconds * 30));
      const projectRevision = `${clipId}:${epochId}`;
      const request = {
        contractVersion: NATIVE_CORE_CONTRACT_VERSION,
        requestId: `filmstrip:${projectRevision}:${timestampMs}:${spatialTier}`,
        frameTime: frameIndexToNativeTime(frameIndex, 30),
        project: {
          schemaVersion: 1,
          projectRevision,
          canvasWidth: width,
          canvasHeight: height,
          clearColor: [0, 0, 0, 1] as [number, number, number, number],
          videoLayers: [{
            assetId: clipId,
            videoPath,
            sourceTime: secondsToNativeTime(seconds, frameIndex),
            x: 0,
            y: 0,
            width,
            height,
            rotation: 0,
            opacity: 1,
            zIndex: 0,
            blendMode: "normal",
          }],
        },
        outputWidth: width,
        outputHeight: height,
        quality: "full" as const,
        colorPolicy: DEFAULT_NATIVE_COLOR_POLICY,
        renderGraphVersion: 1,
      };

      const tileStart = performance.now();
      renderNativeFrame(request)
        .then(async (rgba) => {
          const decodeMs = performance.now() - tileStart;
          if (cancelled || !isEpochStillValid(epochId, clipId)) return;
          const bitmap = await rgbaToImageBitmap(rgba, width, height, `${clipId}:${timestampMs}`);
          if (cancelled || !isEpochStillValid(epochId, clipId)) {
            bitmap.close();
            return;
          }
          onArtifact({
            frameId: request.requestId,
            contentHash: request.requestId,
            spatialTier,
            bitmap,
            width,
            height,
            timestampMs,
            epochId,
            source: "native-core",
          });
        })
        .catch((error) => {
          console.error(`[Transport ❌] Failed to decode tile at ${(timestampMs / 1000).toFixed(2)}s for clip "${clipId}":`, error);
          if (!cancelled) onError?.(error);
        })
        .finally(() => {
          active--;
          completed++;
          if (completed >= total) {
            if (!cancelled) onComplete?.();
          } else {
            dispatch();
          }
        });
    }
  };

  dispatch();
  return cancel;
}

/**
 * Runtime adapter for the migration boundary. Desktop Tauri is native-core
 * authoritative; frozen web/mobile adapters retain their existing transport
 * until those runtimes are intentionally revisited.
 */
export function requestFilmstripArtifacts(opts: RequestNativeFilmstripArtifactsOptions): () => void {
  if (isTauriRuntime()) return requestNativeFilmstripArtifacts(opts);
  return requestProgressiveTiers({
    videoPath: opts.videoPath,
    timestampsMs: opts.timestampsMs,
    startTier: SpatialTier.L0,
    targetTier: opts.spatialTier,
    epochId: opts.epochId,
    clipId: opts.clipId,
    onArtifact: opts.onArtifact,
    onComplete: opts.onComplete,
    onError: opts.onError,
    concurrency: opts.concurrency,
  });
}

/**
 * Request render artifacts for a single timestamp from the Rust backend.
 * Returns a cancel() function — calling it prevents any further delivery
 * from this request even if artifacts are already in-flight.
 */
export function requestRenderArtifacts(opts: RequestRenderArtifactsOptions): () => void {
  const { videoPath, timestampMs, spatialTiers, epochId, clipId, onArtifact, onComplete, onError } = opts;

  let cancelled = false;
  const cancel = () => {
    cancelled = true;
  };

  const channel = new Channel<BackendRenderArtifact>();
  channel.onmessage = async (raw) => {
    if (cancelled) return;
    if (!isEpochStillValid(epochId, clipId)) return;

    try {
      // Generate tile key for worker identification
      const tileKey = `${clipId}:${raw.spatial_tier}:${timestampMs}`;
      const bitmap = await rgbaToImageBitmap(raw.rgba_data, raw.width, raw.height, tileKey);
      if (cancelled || !isEpochStillValid(epochId, clipId)) {
        bitmap.close();
        return;
      }
      onArtifact({
        frameId: raw.frame_id,
        contentHash: raw.content_hash,
        spatialTier: raw.spatial_tier,
        bitmap,
        width: raw.width,
        height: raw.height,
        timestampMs: Math.round(timestampMs),
        epochId,
      });
    } catch (err) {
      onError?.(err);
    }
  };

  invoke("get_render_artifact", {
    videoPath,
    timestampMs: Math.round(timestampMs),
    spatialTiers: spatialTiers.map(spatialTierToLabel),
    effectGraphVersion: 0,
    onArtifact: channel,
  })
    .then(() => {
      if (!cancelled) onComplete?.();
    })
    .catch((err) => {
      if (!cancelled) onError?.(err);
    });

  return cancel;
}

// ─── checkCoarseBaselineCache ──────────────────────────────────────────────────

export interface CheckCoarseBaselineCacheOptions {
  videoPath: string;
  timestampsMs: number[];
  spatialTier: SpatialTier;
  onArtifact: (artifact: TransportArtifact) => void;
  onComplete?: () => void;
  onError?: (err: unknown) => void;
}

/**
 * Check which coarse baseline timestamps are already cached in Rust (TIER_CACHE or on-disk atlases).
 * Delivers warm artifacts instantly over the channel without triggering any FFmpeg decoding.
 */
export function checkCoarseBaselineCache(opts: CheckCoarseBaselineCacheOptions): () => void {
  const { videoPath, timestampsMs, spatialTier, onArtifact, onComplete, onError } = opts;
  let cancelled = false;
  const cancel = () => {
    cancelled = true;
  };

  if (!isTauriRuntime()) {
    onComplete?.();
    return cancel;
  }

  const channel = new Channel<BackendRenderArtifact>();
  channel.onmessage = async (raw) => {
    if (cancelled) return;
    try {
      const tileKey = `${videoPath}:${raw.spatial_tier}:${raw.timestamp_ms}`;
      const bitmap = await rgbaToImageBitmap(raw.rgba_data, raw.width, raw.height, tileKey);
      if (cancelled) {
        bitmap.close();
        return;
      }
      onArtifact({
        frameId: raw.frame_id,
        contentHash: raw.content_hash,
        spatialTier: raw.spatial_tier,
        bitmap,
        width: raw.width,
        height: raw.height,
        timestampMs: Math.round(raw.timestamp_ms),
        epochId: "epoch-preload" as RenderEpochId,
        source: "disk_cache",
      });
    } catch (err) {
      onError?.(err);
    }
  };

  invoke("check_coarse_baseline_cache", {
    videoPath,
    timestampsMs: timestampsMs.map((t) => Math.round(t)),
    spatialTier: spatialTierToLabel(spatialTier),
    effectGraphVersion: 1,
    onArtifact: channel,
  })
    .then(() => {
      if (!cancelled) onComplete?.();
    })
    .catch((err) => {
      if (!cancelled) onError?.(err);
    });

  return cancel;
}

// ─── requestBatchArtifacts ────────────────────────────────────────────────────

export interface RequestBatchArtifactsOptions {
  videoPath: string;
  timestampsMs: number[];
  spatialTiers: SpatialTier[];
  epochId: RenderEpochId;
  clipId: string;
  onArtifact: (artifact: TransportArtifact) => void;
  onComplete?: () => void;
  onError?: (err: unknown) => void;
  /** Max concurrent invoke calls. Default: 4 */
  concurrency?: number;
}

/**
 * Request artifacts for multiple timestamps concurrently, with a concurrency cap.
 * Returns a cancel() that stops all in-flight requests.
 */
export function requestBatchArtifacts(opts: RequestBatchArtifactsOptions): () => void {
  const { videoPath, timestampsMs, spatialTiers, epochId, clipId, onArtifact, onComplete, onError, concurrency = 4 } = opts;

  if (timestampsMs.length === 0) {
    onComplete?.();
    return () => {};
  }

  let cancelled = false;
  const cancels: Array<() => void> = [];
  const cancel = () => {
    cancelled = true;
    cancels.forEach((fn) => fn());
  };

  let completed = 0;
  const total = timestampsMs.length;

  const handleComplete = () => {
    completed++;
    if (completed >= total && !cancelled) {
      onComplete?.();
    }
  };

  // Dispatch with concurrency window using a simple queue
  const queue = [...timestampsMs];
  let active = 0;

  const dispatch = () => {
    while (active < concurrency && queue.length > 0 && !cancelled) {
      const ts = queue.shift()!;
      active++;
      const c = requestRenderArtifacts({
        videoPath,
        timestampMs: ts,
        spatialTiers,
        epochId,
        clipId,
        onArtifact,
        onComplete: () => {
          active--;
          handleComplete();
          dispatch(); // fill the slot
        },
        onError: (err) => {
          active--;
          onError?.(err);
          handleComplete();
          dispatch();
        },
      });
      cancels.push(c);
    }
  };

  dispatch();
  return cancel;
}

// ─── requestBatchRenderArtifacts ───────────────────────────────────────────────

export interface RequestBatchRenderArtifactsOptions {
  videoPath: string;
  timestampsMs: number[];
  spatialTiers: SpatialTier[];
  epochId: RenderEpochId;
  clipId: string;
  onArtifact: (artifact: TransportArtifact) => void;
  onComplete?: () => void;
  onError?: (err: unknown) => void;
  requestId?: string; // For tracing
}

/**
 * Request artifacts for multiple timestamps in a single batch invoke.
 * Streams artifacts as they become available (cached first, then decoded).
 * Returns a cancel() that stops the entire batch request.
 */
export function requestBatchRenderArtifacts(opts: RequestBatchRenderArtifactsOptions): () => void {
  const { videoPath, timestampsMs, spatialTiers, epochId, clipId, onArtifact, onComplete, onError, requestId } = opts;

  const reqId = requestId || generateId("req");

  if (timestampsMs.length === 0) {
    onComplete?.();
    return () => {};
  }

  let cancelled = false;
  const cancel = () => {
    cancelled = true;
  };

  let artifactCount = 0;
  const channel = new Channel<BackendRenderArtifact>();
  channel.onmessage = async (raw) => {
    if (cancelled) return;
    if (!isEpochStillValid(epochId, clipId)) {
      return;
    }

    artifactCount++;

    try {
      const bitmap = await rgbaToImageBitmap(raw.rgba_data, raw.width, raw.height);
      if (cancelled || !isEpochStillValid(epochId, clipId)) {
        bitmap.close();
        return;
      }
      onArtifact({
        frameId: raw.frame_id,
        contentHash: raw.content_hash,
        spatialTier: raw.spatial_tier,
        bitmap,
        width: raw.width,
        height: raw.height,
        timestampMs: raw.timestamp_ms,
        epochId,
      });
    } catch (err) {
      onError?.(err);
    }
  };

  invoke("get_render_artifacts_batch", {
    videoPath,
    timestampsMs: timestampsMs.map(Math.round),
    spatialTiers: spatialTiers.map(spatialTierToLabel),
    effectGraphVersion: 0,
    requestId: reqId,
    onArtifact: channel,
  })
    .then(() => {
      if (!cancelled) {
        onComplete?.();
      }
    })
    .catch((err) => {
      if (!cancelled) {
        onError?.(err);
      }
    });

  return cancel;
}

// ─── requestProgressiveTiers ──────────────────────────────────────────────────

export interface RequestProgressiveTiersOptions {
  videoPath: string;
  timestampsMs: number[];
  /** First tier to request (always L0 for fast-paint). */
  startTier: SpatialTier;
  /** Final tier to converge to. */
  targetTier: SpatialTier;
  epochId: RenderEpochId;
  clipId: string;
  onArtifact: (artifact: TransportArtifact) => void;
  onComplete?: () => void;
  onError?: (err: unknown) => void;
  concurrency?: number;
  requestId?: string; // For tracing
}

// Export type for tests – alias to the request options interface
export type ProgressiveTierRequest = RequestProgressiveTiersOptions;

/**
 * Progressive tier upgrade: delivers startTier first (fast-paint), then
 * upgrades through each intermediate tier until targetTier.
 *
 * Each tier waits for the previous to complete before starting.
 * Epoch is re-validated before each tier batch begins.
 * Returns a cancel() that stops the entire sequence.
 */
export function requestProgressiveTiers(opts: RequestProgressiveTiersOptions): () => void {
  const { videoPath, timestampsMs, startTier, targetTier, epochId, clipId, onArtifact, onComplete, onError, concurrency, requestId } = opts;

  let cancelled = false;
  let currentCancel: (() => void) | null = null;

  const cancel = () => {
    cancelled = true;
    currentCancel?.();
  };

  // Build the tier sequence: startTier → ... → targetTier (inclusive)
  const tiers: SpatialTier[] = [];
  for (let t = startTier; t <= targetTier; t++) {
    tiers.push(t as SpatialTier);
  }

  const runTier = (idx: number) => {
    if (cancelled || idx >= tiers.length) {
      if (!cancelled) onComplete?.();
      return;
    }

    const tier = tiers[idx];

    // Re-validate epoch before each tier batch
    if (!isEpochStillValid(epochId, clipId)) return;

    const [width, height] = SPATIAL_TIER_DIMS[tier];

    currentCancel = requestBatchRenderArtifacts({
      videoPath,
      timestampsMs,
      spatialTiers: [tier],
      epochId,
      clipId,
      onArtifact,
      onComplete: () => {
        if (!cancelled) runTier(idx + 1);
      },
      onError,
      requestId,
    });

    // Suppress unused variable warning — width/height used by Rust side via spatialTiers
    void width;
    void height;
  };

  runTier(0);
  return cancel;
}

// ─── Batch Coalescing Scheduler ─────────────────────────────────────────────────

/**
 * Simple batch coalescing scheduler for viewport requests.
 * Merges multiple requests for the same clip within a debounce window.
 * Prevents redundant requests during rapid scrolling/scrubbing.
 */
interface PendingRequest {
  clipId: string;
  timestampsMs: number[];
  epochId: RenderEpochId;
  spatialTiers: SpatialTier[];
  callbacks: Set<(artifact: TransportArtifact) => void>;
  completes: Set<() => void>;
  errors: Set<(err: unknown) => void>;
  cancelFns: Set<() => void>;
}

const pendingRequests = new Map<string, PendingRequest>();
let schedulerTimeout: ReturnType<typeof setTimeout> | null = null;
const COALESCE_WINDOW_MS = 50; // Debounce window for coalescing

/**
 * Schedule a batch request with coalescing.
 * Multiple requests for the same clip within the coalesce window are merged.
 */
export function scheduleCoalescedBatch(opts: { clipId: string; videoPath: string; timestampsMs: number[]; epochId: RenderEpochId; spatialTiers: SpatialTier[]; onArtifact: (artifact: TransportArtifact) => void; onComplete?: () => void; onError?: (err: unknown) => void }): () => void {
  const { clipId, videoPath, timestampsMs, epochId, spatialTiers, onArtifact, onComplete, onError } = opts;

  // Get or create pending request for this clip
  let pending = pendingRequests.get(clipId);
  if (!pending) {
    pending = {
      clipId,
      timestampsMs: [],
      epochId,
      spatialTiers,
      callbacks: new Set(),
      completes: new Set(),
      errors: new Set(),
      cancelFns: new Set(),
    };
    pendingRequests.set(clipId, pending);
  }

  // Merge timestamps (deduplicate and sort)
  const mergedTimestamps = new Set([...pending.timestampsMs, ...timestampsMs]);
  pending.timestampsMs = Array.from(mergedTimestamps).sort((a, b) => a - b);
  pending.epochId = epochId; // Update to latest epoch
  pending.spatialTiers = spatialTiers; // Update to latest tiers
  pending.callbacks.add(onArtifact);
  if (onComplete) pending.completes.add(onComplete);
  if (onError) pending.errors.add(onError);

  // Cancel function for this specific request
  const cancel = () => {
    pending?.callbacks.delete(onArtifact);
    if (onComplete) pending?.completes.delete(onComplete);
    if (onError) pending?.errors.delete(onError);
  };
  pending.cancelFns.add(cancel);

  // Reset scheduler timeout
  if (schedulerTimeout) {
    clearTimeout(schedulerTimeout);
  }

  schedulerTimeout = setTimeout(() => {
    // Execute coalesced request
    for (const [clipId, pending] of pendingRequests.entries()) {
      const batchCancel = requestBatchRenderArtifacts({
        videoPath,
        timestampsMs: pending.timestampsMs,
        spatialTiers: pending.spatialTiers,
        epochId: pending.epochId,
        clipId,
        onArtifact: (artifact) => {
          // Distribute to all waiting callbacks
          for (const cb of pending.callbacks) {
            cb(artifact);
          }
        },
        onComplete: () => {
          // Call all complete callbacks
          for (const cb of pending.completes) {
            cb();
          }
        },
        onError: (err) => {
          // Call all error callbacks
          for (const cb of pending.errors) {
            cb(err);
          }
        },
      });

      // Store batch cancel for cleanup
      pending.cancelFns.add(batchCancel);
    }

    // Clear pending requests
    pendingRequests.clear();
    schedulerTimeout = null;
  }, COALESCE_WINDOW_MS);

  return cancel;
}

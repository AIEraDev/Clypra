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

const canUseNativeTransport = () => {
  if (import.meta.env.MODE === "test") return true;
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
};

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
 * Uses SAB zero-copy path when available, otherwise copies into ImageData.
 */
async function rgbaToImageBitmap(rgba: number[] | Uint8ClampedArray, width: number, height: number): Promise<ImageBitmap> {
  // Always copy into a fresh Uint8ClampedArray backed by a plain ArrayBuffer.
  // This is required because ImageData rejects SharedArrayBuffer-backed arrays,
  // and handles both number[] and Uint8ClampedArray input types.
  const clamped = new Uint8ClampedArray(rgba.length);
  clamped.set(rgba);

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

/**
 * Request render artifacts for a single timestamp from the Rust backend.
 * Returns a cancel() function — calling it prevents any further delivery
 * from this request even if artifacts are already in-flight.
 */
export function requestRenderArtifacts(opts: RequestRenderArtifactsOptions): () => void {
  const { videoPath, timestampMs, spatialTiers, epochId, clipId, onArtifact, onComplete, onError } = opts;

  if (!canUseNativeTransport()) {
    onComplete?.();
    return () => {};
  }

  let cancelled = false;
  const cancel = () => {
    cancelled = true;
  };

  const channel = new Channel<BackendRenderArtifact>();
  channel.onmessage = async (raw) => {
    if (cancelled) return;
    if (!isEpochStillValid(epochId, clipId)) return;

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

  if (!canUseNativeTransport()) {
    onComplete?.();
    return () => {};
  }

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

  if (!canUseNativeTransport()) {
    onComplete?.();
    return () => {};
  }

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
      console.error(`[Transport DEBUG] get_render_artifacts_batch catch() reqId=${reqId} error:`, err);
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

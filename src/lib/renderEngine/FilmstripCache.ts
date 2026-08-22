/**
 * Filmstrip Cache
 *
 * Owned by RenderEngine. NOT accessible from React.
 * Manages viewport-bounded thumbnail requests and bitmap lifecycle.
 *
 * Architecture:
 *   RenderEngine → FilmstripCache → Transport → Rust decoder
 *                                  ↓
 *                            RenderState.visibleArtifacts
 *
 * Ownership:
 *   - FilmstripCache OWNS all ImageBitmaps
 *   - Bitmaps closed on: epoch change, eviction, disposal
 *   - React components BORROW artifacts (read-only)
 *
 * Memory Management:
 *   - Hard budget (default 100MB)
 *   - LRU eviction by viewport update time
 *   - Automatic cleanup on clip invalidation
 *
 * RAF Batching (Anti-Rerender Storm):
 *   - Artifacts buffered in pendingArtifacts[]
 *   - Flushed once per frame via requestAnimationFrame
 *   - Single React rerender per clip per frame (not per artifact)
 *   - Professional NLE behavior: batch updates to prevent UI thrashing
 */

import { SpatialTier, VelocityState, type RenderEpochId } from "./types";
import { requestFilmstripArtifacts, type TransportArtifact } from "./transport";
import { FilmstripTileCache } from "../filmstrip/FilmstripTileCache";
import { generateViewportTileAddresses, type FilmstripTileAddress } from "../filmstrip/filmstripTiers";
import { timeToPixel, pixelToTime } from "../timeline/timelineViewport";


interface FilmstripCacheEntry {
  clipId: string;
  epochId: RenderEpochId;
  artifacts: TransportArtifact[];
  cancelFn: (() => void) | null;
  lastViewportUpdate: number;
  memoryBytes: number;
  onUpdate: (artifacts: readonly TransportArtifact[]) => void;
  /** Current viewport tile addresses for this clip */
  tileAddresses: FilmstripTileAddress[];
  /** Current spatial tier */
  spatialTier: SpatialTier;
  /** Derived composite key of all layout, viewport, and geometry inputs */
  layoutKey: string;
}

function computeFilmstripLayoutKey(options: {
  clipId: string;
  spatialTier: SpatialTier;
  epochId: RenderEpochId;
  pixelsPerSecond: number;
  clipStartTime: number;
  clipWidthPx: number;
  trimIn: number;
  trimOut: number;
  tileAddresses: readonly FilmstripTileAddress[];
}): string {
  const addrSig = options.tileAddresses
    .map((a) => `${a.zoomTier}:${Math.round(a.timestamp * 1000)}`)
    .join(",");
  return `${options.clipId}|${options.epochId}|${options.spatialTier}|${options.pixelsPerSecond}|${options.clipStartTime}|${Math.round(options.clipWidthPx)}|${options.trimIn}|${options.trimOut}|${addrSig}`;
}

interface PendingArtifact {
  clipId: string;
  artifact: TransportArtifact;
}

function isValidArtifact(artifact: TransportArtifact): boolean {
  return !!artifact.bitmap && artifact.bitmap.width > 0 && artifact.bitmap.height > 0;
}

interface ViewportFilmstripOptions {
  trimIn: number;
  trimOut: number;
  duration: number;
  clipStartTime: number;
  clipWidthPx: number;
  tileWidthPx: number;
  viewportScrollLeft: number;
  viewportWidth: number;
  pixelsPerSecond: number;
  overscanFactor: number;
}

/**
 * Generate timestamps for visible viewport only (not entire clip)
 *
 * Professional NLE behavior: Only decode what's visible + overscan.
 */
function generateViewportFilmstripTimestamps(options: ViewportFilmstripOptions): number[] {
  const { trimIn, trimOut, duration, clipStartTime, clipWidthPx, tileWidthPx, viewportScrollLeft, viewportWidth, pixelsPerSecond, overscanFactor } = options;

  // Calculate visible time range
  const viewportStartPx = viewportScrollLeft;
  const viewportEndPx = viewportScrollLeft + viewportWidth;

  // Expand with overscan
  const overscanPx = (viewportWidth * (overscanFactor - 1)) / 2;
  const expandedStartPx = Math.max(0, viewportStartPx - overscanPx);
  const expandedEndPx = viewportEndPx + overscanPx;

  // Clip bounds in timeline space — use timeToPixel for rounded pixel-grid consistency.
  const clipStartPx = timeToPixel(clipStartTime, pixelsPerSecond);
  const clipEndPx = clipStartPx + clipWidthPx;

  // Check if clip is visible
  if (clipEndPx < expandedStartPx || clipStartPx > expandedEndPx) {
    return []; // Clip not in viewport
  }

  // Calculate visible portion of clip
  const visibleClipStartPx = Math.max(clipStartPx, expandedStartPx);
  const visibleClipEndPx = Math.min(clipEndPx, expandedEndPx);

  // Convert to clip-local time — use pixelToTime for canonical inverse.
  const visibleStartTime = pixelToTime(visibleClipStartPx - clipStartPx, pixelsPerSecond) + trimIn;
  const visibleEndTime = pixelToTime(visibleClipEndPx - clipStartPx, pixelsPerSecond) + trimIn;


  // Clamp to trim range
  const start = Math.max(trimIn, Math.min(visibleStartTime, trimOut));
  const end = Math.max(trimIn, Math.min(visibleEndTime, trimOut));

  if (end <= start) return [];

  // Generate timestamps for visible region
  const visibleWidthPx = visibleClipEndPx - visibleClipStartPx;
  const tileCount = Math.max(1, Math.ceil(visibleWidthPx / tileWidthPx));
  const span = end - start;

  const timestamps: number[] = [];
  for (let i = 0; i < tileCount; i++) {
    const ratio = (i + 0.5) / tileCount;
    const timestamp = start + span * ratio;
    timestamps.push(Math.min(Math.max(timestamp, 0), duration));
  }

  return timestamps;
}

/**
 * Get tile width for spatial tier
 */
function getTileWidthForTier(tier: SpatialTier): number {
  const widths: Record<SpatialTier, number> = {
    [SpatialTier.L0]: 48,
    [SpatialTier.L1]: 72,
    [SpatialTier.L2]: 96,
    [SpatialTier.L3]: 128,
  };
  return widths[tier] ?? 72;
}

export class FilmstripCache {
  private entries = new Map<string, FilmstripCacheEntry>();
  private memoryBudgetBytes: number;
  private currentMemoryBytes: number = 0;

  // RAF batching to prevent rerender storms
  private pendingArtifacts: PendingArtifact[] = [];
  private rafId: number | null = null;

  /** Tile-addressable cache for zoom transitions and tile-level invalidation */
  private tileCache: FilmstripTileCache;

  /** Current velocity state — drives aggressive cheating behavior */
  private velocityState: VelocityState = VelocityState.Stable;

  /** Low-priority requests that populate only the shared tile cache. */
  private prefetchCancels = new Map<string, Set<() => void>>();

  constructor(memoryBudgetMB: number = 100) {
    this.memoryBudgetBytes = memoryBudgetMB * 1024 * 1024;
    this.tileCache = new FilmstripTileCache(memoryBudgetMB, (art) => this.isArtifactActive(art));
  }

  /**
   * Returns true if the given artifact is currently referenced in active clip entries
   * or pending updates.
   */
  isArtifactActive(artifact: TransportArtifact): boolean {
    for (const entry of this.entries.values()) {
      if (entry.artifacts.includes(artifact)) {
        return true;
      }
    }
    for (const pending of this.pendingArtifacts) {
      if (pending.artifact === artifact) {
        return true;
      }
    }
    return false;
  }

  /**
   * Update velocity state from ISM (Interaction State Machine).
   * Called by RenderEngine on every scroll/zoom update.
   */
  setVelocityState(v: VelocityState): void {
    this.velocityState = v;
  }

  private _cancelPrefetch(clipId: string): void {
    const cancels = this.prefetchCancels.get(clipId);
    if (!cancels) return;
    for (const cancel of cancels) cancel();
    this.prefetchCancels.delete(clipId);
  }

  /**
   * Decode a small neighborhood around the settled viewport into the tile
   * cache. These artifacts never update a live render entry, so prefetch
   * cannot replace committed pixels or create a fallback frame.
   */
  prefetchFilmstrip(options: {
    clipId: string;
    videoPath: string;
    trimIn: number;
    trimOut: number;
    duration: number;
    clipStartTime: number;
    clipWidthPx: number;
    spatialTier: SpatialTier;
    epochId: RenderEpochId;
    viewportScrollLeft: number;
    viewportWidth: number;
    pixelsPerSecond: number;
  }): void {
    this._cancelPrefetch(options.clipId);

    const tiers = [options.spatialTier - 1, options.spatialTier + 1]
      .filter((tier): tier is SpatialTier => tier >= SpatialTier.L0 && tier <= SpatialTier.L3);
    const requests: Array<{ tier: SpatialTier; addresses: FilmstripTileAddress[] }> = [];
    const regionOffsets = [-1, 0, 1];

    for (const tier of tiers) {
      for (const regionOffset of regionOffsets) {
        const addresses = generateViewportTileAddresses({
          clipId: options.clipId,
          videoPath: options.videoPath,
          zoomTier: tier,
          trimIn: options.trimIn,
          trimOut: options.trimOut,
          clipStartTime: options.clipStartTime,
          clipWidthPx: options.clipWidthPx,
          viewportScrollLeft: Math.max(0, options.viewportScrollLeft + regionOffset * options.viewportWidth),
          viewportWidth: options.viewportWidth,
          pixelsPerSecond: options.pixelsPerSecond,
          overscanFactor: regionOffset === 0 ? 1.0 : 0.75,
          videoDuration: options.duration,
        }).filter((address) => !this.tileCache.hasTile(address));

        if (addresses.length > 0) requests.push({ tier, addresses });
      }
    }

    if (requests.length === 0) return;
    const cancels = new Set<() => void>();
    this.prefetchCancels.set(options.clipId, cancels);

    for (const { tier, addresses } of requests) {
      const cancel = requestFilmstripArtifacts({
        videoPath: options.videoPath,
        timestampsMs: addresses.map((address) => Math.round(address.timestamp * 1000)),
        spatialTier: tier,
        epochId: options.epochId,
        clipId: options.clipId,
        concurrency: 1,
        onArtifact: (artifact) => {
          if (!isValidArtifact(artifact) || artifact.epochId !== options.epochId || artifact.spatialTier !== tier) {
            try { artifact.bitmap.close(); } catch {}
            return;
          }
          const address = addresses.find((candidate) => Math.round(candidate.timestamp * 1000) === Math.round(artifact.timestampMs));
          if (!address) {
            try { artifact.bitmap.close(); } catch {}
            return;
          }
          this.tileCache.setTile(address, artifact);
        },
        onError: () => {},
      });
      cancels.add(cancel);
    }
  }

  /**
   * Schedule artifact for batched update (RAF-gated)
   * Prevents React rerender storms during progressive decode
   */
  private scheduleArtifactUpdate(clipId: string, artifact: TransportArtifact): void {
    this.pendingArtifacts.push({ clipId, artifact });

    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => this.flushPendingArtifacts());
    }
  }

  /**
   * Flush all pending artifacts in a single batch (once per frame)
   * Professional NLE behavior: batch updates to prevent UI thrashing
   */
  private flushPendingArtifacts(): void {
    const updatesByClip = new Map<string, TransportArtifact[]>();

    // Group artifacts by clip
    for (const { clipId, artifact } of this.pendingArtifacts) {
      if (!updatesByClip.has(clipId)) {
        updatesByClip.set(clipId, []);
      }
      updatesByClip.get(clipId)!.push(artifact);
    }

    // Process each clip's artifacts
    for (const [clipId, artifacts] of updatesByClip) {
      const entry = this.entries.get(clipId);
      if (!entry) {
        // Entry was invalidated during RAF delay - close bitmaps if not cached
        for (const artifact of artifacts) {
          if (!this.tileCache.isArtifactCached(artifact)) {
            try {
              artifact.bitmap.close();
            } catch (e) {}
          }
        }
        continue;
      }

      // Merge artifacts (dedupe by timestamp, keep highest tier)
      for (const artifact of artifacts) {
        // DEFENSIVE: Skip if already closed/invalid
        if (!artifact.bitmap || artifact.bitmap.width === 0 || artifact.bitmap.height === 0) {
          continue;
        }

        const existingIdx = entry.artifacts.findIndex((a) => a.timestampMs === artifact.timestampMs);

        if (existingIdx >= 0) {
          const existing = entry.artifacts[existingIdx];
          if (artifact.epochId !== existing.epochId || artifact.spatialTier > existing.spatialTier) {
            // A new epoch must replace the old bitmap even at the same tier.
            // Otherwise the exact readiness gate would remain stuck on stale
            // epoch artifacts after a zoom/viewport transition.
            if (!this.tileCache.isArtifactCached(existing)) {
              try {
                existing.bitmap.close();
              } catch (e) {}
            }
            entry.memoryBytes -= existing.width * existing.height * 4;
            this.currentMemoryBytes -= existing.width * existing.height * 4;
            entry.artifacts[existingIdx] = artifact;
            entry.memoryBytes += artifact.width * artifact.height * 4;
            this.currentMemoryBytes += artifact.width * artifact.height * 4;
          } else {
            // Lower or same tier - discard new artifact if not cached
            if (!this.tileCache.isArtifactCached(artifact)) {
              try {
                artifact.bitmap.close();
              } catch (e) {}
            }
            continue;
          }
        } else {
          // New timestamp - add
          entry.artifacts.push(artifact);
          const sizeBytes = artifact.width * artifact.height * 4;
          entry.memoryBytes += sizeBytes;
          this.currentMemoryBytes += sizeBytes;
        }
      }

      // Sort by timestamp
      entry.artifacts.sort((a, b) => a.timestampMs - b.timestampMs);

      // Single update per clip per frame — prevents rerender storm
      entry.onUpdate([...entry.artifacts]);
    }

    // Clear pending queue
    this.pendingArtifacts = [];
    this.rafId = null;
  }

  /** Build artifact array from tile cache for exact current-epoch addresses only. */
  private _buildArtifactsFromTiles(addresses: FilmstripTileAddress[], epochId: RenderEpochId, spatialTier: SpatialTier): TransportArtifact[] {
    const artifacts: TransportArtifact[] = [];

    for (const addr of addresses) {
      const exact = this.tileCache.getTile(addr);
      if (
        exact &&
        isValidArtifact(exact.artifact) &&
        exact.artifact.epochId === epochId &&
        exact.artifact.spatialTier === spatialTier
      ) {
        artifacts.push(exact.artifact);
      }
    }

    // Sort by timestamp for consistent rendering
    artifacts.sort((a, b) => a.timestampMs - b.timestampMs);
    return artifacts;
  }

  /**
   * Request filmstrip artifacts for a clip.
 * Viewport-bounded, epoch-gated, tile-addressable exact rendering.
   */
  requestFilmstrip(options: { clipId: string; videoPath: string; trimIn: number; trimOut: number; duration: number; clipStartTime: number; clipWidthPx: number; spatialTier: SpatialTier; epochId: RenderEpochId; viewportScrollLeft: number; viewportWidth: number; pixelsPerSecond: number; onUpdate: (artifacts: readonly TransportArtifact[]) => void }): void {
    const { clipId, epochId, onUpdate, videoPath, spatialTier, duration } = options;
    this._cancelPrefetch(clipId);

    // Generate tile addresses using FIXED grid (not dynamic timestamps)
    const tileAddresses = generateViewportTileAddresses({
      clipId,
      videoPath,
      zoomTier: spatialTier,
      trimIn: options.trimIn,
      trimOut: options.trimOut,
      clipStartTime: options.clipStartTime,
      clipWidthPx: options.clipWidthPx,
      viewportScrollLeft: options.viewportScrollLeft,
      viewportWidth: options.viewportWidth,
      pixelsPerSecond: options.pixelsPerSecond,
      overscanFactor: 2.0,
      videoDuration: duration,
    });

    const layoutKey = computeFilmstripLayoutKey({
      clipId,
      spatialTier,
      epochId,
      pixelsPerSecond: options.pixelsPerSecond,
      clipStartTime: options.clipStartTime,
      clipWidthPx: options.clipWidthPx,
      trimIn: options.trimIn,
      trimOut: options.trimOut,
      tileAddresses,
    });

    let keptArtifacts: TransportArtifact[] = [];
    const existing = this.entries.get(clipId);
    if (existing) {
      if (existing.epochId !== epochId) {
        // Epoch changed: cancel the old request, clean up clip-level entry, but keep matching artifacts and do NOT invalidate global tile cache!
        existing.cancelFn?.();
        const disposedArtifacts: TransportArtifact[] = [];
        for (const art of existing.artifacts) {
          const isMatched = tileAddresses.some((addr) => Math.abs(addr.timestamp * 1000 - art.timestampMs) < 1);
          if (isMatched) {
            keptArtifacts.push(art);
          } else {
            disposedArtifacts.push(art);
          }
        }

        this._disposeArtifacts(disposedArtifacts);
        const disposedMemory = disposedArtifacts.reduce((acc, art) => acc + art.width * art.height * 4, 0);
        this.currentMemoryBytes -= disposedMemory;
        this.entries.delete(clipId);
      } else {
        if (existing.layoutKey === layoutKey) {
          existing.lastViewportUpdate = Date.now();
          onUpdate([...existing.artifacts]);
          return;
        }

        // Skip if same layout and recent viewport update (debounce)
        const timeSinceUpdate = Date.now() - existing.lastViewportUpdate;
        if (timeSinceUpdate < 100 && existing.layoutKey === layoutKey) {
          // Debounce: return cached artifacts from tiles
          const cachedArtifacts = this._buildArtifactsFromTiles(tileAddresses, epochId, spatialTier);
          onUpdate(cachedArtifacts);
          return;
        }

        // Epoch and spatialTier are same, but layout/addresses changed: cancel the old request now
        existing.cancelFn?.();

        // Separate artifacts to prevent memory leak and reuse valid ones
        const disposedArtifacts: TransportArtifact[] = [];
        for (const art of existing.artifacts) {
          const isMatched = tileAddresses.some((addr) => Math.abs(addr.timestamp * 1000 - art.timestampMs) < 1);
          if (isMatched) {
            keptArtifacts.push(art);
          } else {
            disposedArtifacts.push(art);
          }
        }

        // Dispose non-matching artifacts
        this._disposeArtifacts(disposedArtifacts);
        const disposedMemory = disposedArtifacts.reduce((acc, art) => acc + art.width * art.height * 4, 0);
        this.currentMemoryBytes -= disposedMemory;
      }
    }

    if (tileAddresses.length === 0) {
      // Clip not in viewport
      const currentExisting = this.entries.get(clipId);
      if (currentExisting) {
        currentExisting.cancelFn?.();
        this._disposeArtifacts(currentExisting.artifacts);
        this.currentMemoryBytes -= currentExisting.memoryBytes;
        this.entries.delete(clipId);
      }
      onUpdate([]);
      return;
    }

    // Try to fill in any missing tiles from the global tileCache
    for (const addr of tileAddresses) {
      const alreadyKept = keptArtifacts.some((art) => Math.abs(addr.timestamp * 1000 - art.timestampMs) < 1);
      if (!alreadyKept) {
        const cached = this.tileCache.getTile(addr);
        if (cached) {
          keptArtifacts.push(cached.artifact);
        }
      }
    }

    // During fast/ballistic scroll, publish exact cached tiles immediately.
    // Missing slots remain absent until their exact transport artifacts arrive.
    if (this.velocityState >= VelocityState.Fast) {
      const cachedArtifacts = this._buildArtifactsFromTiles(tileAddresses, epochId, spatialTier);
      onUpdate(cachedArtifacts);

      // If we have ALL tiles cached, skip the request entirely
      const allCached = tileAddresses.every((addr) => {
        const cached = this.tileCache.getTile(addr);
        return !!cached && isValidArtifact(cached.artifact) && cached.artifact.epochId === epochId && cached.artifact.spatialTier === spatialTier;
      });
      if (allCached) {
        return;
      }

      // Otherwise: defer actual request — only request missing tiles
      // (fall through to normal request below, but with cached artifacts already shown)
    }

    // Extract timestamps from tile addresses for transport layer
    const timestampsMs = tileAddresses.map((addr) => Math.round(addr.timestamp * 1000));

    // Create entry
    const entry: FilmstripCacheEntry = {
      clipId,
      epochId,
      artifacts: keptArtifacts,
      cancelFn: null,
      lastViewportUpdate: Date.now(),
      memoryBytes: keptArtifacts.reduce((acc, art) => acc + art.width * art.height * 4, 0),
      onUpdate,
      tileAddresses,
      spatialTier,
      layoutKey,
    };

    this.entries.set(clipId, entry);

    if (keptArtifacts.length > 0) {
      onUpdate([...keptArtifacts]);
    }

    // Request artifacts through the same native FrameRequest path used by the
    // program preview. FilmstripCache still owns epochs and bitmap lifetime.
    const cancelFn = requestFilmstripArtifacts({
      videoPath,
      timestampsMs,
      spatialTier,
      epochId,
      clipId,
      onArtifact: (artifact) => {
        // Check if entry still valid (not invalidated during async decode)
        const currentEntry = this.entries.get(clipId);
        if (!currentEntry) {
          artifact.bitmap.close();
          return;
        }
        if (currentEntry.epochId !== epochId) {
          artifact.bitmap.close();
          return;
        }
        if (!isValidArtifact(artifact)) {
          try {
            artifact.bitmap.close();
          } catch {}
          return;
        }

        // Find the tile address this artifact belongs to
        const matchingAddr = currentEntry.tileAddresses.find((a) => Math.abs(a.timestamp * 1000 - artifact.timestampMs) < 1);
        if (matchingAddr) {
          // Store in tile cache for reuse across zoom transitions
          this.tileCache.setTile(matchingAddr, artifact);
        }

        // Enforce memory budget BEFORE scheduling
        const sizeBytes = artifact.width * artifact.height * 4;
        while (this.currentMemoryBytes + sizeBytes > this.memoryBudgetBytes && this.entries.size > 1) {
          this._evictLRU(clipId); // Don't evict current clip
        }

        // Schedule for RAF-batched update (prevents rerender storm)
        this.scheduleArtifactUpdate(clipId, artifact);
      },
      onComplete: () => {
        const currentEntry = this.entries.get(clipId);
        if (currentEntry && currentEntry.epochId === epochId) {
          currentEntry.cancelFn = null;
        }
      },
      onError: () => {},
    });

    entry.cancelFn = cancelFn;
  }

  /**
   * Get cached artifacts for a clip (immutable snapshot)
   */
  getArtifacts(clipId: string): readonly TransportArtifact[] {
    return this.entries.get(clipId)?.artifacts ?? [];
  }

  /**
   * Invalidate clip (cancel requests, dispose bitmaps)
   */
  invalidateClip(clipId: string): void {
    this._cancelPrefetch(clipId);
    const entry = this.entries.get(clipId);
    if (!entry) return;

    entry.cancelFn?.();
    this._disposeArtifacts(entry.artifacts);
    this.currentMemoryBytes -= entry.memoryBytes;
    this.entries.delete(clipId);

    // Remove any pending artifacts for this clip
    const remainingPending = this.pendingArtifacts.filter((p) => {
      if (p.clipId === clipId) {
        p.artifact.bitmap.close();
        return false;
      }
      return true;
    });
    this.pendingArtifacts = remainingPending;
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    for (const clipId of this.prefetchCancels.keys()) this._cancelPrefetch(clipId);

    // Cancel pending RAF
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    // Close any pending artifacts
    for (const { artifact } of this.pendingArtifacts) {
      if (isValidArtifact(artifact)) {
        artifact.bitmap.close();
      }
    }
    this.pendingArtifacts = [];

    // Dispose all entries
    for (const entry of this.entries.values()) {
      entry.cancelFn?.();
      this._disposeArtifacts(entry.artifacts);
    }
    this.entries.clear();
    this.currentMemoryBytes = 0;

    // Dispose tile cache
    this.tileCache.dispose();
  }

  private _disposeArtifacts(artifacts: TransportArtifact[]): void {
    for (const artifact of artifacts) {
      if (!isValidArtifact(artifact)) {
        continue;
      }
      if (this.tileCache.isArtifactCached(artifact)) {
        continue;
      }
      try {
        artifact.bitmap.close();
      } catch (err) {
        // Bitmap already closed or invalid
      }
    }
  }

  private _evictLRU(excludeClipId?: string): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [clipId, entry] of this.entries) {
      if (clipId === excludeClipId) continue;
      if (entry.lastViewportUpdate < oldestTime) {
        oldestTime = entry.lastViewportUpdate;
        oldestKey = clipId;
      }
    }

    if (oldestKey) {
      this.invalidateClip(oldestKey);
    }
  }

  getStats() {
    const tileStats = this.tileCache.getStats();
    return {
      clipCount: this.entries.size,
      memoryMB: (this.currentMemoryBytes / (1024 * 1024)).toFixed(2),
      budgetMB: this.memoryBudgetBytes / (1024 * 1024),
      utilizationPercent: ((this.currentMemoryBytes / this.memoryBudgetBytes) * 100).toFixed(1),
      tileCount: tileStats.tileCount,
      tileMemoryMB: (tileStats.memoryBytes / (1024 * 1024)).toFixed(2),
      tileUtilizationPercent: tileStats.utilizationPercent.toFixed(1),
    };
  }
}

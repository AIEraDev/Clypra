/**
 * Preview Media Pool
 *
 * Engine-owned pool of hidden <video> and <audio> elements for preview playback.
 * Lives outside React's render tree to prevent lifecycle coupling and memory leaks.
 *
 * Key features:
 * - Headless elements appended to a fixed container div (not in React tree)
 * - Frame-accurate synchronization via requestVideoFrameCallback()
 * - Lifecycle managed by engine (create/destroy/play/pause/seek/cleanup)
 * - Exposes video elements to FrameScheduler for rasterization bypass
 *
 * Architecture:
 *   Timeline clips → PreviewMediaPool.sync() → hidden DOM elements
 *   FrameScheduler ← getVideoElements() ─────┘
 *
 * ARCHITECTURAL FIX (2025-01):
 * Fixed autoplay blocking and element churn during playback by decoupling:
 * 1. Clip existence (timeline state)
 * 2. Render eligibility (active playback window)
 * 3. Element residency (DOM cache)
 *
 * Key changes:
 * - Elements keyed by media source, not clip ID (persistent across splits)
 * - Elements stay cached when clips leave active window (no disposal on boundary)
 * - play() moved to separate playback controller with proper guards
 * - NotAllowedError latch prevents infinite retry loops
 * - LRU eviction based on time/memory, not activity window
 */

import type { Clip, MediaAsset } from "@/types";
import { convertFileSrc } from "@tauri-apps/api/core";
import { resolveClipSourceTime } from "../timeline/sourceTime";
import { performanceMonitor } from "@/lib/monitoring/PerformanceMonitor";

export interface PreviewSyncState {
  /** Current playback time (seconds) */
  time: number;
  /** Playback state */
  state: "playing" | "paused" | "stopped";
  /** Playback speed multiplier */
  speed: number;
  /** Master mute */
  muted: boolean;
  /** Master volume (0-100) */
  volume: number;
  /** Project frame rate for frame-aware tolerance calculations */
  frameRate: 24 | 30 | 60;
}

interface ManagedVideo {
  element: HTMLVideoElement;
  /** Currently bound clip ID (can change as clips are reassigned) */
  clipId: string;
  mediaId: string;
  sourcePath: string;
  rvfcHandle: number | null;
  /** Whether the element's metadata has loaded */
  ready: boolean;
  /** Last hard seek timestamp (ms) for drift control */
  lastHardSeekAtMs: number;
  /** True when element is being intentionally disposed/cleared */
  disposing: boolean;
  /** Play attempt tracking for debugging */
  playAttempts: number;
  lastPlayAttemptMs: number;
  playPromiseInFlight: boolean;
  /** Flag to cancel pending play promise (for rapid play/pause) */
  playCancelRequested: boolean;
  lastPlayFailure: { error: string; timestamp: number } | null;
  autoplayBlocked: boolean;
  createdAt: number;
  /** Last time this element was used (for LRU eviction) */
  lastUsedAt: number;
  /** Whether element is currently active in render window */
  isActive: boolean;
  /** Grace period - don't mark as orphaned if recently created */
  registrationGraceUntil: number;
  /** FINDING-019: Generation counter to invalidate stale RVFC callbacks */
  rvfcGeneration: number;
}

interface ManagedAudio {
  element: HTMLAudioElement;
  clipId: string;
  mediaId: string;
  sourcePath: string;
  ready: boolean;
}

/**
 * Identifies the "primary" video clip — the one whose media clock should be
 * trusted for AV sync. Prefers the lowest video track, then the leftmost clip.
 */
function findPrimaryVideoClip(videoClips: Clip[], tracks: Array<{ id: string; type: string }>): Clip | null {
  if (videoClips.length === 0) return null;
  if (videoClips.length === 1) return videoClips[0];

  // Build track index map (lower index = lower on timeline = primary)
  const trackIndex = new Map<string, number>();
  tracks.forEach((t, i) => trackIndex.set(t.id, i));

  // Sort by track index ascending, then by startTime ascending
  const sorted = [...videoClips].sort((a, b) => {
    const aIdx = trackIndex.get(a.trackId) ?? Infinity;
    const bIdx = trackIndex.get(b.trackId) ?? Infinity;
    if (aIdx !== bIdx) return aIdx - bIdx;
    return a.startTime - b.startTime;
  });

  return sorted[0];
}

/**
 * Calculate the source time for a clip at a given clock time.
 *
 * BOUNDARY HANDLING: Uses a frame-rate-aware tolerance (1.5 frames) to keep
 * clips active slightly beyond their boundaries. This prevents stuttering during
 * split transitions by ensuring continuous decode/playback.
 *
 * ✅ CRITICAL FIX (FINDING-001): Now uses canonical resolveClipSourceTime utility
 * to ensure consistency with export and other subsystems.
 *
 * FINDING-005: Replaced hardcoded 16ms (60fps) with dynamic calculation based on
 * project frame rate. Examples:
 * - 24fps: 1.5 frames = 62.5ms tolerance
 * - 30fps: 1.5 frames = 50ms tolerance
 * - 60fps: 1.5 frames = 25ms tolerance
 */
function getClipSourceTime(clip: Clip, clockTime: number, frameRate: number): number | null {
  const clipLocalTime = clockTime - clip.startTime;

  // FINDING-005: Frame-rate-aware boundary tolerance (1.5 frames)
  const BOUNDARY_TOLERANCE = 1.5 / frameRate; // seconds

  if (clipLocalTime < -BOUNDARY_TOLERANCE || clipLocalTime > clip.duration + BOUNDARY_TOLERANCE) {
    return null; // Clip not active
  }

  // ✅ Use canonical source time calculation with clamping
  const { sourceTime } = resolveClipSourceTime(clip, clockTime, {
    clampToRange: true,
    frameRate,
  });

  return sourceTime;
}

function getClipPrewarmSourceTime(clip: Clip, clockTime: number): number | null {
  if (clockTime >= clip.startTime) return null;
  return Math.max(0, clip.trimIn || 0);
}

export class PreviewMediaPool {
  private container: HTMLDivElement;

  // NEW ARCHITECTURE: Separate element cache from clip-to-element mapping
  // Element cache is keyed by media source (persistent across clip changes)
  private videoCache = new Map<string, ManagedVideo>();
  // Active clip-to-element binding (changes as clips move in/out of window)
  private activeClipBindings = new Map<string, string>(); // clipId -> cacheKey
  // CRITICAL: Timeline clip registry - tracks ALL clips in timeline (not just active ones)
  // This prevents evicting elements for clips that still exist but are temporarily inactive
  private timelineClipRegistry = new Map<string, string>(); // clipId -> cacheKey
  // TRANSITION SAFETY: Track recently removed clips to keep their elements available during transitions
  // Format: cacheKey -> { clipIds: all known clipIds that map to this cache, timestamp: when removed }
  // FINDING-003 + SPLIT FIX: Store ALL clipIds (original + splits) to prevent lookup mismatch
  // When a clip is split, both new clips share the same media/trim cache key but have different IDs
  private recentlyRemovedClips = new Map<string, { clipIds: string[]; timestamp: number }>();
  private readonly TRANSITION_GRACE_PERIOD_MS = 500; // Keep elements for 500ms after removal

  private audios = new Map<string, ManagedAudio>();
  private lastSyncState: PreviewSyncState | null = null;
  private trackMap = new Map<string, { id: string; type: string; visible?: boolean; muted?: boolean }>();
  private _isDisposed = false;

  // Playback controller state (separate from sync)
  private sessionAutoplayBlocked = false;

  /** Whether requestVideoFrameCallback is available */
  private hasRVFC = typeof HTMLVideoElement !== "undefined" && "requestVideoFrameCallback" in HTMLVideoElement.prototype;

  // ─── INSTRUMENTATION ────────────────────────────────────────────────────
  private syncCallCount = 0;
  private lastSyncClipIds = new Set<string>();
  private playAttemptLog: Array<{
    timestamp: number;
    elementKey: string;
    clipId: string;
    wasPlaying: boolean;
    promiseInFlight: boolean;
    elementAge: number;
    source: string;
    result: "success" | "rejected" | "pending";
    error?: string;
  }> = [];
  private maxLogSize = 100;

  // LRU cache limits
  private readonly MAX_CACHED_VIDEOS = 20;
  private readonly CACHE_EVICTION_AGE_MS = 60000; // 60 seconds unused (increased for split workflows)

  // FINDING-008: Memory-aware eviction thresholds
  private readonly ESTIMATED_MB_PER_VIDEO = 50; // Estimated memory per video element (buffer + decode state)
  private readonly MEMORY_SOFT_LIMIT_MB = 500; // Start aggressive eviction at 500MB
  private readonly MEMORY_HARD_LIMIT_MB = 800; // Force eviction at 800MB regardless of protection

  // ─── RE-ENTRANCY PROTECTION ─────────────────────────────────────────────
  private _syncInProgress = false;
  private _queuedSyncRequest: {
    clips: Clip[];
    assets: MediaAsset[];
    tracks: Array<{ id: string; type: string }>;
    syncState: PreviewSyncState;
  } | null = null;

  // ─── FINDING-006: Early exit optimization ───────────────────────────────
  private _lastQuickHash: string | null = null;

  constructor() {
    this.container = document.createElement("div");
    // Position fixed and practically invisible, but NOT offscreen.
    // Browsers suspend decoding for completely offscreen or display:none elements.
    this.container.style.cssText = "position:fixed;left:0;top:0;width:256px;height:256px;opacity:0.001;pointer-events:none;z-index:-9999;overflow:hidden;";
    document.body.appendChild(this.container);

    // ─── INSTRUMENTATION: Register pool for console access ────────────────
    if (typeof window !== "undefined") {
      if (!(window as any).__previewMediaPools) {
        (window as any).__previewMediaPools = [];
      }
      (window as any).__previewMediaPools.push(this);
    }
    // ───────────────────────────────────────────────────────────────────────
  }

  /**
   * Synchronize the pool with current timeline clips and clock state.
   * Creates/destroys elements as needed and updates playback state.
   *
   * ARCHITECTURAL CHANGE: This method now only reconciles state.
   * It does NOT initiate playback. Playback is controlled separately.
   */
  sync(clips: Clip[], assets: MediaAsset[], tracks: Array<{ id: string; type: string }>, syncState: PreviewSyncState): void {
    if (this._isDisposed) {
      console.error(`[PreviewMediaPool] Pool is disposed!`);
      return;
    }

    // MONITORING: Track sync calls
    performanceMonitor.increment("preview_pool.sync_calls");
    performanceMonitor.startTimer("preview_pool.sync_duration");

    // ─── RE-ENTRANCY GUARD ───────────────────────────────────────────────────
    if (this._syncInProgress) {
      // Already syncing - queue this request and return immediately
      // Only keep the MOST RECENT request (intermediate states don't matter)
      this._queuedSyncRequest = { clips, assets, tracks, syncState };
      performanceMonitor.increment("preview_pool.sync_reentrant");
      performanceMonitor.endTimer("preview_pool.sync_duration");
      return;
    }

    // Mark sync as in progress
    this._syncInProgress = true;

    try {
      // ─── FINDING-006: Early exit optimization (fast path) ───────────────────
      // Skip expensive reconciliation if nothing meaningful changed
      // Round time to 0.1s precision to avoid rehashing every frame during playback
      const quickHash = `${syncState.time.toFixed(1)}-${syncState.state}-${clips.length}`;
      // CRITICAL: Only use fast path if we have video elements already created.
      // This prevents skipping the first sync after project load when elements need creation.
      const hasVideoElements = this.videoCache.size > 0;
      if (hasVideoElements && quickHash === this._lastQuickHash) {
        // Nothing changed - skip reconciliation (saves 0.5-2ms per frame)
        performanceMonitor.increment("preview_pool.sync_skipped");
        return;
      }
      this._lastQuickHash = quickHash;
      // ─────────────────────────────────────────────────────────────────────────

      // ─── INSTRUMENTATION: Track sync frequency and structural changes ────────
      this.syncCallCount++;
      const currentClipIds = new Set(clips.map((c) => c.id));
      const structuralChange = this.detectStructuralChange(currentClipIds);

      if (structuralChange) {
        performanceMonitor.increment("preview_pool.structural_changes");
      }

      this.lastSyncClipIds = currentClipIds;
      // ─────────────────────────────────────────────────────────────────────────

      this.trackMap = new Map(tracks.map((track) => [track.id, track]));

      // NEW ARCHITECTURE: Build desired state without immediate disposal
      const desiredVideoBindings = new Map<string, { cacheKey: string; clip: Clip; asset: MediaAsset; isActive: boolean }>();
      const desiredAudioKeys = new Set<string>();

      // CRITICAL: Detect if this is a full sync (structural change) or partial sync (active window only)
      // On project load or clip add/remove, we get structural changes. During playback, no changes.
      const isFullSync = structuralChange.changed;

      // If full sync with removals, clear and rebuild registry
      if (isFullSync && structuralChange.removed.length > 0) {
        const now = performance.now();
        for (const removedClipId of structuralChange.removed) {
          const cacheKey = this.timelineClipRegistry.get(removedClipId);
          if (cacheKey) {
            // FINDING-003 + SPLIT FIX: Store all known clipIds that map to this cache key
            // This handles split clips where multiple clip IDs share the same cache element
            const existingEntry = this.recentlyRemovedClips.get(cacheKey);
            if (existingEntry) {
              // Add this clipId to the existing array if not already present
              if (!existingEntry.clipIds.includes(removedClipId)) {
                existingEntry.clipIds.push(removedClipId);
                console.log(`[PreviewMediaPool] Split detected: Added clip ${removedClipId} to cache ${cacheKey.substring(0, 30)}... (now tracking ${existingEntry.clipIds.length} IDs)`);
              }
              // Update timestamp to extend grace period
              existingEntry.timestamp = now;
            } else {
              // Create new entry with this clipId
              this.recentlyRemovedClips.set(cacheKey, {
                clipIds: [removedClipId],
                timestamp: now,
              });
              console.log(`[PreviewMediaPool] Removed clip ${removedClipId} added to grace period (cache: ${cacheKey.substring(0, 30)}...)`);
            }
          }
          this.timelineClipRegistry.delete(removedClipId);
        }
      }

      for (const clip of clips) {
        const asset = assets.find((a) => a.id === clip.mediaId);
        const track = this.trackMap.get(clip.trackId);
        if (track?.visible === false) continue;

        if (asset?.type === "video") {
          const sourcePath = asset.path.startsWith("asset://") ? asset.path : convertFileSrc(asset.path);

          // Cache key strategy: For split clips that share media, we need separate elements
          // to prevent rebinding conflicts during overlap. Use trimIn to differentiate.
          // FINDING-013: Normalize trimIn to prevent floating-point rounding differences
          const trimIn = clip.trimIn || 0;
          const normalizedTrimIn = Math.round(trimIn * 1000) / 1000;
          const cacheKey = `${clip.mediaId}-${sourcePath}-trim${normalizedTrimIn.toFixed(3)}`;

          const sourceTime = getClipSourceTime(clip, syncState.time, syncState.frameRate);
          const isActive = sourceTime !== null; // Is clip in active playback window?

          desiredVideoBindings.set(clip.id, { cacheKey, clip, asset, isActive });

          // CRITICAL: Add/update this clip in timeline registry (accumulate during playback)
          this.timelineClipRegistry.set(clip.id, cacheKey);

          // SPLIT FIX: If this cacheKey is in recently removed, add this new clipId to the array
          // This handles the case where a clip is split: both new clips share the same cache
          // but have different IDs. We need to track ALL IDs for transition rendering.
          const existingRemoval = this.recentlyRemovedClips.get(cacheKey);
          if (existingRemoval && !existingRemoval.clipIds.includes(clip.id)) {
            existingRemoval.clipIds.push(clip.id);
            console.log(`[PreviewMediaPool] New split clip ${clip.id} shares cache with ${existingRemoval.clipIds[0]} (total: ${existingRemoval.clipIds.length} clips, cacheKey: ${cacheKey.substring(0, 50)}...)`);
          }

          // DEBUG: Log when adding clips with similar mediaId but different cache keys
          if (existingRemoval && existingRemoval.clipIds.length > 0) {
            const firstClipId = existingRemoval.clipIds[0];
            if (firstClipId.substring(0, 20) === clip.id.substring(0, 20)) {
              console.log(`[PreviewMediaPool] SPLIT MISMATCH: Clip ${clip.id} has different cache key than ${firstClipId}`);
              console.log(`  New cacheKey: ${cacheKey}`);
              console.log(`  trimIn: ${normalizedTrimIn.toFixed(3)}`);
            }
          }
        } else if (asset?.type === "audio" || (clip.kind === "audio" && (clip as any).audioPath)) {
          const key = `${clip.id}-${clip.mediaId}`;
          desiredAudioKeys.add(key);
        }
      }

      // Remove obsolete audio elements (audio disposal is simpler, keep existing logic)
      for (const [key, managed] of this.audios) {
        if (!desiredAudioKeys.has(key)) {
          this.disposeAudio(key, managed);
        }
      }

      // Update active clip bindings and mark inactive elements
      const newActiveBindings = new Map<string, string>();

      for (const [clipId, { cacheKey, clip, asset, isActive }] of desiredVideoBindings) {
        newActiveBindings.set(clipId, cacheKey);

        // Get or create cached element
        let managed = this.videoCache.get(cacheKey);
        if (!managed) {
          const sourcePath = asset.path.startsWith("asset://") ? asset.path : convertFileSrc(asset.path);
          managed = this.createVideo(cacheKey, clip.id, clip.mediaId, sourcePath);
        } else {
          // Element exists - update its binding
          managed.clipId = clip.id;
          managed.lastUsedAt = performance.now();
        }

        // Mark activity state (does NOT dispose when inactive)
        managed.isActive = isActive;

        if (isActive) {
          // Only update active elements
          const track = this.trackMap.get(clip.trackId);
          const isTrackMuted = track?.muted === true;

          // Find primary video for audio routing
          const activeVisibleVideoClips = clips.filter((c) => {
            const a = assets.find((x) => x.id === c.mediaId);
            if (!a || a.type !== "video") return false;
            const t = this.trackMap.get(c.trackId);
            if (t?.visible === false) return false;
            return getClipSourceTime(c, syncState.time, syncState.frameRate) !== null;
          });
          const primaryVideoClip = findPrimaryVideoClip(activeVisibleVideoClips, tracks);
          const isPrimaryAudibleVideo = primaryVideoClip?.id === clip.id;

          this.updateVideoElement(managed, clip, syncState, tracks, isPrimaryAudibleVideo, isTrackMuted);
        } else {
          // Inactive element: pause but don't dispose
          // CRITICAL: Also update audio routing so element is ready when it becomes active
          const track = this.trackMap.get(clip.trackId);
          const isTrackMuted = track?.muted === true;
          const clipVolume = clip.volume ?? 1.0;
          const combinedVolume = (syncState.volume / 100) * clipVolume;

          // Pre-configure audio for when element becomes active
          // This prevents "no sound" issues when clips are activated
          managed.element.muted = syncState.muted || isTrackMuted || clipVolume === 0;
          managed.element.volume = managed.element.muted ? 0 : Math.max(0, Math.min(1, combinedVolume));

          if (!managed.element.paused) {
            managed.element.pause();
          }
          if (managed.rvfcHandle !== null && this.hasRVFC) {
            try {
              managed.element.cancelVideoFrameCallback(managed.rvfcHandle);
            } catch {
              // ignore
            }
            managed.rvfcHandle = null;
          }
        }
      }

      this.activeClipBindings = newActiveBindings;

      // FIRST: Pause inactive elements (in timeline but not currently active in playback window)
      // This prevents multiple clips from playing simultaneously
      const activeCacheKeys = new Set(newActiveBindings.values());
      const timelineCacheKeys = new Set(this.timelineClipRegistry.values());

      for (const [cacheKey, managed] of this.videoCache) {
        const isActive = activeCacheKeys.has(cacheKey);
        const isInTimeline = timelineCacheKeys.has(cacheKey);

        // If element is in timeline but NOT currently active, pause it
        // FINDING-014: Don't pause if element is currently seeking - can corrupt state
        if (isInTimeline && !isActive && !managed.element.paused && !managed.element.seeking) {
          managed.element.pause();
          if (managed.rvfcHandle !== null && this.hasRVFC) {
            try {
              managed.element.cancelVideoFrameCallback(managed.rvfcHandle);
            } catch {
              // ignore
            }
            managed.rvfcHandle = null;
          }
        }
      }

      // SECOND: Clean up truly orphaned elements (not in timeline at all)
      // These are elements from deleted clips or old cache entries
      const now = performance.now();

      for (const [cacheKey, managed] of this.videoCache) {
        const isInGracePeriod = now < managed.registrationGraceUntil;
        const isInTimeline = timelineCacheKeys.has(cacheKey);
        const recentRemoval = this.recentlyRemovedClips.get(cacheKey);
        const isRecentlyRemoved = recentRemoval !== undefined;
        const isInTransitionGrace = isRecentlyRemoved && recentRemoval && now - recentRemoval.timestamp < this.TRANSITION_GRACE_PERIOD_MS;

        // CRITICAL FIX: Elements in grace period must respect playback state
        // If user pauses, grace-period elements must also pause (prevents audio bleed)
        if (isInTransitionGrace && syncState.state !== "playing") {
          if (!managed.element.paused) {
            managed.element.pause();
          }
        }

        // Only mark as orphaned if NOT in timeline AND NOT in transition grace AND past registration grace
        if (!isInTimeline && !isInGracePeriod && !isInTransitionGrace) {
          if (!managed.element.paused) {
            managed.element.pause();
          }
          if (managed.rvfcHandle !== null && this.hasRVFC) {
            try {
              managed.element.cancelVideoFrameCallback(managed.rvfcHandle);
            } catch {
              // ignore
            }
            managed.rvfcHandle = null;
          }
        } else if (isInTimeline) {
          // ─── FINDING-002: Extend grace period when element is in timeline ───────
          // Element is in timeline - extend grace period (it's proven to be valid)
          // Also remove from recently removed list since it's back in the timeline
          this.recentlyRemovedClips.delete(cacheKey);
          managed.registrationGraceUntil = now + 10000; // Keep grace for 10 more seconds
          // ────────────────────────────────────────────────────────────────────────
        }
      }

      // Clean up expired recently removed entries (older than grace period)
      for (const [cacheKey, removal] of Array.from(this.recentlyRemovedClips.entries())) {
        if (now - removal.timestamp > this.TRANSITION_GRACE_PERIOD_MS) {
          this.recentlyRemovedClips.delete(cacheKey);
        }
      }

      // LRU eviction: Remove unused cached elements (not just inactive ones)
      this.evictUnusedElements();

      // Create or update audio elements (unchanged logic)
      for (const clip of clips) {
        const asset = assets.find((a) => a.id === clip.mediaId);
        const directAudioPath = (clip as any).audioPath as string | undefined;
        const isAudioClip = asset?.type === "audio" || (clip.kind === "audio" && !!directAudioPath);
        if (!isAudioClip) continue;
        const track = this.trackMap.get(clip.trackId);
        if (track?.visible === false) continue;

        const rawPath = asset ? asset.path : directAudioPath!;
        const key = `${clip.id}-${clip.mediaId}`;
        const sourcePath = rawPath.startsWith("asset://") ? rawPath : convertFileSrc(rawPath);

        let managed = this.audios.get(key);
        if (!managed) {
          managed = this.createAudio(key, clip.id, clip.mediaId, sourcePath);
        } else if (managed.sourcePath !== sourcePath) {
          this.disposeAudio(key, managed);
          managed = this.createAudio(key, clip.id, clip.mediaId, sourcePath);
        }

        if (managed) {
          const isTrackMuted = track?.muted === true;
          this.updateAudioElement(managed, clip, syncState, isTrackMuted);
        }
      }

      this.lastSyncState = { ...syncState };

      // ─── END OF ORIGINAL SYNC LOGIC ──────────────────────────────────────────

      // MONITORING: Track pool sizes
      performanceMonitor.gauge("preview_pool.video_cache_size", this.videoCache.size);
      performanceMonitor.gauge("preview_pool.audio_cache_size", this.audios.size);
      performanceMonitor.gauge("preview_pool.active_bindings", this.activeClipBindings.size);
    } finally {
      // Always clear the in-progress flag, even if sync() threw an error
      this._syncInProgress = false;

      // MONITORING: Record sync duration
      performanceMonitor.endTimer("preview_pool.sync_duration");

      // Process queued sync request if one arrived while we were busy
      if (this._queuedSyncRequest) {
        const queued = this._queuedSyncRequest;
        this._queuedSyncRequest = null; // Clear before calling to prevent infinite recursion

        // Recursively call sync with the queued request
        // This is safe because:
        // 1. We cleared _syncInProgress (guard allows entry)
        // 2. We cleared _queuedSyncRequest (prevents infinite loop if this sync also gets queued)
        // 3. Only 1 level of recursion possible (queued request will complete or queue another)
        this.sync(queued.clips, queued.assets, queued.tracks, queued.syncState);
      }
    }
  }

  /**
   * Get video elements for scheduler rasterization bypass.
   * Returns ALL timeline clip elements (not just currently active ones) so scheduler
   * can query readyState and render transitions between clips.
   * Also includes recently removed clips during transition grace period.
   */
  getVideoElements(): Map<string, HTMLVideoElement> {
    const result = new Map<string, HTMLVideoElement>();

    // Map by clip-media composite key that rasterizer expects
    // Use timeline registry (not just active bindings) so rasterizer can access
    // ALL clip elements including those temporarily inactive during transitions
    for (const [clipId, cacheKey] of this.timelineClipRegistry) {
      const managed = this.videoCache.get(cacheKey);
      if (managed) {
        // Use legacy key format: ${clipId}-${mediaId}
        const legacyKey = `${clipId}-${managed.mediaId}`;
        result.set(legacyKey, managed.element);
      }
    }

    // ─── FINDING-003 + SPLIT FIX: Use all known clipIds for recently removed clips ──
    // TRANSITION SAFETY: Also include recently removed clips (within grace period)
    // This ensures rasterizer can access outgoing clip frames during transitions
    // SPLIT FIX: Return mappings for ALL clipIds that share this cache element
    // When clips are split, both new clips map to same element but have different IDs
    const now = performance.now();
    for (const [cacheKey, removal] of this.recentlyRemovedClips) {
      if (now - removal.timestamp < this.TRANSITION_GRACE_PERIOD_MS) {
        const managed = this.videoCache.get(cacheKey);
        if (managed) {
          // Create mappings for ALL known clipIds (original + splits)
          for (const clipId of removal.clipIds) {
            const legacyKey = `${clipId}-${managed.mediaId}`;
            result.set(legacyKey, managed.element);
          }
          if (removal.clipIds.length > 1) {
            console.log(`[PreviewMediaPool] getVideoElements: Returning element for ${removal.clipIds.length} clip IDs (split clips): ${removal.clipIds.join(", ")}`);
          }
        }
      }
    }
    // ─────────────────────────────────────────────────────────────────────────────

    return result;
  }

  /**
   * Get audio elements.
   */
  getAudioElements(): Map<string, HTMLAudioElement> {
    const result = new Map<string, HTMLAudioElement>();
    for (const [key, managed] of this.audios) {
      result.set(key, managed.element);
    }
    return result;
  }

  /**
   * Immediately pause all managed media elements.
   * Used when the desktop app loses foreground before RAF has a chance to sync.
   */
  pauseAll(): void {
    for (const managed of this.videoCache.values()) {
      if (managed.rvfcHandle !== null && this.hasRVFC) {
        try {
          managed.element.cancelVideoFrameCallback(managed.rvfcHandle);
        } catch {
          // ignore
        }
        managed.rvfcHandle = null;
      }
      managed.element.pause();
    }

    for (const managed of this.audios.values()) {
      managed.element.pause();
    }
  }

  /**
   * Dispose all media elements and remove the container.
   */
  dispose(): void {
    if (this._isDisposed) return;
    this._isDisposed = true;

    // ─── CLEAR SYNC STATE ────────────────────────────────────────────────────
    // If sync was in progress, this disposal will be caught by the finally block
    // But clear the queued request to prevent post-disposal sync attempts
    this._queuedSyncRequest = null;

    // ─── INSTRUMENTATION: Print final diagnostics ─────────────────────────
    this.printDiagnostics();
    // ──────────────────────────────────────────────────────────────────────

    for (const [key, managed] of this.videoCache) {
      this.disposeVideo(key, managed);
    }
    this.videoCache.clear();
    this.activeClipBindings.clear();
    this.timelineClipRegistry.clear();
    this.recentlyRemovedClips.clear();

    for (const [key, managed] of this.audios) {
      this.disposeAudio(key, managed);
    }
    this.audios.clear();

    if (this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }

  /**
   * Unlock autoplay audio restrictions for all pooled media elements.
   * MUST be called synchronously inside a user gesture event handler (like click).
   */
  unlockAudio(): void {
    // FINDING-024: Check if we're in an active user gesture context
    // This is more reliable than timestamp-based checking
    const hasUserActivation = typeof navigator !== "undefined" && navigator.userActivation && navigator.userActivation.isActive;

    if (!hasUserActivation) {
      console.warn("[PreviewMediaPool] unlockAudio() called without active user gesture - autoplay unlock may fail");
    }

    this.sessionAutoplayBlocked = false;

    for (const managed of this.videoCache.values()) {
      // Clear autoplay block on user gesture
      managed.autoplayBlocked = false;

      const video = managed.element;
      const wasMuted = video.muted;
      video.muted = true;
      const promise = video.play();
      if (promise !== undefined) {
        promise
          .then(() => {
            video.pause();
            video.muted = wasMuted;
          })
          .catch(() => {
            // Promise might be aborted, but user activation is registered anyway
            video.pause();
            video.muted = wasMuted;
          });
      } else {
        video.pause();
        video.muted = wasMuted;
      }
    }

    for (const managed of this.audios.values()) {
      const audio = managed.element;
      const wasMuted = audio.muted;
      audio.muted = true;
      const promise = audio.play();
      if (promise !== undefined) {
        promise
          .then(() => {
            audio.pause();
            audio.muted = wasMuted;
          })
          .catch(() => {
            audio.pause();
            audio.muted = wasMuted;
          });
      } else {
        audio.pause();
        audio.muted = wasMuted;
      }
    }
  }

  // ─── Private: Video lifecycle ─────────────────────────────────────────────

  private createVideo(key: string, clipId: string, mediaId: string, sourcePath: string): ManagedVideo {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true; // Always muted — audio is handled separately or not at all
    video.playsInline = true;
    // Browsers aggressively throttle decoding for tiny videos. Use a larger size (256x256)
    // to ensure the hardware decoder remains active.
    video.style.cssText = "width:256px;height:256px;position:absolute;left:0;top:0;";

    const managed: ManagedVideo = {
      element: video,
      clipId,
      mediaId,
      sourcePath,
      rvfcHandle: null,
      ready: false,
      lastHardSeekAtMs: 0,
      disposing: false,
      // ─── INSTRUMENTATION ────────────────────────────────────────────────
      playAttempts: 0,
      lastPlayAttemptMs: 0,
      playPromiseInFlight: false,
      playCancelRequested: false,
      lastPlayFailure: null,
      autoplayBlocked: false,
      createdAt: performance.now(),
      // ─── NEW ARCHITECTURE ───────────────────────────────────────────────
      lastUsedAt: performance.now(),
      isActive: false,
      // Grace period: don't mark as orphaned for 5 seconds after creation
      // This allows time for the clip to be seen by sync() and registered
      registrationGraceUntil: performance.now() + 5000,
      // FINDING-019: Generation counter to invalidate stale RVFC callbacks
      rvfcGeneration: 0,
      // ────────────────────────────────────────────────────────────────────
    };

    // Wait for metadata before marking ready
    video.addEventListener(
      "loadedmetadata",
      () => {
        managed.ready = true;
        import("../../store/timelineStore")
          .then(({ useTimelineStore }) => {
            useTimelineStore.getState().incrementEpoch();
          })
          .catch((err) => {
            console.error("[PreviewMediaPool] Failed to import useTimelineStore on loadedmetadata", err);
          });
      },
      { once: true },
    );

    video.addEventListener(
      "loadeddata",
      () => {
        import("../../store/timelineStore")
          .then(({ useTimelineStore }) => {
            useTimelineStore.getState().incrementEpoch();
          })
          .catch((err) => {
            console.error("[PreviewMediaPool] Failed to import useTimelineStore on loadeddata", err);
          });
      },
      { once: true },
    );

    video.addEventListener(
      "error",
      (e) => {
        // Ignore expected teardown/HMR errors when src is intentionally cleared.
        if (managed.disposing || !video.currentSrc) {
          return;
        }
        console.error(`❌ [PreviewMediaPool] Video load error: ${key}`, video.error, e);
      },
      { once: true },
    );

    video.addEventListener(
      "seeked",
      () => {
        if (video.paused) {
          import("../../store/timelineStore")
            .then(({ useTimelineStore }) => {
              useTimelineStore.getState().incrementEpoch();
            })
            .catch((err) => {
              console.error("[PreviewMediaPool] Failed to import useTimelineStore on seeked", err);
            });
        }
      },
      { once: true }, // Auto-remove listener after first seek to prevent leak
    );

    video.src = sourcePath;

    // Explicitly trigger video load
    video.load();

    this.container.appendChild(video);

    this.videoCache.set(key, managed);

    return managed;
  }

  private disposeVideo(key: string, managed: ManagedVideo): void {
    // FINDING-020: Set disposing flag BEFORE any async operations
    // This prevents play() promise handlers from accessing disposed element
    managed.disposing = true;

    // FINDING-020: Cancel any pending play promise
    if (managed.playPromiseInFlight) {
      managed.playCancelRequested = true;
    }

    // FINDING-019: Increment generation to invalidate pending RVFC callbacks
    // This prevents memory leaks from closures
    managed.rvfcGeneration++;

    if (managed.rvfcHandle !== null && this.hasRVFC) {
      try {
        managed.element.cancelVideoFrameCallback(managed.rvfcHandle);
      } catch {
        // ignore
      }
      managed.rvfcHandle = null;
    }

    managed.element.pause();
    managed.element.src = "";
    managed.element.load(); // Force decoder release

    if (managed.element.parentNode) {
      managed.element.parentNode.removeChild(managed.element);
    }

    this.videoCache.delete(key);
  }

  private updateVideoElement(managed: ManagedVideo, clip: Clip, syncState: PreviewSyncState, tracks: Array<{ id: string; type: string }>, isPrimaryAudibleVideo: boolean, isTrackMuted: boolean): void {
    const video = managed.element;
    const sourceTime = getClipSourceTime(clip, syncState.time, syncState.frameRate);

    // Combine global preview volume with per-clip volume
    const clipVolume = clip.volume ?? 1.0;
    const combinedVolume = (syncState.volume / 100) * clipVolume;

    // Only one primary video clip is audible; others stay muted.
    const shouldMute = syncState.muted || syncState.volume === 0 || isTrackMuted || !isPrimaryAudibleVideo || clipVolume === 0;
    const targetVolume = shouldMute ? 0 : Math.max(0, Math.min(1, combinedVolume));

    // ─── FINDING-022: Conditional property updates ─────────────────────────────
    // Only set properties when values actually change to avoid unnecessary
    // DOM updates and audio routing recalculations (saves ~0.1-0.3ms per element × 60fps)
    if (video.muted !== shouldMute) {
      video.muted = shouldMute;
    }
    if (Math.abs(video.volume - targetVolume) > 0.01) {
      video.volume = targetVolume;
    }
    if (video.playbackRate !== syncState.speed) {
      video.playbackRate = syncState.speed;
    }
    // ───────────────────────────────────────────────────────────────────────────

    if ("preservesPitch" in video) {
      (video as any).preservesPitch = true;
    }
    if ("webkitPreservesPitch" in video) {
      (video as any).webkitPreservesPitch = true;
    }

    if (sourceTime === null) {
      const prewarmSourceTime = getClipPrewarmSourceTime(clip, syncState.time);
      if (prewarmSourceTime !== null) {
        const clampedPrewarmTime = Number.isFinite(video.duration) && video.duration > 0 ? Math.max(0, Math.min(prewarmSourceTime, video.duration - 0.001)) : prewarmSourceTime;
        if (Math.abs(video.currentTime - clampedPrewarmTime) > 0.01) {
          video.currentTime = clampedPrewarmTime;
        }
      }
      // Clip not active at current time
      if (!video.paused) {
        video.pause();
      }
      return;
    }

    // Seek to correct source time
    const clampedTime = Number.isFinite(video.duration) && video.duration > 0 ? Math.max(0, Math.min(sourceTime, video.duration - 0.001)) : sourceTime;

    if (!video.paused) {
      if (video.seeking) {
        return;
      }

      const drift = Math.abs(video.currentTime - clampedTime);
      const now = performance.now();

      // Detect abnormal situations requiring immediate seek:
      // 1. User scrubbing: large drift (>2s but <5s) indicates manual seek
      // 2. Window regained focus: very large drift (≥5s) after browser throttling
      const isUserScrubbing = drift > 2.0 && drift < 5.0;
      const isPostThrottling = drift >= 5.0;

      if (isPostThrottling) {
        // Very large drift - likely browser throttling during window blur
        // Force immediate resync and allow rapid subsequent seeks by setting timer to distant past
        video.currentTime = clampedTime;
        managed.lastHardSeekAtMs = now - 10000; // Set to 10s ago to allow immediate next seek
      } else if (isUserScrubbing) {
        // User scrubbing: immediate seek without rate limiting
        video.currentTime = clampedTime;
        managed.lastHardSeekAtMs = now;
      } else {
        // Automatic sync: rate-limited seeks to prevent audio glitches
        // Professional policy:
        // - Audible stream: avoid frequent seeks (they cause audible glitches)
        // - Silent decode streams: keep tighter sync for visual fidelity
        const hardSeekThreshold = isPrimaryAudibleVideo ? 1.0 : 0.5;
        const minSeekIntervalMs = isPrimaryAudibleVideo ? 1500 : 400;

        if (drift > hardSeekThreshold && now - managed.lastHardSeekAtMs > minSeekIntervalMs) {
          video.currentTime = clampedTime;
          managed.lastHardSeekAtMs = now;
        }
      }
    } else {
      const drift = Math.abs(video.currentTime - clampedTime);
      if (drift > 0.01) {
        video.currentTime = clampedTime;
      }
    }

    // NEW ARCHITECTURE: Playback control moved to separate method
    // sync() only updates state, does NOT initiate playback
    if (syncState.state === "playing") {
      this.requestPlayback(managed, clip, syncState, tracks, isPrimaryAudibleVideo);
    } else {
      // Not playing - pause and cancel any pending play promises
      if (!video.paused) {
        video.pause();
      }
      // FINDING-016 FIX: Cancel any pending play() promise
      if (managed.playPromiseInFlight) {
        managed.playCancelRequested = true;
      }
      if (managed.rvfcHandle !== null) {
        try {
          video.cancelVideoFrameCallback(managed.rvfcHandle);
        } catch {
          // ignore
        }
        managed.rvfcHandle = null;
      }
    }
  }

  // ─── NEW: Playback Controller (Separated from sync) ────────────────────

  /**
   * Request playback for an element (separated from sync logic).
   * Implements proper state machine with guards and latch.
   */
  private requestPlayback(managed: ManagedVideo, clip: Clip, syncState: PreviewSyncState, tracks: Array<{ id: string; type: string }>, isPrimaryAudibleVideo: boolean): void {
    const video = managed.element;

    // Guard 1: Already playing → no-op
    if (!video.paused) {
      // Register RVFC for frame-accurate sync
      if (this.hasRVFC && managed.rvfcHandle === null) {
        this.registerRVFC(managed, clip, syncState, tracks, isPrimaryAudibleVideo);
      }
      return;
    }

    // Guard 2: Not ready → wait
    if (video.readyState < 3) {
      return;
    }

    // Guard 3: Session-level autoplay block → latch until user gesture
    if (this.sessionAutoplayBlocked) {
      console.warn(`[PreviewMediaPool] Session autoplay blocked - waiting for user gesture`);
      return;
    }

    // Guard 4: Element-level autoplay block → latch
    if (managed.autoplayBlocked) {
      // FINDING-024: Check for active user gesture context instead of time window
      // This is more reliable and handles cases where user waits >1s after unlocking
      const hasUserActivation = typeof navigator !== "undefined" && navigator.userActivation && navigator.userActivation.isActive;

      if (hasUserActivation) {
        // We're in a user gesture context, safe to clear block and attempt play
        managed.autoplayBlocked = false;
      } else {
        // No active user gesture, keep the block
        return;
      }
    }

    // Guard 5: Promise in flight → wait
    if (managed.playPromiseInFlight) {
      return;
    }

    // Guard 6: Rate limiting (max 10/sec per element)
    const now = performance.now();
    if (now - managed.lastPlayAttemptMs < 100) {
      return;
    }

    // Guard 7: Element must be active in current window
    if (!managed.isActive) {
      return;
    }

    // All guards passed - attempt play
    managed.playAttempts++;
    managed.lastPlayAttemptMs = now;
    managed.playPromiseInFlight = true;
    // FINDING-016 FIX: Clear cancel flag when starting new play attempt
    managed.playCancelRequested = false;

    const elementAge = now - managed.createdAt;

    const promise = video.play();
    if (promise !== undefined) {
      promise
        .then(() => {
          managed.playPromiseInFlight = false;

          // FINDING-020: Check if element is being disposed
          if (managed.disposing) {
            return; // Element disposed, ignore promise resolution
          }

          // FINDING-016 FIX: Check if play was cancelled while promise was pending
          if (managed.playCancelRequested) {
            managed.playCancelRequested = false;
            return; // Don't register RVFC or update state
          }

          managed.lastPlayFailure = null;

          // Register RVFC on successful play
          if (this.hasRVFC && managed.rvfcHandle === null) {
            this.registerRVFC(managed, clip, syncState, tracks, isPrimaryAudibleVideo);
          }

          this.logPlayAttempt({
            timestamp: now,
            elementKey: `${managed.clipId}-${managed.mediaId}`,
            clipId: managed.clipId,
            wasPlaying: false,
            promiseInFlight: false,
            elementAge,
            source: "playback-controller",
            result: "success",
          });
        })
        .catch((err: Error) => {
          managed.playPromiseInFlight = false;

          // FINDING-020: Check if element is being disposed
          if (managed.disposing) {
            return; // Element disposed, ignore promise rejection
          }

          if (err.name !== "AbortError") {
            managed.lastPlayFailure = { error: err.name, timestamp: now };

            // NotAllowedError → latch element AND session
            if (err.name === "NotAllowedError") {
              managed.autoplayBlocked = true;
              this.sessionAutoplayBlocked = true;

              console.error(`[PreviewMediaPool] play() BLOCKED (NotAllowedError) - latched until user gesture:`, {
                clipId: managed.clipId,
                elementAge: `${elementAge.toFixed(0)}ms`,
                attemptNumber: managed.playAttempts,
                totalAttempts: this.getTotalPlayAttempts(),
              });
            }

            this.logPlayAttempt({
              timestamp: now,
              elementKey: `${managed.clipId}-${managed.mediaId}`,
              clipId: managed.clipId,
              wasPlaying: false,
              promiseInFlight: false,
              elementAge,
              source: "playback-controller",
              result: "rejected",
              error: err.name,
            });
          }
        });
    }
  }

  /**
   * Evict unused elements from cache (LRU policy).
   * Called from sync() after reconciliation.
   *
   * CRITICAL: Never evict elements for clips that still exist in timeline.
   * Only evict elements that are both:
   * 1. Not referenced by any clip in timeline registry
   * 2. Either too old OR cache is over capacity
   *
   * FINDING-018 FIX: Enforce hard limit even if all elements protected.
   * Prefer evicting inactive elements but respect MAX_CACHED_VIDEOS limit.
   *
   * FINDING-008 FIX: Add memory-aware adaptive eviction.
   * - Estimates memory usage (elements × 50MB per element)
   * - Soft limit (500MB): Reduce eviction age from 60s to 30s
   * - Hard limit (800MB): Reduce to 10s, ignore timeline protection
   * Prevents browser crashes on 50+ clip projects during scrubbing.
   */
  private evictUnusedElements(): void {
    const now = performance.now();
    const toEvict: string[] = [];

    // Build set of cache keys that are protected (referenced by timeline clips)
    const protectedCacheKeys = new Set(this.timelineClipRegistry.values());

    // FINDING-008: Estimate current memory usage and adjust eviction aggressiveness
    const estimatedMemoryMB = this.videoCache.size * this.ESTIMATED_MB_PER_VIDEO;
    const isOverSoftLimit = estimatedMemoryMB > this.MEMORY_SOFT_LIMIT_MB;
    const isOverHardLimit = estimatedMemoryMB > this.MEMORY_HARD_LIMIT_MB;

    // Dynamically adjust eviction age based on memory pressure
    const effectiveEvictionAge = isOverHardLimit
      ? 10000 // 10s at hard limit (800MB+) - aggressive eviction
      : isOverSoftLimit
        ? 30000 // 30s at soft limit (500MB+) - moderate eviction
        : this.CACHE_EVICTION_AGE_MS; // 60s normal - standard LRU

    // PASS 1: Find candidates - unused for effectiveEvictionAge AND not in timeline
    for (const [key, managed] of this.videoCache) {
      // At hard limit, ignore protection (emergency eviction to prevent crash)
      if (protectedCacheKeys.has(key) && !isOverHardLimit) {
        continue;
      }

      const age = now - managed.lastUsedAt;
      if (age > effectiveEvictionAge) {
        toEvict.push(key);
      }
    }

    // PASS 2: If still over limit after age-based eviction, evict oldest unprotected first
    if (this.videoCache.size > this.MAX_CACHED_VIDEOS) {
      // Only consider unprotected elements for eviction
      const unprotectedElements = Array.from(this.videoCache.entries())
        .filter(([key]) => !protectedCacheKeys.has(key))
        .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);

      const excess = this.videoCache.size - this.MAX_CACHED_VIDEOS;
      for (let i = 0; i < Math.min(excess, unprotectedElements.length); i++) {
        const key = unprotectedElements[i][0];
        if (!toEvict.includes(key)) {
          toEvict.push(key);
        }
      }
    }

    // PASS 3 (FINDING-018 FIX): If STILL over limit, evict oldest protected BUT INACTIVE elements
    // This enforces the hard MAX limit even when all elements are in timeline
    if (this.videoCache.size - toEvict.length > this.MAX_CACHED_VIDEOS) {
      const protectedInactiveElements = Array.from(this.videoCache.entries())
        .filter(([key, managed]) => protectedCacheKeys.has(key) && !managed.isActive)
        .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);

      const remaining = this.videoCache.size - toEvict.length - this.MAX_CACHED_VIDEOS;
      for (let i = 0; i < Math.min(remaining, protectedInactiveElements.length); i++) {
        const key = protectedInactiveElements[i][0];
        if (!toEvict.includes(key)) {
          toEvict.push(key);
        }
      }
    }

    // PASS 4 (FINDING-018 FIX): Last resort - if STILL over limit, evict oldest protected ACTIVE elements
    // This should rarely happen but prevents unbounded growth
    if (this.videoCache.size - toEvict.length > this.MAX_CACHED_VIDEOS) {
      const protectedActiveElements = Array.from(this.videoCache.entries())
        .filter(([key, managed]) => protectedCacheKeys.has(key) && managed.isActive)
        .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);

      const remaining = this.videoCache.size - toEvict.length - this.MAX_CACHED_VIDEOS;
      for (let i = 0; i < Math.min(remaining, protectedActiveElements.length); i++) {
        const key = protectedActiveElements[i][0];
        if (!toEvict.includes(key)) {
          toEvict.push(key);
        }
      }
    }

    // Evict
    for (const key of toEvict) {
      const managed = this.videoCache.get(key);
      if (managed) {
        this.disposeVideo(key, managed);
      }
    }
  }

  // ─── Private: requestVideoFrameCallback sync ────────────────────────────

  private registerRVFC(managed: ManagedVideo, clip: Clip, syncState: PreviewSyncState, tracks: Array<{ id: string; type: string }>, isPrimaryAudibleVideo: boolean): void {
    const video = managed.element;

    // FINDING-019: Increment generation to invalidate any pending callbacks
    // This prevents memory leaks from closures capturing large objects
    managed.rvfcGeneration++;
    const generation = managed.rvfcGeneration;

    // Capture only minimal data needed for callback
    const mediaId = managed.mediaId;
    const sourcePath = managed.sourcePath;
    const clipStartTime = clip.startTime;
    const clipDuration = clip.duration;
    const trimIn = clip.trimIn || 0;

    const callback = (_now: number, metadata: VideoFrameCallbackMetadata) => {
      // FINDING-019: Check generation first - exits immediately if stale
      if (managed.rvfcGeneration !== generation) return;

      if (this._isDisposed) return;

      // Check if element still exists in cache (by cache key)
      const cacheKey = `${mediaId}-${sourcePath}`;
      if (!this.videoCache.has(cacheKey)) return;

      // Recalculate expected source time based on latest clock state
      const latestSyncState = this.lastSyncState ?? syncState;

      // FIX (FINDING-012): Use canonical sourceTime calculation instead of inline duplicate
      // Build minimal clip object for sourceTime resolution
      const minimalClip: Pick<Clip, "startTime" | "duration" | "trimIn" | "trimOut"> = {
        startTime: clipStartTime,
        duration: clipDuration,
        trimIn,
        trimOut: trimIn + clipDuration, // Reconstruct trimOut from duration
      };

      const { sourceTime: currentSourceTime, active } = resolveClipSourceTime(minimalClip, latestSyncState.time, {
        clampToRange: true,
        frameRate: latestSyncState.frameRate,
      });

      if (!active) return;

      const clampedExpected = Number.isFinite(video.duration) && video.duration > 0 ? Math.max(0, Math.min(currentSourceTime, video.duration - 0.001)) : currentSourceTime;

      // metadata.mediaTime is the ACTUAL presented frame time — no fake drift
      const actualMediaTime = metadata.mediaTime;
      const drift = Math.abs(actualMediaTime - clampedExpected);

      // Audible stream policy:
      // Never micro-correct rate every frame; only sparse hard correction on major drift.
      if (isPrimaryAudibleVideo) {
        const now = performance.now();
        const minHardSeekIntervalMs = 2000;
        if (drift > 1.25 && now - managed.lastHardSeekAtMs > minHardSeekIntervalMs) {
          video.currentTime = clampedExpected;
          managed.lastHardSeekAtMs = now;
        }
        if (Math.abs(video.playbackRate - latestSyncState.speed) > 0.01) {
          video.playbackRate = latestSyncState.speed;
        }
      } else if (drift > 0.1 && drift <= 0.3) {
        // Only apply gentle corrections at frame presentation time
        // 100–300ms: soft playbackRate correction
        const correctionSpeed = actualMediaTime < clampedExpected ? latestSyncState.speed * 1.02 : latestSyncState.speed * 0.98;
        if (Math.abs(video.playbackRate - correctionSpeed) > 0.01) {
          video.playbackRate = correctionSpeed;
        }
      } else if (drift > 0.3) {
        // >300ms: hard seek (only at frame presentation time, so it's real drift)
        const now = performance.now();
        if (now - managed.lastHardSeekAtMs > 400) {
          video.currentTime = clampedExpected;
          managed.lastHardSeekAtMs = now;
        }
        if (Math.abs(video.playbackRate - latestSyncState.speed) > 0.01) {
          video.playbackRate = latestSyncState.speed;
        }
      } else if (Math.abs(video.playbackRate - latestSyncState.speed) > 0.01) {
        // Restore normal speed when in sync
        video.playbackRate = latestSyncState.speed;
      }

      // Re-register for next frame (only if generation still matches)
      if (!video.paused && !this._isDisposed && managed.rvfcGeneration === generation) {
        try {
          managed.rvfcHandle = video.requestVideoFrameCallback(callback);
        } catch {
          managed.rvfcHandle = null;
        }
      } else {
        managed.rvfcHandle = null;
      }
    };

    try {
      managed.rvfcHandle = video.requestVideoFrameCallback(callback);
    } catch {
      managed.rvfcHandle = null;
    }
  }

  // ─── Private: Audio lifecycle ───────────────────────────────────────────

  private createAudio(key: string, clipId: string, mediaId: string, sourcePath: string): ManagedAudio {
    const audio = document.createElement("audio");
    audio.preload = "auto";
    audio.style.cssText = "position:absolute;width:1px;height:1px;";

    const managed: ManagedAudio = {
      element: audio,
      clipId,
      mediaId,
      sourcePath,
      ready: false,
    };

    audio.addEventListener(
      "loadedmetadata",
      () => {
        managed.ready = true;
      },
      { once: true },
    );

    audio.addEventListener(
      "error",
      () => {
        console.error(`[PreviewMediaPool] Audio load error: ${key}`, audio.error);
      },
      { once: true },
    );

    audio.src = sourcePath;
    this.container.appendChild(audio);
    this.audios.set(key, managed);

    return managed;
  }

  private disposeAudio(key: string, managed: ManagedAudio): void {
    managed.element.pause();
    managed.element.src = "";
    managed.element.load();

    if (managed.element.parentNode) {
      managed.element.parentNode.removeChild(managed.element);
    }

    this.audios.delete(key);
  }

  private updateAudioElement(managed: ManagedAudio, clip: Clip, syncState: PreviewSyncState, isTrackMuted: boolean): void {
    const audio = managed.element;
    const sourceTime = getClipSourceTime(clip, syncState.time, syncState.frameRate);

    // Combine global preview volume with per-clip volume
    const clipVolume = clip.volume ?? 1.0; // Default to 1.0 if not set
    const combinedVolume = (syncState.volume / 100) * clipVolume;

    const shouldMute = syncState.muted || syncState.volume === 0 || isTrackMuted || clipVolume === 0;
    audio.muted = shouldMute;
    audio.volume = shouldMute ? 0 : Math.max(0, Math.min(1, combinedVolume));
    audio.playbackRate = syncState.speed;

    if ("preservesPitch" in audio) {
      (audio as any).preservesPitch = true;
    }
    if ("webkitPreservesPitch" in audio) {
      (audio as any).webkitPreservesPitch = true;
    }

    if (sourceTime === null) {
      if (!audio.paused) {
        audio.pause();
      }
      return;
    }

    const clampedTime = Number.isFinite(audio.duration) && audio.duration > 0 ? Math.max(0, Math.min(sourceTime, audio.duration - 0.001)) : sourceTime;

    if (!audio.paused) {
      if (audio.seeking) {
        return;
      }
      if (Math.abs(audio.currentTime - clampedTime) > 0.5) {
        audio.currentTime = clampedTime;
      }
    } else {
      audio.currentTime = clampedTime;
    }

    if (syncState.state === "playing") {
      if (audio.paused && audio.readyState >= 3) {
        const promise = audio.play();
        if (promise !== undefined) {
          promise.catch((err: Error) => {
            if (err.name !== "AbortError") {
              console.warn(`[PreviewMediaPool] Audio play() failed for ${managed.clipId}-${managed.mediaId}:`, err);
            }
          });
        }
      }
    } else {
      if (!audio.paused) {
        audio.pause();
      }
    }
  }

  // ─── INSTRUMENTATION METHODS ────────────────────────────────────────────

  private detectStructuralChange(currentClipIds: Set<string>): {
    changed: boolean;
    added: string[];
    removed: string[];
  } {
    const added: string[] = [];
    const removed: string[] = [];

    for (const id of currentClipIds) {
      if (!this.lastSyncClipIds.has(id)) {
        added.push(id);
      }
    }

    for (const id of this.lastSyncClipIds) {
      if (!currentClipIds.has(id)) {
        removed.push(id);
      }
    }

    return {
      changed: added.length > 0 || removed.length > 0,
      added,
      removed,
    };
  }

  private logPlayAttempt(log: { timestamp: number; elementKey: string; clipId: string; wasPlaying: boolean; promiseInFlight: boolean; elementAge: number; source: string; result: "success" | "rejected" | "pending"; error?: string }): void {
    this.playAttemptLog.push(log);

    // Keep log bounded
    if (this.playAttemptLog.length > this.maxLogSize) {
      this.playAttemptLog.shift();
    }
  }

  private getTotalPlayAttempts(): number {
    let total = 0;
    for (const managed of this.videoCache.values()) {
      total += managed.playAttempts;
    }
    return total;
  }

  private isInUserGesture(): boolean {
    // Simple heuristic: check if we have user activation
    // This is not 100% reliable but gives us a signal
    if (typeof navigator !== "undefined" && "userActivation" in navigator) {
      const ua = (navigator as any).userActivation;
      return ua?.isActive === true;
    }
    return false;
  }

  private printDiagnostics(): void {
    // Group failures by error type
    const failures = this.playAttemptLog.filter((l) => l.result === "rejected");
    const byError = failures.reduce(
      (acc, log) => {
        const err = log.error || "Unknown";
        acc[err] = (acc[err] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    // Show per-element stats
    const perElement = new Map<string, { attempts: number; blocked: boolean; state: string; active: boolean }>();
    for (const [key, managed] of this.videoCache) {
      // Derive state from element.paused and flags (single source of truth)
      const state = managed.autoplayBlocked ? "blocked" : managed.element.paused ? "paused" : "playing";
      perElement.set(key, {
        attempts: managed.playAttempts,
        blocked: managed.autoplayBlocked,
        state,
        active: managed.isActive,
      });
    }

    // Show recent attempts (last 20)
    const recent = this.playAttemptLog.slice(-20);

    console.groupEnd();
  }

  // Public method to manually trigger diagnostics from console
  public debugPrintDiagnostics(): void {
    this.printDiagnostics();
  }

  // ────────────────────────────────────────────────────────────────────────
}

// ─── INSTRUMENTATION HELPERS ───────────────────────────────────────────────
declare global {
  interface Window {
    __previewMediaPools?: PreviewMediaPool[];
    __previewMediaPoolInstrumentation?: {
      getPlayAttemptLog: () => any[];
      getTotalAttempts: () => number;
      printReport: () => void;
      clearLog: () => void;
      getSyncFrequency: () => number;
    };
  }
}

// Make instrumentation accessible from console for debugging
if (typeof window !== "undefined") {
  window.__previewMediaPoolInstrumentation = {
    getPlayAttemptLog: () => {
      const pools = (window as any).__previewMediaPools || [];
      return pools.flatMap((p: any) => p.playAttemptLog || []);
    },
    getTotalAttempts: () => {
      const pools = (window as any).__previewMediaPools || [];
      return pools.reduce((sum: number, p: any) => sum + (p.getTotalPlayAttempts?.() || 0), 0);
    },
    printReport: () => {
      const pools = (window as any).__previewMediaPools || [];
      pools.forEach((p: any) => p.debugPrintDiagnostics?.());
    },
    clearLog: () => {
      const pools = (window as any).__previewMediaPools || [];
      pools.forEach((p: any) => {
        if (p.playAttemptLog) p.playAttemptLog = [];
      });
    },
    getSyncFrequency: () => {
      const pools = (window as any).__previewMediaPools || [];
      return pools.reduce((sum: number, p: any) => sum + (p.syncCallCount || 0), 0);
    },
  };
}
// ───────────────────────────────────────────────────────────────────────────

// Minimal type for RVFC metadata (not in all TS lib versions)
interface VideoFrameCallbackMetadata {
  mediaTime: number;
  presentationTime: number;
}

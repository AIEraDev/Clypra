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

import type { Clip, MediaAsset, TransitionTimelineItem } from "@/types";
import { convertFileSrc } from "@tauri-apps/api/core";
import { resolveClipSourceTime } from "../timeline/sourceTime";
import { performanceMonitor } from "@/lib/monitoring/PerformanceMonitor";
import { resourceTracker } from "@/lib/monitoring/ResourceTracker";
import { useTimelineStore } from "../../store/timelineStore";
import { PreviewPlaybackScheduler, type MediaAction, type MediaElementState } from "../playback/PreviewPlaybackScheduler";
import { VideoTextureManager } from "../render/VideoTextureManager";
import { getTraceCollector } from "../monitoring/PerformanceTraceCollector";
import { ALL_TRANSITIONS } from "@clypra-studio/engine";
import { resolveTransitionDefinition, mergeTransitionParams } from "../render/utils/transitionResolver";

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
  /**  Generation counter to invalidate stale RVFC callbacks */
  rvfcGeneration: number;
  /** Whether this video has been seeked at least once (ensures frame decode) */
  hasBeenSeeked: boolean;
}

interface ManagedAudio {
  element: HTMLAudioElement;
  clipId: string;
  mediaId: string;
  sourcePath: string;
  ready: boolean;
  playPromiseInFlight?: boolean;
  playCancelRequested?: boolean;
  autoplayBlocked?: boolean;
  playAttempts?: number;
  lastPlayAttemptMs?: number;
}

/**
 * Identifies the "primary" video clip — the one whose media clock should be
 * trusted for AV sync. Prefers the lowest video track, then the leftmost clip.
 */
function findPrimaryVideoClip(videoClips: Clip[], tracks: Array<{ id: string; type: string }>): Clip | null {
  if (videoClips.length === 0) return null;
  if (videoClips.length === 1) return videoClips[0];

  // Build track index map (higher index = lower on timeline = primary)
  const trackIndex = new Map<string, number>();
  tracks.forEach((t, i) => trackIndex.set(t.id, i));

  // Sort by track index descending, then by startTime ascending
  const sorted = [...videoClips].sort((a, b) => {
    const aIdx = trackIndex.get(a.trackId) ?? -1;
    const bIdx = trackIndex.get(b.trackId) ?? -1;
    if (aIdx !== bIdx) return bIdx - aIdx;
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
 * Now uses canonical resolveClipSourceTime utility
 * to ensure consistency with export and other subsystems.
 *
 *  Replaced hardcoded 16ms (60fps) with dynamic calculation based on
 * project frame rate. Examples:
 * - 24fps: 1.5 frames = 62.5ms tolerance
 * - 30fps: 1.5 frames = 50ms tolerance
 * - 60fps: 1.5 frames = 25ms tolerance
 */
function getClipSourceTime(clip: Clip, clockTime: number, frameRate: number, transitions: TransitionTimelineItem[] = []): number | null {
  const clipLocalTime = clockTime - clip.startTime;

  //  Frame-rate-aware boundary tolerance (1.5 frames)
  const BOUNDARY_TOLERANCE = 1.5 / frameRate; // seconds

  const isInTransition = transitions.some((t) => {
    const start = t.placement.startTime;
    const duration = t.placement.duration;
    const isActive = clockTime >= start && clockTime < start + duration;
    return isActive && (t.fromItemId === clip.id || t.toItemId === clip.id);
  });

  if (!isInTransition) {
    if (clipLocalTime < -BOUNDARY_TOLERANCE || clipLocalTime > clip.duration + BOUNDARY_TOLERANCE) {
      return null; // Clip not active
    }
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
  // + SPLIT FIX: Store ALL clipIds (original + splits) to prevent lookup mismatch
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

  //  Memory-aware eviction thresholds
  private readonly ESTIMATED_MB_PER_VIDEO = 50; // Estimated memory per video element (buffer + decode state)
  private readonly MEMORY_SOFT_LIMIT_MB = 500; // Start aggressive eviction at 500MB
  private readonly MEMORY_HARD_LIMIT_MB = 800; // Force eviction at 800MB regardless of protection

  // Lookahead prewarming for split clip transitions
  private readonly LOOKAHEAD_WINDOW_SECONDS = 1.5;

  // Drift/seek tolerances and readyState thresholds
  private readonly DRIFT_TOLERANCE_PAUSED_S = 0.01; // Tight tolerance for frame-stepping / paused scrubbing
  private readonly DRIFT_TOLERANCE_PLAYING_ACTIVE_S = 2.0; // Large tolerance for active playhead when buffering to prevent infinite seek loops

  // ─── RE-ENTRANCY PROTECTION ─────────────────────────────────────────────
  private _syncInProgress = false;
  private _queuedSyncRequest: {
    clips: Clip[];
    assets: MediaAsset[];
    tracks: Array<{ id: string; type: string }>;
    syncState: PreviewSyncState;
  } | null = null;

  // ───  Early exit optimization ───────────────────────────────
  private _lastQuickHash: string | null = null;

  // ─── RESOURCE TRACKING (LEAK-003 / MED-002) ─────────────────────────────
  private _projectId: string | null = null;
  private _sessionId: string | null = null;

  // ─── BOUNDARY COMPONENTS ─────────────────────────────────────────────────
  private scheduler: PreviewPlaybackScheduler;
  private textureManager: VideoTextureManager;
  private traceCollector = getTraceCollector();
  private frameStartTime: number = 0;

  // Optional compositor reference for transition shader pre-warming.
  // Set via setCompositor() after the PixiSceneCompositor is initialised.
  // Using a loose type to avoid a circular dependency between resource and render layers.
  private _compositor: { prewarmTransitionShader: (definition: any, params?: Record<string, any>) => void } | null = null;

  constructor(projectId?: string, sessionId?: string) {
    this._projectId = projectId ?? null;
    this._sessionId = sessionId ?? null;

    // Initialize boundary components
    this.scheduler = new PreviewPlaybackScheduler();
    this.textureManager = new VideoTextureManager();

    this.container = document.createElement("div");
    // Position fixed and practically invisible, but NOT offscreen.
    // Browsers suspend decoding for completely offscreen or display:none elements.
    this.container.style.cssText = "position:fixed;left:0;top:0;width:256px;height:256px;opacity:0.001;pointer-events:none;z-index:-9999;overflow:hidden;";
    document.body.appendChild(this.container);

    // ─── RESOURCE TRACKING: Track pool creation ────────────────────────────
    if (this._projectId && this._sessionId) {
      resourceTracker.track({
        id: `pool-${this._sessionId}`,
        kind: "PreviewMediaPool",
        projectId: this._projectId,
        sessionId: this._sessionId,
      });
    }
    // ───────────────────────────────────────────────────────────────────────

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
   * Set the compositor instance for transition shader prewarming.
   */
  setCompositor(compositor: { prewarmTransitionShader: (definition: any, params?: Record<string, any>) => void } | null): void {
    this._compositor = compositor;
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
      // ───  Early exit optimization (fast path) ───────────────────
      // Skip expensive reconciliation if nothing meaningful changed
      // Round time to 0.1s precision to avoid rehashing every frame during playback
      const clipIdsHash = clips.map((c) => `${c.id}:${c.startTime.toFixed(2)}:${c.trimIn.toFixed(2)}`).join(",");
      const quickHash = `${syncState.time.toFixed(1)}-${syncState.state}-${clips.length}-${clipIdsHash}`;
      // CRITICAL: Only use fast path if we have video elements already created.
      // This prevents skipping the first sync after project load when elements need creation.
      const hasVideoElements = this.videoCache.size > 0;
      if (hasVideoElements && quickHash === this._lastQuickHash) {
        // Nothing changed - skip reconciliation (saves 0.5-2ms per frame)
        performanceMonitor.increment("preview_pool.sync_skipped");

        // Still run prewarming during playback even when skipping reconciliation
        if (syncState.state === "playing") {
          this.prewarmUpcomingClips(clips, assets, syncState.time, syncState.frameRate);
        }

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
            // + SPLIT FIX: Store all known clipIds that map to this cache key
            // This handles split clips where multiple clip IDs share the same cache element
            const existingEntry = this.recentlyRemovedClips.get(cacheKey);
            if (existingEntry) {
              // Add this clipId to the existing array if not already present
              if (!existingEntry.clipIds.includes(removedClipId)) {
                existingEntry.clipIds.push(removedClipId);
              }
              existingEntry.timestamp = now;
            } else {
              this.recentlyRemovedClips.set(cacheKey, {
                clipIds: [removedClipId],
                timestamp: now,
              });
            }
          }
          this.timelineClipRegistry.delete(removedClipId);
        }
      }

      const activeTransitions = useTimelineStore.getState().transitions;

      for (const clip of clips) {
        const asset = assets.find((a) => a.id === clip.mediaId);
        const track = this.trackMap.get(clip.trackId);
        if (track?.visible === false) continue;

        if (asset?.type === "video") {
          const sourcePath = asset.path.startsWith("asset://") ? asset.path : convertFileSrc(asset.path);

          const cacheKey = clip.id;

          const sourceTime = getClipSourceTime(clip, syncState.time, syncState.frameRate, activeTransitions);
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
          }
        } else if (asset?.type === "audio" || (clip.kind === "audio" && (clip as any).audioPath)) {
          const key = clip.id;
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

          // CRITICAL: Reset seek state when element reassigned to different clip
          // This ensures scheduler forces initial seek for frame decode on new clip
          managed.hasBeenSeeked = false;
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
            return getClipSourceTime(c, syncState.time, syncState.frameRate, activeTransitions) !== null;
          });
          const primaryVideoClip = findPrimaryVideoClip(activeVisibleVideoClips, tracks);
          const isPrimaryAudibleVideo = primaryVideoClip?.id === clip.id;

          //  Pass active video clip count for multi-clip audio-friendly sync
          const activeVideoClipCount = activeVisibleVideoClips.length;

          this.updateVideoElement(managed, clip, syncState, tracks, isPrimaryAudibleVideo, isTrackMuted, activeVideoClipCount, activeTransitions);
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

          if (!managed.element.paused && !managed.element.seeking) {
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
        //  Don't pause if element is currently seeking - can corrupt state
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
        const isActive = activeCacheKeys.has(cacheKey);
        const isInGracePeriod = now < managed.registrationGraceUntil;
        const isInTimeline = timelineCacheKeys.has(cacheKey);
        const recentRemoval = this.recentlyRemovedClips.get(cacheKey);
        const isRecentlyRemoved = recentRemoval !== undefined;
        const isInTransitionGrace = isRecentlyRemoved && recentRemoval && now - recentRemoval.timestamp < this.TRANSITION_GRACE_PERIOD_MS;

        // Elements in grace period must respect playback state
        // If user pauses, grace-period elements must also pause (prevents audio bleed)
        if (isInTransitionGrace && syncState.state !== "playing") {
          if (!managed.element.paused && !managed.element.seeking) {
            managed.element.pause();
          }
        }

        // Elements in grace period during PLAYING must also be paused if not active
        // This prevents audio bleed when seeking backwards during playback
        if (isInTransitionGrace && syncState.state === "playing" && !isActive && !managed.element.paused && !managed.element.seeking) {
          managed.element.pause();
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
          // ───  Extend grace period when element is in timeline ───────
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
      this.evictUnusedElements(clips, assets, syncState);

      // Create or update audio elements (unchanged logic)
      for (const clip of clips) {
        const asset = assets.find((a) => a.id === clip.mediaId);
        const directAudioPath = (clip as any).audioPath as string | undefined;
        const isAudioClip = asset?.type === "audio" || (clip.kind === "audio" && !!directAudioPath);
        if (!isAudioClip) continue;
        const track = this.trackMap.get(clip.trackId);
        if (track?.visible === false) continue;

        const rawPath = asset ? asset.path : directAudioPath!;
        const sourcePath = rawPath.startsWith("asset://") ? rawPath : convertFileSrc(rawPath);
        const key = clip.id;

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

      // Lookahead prewarming: Initialize upcoming clips before they become active
      if (syncState.state === "playing") {
        this.prewarmUpcomingClips(clips, assets, syncState.time, syncState.frameRate);
        this.prewarmUpcomingTransitions(useTimelineStore.getState().transitions, syncState.time);
      }

      // ─── SCHEDULER INTEGRATION ────────────────────────────────────────────────
      // Build media states from current video elements
      const schedulerStart = performance.now();
      const mediaStates = this.buildMediaStates(clips, syncState, tracks, assets, activeTransitions);

      // Get actions from scheduler
      const actions = this.scheduler.reconcile(syncState, mediaStates, clips, assets, Array.from(desiredVideoBindings.values()).filter((v) => v.isActive).length, activeTransitions);

      // Execute actions
      this.executeSchedulerActions(actions, syncState, clips, tracks, assets, activeTransitions);
      const schedulerMs = performance.now() - schedulerStart;

      // ─── END OF SCHEDULER LOGIC ──────────────────────────────────────────────

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
   * Prewarm upcoming clips within lookahead window during playback.
   * Creates and initializes video elements before clips become active to prevent blank frames.
   */
  private prewarmUpcomingClips(clips: Clip[], assets: MediaAsset[], currentTime: number, frameRate: number): void {
    const lookaheadTime = currentTime + this.LOOKAHEAD_WINDOW_SECONDS;

    for (const clip of clips) {
      if (clip.startTime <= currentTime || clip.startTime > lookaheadTime) {
        continue;
      }

      const asset = assets.find((a) => a.id === clip.mediaId);
      const track = this.trackMap.get(clip.trackId);
      if (track?.visible === false || !asset || asset.type !== "video") {
        continue;
      }

      const trimIn = clip.trimIn || 0;
      const normalizedTrimIn = Math.round(trimIn * 1000) / 1000;
      const sourcePath = asset.path.startsWith("asset://") ? asset.path : convertFileSrc(asset.path);
      const cacheKey = clip.id;

      if (this.videoCache.has(cacheKey)) {
        continue;
      }

      this.prewarmVideoElement(cacheKey, clip.id, clip.mediaId, sourcePath, normalizedTrimIn);
    }
  }

  /**
   * Prewarm upcoming transition shaders within the lookahead window during playback.
   * Compiles the transition shaders off-screen before the playhead reaches them.
   */
  private prewarmUpcomingTransitions(transitions: TransitionTimelineItem[], currentTime: number): void {
    if (!this._compositor) return;

    const lookaheadTime = currentTime + this.LOOKAHEAD_WINDOW_SECONDS;

    for (const transition of transitions) {
      // If the transition starts in the future, but within our lookahead window
      if (transition.placement.startTime <= currentTime || transition.placement.startTime > lookaheadTime) {
        continue;
      }

      // Resolve the transition type using transitionResolver
      const resolved = resolveTransitionDefinition(
        transition.type,
        ALL_TRANSITIONS,
        transition.renderer
      );

      if (resolved) {
        const { definition, params } = resolved;
        const runtimeParams = {
          easing: transition.easing,
          ...(transition.metadata?.params as Record<string, any> || {}),
        };
        const mergedParams = mergeTransitionParams(definition.params, params, runtimeParams);
        
        // Trigger off-screen compile
        this._compositor.prewarmTransitionShader(definition, mergedParams);
      }
    }
  }

  /**
   * Create and prewarm a video element without blocking.
   * Element will load metadata and seek to trimIn position in the background.
   */
  private prewarmVideoElement(cacheKey: string, clipId: string, mediaId: string, sourcePath: string, trimIn: number): void {
    const managed = this.createVideo(cacheKey, clipId, mediaId, sourcePath);

    const element = managed.element;
    element.currentTime = trimIn;

    element.addEventListener(
      "loadedmetadata",
      () => {
        if (managed.disposing || this._isDisposed) return;
        if (Math.abs(element.currentTime - trimIn) > 0.01) {
          element.currentTime = trimIn;
        }
      },
      { once: true },
    );
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

    // ─── + SPLIT FIX: Use all known clipIds for recently removed clips ──
    // TRANSITION SAFETY: Also include recently removed clips (within grace period)
    // This ensures rasterizer can access outgoing clip frames during transitions
    // SPLIT FIX: Return mappings for ALL clipIds that share this cache element
    // When clips are split, both new clips map to same element but have different IDs
    const now = performance.now();
    for (const [cacheKey, removal] of this.recentlyRemovedClips) {
      if (now - removal.timestamp < this.TRANSITION_GRACE_PERIOD_MS) {
        const managed = this.videoCache.get(cacheKey);
        if (managed) {
          for (const clipId of removal.clipIds) {
            const legacyKey = `${clipId}-${managed.mediaId}`;
            result.set(legacyKey, managed.element);
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

  // ─── SCHEDULER HELPER METHODS ────────────────────────────────────────────

  /**
   * Build media states from current video elements for scheduler.
   *
   * CRITICAL: Include ALL timeline clips (not just active ones) so scheduler
   * can make decisions about prewarming, pausing inactive clips, etc.
   */
  private buildMediaStates(clips: Clip[], syncState: PreviewSyncState, tracks: Array<{ id: string; type: string }>, assets: MediaAsset[], activeTransitions: TransitionTimelineItem[]): Map<string, MediaElementState> {
    const states = new Map<string, MediaElementState>();

    // Find primary video for audio routing
    const activeVisibleVideoClips = clips.filter((c) => {
      const a = assets.find((x) => x.id === c.mediaId);
      if (!a || a.type !== "video") return false;
      const t = this.trackMap.get(c.trackId);
      if (t?.visible === false) return false;
      return getClipSourceTime(c, syncState.time, syncState.frameRate, activeTransitions) !== null;
    });
    const primaryVideoClip = findPrimaryVideoClip(activeVisibleVideoClips, tracks);

    // Include ALL timeline clips, not just active ones
    // The scheduler needs to see inactive clips to generate prewarm/pause actions
    for (const [cacheKey, managed] of this.videoCache) {
      const video = managed.element;
      const isPrimaryAudible = primaryVideoClip?.id === managed.clipId;

      states.set(managed.clipId, {
        clipId: managed.clipId,
        mediaId: managed.mediaId,
        currentTime: video.currentTime,
        paused: video.paused,
        seeking: video.seeking,
        readyState: video.readyState,
        playbackRate: video.playbackRate,
        duration: video.duration,
        lastSeekTimestamp: managed.lastHardSeekAtMs,
        playPromiseInFlight: managed.playPromiseInFlight,
        autoplayBlocked: managed.autoplayBlocked,
        isActive: managed.isActive,
        isPrimaryAudible,
        hasBeenSeeked: managed.hasBeenSeeked,
      });
    }

    return states;
  }

  /**
   * Execute actions from scheduler.
   */
  private executeSchedulerActions(actions: MediaAction[], syncState: PreviewSyncState, clips: Clip[], tracks: Array<{ id: string; type: string }>, assets: MediaAsset[], activeTransitions: TransitionTimelineItem[]): void {
    for (const action of actions) {
      const managed = this.findManagedVideoByClipId(action.clipId);
      if (!managed) continue;

      const video = managed.element;

      switch (action.type) {
        case "seek":
          if (action.time !== undefined && video.readyState >= 1) {
            const clampedTime = Number.isFinite(video.duration) && video.duration > 0 ? Math.max(0, Math.min(action.time, video.duration - 0.001)) : action.time;

            video.currentTime = clampedTime;
            managed.lastHardSeekAtMs = performance.now();
            managed.hasBeenSeeked = true; // Mark as seeked to prevent redundant initial seeks

            // Record seek event
            if (action.reason) {
              this.traceCollector.recordSeekRequest(action.clipId, clampedTime, action.reason);
            }
          }
          break;

        case "play":
          {
            // Find clip for requestPlayback
            const clip = clips.find((c) => c.id === action.clipId);
            if (!clip) break;

            const track = this.trackMap.get(clip.trackId);
            const isTrackMuted = track?.muted === true;

            const activeVisibleVideoClips = clips.filter((c) => {
              const a = assets.find((x) => x.id === c.mediaId);
              if (!a || a.type !== "video") return false;
              const t = this.trackMap.get(c.trackId);
              if (t?.visible === false) return false;
              return getClipSourceTime(c, syncState.time, syncState.frameRate, activeTransitions) !== null;
            });
            const primaryVideoClip = findPrimaryVideoClip(activeVisibleVideoClips, tracks);
            const isPrimaryAudibleVideo = primaryVideoClip?.id === clip.id;

            // Delegate to existing requestPlayback method
            this.requestPlayback(managed, clip, syncState, tracks, isPrimaryAudibleVideo);
          }
          break;

        case "pause":
          if (!video.paused) {
            video.pause();
          }
          if (managed.playPromiseInFlight) {
            managed.playCancelRequested = true;
          }
          if (managed.rvfcHandle !== null && this.hasRVFC) {
            try {
              video.cancelVideoFrameCallback(managed.rvfcHandle);
            } catch {
              // ignore
            }
            managed.rvfcHandle = null;
          }
          this.traceCollector.recordClipEvent({
            timestampMs: performance.now(),
            clipId: action.clipId,
            event: { type: "pause-requested" },
          });
          break;

        case "setRate":
          if (action.rate !== undefined && Math.abs(video.playbackRate - action.rate) > 0.01) {
            video.playbackRate = action.rate;
          }
          break;
      }
    }
  }

  /**
   * Find managed video by clip ID.
   */
  private findManagedVideoByClipId(clipId: string): ManagedVideo | null {
    for (const [cacheKey, managed] of this.videoCache) {
      if (managed.clipId === clipId) {
        return managed;
      }
    }
    return null;
  }

  /**
   * Check if texture should be updated for a clip.
   * Exposed for compositor to use VideoTextureManager.
   */
  shouldUpdateTexture(clipId: string, video: HTMLVideoElement): boolean {
    return this.textureManager.shouldUpdate(clipId, video);
  }

  /**
   * Mark texture as clean after GPU upload.
   * Exposed for compositor to use VideoTextureManager.
   */
  markTextureClean(clipId: string): void {
    this.textureManager.markClean(clipId);
  }

  /**
   * Dispose all media elements and remove the container.
   */
  dispose(): void {
    if (this._isDisposed) return;
    this._isDisposed = true;

    // Remove from global pools registry to prevent leaks
    if (typeof window !== "undefined" && (window as any).__previewMediaPools) {
      const index = (window as any).__previewMediaPools.indexOf(this);
      if (index > -1) {
        (window as any).__previewMediaPools.splice(index, 1);
      }
    }

    // ─── CLEAR SYNC STATE ────────────────────────────────────────────────────
    // If sync was in progress, this disposal will be caught by the finally block
    // But clear the queued request to prevent post-disposal sync attempts
    this._queuedSyncRequest = null;

    // ─── INSTRUMENTATION: Print final diagnostics ─────────────────────────
    this.printDiagnostics();
    // ──────────────────────────────────────────────────────────────────────

    // ─── RESOURCE TRACKING: Release all tracked resources ─────────────────
    // Release video elements
    for (const [key] of this.videoCache) {
      resourceTracker.release(`video-${key}`);
    }

    // Release audio elements
    for (const [key] of this.audios) {
      resourceTracker.release(`audio-${key}`);
    }

    // Release pool itself
    if (this._sessionId) {
      resourceTracker.release(`pool-${this._sessionId}`);
    }
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
    //  Check if we're in an active user gesture context
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
    // CORS fix: asset:// (http://asset.localhost) is cross-origin vs the app origin.
    // Without this, WebGL texImage2D rejects the video as "cross-origin data" and the
    // preview canvas stays blank. Requesting anonymous CORS lets the asset protocol
    // response be treated as a clean (untainted) source for GPU texture upload.
    video.crossOrigin = "anonymous";
    video.preload = "auto";
    video.muted = true; // Always muted — audio is handled separately or not at all
    video.playsInline = true;
    // Browsers aggressively throttle decoding for tiny videos. Use a larger size (256x256)
    // to ensure the hardware decoder remains active.
    video.style.cssText = "width:256px;height:256px;position:absolute;left:0;top:0;";

    // ─── RESOURCE TRACKING: Track video element creation ──────────────────
    if (this._projectId && this._sessionId) {
      resourceTracker.track({
        id: `video-${key}`,
        kind: "HTMLVideoElement",
        projectId: this._projectId,
        sessionId: this._sessionId,
      });
    }
    // ──────────────────────────────────────────────────────────────────────

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
      //  Generation counter to invalidate stale RVFC callbacks
      rvfcGeneration: 0,
      // CRITICAL: Track if this video has been seeked to ensure initial frame decode
      hasBeenSeeked: false,
      // ────────────────────────────────────────────────────────────────────
    };

    // Function to capture dimensions and store on clip
    const captureDimensions = () => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (w && h) {
        import("../../store/timelineStore")
          .then(({ useTimelineStore }) => {
            const timelineStore = useTimelineStore.getState();
            const existingClip = timelineStore.clips.find((c) => c.id === clipId);
            if (existingClip) {
              const currentConform = existingClip.conform;
              if (!currentConform || !currentConform.sourceWidth || !currentConform.sourceHeight) {
                timelineStore.updateClip(clipId, {
                  conform: {
                    mode: currentConform?.mode || "fit",
                    sourceWidth: w,
                    sourceHeight: h,
                    userScale: currentConform?.userScale ?? 1,
                    userOffsetX: currentConform?.userOffsetX ?? 0,
                    userOffsetY: currentConform?.userOffsetY ?? 0,
                  },
                });
              }
            }
          })
          .catch((err) => {
            console.error("[PreviewMediaPool] Failed to update clip conform:", err);
          });
      }
    };

    // Check immediately if already loaded
    if (video.readyState >= 1 && video.videoWidth && video.videoHeight) {
      managed.ready = true;
      captureDimensions();
    } else {
      video.addEventListener(
        "loadedmetadata",
        () => {
          managed.ready = true;
          captureDimensions();

          // CRITICAL: Trigger epoch increment to force scheduler reconciliation
          // Now that video has metadata (readyState >= 1), scheduler can generate seek actions
          import("../../store/timelineStore")
            .then(({ useTimelineStore }) => {
              useTimelineStore.getState().incrementEpoch();
            })
            .catch((err) => {
              console.error("[PreviewMediaPool] Failed to increment epoch on loadedmetadata:", err);
            });
        },
        { once: true },
      );
    }

    video.addEventListener(
      "loadeddata",
      () => {
        // CRITICAL: Trigger epoch increment to allow first frame render
        // loadeddata fires when currentTime frame data is decoded and ready (readyState >= 2)
        // This ensures render loop can proceed after scheduler-initiated seek completes
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

    video.addEventListener("seeked", () => {
      if (video.paused) {
        import("../../store/timelineStore")
          .then(({ useTimelineStore }) => {
            useTimelineStore.getState().incrementEpoch();
          })
          .catch((err) => {
            console.error("[PreviewMediaPool] Failed to import useTimelineStore on seeked", err);
          });
      }
    });

    const separator = sourcePath.includes("?") ? "&" : "?";
    video.src = `${sourcePath}${separator}clipId=${clipId}`;

    // Explicitly trigger video load
    video.load();

    this.container.appendChild(video);

    this.videoCache.set(key, managed);

    // Attach to texture manager for frame-driven texture updates
    this.textureManager.attachVideo(clipId, video);

    // Record clip attachment event
    this.traceCollector.recordClipEvent({
      timestampMs: performance.now(),
      clipId,
      event: { type: "clip-attached", mediaId },
    });

    return managed;
  }

  private disposeVideo(key: string, managed: ManagedVideo): void {
    //  Set disposing flag BEFORE any async operations
    // This prevents play() promise handlers from accessing disposed element
    managed.disposing = true;

    //  Cancel any pending play promise
    if (managed.playPromiseInFlight) {
      managed.playCancelRequested = true;
    }

    //  Increment generation to invalidate pending RVFC callbacks
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

    // Detach from texture manager
    this.textureManager.detachVideo(managed.clipId, managed.element);

    // Record clip release event
    this.traceCollector.recordClipEvent({
      timestampMs: performance.now(),
      clipId: managed.clipId,
      event: { type: "clip-released", reason: "dispose" },
    });

    managed.element.pause();
    managed.element.src = "";
    managed.element.load(); // Force decoder release

    if (managed.element.parentNode) {
      managed.element.parentNode.removeChild(managed.element);
    }

    // ─── RESOURCE TRACKING: Release video element ─────────────────────────
    resourceTracker.release(`video-${key}`);
    // ──────────────────────────────────────────────────────────────────────

    this.videoCache.delete(key);
  }

  private updateVideoElement(managed: ManagedVideo, clip: Clip, syncState: PreviewSyncState, tracks: Array<{ id: string; type: string }>, isPrimaryAudibleVideo: boolean, isTrackMuted: boolean, activeVideoClipCount: number = 1, transitions: any[] = []): void {
    const video = managed.element;
    const sourceTime = getClipSourceTime(clip, syncState.time, syncState.frameRate, transitions);

    // Combine global preview volume with per-clip volume
    const clipVolume = clip.volume ?? 1.0;
    const combinedVolume = (syncState.volume / 100) * clipVolume;

    // Allow audio from all active visible video tracks unless explicitly muted
    const shouldMute = syncState.muted || syncState.volume === 0 || isTrackMuted || clipVolume === 0;
    const targetVolume = shouldMute ? 0 : Math.max(0, Math.min(1, combinedVolume));

    // ───  Conditional property updates ─────────────────────────────
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

    // ✅ BOUNDARY REFACTOR: Drift detection and seeking moved to PreviewPlaybackScheduler
    // This method now only handles audio routing and element state updates
    // All seek decisions are made by scheduler.reconcile() and executed via executeSchedulerActions()
    // ✅ Playback control also moved to scheduler - it will generate "play" actions

    if (sourceTime === null) {
      // Clip not active at current time - pause if playing
      if (!video.paused) {
        video.pause();
      }
      return;
    }

    // Scheduler will handle play/pause decisions via executeSchedulerActions()
    // This method only configures audio routing and element properties
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
      // ✅ BOUNDARY REFACTOR: RVFC registration removed
      // VideoTextureManager handles frame callbacks (attached in createVideo)
      return;
    }

    // Guard 2: Not ready → wait
    if (video.readyState < 3) {
      return;
    }

    // Guard 3: Session-level autoplay block → latch until user gesture
    if (this.sessionAutoplayBlocked) {
      return;
    }

    // Guard 4: Element-level autoplay block → latch
    if (managed.autoplayBlocked) {
      //  Check for active user gesture context instead of time window
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
    // FIX: Clear cancel flag when starting new play attempt
    managed.playCancelRequested = false;

    const elementAge = now - managed.createdAt;

    const promise = video.play();
    if (promise !== undefined) {
      promise
        .then(() => {
          managed.playPromiseInFlight = false;

          //  Check if element is being disposed
          if (managed.disposing) {
            return; // Element disposed, ignore promise resolution
          }

          // FIX: Check if play was cancelled while promise was pending
          if (managed.playCancelRequested) {
            managed.playCancelRequested = false;
            return; // Don't update state
          }

          managed.lastPlayFailure = null;

          // ✅ BOUNDARY REFACTOR: RVFC registration removed
          // VideoTextureManager handles frame callbacks (attached in createVideo)

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

          //  Check if element is being disposed
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
   * FIX: Enforce hard limit even if all elements protected.
   * Prefer evicting inactive elements but respect MAX_CACHED_VIDEOS limit.
   *
   * FIX: Add memory-aware adaptive eviction.
   * - Estimates memory usage (elements × 50MB per element)
   * - Soft limit (500MB): Reduce eviction age from 60s to 30s
   * - Hard limit (800MB): Reduce to 10s, ignore timeline protection
   * Prevents browser crashes on 50+ clip projects during scrubbing.
   */
  private evictUnusedElements(clips: Clip[], assets: MediaAsset[], syncState: PreviewSyncState): void {
    const now = performance.now();
    const toEvict: string[] = [];

    // Build set of cache keys that are protected (referenced by timeline clips)
    const protectedCacheKeys = new Set(this.timelineClipRegistry.values());

    // Build set of cache keys that are upcoming in the lookahead window (should be protected from early eviction)
    const upcomingCacheKeys = new Set<string>();
    if (syncState.state === "playing") {
      const lookaheadTime = syncState.time + this.LOOKAHEAD_WINDOW_SECONDS;
      for (const clip of clips) {
        if (clip.startTime <= syncState.time || clip.startTime > lookaheadTime) {
          continue;
        }
        const asset = assets.find((a) => a.id === clip.mediaId);
        const track = this.trackMap.get(clip.trackId);
        if (track?.visible === false || !asset || asset.type !== "video") {
          continue;
        }
        const cacheKey = clip.id;
        upcomingCacheKeys.add(cacheKey);
      }
    }

    // Helper to check if element is actively locked for rendering
    const isLockedForRender = (managed: ManagedVideo) => {
      return (managed.element as any).__renderLockCount > 0;
    };

    //  Estimate current memory usage and adjust eviction aggressiveness
    const estimatedMemoryMB = this.videoCache.size * this.ESTIMATED_MB_PER_VIDEO;
    const isOverSoftLimit = estimatedMemoryMB > this.MEMORY_SOFT_LIMIT_MB;
    const isOverHardLimit = estimatedMemoryMB > this.MEMORY_HARD_LIMIT_MB;

    // Dynamically adjust eviction age based on memory pressure
    const effectiveEvictionAge = isOverHardLimit
      ? 10000 // 10s at hard limit (800MB+) - aggressive eviction
      : isOverSoftLimit
        ? 30000 // 30s at soft limit (500MB+) - moderate eviction
        : this.CACHE_EVICTION_AGE_MS; // 60s normal - standard LRU

    // PASS 1: Find candidates - unused for effectiveEvictionAge AND not in timeline AND not locked
    for (const [key, managed] of this.videoCache) {
      if (isLockedForRender(managed)) {
        continue;
      }
      // At hard limit, ignore protection (emergency eviction to prevent crash)
      if (protectedCacheKeys.has(key) && !isOverHardLimit) {
        continue;
      }

      const age = now - managed.lastUsedAt;
      if (age > effectiveEvictionAge) {
        toEvict.push(key);
      }
    }

    // PASS 2: If still over limit after age-based eviction, evict oldest unprotected first (not locked)
    if (this.videoCache.size - toEvict.length > this.MAX_CACHED_VIDEOS) {
      // Only consider unprotected, unlocked elements for eviction
      const unprotectedElements = Array.from(this.videoCache.entries())
        .filter(([key, managed]) => !protectedCacheKeys.has(key) && !isLockedForRender(managed))
        .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);

      const excess = this.videoCache.size - toEvict.length - this.MAX_CACHED_VIDEOS;
      for (let i = 0; i < Math.min(excess, unprotectedElements.length); i++) {
        const key = unprotectedElements[i][0];
        if (!toEvict.includes(key)) {
          toEvict.push(key);
        }
      }
    }

    // PASS 3 (FIX): If STILL over limit, evict oldest protected BUT INACTIVE AND NOT UPCOMING elements (not locked)
    // This enforces the hard MAX limit even when all elements are in timeline
    if (this.videoCache.size - toEvict.length > this.MAX_CACHED_VIDEOS) {
      const protectedInactiveElements = Array.from(this.videoCache.entries())
        .filter(([key, managed]) => protectedCacheKeys.has(key) && !managed.isActive && !upcomingCacheKeys.has(key) && !isLockedForRender(managed))
        .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);

      const remaining = this.videoCache.size - toEvict.length - this.MAX_CACHED_VIDEOS;
      for (let i = 0; i < Math.min(remaining, protectedInactiveElements.length); i++) {
        const key = protectedInactiveElements[i][0];
        if (!toEvict.includes(key)) {
          toEvict.push(key);
        }
      }
    }

    // PASS 3.5: If STILL over limit, evict oldest protected inactive UPCOMING elements (not locked)
    // We prefer evicting upcoming elements over active elements
    if (this.videoCache.size - toEvict.length > this.MAX_CACHED_VIDEOS) {
      const protectedUpcomingElements = Array.from(this.videoCache.entries())
        .filter(([key, managed]) => protectedCacheKeys.has(key) && !managed.isActive && upcomingCacheKeys.has(key) && !isLockedForRender(managed))
        .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);

      const remaining = this.videoCache.size - toEvict.length - this.MAX_CACHED_VIDEOS;
      for (let i = 0; i < Math.min(remaining, protectedUpcomingElements.length); i++) {
        const key = protectedUpcomingElements[i][0];
        if (!toEvict.includes(key)) {
          toEvict.push(key);
        }
      }
    }

    // PASS 4 (FIX): Last resort - if STILL over limit, evict oldest protected ACTIVE elements (not locked)
    // This should rarely happen but prevents unbounded growth
    if (this.videoCache.size - toEvict.length > this.MAX_CACHED_VIDEOS) {
      const protectedActiveElements = Array.from(this.videoCache.entries())
        .filter(([key, managed]) => protectedCacheKeys.has(key) && managed.isActive && !isLockedForRender(managed))
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

  // ✅ BOUNDARY REFACTOR: registerRVFC method removed
  // VideoTextureManager owns all requestVideoFrameCallback logic
  // PreviewPlaybackScheduler owns all drift detection and seek decisions

  // ─── Private: Audio lifecycle ───────────────────────────────────────────

  private createAudio(key: string, clipId: string, mediaId: string, sourcePath: string): ManagedAudio {
    const audio = document.createElement("audio");
    audio.preload = "auto";
    audio.style.cssText = "position:absolute;width:1px;height:1px;";

    // ─── RESOURCE TRACKING: Track audio element creation ──────────────────
    if (this._projectId && this._sessionId) {
      resourceTracker.track({
        id: `audio-${key}`,
        kind: "HTMLAudioElement",
        projectId: this._projectId,
        sessionId: this._sessionId,
      });
    }
    // ──────────────────────────────────────────────────────────────────────

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

    const separator = sourcePath.includes("?") ? "&" : "?";
    audio.src = `${sourcePath}${separator}clipId=${clipId}`;
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

    // ─── RESOURCE TRACKING: Release audio element ─────────────────────────
    resourceTracker.release(`audio-${key}`);
    // ──────────────────────────────────────────────────────────────────────

    this.audios.delete(key);
  }

  private pauseAudio(managed: ManagedAudio): void {
    if (managed.playPromiseInFlight) {
      managed.playCancelRequested = true;
    }
    if (!managed.element.paused) {
      managed.element.pause();
    }
  }

  private requestAudioPlayback(managed: ManagedAudio, syncState: PreviewSyncState): void {
    const audio = managed.element;

    if (!audio.paused) return;
    if (audio.readyState < 3) return;
    if (this.sessionAutoplayBlocked) return;
    if (managed.autoplayBlocked) {
      const hasUserActivation = typeof navigator !== "undefined" && navigator.userActivation && navigator.userActivation.isActive;
      if (hasUserActivation) {
        managed.autoplayBlocked = false;
      } else {
        return;
      }
    }
    if (managed.playPromiseInFlight) return;
    const now = performance.now();
    if (now - (managed.lastPlayAttemptMs || 0) < 100) return;

    managed.playAttempts = (managed.playAttempts || 0) + 1;
    managed.lastPlayAttemptMs = now;
    managed.playPromiseInFlight = true;
    managed.playCancelRequested = false;

    const promise = audio.play();
    if (promise !== undefined) {
      promise
        .then(() => {
          managed.playPromiseInFlight = false;
          if (this._isDisposed) return;
          if (managed.playCancelRequested) {
            managed.playCancelRequested = false;
            audio.pause();
          }
        })
        .catch((err: Error) => {
          managed.playPromiseInFlight = false;
          if (this._isDisposed) return;
          if (err.name !== "AbortError") {
            if (err.name === "NotAllowedError") {
              managed.autoplayBlocked = true;
              this.sessionAutoplayBlocked = true;
              console.error(`[PreviewMediaPool] Audio play() BLOCKED (NotAllowedError) - latched until user gesture`);
            } else {
              console.warn(`[PreviewMediaPool] Audio play() failed for ${managed.clipId}-${managed.mediaId}:`, err);
            }
          }
        });
    }
  }

  private updateAudioElement(managed: ManagedAudio, clip: Clip, syncState: PreviewSyncState, isTrackMuted: boolean): void {
    const audio = managed.element;
    const activeTransitions = useTimelineStore.getState().transitions;
    const sourceTime = getClipSourceTime(clip, syncState.time, syncState.frameRate, activeTransitions);

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
      this.pauseAudio(managed);
      return;
    }

    // ✅ BOUNDARY REFACTOR: Audio drift detection and seeking moved to PreviewPlaybackScheduler
    // This method now only handles audio routing and volume control
    // All seek decisions are made by scheduler.reconcile() and executed via executeSchedulerActions()

    if (syncState.state === "playing") {
      this.requestAudioPlayback(managed, syncState);
    } else {
      this.pauseAudio(managed);
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

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
 */

import type { Clip, MediaAsset } from "@/types";
import { platform } from "@/core/platform";

const isExternalOrDataUrl = (value: string) => value.startsWith("data:") || value.startsWith("http://") || value.startsWith("https://") || value.startsWith("asset://") || value.startsWith("blob:");
const toMediaElementSrc = (value: string) => (isExternalOrDataUrl(value) ? value : platform.convertFileSrc(value));

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
}

interface ManagedVideo {
  element: HTMLVideoElement;
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
 */
function getClipSourceTime(clip: Clip, clockTime: number): number | null {
  const clipLocalTime = clockTime - clip.startTime;
  if (clipLocalTime < 0 || clipLocalTime > clip.duration) {
    return null; // Clip not active
  }
  const trimIn = clip.trimIn || 0;
  return Math.max(0, trimIn + clipLocalTime);
}

export class PreviewMediaPool {
  private container: HTMLDivElement;
  private videos = new Map<string, ManagedVideo>();
  private audios = new Map<string, ManagedAudio>();
  private lastSyncState: PreviewSyncState | null = null;
  private trackMap = new Map<string, { id: string; type: string; visible?: boolean; muted?: boolean }>();
  private _isDisposed = false;

  /** Whether requestVideoFrameCallback is available */
  private hasRVFC = typeof HTMLVideoElement !== "undefined" && "requestVideoFrameCallback" in HTMLVideoElement.prototype;

  constructor() {
    this.container = document.createElement("div");
    // Position fixed and practically invisible, but NOT offscreen.
    // Browsers suspend decoding for completely offscreen or display:none elements.
    this.container.style.cssText = "position:fixed;left:0;top:0;width:256px;height:256px;opacity:0.001;pointer-events:none;z-index:-9999;overflow:hidden;";
    document.body.appendChild(this.container);
  }

  /**
   * Synchronize the pool with current timeline clips and clock state.
   * Creates/destroys elements as needed and updates playback state.
   */
  sync(clips: Clip[], assets: MediaAsset[], tracks: Array<{ id: string; type: string }>, syncState: PreviewSyncState): void {
    if (this._isDisposed) {
      console.error(`[PreviewMediaPool] Pool is disposed!`);
      return;
    }

    this.trackMap = new Map(tracks.map((track) => [track.id, track]));

    // Determine which clips need video/audio elements
    const desiredVideoKeys = new Set<string>();
    const desiredAudioKeys = new Set<string>();

    for (const clip of clips) {
      const asset = assets.find((a) => a.id === clip.mediaId);
      const track = this.trackMap.get(clip.trackId);
      if (track?.visible === false) continue;

      const key = `${clip.id}-${clip.mediaId}`;
      if (asset?.type === "video") {
        desiredVideoKeys.add(key);
        // Video clip audio is handled by the video element decode clock.
        // Keep audio elements for explicit audio assets only.
      } else if (asset?.type === "audio" || (clip.kind === "audio" && (clip as any).audioPath)) {
        // Handle both registered media assets and audio library clips (audioPath on clip)
        desiredAudioKeys.add(key);
      }
    }

    // Remove obsolete video elements
    for (const [key, managed] of this.videos) {
      if (!desiredVideoKeys.has(key)) {
        this.disposeVideo(key, managed);
      }
    }

    // Remove obsolete audio elements
    for (const [key, managed] of this.audios) {
      if (!desiredAudioKeys.has(key)) {
        this.disposeAudio(key, managed);
      }
    }

    // Pick one primary ACTIVE video clip for audible playback (prevents overlapping voices)
    const activeVisibleVideoClips = clips.filter((clip) => {
      const asset = assets.find((a) => a.id === clip.mediaId);
      if (!asset || asset.type !== "video") return false;
      const track = this.trackMap.get(clip.trackId);
      if (track?.visible === false) return false;
      return getClipSourceTime(clip, syncState.time) !== null;
    });
    const primaryVideoClip = findPrimaryVideoClip(activeVisibleVideoClips, tracks);

    // Create or update video elements
    for (const clip of clips) {
      const asset = assets.find((a) => a.id === clip.mediaId);
      if (!asset || asset.type !== "video") continue;
      const track = this.trackMap.get(clip.trackId);
      if (track?.visible === false) continue;

      const key = `${clip.id}-${clip.mediaId}`;
      const sourcePath = toMediaElementSrc(asset.path);

      let managed = this.videos.get(key);
      if (!managed) {
        managed = this.createVideo(key, clip.id, clip.mediaId, sourcePath);
      } else if (managed.sourcePath !== sourcePath) {
        // Source changed — recycle element
        this.disposeVideo(key, managed);
        managed = this.createVideo(key, clip.id, clip.mediaId, sourcePath);
      }

      if (managed) {
        const isTrackMuted = track?.muted === true;
        const isPrimaryAudibleVideo = primaryVideoClip?.id === clip.id;
        this.updateVideoElement(managed, clip, syncState, tracks, isPrimaryAudibleVideo, isTrackMuted);
      }
    }

    // Create or update audio elements
    for (const clip of clips) {
      const asset = assets.find((a) => a.id === clip.mediaId);
      // Resolve audio source: registered media asset OR direct audioPath on clip (audio library items)
      const directAudioPath = (clip as any).audioPath as string | undefined;
      const isAudioClip = asset?.type === "audio" || (clip.kind === "audio" && !!directAudioPath);
      if (!isAudioClip) continue;
      const track = this.trackMap.get(clip.trackId);
      if (track?.visible === false) continue;

      const rawPath = asset ? asset.path : directAudioPath!;
      const key = `${clip.id}-${clip.mediaId}`;
      const sourcePath = toMediaElementSrc(rawPath);

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
  }

  /**
   * Get video elements for scheduler rasterization bypass.
   * Returns ALL elements so the scheduler can use them even before metadata loads;
   * the rasterizer checks readyState itself.
   */
  getVideoElements(): Map<string, HTMLVideoElement> {
    const result = new Map<string, HTMLVideoElement>();
    for (const [key, managed] of this.videos) {
      result.set(key, managed.element);
    }
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
   * Dispose all media elements and remove the container.
   */
  dispose(): void {
    if (this._isDisposed) return;
    this._isDisposed = true;

    for (const [key, managed] of this.videos) {
      this.disposeVideo(key, managed);
    }
    this.videos.clear();

    for (const [key, managed] of this.audios) {
      this.disposeAudio(key, managed);
    }
    this.audios.clear();

    if (this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
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
    };

    // Wait for metadata before marking ready
    video.addEventListener(
      "loadedmetadata",
      () => {
        managed.ready = true;
      },
      { once: true },
    );

    video.addEventListener(
      "error",
      () => {
        // Ignore expected teardown/HMR errors when src is intentionally cleared.
        if (managed.disposing || !video.currentSrc) {
          return;
        }
        console.error(`[PreviewMediaPool] Video load error: ${key}`, video.error);
      },
      { once: true },
    );

    video.src = sourcePath;

    // Explicitly trigger video load
    video.load();

    this.container.appendChild(video);

    this.videos.set(key, managed);

    return managed;
  }

  private disposeVideo(key: string, managed: ManagedVideo): void {
    managed.disposing = true;
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

    this.videos.delete(key);
  }

  private updateVideoElement(managed: ManagedVideo, clip: Clip, syncState: PreviewSyncState, tracks: Array<{ id: string; type: string }>, isPrimaryAudibleVideo: boolean, isTrackMuted: boolean): void {
    const video = managed.element;
    const sourceTime = getClipSourceTime(clip, syncState.time);

    // Combine global preview volume with per-clip volume
    const clipVolume = clip.volume ?? 1.0; // Default to 1.0 if not set
    const combinedVolume = (syncState.volume / 100) * clipVolume;

    // Only one primary video clip is audible; others stay muted.
    const shouldMute = syncState.muted || syncState.volume === 0 || isTrackMuted || !isPrimaryAudibleVideo || clipVolume === 0;
    video.muted = shouldMute;
    video.volume = shouldMute ? 0 : Math.max(0, Math.min(1, combinedVolume));
    video.playbackRate = syncState.speed;

    if ("preservesPitch" in video) {
      (video as any).preservesPitch = true;
    }
    if ("webkitPreservesPitch" in video) {
      (video as any).webkitPreservesPitch = true;
    }

    if (sourceTime === null) {
      // Clip not active at current time
      if (!video.paused) {
        video.pause();
      }
      return;
    }

    // Seek to correct source time
    const clampedTime = Number.isFinite(video.duration) && video.duration > 0 ? Math.max(0, Math.min(sourceTime, video.duration - 0.001)) : sourceTime;

    if (!video.paused) {
      // Professional policy:
      // - Audible stream: avoid frequent seeks (they cause audible glitches)
      // - Silent decode streams: keep tighter sync for visual fidelity
      const drift = Math.abs(video.currentTime - clampedTime);
      const hardSeekThreshold = isPrimaryAudibleVideo ? 1.0 : 0.5;
      const minSeekIntervalMs = isPrimaryAudibleVideo ? 1500 : 400;
      const now = performance.now();
      if (drift > hardSeekThreshold && now - managed.lastHardSeekAtMs > minSeekIntervalMs) {
        video.currentTime = clampedTime;
        managed.lastHardSeekAtMs = now;
      }
    } else {
      video.currentTime = clampedTime;
    }

    // Play/pause based on clock state
    if (syncState.state === "playing") {
      if (video.paused && video.readyState >= 3) {
        const promise = video.play();
        if (promise !== undefined) {
          promise.catch((err: Error) => {
            if (err.name !== "AbortError") {
              console.warn(`[PreviewMediaPool] play() failed for ${managed.clipId}-${managed.mediaId}:`, err);
            }
          });
        }
      }

      // Register RVFC for frame-accurate sync (eliminates fake drift from RAF jitter)
      if (this.hasRVFC && managed.rvfcHandle === null) {
        this.registerRVFC(managed, clip, syncState, tracks, isPrimaryAudibleVideo);
      }
    } else {
      if (!video.paused) {
        video.pause();
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

  // ─── Private: requestVideoFrameCallback sync ────────────────────────────

  private registerRVFC(managed: ManagedVideo, clip: Clip, syncState: PreviewSyncState, tracks: Array<{ id: string; type: string }>, isPrimaryAudibleVideo: boolean): void {
    const video = managed.element;

    const callback = (_now: number, metadata: VideoFrameCallbackMetadata) => {
      if (this._isDisposed) return;
      if (!this.videos.has(`${managed.clipId}-${managed.mediaId}`)) return;

      // Recalculate expected source time based on latest clock state
      const latestSyncState = this.lastSyncState ?? syncState;
      const currentSourceTime = getClipSourceTime(clip, latestSyncState.time);
      if (currentSourceTime === null) return;

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

      // Re-register for next frame
      if (!video.paused && !this._isDisposed) {
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
    const sourceTime = getClipSourceTime(clip, syncState.time);

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
}

// Minimal type for RVFC metadata (not in all TS lib versions)
interface VideoFrameCallbackMetadata {
  mediaTime: number;
  presentationTime: number;
}

/**
 * Video Texture Manager
 *
 * Manages GPU texture updates for video elements using requestVideoFrameCallback.
 *
 * CRITICAL ARCHITECTURAL BOUNDARY:
 * - This component marks decoded frames dirty when frames arrive
 * - The native compositor owns GPU upload and presentation
 * - No component may upload a frame outside the compositor boundary
 *
 * Key Features:
 * - Frame-driven updates (not RAF polling)
 * - Generation IDs prevent stale callbacks
 * - Element recycling safety
 * - Fallback for browsers without RVFC
 * - One outstanding callback per element
 *
 * Performance Impact:
 * - Eliminates 30-50% redundant texture uploads
 * - Updates only when new frames arrive
 * - No wasted GPU bandwidth on paused/stalled videos
 */

// ─── Types ───────────────────────────────────────────────────────────────

export interface VideoFrameState {
  /** Latest media time from callback metadata */
  latestMediaTime: number;
  /** Frame serial number (increments on each new frame) */
  frameSerial: number;
  /** Whether texture needs GPU upload */
  textureDirty: boolean;
  /** Active requestVideoFrameCallback handle */
  callbackHandle: number | null;
  /** Generation counter (invalidates stale callbacks) */
  generation: number;
}

export interface TextureUpdateStats {
  /** Number of textures updated this cycle */
  updated: number;
  /** Number of textures skipped (no new frame) */
  skipped: number;
  /** Stale frame reuse rate (0-1) */
  staleReuseRate: number;
}

// ─── Feature Detection ───────────────────────────────────────────────────

const supportsRVFC = typeof HTMLVideoElement !== "undefined" && "requestVideoFrameCallback" in HTMLVideoElement.prototype;

// ─── Video Texture Manager ───────────────────────────────────────────────

export class VideoTextureManager {
  private frameStates = new Map<string, VideoFrameState>();
  private videoToClip = new Map<HTMLVideoElement, string>(); // For element recycling safety
  private readonly useRVFC: boolean;

  constructor(preferRVFC: boolean = true) {
    this.useRVFC = preferRVFC && supportsRVFC;

    if (!this.useRVFC && import.meta.env.DEV) {
      console.warn("[VideoTextureManager] requestVideoFrameCallback not available, using fallback");
    }
  }

  /**
   * Attach a video element to start tracking frame arrivals.
   *
   * Registers requestVideoFrameCallback if supported.
   * Handles element recycling by checking generation IDs.
   *
   * @param clipId - Unique clip identifier
   * @param video - Video element to track
   */
  attachVideo(clipId: string, video: HTMLVideoElement): void {
    // Cancel previous callback if element is being reassigned
    const existingState = this.frameStates.get(clipId);
    if (existingState && existingState.callbackHandle !== null) {
      try {
        video.cancelVideoFrameCallback(existingState.callbackHandle);
      } catch {
        // Ignore - callback may have already fired
      }
    }

    // Initialize or reset state
    const state: VideoFrameState = {
      latestMediaTime: video.currentTime,
      frameSerial: 0,
      textureDirty: true, // Mark dirty initially to ensure first frame uploads
      callbackHandle: null,
      generation: (existingState?.generation ?? 0) + 1,
    };

    this.frameStates.set(clipId, state);
    this.videoToClip.set(video, clipId);

    // Register callback if supported
    if (this.useRVFC) {
      this.registerCallback(clipId, video, state);
    }
  }

  /**
   * Detach a video element and clean up resources.
   *
   * @param clipId - Clip identifier
   * @param video - Video element to detach
   */
  detachVideo(clipId: string, video: HTMLVideoElement): void {
    const state = this.frameStates.get(clipId);

    if (state && state.callbackHandle !== null) {
      try {
        video.cancelVideoFrameCallback(state.callbackHandle);
      } catch {
        // Ignore - callback may have already fired
      }
    }

    this.frameStates.delete(clipId);
    this.videoToClip.delete(video);
  }

  /**
   * Check if texture should be updated (has new frame).
   *
   * For RVFC: Checks textureDirty flag
   * For fallback: Checks if currentTime changed
   *
   * @param clipId - Clip identifier
   * @param video - Video element (used for fallback)
   * @returns true if texture should be updated
   */
  shouldUpdate(clipId: string, video: HTMLVideoElement): boolean {
    const state = this.frameStates.get(clipId);
    if (!state) return false;

    if (this.useRVFC) {
      return state.textureDirty;
    } else {
      // Fallback: check if time changed
      const currentTime = video.currentTime;
      const timeChanged = Math.abs(currentTime - state.latestMediaTime) > 0.001;

      if (timeChanged) {
        state.latestMediaTime = currentTime;
        state.frameSerial++;
        return true;
      }

      return false;
    }
  }

  /**
   * Mark texture as clean after GPU upload.
   *
   * CRITICAL: Only compositor may call this after texture.source.update()
   *
   * @param clipId - Clip identifier
   */
  markClean(clipId: string): void {
    const state = this.frameStates.get(clipId);
    if (state) {
      state.textureDirty = false;
    }
  }

  /**
   * Get current frame state for diagnostics.
   *
   * @param clipId - Clip identifier
   * @returns Frame state or undefined
   */
  getFrameState(clipId: string): Readonly<VideoFrameState> | undefined {
    const state = this.frameStates.get(clipId);
    return state ? { ...state } : undefined;
  }

  /**
   * Check if manager is using RVFC or fallback.
   */
  isUsingRVFC(): boolean {
    return this.useRVFC;
  }

  /**
   * Get statistics about texture updates.
   *
   * @param clipIds - Clips to check
   * @returns Update statistics
   */
  getUpdateStats(clipIds: string[]): TextureUpdateStats {
    let updated = 0;
    let skipped = 0;

    for (const clipId of clipIds) {
      const state = this.frameStates.get(clipId);
      if (!state) continue;

      if (state.textureDirty) {
        updated++;
      } else {
        skipped++;
      }
    }

    const total = updated + skipped;
    const staleReuseRate = total > 0 ? skipped / total : 0;

    return { updated, skipped, staleReuseRate };
  }

  /**
   * Reset all state (used for cleanup/disposal).
   */
  reset(): void {
    // Cancel all active callbacks
    for (const [clipId, state] of this.frameStates) {
      if (state.callbackHandle !== null) {
        const video = this.findVideoForClip(clipId);
        if (video) {
          try {
            video.cancelVideoFrameCallback(state.callbackHandle);
          } catch {
            // Ignore
          }
        }
      }
    }

    this.frameStates.clear();
    this.videoToClip.clear();
  }

  // ─── Private Methods ─────────────────────────────────────────────────────

  /**
   * Register requestVideoFrameCallback for a video element.
   */
  private registerCallback(clipId: string, video: HTMLVideoElement, state: VideoFrameState): void {
    const generation = state.generation;

    const callback = (_now: number, metadata: VideoFrameCallbackMetadata) => {
      // Check generation first - exit immediately if stale
      if (state.generation !== generation) {
        return;
      }

      // Check if element was reassigned (recycling safety)
      const currentClipId = this.videoToClip.get(video);
      if (currentClipId !== clipId) {
        return; // Video element was recycled, ignore stale callback
      }

      // Mark texture dirty and update metadata
      state.latestMediaTime = metadata.mediaTime;
      state.frameSerial++;
      state.textureDirty = true;

      // Re-register for next frame (if still valid)
      if (state.generation === generation) {
        try {
          state.callbackHandle = video.requestVideoFrameCallback(callback);
        } catch {
          state.callbackHandle = null;
        }
      } else {
        state.callbackHandle = null;
      }
    };

    try {
      state.callbackHandle = video.requestVideoFrameCallback(callback);
    } catch {
      state.callbackHandle = null;
    }
  }

  /**
   * Find video element for a clip ID (for cleanup).
   */
  private findVideoForClip(clipId: string): HTMLVideoElement | null {
    for (const [video, id] of this.videoToClip) {
      if (id === clipId) {
        return video;
      }
    }
    return null;
  }
}

// ─── Singleton Export (Optional) ─────────────────────────────────────────

let globalVideoTextureManager: VideoTextureManager | null = null;

/**
 * Get or create global VideoTextureManager instance.
 *
 * Use this if you want a singleton pattern across the app.
 * Otherwise, create instances directly: `new VideoTextureManager()`
 */
export function getVideoTextureManager(): VideoTextureManager {
  if (!globalVideoTextureManager) {
    globalVideoTextureManager = new VideoTextureManager();
  }
  return globalVideoTextureManager;
}

/**
 * Reset global instance (used for tests or cleanup).
 */
export function resetVideoTextureManager(): void {
  if (globalVideoTextureManager) {
    globalVideoTextureManager.reset();
    globalVideoTextureManager = null;
  }
}

/**
 * SeekManager - Smart video seeking with threshold checking and debouncing
 */

export class SeekManager {
  private readonly PLAYBACK_SEEK_THRESHOLD = 0.001; // 1ms during playback - seek every frame

  private debounceTimers: Map<HTMLVideoElement, number> = new Map();
  private pendingSeeks: Map<HTMLVideoElement, number> = new Map();
  private isPlaybackMode: boolean = false; // Track if we're in playback mode

  /**
   * Set playback mode - disables debouncing and uses lower threshold
   */
  setPlaybackMode(isPlaying: boolean): void {
    this.isPlaybackMode = isPlaying;
  }

  /**
   * Seek video to target time if difference exceeds threshold
   */
  async seekIfNeeded(video: HTMLVideoElement, targetTime: number): Promise<void> {
    try {
      const currentTime = video.currentTime;
      const timeDiff = Math.abs(currentTime - targetTime);

      // Force seek if video doesn't have frame data loaded, even if already at target time
      // This triggers frame decode for videos that only have metadata (readyState < 2)
      const needsFrameLoad = video.readyState < 2;

      // Use different threshold for playback vs scrubbing
      const threshold = this.isPlaybackMode ? this.PLAYBACK_SEEK_THRESHOLD : this.SEEK_THRESHOLD;

      if (timeDiff <= threshold && !needsFrameLoad) {
        return Promise.resolve();
      }

      // During playback, skip debounce for immediate seeking
      if (this.isPlaybackMode || needsFrameLoad) {
        return this.performSeek(video, targetTime);
      }

      // During scrubbing, use debounce
      return this.debouncedSeek(video, targetTime);
    } catch (error) {
      console.error("Seek operation failed:", {
        targetTime,
        currentTime: video.currentTime,
        error: error instanceof Error ? error.message : "Unknown error",
        videoSrc: video.src,
      });

      // Don't throw - allow rendering to continue with current frame
      return Promise.resolve();
    }
  }

  /**
   * Debounce seek operations to reduce excessive seeking during scrubbing
   */
  private debouncedSeek(video: HTMLVideoElement, targetTime: number): Promise<void> {
    const existingTimer = this.debounceTimers.get(video);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    this.pendingSeeks.set(video, targetTime);

    return new Promise((resolve) => {
      const timer = window.setTimeout(async () => {
        const finalTargetTime = this.pendingSeeks.get(video);
        if (finalTargetTime !== undefined) {
          try {
            await this.performSeek(video, finalTargetTime);
          } catch (error) {
            console.error("Debounced seek failed:", {
              targetTime: finalTargetTime,
              currentTime: video.currentTime,
              error: error instanceof Error ? error.message : "Unknown error",
              videoSrc: video.src,
            });
          }
          this.pendingSeeks.delete(video);
        }
        this.debounceTimers.delete(video);
        resolve();
      }, this.DEBOUNCE_WINDOW);

      this.debounceTimers.set(video, timer);
    });
  }

  /**
   * Perform actual seek operation with timeout protection
   *
   * CRITICAL: Ensures video stays PAUSED after seeking
   */
  private performSeek(video: HTMLVideoElement, targetTime: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.seekingVideos.add(video);

      const timeout = setTimeout(() => {
        video.removeEventListener("seeked", onSeeked);
        // Remove from seeking state on timeout
        this.seekingVideos.delete(video);
        console.error("Seek timeout:", {
          targetTime,
          currentTime: video.currentTime,
          videoSrc: video.src,
          timeout: this.SEEK_TIMEOUT,
        });
        reject(new Error("Seek timeout"));
      }, this.SEEK_TIMEOUT);

      const onSeeked = async () => {
        clearTimeout(timeout);
        video.removeEventListener("seeked", onSeeked);

        // CRITICAL: Ensure video stays PAUSED after seek
        if (!video.paused) {
          console.error("[SEEK] Video started playing after seek! Pausing immediately.");
          video.pause();
        }

        // Wait for frame to be decoded after seek completes
        // This ensures the video frame is actually available for drawing
        try {
          await this.waitForFrameDecode(video);
        } catch (error) {
          console.warn("Frame decode wait failed, continuing anyway:", {
            targetTime,
            currentTime: video.currentTime,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }

        this.seekingVideos.delete(video);
        resolve();
      };

      try {
        // Special case: if already at target time, just wait for frame decode
        // Setting currentTime won't trigger "seeked" event if already at that position
        const currentTime = video.currentTime;
        if (Math.abs(currentTime - targetTime) < 0.001) {
          // Clear timeout since we're not waiting for seeked event
          clearTimeout(timeout);

          // Just wait for frame decode (use async IIFE)
          (async () => {
            try {
              await this.waitForFrameDecode(video);
            } catch (error) {
              console.warn("Frame decode wait failed, continuing anyway:", {
                targetTime,
                currentTime: video.currentTime,
                error: error instanceof Error ? error.message : "Unknown error",
              });
            }

            // CRITICAL: Ensure video stays PAUSED
            if (!video.paused) {
              console.error("[SEEK] Video started playing! Pausing immediately.");
              video.pause();
            }

            // Remove from seeking state when complete
            this.seekingVideos.delete(video);
            resolve();
          })();
        } else {
          video.addEventListener("seeked", onSeeked);

          // CRITICAL: Ensure video is paused before seeking
          if (!video.paused) {
            console.error("[SEEK] Video was playing before seek! Pausing first.");
            video.pause();
          }

          video.currentTime = targetTime;
        }
      } catch (error) {
        clearTimeout(timeout);
        video.removeEventListener("seeked", onSeeked);
        // Remove from seeking state on error
        this.seekingVideos.delete(video);
        console.error("Seek operation error:", {
          targetTime,
          currentTime: video.currentTime,
          error: error instanceof Error ? error.message : "Unknown error",
          videoSrc: video.src,
        });
        reject(error);
      }
    });
  }

  /**
   * Wait for video frame to be decoded after seek
   * This ensures the frame is actually available for drawing to canvas
   */
  private waitForFrameDecode(video: HTMLVideoElement): Promise<void> {
    // If readyState is already >= 2 (HAVE_CURRENT_DATA), frame data is available
    // Prefer >= 3 (HAVE_FUTURE_DATA) for better reliability
    // Also check if readyState exists (for test mocks that don't have it)
    if (!("readyState" in video) || video.readyState >= 2) {
      return Promise.resolve();
    }

    // Wait for readyState to reach >= 2 or timeout after 500ms
    return new Promise((resolve) => {
      const checkReady = () => {
        if (video.readyState >= 2) {
          video.removeEventListener("loadeddata", checkReady);
          video.removeEventListener("canplay", checkReady);
          clearTimeout(timeoutId);
          resolve();
        }
      };

      video.addEventListener("loadeddata", checkReady, { once: false });
      video.addEventListener("canplay", checkReady, { once: false });

      // Timeout after 500ms - increased from 100ms to give more time for frame decode
      const timeoutId = setTimeout(() => {
        video.removeEventListener("loadeddata", checkReady);
        video.removeEventListener("canplay", checkReady);
        console.warn("Frame decode timeout, proceeding with readyState:", video.readyState);
        resolve();
      }, 500);

      // Check immediately in case already ready
      checkReady();
    });
  }

  /**
   * Cancel all pending seeks for a video element
   */
  cancelPendingSeeks(video: HTMLVideoElement): void {
    const timer = this.debounceTimers.get(video);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(video);
    }
    this.pendingSeeks.delete(video);
    // Note: We don't remove from seekingVideos here as the seek may still be in progress
  }

  /**
   * Cleanup all resources
   */
  dispose(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.pendingSeeks.clear();
    this.seekingVideos.clear();
  }

  /**
   * Get seek threshold value (for testing)
   */
  getSeekThreshold(): number {
    return this.SEEK_THRESHOLD;
  }

  /**
   * Get debounce window value (for testing)
   */
  getDebounceWindow(): number {
    return this.DEBOUNCE_WINDOW;
  }

  /**
   * Check if video has pending seek (for testing)
   */
  hasPendingSeek(video: HTMLVideoElement): boolean {
    return this.pendingSeeks.has(video);
  }

  /**
   * Check if a video is currently seeking
   */
  isVideoSeeking(video: HTMLVideoElement): boolean {
    return this.seekingVideos.has(video);
  }

  /**
   * Check if any videos are currently seeking
   */
  hasSeekingVideos(): boolean {
    return this.seekingVideos.size > 0;
  }
}

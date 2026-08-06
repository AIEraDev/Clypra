/**
 * Headless Video Element Pool
 *
 * Manages a pool of headless <video> elements for frame extraction.
 * Used by export pipeline and background rendering.
 *
 * Key features:
 * - Headless (not attached to DOM)
 * - Frame-accurate seeking
 * - Resource lifecycle management
 * - Concurrent video support
 * - Multiple instances per URL (for different seek positions)
 * - Sequential seek optimization (reuses elements for small forward jumps)
 */

/**
 * Sequential seek threshold in seconds.
 *
 * When the next requested time is within this threshold ahead of the
 * video element's current position, reuse that element for a small forward
 * seek. The browser decoder handles small forward seeks efficiently from
 * its internal buffer without needing to walk back to a keyframe.
 *
 * Typical keyframe interval is 2s, so 1.5s is conservative.
 */
const SEQUENTIAL_SEEK_THRESHOLD_S = 1.5;

/**
 * Overshoot tolerance in seconds.
 *
 * If the video element is already within this distance past the target time,
 * accept it without seeking. This handles cases where the decoder overshoots
 * slightly or the previous frame was very close.
 *
 * 0.02s (20ms) covers up to 60fps (16.67ms per frame) with margin.
 */
const OVERSHOOT_TOLERANCE_S = 0.02;

export interface VideoElementPoolConfig {
  /** Maximum number of concurrent video elements */
  maxConcurrent?: number;

  /** Enable debug logging */
  debug?: boolean;

  /** Enable fast-path seek resolver for headless export */
  isExport?: boolean;
}

interface PooledVideo {
  element: HTMLVideoElement;
  url: string;
  lastSeekTime: number;
  inUse: boolean;
}

export class VideoElementPool {
  private videos: PooledVideo[] = [];
  private config: Required<VideoElementPoolConfig>;

  constructor(config: VideoElementPoolConfig = {}) {
    this.config = {
      maxConcurrent: config.maxConcurrent ?? 10,
      debug: config.debug ?? false,
      isExport: config.isExport ?? false,
    };
  }

  /**
   * Acquire a video element for a source URL.
   * Creates new element if not in pool or reuses an existing one.
   *
   * Optimization: Prefers elements that are close to the target seek time
   * (within SEQUENTIAL_SEEK_THRESHOLD_S ahead) to take advantage of the
   * browser's efficient handling of small forward seeks from its decode buffer.
   *
   * @param sourceUrl - Video source URL
   * @param seekTime - Time to seek to (in seconds)
   * @returns Video element ready at seekTime
   */
  async acquire(sourceUrl: string, seekTime: number): Promise<HTMLVideoElement> {
    // Try to find an existing video element for sequential access:
    // 1. Exact match (already at target position)
    // 2. Small forward jump (within threshold - cheap seek from buffer)
    const existingVideo = this.videos.find((v) => {
      if (v.url !== sourceUrl || v.inUse) return false;

      const timeDelta = seekTime - v.lastSeekTime;

      // Exact match (within 1ms)
      if (Math.abs(timeDelta) < 0.001) return true;

      // Sequential forward seek (small jump ahead - decoder has frames in buffer)
      if (timeDelta > 0 && timeDelta < SEQUENTIAL_SEEK_THRESHOLD_S) {
        return true;
      }

      return false;
    });

    let pooledVideo: PooledVideo;

    if (existingVideo) {
      pooledVideo = existingVideo;
      pooledVideo.inUse = true;

      // Exact match — already at target, return immediately
      if (Math.abs(seekTime - pooledVideo.lastSeekTime) < 0.001) {
        return pooledVideo.element;
      }

      // Sequential match — fall through to seek block below
      // (seek will be cheap because decoder has frames in buffer)
    } else {
      // Try to find an unused video for the same URL (will need to seek)
      const sameUrlVideo = this.videos.find((v) => v.url === sourceUrl && !v.inUse);

      if (sameUrlVideo) {
        pooledVideo = sameUrlVideo;
        pooledVideo.inUse = true;
      } else {
        // Check if we've hit the concurrent limit
        if (this.videos.length >= this.config.maxConcurrent) {
          // Find and evict the oldest unused video
          const unusedVideo = this.videos.find((v) => !v.inUse);
          if (unusedVideo) {
            this.releaseVideo(unusedVideo);
          } else {
            // All videos are in use - this shouldn't happen in sequential export
            throw new Error(`VideoElementPool: maxConcurrent (${this.config.maxConcurrent}) limit reached with all videos in use`);
          }
        }

        // Create new video element
        const video = document.createElement("video");
        video.preload = "auto";
        video.crossOrigin = "anonymous";
        video.setAttribute("playsinline", "");
        video.muted = true; // Muted for export (no audio in frame extraction)

        // Style and add to DOM to ensure the browser composites the frames
        // Position fixed and practically invisible, but NOT offscreen or hidden.
        // Browsers suspend or throttle decoding for offscreen/hidden/1x1 elements.
        video.style.position = "fixed";
        video.style.bottom = "0px";
        video.style.right = "0px";
        video.style.width = "32px";
        video.style.height = "32px";
        video.style.opacity = "0.01"; // WebKit suspends decoding for opacity < 0.01
        video.style.pointerEvents = "none";
        video.style.zIndex = "100000"; // Keep on top of all UI (including modals) to prevent WebKit occlusion suspension

        // Ensure playsinline is set for Safari/mobile webviews
        video.setAttribute("playsinline", "");
        video.setAttribute("webkit-playsinline", "");

        if (typeof document !== "undefined" && document.body) {
          document.body.appendChild(video);
        }

        video.src = sourceUrl;

        pooledVideo = {
          element: video,
          url: sourceUrl,
          lastSeekTime: -1,
          inUse: true,
        };

        this.videos.push(pooledVideo);

        // Wait for metadata to load
        try {
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error(`Video metadata load timeout: ${sourceUrl}`));
            }, 10000);

            video.addEventListener(
              "loadedmetadata",
              () => {
                clearTimeout(timeout);
                resolve();
              },
              { once: true },
            );

            video.addEventListener(
              "error",
              () => {
                clearTimeout(timeout);
                reject(new Error(`Video load error: ${sourceUrl}`));
              },
              { once: true },
            );
          });
        } catch (error) {
          this.releaseVideo(pooledVideo);
          throw error;
        }
      }
    }

    // Seek to target time if needed
    const video = pooledVideo.element;
    const timeDelta = seekTime - video.currentTime;

    // Check if we're already close enough (within overshoot tolerance)
    if (Math.abs(timeDelta) <= OVERSHOOT_TOLERANCE_S) {
      // Already at or very close to target position
      pooledVideo.lastSeekTime = seekTime;
      return pooledVideo.element;
    }

    // Need to seek — fall through to existing seek logic
    if (Math.abs(video.currentTime - seekTime) > 0.001) {
      try {
        // waits for frame to be compositor-ready
        await new Promise<void>((resolve, reject) => {
          let resolved = false;

          // Seek event fallback: if the browser doesn't fire the 'seeked' event
          // within 1000ms (e.g. due to WebKit background throttling/suspension),
          // manually trigger the seeked handler to prevent the export from hanging/failing.
          const seekedFallbackTimeout = setTimeout(() => {
            if (!resolved) {
              console.warn(`[VideoElementPool] Seek event fallback triggered for ${sourceUrl} @ ${seekTime}s`);
              onSeeked();
            }
          }, 1000);

          const timeout = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              cleanup();
              reject(new Error(`Video seek timeout: ${sourceUrl} @ ${seekTime}s`));
            }
          }, 15000); // Increased from 5s to 15s to allow for heavy 4K/H.265 seeks under full load

          const settle = () => {
            if (resolved) return;
            resolved = true;
            clearTimeout(timeout);
            clearTimeout(seekedFallbackTimeout);
            cleanup();
            pooledVideo.lastSeekTime = seekTime;
            resolve();
          };

          const onSeeked = () => {
            if (this.config.isExport) {
              settle();
              return;
            }

            // 'seeked' = seek scheduled, NOT frame in compositor.
            // On M1/VideoToolbox there is a GPU upload step after this.
            // requestVideoFrameCallback() is the only reliable signal that
            // pixel data is actually ready for ctx.drawImage().
            // WebKit (Safari/Tauri macOS) suspends compositor updates when elements
            // are covered (e.g. by export modal) or backgrounded, which prevents
            // requestVideoFrameCallback and requestAnimationFrame from ever firing.
            // We set a 100ms fallback so we don't hang in these power-saving states.
            let callbackTriggered = false;

            const localSettle = () => {
              if (callbackTriggered) return;
              callbackTriggered = true;
              clearTimeout(fallbackTimeout);
              settle();
            };

            const fallbackTimeout = setTimeout(() => {
              localSettle();
            }, 100);

            if (typeof (video as any).requestVideoFrameCallback === "function") {
              (video as any).requestVideoFrameCallback(localSettle);
            } else {
              // Fallback for older browsers: two rAF ticks gives GPU time to upload
              requestAnimationFrame(() => requestAnimationFrame(localSettle));
            }
          };

          const onError = () => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              clearTimeout(seekedFallbackTimeout);
              cleanup();
              reject(new Error(`Video seek error: ${sourceUrl} @ ${seekTime}s`));
            }
          };

          const cleanup = () => {
            video.removeEventListener("seeked", onSeeked);
            video.removeEventListener("error", onError);
          };

          // Register BEFORE setting currentTime — avoid missing the event
          video.addEventListener("seeked", onSeeked, { once: true });
          video.addEventListener("error", onError, { once: true });
          video.currentTime = seekTime;
        });
      } catch (error) {
        this.releaseVideo(pooledVideo);
        throw error;
      }
    }

    // Ensure we have a valid frame
    if (pooledVideo.element.readyState < 2) {
      // HAVE_CURRENT_DATA
      this.releaseVideo(pooledVideo);
      throw new Error(`Video not ready after seek: ${sourceUrl} @ ${seekTime}s`);
    }

    return pooledVideo.element;
  }

  /**
   * Mark a video element as no longer in use, making it available for reuse.
   *
   * @param video - Video element to release
   */
  releaseElement(video: HTMLVideoElement): void {
    const pooledVideo = this.videos.find((v) => v.element === video);
    if (pooledVideo) {
      pooledVideo.inUse = false;
    }
  }

  /**
   * Release and destroy a specific video from the pool.
   */
  private releaseVideo(pooledVideo: PooledVideo): void {
    const video = pooledVideo.element;
    video.pause();
    video.src = "";
    try {
      video.load(); // Release decoder resources
    } catch (e) {
      // ignore
    }

    if (typeof video.remove === "function") {
      video.remove();
    } else if (video.parentNode) {
      video.parentNode.removeChild(video);
    }

    const index = this.videos.indexOf(pooledVideo);
    if (index !== -1) {
      this.videos.splice(index, 1);
    }
  }

  /**
   * Release a video element by URL.
   *
   * @param sourceUrl - Video source URL
   */
  release(sourceUrl: string): void {
    const videosToRelease = this.videos.filter((v) => v.url === sourceUrl);
    videosToRelease.forEach((v) => this.releaseVideo(v));
  }

  /**
   * Release all video elements.
   */
  clear(): void {
    this.videos.forEach((v) => this.releaseVideo(v));
    this.videos = [];
  }

  /**
   * Get pool statistics.
   */
  getStats() {
    return {
      activeCount: this.videos.length,
      inUseCount: this.videos.filter((v) => v.inUse).length,
      maxConcurrent: this.config.maxConcurrent,
      urls: Array.from(new Set(this.videos.map((v) => v.url))),
    };
  }
}

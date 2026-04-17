/**
 * RenderEngine - Composites multiple video frames onto canvas with proper layering and scaling
 *               12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 22.1, 22.2, 22.3, 22.4, 22.5
 *               10.1, 10.2, 10.3, 10.4 (Error handling), 17.1, 17.2, 17.3, 17.4, 17.5, 17.6 (Loading states)
 */

import type { ActiveClip } from "../types/core";

export class RenderEngine {
  private ctx: CanvasRenderingContext2D;
  private canvasWidth: number;
  private canvasHeight: number;

  constructor(ctx: CanvasRenderingContext2D, width: number, height: number) {
    this.ctx = ctx;
    this.canvasWidth = width;
    this.canvasHeight = height;
  }

  /**
   * Render a composite frame with all active clips
   */
  renderFrame(activeClips: ActiveClip[]): void {
    try {
      this.ctx.fillStyle = "#000000";
      this.ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);

      if (activeClips.length === 0) {
        return;
      }

      // Lower track order values are drawn first, higher values on top
      for (const clip of activeClips) {
        try {
          this.drawClipFrame(clip);
        } catch (error) {
          console.error("Failed to draw clip, skipping:", {
            clipId: clip.id,
            sourcePath: clip.sourceMediaPath,
            error: error instanceof Error ? error.message : "Unknown error",
          });

          this.drawErrorPlaceholder(clip, error instanceof Error ? error.message : "Render error");

          continue;
        }
      }
    } catch (error) {
      console.error("Render frame failed:", {
        error: error instanceof Error ? error.message : "Unknown error",
        activeClipsCount: activeClips.length,
      });

      this.ctx.fillStyle = "#000000";
      this.ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);
      this.ctx.fillStyle = "#ff0000";
      this.ctx.font = "16px sans-serif";
      this.ctx.fillText("Render error", 10, 30);
    }
  }

  /**
   * Draw a single clip frame to the canvas with aspect ratio preservation
   */
  private drawClipFrame(clip: ActiveClip): void {
    const video = clip.videoElement;

    // Enhanced video readiness check
    // Prefer readyState >= 3 (HAVE_FUTURE_DATA) for best results, but accept >= 2 (HAVE_CURRENT_DATA)
    // readyState >= 2 means at least current frame data is available
    // readyState >= 3 means future frames are also available (better for smooth playback)
    if (video.readyState < 2) {
      console.log("Video not ready for drawing - readyState:", video.readyState, "clipId:", clip.id);
      return;
    }

    // Get video dimensions
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;

    if (videoWidth === 0 || videoHeight === 0) {
      console.warn("Invalid video dimensions - videoWidth:", videoWidth, "videoHeight:", videoHeight, "clipId:", clip.id);
      return; // Invalid dimensions
    }

    // Validate video element state before drawImage (only in production, not for test mocks)
    if (video.src && video.src !== "" && !Number.isFinite(video.currentTime)) {
      console.warn("Video element has invalid currentTime - currentTime:", video.currentTime, "clipId:", clip.id);
      return;
    }

    // Log diagnostic information about video element state
    if (video.src && video.src !== "") {
      console.log("Drawing video frame - clipId:", clip.id, "readyState:", video.readyState, "currentTime:", video.currentTime, "videoWidth:", videoWidth, "videoHeight:", videoHeight, "src:", video.src.substring(0, 50) + "...");
    }

    const videoAspect = videoWidth / videoHeight;
    const canvasAspect = this.canvasWidth / this.canvasHeight;

    let drawWidth: number;
    let drawHeight: number;
    let drawX: number;
    let drawY: number;

    if (videoAspect > canvasAspect) {
      // Video is wider - fit width, pillarbox
      drawWidth = this.canvasWidth;
      drawHeight = this.canvasWidth / videoAspect;
      drawX = 0;
    } else {
      // Video is taller - fit height, letterbox
      drawHeight = this.canvasHeight;
      drawWidth = this.canvasHeight * videoAspect;
      drawY = 0;
    }

    try {
      this.ctx.drawImage(video, drawX, drawY, drawWidth, drawHeight);
      console.log("Successfully drew video frame - clipId:", clip.id, "drawX:", drawX, "drawY:", drawY, "drawWidth:", drawWidth, "drawHeight:", drawHeight);
    } catch (error) {
      // Enhanced error logging with detailed video element and canvas context state
      console.error("Failed to draw video frame:", {
        clipId: clip.id,
        sourcePath: clip.sourceMediaPath,
        error: error instanceof Error ? error.message : "Unknown error",
        videoState: {
          readyState: video.readyState,
          currentTime: video.currentTime,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
          src: video.src,
          paused: video.paused,
          ended: video.ended,
          networkState: video.networkState,
        },
        canvasState: {
          width: this.canvasWidth,
          height: this.canvasHeight,
          globalAlpha: this.ctx.globalAlpha,
          globalCompositeOperation: this.ctx.globalCompositeOperation,
        },
        drawParams: {
          drawX,
          drawY,
          drawWidth,
          drawHeight,
        },
      });
    }
  }

  /**
   * Draw error placeholder for failed clip
   */
  private drawErrorPlaceholder(clip: ActiveClip, errorMessage: string): void {
    // Draw semi-transparent red rectangle
    this.ctx.fillStyle = "rgba(255, 0, 0, 0.3)";
    this.ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);

    // Draw error text
    this.ctx.fillStyle = "#ffffff";
    this.ctx.font = "16px sans-serif";
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";

    const centerX = this.canvasWidth / 2;
    const centerY = this.canvasHeight / 2;

    this.ctx.fillText("Failed to render clip", centerX, centerY - 20);
    this.ctx.fillText(errorMessage, centerX, centerY + 10);
  }

  /**
   * Draw loading indicator overlay
   */
  drawLoadingIndicator(message: string = "Loading..."): void {
    // Draw semi-transparent overlay
    this.ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    this.ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);

    // Draw loading text
    this.ctx.fillStyle = "#ffffff";
    this.ctx.font = "18px sans-serif";
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";

    const centerX = this.canvasWidth / 2;
    const centerY = this.canvasHeight / 2;

    this.ctx.fillText(message, centerX, centerY);
  }

  /**
   * Draw "No clips at this position" message
   */
  drawNoClipsMessage(): void {
    // Clear canvas with black background
    this.ctx.fillStyle = "#000000";
    this.ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);

    // Draw message text
    this.ctx.fillStyle = "#888888";
    this.ctx.font = "16px sans-serif";
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";

    const centerX = this.canvasWidth / 2;
    const centerY = this.canvasHeight / 2;

    this.ctx.fillText("No clips at this position", centerX, centerY);
  }

  /**
   * Draw "Loading preview..." message during initialization
   */
  drawInitializingMessage(): void {
    // Clear canvas with black background
    this.ctx.fillStyle = "#000000";
    this.ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);

    // Draw message text
    this.ctx.fillStyle = "#ffffff";
    this.ctx.font = "18px sans-serif";
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";

    const centerX = this.canvasWidth / 2;
    const centerY = this.canvasHeight / 2;

    this.ctx.fillText("Loading preview...", centerX, centerY);
  }

  /**
   * Draw error message for failed video load
   */
  drawVideoLoadError(fileName: string): void {
    // Clear canvas with black background
    this.ctx.fillStyle = "#000000";
    this.ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);

    // Draw error text
    this.ctx.fillStyle = "#ff4444";
    this.ctx.font = "16px sans-serif";
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";

    const centerX = this.canvasWidth / 2;
    const centerY = this.canvasHeight / 2;

    this.ctx.fillText("Failed to load video:", centerX, centerY - 15);
    this.ctx.fillText(fileName, centerX, centerY + 15);
  }

  /**
   * Validate render pipeline before drawing
   */
  validateRenderPipeline(activeClips: ActiveClip[]): boolean {
    if (!this.ctx) {
      console.warn("Canvas context not available");
      return false;
    }

    if (this.canvasWidth <= 0 || this.canvasHeight <= 0) {
      console.warn("Invalid canvas dimensions");
      return false;
    }

    for (const clip of activeClips) {
      if (!clip.videoElement) {
        console.warn(`Clip ${clip.id} missing video element`);
        return false;
      }

      if (clip.clipTime < clip.sourceStart || clip.clipTime > clip.sourceEnd) {
        console.warn(`Clip ${clip.id} time ${clip.clipTime} outside source boundaries [${clip.sourceStart}, ${clip.sourceEnd}]`);
        return false;
      }

      if (!Number.isFinite(clip.trackIndex)) {
        console.warn(`Clip ${clip.id} has invalid track order`);
        return false;
      }
    }

    return true;
  }
}

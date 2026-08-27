/**
 * Project Thumbnail Service
 *
 * Provides canonical, asynchronous, save-triggered project thumbnail generation
 * using the native FrameRequest compositor pipeline.
 *
 * Architectural Invariants:
 * 1. Never triggered by playhead scrubbing or active playback.
 * 2. Keyed by (projectId, epoch) to avoid redundant renders.
 * 3. Throttled during active auto-save intervals (minimum 10s between renders).
 * 4. Completely non-blocking — saves return immediately while thumbnail renders in the background.
 */

import type { Clip, Track, MediaAsset, Project, TransitionTimelineItem, Gap, TimelineMarker } from "@/types";
import { evaluateTimelineSceneCached } from "@/core/evaluation/evaluator";
import { buildNativeFrameRequest } from "@/components/editor/preview/nativeVideoPreview";
import { isTauriRuntime, renderNativeFrame } from "@/lib/platform/tauri";

export interface ProjectThumbnailSourceState {
  tracks: Track[];
  clips: Clip[];
  transitions?: TransitionTimelineItem[];
  gaps?: Gap[];
  markers?: TimelineMarker[];
  mediaAssets?: MediaAsset[];
  epoch?: number;
}

export interface ThumbnailRequestOptions {
  /** If true, applies minimum time throttle between background renders */
  isAutoSave?: boolean;
  /** Force generation even if revision key matches */
  force?: boolean;
  /** Target maximum width for the thumbnail (default 640) */
  maxWidth?: number;
  /** JPEG compression quality (0-1, default 0.85) */
  quality?: number;
}

/** Minimum interval between thumbnail generations during rapid auto-saves (10 seconds) */
const AUTO_SAVE_THROTTLE_MS = 10_000;

class ProjectThumbnailService {
  private lastGeneratedKey: string = "";
  private lastGeneratedAtMs: number = 0;
  private pendingGeneration: Promise<string | undefined> | null = null;

  /**
   * Determine the most representative timestamp for the project poster frame.
   * Defaults to Frame 0 (0.0s). If Frame 0 is in an empty gap, selects the start
   * time of the earliest visual clip.
   */
  resolvePosterTimestamp(clips: Clip[]): number {
    if (!clips || clips.length === 0) return 0.0;

    const visualClips = clips.filter((c) => {
      const kind = c.kind || (c as any).type;
      return kind === "video" || kind === "image" || kind === "sticker" || kind === "text";
    });

    if (visualClips.length === 0) return 0.0;

    // Check if any visual clip is active at 0.0s
    const activeAtZero = visualClips.some((c) => c.startTime <= 0.001 && c.startTime + c.duration > 0.001);
    if (activeAtZero) {
      return 0.0;
    }

    // Find the earliest visual clip start time
    let earliestStart = visualClips[0].startTime;
    for (let i = 1; i < visualClips.length; i++) {
      if (visualClips[i].startTime < earliestStart) {
        earliestStart = visualClips[i].startTime;
      }
    }

    return Math.max(0.0, earliestStart);
  }

  /**
   * Render a single thumbnail frame using the native compositor and return a JPEG Data URL.
   */
  async generateThumbnail(
    project: Project,
    source: ProjectThumbnailSourceState,
    maxWidth = 640,
    quality = 0.85,
  ): Promise<string | undefined> {
    const clips = source.clips ?? [];
    const tracks = source.tracks ?? [];
    const mediaAssets = source.mediaAssets ?? project.mediaAssets ?? [];
    const transitions = source.transitions ?? [];
    const epoch = source.epoch ?? 0;

    const targetTime = this.resolvePosterTimestamp(clips);
    const scene = evaluateTimelineSceneCached(targetTime, clips, tracks, mediaAssets, project, epoch, transitions);

    if (!isTauriRuntime()) {
      // In non-Tauri / test environments, fallback to first media asset poster or undefined
      const firstVisual = mediaAssets.find((a) => a.type === "video" || a.type === "image");
      return firstVisual?.posterFrame || firstVisual?.coverArt || (firstVisual?.type === "image" ? firstVisual.path : undefined);
    }

    const frameRate = Math.max(1, Math.round(project.frameRate || 30));
    const frameIndex = Math.max(0, Math.round(targetTime * frameRate));
    const nativeRequest = buildNativeFrameRequest(
      scene,
      `${project.id}:${epoch}`,
      frameIndex,
      frameRate,
      project.canvasWidth || 1920,
      project.canvasHeight || 1080,
      [],
      { mode: "frameStep", quality: "full" },
    );
    if (!nativeRequest || (
      nativeRequest.project.videoLayers.length === 0 &&
      (nativeRequest.project.rasterLayers?.length ?? 0) === 0 &&
      (nativeRequest.project.textLayers?.length ?? 0) === 0
    )) {
      // If no compositable visual layers exist, fallback to asset poster
      const firstVisual = mediaAssets.find((a) => a.type === "video" || a.type === "image");
      return firstVisual?.posterFrame || firstVisual?.coverArt || (firstVisual?.type === "image" ? firstVisual.path : undefined);
    }

    const canvasWidth = nativeRequest.project.canvasWidth || project.canvasWidth || 1920;
    const canvasHeight = nativeRequest.project.canvasHeight || project.canvasHeight || 1080;

    let rgba: ArrayBuffer;
    try {
      rgba = await renderNativeFrame(nativeRequest);
    } catch (err) {
      console.warn("[ProjectThumbnailService] Native thumbnail render failed:", err);
      return undefined;
    }

    if (!rgba || rgba.byteLength === 0) {
      return undefined;
    }

    // Downscale RGBA buffer to thumbnail dimensions
    const scale = Math.min(1, maxWidth / canvasWidth);
    const targetWidth = Math.max(1, Math.round(canvasWidth * scale));
    const targetHeight = Math.max(1, Math.round(canvasHeight * scale));

    const fullCanvas = document.createElement("canvas");
    fullCanvas.width = canvasWidth;
    fullCanvas.height = canvasHeight;
    const fullCtx = fullCanvas.getContext("2d");
    if (!fullCtx) return undefined;

    const imgData = fullCtx.createImageData(canvasWidth, canvasHeight);
    imgData.data.set(new Uint8ClampedArray(rgba));
    fullCtx.putImageData(imgData, 0, 0);

    const scaledCanvas = document.createElement("canvas");
    scaledCanvas.width = targetWidth;
    scaledCanvas.height = targetHeight;
    const scaledCtx = scaledCanvas.getContext("2d");
    if (!scaledCtx) return undefined;

    scaledCtx.drawImage(fullCanvas, 0, 0, canvasWidth, canvasHeight, 0, 0, targetWidth, targetHeight);
    return scaledCanvas.toDataURL("image/jpeg", quality);
  }

  /**
   * Request thumbnail generation in the background if the revision changed and throttle permits.
   */
  requestThumbnailUpdate(
    project: Project | null,
    source: ProjectThumbnailSourceState,
    options: ThumbnailRequestOptions = {},
  ): void {
    if (!project || !project.id) return;

    const epoch = source.epoch ?? 0;
    const revisionKey = `${project.id}:${epoch}`;
    const now = performance.now();

    if (!options.force && revisionKey === this.lastGeneratedKey) {
      return;
    }

    if (
      options.isAutoSave &&
      !options.force &&
      this.lastGeneratedAtMs > 0 &&
      now - this.lastGeneratedAtMs < AUTO_SAVE_THROTTLE_MS
    ) {
      return;
    }

    this.lastGeneratedKey = revisionKey;
    this.lastGeneratedAtMs = now;

    // Run completely in background without blocking the caller
    const currentGenerationPromise: Promise<string | undefined> = (async () => {
      try {
        const thumbnailDataUrl = await this.generateThumbnail(
          project,
          source,
          options.maxWidth ?? 640,
          options.quality ?? 0.85,
        );

        if (thumbnailDataUrl && thumbnailDataUrl !== project.thumbnail) {
          const { useProjectStore } = await import("@/store/projectStore");
          useProjectStore.getState().setProjectThumbnail(thumbnailDataUrl);
        }
        return thumbnailDataUrl;
      } catch (err) {
        console.warn("[ProjectThumbnailService] Background thumbnail generation failed:", err);
        return undefined;
      }
    })();

    this.pendingGeneration = currentGenerationPromise;
    currentGenerationPromise.finally(() => {
      if (this.pendingGeneration === currentGenerationPromise) {
        this.pendingGeneration = null;
      }
    });
  }

  /** Reset cache state (e.g. on project close or tests) */
  reset(): void {
    this.lastGeneratedKey = "";
    this.lastGeneratedAtMs = 0;
    this.pendingGeneration = null;
  }
}

export const projectThumbnailService = new ProjectThumbnailService();

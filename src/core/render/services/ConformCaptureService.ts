/**
 * Conform Capture Service
 *
 * Automatically captures video source dimensions and updates clip conform settings.
 * This ensures proper aspect ratio handling for newly added video clips.
 */

import type { ClipConform } from "@clypra-studio/engine";

export class ConformCaptureService {
  /**
   * Capture video dimensions and update clip conform if needed.
   *
   * Only updates if:
   * - Video has valid dimensions
   * - Clip has conform settings
   * - Conform is missing source dimensions
   *
   * @param clipId - Clip identifier
   * @param videoElement - Video element with metadata
   * @param currentConform - Current conform settings (if any)
   */
  captureVideoDimensions(clipId: string, videoElement: HTMLVideoElement, currentConform?: ClipConform): void {
    if (!this.shouldCapture(videoElement, currentConform)) {
      return;
    }

    const dimensions = {
      sourceWidth: videoElement.videoWidth,
      sourceHeight: videoElement.videoHeight,
    };

    this.updateClipConform(clipId, dimensions, currentConform).catch((err) => {
      if (import.meta.env.DEV) {
        console.error(`[ConformCapture] Failed for clip ${clipId}:`, err);
      }
    });
  }

  /**
   * Determine if dimensions should be captured.
   *
   * @param element - Video element
   * @param conform - Current conform settings
   * @returns true if capture is needed
   */
  private shouldCapture(element: HTMLVideoElement, conform?: ClipConform): boolean {
    return !!(element.videoWidth > 0 && element.videoHeight > 0 && conform && (!conform.sourceWidth || !conform.sourceHeight));
  }

  /**
   * Update clip conform with captured dimensions.
   *
   * @param clipId - Clip identifier
   * @param dimensions - Captured video dimensions
   * @param currentConform - Current conform settings
   */
  private async updateClipConform(clipId: string, dimensions: { sourceWidth: number; sourceHeight: number }, currentConform?: ClipConform): Promise<void> {
    const { useTimelineStore } = await import("@/store/timelineStore");
    const store = useTimelineStore.getState();
    const clip = store.clips.find((c) => c.id === clipId);

    if (!clip) {
      return;
    }

    // Double-check in case metadata changed
    const conform = (clip as any).conform;
    if (conform && (conform.sourceWidth || conform.sourceHeight)) {
      return; // Already has dimensions
    }

    store.updateClip(clipId, {
      conform: {
        mode: currentConform?.mode || "fit",
        ...dimensions,
        userScale: currentConform?.userScale ?? 1,
        userOffsetX: currentConform?.userOffsetX ?? 0,
        userOffsetY: currentConform?.userOffsetY ?? 0,
      },
    });
  }
}

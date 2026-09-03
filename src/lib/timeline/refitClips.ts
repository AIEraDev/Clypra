/**
 * Re-fit Clips for Canvas Change
 *
 * When the project aspect ratio / canvas dimensions change, existing clips
 * retain their old {x, y, width, height} values computed for the previous
 * canvas. This utility re-calculates placement for each visual clip using
 * its stored fitMode against the NEW canvas dimensions.
 *
 * Professional NLEs (CapCut, Premiere, Resolve) all re-fit on aspect change.
 */

import { useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import { calculateClipDimensions, type ClipFitModeExtended } from "./timelineClip";
import { DEFAULT_PLACEMENT_POLICY } from "./placementPolicy";

/**
 * Re-fit all visual clips to the new canvas dimensions.
 * Call this AFTER updateProject() has set the new canvasWidth/canvasHeight.
 *
 * Text clips are excluded — they have independent positioning that should
 * not be overridden by a fit algorithm.
 */
export function refitClipsForCanvasChange(
  newCanvasWidth: number,
  newCanvasHeight: number,
  oldCanvasWidth?: number,
  oldCanvasHeight?: number
): void {
  const { clips, updateClip } = useTimelineStore.getState();
  const { mediaAssets } = useProjectStore.getState();

  const assetMap = new Map(mediaAssets.map((a) => [a.id, a]));

  const project = useProjectStore.getState().project;
  const oW = oldCanvasWidth ?? project?.canvasWidth ?? 1920;
  const oH = oldCanvasHeight ?? project?.canvasHeight ?? 1080;
  const scaleX = oW > 0 ? newCanvasWidth / oW : 1.0;
  const scaleY = oH > 0 ? newCanvasHeight / oH : 1.0;

  for (const clip of clips) {
    if (clip.kind === "text") {
      // Scale text clips proportionally when canvas dimensions change
      if (oldCanvasWidth && oldCanvasHeight) {
        const newX = clip.x * scaleX;
        const newY = clip.y * scaleY;
        const newWidth = clip.width * scaleX;
        const newHeight = clip.height * scaleY;
        const currentFontSize = (clip as any).fontSize || 32;
        const newFontSize = Math.max(10, Math.min(300, Math.round(currentFontSize * scaleX)));

        updateClip(clip.id, {
          x: newX,
          y: newY,
          width: newWidth,
          height: newHeight,
          fontSize: newFontSize,
        } as any);
      }
      continue;
    }

    const asset = assetMap.get(clip.mediaId);
    if (!asset) continue;
    if (asset.type !== "video" && asset.type !== "image") continue;

    const fitMode: ClipFitModeExtended = (clip as any).fitMode ?? DEFAULT_PLACEMENT_POLICY.defaultVisualFitMode;
    const newDims = calculateClipDimensions(asset, newCanvasWidth, newCanvasHeight, fitMode);

    let nextConform = (clip as any).conform;
    if (nextConform) {
      const conformMode =
        fitMode === "cover" || fitMode === "fill"
          ? "fill"
          : fitMode === "stretch"
          ? "stretch"
          : fitMode === "original"
          ? "none"
          : "fit";

      const scaledOffsetX = (nextConform.userOffsetX ?? 0) * scaleX;
      const scaledOffsetY = (nextConform.userOffsetY ?? 0) * scaleY;

      nextConform = {
        ...nextConform,
        mode: conformMode,
        sourceWidth: nextConform.sourceWidth || asset.width || 0,
        sourceHeight: nextConform.sourceHeight || asset.height || 0,
        userOffsetX: scaledOffsetX,
        userOffsetY: scaledOffsetY,
      };
    }

    // Update if dimensions or conform changed
    updateClip(clip.id, {
      ...newDims,
      ...(nextConform ? { conform: nextConform } : {}),
    });
  }
}

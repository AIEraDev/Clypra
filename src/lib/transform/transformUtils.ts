/**
 * Transform Utilities
 *
 * Pure functions for transform geometry, hit testing, and clip bounds resolution.
 * Extracted from TransformOverlay so they can be used by the native GPU overlay
 * pipeline (nativeEditorOverlay.ts) without importing React components.
 */

import { isClipActiveAtTime } from "@/lib/timeline/timelineClip";
import { resolveConform, resolveTextTemplateArtifact } from "@clypra-studio/engine";
import { calculateTextClipAuthoredSize } from "@/lib/text/textClip";
import { calculateOptimalTemplateLayout } from "@/core/render/templateScale";
import { toCompositorClip } from "@/core/timeline/adapter";
import { compareCompositorClips } from "@/core/compositor/ordering";
import { evaluateVisualPropertyKeyframes } from "@/core/evaluation/animation";
import { hitTestClip, type ViewportTransform } from "@/lib/utils/coordinateSystem";
import { canvasToScreen } from "@/lib/utils/coordinateSystem";
import type { Clip, TextClip, Track, TransformHandle, TransformState } from "@/types";
import type { CompositorClip } from "@/core/compositor/types";
import type { ActiveSnapGuides, DragGeometry } from "@/core/interactions";
import {
  getActiveSessionOrNull,
} from "@/core/runtime/ProjectSession";
import {
  type ProgramPreviewPresenter,
} from "@/components/editor/preview/programPreviewPresenterState";

export { isClipActiveAtTime };

export function shouldScaleTextFontForHandle(handle: TransformHandle): boolean {
  return handle !== "move" && handle !== "rotate";
}

/**
 * Choose resize affordances that cannot overlap on a compact selection.
 *
 * The selection border remains the move target at every size. Keeping all
 * eight handles on a tiny text box makes their hit regions compete, causing a
 * pointer near one handle to unpredictably begin another transform. Clypra
 * uses corner handles as its sole resize affordance; side/midpoint handles
 * are intentionally omitted so compact text never falls back to ambiguous
 * axis-only controls.
 */
export function getVisibleTransformHandles(
  _width: number,
  _height: number,
): readonly TransformHandle[] {
  return ["nw", "ne", "sw", "se"];
}

/** Keep corner hit targets distinct without changing selected geometry. */
export function getCompactCornerOutset(
  width: number,
  height: number,
): { x: number; y: number } {
  const minimumCornerSeparation = 28;
  return {
    x: Math.max(0, (minimumCornerSeparation - width) / 2),
    y: Math.max(0, (minimumCornerSeparation - height) / 2),
  };
}

export function calculateTextResizeFontSize(
  startFontSize: number,
  handle: TransformHandle,
  startTransform: { width: number; height: number },
  nextTransform: { width?: number; height?: number },
): number {
  const scale = calculateTextResizeScale(handle, startTransform, nextTransform);
  return Math.max(10, Math.min(1000, Math.round(startFontSize * scale)));
}

export function calculateTextResizeScale(
  handle: TransformHandle,
  startTransform: { width: number; height: number },
  nextTransform: { width?: number; height?: number },
): number {
  const startWidth = Math.max(1, startTransform.width);
  const startHeight = Math.max(1, startTransform.height);
  const nextWidth = nextTransform.width ?? startTransform.width;
  const nextHeight = nextTransform.height ?? startTransform.height;

  let scale = 1;
  if (handle === "e" || handle === "w") {
    scale = nextWidth / startWidth;
  } else if (handle === "n" || handle === "s") {
    scale = nextHeight / startHeight;
  } else if (
    handle === "nw" ||
    handle === "ne" ||
    handle === "sw" ||
    handle === "se"
  ) {
    const widthScale = nextWidth / startWidth;
    const heightScale = nextHeight / startHeight;
    scale =
      Math.abs(widthScale - 1) >= Math.abs(heightScale - 1)
        ? widthScale
        : heightScale;
  }

  return Math.max(0.01, scale);
}

export function calculateScaledTextTransform(
  handle: TransformHandle,
  startTransform: { x: number; y: number; width: number; height: number },
  nextTransform: Partial<Clip>,
  scale: number,
): Partial<Clip> {
  if (!shouldScaleTextFontForHandle(handle)) return nextTransform;

  const centerX = startTransform.x + startTransform.width / 2;
  const centerY = startTransform.y + startTransform.height / 2;
  const scaledWidth = startTransform.width * scale;
  const scaledHeight = startTransform.height * scale;

  if (handle === "e" || handle === "w") {
    return {
      ...nextTransform,
      height: scaledHeight,
      y: centerY - scaledHeight / 2,
    };
  }

  if (handle === "n" || handle === "s") {
    return {
      ...nextTransform,
      width: scaledWidth,
      x: centerX - scaledWidth / 2,
    };
  }

  return {
    ...nextTransform,
    x: centerX - scaledWidth / 2,
    y: centerY - scaledHeight / 2,
    width: scaledWidth,
    height: scaledHeight,
  };
}

export function buildTransformStartClip(
  selectedClip: Clip,
  activeTransform: TransformState,
): Clip {
  return {
    ...selectedClip,
    ...activeTransform.startTransform,
    id: activeTransform.clipId,
    aspectRatioLocked: activeTransform.aspectRatioLocked,
    sourceAspectRatio: activeTransform.sourceAspectRatio,
  };
}

/**
 * Convert the controller's canvas-space geometry into an imperative transform
 * for the already-mounted selection box. The box keeps its React-rendered
 * starting bounds; only this CSS custom property changes during a drag.
 */
export interface CanvasVisualBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * Optional canvas-space pivot supplied by a raster presenter. A tight text
   * box can be offset within its texture, so rotating around its own centre
   * would visibly diverge from the compositor.
   */
  pivotX?: number;
  pivotY?: number;
  /** Diagnostic-only origin; emitted once when a text transform begins. */
  source?:
    | "browser-tight"
    | "native-tight"
    | "authored-fallback"
    | "layout-box";
}

/**
 * Maps the authored geometry that is sent to the preview renderer to the
 * larger visual bounds used by the selection overlay. Plain point text can
 * have raster bleed outside its authored box; that bleed is presentation
 * metadata, never a transform to commit back to the clip.
 */
export function resolveVisualDragGeometry(
  geometry: DragGeometry,
  startTransform: TransformState["startTransform"],
  visualStart?: CanvasVisualBounds,
): CanvasVisualBounds {
  if (!visualStart) {
    return geometry;
  }

  const scaleX = geometry.width / Math.max(1, startTransform.width);
  const scaleY = geometry.height / Math.max(1, startTransform.height);
  return {
    x:
      geometry.visualX ??
      geometry.x + (visualStart.x - startTransform.x) * scaleX,
    y:
      geometry.visualY ??
      geometry.y + (visualStart.y - startTransform.y) * scaleY,
    width: visualStart.width * scaleX,
    height: visualStart.height * scaleY,
  };
}

/**
 * Resolves the actual rendered visual bounds of a clip on the canvas.
 * For video clips with conform, calculates post-conform fitted dimensions.
 * For text-template clips, resolves the tight visual bounding box of the rendered
 * template badge (from NativeRasterBridge's raster snapshot or template node bounds)
 * instead of full-canvas clip dimensions.
 */
export function resolveClipVisualBounds(
  clip: Clip,
  canvasWidth?: number,
  canvasHeight?: number,
  presenter: ProgramPreviewPresenter | null = null,
  currentTime?: number,
): CanvasVisualBounds {
  let x = clip.x;
  let y = clip.y;
  let width = clip.width;
  let height = clip.height;

  const vkf = clip.visualKeyframes;
  if (currentTime !== undefined && vkf) {
    const offset = Math.max(0, currentTime - clip.startTime);
    if (vkf.width?.length) {
      width = evaluateVisualPropertyKeyframes(
        vkf.width,
        offset,
        clip.width,
        clip.duration,
      );
    }
    if (vkf.height?.length) {
      height = evaluateVisualPropertyKeyframes(
        vkf.height,
        offset,
        clip.height,
        clip.duration,
      );
    }
    if (vkf.x?.length) {
      x = evaluateVisualPropertyKeyframes(vkf.x, offset, clip.x, clip.duration);
    } else if (vkf.width?.length && clip.width) {
      const centerX = clip.x + clip.width / 2;
      x = centerX - width / 2;
    }
    if (vkf.y?.length) {
      y = evaluateVisualPropertyKeyframes(vkf.y, offset, clip.y, clip.duration);
    } else if (vkf.height?.length && clip.height) {
      const centerY = clip.y + clip.height / 2;
      y = centerY - height / 2;
    }
  }

  if (
    canvasWidth &&
    canvasHeight &&
    clip.conform &&
    clip.conform.sourceWidth &&
    clip.conform.sourceHeight
  ) {
    // Only use conform-derived bounds when the user has NOT manually scaled
    // and keyframes do not override transform geometry.
    // Once the user touches the Scale slider, `baseWidth` is written to the
    // clip — that signals that clip.x/y/width/height are authoritative and
    // must not be silently overridden by resolveConform(). This mirrors the
    // identical guard added to the evaluator so the overlay and the rendered
    // frame always show the same bounding box.
    const hasManualScale = (clip as any).baseWidth != null;
    const hasKeyframes = Boolean(
      vkf?.x?.length ||
      vkf?.y?.length ||
      vkf?.width?.length ||
      vkf?.height?.length,
    );
    if (!hasManualScale && !hasKeyframes) {
      const resolved = resolveConform(
        {
          ...clip.conform,
          userScale: clip.conform.userScale ?? 1,
          userOffsetX: clip.conform.userOffsetX ?? 0,
          userOffsetY: clip.conform.userOffsetY ?? 0,
        },
        canvasWidth,
        canvasHeight,
      );
      if (resolved) {
        x = resolved.x;
        y = resolved.y;
        width = resolved.width;
        height = resolved.height;
      }
    }
    return { x, y, width, height };
  }

  if (
    (clip.kind === "text-template" || clip.templateSnapshot) &&
    canvasWidth &&
    canvasHeight
  ) {
    // 1. Resolve artifact to inspect template authored dimensions vs clip dimensions
    const artifact =
      resolveTextTemplateArtifact(clip.templateSnapshot || (clip as any)) ??
      ((clip.templateSnapshot as any)?.document?.nodes
        ? (clip.templateSnapshot as any)
        : (clip as any)?.document?.nodes
          ? (clip as any)
          : null);

    const docWidth = Math.max(
      1,
      Math.round(Number(artifact?.document?.canvas?.width) || 1920),
    );
    const docHeight = Math.max(
      1,
      Math.round(Number(artifact?.document?.canvas?.height) || 1080),
    );

    // A template clip is full-artboard (unbounded) if it spans the full authoring artboard
    // or the full canvas, starting at (0, 0).
    const isFullArtboard =
      clip.x === 0 &&
      clip.y === 0 &&
      ((clip.width >= docWidth && clip.height >= docHeight) ||
        (clip.width >= canvasWidth && clip.height >= canvasHeight) ||
        (clip.width === 1920 && clip.height === 1080));

    // If already content-bounded, return clip dimensions directly
    if (!isFullArtboard && clip.width > 0 && clip.height > 0) {
      console.log(
        "[TransformOverlay:VisualBounds] using content-bounded clip dimensions directly",
        {
          clipId: clip.id,
          bounds: {
            x: clip.x,
            y: clip.y,
            width: clip.width,
            height: clip.height,
          },
        },
      );
      return { x: clip.x, y: clip.y, width: clip.width, height: clip.height };
    }

    // 2. For full-artboard template, inspect exact rendered quad from active nativeRasterBridge if available
    const snapshot =
      getActiveSessionOrNull()?.nativeRasterBridge?.getTextSnapshot(clip.id);
    if (
      snapshot &&
      typeof snapshot.x === "number" &&
      typeof snapshot.y === "number" &&
      typeof snapshot.displayWidth === "number" &&
      snapshot.displayWidth > 0 &&
      typeof snapshot.displayHeight === "number" &&
      snapshot.displayHeight > 0
    ) {
      console.log(
        "[TransformOverlay:VisualBounds] using nativeRasterBridge snapshot for full artboard",
        {
          clipId: clip.id,
          snapshot: {
            x: snapshot.x,
            y: snapshot.y,
            width: snapshot.displayWidth,
            height: snapshot.displayHeight,
          },
        },
      );
      return {
        x: snapshot.x,
        y: snapshot.y,
        width: snapshot.displayWidth,
        height: snapshot.displayHeight,
      };
    }

    // 3. Fallback: estimate from template artifact node bounds under uniform scaling
    if (artifact?.document?.nodes && artifact.document.nodes.length > 0) {
      const layout = calculateOptimalTemplateLayout(
        artifact,
        canvasWidth,
        canvasHeight,
        clip.templateControlValues,
      );
      console.log(
        "[TransformOverlay:VisualBounds] fallback: calculated optimal template layout",
        {
          clipId: clip.id,
          contentBounds: layout.contentBounds,
        },
      );
      return {
        x: layout.contentBounds.x,
        y: layout.contentBounds.y,
        width: layout.contentBounds.width,
        height: layout.contentBounds.height,
      };
    }
  }

  // Text selection is the editor layout object, never a cropped raster's ink
  // bounds. Underline, italic overhang, and presenter switches may change the
  // uploaded pixels, but must not change resize handles or the rotation pivot.
  if (clip.kind === "text") {
    return {
      x,
      y,
      width,
      height,
      pivotX: x + width / 2,
      pivotY: y + height / 2,
      source: "layout-box",
    };
  }

  return { x, y, width, height };
}

/**
 * During an active transform the native raster snapshot legitimately changes
 * every pointer frame. The selection box already receives the same movement
 * as an imperative CSS transform, so rebasing its React layout onto that live
 * snapshot would apply the delta twice and make the handles jump. Freeze the
 * visual base captured on pointer-down until the controller ends the gesture.
 */
export function resolveOverlayBaseVisualBounds(
  clip: Clip,
  canvasWidth: number,
  canvasHeight: number,
  activeDragVisualBounds?: CanvasVisualBounds | null,
  presenter: ProgramPreviewPresenter | null = null,
  currentTime?: number,
): CanvasVisualBounds {
  return (
    activeDragVisualBounds ??
    resolveClipVisualBounds(
      clip,
      canvasWidth,
      canvasHeight,
      presenter,
      currentTime,
    )
  );
}

/**
 * Return active clips under a canvas point in compositor order. This is shared
 * by the full-overlay click target and the selected clip's move surface: the
 * latter otherwise intercepts every click inside the selected video and makes
 * text/image layers impossible to select.
 */
export interface HitTestCandidateDiagnostic {
  clip: Clip;
  index: number;
  trackIndex: number;
  role: string | undefined;
  zIndex: number;
  evaluationPriority: number;
  compositorClip: CompositorClip;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
  };
  hit: boolean;
}

export function getHitTestCandidateDiagnostics(
  clips: readonly Clip[],
  tracks: readonly Track[],
  currentTime: number,
  canvasX: number,
  canvasY: number,
  canvasWidth?: number,
  canvasHeight?: number,
): HitTestCandidateDiagnostic[] {
  const interactiveTrackIds = new Set(
    tracks
      .filter((track) => track.visible !== false && track.locked !== true)
      .map((track) => track.id),
  );

  return clips
    .map((clip, index) => ({
      clip,
      index,
      compositorClip: toCompositorClip(clip, tracks),
    }))
    .filter(({ clip }) => {
      if (!interactiveTrackIds.has(clip.trackId)) return false;
      if (
        clip.kind === "audio" ||
        clip.kind === "filter" ||
        clip.kind === "video-effect" ||
        clip.kind === "body-effect"
      ) {
        return false;
      }
      return isClipActiveAtTime(clip, currentTime);
    })
    .map(({ clip, index, compositorClip }) => {
      const visual = resolveClipVisualBounds(
        clip,
        canvasWidth,
        canvasHeight,
        null,
        currentTime,
      );
      const bounds = {
        x: visual.x,
        y: visual.y,
        width: visual.width,
        height: visual.height,
        rotation:
          clip.visualKeyframes?.rotation?.length && currentTime !== undefined
            ? evaluateVisualPropertyKeyframes(
                clip.visualKeyframes.rotation,
                Math.max(0, currentTime - clip.startTime),
                clip.rotation ?? 0,
                clip.duration,
              )
            : (clip.rotation ?? 0),
      };
      return {
        clip,
        index,
        trackIndex: compositorClip.trackIndex,
        role: compositorClip.role,
        zIndex: compositorClip.zIndex,
        evaluationPriority: compositorClip.evaluationPriority,
        compositorClip,
        bounds,
        hit:
          visual.width > 0 &&
          visual.height > 0 &&
          hitTestClip(canvasX, canvasY, bounds),
      };
    })
    .sort((a, b) => {
      // The compositor is the authority for visual stacking. Hit testing
      // must inspect the same foreground-first order as the rendered frame;
      // a second track-index-only ordering drifts when zIndex or semantic
      // compositor metadata is present.
      const compositorOrder = compareCompositorClips(
        b.compositorClip,
        a.compositorClip,
      );
      if (compositorOrder !== 0) return compositorOrder;
      return b.index - a.index;
    });
}

export function getHitTestCandidates(
  clips: readonly Clip[],
  tracks: readonly Track[],
  currentTime: number,
  canvasX: number,
  canvasY: number,
  canvasWidth?: number,
  canvasHeight?: number,
): Clip[] {
  return getHitTestCandidateDiagnostics(
    clips,
    tracks,
    currentTime,
    canvasX,
    canvasY,
    canvasWidth,
    canvasHeight,
  )
    .filter(({ hit }) => hit)
    .map(({ clip }) => clip);
}

export function getUpdatedConformForClipBounds(
  clip: Clip,
  newX: number,
  newY: number,
  newWidth: number,
  newHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): any | undefined {
  if (clip.conform && clip.conform.sourceWidth && clip.conform.sourceHeight) {
    const baseConformed = resolveConform(
      { ...clip.conform, userScale: 1, userOffsetX: 0, userOffsetY: 0 },
      canvasWidth,
      canvasHeight,
    );
    if (baseConformed) {
      const userScale = newWidth / baseConformed.width;
      const userOffsetX = newX + newWidth / 2 - canvasWidth / 2;
      const userOffsetY = newY + newHeight / 2 - canvasHeight / 2;
      return {
        ...clip.conform,
        userScale,
        userOffsetX,
        userOffsetY,
      };
    }
  }
  return undefined;
}

/**
 * Typed fields carried by both the old and new transform objects passed to
 * assembleBaseWidthForCommit. Using a concrete interface instead of
 * `Record<string, any>` lets TypeScript verify that only real Clip-transform
 * properties are read or written inside the function.
 */
export interface BaseWidthCommitFields {
  baseWidth?: number;
  baseHeight?: number;
  width?: number;
  height?: number;
}

/**
 * assembleBaseWidthForCommit
 *
 * Pure function extracted from handleMouseUp's baseWidth assembly logic.
 * Ensures the committed TransformClipCommand carries the PRE-DRAG base
 * dimensions for non-text clips, so the property panel's scalePercent
 * (= newWidth / baseWidth) reflects the true ratio rather than always
 * resolving to 100%.
 *
 * This is the canonical, testable form of the fix in handleMouseUp.
 * The React closure delegates directly to this function.
 *
 * @param oldTransform  Mutable record seeded from startTransform (mutated in-place)
 * @param newTransform  Mutable record seeded from finalGeometry (mutated in-place)
 * @param clipBaseWidth The clip's creation-time baseWidth (clip.baseWidth)
 * @param startWidth    The pre-drag width from startTransform (fallback when baseWidth absent)
 * @param startHeight   The pre-drag height from startTransform (fallback when baseWidth absent)
 */
export function assembleBaseWidthForCommit(
  oldTransform: BaseWidthCommitFields,
  newTransform: BaseWidthCommitFields,
  clipBaseWidth: number | undefined,
  clipBaseHeight: number | undefined,
  startWidth: number,
  startHeight: number,
): void {
  if (
    oldTransform.width !== newTransform.width ||
    oldTransform.height !== newTransform.height
  ) {
    // Preserve the PRE-DRAG base dimensions so scalePercent = newWidth/baseWidth
    // gives the true scale ratio, not always 100%.
    oldTransform.baseWidth = clipBaseWidth ?? startWidth;
    oldTransform.baseHeight = clipBaseHeight ?? startHeight;
    newTransform.baseWidth = clipBaseWidth ?? startWidth;
    newTransform.baseHeight = clipBaseHeight ?? startHeight;
  }
}

/**
 * assembleTextCommitTransform
 *
 * Pure function extracted from handleMouseUp's text resize commit logic.
 * Ensures the committed TransformClipCommand synchronizes baseWidth/baseHeight
 * with the new authoredSize, updates width/height to equal authoredSize, and
 * preserves the center position of the text clip.
 *
 * This guarantees width / baseWidth === 1.0 (crisp vector rasterization at the new
 * font size without GPU texture stretching) and prevents hasTextClipContentTransformDrift
 * from triggering unexpected drift mutations.
 */
export function assembleTextCommitTransform(
  selectedTextClip: TextClip,
  canvasWidth: number,
  finalGeometry: { x: number; y: number; width: number; height: number },
  oldTransform: Record<string, any>,
  newTransform: Record<string, any>,
): void {
  const authoredSize = calculateTextClipAuthoredSize(
    selectedTextClip,
    canvasWidth,
    { fontSize: newTransform.fontSize },
  );
  oldTransform.baseWidth = selectedTextClip.baseWidth ?? oldTransform.width;
  oldTransform.baseHeight =
    selectedTextClip.baseHeight ?? oldTransform.height;
  newTransform.baseWidth = authoredSize.width;
  newTransform.baseHeight = authoredSize.height;

  const centerX =
    (newTransform.x ?? finalGeometry.x) +
    (newTransform.width ?? finalGeometry.width) / 2;
  const centerY =
    (newTransform.y ?? finalGeometry.y) +
    (newTransform.height ?? finalGeometry.height) / 2;
  newTransform.width = authoredSize.width;
  newTransform.height = authoredSize.height;
  newTransform.x = Math.round(centerX - authoredSize.width / 2);
  newTransform.y = Math.round(centerY - authoredSize.height / 2);
}

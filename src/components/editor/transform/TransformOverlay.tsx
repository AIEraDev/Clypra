/**
 * Transform Overlay
 *
 * Renders transform controls (border + handles) for selected clips in the preview.
 *
 * Coordinate System Contract:
 * - All mouse events arrive in screen space (clientX/clientY).
 * - We subtract the overlay's bounding rect to get overlay-local coordinates.
 * - Then convert to canvas space via screenToCanvas (which accounts for viewport zoom/pan).
 * - Transform calculations operate exclusively in canvas space.
 * - The overlay div already occupies displayWidth × displayHeight, so displayOffset
 *   relative to the overlay itself is (0, 0).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUIStore } from "@/store/uiStore";
import { useTimelineStore } from "@/store/timelineStore";
import { useHistoryStore } from "@/store/historyStore";
import {
  getPreviewInteractionCoordinator,
  getTransformController,
  createLatestFrameQueue,
  type DragGeometry,
  type PreviewInteractionToken,
} from "@/core/interactions";
import { TransformClipCommand } from "@/core/history/commands/TransformCommand";
import {
  calculateTransform,
  getDefaultConstraints,
  getCursorForHandle,
} from "./calculator";
import {
  screenToCanvas,
  canvasToScreen,
  hitTestClip,
  type ViewportTransform,
} from "@/lib/utils/coordinateSystem";
import {
  calculateTextClipAuthoredSize,
  hasTextClipContentTransformDrift,
  resolveTextClipContentTransform,
} from "@/lib/text/textClip";
import { traceTextInteraction } from "@/core/render/textRenderTrace";
import type {
  Clip,
  TextClip,
  Track,
  TransformHandle,
  TransformState,
} from "@/types";
import { ContextMenu } from "@/components/ui/ContextMenu";
import { hideNativeSurfaceWhenIdle } from "@/core/runtime/nativeSurfaceLifecycle";
import { forceRepaintNativeProgramPreview } from "@/components/editor/preview/NativeProgramPreview";
import {
  getActiveProgramPreviewPresenter,
  subscribeToActiveProgramPreviewPresenter,
  type ProgramPreviewPresenter,
} from "@/components/editor/preview/programPreviewPresenterState";
import {
  getBrowserTextVisualSnapshot,
  subscribeToBrowserTextVisualSnapshot,
} from "@/components/editor/preview/nativeTextPreview";
import { useProjectStore } from "@/store/projectStore";
import { Maximize2, Minimize2, RotateCcw } from "lucide-react";
import { resolveConform, resolveTextTemplateArtifact } from "@clypra-studio/engine";
import {
  getActiveSessionOrNull,
  subscribeToSessionChanges,
} from "@/core/runtime/ProjectSession";
import { compareCompositorClips } from "@/core/compositor/ordering";
import { calculateOptimalTemplateLayout } from "@/core/render/templateScale";
import { toCompositorClip } from "@/core/timeline/adapter";
import { tracePlayback } from "@/core/playback/playbackTrace";
import type { CompositorClip } from "@/core/compositor/types";

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

export function isClipActiveAtTime(
  clip: { startTime: number; duration: number },
  time: number,
): boolean {
  const end = clip.startTime + clip.duration;
  return clip.startTime <= time && time < end;
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
 * Map cursor string to CSS class for Tauri compatibility.
 * Tauri desktop apps have issues with inline cursor styles, so we use CSS classes instead.
 */
function getCursorClass(cursor: string): string {
  const cursorMap: Record<string, string> = {
    "nwse-resize": "cursor-nwse-resize",
    "nesw-resize": "cursor-nesw-resize",
    "ns-resize": "cursor-ns-resize",
    "ew-resize": "cursor-ew-resize",
    "n-resize": "cursor-ns-resize",
    "s-resize": "cursor-ns-resize",
    "e-resize": "cursor-ew-resize",
    "w-resize": "cursor-ew-resize",
    "nw-resize": "cursor-nwse-resize",
    "ne-resize": "cursor-nesw-resize",
    "sw-resize": "cursor-nesw-resize",
    "se-resize": "cursor-nwse-resize",
    "col-resize": "cursor-col-resize",
    "row-resize": "cursor-row-resize",
    move: "cursor-move",
    grab: "cursor-grab",
    grabbing: "cursor-grabbing",
  };
  return cursorMap[cursor] || "";
}

interface TransformOverlayProps {
  /** Canvas dimensions for coordinate conversion */
  canvasWidth: number;
  canvasHeight: number;
  /** Scale factor for preview (1 = 100%) */
  scale: number;
  /** Viewport transform (editor zoom/pan) */
  viewport: ViewportTransform;
  /** Display offset for letterboxing */
  displayOffset: { x: number; y: number };
  /** Display dimensions (from calculateDisplayTransform) */
  displayWidth: number;
  displayHeight: number;
  /** Current playhead time in seconds (program context) */
  currentTime: number;
  /** Whether the overlay should be visible (use visibility instead of unmounting) */
  visible?: boolean;
  /**
   * Preview interaction policy. During playback the overlay remains an
   * invisible selection capture plane so a click can pause playback and
   * select the clip without enabling transform handles on a moving frame.
   */
  interactionMode?: "editing" | "playing";
  /** Pause the owning transport before handling a playback selection click. */
  onPlaybackInteraction?: () => void;
}

/**
 * Convert a mouse event to canvas coordinates, properly accounting for
 * the overlay's position on screen. The overlay is already positioned
 * inside the display viewport div, so the letterbox offset relative to
 * the overlay is always (0, 0).
 */
function mouseToCanvas(
  clientX: number,
  clientY: number,
  overlayRect: DOMRect,
  viewport: ViewportTransform,
  canvasWidth: number,
  canvasHeight: number,
  scale: number,
): { x: number; y: number } {
  // Step 1: Screen → overlay-local (subtract overlay's screen position)
  const localX = clientX - overlayRect.left;
  const localY = clientY - overlayRect.top;

  // Step 2: Overlay-local → canvas (the overlay sits at displayOffset=(0,0)
  // relative to itself, so pass zero offset)
  return screenToCanvas(
    localX,
    localY,
    viewport,
    { width: canvasWidth, height: canvasHeight },
    scale,
    { x: 0, y: 0 },
  );
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
  source?: "browser-tight" | "native-tight" | "authored-fallback" | "layout-box";
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

function getDragPreviewTransform(
  geometry: DragGeometry,
  startTransform: TransformState["startTransform"],
  scale: number,
  zoom: number,
  visualStart?: CanvasVisualBounds,
): string {
  const startVisual = visualStart ?? startTransform;
  const nextVisual = resolveVisualDragGeometry(
    geometry,
    startTransform,
    visualStart,
  );
  const startCenterX = startVisual.x + startVisual.width / 2;
  const startCenterY = startVisual.y + startVisual.height / 2;
  const nextCenterX = nextVisual.x + nextVisual.width / 2;
  const nextCenterY = nextVisual.y + nextVisual.height / 2;
  const translateX = (nextCenterX - startCenterX) * scale * zoom;
  const translateY = (nextCenterY - startCenterY) * scale * zoom;
  const scaleX = nextVisual.width / Math.max(1, startVisual.width);
  const scaleY = nextVisual.height / Math.max(1, startVisual.height);

  return `translate3d(${translateX}px, ${translateY}px, 0) rotate(${geometry.rotation}deg) scale(${scaleX}, ${scaleY})`;
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
): CanvasVisualBounds {
  let x = clip.x;
  let y = clip.y;
  let width = clip.width;
  let height = clip.height;

  if (
    canvasWidth &&
    canvasHeight &&
    clip.conform &&
    clip.conform.sourceWidth &&
    clip.conform.sourceHeight
  ) {
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
      console.log("[TransformOverlay:VisualBounds] using content-bounded clip dimensions directly", {
        clipId: clip.id,
        bounds: { x: clip.x, y: clip.y, width: clip.width, height: clip.height },
      });
      return { x: clip.x, y: clip.y, width: clip.width, height: clip.height };
    }

    // 2. For full-artboard template, inspect exact rendered quad from active nativeRasterBridge if available
    const snapshot = getActiveSessionOrNull()?.nativeRasterBridge?.getTextSnapshot(
      clip.id,
    );
    if (
      snapshot &&
      typeof snapshot.x === "number" &&
      typeof snapshot.y === "number" &&
      typeof snapshot.displayWidth === "number" &&
      snapshot.displayWidth > 0 &&
      typeof snapshot.displayHeight === "number" &&
      snapshot.displayHeight > 0
    ) {
      console.log("[TransformOverlay:VisualBounds] using nativeRasterBridge snapshot for full artboard", {
        clipId: clip.id,
        snapshot: { x: snapshot.x, y: snapshot.y, width: snapshot.displayWidth, height: snapshot.displayHeight },
      });
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
      console.log("[TransformOverlay:VisualBounds] fallback: calculated optimal template layout", {
        clipId: clip.id,
        contentBounds: layout.contentBounds,
      });
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
): CanvasVisualBounds {
  return (
    activeDragVisualBounds ??
    resolveClipVisualBounds(clip, canvasWidth, canvasHeight, presenter)
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
      const visual = resolveClipVisualBounds(clip, canvasWidth, canvasHeight);
      const bounds = {
        x: visual.x,
        y: visual.y,
        width: visual.width,
        height: visual.height,
        rotation: clip.rotation ?? 0,
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
        hit: visual.width > 0 && visual.height > 0 && hitTestClip(canvasX, canvasY, bounds),
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

export const TransformOverlay: React.FC<TransformOverlayProps> = ({
  canvasWidth,
  canvasHeight,
  scale,
  viewport,
  displayOffset,
  displayWidth,
  displayHeight,
  currentTime,
  visible = true,
  interactionMode = "editing",
  onPlaybackInteraction,
}) => {
  const { selectedClipIds, selectClip, toggleClipSelection } = useUIStore();
  const { clips, tracks, updateClip } = useTimelineStore();
  const { execute } = useHistoryStore();

  // Get transform controller for imperative updates
  const transformController = getTransformController();
  const previewInteractionCoordinator = getPreviewInteractionCoordinator();
  const previewInteractionRef = useRef<PreviewInteractionToken | null>(null);
  const textTransformTraceRef = useRef<{
    startedAtMs: number;
    operation: "transform" | "resize";
    clipId: string;
  } | null>(null);
  const executePreviewCommand = useCallback(
    (command: Parameters<typeof execute>[0]) => {
      const token = previewInteractionCoordinator.begin("property-edit");
      execute(command);
      previewInteractionCoordinator.commit(token);
    },
    [execute, previewInteractionCoordinator],
  );
  const activeTransform = transformController.getActiveTransform();

  const [isDragging, setIsDragging] = useState(false);
  const [dragRotation, setDragRotation] = useState<number | null>(null);
  const [snappedX, setSnappedX] = useState(false);
  const [snappedY, setSnappedY] = useState(false);
  const [snappedLeft, setSnappedLeft] = useState(false);
  const [snappedRight, setSnappedRight] = useState(false);
  const [snappedTop, setSnappedTop] = useState(false);
  const [snappedBottom, setSnappedBottom] = useState(false);

  const [snapGuideX, setSnapGuideX] = useState<number | null>(null);
  const [snapGuideY, setSnapGuideY] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [, setTextVisualSnapshotRevision] = useState(0);

  useEffect(() => {
    if (contextMenu) {
      void hideNativeSurfaceWhenIdle().catch(() => undefined);
    } else {
      forceRepaintNativeProgramPreview();
    }
  }, [contextMenu]);

  const snappedXRef = useRef<boolean>(false);
  const snappedYRef = useRef<boolean>(false);
  const snappedLeftRef = useRef<boolean>(false);
  const snappedRightRef = useRef<boolean>(false);
  const snappedTopRef = useRef<boolean>(false);
  const snappedBottomRef = useRef<boolean>(false);

  const snapGuideXRef = useRef<number | null>(null);
  const snapGuideYRef = useRef<number | null>(null);
  const snapClipXOffsetRef = useRef<number>(0);
  const snapClipYOffsetRef = useRef<number>(0);

  const snapMouseXRef = useRef<number>(0);
  const snapMouseYRef = useRef<number>(0);
  const snapMouseLeftRef = useRef<number>(0);
  const snapMouseRightRef = useRef<number>(0);
  const snapMouseTopRef = useRef<number>(0);
  const snapMouseBottomRef = useRef<number>(0);

  const overlayRef = useRef<HTMLDivElement>(null);
  const transformContainerRef = useRef<HTMLDivElement>(null);
  const clickCycleRef = useRef<{ signature: string; index: number }>({
    signature: "",
    index: -1,
  });
  const dragCursorRef = useRef<string | null>(null);
  // Native text rasters may intentionally extend beyond their authored box.
  // Keep that visual start box local to the overlay; the controller and native
  // preview must receive authored geometry only.
  const dragVisualBoundsRef = useRef<CanvasVisualBounds | null>(null);
  /** Frozen compositor pivot for the active rotation gesture. */
  const rotationPivotRef = useRef<{ x: number; y: number } | null>(null);
  /** Start angle (radians) for rotation drag — prevents initial snap */
  const startAngleRef = useRef<number | undefined>(undefined);
  /** Start font size for text clips — supports proportional dynamic scaling */
  const startFontSizeRef = useRef<number | undefined>(undefined);
  // Refs that let applyMouseMove read the latest clips and currentTime without
  // capturing them as useCallback deps. Without these, any clip update or
  // playback-clock tick during an active drag would recreate applyMouseMove →
  // recreate transformFrameQueue → dispose the live queue → drop the pending RAF.
  const clipsRef = useRef(clips);
  clipsRef.current = clips;
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;


  // Get the first selected clip (multi-select transform comes later)
  const selectedClip = clips.find((c) => c.id === selectedClipIds[0]);
  const isPlaybackInteraction = interactionMode === "playing";
  const overlayInteractive = visible || isPlaybackInteraction;

  // Raster geometry is session-owned and can complete after an inspector
  // property edit has already rendered the overlay. Subscribe only to the
  // selected layer so a completed native text raster refreshes its selection
  // shape without putting frame-rate state into Zustand or React props.
  useEffect(() => {
    if (!selectedClip || selectedClip.kind !== "text") return;

    let unsubscribeSnapshot: (() => void) | undefined;
    const unsubscribeBrowserSnapshot = subscribeToBrowserTextVisualSnapshot(
      selectedClip.id,
      () => setTextVisualSnapshotRevision((revision) => revision + 1),
    );
    const attachToActiveBridge = () => {
      unsubscribeSnapshot?.();
      unsubscribeSnapshot = getActiveSessionOrNull()
        ?.nativeRasterBridge?.subscribeToTextVisualSnapshot?.(
          selectedClip.id,
          () => setTextVisualSnapshotRevision((revision) => revision + 1),
        );
      setTextVisualSnapshotRevision((revision) => revision + 1);
    };

    attachToActiveBridge();
    const unsubscribeSession = subscribeToSessionChanges(attachToActiveBridge);
    return () => {
      unsubscribeSnapshot?.();
      unsubscribeBrowserSnapshot();
      unsubscribeSession();
    };
  }, [selectedClip?.id, selectedClip?.kind]);

  // Presenter handoffs do not change timeline state. Subscribe to the
  // monitor's explicit decision so a paused canvas handoff cannot retain
  // native selection geometry until some unrelated React update happens.
  useEffect(
    () =>
      subscribeToActiveProgramPreviewPresenter(() => {
        setTextVisualSnapshotRevision((revision) => revision + 1);
      }),
    [],
  );

  // The selection box is a signal-plane consumer. Its position and scale are
  // updated directly by the controller so pointer feedback does not require a
  // React render. React only owns the committed/base geometry.
  useEffect(() => {
    const container = transformContainerRef.current;
    if (!container) return;

    const clearPreviewTransform = () => {
      container.style.removeProperty("--transform-overlay-drag-transform");
    };

    const unsubscribeGeometry = transformController.onDragGeometry(
      (geometry) => {
        const active = transformController.getActiveTransform();
        if (!active || active.clipId !== selectedClip?.id) return;
        if (active.handle === "rotate") {
          setDragRotation(geometry.rotation);
        }

        container.style.setProperty(
          "--transform-overlay-drag-transform",
          getDragPreviewTransform(
            geometry,
            active.startTransform,
            scale,
            viewport.zoom,
            dragVisualBoundsRef.current ?? undefined,
          ),
        );
      },
    );
    const unsubscribeEnd = transformController.onDragEnd(() => {
      dragVisualBoundsRef.current = null;
      rotationPivotRef.current = null;
      setDragRotation(null);
      clearPreviewTransform();
    });

    return () => {
      unsubscribeGeometry();
      unsubscribeEnd();
      clearPreviewTransform();
    };
  }, [selectedClip?.id, scale, transformController, viewport.zoom]);

  useEffect(() => {
    if (
      !selectedClip ||
      isDragging ||
      !isClipActiveAtTime(selectedClip, currentTime) ||
      !("text" in selectedClip)
    )
      return;

    const textClip = selectedClip as TextClip;
    // Apply transform normalization to text clips whose content bounds drift from the clip transform.
    // Template clips are excluded because their bounds are determined by the template's
    // canvas dimensions and should be freely transformable without normalization
    if (textClip.templateId || (textClip as any).kind === "text-template") return;
    if (!hasTextClipContentTransformDrift(textClip, canvasWidth, canvasHeight))
      return;

    const nextTransform = resolveTextClipContentTransform(
      textClip,
      canvasWidth,
      canvasHeight,
      "selection-normalize",
    );
    updateClip(textClip.id, nextTransform);
  }, [
    selectedClip,
    isDragging,
    currentTime,
    canvasWidth,
    canvasHeight,
    updateClip,
  ]);

  // Bounds belong to the editing model, while font loading belongs to the
  // browser. A project font can finish loading after a text clip was created
  // or selected; in that interval a fallback face has different advances and
  // can leave the renderer's final glyph outside the persisted selection.
  // Reconcile once the document font set is ready. This stays in the editing
  // owner (never the preview render loop), is cancelled on selection changes,
  // and is a no-op when the stored transform already matches the loaded font.
  useEffect(() => {
    if (
      !selectedClip ||
      isDragging ||
      !isClipActiveAtTime(selectedClip, currentTime) ||
      !("text" in selectedClip) ||
      typeof document === "undefined" ||
      !document.fonts
    ) {
      return;
    }

    const textClip = selectedClip as TextClip;
    if (textClip.templateId) {
      return;
    }

    let disposed = false;
    void document.fonts.ready.then(() => {
      if (disposed || isDragging) return;

      // Resolve the latest instance rather than using the captured clip so a
      // property edit completed while the font was loading is never replaced
      // by stale selection geometry.
      const latestClip = useTimelineStore
        .getState()
        .clips.find((clip) => clip.id === textClip.id);
      if (!latestClip || !("text" in latestClip)) return;
      const latestTextClip = latestClip as TextClip;
      if (
        latestTextClip.templateId ||
        !hasTextClipContentTransformDrift(
          latestTextClip,
          canvasWidth,
          canvasHeight,
        )
      ) {
        return;
      }

      updateClip(
        latestTextClip.id,
        resolveTextClipContentTransform(
          latestTextClip,
          canvasWidth,
          canvasHeight,
          "font-ready-selection-normalize",
        ),
      );
    });

    return () => {
      disposed = true;
    };
  }, [
    selectedClip,
    isDragging,
    currentTime,
    canvasWidth,
    canvasHeight,
    updateClip,
  ]);

  // Handle canvas mousedown to select/deselect clips.
  // Using mousedown (instead of click) avoids click-tail races after drag.
  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;

      // Don't handle if clicking on a handle or during drag
      if (
        isDragging ||
        (e.target as HTMLElement).closest(
          "[data-transform-handle], [data-spatial-motion-path], [data-motion-path-handle]",
        )
      ) {
        return;
      }

      // CapCut-style interaction: a preview click while playing is an edit
      // intent. Pause first, then run the same hit test against the now-still
      // frame. The callback is transport-owned; this component only owns the
      // selection decision.
      const selectionToken = isPlaybackInteraction
        ? previewInteractionCoordinator.begin("selection", { pauseOnBegin: true })
        : null;

      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) {
        if (selectionToken) previewInteractionCoordinator.cancel(selectionToken);
        onPlaybackInteraction?.();
        return;
      }

      // Convert screen coordinates to canvas coordinates using overlay-local mapping
      const canvasCoords = mouseToCanvas(
        e.clientX,
        e.clientY,
        rect,
        viewport,
        canvasWidth,
        canvasHeight,
        scale,
      );

      const hitCandidates = getHitTestCandidates(
        clips,
        tracks,
        currentTime,
        canvasCoords.x,
        canvasCoords.y,
        canvasWidth,
        canvasHeight,
      );
      const hitDiagnostics = getHitTestCandidateDiagnostics(
        clips,
        tracks,
        currentTime,
        canvasCoords.x,
        canvasCoords.y,
        canvasWidth,
        canvasHeight,
      );

      if (hitCandidates.length > 0) {
        // Multi-select modifier: toggle topmost hit only.
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          toggleClipSelection(hitCandidates[0].id);
          if (selectionToken) previewInteractionCoordinator.commit(selectionToken);
          return;
        }

        // If the currently selected clip is already in the hit candidates under the cursor,
        // clicking again cycles/drills-down to the next clip behind it.
        // Otherwise, always select the topmost clip under the cursor immediately.
        const currentHitIndex = selectedClip
          ? hitCandidates.findIndex((c) => c.id === selectedClip.id)
          : -1;

        let nextIndex = 0;
        if (currentHitIndex !== -1) {
          nextIndex = (currentHitIndex + 1) % hitCandidates.length;
        }

        clickCycleRef.current = {
          signature: hitCandidates.map((c) => c.id).join("|"),
          index: nextIndex,
        };
        selectClip(hitCandidates[nextIndex].id);
      } else {
        // Clicked on empty area - deselect
        clickCycleRef.current = { signature: "", index: -1 };
        selectClip(null);
      }
      if (selectionToken) previewInteractionCoordinator.commit(selectionToken);
    },
    [
      clips,
      tracks,
      currentTime,
      scale,
      viewport,
      canvasWidth,
      canvasHeight,
      isDragging,
      selectClip,
      toggleClipSelection,
      selectedClip,
      selectedClipIds,
      isPlaybackInteraction,
      onPlaybackInteraction,
      previewInteractionCoordinator,
    ],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, handle: TransformHandle) => {
      if (!selectedClip) return;

      e.preventDefault();
      e.stopPropagation();
      previewInteractionRef.current = previewInteractionCoordinator.begin("transform");
      if ("text" in selectedClip) {
        textTransformTraceRef.current = {
          startedAtMs: performance.now(),
          operation: handle === "move" || handle === "rotate" ? "transform" : "resize",
          clipId: selectedClip.id,
        };
      }
      setIsDragging(true);
      setDragRotation(handle === "rotate" ? selectedClip.rotation ?? 0 : null);
      setSnappedX(false);
      setSnappedY(false);
      setSnappedLeft(false);
      setSnappedRight(false);
      setSnappedTop(false);
      setSnappedBottom(false);
      setSnapGuideX(null);
      setSnapGuideY(null);

      snappedXRef.current = false;
      snappedYRef.current = false;
      snappedLeftRef.current = false;
      snappedRightRef.current = false;
      snappedTopRef.current = false;
      snappedBottomRef.current = false;
      snapGuideXRef.current = null;
      snapGuideYRef.current = null;
      snapClipXOffsetRef.current = 0;
      snapClipYOffsetRef.current = 0;

      snapMouseXRef.current = 0;
      snapMouseYRef.current = 0;
      snapMouseLeftRef.current = 0;
      snapMouseRightRef.current = 0;
      snapMouseTopRef.current = 0;
      snapMouseBottomRef.current = 0;

      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) {
        setIsDragging(false);
        if (previewInteractionRef.current) {
          previewInteractionCoordinator.cancel(previewInteractionRef.current);
          previewInteractionRef.current = null;
        }
        return;
      }

      // Convert screen coordinates to canvas coordinates using overlay-local mapping
      const canvasCoords = mouseToCanvas(
        e.clientX,
        e.clientY,
        rect,
        viewport,
        canvasWidth,
        canvasHeight,
        scale,
      );

      // Resolve actual rendered dimensions (accounting for conform / template bounds if present)
      const visualBounds = resolveClipVisualBounds(
        selectedClip,
        canvasWidth,
        canvasHeight,
        getActiveProgramPreviewPresenter(),
      );
      const actualWidth = visualBounds.width;
      const actualHeight = visualBounds.height;
      const actualX = visualBounds.x;
      const actualY = visualBounds.y;
      dragVisualBoundsRef.current = {
        x: actualX,
        y: actualY,
        width: actualWidth,
        height: actualHeight,
      };

      if (selectedClip.kind === "text") {
        tracePlayback("text-selection-geometry", {
          source: visualBounds.source ?? "authored",
          width: Number(actualWidth.toFixed(2)),
          height: Number(actualHeight.toFixed(2)),
          pivotOffsetX: Number(
            ((visualBounds.pivotX ?? actualX + actualWidth / 2) - actualX).toFixed(2),
          ),
          pivotOffsetY: Number(
            ((visualBounds.pivotY ?? actualY + actualHeight / 2) - actualY).toFixed(2),
          ),
          handle,
        });
      }

      // Capture start angle for rotation handle
      if (handle === "rotate") {
        // The compositor rotates the full raster texture. Preserve that pivot
        // for the whole gesture so the tight overlay and rendered text cannot
        // diverge when alpha bounds are offset by italic overhang or bleed.
        const centerX = actualX + actualWidth / 2;
        const centerY = actualY + actualHeight / 2;
        const pivotX = visualBounds.pivotX ?? centerX;
        const pivotY = visualBounds.pivotY ?? centerY;
        rotationPivotRef.current = { x: pivotX, y: pivotY };
        startAngleRef.current = Math.atan2(
          canvasCoords.y - pivotY,
          canvasCoords.x - pivotX,
        );
      } else {
        startAngleRef.current = undefined;
        rotationPivotRef.current = null;
      }

      // Capture starting font size for text clips so we can scale text dynamically
      if ("text" in selectedClip) {
        startFontSizeRef.current = (selectedClip as any).fontSize;
      } else {
        startFontSizeRef.current = undefined;
      }

      const dragCursor: Record<TransformHandle, string> = {
        move: "move",
        nw: "nwse-resize",
        ne: "nesw-resize",
        sw: "nesw-resize",
        se: "nwse-resize",
        n: "ns-resize",
        s: "ns-resize",
        e: "ew-resize",
        w: "ew-resize",
        rotate: "grabbing",
      };
      dragCursorRef.current = dragCursor[handle] ?? null;
      if (dragCursorRef.current) {
        const cursorClass = getCursorClass(dragCursorRef.current);
        if (cursorClass) {
          document.body.classList.add(cursorClass);
        }
      }

      transformController.startTransform({
        clipId: selectedClip.id,
        handle,
        startTransform: {
          x: selectedClip.x,
          y: selectedClip.y,
          width: selectedClip.width,
          height: selectedClip.height,
          rotation: selectedClip.rotation,
          conform: selectedClip.conform
            ? { ...selectedClip.conform }
            : undefined,
        },
        startMousePos: canvasCoords,
        aspectRatioLocked: selectedClip.aspectRatioLocked ?? true,
        sourceAspectRatio:
          selectedClip.sourceAspectRatio ??
          selectedClip.width / Math.max(1, selectedClip.height),
      });

      transformController.updateDragGeometry({
        x: selectedClip.x,
        y: selectedClip.y,
        width: selectedClip.width,
        height: selectedClip.height,
        rotation: selectedClip.rotation ?? 0,
        visualX: actualX,
        visualY: actualY,
        ...(startFontSizeRef.current !== undefined
          ? { fontSize: startFontSizeRef.current }
          : {}),
        ...(selectedClip.conform
          ? { conform: { ...selectedClip.conform } }
          : {}),
      });
    },
    [
      selectedClip,
      scale,
      viewport,
      canvasWidth,
      canvasHeight,
      transformController,
      previewInteractionCoordinator,
    ],
  );

  // The selected clip's move surface sits above the preview pixels. If another
  // active clip is visually above the selected clip at the pointer location,
  // route the click to that layer instead of starting a drag on the video.
  const handleMoveSurfaceMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!selectedClip) return;

      const rect = overlayRef.current?.getBoundingClientRect();
      if (rect) {
        const canvasCoords = mouseToCanvas(
          e.clientX,
          e.clientY,
          rect,
          viewport,
          canvasWidth,
          canvasHeight,
          scale,
        );
        const hitDiagnostics = getHitTestCandidateDiagnostics(
          clips,
          tracks,
          currentTime,
          canvasCoords.x,
          canvasCoords.y,
          canvasWidth,
          canvasHeight,
        );
        const topmostClip = hitDiagnostics.find(({ hit }) => hit)?.clip;

        if (topmostClip && topmostClip.id !== selectedClip.id) {
          e.preventDefault();
          e.stopPropagation();
          if (e.shiftKey || e.metaKey || e.ctrlKey) {
            toggleClipSelection(topmostClip.id);
          } else {
            selectClip(topmostClip.id);
          }
          return;
        }
      }

      handleMouseDown(e, "move");
    },
    [
      selectedClip,
      viewport,
      canvasWidth,
      canvasHeight,
      scale,
      clips,
      tracks,
      currentTime,
      toggleClipSelection,
      selectClip,
      handleMouseDown,
    ],
  );

  const applyMouseMove = useCallback(
    (e: MouseEvent) => {
      const currentTransform = transformController.getActiveTransform();
      if (!isDragging || !currentTransform) return;

      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return;

      // Convert screen coordinates to canvas coordinates using overlay-local mapping
      const canvasCoords = mouseToCanvas(
        e.clientX,
        e.clientY,
        rect,
        viewport,
        canvasWidth,
        canvasHeight,
        scale,
      );

      // Calculate new transform from the ORIGINAL start state (not current clip state)
      // This prevents transform drift / acceleration during drag.
      const constraints = getDefaultConstraints(
        canvasWidth,
        canvasHeight,
        currentTransform.aspectRatioLocked,
      );

      // Preserve text/media metadata while applying drag-start geometry so deltas
      // stay absolute without dropping type-specific resize behavior.
      if (!selectedClip) return;
      const startClip = buildTransformStartClip(selectedClip, currentTransform);

      const newTransform = calculateTransform(
        startClip,
        currentTransform.handle,
        currentTransform.startMousePos,
        canvasCoords,
        constraints,
        startAngleRef.current,
        rotationPivotRef.current ?? undefined,
      );

      // Resize handles scale text size with the edited axis so the rendered text
      // tracks the visible transform box during drag.
      if (
        startFontSizeRef.current !== undefined &&
        shouldScaleTextFontForHandle(currentTransform.handle)
      ) {
        const newFontSize = calculateTextResizeFontSize(
          startFontSizeRef.current,
          currentTransform.handle,
          currentTransform.startTransform,
          newTransform,
        );
        const textScale = newFontSize / Math.max(1, startFontSizeRef.current);
        Object.assign(
          newTransform,
          calculateScaledTextTransform(
            currentTransform.handle,
            currentTransform.startTransform,
            newTransform,
            textScale,
          ),
          { fontSize: newFontSize },
        );
      }

      // Stateful magnetic center snapping (like CapCut):
      // - Snap-in when calculated center gets close to canvas center.
      // - Locked snap state with escape threshold: the user must drag their mouse past the escape threshold
      //   to release the magnetic snap lock, providing a tactile, sticky magnetic force feel.
      if (currentTransform.handle !== "rotate") {
        const nextX = newTransform.x ?? startClip.x;
        const nextY = newTransform.y ?? startClip.y;
        const nextW = newTransform.width ?? startClip.width;
        const nextH = newTransform.height ?? startClip.height;
        const nextCenterX = nextX + nextW / 2;
        const nextCenterY = nextY + nextH / 2;
        const canvasCenterX = canvasWidth / 2;
        const canvasCenterY = canvasHeight / 2;

        const SNAP_IN_THRESHOLD = 8;
        const ESCAPE_THRESHOLD = 20;
        const rotation = selectedClip.rotation ?? 0;

        if (currentTransform.handle === "move") {
          const activeClips = clipsRef.current.filter(
            (c) =>
              c.id !== selectedClip.id && isClipActiveAtTime(c, currentTimeRef.current),
          );

          // X Axis Snapping (Left, Right, Center)
          if (snappedXRef.current) {
            const deltaMouseX = Math.abs(
              canvasCoords.x - snapMouseXRef.current,
            );
            if (deltaMouseX > ESCAPE_THRESHOLD) {
              snappedXRef.current = false;
              snappedLeftRef.current = false;
              snappedRightRef.current = false;
              snapGuideXRef.current = null;
              setSnappedX(false);
              setSnappedLeft(false);
              setSnappedRight(false);
              setSnapGuideX(null);
            } else {
              newTransform.x =
                snapGuideXRef.current! + snapClipXOffsetRef.current;
            }
          } else {
            // Gather all target X coordinates
            const targetXCandidates: {
              value: number;
              type: "canvas-left" | "canvas-center" | "canvas-right" | "clip";
            }[] = [
              { value: 0, type: "canvas-left" },
              { value: canvasWidth / 2, type: "canvas-center" },
              { value: canvasWidth, type: "canvas-right" },
            ];

            activeClips.forEach((c) => {
              targetXCandidates.push({ value: c.x, type: "clip" });
              targetXCandidates.push({
                value: c.x + c.width / 2,
                type: "clip",
              });
              targetXCandidates.push({ value: c.x + c.width, type: "clip" });
            });

            let bestSnapX: {
              targetVal: number;
              clipOffset: number;
              type: string;
            } | null = null;
            let minDistanceX = Infinity;

            const sourceXCandidates =
              rotation === 0
                ? [
                    { val: nextX, offset: 0 }, // left edge
                    { val: nextCenterX, offset: -nextW / 2 }, // center X
                    { val: nextX + nextW, offset: -nextW }, // right edge
                  ]
                : [
                    { val: nextCenterX, offset: -nextW / 2 }, // center X only
                  ];

            for (const source of sourceXCandidates) {
              for (const target of targetXCandidates) {
                const dist = Math.abs(source.val - target.value);
                if (dist <= SNAP_IN_THRESHOLD && dist < minDistanceX) {
                  minDistanceX = dist;
                  bestSnapX = {
                    targetVal: target.value,
                    clipOffset: source.offset,
                    type: target.type,
                  };
                }
              }
            }

            if (bestSnapX) {
              snappedXRef.current = true;
              snapMouseXRef.current = canvasCoords.x;
              snapGuideXRef.current = bestSnapX.targetVal;
              snapClipXOffsetRef.current = bestSnapX.clipOffset;

              setSnapGuideX(bestSnapX.targetVal);
              if (bestSnapX.type === "canvas-left") {
                setSnappedLeft(true);
              } else if (bestSnapX.type === "canvas-right") {
                setSnappedRight(true);
              } else if (bestSnapX.type === "canvas-center") {
                setSnappedX(true);
              } else {
                setSnappedX(true);
              }

              newTransform.x = bestSnapX.targetVal + bestSnapX.clipOffset;
            }
          }

          // Y Axis Snapping (Top, Bottom, Center)
          if (snappedYRef.current) {
            const deltaMouseY = Math.abs(
              canvasCoords.y - snapMouseYRef.current,
            );
            if (deltaMouseY > ESCAPE_THRESHOLD) {
              snappedYRef.current = false;
              snappedTopRef.current = false;
              snappedBottomRef.current = false;
              snapGuideYRef.current = null;
              setSnappedY(false);
              setSnappedTop(false);
              setSnappedBottom(false);
              setSnapGuideY(null);
            } else {
              newTransform.y =
                snapGuideYRef.current! + snapClipYOffsetRef.current;
            }
          } else {
            // Gather all target Y coordinates
            const targetYCandidates: {
              value: number;
              type: "canvas-top" | "canvas-center" | "canvas-bottom" | "clip";
            }[] = [
              { value: 0, type: "canvas-top" },
              { value: canvasHeight / 2, type: "canvas-center" },
              { value: canvasHeight, type: "canvas-bottom" },
            ];

            activeClips.forEach((c) => {
              targetYCandidates.push({ value: c.y, type: "clip" });
              targetYCandidates.push({
                value: c.y + c.height / 2,
                type: "clip",
              });
              targetYCandidates.push({ value: c.y + c.height, type: "clip" });
            });

            let bestSnapY: {
              targetVal: number;
              clipOffset: number;
              type: string;
            } | null = null;
            let minDistanceY = Infinity;

            const sourceYCandidates =
              rotation === 0
                ? [
                    { val: nextY, offset: 0 }, // top edge
                    { val: nextCenterY, offset: -nextH / 2 }, // center Y
                    { val: nextY + nextH, offset: -nextH }, // bottom edge
                  ]
                : [
                    { val: nextCenterY, offset: -nextH / 2 }, // center Y only
                  ];

            for (const source of sourceYCandidates) {
              for (const target of targetYCandidates) {
                const dist = Math.abs(source.val - target.value);
                if (dist <= SNAP_IN_THRESHOLD && dist < minDistanceY) {
                  minDistanceY = dist;
                  bestSnapY = {
                    targetVal: target.value,
                    clipOffset: source.offset,
                    type: target.type,
                  };
                }
              }
            }

            if (bestSnapY) {
              snappedYRef.current = true;
              snapMouseYRef.current = canvasCoords.y;
              snapGuideYRef.current = bestSnapY.targetVal;
              snapClipYOffsetRef.current = bestSnapY.clipOffset;

              setSnapGuideY(bestSnapY.targetVal);
              if (bestSnapY.type === "canvas-top") {
                setSnappedTop(true);
              } else if (bestSnapY.type === "canvas-bottom") {
                setSnappedBottom(true);
              } else if (bestSnapY.type === "canvas-center") {
                setSnappedY(true);
              } else {
                setSnappedY(true);
              }

              newTransform.y = bestSnapY.targetVal + bestSnapY.clipOffset;
            }
          }
        } else {
          // Resize snapping
          const handle = currentTransform.handle;
          const isLeftResize =
            handle === "w" || handle === "nw" || handle === "sw";
          const isRightResize =
            handle === "e" || handle === "ne" || handle === "se";
          const isTopResize =
            handle === "n" || handle === "nw" || handle === "ne";
          const isBottomResize =
            handle === "s" || handle === "sw" || handle === "se";

          if (rotation === 0) {
            let horizontalSnapped = false;

            const applyLeftResizeSnap = () => {
              if (handle === "w") {
                const rightBound = startClip.x + startClip.width;
                newTransform.x = 0;
                newTransform.width = rightBound;
              } else {
                const centerX = startClip.x + startClip.width / 2;
                const newWidth = centerX * 2;
                newTransform.x = 0;
                newTransform.width = newWidth;
                if (currentTransform.aspectRatioLocked) {
                  const aspectRatio =
                    startClip.sourceAspectRatio ??
                    startClip.width / startClip.height;
                  const newHeight = newWidth / aspectRatio;
                  const centerY = startClip.y + startClip.height / 2;
                  newTransform.y = centerY - newHeight / 2;
                  newTransform.height = newHeight;
                }
              }
            };

            const applyRightResizeSnap = () => {
              if (handle === "e") {
                const leftBound = startClip.x;
                newTransform.width = canvasWidth - leftBound;
              } else {
                const centerX = startClip.x + startClip.width / 2;
                const newWidth = (canvasWidth - centerX) * 2;
                newTransform.width = newWidth;
                newTransform.x = centerX - newWidth / 2;
                if (currentTransform.aspectRatioLocked) {
                  const aspectRatio =
                    startClip.sourceAspectRatio ??
                    startClip.width / startClip.height;
                  const newHeight = newWidth / aspectRatio;
                  const centerY = startClip.y + startClip.height / 2;
                  newTransform.y = centerY - newHeight / 2;
                  newTransform.height = newHeight;
                }
              }
            };

            const applyTopResizeSnap = () => {
              if (handle === "n") {
                const bottomBound = startClip.y + startClip.height;
                newTransform.y = 0;
                newTransform.height = bottomBound;
              } else {
                const centerY = startClip.y + startClip.height / 2;
                const newHeight = centerY * 2;
                newTransform.y = 0;
                newTransform.height = newHeight;
                if (currentTransform.aspectRatioLocked) {
                  const aspectRatio =
                    startClip.sourceAspectRatio ??
                    startClip.width / startClip.height;
                  const newWidth = newHeight * aspectRatio;
                  const centerX = startClip.x + startClip.width / 2;
                  newTransform.x = centerX - newWidth / 2;
                  newTransform.width = newWidth;
                }
              }
            };

            const applyBottomResizeSnap = () => {
              if (handle === "s") {
                const topBound = startClip.y;
                newTransform.height = canvasHeight - topBound;
              } else {
                const centerY = startClip.y + startClip.height / 2;
                const newHeight = (canvasHeight - centerY) * 2;
                newTransform.height = newHeight;
                newTransform.y = centerY - newHeight / 2;
                if (currentTransform.aspectRatioLocked) {
                  const aspectRatio =
                    startClip.sourceAspectRatio ??
                    startClip.width / startClip.height;
                  const newWidth = newHeight * aspectRatio;
                  const centerX = startClip.x + startClip.width / 2;
                  newTransform.x = centerX - newWidth / 2;
                  newTransform.width = newWidth;
                }
              }
            };

            if (isLeftResize) {
              if (snappedLeftRef.current) {
                const deltaMouseX = Math.abs(
                  canvasCoords.x - snapMouseLeftRef.current,
                );
                if (deltaMouseX > ESCAPE_THRESHOLD) {
                  snappedLeftRef.current = false;
                  setSnappedLeft(false);
                } else {
                  horizontalSnapped = true;
                  applyLeftResizeSnap();
                }
              } else if (Math.abs(nextX - 0) <= SNAP_IN_THRESHOLD) {
                snappedLeftRef.current = true;
                snapMouseLeftRef.current = canvasCoords.x;
                setSnappedLeft(true);
                horizontalSnapped = true;
                applyLeftResizeSnap();
              }
            } else if (isRightResize) {
              if (snappedRightRef.current) {
                const deltaMouseX = Math.abs(
                  canvasCoords.x - snapMouseRightRef.current,
                );
                if (deltaMouseX > ESCAPE_THRESHOLD) {
                  snappedRightRef.current = false;
                  setSnappedRight(false);
                } else {
                  horizontalSnapped = true;
                  applyRightResizeSnap();
                }
              } else if (
                Math.abs(nextX + nextW - canvasWidth) <= SNAP_IN_THRESHOLD
              ) {
                snappedRightRef.current = true;
                snapMouseRightRef.current = canvasCoords.x;
                setSnappedRight(true);
                horizontalSnapped = true;
                applyRightResizeSnap();
              }
            }

            const canSnapVertical =
              !currentTransform.aspectRatioLocked || !horizontalSnapped;
            if (canSnapVertical) {
              if (isTopResize) {
                if (snappedTopRef.current) {
                  const deltaMouseY = Math.abs(
                    canvasCoords.y - snapMouseTopRef.current,
                  );
                  if (deltaMouseY > ESCAPE_THRESHOLD) {
                    snappedTopRef.current = false;
                    setSnappedTop(false);
                  } else {
                    applyTopResizeSnap();
                  }
                } else if (Math.abs(nextY - 0) <= SNAP_IN_THRESHOLD) {
                  snappedTopRef.current = true;
                  snapMouseTopRef.current = canvasCoords.y;
                  setSnappedTop(true);
                  applyTopResizeSnap();
                }
              } else if (isBottomResize) {
                if (snappedBottomRef.current) {
                  const deltaMouseY = Math.abs(
                    canvasCoords.y - snapMouseBottomRef.current,
                  );
                  if (deltaMouseY > ESCAPE_THRESHOLD) {
                    snappedBottomRef.current = false;
                    setSnappedBottom(false);
                  } else {
                    applyBottomResizeSnap();
                  }
                } else if (
                  Math.abs(nextY + nextH - canvasHeight) <= SNAP_IN_THRESHOLD
                ) {
                  snappedBottomRef.current = true;
                  snapMouseBottomRef.current = canvasCoords.y;
                  setSnappedBottom(true);
                  applyBottomResizeSnap();
                }
              }
            }
          }
        }
      }

      if (
        selectedClip.conform &&
        selectedClip.conform.sourceWidth &&
        selectedClip.conform.sourceHeight
      ) {
        const updatedConform = getUpdatedConformForClipBounds(
          selectedClip,
          newTransform.x ?? selectedClip.x,
          newTransform.y ?? selectedClip.y,
          newTransform.width ?? selectedClip.width,
          newTransform.height ?? selectedClip.height,
          canvasWidth,
          canvasHeight,
        );
        if (updatedConform) {
          (newTransform as any).conform = updatedConform;
        }
      }

      // Publish only to the imperative signal plane. The preview renderer and
      // selection box consume this without replacing the timeline array or
      // notifying every Zustand subscriber on every pointer frame.
      const nextX = newTransform.x ?? startClip.x;
      const nextY = newTransform.y ?? startClip.y;
      const nextWidth = newTransform.width ?? startClip.width;
      const nextHeight = newTransform.height ?? startClip.height;
      const visualStart = dragVisualBoundsRef.current;
      const visualScaleX =
        nextWidth / Math.max(1, currentTransform.startTransform.width);
      const visualScaleY =
        nextHeight / Math.max(1, currentTransform.startTransform.height);
      transformController.updateDragGeometry({
        x: nextX,
        y: nextY,
        width: nextWidth,
        height: nextHeight,
        rotation: newTransform.rotation ?? startClip.rotation ?? 0,
        ...(visualStart
          ? {
              visualX:
                nextX +
                (visualStart.x - currentTransform.startTransform.x) *
                  visualScaleX,
              visualY:
                nextY +
                (visualStart.y - currentTransform.startTransform.y) *
                  visualScaleY,
            }
          : {}),
        ...((newTransform as Partial<TextClip>).fontSize !== undefined
          ? {
              fontSize: (newTransform as Partial<TextClip>).fontSize,
              // These are the dimensions that will be committed at mouse-up.
              // The preview signal deliberately retains the drag-start text
              // raster/base while this gesture is active, so panel, glyphs,
              // and selection geometry stay in the same coordinate space.
              baseWidth: nextWidth,
              baseHeight: nextHeight,
            }
          : startFontSizeRef.current !== undefined
            ? { fontSize: startFontSizeRef.current }
            : {}),
        ...(newTransform.conform
          ? {
              conform: newTransform.conform,
            }
          : {}),
      });
    },
    [
      isDragging,
      selectedClip,
      scale,
      viewport,
      canvasWidth,
      canvasHeight,
      transformController,
      // clips and currentTime are intentionally omitted — they are read via
      // clipsRef / currentTimeRef inside the callback to avoid recreating
      // transformFrameQueue (and cancelling its pending RAF) on every clip
      // update or playback-clock tick during an active drag.
    ],
  );

  const transformFrameQueue = useMemo(
    () => createLatestFrameQueue<MouseEvent>(applyMouseMove),
    [applyMouseMove],
  );

  // Pointer events can arrive considerably faster than the native preview can
  // compose a frame. Keep only the newest position and apply it once per
  // display frame. This preserves responsive transform feedback without
  // queuing a native render for every raw mousemove event.
  const handleMouseMove = useCallback(
    (event: MouseEvent) => {
      transformFrameQueue.push(event);
    },
    [transformFrameQueue],
  );

  const handleMouseUp = useCallback(() => {
    const currentTransform = transformController.getActiveTransform();
    if (!isDragging || !currentTransform) return;

    // Do not commit a stale transform when mouseup lands before the queued RAF.
    transformFrameQueue.flush();

    setIsDragging(false);
    setSnappedX(false);
    setSnappedY(false);
    setSnappedLeft(false);
    setSnappedRight(false);
    setSnappedTop(false);
    setSnappedBottom(false);
    setSnapGuideX(null);
    setSnapGuideY(null);
    snappedXRef.current = false;
    snappedYRef.current = false;
    snappedLeftRef.current = false;
    snappedRightRef.current = false;
    snappedTopRef.current = false;
    snappedBottomRef.current = false;
    snapGuideXRef.current = null;
    snapGuideYRef.current = null;
    snapClipXOffsetRef.current = 0;
    snapClipYOffsetRef.current = 0;
    if (dragCursorRef.current) {
      const cursorClass = getCursorClass(dragCursorRef.current);
      if (cursorClass) {
        document.body.classList.remove(cursorClass);
      }
      dragCursorRef.current = null;
    }

    const finalGeometry = transformController.getCurrentDragGeometry();
    if (!finalGeometry) {
      transformController.endTransform();
      if (previewInteractionRef.current) {
        previewInteractionCoordinator.cancel(previewInteractionRef.current);
        previewInteractionRef.current = null;
      }
      textTransformTraceRef.current = null;
      return;
    }

    // Commit to history with epoch advancement
    const oldTransform: Record<string, any> = {
      ...currentTransform.startTransform,
    };
    const newTransform: Record<string, any> = {
      x: finalGeometry.x,
      y: finalGeometry.y,
      width: finalGeometry.width,
      height: finalGeometry.height,
      rotation: finalGeometry.rotation,
    };

    if (finalGeometry.conform) {
      newTransform.conform = { ...finalGeometry.conform };
    }

    if (startFontSizeRef.current !== undefined) {
      oldTransform.fontSize = startFontSizeRef.current;
      newTransform.fontSize =
        finalGeometry.fontSize ?? startFontSizeRef.current;
    }

    const selectedTextClip =
      selectedClip && "text" in selectedClip
        ? (selectedClip as TextClip)
        : null;
    if (
      selectedTextClip &&
      startFontSizeRef.current !== undefined &&
      (oldTransform.width !== newTransform.width ||
        oldTransform.height !== newTransform.height)
    ) {
      const authoredSize = calculateTextClipAuthoredSize(
        selectedTextClip,
        canvasWidth,
        { fontSize: newTransform.fontSize },
      );
      oldTransform.baseWidth = selectedTextClip.baseWidth ?? oldTransform.width;
      oldTransform.baseHeight = selectedTextClip.baseHeight ?? oldTransform.height;
      newTransform.baseWidth = authoredSize.width;
      newTransform.baseHeight = authoredSize.height;
    } else if (
      (selectedClip as any).kind === "text" ||
      (selectedClip as any).kind === "text-template" ||
      (selectedClip as any).templateId ||
      (selectedClip as any).styleId ||
      (selectedClip as any).styleSnapshot ||
      (selectedClip as any).baseWidth !== undefined
    ) {
      if (
        oldTransform.width !== newTransform.width ||
        oldTransform.height !== newTransform.height
      ) {
        oldTransform.baseWidth =
          (selectedClip as any).baseWidth ?? oldTransform.width;
        oldTransform.baseHeight =
          (selectedClip as any).baseHeight ?? oldTransform.height;
        newTransform.baseWidth = finalGeometry.width;
        newTransform.baseHeight = finalGeometry.height;
      }
    }

    // Only create command if something actually changed
    const hasChanged =
      oldTransform.x !== newTransform.x ||
      oldTransform.y !== newTransform.y ||
      oldTransform.width !== newTransform.width ||
      oldTransform.height !== newTransform.height ||
      oldTransform.rotation !== newTransform.rotation ||
      oldTransform.fontSize !== newTransform.fontSize ||
      JSON.stringify(oldTransform.conform) !==
        JSON.stringify(newTransform.conform);

    const commitStartedAt = performance.now();
    if (hasChanged) {
      execute(
        new TransformClipCommand(
          currentTransform.clipId,
          oldTransform,
          newTransform,
        ),
      );
    }

    transformController.endTransform();
    const commitDurationMs = Math.max(0, performance.now() - commitStartedAt);
    const textTrace = textTransformTraceRef.current;
    if (textTrace) {
      const browserSnapshot = getBrowserTextVisualSnapshot(textTrace.clipId);
      const nativeSnapshot = getActiveSessionOrNull()?.nativeRasterBridge?.getTextSnapshot(
        textTrace.clipId,
      );
      traceTextInteraction({
        kind: (selectedClip as any)?.kind === "text-template" ? "template" : (selectedClip as any)?.styleId ? "effect" : "plain",
        // The completed gesture is attributed to the presenter that supplied
        // its visual geometry, so perf sessions can distinguish a DOM-canvas
        // transform from a retained native-surface handoff.
        rendererPath: browserSnapshot
          ? "webview-canvas"
          : nativeSnapshot
            ? "native-raster"
            : "studio-preview",
        operation: textTrace.operation,
        property: textTrace.operation,
        // durationMs measures the commit execution latency, ensuring honest SLA evaluation
        // rather than contaminating the 100ms interaction SLA with human gesture hold duration.
        durationMs: commitDurationMs,
        interactionId: `text-${textTrace.operation}:${textTrace.clipId}:${textTrace.startedAtMs}`,
        // Persisted clip geometry is deliberately authored. The raster's
        // visual bounds remain presentation-only and are published through
        // the renderer snapshot contract above.
        layoutWidth: finalGeometry.width,
        layoutHeight: finalGeometry.height,
        stageCoverage: "unattributed",
      });
      textTransformTraceRef.current = null;
    }
    if (previewInteractionRef.current) {
      previewInteractionCoordinator.commit(previewInteractionRef.current);
      previewInteractionRef.current = null;
    }
  }, [
    isDragging,
    selectedClip,
    execute,
    transformController,
    applyMouseMove,
    previewInteractionCoordinator,
    transformFrameQueue,
  ]);

  useEffect(() => () => transformFrameQueue.dispose(), [transformFrameQueue]);

  const getClipAspect = useCallback(() => {
    if (!selectedClip) return 16 / 9;
    if (selectedClip.sourceAspectRatio) return selectedClip.sourceAspectRatio;
    const asset = useProjectStore
      .getState()
      .mediaAssets.find((a) => a.id === selectedClip.mediaId);
    if (asset && asset.width && asset.height) {
      return asset.width / asset.height;
    }
    return selectedClip.width / selectedClip.height;
  }, [selectedClip]);

  const handleFitCanvas = useCallback(() => {
    if (!selectedClip) return;
    const oldVal = {
      x: selectedClip.x,
      y: selectedClip.y,
      width: selectedClip.width,
      height: selectedClip.height,
      ...("fontSize" in selectedClip
        ? { fontSize: (selectedClip as any).fontSize }
        : {}),
      ...(selectedClip.conform ? { conform: { ...selectedClip.conform } } : {}),
    };

    const canvasAspect = canvasWidth / canvasHeight;
    const clipAspect = getClipAspect();

    let newWidth: number;
    let newHeight: number;
    if (clipAspect > canvasAspect) {
      newWidth = canvasWidth;
      newHeight = canvasWidth / clipAspect;
    } else {
      newHeight = canvasHeight;
      newWidth = canvasHeight * clipAspect;
    }
    const newX = (canvasWidth - newWidth) / 2;
    const newY = (canvasHeight - newHeight) / 2;

    let newVal: Record<string, any> = {
      x: newX,
      y: newY,
      width: newWidth,
      height: newHeight,
    };

    if ("fontSize" in selectedClip) {
      const sizeScale = newWidth / Math.max(1, selectedClip.width);
      const currentFontSize = (selectedClip as any).fontSize || 48;
      newVal.fontSize = Math.max(
        10,
        Math.min(1000, Math.round(currentFontSize * sizeScale)),
      );
    }

    if (selectedClip.conform) {
      newVal.conform = getUpdatedConformForClipBounds(
        selectedClip,
        newVal.x,
        newVal.y,
        newVal.width,
        newVal.height,
        canvasWidth,
        canvasHeight,
      );
    }

    executePreviewCommand(new TransformClipCommand(selectedClip.id, oldVal, newVal));
  }, [selectedClip, canvasWidth, canvasHeight, getClipAspect, executePreviewCommand]);

  const handleFillCanvas = useCallback(() => {
    if (!selectedClip) return;
    const oldVal = {
      x: selectedClip.x,
      y: selectedClip.y,
      width: selectedClip.width,
      height: selectedClip.height,
      ...("fontSize" in selectedClip
        ? { fontSize: (selectedClip as any).fontSize }
        : {}),
      ...(selectedClip.conform ? { conform: { ...selectedClip.conform } } : {}),
    };

    const canvasAspect = canvasWidth / canvasHeight;
    const clipAspect = getClipAspect();

    let newWidth: number;
    let newHeight: number;
    if (clipAspect > canvasAspect) {
      newHeight = canvasHeight;
      newWidth = canvasHeight * clipAspect;
    } else {
      newWidth = canvasWidth;
      newHeight = canvasWidth / clipAspect;
    }
    const newX = (canvasWidth - newWidth) / 2;
    const newY = (canvasHeight - newHeight) / 2;

    let newVal: Record<string, any> = {
      x: newX,
      y: newY,
      width: newWidth,
      height: newHeight,
    };

    if ("fontSize" in selectedClip) {
      const sizeScale = newWidth / Math.max(1, selectedClip.width);
      const currentFontSize = (selectedClip as any).fontSize || 48;
      newVal.fontSize = Math.max(
        10,
        Math.min(1000, Math.round(currentFontSize * sizeScale)),
      );
    }

    if (selectedClip.conform) {
      newVal.conform = getUpdatedConformForClipBounds(
        selectedClip,
        newVal.x,
        newVal.y,
        newVal.width,
        newVal.height,
        canvasWidth,
        canvasHeight,
      );
    }

    executePreviewCommand(new TransformClipCommand(selectedClip.id, oldVal, newVal));
  }, [selectedClip, canvasWidth, canvasHeight, getClipAspect, executePreviewCommand]);

  const handleResetTransform = useCallback(() => {
    if (!selectedClip) return;
    const oldVal = {
      x: selectedClip.x,
      y: selectedClip.y,
      width: selectedClip.width,
      height: selectedClip.height,
      rotation: selectedClip.rotation,
      ...("fontSize" in selectedClip
        ? { fontSize: (selectedClip as any).fontSize }
        : {}),
      ...(selectedClip.conform ? { conform: { ...selectedClip.conform } } : {}),
    };

    let newVal: Record<string, any> = {
      x: 0,
      y: 0,
      rotation: 0,
    };

    if ("fontSize" in selectedClip) {
      const defaultFontSize =
        (selectedClip as any).styleDefinition?.fontSize || 48;
      const currentFontSize = (selectedClip as any).fontSize || 48;
      const sizeScale = defaultFontSize / Math.max(1, currentFontSize);
      newVal.fontSize = defaultFontSize;
      newVal.width = selectedClip.width * sizeScale;
      newVal.height = selectedClip.height * sizeScale;
    } else {
      const asset = useProjectStore
        .getState()
        .mediaAssets.find((a) => a.id === selectedClip.mediaId);
      if (asset && asset.width && asset.height) {
        newVal.width = asset.width;
        newVal.height = asset.height;
      } else {
        newVal.width = canvasWidth;
        newVal.height = canvasHeight;
      }
    }

    if (selectedClip.conform) {
      newVal.conform = {
        ...selectedClip.conform,
        userScale: 1,
        userOffsetX: 0,
        userOffsetY: 0,
      };
    }

    executePreviewCommand(new TransformClipCommand(selectedClip.id, oldVal, newVal));
  }, [selectedClip, canvasWidth, canvasHeight, executePreviewCommand]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!selectedClip) return;
      setContextMenu({ x: e.clientX, y: e.clientY });
    },
    [selectedClip],
  );

  const contextMenuItems = React.useMemo(
    () => [
      {
        label: "Fit Canvas",
        icon: Maximize2,
        onClick: handleFitCanvas,
      },
      {
        label: "Fill Canvas",
        icon: Minimize2,
        onClick: handleFillCanvas,
      },
      {
        label: "Reset Transform",
        icon: RotateCcw,
        onClick: handleResetTransform,
      },
    ],
    [handleFitCanvas, handleFillCanvas, handleResetTransform],
  );

  // Attach global mouse listeners during drag
  React.useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  React.useEffect(() => {
    return () => {
      transformFrameQueue.cancel();
      if (previewInteractionRef.current) {
        previewInteractionCoordinator.cancel(
          previewInteractionRef.current,
          "disposed",
          false,
        );
        previewInteractionRef.current = null;
      }
      // Cleanup: remove all cursor classes on unmount
      const cursorClasses = [
        "cursor-move",
        "cursor-nwse-resize",
        "cursor-nesw-resize",
        "cursor-ns-resize",
        "cursor-ew-resize",
        "cursor-grabbing",
      ];
      cursorClasses.forEach((cls) => document.body.classList.remove(cls));
    };
  }, [previewInteractionCoordinator, transformFrameQueue]);

  // Convert clip bounds to screen coordinates for handle rendering
  const isTransformable =
    selectedClip &&
    selectedClip.kind !== "filter" &&
    selectedClip.kind !== "video-effect" &&
    selectedClip.kind !== "body-effect" &&
    selectedClip.kind !== "audio";

  if (
    !selectedClip ||
    !isClipActiveAtTime(selectedClip, currentTime) ||
    !isTransformable
  ) {
    return (
      <div
        ref={overlayRef}
        data-transform-overlay="true"
        className="absolute inset-0 pointer-events-auto z-50"
        style={{
          width: displayWidth,
          height: displayHeight,
          visibility: overlayInteractive ? "visible" : "hidden",
          opacity: visible ? 1 : 0,
          pointerEvents: overlayInteractive ? "auto" : "none",
        }}
      >
        {/* Click capture layer - always active for selection/deselection */}
        <div
          className="absolute inset-0"
          onMouseDown={handleCanvasMouseDown}
          style={{
            background: "transparent",
            pointerEvents: "auto",
            zIndex: 1,
          }}
        />
      </div>
    );
  }

  // Use canvasToScreen for proper coordinate conversion.
  // Pass zero offset because we're positioning within the overlay div itself
  // (which is already placed at displayOffset by the parent layout).
  const zeroOffset = { x: 0, y: 0 };
  const rotation = selectedClip.rotation ?? 0;

  // Resolve actual rendered dimensions (accounting for conform or text template if present)
  // For clips with conform (e.g., 16:9 video fitted into 9:16 canvas) or text templates,
  // the transform overlay should match the actual rendered bounds, not the clip's full logical bounds
  const visualBounds = resolveOverlayBaseVisualBounds(
    selectedClip,
    canvasWidth,
    canvasHeight,
    isDragging ? dragVisualBoundsRef.current : null,
    getActiveProgramPreviewPresenter(),
  );
  const actualWidth = visualBounds.width;
  const actualHeight = visualBounds.height;
  const actualX = visualBounds.x;
  const actualY = visualBounds.y;

  // Convert clip center to screen space (use actual rendered position)
  const actualCenterX = actualX + actualWidth / 2;
  const actualCenterY = actualY + actualHeight / 2;
  const clipCenterScreen = canvasToScreen(
    actualCenterX,
    actualCenterY,
    viewport,
    { width: canvasWidth, height: canvasHeight },
    scale,
    zeroOffset,
  );

  // Calculate screen-space dimensions (accounting for scale and zoom)
  const handleDisplayWidth = actualWidth * scale * viewport.zoom;
  const handleDisplayHeight = actualHeight * scale * viewport.zoom;

  const overlayPivotX =
    ((visualBounds.pivotX ?? actualX + actualWidth / 2) - actualX) *
    scale *
    viewport.zoom;
  const overlayPivotY =
    ((visualBounds.pivotY ?? actualY + actualHeight / 2) - actualY) *
    scale *
    viewport.zoom;

  // Position transform box centered at the clip center, rotation applied via CSS transform
  const handleDisplayX = clipCenterScreen.x - handleDisplayWidth / 2;
  const handleDisplayY = clipCenterScreen.y - handleDisplayHeight / 2;

  if (
    selectedClip.kind === "text-template" ||
    selectedClip.templateSnapshot ||
    Boolean((selectedClip as any).styleId)
  ) {
    console.log("[TransformOverlay:RenderSelection]", {
      clipId: selectedClip.id,
      clipKind: selectedClip.kind,
      styleId: (selectedClip as any).styleId,
      clipRaw: { x: selectedClip.x, y: selectedClip.y, w: selectedClip.width, h: selectedClip.height },
      canvas: { width: canvasWidth, height: canvasHeight },
      visualBounds,
      screenBox: {
        left: handleDisplayX,
        top: handleDisplayY,
        width: handleDisplayWidth,
        height: handleDisplayHeight,
      },
    });
  }

  // Calculate canvas center for guides
  const canvasCenterX = canvasWidth / 2;
  const canvasCenterY = canvasHeight / 2;
  const centerScreen = canvasToScreen(
    canvasCenterX,
    canvasCenterY,
    viewport,
    { width: canvasWidth, height: canvasHeight },
    scale,
    zeroOffset,
  );

  const showVerticalCenterGuide = isDragging && snappedX;
  const showHorizontalCenterGuide = isDragging && snappedY;
  const showLeftGuide = isDragging && snappedLeft;
  const showRightGuide = isDragging && snappedRight;
  const showTopGuide = isDragging && snappedTop;
  const showBottomGuide = isDragging && snappedBottom;
  const visibleTransformHandles = getVisibleTransformHandles(
    handleDisplayWidth,
    handleDisplayHeight,
  );
  const compactCornerOutset = getCompactCornerOutset(
    handleDisplayWidth,
    handleDisplayHeight,
  );

  return (
    <div
      ref={overlayRef}
      data-transform-overlay="true"
      className="absolute inset-0 pointer-events-auto z-50"
      onContextMenu={handleContextMenu}
      style={{
        width: displayWidth,
        height: displayHeight,
        visibility: overlayInteractive ? "visible" : "hidden",
        opacity: visible ? 1 : 0,
        pointerEvents: overlayInteractive ? "auto" : "none",
      }}
    >
      {/* Click capture layer - always active for selection/deselection.
          Sits behind the transform border (lower z-index) so handle clicks
          pass through, but covers the entire overlay so empty-area clicks
          trigger deselection even when a clip is selected. */}
      <div
        className="absolute inset-0"
        onMouseDown={handleCanvasMouseDown}
        style={{
          background: "transparent",
          pointerEvents: "auto",
          zIndex: 1,
        }}
      />

      {/* Rotated transform container - groups border, move surface, and all handles
          so they rotate together perfectly and stay aligned under rotation. */}
      <div
        ref={transformContainerRef}
        style={{
          position: "absolute",
          left: handleDisplayX,
          top: handleDisplayY,
          width: handleDisplayWidth,
          height: handleDisplayHeight,
          transform: `var(--transform-overlay-drag-transform, rotate(${rotation}deg))`,
          // May intentionally sit outside the tight alpha rectangle. This is
          // the same full-texture centre used by native and canvas painters.
          transformOrigin: `${overlayPivotX}px ${overlayPivotY}px`,
          zIndex: 10,
          // While playing, only the full-overlay capture plane is active.
          // Handles and the move surface cannot begin an edit until the
          // transport has reached the paused editing mode.
          pointerEvents: isPlaybackInteraction ? "none" : "auto",
        }}
      >
        {/* Sleek, professional semi-transparent border, highlighted in red with a glow when snapped to center */}
        <div
          className="absolute border inset-0 pointer-events-none transition-all duration-75"
          style={{
            borderColor: "var(--color-handle)",
            boxShadow: "0 2px 4px rgba(0, 0, 0, 0.15)",
            borderWidth: "1px",
          }}
        />

        {/* Move surface - explicit drag target across full selected bounds */}
        <div
          className="absolute inset-0 cursor-move pointer-events-auto"
          data-transform-handle="move"
          style={{
            background: "transparent",
            cursor: "move",
          }}
          onMouseDown={handleMoveSurfaceMouseDown}
        />

        {/* Corner-only resizing keeps compact selections unambiguous. See
            getVisibleTransformHandles(). */}
        {visibleTransformHandles.map((position) => (
          <Handle
            key={position}
            position={position}
            onMouseDown={(e) => handleMouseDown(e, position)}
            left={0}
            top={0}
            width={handleDisplayWidth}
            height={handleDisplayHeight}
            rotation={rotation}
            cornerOutset={compactCornerOutset}
          />
        ))}

        {/* Rotation handle - floating centered below the bottom edge with scale compensation */}
        <Handle
          position="rotate"
          onMouseDown={(e) => handleMouseDown(e, "rotate")}
          scale={scale}
          left={0}
          top={0}
          width={handleDisplayWidth}
          height={handleDisplayHeight}
          rotation={rotation}
        />
      </div>

      {/* Center alignment guides (visible during move/resize near center) */}
      {showVerticalCenterGuide && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: `${centerScreen.x}px`,
            top: 0,
            width: "1px",
            height: `${displayHeight}px`,
            backgroundColor: "var(--color-handle)",
            boxShadow: "0 0 4px var(--color-handle)",
            zIndex: 14,
          }}
        />
      )}
      {showHorizontalCenterGuide && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: 0,
            top: `${centerScreen.y}px`,
            width: `${displayWidth}px`,
            height: "1px",
            backgroundColor: "var(--color-handle)",
            boxShadow: "0 0 4px var(--color-handle)",
            zIndex: 14,
          }}
        />
      )}

      {/* Left alignment guide */}
      {showLeftGuide && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: 0,
            top: 0,
            width: "1px",
            height: `${displayHeight}px`,
            backgroundColor: "var(--color-handle)",
            boxShadow: "0 0 4px var(--color-handle)",
            zIndex: 14,
          }}
        />
      )}
      {/* Right alignment guide */}
      {showRightGuide && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: `${displayWidth}px`,
            top: 0,
            width: "1px",
            height: `${displayHeight}px`,
            backgroundColor: "var(--color-handle)",
            boxShadow: "0 0 4px var(--color-handle)",
            zIndex: 14,
          }}
        />
      )}
      {/* Top alignment guide */}
      {showTopGuide && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: 0,
            top: 0,
            width: `${displayWidth}px`,
            height: "1px",
            backgroundColor: "var(--color-handle)",
            boxShadow: "0 0 4px var(--color-handle)",
            zIndex: 14,
          }}
        />
      )}
      {/* Bottom alignment guide */}
      {showBottomGuide && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: 0,
            top: `${displayHeight}px`,
            width: `${displayWidth}px`,
            height: "1px",
            backgroundColor: "var(--color-handle)",
            boxShadow: "0 0 4px var(--color-handle)",
            zIndex: 14,
          }}
        />
      )}

      {/* Rotation degree indicator - shows current rotation angle when rotating */}
      {isDragging && activeTransform?.handle === "rotate" && (
        <div
          className="absolute pointer-events-none"
          style={{
            zIndex: 15,
            top: 10,
            left: "50%",
            transform: "translateX(-50%)",
          }}
        >
          <div
            className="w-11 h-6 flex justify-center items-center rounded-sm text-sm font-semibold bg-accent/60 text-text-primary"
            style={{ backdropFilter: "blur(8px)" }}
          >
            {Math.round(dragRotation ?? rotation)}°
          </div>
        </div>
      )}

      {/* General vertical snap guide */}
      {isDragging && snapGuideX !== null && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: `${canvasToScreen(snapGuideX, 0, viewport, { width: canvasWidth, height: canvasHeight }, scale, zeroOffset).x}px`,
            top: 0,
            width: "1px",
            height: `${displayHeight}px`,
            backgroundColor: "var(--color-handle)",
            boxShadow: "0 0 4px var(--color-handle)",
            zIndex: 14,
          }}
        />
      )}

      {/* General horizontal snap guide */}
      {isDragging && snapGuideY !== null && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: 0,
            top: `${canvasToScreen(0, snapGuideY, viewport, { width: canvasWidth, height: canvasHeight }, scale, zeroOffset).y}px`,
            width: `${displayWidth}px`,
            height: "1px",
            backgroundColor: "var(--color-handle)",
            boxShadow: "0 0 4px var(--color-handle)",
            zIndex: 14,
          }}
        />
      )}

      {contextMenu && (
        <ContextMenu
          items={contextMenuItems}
          position={contextMenu}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
};

interface HandleProps {
  position: TransformHandle;
  onMouseDown: (e: React.MouseEvent) => void;
  /** Current display scale — used to keep rotation handle at a constant visual distance */
  scale?: number;
  left: number;
  top: number;
  width: number;
  height: number;
  rotation: number;
  cornerOutset?: { x: number; y: number };
}

const Handle: React.FC<HandleProps> = ({
  position,
  onMouseDown,
  scale = 1,
  left,
  top,
  width,
  height,
  rotation,
  cornerOutset = { x: 0, y: 0 },
}) => {
  const getHandleStyle = (): React.CSSProperties => {
    const handleSize = 10;
    const isCorner =
      position === "nw" ||
      position === "ne" ||
      position === "sw" ||
      position === "se";
    const baseStyle: React.CSSProperties = {
      position: "absolute",
      // Give corner handles a forgiving hit target. The visible dot remains
      // 10px, but the cursor should not fall back to the move surface when
      // the pointer is only a few pixels from a vertex.
      width: `${isCorner ? handleSize + 10 : handleSize}px`,
      height: `${isCorner ? handleSize + 10 : handleSize}px`,
      backgroundColor: isCorner ? "transparent" : "var(--color-handle)",
      border: isCorner ? "0" : "1px solid var(--color-handle-border)",
      borderRadius: "50%",
      transform: "translate(-50%, -50%)",
      boxShadow: isCorner ? "none" : "0 2px 4px rgba(0, 0, 0, 0.18)",
      display: isCorner ? "flex" : undefined,
      alignItems: isCorner ? "center" : undefined,
      justifyContent: isCorner ? "center" : undefined,
      zIndex: 20000,
      pointerEvents: "auto",
    };

    // Retrieve rotated cursor dynamically to align with NLE screen-space resizing
    const cursor = getCursorForHandle(position, rotation);

    switch (position) {
      case "nw":
        return {
          ...baseStyle,
          left: left - cornerOutset.x,
          top: top - cornerOutset.y,
        };
      case "ne":
        return {
          ...baseStyle,
          left: left + width + cornerOutset.x,
          top: top - cornerOutset.y,
        };
      case "sw":
        return {
          ...baseStyle,
          left: left - cornerOutset.x,
          top: top + height + cornerOutset.y,
        };
      case "se":
        return {
          ...baseStyle,
          left: left + width + cornerOutset.x,
          top: top + height + cornerOutset.y,
        };
      case "w":
        return {
          ...baseStyle,
          left: left,
          top: top + height / 2,
          width: "6px",
          height: "14px",
          borderRadius: "3px",
        };
      case "e":
        return {
          ...baseStyle,
          left: left + width,
          top: top + height / 2,
          width: "6px",
          height: "14px",
          borderRadius: "3px",
        };
      case "n":
        return {
          ...baseStyle,
          left: left + width / 2,
          top: top,
          width: "14px",
          height: "6px",
          borderRadius: "3px",
        };
      case "s":
        return {
          ...baseStyle,
          left: left + width / 2,
          top: top + height,
          width: "14px",
          height: "6px",
          borderRadius: "3px",
        };
      case "rotate": {
        // Scale-compensated offset so the rotation handle stays at a constant
        // visual distance (~32px) below the bottom edge regardless of viewport zoom.
        const offset = Math.max(24, Math.min(30, 32 / Math.max(0.1, scale)));
        return {
          ...baseStyle,
          left: left + width / 2,
          top: top + height + offset,
          backgroundColor: "var(--color-handle)",
          border: "1px solid var(--color-handle-border)",
          borderRadius: "50%",
          width: "20px",
          height: "20px",
          boxShadow:
            "0 3px 6px rgba(0, 0, 0, 0.16), 0 1px 3px rgba(0, 0, 0, 0.08)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        };
      }
      default:
        return baseStyle;
    }
  };

  const style = getHandleStyle();
  const cursor = getCursorForHandle(position, rotation);
  const cursorClass = getCursorClass(cursor);

  return (
    <div
      className={cursorClass}
      style={{
        ...style,
        cursor,
        transform: `${style.transform ?? "translate(-50%, -50%)"} rotate(${-rotation}deg)`,
        transformOrigin: "center",
      }}
      onMouseDown={onMouseDown}
      data-transform-handle={position}
    >
      {position !== "rotate" &&
        (position === "nw" ||
          position === "ne" ||
          position === "sw" ||
          position === "se") && (
          <span
            aria-hidden="true"
            style={{
              width: "10px",
              height: "10px",
              display: "block",
              borderRadius: "50%",
              backgroundColor: "var(--color-handle)",
              border: "1px solid var(--color-handle-border)",
              boxShadow: "0 2px 4px rgba(0, 0, 0, 0.18)",
              pointerEvents: "none",
            }}
          />
        )}
      {position === "rotate" && (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ color: "var(--color-bg)" }}
        >
          <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
          <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
          <path d="M16 16h5v5" />
        </svg>
      )}
    </div>
  );
};

// Memoize to prevent unnecessary re-renders
export const TransformOverlayMemoized = React.memo(TransformOverlay);

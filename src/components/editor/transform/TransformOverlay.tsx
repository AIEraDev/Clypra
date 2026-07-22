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

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useUIStore } from "@/store/uiStore";
import { useTimelineStore } from "@/store/timelineStore";
import { useHistoryStore } from "@/store/historyStore";
import { getTransformController } from "@/core/interactions";
import { TransformClipCommand } from "@/core/history/commands/TransformCommand";
import { calculateTransform, getDefaultConstraints, getCursorForHandle } from "@/lib/transform/calculator";
import { screenToCanvas, canvasToScreen, hitTestClip, type ViewportTransform } from "@/lib/utils/coordinateSystem";
import { hasTextClipContentTransformDrift, resolveTextClipContentTransform } from "@/lib/text/textClip";
import type { Clip, TextClip, TransformHandle, TransformState } from "@/types";
import { ContextMenu } from "@/components/ui/ContextMenu";
import { useProjectStore } from "@/store/projectStore";
import { Maximize2, Minimize2, RotateCcw } from "lucide-react";
import { resolveConform } from "@clypra-studio/engine";
import { t, useLanguage } from "@/i18n";

const SELECT_TRACE = import.meta.env.DEV;
const traceSelect = (...args: unknown[]) => {
  if (!SELECT_TRACE) return;
};
// const CENTER_GUIDE_SNAP_PX = 8;
// const CENTER_MAGNET_SNAP_PX = 12;

export function shouldScaleTextFontForHandle(handle: TransformHandle): boolean {
  return handle !== "move" && handle !== "rotate";
}

export function calculateTextResizeFontSize(startFontSize: number, handle: TransformHandle, startTransform: { width: number; height: number }, nextTransform: { width?: number; height?: number }): number {
  const scale = calculateTextResizeScale(handle, startTransform, nextTransform);
  return Math.max(10, Math.min(1000, Math.round(startFontSize * scale)));
}

export function calculateTextResizeScale(handle: TransformHandle, startTransform: { width: number; height: number }, nextTransform: { width?: number; height?: number }): number {
  const startWidth = Math.max(1, startTransform.width);
  const startHeight = Math.max(1, startTransform.height);
  const nextWidth = nextTransform.width ?? startTransform.width;
  const nextHeight = nextTransform.height ?? startTransform.height;

  let scale = 1;
  if (handle === "e" || handle === "w") {
    scale = nextWidth / startWidth;
  } else if (handle === "n" || handle === "s") {
    scale = nextHeight / startHeight;
  } else if (handle === "nw" || handle === "ne" || handle === "sw" || handle === "se") {
    const widthScale = nextWidth / startWidth;
    const heightScale = nextHeight / startHeight;
    scale = Math.abs(widthScale - 1) >= Math.abs(heightScale - 1) ? widthScale : heightScale;
  }

  return Math.max(0.01, scale);
}

export function calculateScaledTextTransform(handle: TransformHandle, startTransform: { x: number; y: number; width: number; height: number }, nextTransform: Partial<Clip>, scale: number): Partial<Clip> {
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

export function isClipActiveAtTime(clip: { startTime: number; duration: number }, time: number): boolean {
  const end = clip.startTime + clip.duration;
  return clip.startTime <= time && time < end;
}

export function buildTransformStartClip(selectedClip: Clip, activeTransform: TransformState): Clip {
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
}

/**
 * Convert a mouse event to canvas coordinates, properly accounting for
 * the overlay's position on screen. The overlay is already positioned
 * inside the display viewport div, so the letterbox offset relative to
 * the overlay is always (0, 0).
 */
function mouseToCanvas(clientX: number, clientY: number, overlayRect: DOMRect, viewport: ViewportTransform, canvasWidth: number, canvasHeight: number, scale: number): { x: number; y: number } {
  // Step 1: Screen → overlay-local (subtract overlay's screen position)
  const localX = clientX - overlayRect.left;
  const localY = clientY - overlayRect.top;

  // Step 2: Overlay-local → canvas (the overlay sits at displayOffset=(0,0)
  // relative to itself, so pass zero offset)
  return screenToCanvas(localX, localY, viewport, { width: canvasWidth, height: canvasHeight }, scale, { x: 0, y: 0 });
}

export function getUpdatedConformForClipBounds(clip: Clip, newX: number, newY: number, newWidth: number, newHeight: number, canvasWidth: number, canvasHeight: number): any | undefined {
  if (clip.conform && clip.conform.sourceWidth && clip.conform.sourceHeight) {
    const baseConformed = resolveConform({ ...clip.conform, userScale: 1, userOffsetX: 0, userOffsetY: 0 }, canvasWidth, canvasHeight);
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

export const TransformOverlay: React.FC<TransformOverlayProps> = ({ canvasWidth, canvasHeight, scale, viewport, displayOffset, displayWidth, displayHeight, currentTime, visible = true }) => {
  useLanguage();
  const { selectedClipIds, selectClip, toggleClipSelection } = useUIStore();
  const { clips, tracks, updateClip } = useTimelineStore();
  const { execute } = useHistoryStore();

  // Get transform controller for imperative updates
  const transformController = getTransformController();
  const activeTransform = transformController.getActiveTransform();

  const [isDragging, setIsDragging] = useState(false);
  const [snappedX, setSnappedX] = useState(false);
  const [snappedY, setSnappedY] = useState(false);
  const [snappedLeft, setSnappedLeft] = useState(false);
  const [snappedRight, setSnappedRight] = useState(false);
  const [snappedTop, setSnappedTop] = useState(false);
  const [snappedBottom, setSnappedBottom] = useState(false);

  const [snapGuideX, setSnapGuideX] = useState<number | null>(null);
  const [snapGuideY, setSnapGuideY] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

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
  const clickCycleRef = useRef<{ signature: string; index: number }>({ signature: "", index: -1 });
  const dragCursorRef = useRef<string | null>(null);
  /** Start angle (radians) for rotation drag — prevents initial snap */
  const startAngleRef = useRef<number | undefined>(undefined);
  /** Start font size for text clips — supports proportional dynamic scaling */
  const startFontSizeRef = useRef<number | undefined>(undefined);

  // Get the first selected clip (multi-select transform comes later)
  const selectedClip = clips.find((c) => c.id === selectedClipIds[0]);

  useEffect(() => {
    if (!selectedClip || isDragging || !isClipActiveAtTime(selectedClip, currentTime) || !("text" in selectedClip)) return;

    const textClip = selectedClip as TextClip;
    // Apply transform normalization to text effects (styleId) and text with background
    // Template clips are excluded because their bounds are determined by the template's
    // canvas dimensions and should be freely transformable without normalization
    if (!textClip.styleId && !textClip.background) return;
    if (!hasTextClipContentTransformDrift(textClip, canvasWidth, canvasHeight)) return;

    const nextTransform = resolveTextClipContentTransform(textClip, canvasWidth, canvasHeight, "selection-normalize");
    updateClip(textClip.id, nextTransform);
  }, [selectedClip, isDragging, currentTime, canvasWidth, canvasHeight, updateClip]);

  // Handle canvas mousedown to select/deselect clips.
  // Using mousedown (instead of click) avoids click-tail races after drag.
  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent) => {
      traceSelect("canvas mousedown", {
        target: (e.target as HTMLElement)?.tagName,
        selectedClipIds,
        isDragging,
        currentTime,
      });
      // Don't handle if clicking on a handle or during drag
      if (isDragging || (e.target as HTMLElement).closest("[data-transform-handle]")) {
        traceSelect("canvas mousedown ignored", { reason: "dragging-or-handle" });
        return;
      }

      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return;

      // Convert screen coordinates to canvas coordinates using overlay-local mapping
      const canvasCoords = mouseToCanvas(e.clientX, e.clientY, rect, viewport, canvasWidth, canvasHeight, scale);

      // If user mousedown is inside the currently selected clip, keep selection stable.
      // This avoids deselect-on-second-mousedown when playhead/time filtering excludes
      // the clip from the generic hit-candidate list.
      if (selectedClip && hitTestClip(canvasCoords.x, canvasCoords.y, selectedClip)) {
        traceSelect("mousedown inside selected clip", { clipId: selectedClip.id, modifiers: { shift: e.shiftKey, meta: e.metaKey, ctrl: e.ctrlKey } });
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          toggleClipSelection(selectedClip.id);
        } else {
          selectClip(selectedClip.id);
        }
        return;
      }

      const trackIndexMap = new Map(tracks.map((t, idx) => [t.id, idx]));
      const visibleTrackIds = new Set(tracks.filter((t) => t.visible !== false).map((t) => t.id));

      // Selectable clips in program preview:
      // - visible track
      // - active at playhead
      // - non-degenerate bounds
      const selectable = clips
        .map((clip, idx) => ({ clip, idx }))
        .filter(({ clip }) => {
          if (!visibleTrackIds.has(clip.trackId)) return false;
          if (!(clip.width > 0 && clip.height > 0)) return false;
          const end = clip.startTime + clip.duration;
          return clip.startTime <= currentTime && currentTime < end;
        });

      // Topmost-first ordering for hit-selection.
      // Lower track index is visually higher in current compositor ordering.
      const hitCandidates = selectable
        .filter(({ clip }) => hitTestClip(canvasCoords.x, canvasCoords.y, clip))
        .sort((a, b) => {
          const ta = trackIndexMap.get(a.clip.trackId) ?? Number.MAX_SAFE_INTEGER;
          const tb = trackIndexMap.get(b.clip.trackId) ?? Number.MAX_SAFE_INTEGER;
          if (ta !== tb) return ta - tb;
          // Same track: later clip in state wins by default
          return b.idx - a.idx;
        })
        .map(({ clip }) => clip);

      if (hitCandidates.length > 0) {
        traceSelect("hitCandidates", { ids: hitCandidates.map((c) => c.id) });
        // Multi-select modifier: toggle topmost hit only.
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          toggleClipSelection(hitCandidates[0].id);
          return;
        }

        // Single-click cycling through overlapping clips:
        // repeated clicks at same overlap set iterate through stack.
        const signature = hitCandidates.map((c) => c.id).join("|");
        let nextIndex = 0;
        if (clickCycleRef.current.signature === signature) {
          nextIndex = (clickCycleRef.current.index + 1) % hitCandidates.length;
        }
        clickCycleRef.current = { signature, index: nextIndex };
        selectClip(hitCandidates[nextIndex].id);
      } else {
        // Clicked on empty area - deselect
        traceSelect("empty area deselect");
        clickCycleRef.current = { signature: "", index: -1 };
        selectClip(null);
      }
    },
    [clips, tracks, currentTime, scale, viewport, canvasWidth, canvasHeight, isDragging, selectClip, toggleClipSelection, selectedClip, selectedClipIds],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, handle: TransformHandle) => {
      if (!selectedClip) return;

      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);
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
      if (!rect) return;

      // Convert screen coordinates to canvas coordinates using overlay-local mapping
      const canvasCoords = mouseToCanvas(e.clientX, e.clientY, rect, viewport, canvasWidth, canvasHeight, scale);

      // Capture start angle for rotation handle
      if (handle === "rotate") {
        const centerX = selectedClip.x + selectedClip.width / 2;
        const centerY = selectedClip.y + selectedClip.height / 2;
        startAngleRef.current = Math.atan2(canvasCoords.y - centerY, canvasCoords.x - centerX);
      } else {
        startAngleRef.current = undefined;
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
          conform: selectedClip.conform ? { ...selectedClip.conform } : undefined,
        },
        startMousePos: canvasCoords,
        aspectRatioLocked: selectedClip.aspectRatioLocked ?? true,
        sourceAspectRatio: selectedClip.sourceAspectRatio ?? selectedClip.width / selectedClip.height,
      });
    },
    [selectedClip, scale, viewport, canvasWidth, canvasHeight, transformController],
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || !activeTransform) return;

      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return;

      // Convert screen coordinates to canvas coordinates using overlay-local mapping
      const canvasCoords = mouseToCanvas(e.clientX, e.clientY, rect, viewport, canvasWidth, canvasHeight, scale);

      // Calculate new transform from the ORIGINAL start state (not current clip state)
      // This prevents transform drift / acceleration during drag.
      const constraints = getDefaultConstraints(canvasWidth, canvasHeight, activeTransform.aspectRatioLocked);

      // Preserve text/media metadata while applying drag-start geometry so deltas
      // stay absolute without dropping type-specific resize behavior.
      if (!selectedClip) return;
      const startClip = buildTransformStartClip(selectedClip, activeTransform);

      const newTransform = calculateTransform(startClip, activeTransform.handle, activeTransform.startMousePos, canvasCoords, constraints, startAngleRef.current);

      // Resize handles scale text size with the edited axis so the rendered text
      // tracks the visible transform box during drag.
      if (startFontSizeRef.current !== undefined && shouldScaleTextFontForHandle(activeTransform.handle)) {
        const newFontSize = calculateTextResizeFontSize(startFontSizeRef.current, activeTransform.handle, activeTransform.startTransform, newTransform);
        const textScale = newFontSize / Math.max(1, startFontSizeRef.current);
        Object.assign(newTransform, calculateScaledTextTransform(activeTransform.handle, activeTransform.startTransform, newTransform, textScale), { fontSize: newFontSize });
      }

      // Stateful magnetic center snapping (like CapCut):
      // - Snap-in when calculated center gets close to canvas center.
      // - Locked snap state with escape threshold: the user must drag their mouse past the escape threshold
      //   to release the magnetic snap lock, providing a tactile, sticky magnetic force feel.
      if (activeTransform.handle !== "rotate") {
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

        if (activeTransform.handle === "move") {
          const activeClips = clips.filter((c) => c.id !== selectedClip.id && isClipActiveAtTime(c, currentTime));

          // X Axis Snapping (Left, Right, Center)
          if (snappedXRef.current) {
            const deltaMouseX = Math.abs(canvasCoords.x - snapMouseXRef.current);
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
              newTransform.x = snapGuideXRef.current! + snapClipXOffsetRef.current;
            }
          } else {
            // Gather all target X coordinates
            const targetXCandidates: { value: number; type: "canvas-left" | "canvas-center" | "canvas-right" | "clip" }[] = [
              { value: 0, type: "canvas-left" },
              { value: canvasWidth / 2, type: "canvas-center" },
              { value: canvasWidth, type: "canvas-right" },
            ];

            activeClips.forEach((c) => {
              targetXCandidates.push({ value: c.x, type: "clip" });
              targetXCandidates.push({ value: c.x + c.width / 2, type: "clip" });
              targetXCandidates.push({ value: c.x + c.width, type: "clip" });
            });

            let bestSnapX: { targetVal: number; clipOffset: number; type: string } | null = null;
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
            const deltaMouseY = Math.abs(canvasCoords.y - snapMouseYRef.current);
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
              newTransform.y = snapGuideYRef.current! + snapClipYOffsetRef.current;
            }
          } else {
            // Gather all target Y coordinates
            const targetYCandidates: { value: number; type: "canvas-top" | "canvas-center" | "canvas-bottom" | "clip" }[] = [
              { value: 0, type: "canvas-top" },
              { value: canvasHeight / 2, type: "canvas-center" },
              { value: canvasHeight, type: "canvas-bottom" },
            ];

            activeClips.forEach((c) => {
              targetYCandidates.push({ value: c.y, type: "clip" });
              targetYCandidates.push({ value: c.y + c.height / 2, type: "clip" });
              targetYCandidates.push({ value: c.y + c.height, type: "clip" });
            });

            let bestSnapY: { targetVal: number; clipOffset: number; type: string } | null = null;
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
          const handle = activeTransform.handle;
          const isLeftResize = handle === "w" || handle === "nw" || handle === "sw";
          const isRightResize = handle === "e" || handle === "ne" || handle === "se";
          const isTopResize = handle === "n" || handle === "nw" || handle === "ne";
          const isBottomResize = handle === "s" || handle === "sw" || handle === "se";

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
                if (activeTransform.aspectRatioLocked) {
                  const aspectRatio = startClip.sourceAspectRatio ?? startClip.width / startClip.height;
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
                if (activeTransform.aspectRatioLocked) {
                  const aspectRatio = startClip.sourceAspectRatio ?? startClip.width / startClip.height;
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
                if (activeTransform.aspectRatioLocked) {
                  const aspectRatio = startClip.sourceAspectRatio ?? startClip.width / startClip.height;
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
                if (activeTransform.aspectRatioLocked) {
                  const aspectRatio = startClip.sourceAspectRatio ?? startClip.width / startClip.height;
                  const newWidth = newHeight * aspectRatio;
                  const centerX = startClip.x + startClip.width / 2;
                  newTransform.x = centerX - newWidth / 2;
                  newTransform.width = newWidth;
                }
              }
            };

            if (isLeftResize) {
              if (snappedLeftRef.current) {
                const deltaMouseX = Math.abs(canvasCoords.x - snapMouseLeftRef.current);
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
                const deltaMouseX = Math.abs(canvasCoords.x - snapMouseRightRef.current);
                if (deltaMouseX > ESCAPE_THRESHOLD) {
                  snappedRightRef.current = false;
                  setSnappedRight(false);
                } else {
                  horizontalSnapped = true;
                  applyRightResizeSnap();
                }
              } else if (Math.abs(nextX + nextW - canvasWidth) <= SNAP_IN_THRESHOLD) {
                snappedRightRef.current = true;
                snapMouseRightRef.current = canvasCoords.x;
                setSnappedRight(true);
                horizontalSnapped = true;
                applyRightResizeSnap();
              }
            }

            const canSnapVertical = !activeTransform.aspectRatioLocked || !horizontalSnapped;
            if (canSnapVertical) {
              if (isTopResize) {
                if (snappedTopRef.current) {
                  const deltaMouseY = Math.abs(canvasCoords.y - snapMouseTopRef.current);
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
                  const deltaMouseY = Math.abs(canvasCoords.y - snapMouseBottomRef.current);
                  if (deltaMouseY > ESCAPE_THRESHOLD) {
                    snappedBottomRef.current = false;
                    setSnappedBottom(false);
                  } else {
                    applyBottomResizeSnap();
                  }
                } else if (Math.abs(nextY + nextH - canvasHeight) <= SNAP_IN_THRESHOLD) {
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

      if (selectedClip.conform && selectedClip.conform.sourceWidth && selectedClip.conform.sourceHeight) {
        const updatedConform = getUpdatedConformForClipBounds(selectedClip, newTransform.x ?? selectedClip.x, newTransform.y ?? selectedClip.y, newTransform.width ?? selectedClip.width, newTransform.height ?? selectedClip.height, canvasWidth, canvasHeight);
        if (updatedConform) {
          (newTransform as any).conform = updatedConform;
        }
      }

      traceSelect("transform mousemove", { clipId: activeTransform.clipId, handle: activeTransform.handle, x: newTransform.x, y: newTransform.y, width: newTransform.width, height: newTransform.height });

      // Optimistic preview: update clip for visual feedback during drag
      // Skip epoch increment to avoid cache thrashing during high-frequency updates
      // The overlay reads from selectedClip (timeline store) for handle positioning
      updateClip(activeTransform.clipId, { ...newTransform, _skipEpochIncrement: true } as any);
    },
    [isDragging, activeTransform, selectedClip, scale, viewport, canvasWidth, canvasHeight, updateClip, transformController, clips, currentTime],
  );

  const handleMouseUp = useCallback(() => {
    if (!isDragging || !activeTransform) return;
    traceSelect("transform mouseup", { clipId: activeTransform.clipId, selectedClipIds });

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

    // Read final clip state from store for history
    const finalClip = useTimelineStore.getState().clips.find((c) => c.id === activeTransform.clipId);
    if (!finalClip) {
      transformController.endTransform();
      return;
    }

    // Commit to history
    const oldTransform: Record<string, any> = { ...activeTransform.startTransform };
    const newTransform: Record<string, any> = {
      x: finalClip.x,
      y: finalClip.y,
      width: finalClip.width,
      height: finalClip.height,
      rotation: finalClip.rotation,
    };

    if (finalClip.conform) {
      newTransform.conform = { ...finalClip.conform };
    }

    if (startFontSizeRef.current !== undefined) {
      oldTransform.fontSize = startFontSizeRef.current;
      newTransform.fontSize = (finalClip as any).fontSize;
    }

    // Only create command if something actually changed
    const hasChanged = oldTransform.x !== newTransform.x || oldTransform.y !== newTransform.y || oldTransform.width !== newTransform.width || oldTransform.height !== newTransform.height || oldTransform.rotation !== newTransform.rotation || oldTransform.fontSize !== newTransform.fontSize || JSON.stringify(oldTransform.conform) !== JSON.stringify(newTransform.conform);

    if (hasChanged) {
      execute(new TransformClipCommand(activeTransform.clipId, oldTransform, newTransform));
    }

    transformController.endTransform();
  }, [isDragging, activeTransform, execute, selectedClipIds, transformController]);

  const getClipAspect = useCallback(() => {
    if (!selectedClip) return 16 / 9;
    if (selectedClip.sourceAspectRatio) return selectedClip.sourceAspectRatio;
    const asset = useProjectStore.getState().mediaAssets.find((a) => a.id === selectedClip.mediaId);
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
      ...("fontSize" in selectedClip ? { fontSize: (selectedClip as any).fontSize } : {}),
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
      newVal.fontSize = Math.max(10, Math.min(1000, Math.round(currentFontSize * sizeScale)));
    }

    if (selectedClip.conform) {
      newVal.conform = getUpdatedConformForClipBounds(selectedClip, newVal.x, newVal.y, newVal.width, newVal.height, canvasWidth, canvasHeight);
    }

    execute(new TransformClipCommand(selectedClip.id, oldVal, newVal));
  }, [selectedClip, canvasWidth, canvasHeight, getClipAspect, execute]);

  const handleFillCanvas = useCallback(() => {
    if (!selectedClip) return;
    const oldVal = {
      x: selectedClip.x,
      y: selectedClip.y,
      width: selectedClip.width,
      height: selectedClip.height,
      ...("fontSize" in selectedClip ? { fontSize: (selectedClip as any).fontSize } : {}),
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
      newVal.fontSize = Math.max(10, Math.min(1000, Math.round(currentFontSize * sizeScale)));
    }

    if (selectedClip.conform) {
      newVal.conform = getUpdatedConformForClipBounds(selectedClip, newVal.x, newVal.y, newVal.width, newVal.height, canvasWidth, canvasHeight);
    }

    execute(new TransformClipCommand(selectedClip.id, oldVal, newVal));
  }, [selectedClip, canvasWidth, canvasHeight, getClipAspect, execute]);

  const handleResetTransform = useCallback(() => {
    if (!selectedClip) return;
    const oldVal = {
      x: selectedClip.x,
      y: selectedClip.y,
      width: selectedClip.width,
      height: selectedClip.height,
      rotation: selectedClip.rotation,
      ...("fontSize" in selectedClip ? { fontSize: (selectedClip as any).fontSize } : {}),
      ...(selectedClip.conform ? { conform: { ...selectedClip.conform } } : {}),
    };

    let newVal: Record<string, any> = {
      x: 0,
      y: 0,
      rotation: 0,
    };

    if ("fontSize" in selectedClip) {
      const defaultFontSize = (selectedClip as any).styleDefinition?.fontSize || 48;
      const currentFontSize = (selectedClip as any).fontSize || 48;
      const sizeScale = defaultFontSize / Math.max(1, currentFontSize);
      newVal.fontSize = defaultFontSize;
      newVal.width = selectedClip.width * sizeScale;
      newVal.height = selectedClip.height * sizeScale;
    } else {
      const asset = useProjectStore.getState().mediaAssets.find((a) => a.id === selectedClip.mediaId);
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

    execute(new TransformClipCommand(selectedClip.id, oldVal, newVal));
  }, [selectedClip, canvasWidth, canvasHeight, execute]);

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
        label: t("properties.transform.fitCanvas"),
        icon: Maximize2,
        onClick: handleFitCanvas,
      },
      {
        label: t("properties.transform.fillCanvas"),
        icon: Minimize2,
        onClick: handleFillCanvas,
      },
      {
        label: t("properties.transform.resetTransform"),
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
      // Cleanup: remove all cursor classes on unmount
      const cursorClasses = ["cursor-move", "cursor-nwse-resize", "cursor-nesw-resize", "cursor-ns-resize", "cursor-ew-resize", "cursor-grabbing"];
      cursorClasses.forEach((cls) => document.body.classList.remove(cls));
    };
  }, []);

  // Convert clip bounds to screen coordinates for handle rendering
  const isTransformable = selectedClip && selectedClip.kind !== "filter" && selectedClip.kind !== "video-effect" && selectedClip.kind !== "body-effect" && selectedClip.kind !== "audio";

  if (!selectedClip || !isClipActiveAtTime(selectedClip, currentTime) || !isTransformable) {
    return (
      <div
        ref={overlayRef}
        className="absolute inset-0 pointer-events-auto z-50"
        style={{
          width: displayWidth,
          height: displayHeight,
          visibility: visible ? "visible" : "hidden",
          pointerEvents: visible ? "auto" : "none",
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

  // Calculate the center of the clip in canvas space
  const clipCenterX = selectedClip.x + selectedClip.width / 2;
  const clipCenterY = selectedClip.y + selectedClip.height / 2;

  // Resolve actual rendered dimensions (accounting for conform if present)
  // For clips with conform (e.g., 16:9 video fitted into 9:16 canvas),
  // the transform overlay should match the actual rendered bounds, not the clip's logical bounds
  let actualWidth = selectedClip.width;
  let actualHeight = selectedClip.height;
  let actualX = selectedClip.x;
  let actualY = selectedClip.y;

  if (selectedClip.conform && selectedClip.conform.sourceWidth && selectedClip.conform.sourceHeight) {
    const resolved = resolveConform(selectedClip.conform, canvasWidth, canvasHeight);
    actualWidth = resolved.width;
    actualHeight = resolved.height;
    actualX = resolved.x;
    actualY = resolved.y;
  }

  // Convert clip center to screen space (use actual rendered position)
  const actualCenterX = actualX + actualWidth / 2;
  const actualCenterY = actualY + actualHeight / 2;
  const clipCenterScreen = canvasToScreen(actualCenterX, actualCenterY, viewport, { width: canvasWidth, height: canvasHeight }, scale, zeroOffset);

  // Calculate screen-space dimensions (accounting for scale and zoom)
  const handleDisplayWidth = actualWidth * scale * viewport.zoom;
  const handleDisplayHeight = actualHeight * scale * viewport.zoom;

  // Position transform box centered at the clip center, rotation applied via CSS transform
  const handleDisplayX = clipCenterScreen.x - handleDisplayWidth / 2;
  const handleDisplayY = clipCenterScreen.y - handleDisplayHeight / 2;

  // Calculate canvas center for guides
  const canvasCenterX = canvasWidth / 2;
  const canvasCenterY = canvasHeight / 2;
  const centerScreen = canvasToScreen(canvasCenterX, canvasCenterY, viewport, { width: canvasWidth, height: canvasHeight }, scale, zeroOffset);

  const showVerticalCenterGuide = isDragging && snappedX;
  const showHorizontalCenterGuide = isDragging && snappedY;
  const showLeftGuide = isDragging && snappedLeft;
  const showRightGuide = isDragging && snappedRight;
  const showTopGuide = isDragging && snappedTop;
  const showBottomGuide = isDragging && snappedBottom;

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 pointer-events-auto z-50"
      onContextMenu={handleContextMenu}
      style={{
        width: displayWidth,
        height: displayHeight,
        visibility: visible ? "visible" : "hidden",
        pointerEvents: visible ? "auto" : "none",
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
        style={{
          position: "absolute",
          left: handleDisplayX,
          top: handleDisplayY,
          width: handleDisplayWidth,
          height: handleDisplayHeight,
          transform: `rotate(${rotation}deg)`,
          transformOrigin: "center",
          zIndex: 10,
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
          }}
          onMouseDown={(e) => handleMouseDown(e, "move")}
        />

        {/* Corner handles (centered exactly on the box vertices) */}
        <Handle position="nw" onMouseDown={(e) => handleMouseDown(e, "nw")} left={0} top={0} width={handleDisplayWidth} height={handleDisplayHeight} rotation={rotation} />
        <Handle position="ne" onMouseDown={(e) => handleMouseDown(e, "ne")} left={0} top={0} width={handleDisplayWidth} height={handleDisplayHeight} rotation={rotation} />
        <Handle position="sw" onMouseDown={(e) => handleMouseDown(e, "sw")} left={0} top={0} width={handleDisplayWidth} height={handleDisplayHeight} rotation={rotation} />
        <Handle position="se" onMouseDown={(e) => handleMouseDown(e, "se")} left={0} top={0} width={handleDisplayWidth} height={handleDisplayHeight} rotation={rotation} />

        {/* Side handles (horizontal & vertical pills) */}
        <Handle position="n" onMouseDown={(e) => handleMouseDown(e, "n")} left={0} top={0} width={handleDisplayWidth} height={handleDisplayHeight} rotation={rotation} />
        <Handle position="s" onMouseDown={(e) => handleMouseDown(e, "s")} left={0} top={0} width={handleDisplayWidth} height={handleDisplayHeight} rotation={rotation} />
        <Handle position="w" onMouseDown={(e) => handleMouseDown(e, "w")} left={0} top={0} width={handleDisplayWidth} height={handleDisplayHeight} rotation={rotation} />
        <Handle position="e" onMouseDown={(e) => handleMouseDown(e, "e")} left={0} top={0} width={handleDisplayWidth} height={handleDisplayHeight} rotation={rotation} />

        {/* Rotation handle - floating centered below the bottom edge with scale compensation */}
        <Handle position="rotate" onMouseDown={(e) => handleMouseDown(e, "rotate")} scale={scale} left={0} top={0} width={handleDisplayWidth} height={handleDisplayHeight} rotation={rotation} />
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
          <div className="w-11 h-6 flex justify-center items-center rounded-sm text-sm font-semibold bg-accent/60 text-text-primary" style={{ backdropFilter: "blur(8px)" }}>
            {Math.round(rotation)}°
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

      {contextMenu && <ContextMenu items={contextMenuItems} position={contextMenu} onClose={() => setContextMenu(null)} />}
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
}

const Handle: React.FC<HandleProps> = ({ position, onMouseDown, scale = 1, left, top, width, height, rotation }) => {
  const getHandleStyle = (): React.CSSProperties => {
    const handleSize = 10;
    const baseStyle: React.CSSProperties = {
      position: "absolute",
      width: `${handleSize}px`,
      height: `${handleSize}px`,
      backgroundColor: "var(--color-handle)",
      border: "1px solid var(--color-handle-border)",
      borderRadius: "50%",
      transform: "translate(-50%, -50%)",
      boxShadow: "0 2px 4px rgba(0, 0, 0, 0.18)",
      zIndex: 20000,
      pointerEvents: "auto",
    };

    // Retrieve rotated cursor dynamically to align with NLE screen-space resizing
    const cursor = getCursorForHandle(position, rotation);

    switch (position) {
      case "nw":
        return { ...baseStyle, left: left, top: top };
      case "ne":
        return { ...baseStyle, left: left + width, top: top };
      case "sw":
        return { ...baseStyle, left: left, top: top + height };
      case "se":
        return { ...baseStyle, left: left + width, top: top + height };
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
          boxShadow: "0 3px 6px rgba(0, 0, 0, 0.16), 0 1px 3px rgba(0, 0, 0, 0.08)",
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
        transform: `${style.transform ?? "translate(-50%, -50%)"} rotate(${-rotation}deg)`,
        transformOrigin: "center",
      }}
      onMouseDown={onMouseDown}
      data-transform-handle={position}
    >
      {position === "rotate" && (
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--color-bg)" }}>
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

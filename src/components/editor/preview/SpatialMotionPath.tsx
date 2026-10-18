/**
 * SpatialMotionPath
 *
 * Renders an interactive SVG overlay directly over the preview canvas showing:
 * - 2D Bézier trajectory curve for the selected clip's position keyframes
 * - Frame-interval tick dots (slow = clustered, fast = spread out)
 * - Draggable diamond keyframe anchor nodes
 * - Draggable Bézier spatial tangent handles
 * - Glowing playhead cursor tracking the clip's current position
 *
 * Coordinate system: All positions in canvas space; converted to screen space
 * using canvasToScreen() before rendering in the SVG overlay.
 */

import React, { useCallback, useMemo, useRef, useEffect, useState } from "react";
import { useUIStore } from "@/store/uiStore";
import { useTimelineStore } from "@/store/timelineStore";
import { useHistoryStore } from "@/store/historyStore";
import { usePlaybackClock } from "@/hooks/usePlaybackClock";
import {
  extractSpatialPathNodes,
  generateSpatialPathSvg,
  generatePathFrameTicks,
  evaluateSpatialPosition,
  updateSpatialKeyframePosition,
  updateSpatialTangentHandle,
  type SpatialPathNode,
} from "@/core/animation/spatialMotionPath";
import { canvasToScreen, type ViewportTransform } from "@/lib/utils/coordinateSystem";
import { TransformClipCommand } from "@/core/history/commands/TransformCommand";
import type { Clip } from "@/types";

interface SpatialMotionPathProps {
  canvasWidth: number;
  canvasHeight: number;
  scale: number;
  viewport: ViewportTransform;
  displayOffset: { x: number; y: number };
  displayWidth: number;
  displayHeight: number;
  /** Current playhead time in seconds (program/global) */
  currentTime: number;
}

/** Converts a canvas-space point to overlay-local SVG coordinates */
function cToS(
  x: number,
  y: number,
  viewport: ViewportTransform,
  canvasWidth: number,
  canvasHeight: number,
  scale: number,
): { sx: number; sy: number } {
  const screen = canvasToScreen(
    x,
    y,
    viewport,
    { width: canvasWidth, height: canvasHeight },
    scale,
    { x: 0, y: 0 },
  );
  return { sx: screen.x, sy: screen.y };
}

export const SpatialMotionPath: React.FC<SpatialMotionPathProps> = ({
  canvasWidth,
  canvasHeight,
  scale,
  viewport,
  displayOffset: _displayOffset,
  displayWidth,
  displayHeight,
  currentTime,
}) => {
  const { selectedClipIds } = useUIStore();
  const { clips, updateClip } = useTimelineStore();
  const { execute } = useHistoryStore();

  const [dragState, setDragState] = useState<{
    type: "anchor" | "tangentIn" | "tangentOut";
    nodeId: string;
    startX: number;
    startY: number;
    startCanvasX: number;
    startCanvasY: number;
  } | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);

  // Find the selected clip that has position keyframes
  const selectedClip = useMemo<Clip | null>(() => {
    if (selectedClipIds.length !== 1) return null;
    const clip = clips.find((c) => c.id === selectedClipIds[0]);
    if (!clip) return null;
    const xLen = clip.visualKeyframes?.x?.length ?? 0;
    const yLen = clip.visualKeyframes?.y?.length ?? 0;
    if (xLen < 2 && yLen < 2) return null;
    // Respect showMotionPath: false as an override
    if (clip.showMotionPath === false) return null;
    return clip;
  }, [selectedClipIds, clips]);

  const nodes = useMemo(
    () => (selectedClip ? extractSpatialPathNodes(selectedClip) : []),
    [selectedClip],
  );

  const svgPathD = useMemo(
    () => generateSpatialPathSvg(nodes),
    [nodes],
  );

  const frameTicks = useMemo(() => {
    if (!selectedClip) return [];
    return generatePathFrameTicks(selectedClip, 24);
  }, [selectedClip]);

  // Playhead position on path
  const playheadPos = useMemo(() => {
    if (!selectedClip) return null;
    const localTime = Math.max(0, Math.min(selectedClip.duration, currentTime - selectedClip.startTime));
    if (currentTime < selectedClip.startTime || currentTime > selectedClip.startTime + selectedClip.duration) {
      return null;
    }
    return evaluateSpatialPosition(selectedClip, localTime);
  }, [selectedClip, currentTime]);

  // Convert canvas coords to SVG overlay coords
  const toSvg = useCallback(
    (cx: number, cy: number) =>
      cToS(cx, cy, viewport, canvasWidth, canvasHeight, scale),
    [viewport, canvasWidth, canvasHeight, scale],
  );

  // Pointer event handling for dragging nodes and tangents
  const handlePointerDown = useCallback(
    (
      e: React.PointerEvent,
      type: "anchor" | "tangentIn" | "tangentOut",
      nodeId: string,
      canvasX: number,
      canvasY: number,
    ) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragState({
        type,
        nodeId,
        startX: e.clientX,
        startY: e.clientY,
        startCanvasX: canvasX,
        startCanvasY: canvasY,
      });
    },
    [],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragState || !selectedClip) return;
      e.stopPropagation();

      const effectiveScale = scale * viewport.zoom;
      const dx = (e.clientX - dragState.startX) / effectiveScale;
      const dy = (e.clientY - dragState.startY) / effectiveScale;

      const newX = dragState.startCanvasX + dx;
      const newY = dragState.startCanvasY + dy;

      let partialUpdate: Partial<Clip>;

      if (dragState.type === "anchor") {
        partialUpdate = updateSpatialKeyframePosition(
          selectedClip,
          dragState.nodeId,
          { x: newX, y: newY },
        );
      } else {
        const deltaX = dx;
        const deltaY = dy;
        partialUpdate = updateSpatialTangentHandle(
          selectedClip,
          dragState.nodeId,
          dragState.type === "tangentIn" ? "in" : "out",
          { x: deltaX, y: deltaY },
          true,
        );
      }

      // Live preview — skip undo epoch increment
      updateClip(selectedClip.id, { ...(partialUpdate as any), _skipEpochIncrement: true });
    },
    [dragState, selectedClip, scale, viewport.zoom, updateClip],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!dragState || !selectedClip) {
        setDragState(null);
        return;
      }
      e.stopPropagation();

      const effectiveScale = scale * viewport.zoom;
      const dx = (e.clientX - dragState.startX) / effectiveScale;
      const dy = (e.clientY - dragState.startY) / effectiveScale;

      let partialUpdate: Partial<Clip>;

      if (dragState.type === "anchor") {
        partialUpdate = updateSpatialKeyframePosition(selectedClip, dragState.nodeId, {
          x: dragState.startCanvasX + dx,
          y: dragState.startCanvasY + dy,
        });
      } else {
        partialUpdate = updateSpatialTangentHandle(
          selectedClip,
          dragState.nodeId,
          dragState.type === "tangentIn" ? "in" : "out",
          { x: dx, y: dy },
          true,
        );
      }

      execute(
        new TransformClipCommand(
          selectedClip.id,
          { visualKeyframes: selectedClip.visualKeyframes },
          { visualKeyframes: partialUpdate.visualKeyframes },
        ),
      );

      setDragState(null);
    },
    [dragState, selectedClip, scale, viewport.zoom, execute],
  );

  if (!selectedClip || nodes.length < 2) return null;

  return (
    <svg
      ref={svgRef}
      data-spatial-motion-path="true"
      data-interactive="true"
      style={{
        position: "absolute",
        inset: 0,
        width: displayWidth,
        height: displayHeight,
        pointerEvents: dragState ? "all" : "none",
        overflow: "visible",
        zIndex: 55,
      }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <defs>
        {/* Playhead glow filter */}
        <filter id="smp-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        {/* Node glow filter */}
        <filter id="smp-node-glow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* ── Path trajectory curve ── */}
      {(() => {
        // Build transformed SVG d string in overlay space
        const segments = nodes.slice(1).map((n1, i) => {
          const n0 = nodes[i];
          const { sx: x0, sy: y0 } = toSvg(n0.point.x, n0.point.y);
          const { sx: cx1, sy: cy1 } = toSvg(
            n0.point.x + (n0.tangentOut?.x ?? 0),
            n0.point.y + (n0.tangentOut?.y ?? 0),
          );
          const { sx: cx2, sy: cy2 } = toSvg(
            n1.point.x + (n1.tangentIn?.x ?? 0),
            n1.point.y + (n1.tangentIn?.y ?? 0),
          );
          const { sx: x1, sy: y1 } = toSvg(n1.point.x, n1.point.y);
          return `${i === 0 ? `M ${x0.toFixed(1)} ${y0.toFixed(1)}` : ""} C ${cx1.toFixed(1)} ${cy1.toFixed(1)}, ${cx2.toFixed(1)} ${cy2.toFixed(1)}, ${x1.toFixed(1)} ${y1.toFixed(1)}`;
        });

        return (
          <>
            {/* Shadow */}
            <path
              d={segments.join(" ")}
              stroke="rgba(0,0,0,0.4)"
              strokeWidth={3.5}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ pointerEvents: "none" }}
            />
            {/* Main dashed accent path */}
            <path
              d={segments.join(" ")}
              stroke="rgba(130,120,255,0.9)"
              strokeWidth={1.8}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="5 4"
              style={{ pointerEvents: "none" }}
            />
          </>
        );
      })()}

      {/* ── Frame interval tick dots ── */}
      {frameTicks.map((tick, i) => {
        const { sx, sy } = toSvg(tick.point.x, tick.point.y);
        // Skip if too close to a keyframe node anchor (will be drawn separately)
        const nearNode = nodes.some(
          (n) => Math.hypot(n.point.x - tick.point.x, n.point.y - tick.point.y) < 4,
        );
        if (nearNode) return null;
        return (
          <circle
            key={`tick-${i}`}
            cx={sx}
            cy={sy}
            r={1.5}
            fill="rgba(180,175,255,0.65)"
            style={{ pointerEvents: "none" }}
          />
        );
      })}

      {/* ── Tangent arms & handles for each node ── */}
      {nodes.map((node) => {
        const { sx, sy } = toSvg(node.point.x, node.point.y);

        const renderTangentArm = (
          tangent: { x: number; y: number } | undefined,
          handleType: "tangentIn" | "tangentOut",
          color: string,
        ) => {
          if (!tangent || (Math.abs(tangent.x) < 1 && Math.abs(tangent.y) < 1)) return null;
          const { sx: tx, sy: ty } = toSvg(
            node.point.x + tangent.x,
            node.point.y + tangent.y,
          );
          return (
            <g key={`arm-${node.id}-${handleType}`}>
              {/* Arm line */}
              <line
                x1={sx}
                y1={sy}
                x2={tx}
                y2={ty}
                stroke="rgba(255,255,255,0.3)"
                strokeWidth={0.8}
                style={{ pointerEvents: "none" }}
              />
              {/* Handle circle */}
              <circle
                data-motion-path-handle="true"
                cx={tx}
                cy={ty}
                r={5}
                fill={color}
                stroke="white"
                strokeWidth={1.2}
                style={{ pointerEvents: "all", cursor: "crosshair" }}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) =>
                  handlePointerDown(
                    e,
                    handleType,
                    node.id,
                    node.point.x + tangent.x,
                    node.point.y + tangent.y,
                  )
                }
              />
            </g>
          );
        };

        return (
          <g key={`node-${node.id}`}>
            {/* Tangent arms */}
            {renderTangentArm(node.tangentIn, "tangentIn", "rgba(80,200,255,0.85)")}
            {renderTangentArm(node.tangentOut, "tangentOut", "rgba(255,150,80,0.85)")}

            {/* Anchor diamond */}
            <g
              data-motion-path-handle="true"
              transform={`translate(${sx}, ${sy}) rotate(45)`}
              style={{ cursor: "move", pointerEvents: "all" }}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) =>
                handlePointerDown(e, "anchor", node.id, node.point.x, node.point.y)
              }
              filter="url(#smp-node-glow)"
            >
              {/* Shadow */}
              <rect
                x={-6}
                y={-6}
                width={12}
                height={12}
                fill="rgba(0,0,0,0.5)"
                stroke="none"
                rx={1}
              />
              {/* Diamond fill */}
              <rect
                x={-5}
                y={-5}
                width={10}
                height={10}
                fill="rgba(140,128,255,1)"
                stroke="rgba(255,255,255,0.9)"
                strokeWidth={1.2}
                rx={1}
              />
            </g>
          </g>
        );
      })}

      {/* ── Playhead cursor on path ── */}
      {playheadPos && (() => {
        const { sx, sy } = toSvg(playheadPos.x, playheadPos.y);
        return (
          <g filter="url(#smp-glow)" style={{ pointerEvents: "none" }}>
            <circle cx={sx} cy={sy} r={9} fill="rgba(130,120,255,0.25)" />
            <circle cx={sx} cy={sy} r={5.5} fill="rgba(130,120,255,0.5)" />
            <circle cx={sx} cy={sy} r={3} fill="white" />
          </g>
        );
      })()}
    </svg>
  );
};

/**
 * Clock-connected wrapper — prevents preview container re-renders from
 * playhead updates propagating up the tree.
 */
interface ConnectedSpatialMotionPathProps extends Omit<SpatialMotionPathProps, "currentTime"> {}

export const ConnectedSpatialMotionPath = React.memo(
  (props: ConnectedSpatialMotionPathProps) => {
    const clock = usePlaybackClock();
    return <SpatialMotionPath {...props} currentTime={clock.time} />;
  },
);

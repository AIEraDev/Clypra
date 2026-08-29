import React, { useState, useRef, useCallback, useMemo } from "react";
import { RotateCcw } from "lucide-react";
import type { Clip } from "@/types";
import {
  type CurvePoint,
  type CurvesAdjustment,
  DEFAULT_CURVES_ADJUSTMENT,
  DEFAULT_LINEAR_CURVE,
  evaluateMonotoneSpline,
} from "@/types/curves";

interface CurvesSectionProps {
  selectedClip: Clip;
  handleUpdate: (key: string, value: any) => void;
}

type CurveChannel = "master" | "red" | "green" | "blue";

const CHANNEL_CONFIG: Record<
  CurveChannel,
  { label: string; stroke: string; fill: string; activeTabClass: string }
> = {
  master: {
    label: "RGB",
    stroke: "#ffffff",
    fill: "rgba(255, 255, 255, 0.08)",
    activeTabClass: "bg-white/20 text-white font-semibold shadow-sm",
  },
  red: {
    label: "Red",
    stroke: "#ef4444",
    fill: "rgba(239, 68, 68, 0.12)",
    activeTabClass: "bg-red-500/25 text-red-400 font-semibold shadow-sm",
  },
  green: {
    label: "Green",
    stroke: "#22c55e",
    fill: "rgba(34, 197, 94, 0.12)",
    activeTabClass: "bg-emerald-500/25 text-emerald-400 font-semibold shadow-sm",
  },
  blue: {
    label: "Blue",
    stroke: "#3b82f6",
    fill: "rgba(59, 130, 246, 0.12)",
    activeTabClass: "bg-blue-500/25 text-blue-400 font-semibold shadow-sm",
  },
};

const SVG_WIDTH = 240;
const SVG_HEIGHT = 180;
const PADDING = 12;

const PLOT_WIDTH = SVG_WIDTH - PADDING * 2;
const PLOT_HEIGHT = SVG_HEIGHT - PADDING * 2;

function normToSvg(pt: CurvePoint): [number, number] {
  const x = PADDING + pt.x * PLOT_WIDTH;
  const y = PADDING + (1.0 - pt.y) * PLOT_HEIGHT;
  return [x, y];
}

function svgToNorm(svgX: number, svgY: number): CurvePoint {
  const x = Math.max(0, Math.min(1, (svgX - PADDING) / PLOT_WIDTH));
  const y = Math.max(0, Math.min(1, 1.0 - (svgY - PADDING) / PLOT_HEIGHT));
  return { x, y };
}

export const CurvesSection: React.FC<CurvesSectionProps> = ({
  selectedClip,
  handleUpdate,
}) => {
  const [activeChannel, setActiveChannel] = useState<CurveChannel>("master");
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const isDraggingRef = useRef(false);

  const adjustments = selectedClip.adjustments ?? {};
  const curves: CurvesAdjustment = useMemo(() => {
    const raw = (adjustments as any).curves ?? {};
    return {
      master: raw.master?.length >= 2 ? raw.master : DEFAULT_LINEAR_CURVE,
      red: raw.red?.length >= 2 ? raw.red : DEFAULT_LINEAR_CURVE,
      green: raw.green?.length >= 2 ? raw.green : DEFAULT_LINEAR_CURVE,
      blue: raw.blue?.length >= 2 ? raw.blue : DEFAULT_LINEAR_CURVE,
    };
  }, [adjustments]);

  const activePoints = curves[activeChannel];

  const updateChannelPoints = useCallback(
    (newPoints: CurvePoint[]) => {
      const sorted = [...newPoints].sort((a, b) => a.x - b.x);
      const nextCurves: CurvesAdjustment = {
        ...curves,
        [activeChannel]: sorted,
      };
      handleUpdate("adjustments", {
        ...adjustments,
        curves: nextCurves,
      });
    },
    [adjustments, curves, activeChannel, handleUpdate]
  );

  const handleResetChannel = () => {
    updateChannelPoints([...DEFAULT_LINEAR_CURVE]);
    setSelectedPointIndex(null);
  };

  const handleResetAll = () => {
    handleUpdate("adjustments", {
      ...adjustments,
      curves: DEFAULT_CURVES_ADJUSTMENT,
    });
    setSelectedPointIndex(null);
  };

  // Generate SVG path for the evaluated curve (64 steps)
  const curvePathData = useMemo(() => {
    const steps = 64;
    const pathCoords: string[] = [];
    for (let i = 0; i <= steps; i++) {
      const nx = i / steps;
      const ny = evaluateMonotoneSpline(activePoints, nx);
      const [sx, sy] = normToSvg({ x: nx, y: ny });
      pathCoords.push(`${i === 0 ? "M" : "L"} ${sx.toFixed(1)} ${sy.toFixed(1)}`);
    }
    const [lastX] = normToSvg({ x: 1, y: 0 });
    const [firstX, firstYBottom] = normToSvg({ x: 0, y: 0 });
    const strokeD = pathCoords.join(" ");
    const fillD = `${strokeD} L ${lastX} ${firstYBottom} L ${firstX} ${firstYBottom} Z`;
    return { strokeD, fillD };
  }, [activePoints]);

  const handlePointerDown = (index: number, e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedPointIndex(index);
    isDraggingRef.current = true;
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDraggingRef.current || selectedPointIndex === null) return;
    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const svgX = e.clientX - rect.left;
    const svgY = e.clientY - rect.top;
    const { x, y } = svgToNorm(svgX, svgY);

    const updated = [...activePoints];
    const n = updated.length;

    if (selectedPointIndex === 0) {
      // First endpoint: fixed X = 0, movable Y (black point lift)
      updated[0] = { x: 0.0, y };
    } else if (selectedPointIndex === n - 1) {
      // Last endpoint: fixed X = 1, movable Y (white point gain)
      updated[n - 1] = { x: 1.0, y };
    } else {
      // Intermediate point: bounded between previous and next X to preserve order
      const minX = updated[selectedPointIndex - 1].x + 0.01;
      const maxX = updated[selectedPointIndex + 1].x - 0.01;
      updated[selectedPointIndex] = {
        x: Math.max(minX, Math.min(maxX, x)),
        y,
      };
    }

    updateChannelPoints(updated);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      try {
        (e.target as Element).releasePointerCapture(e.pointerId);
      } catch {
        // Ignored
      }
    }
  };

  const handleSvgDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const svgX = e.clientX - rect.left;
    const svgY = e.clientY - rect.top;
    const { x, y } = svgToNorm(svgX, svgY);

    // Don't add if too close to existing points
    for (const pt of activePoints) {
      if (Math.abs(pt.x - x) < 0.04) return;
    }

    const updated = [...activePoints, { x, y }].sort((a, b) => a.x - b.x);
    updateChannelPoints(updated);
    const newIdx = updated.findIndex((p) => Math.abs(p.x - x) < 1e-4);
    setSelectedPointIndex(newIdx >= 0 ? newIdx : null);
  };

  const handleDeletePoint = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (index === 0 || index === activePoints.length - 1) return; // Cannot delete endpoints
    const updated = activePoints.filter((_, i) => i !== index);
    updateChannelPoints(updated);
    setSelectedPointIndex(null);
  };

  const config = CHANNEL_CONFIG[activeChannel];

  return (
    <div className="space-y-2 pt-2 border-t border-white/5">
      {/* Header */}
      <div className="flex items-center justify-between px-0.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
          Parametric Curves
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleResetChannel}
            title="Reset active channel"
            className="flex items-center gap-1 text-[9px] text-text-muted hover:text-text-primary transition-colors px-1 py-0.5 rounded hover:bg-white/5"
          >
            <RotateCcw className="w-2.5 h-2.5" />
            <span>Reset {config.label}</span>
          </button>
          <button
            type="button"
            onClick={handleResetAll}
            title="Reset all curves"
            className="text-[9px] text-text-muted hover:text-red-400 transition-colors px-1 py-0.5 rounded hover:bg-white/5"
          >
            Reset All
          </button>
        </div>
      </div>

      {/* Channel Tabs */}
      <div className="grid grid-cols-4 gap-1 p-0.5 bg-black/40 rounded-lg border border-white/5">
        {(["master", "red", "green", "blue"] as CurveChannel[]).map((ch) => (
          <button
            key={ch}
            type="button"
            onClick={() => {
              setActiveChannel(ch);
              setSelectedPointIndex(null);
            }}
            className={`py-1 text-[10px] rounded transition-all flex items-center justify-center gap-1 ${
              activeChannel === ch
                ? CHANNEL_CONFIG[ch].activeTabClass
                : "text-text-muted hover:text-text-primary hover:bg-white/5"
            }`}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: CHANNEL_CONFIG[ch].stroke }}
            />
            <span>{CHANNEL_CONFIG[ch].label}</span>
          </button>
        ))}
      </div>

      {/* SVG Interactive Canvas */}
      <div className="relative flex justify-center bg-black/50 p-1.5 rounded-lg border border-white/5 shadow-inner">
        <svg
          ref={svgRef}
          width={SVG_WIDTH}
          height={SVG_HEIGHT}
          className="cursor-crosshair select-none touch-none"
          onDoubleClick={handleSvgDoubleClick}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {/* Grid lines */}
          <line
            x1={PADDING}
            y1={PADDING + PLOT_HEIGHT * 0.25}
            x2={PADDING + PLOT_WIDTH}
            y2={PADDING + PLOT_HEIGHT * 0.25}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="1"
          />
          <line
            x1={PADDING}
            y1={PADDING + PLOT_HEIGHT * 0.5}
            x2={PADDING + PLOT_WIDTH}
            y2={PADDING + PLOT_HEIGHT * 0.5}
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="1"
          />
          <line
            x1={PADDING}
            y1={PADDING + PLOT_HEIGHT * 0.75}
            x2={PADDING + PLOT_WIDTH}
            y2={PADDING + PLOT_HEIGHT * 0.75}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="1"
          />
          <line
            x1={PADDING + PLOT_WIDTH * 0.25}
            y1={PADDING}
            x2={PADDING + PLOT_WIDTH * 0.25}
            y2={PADDING + PLOT_HEIGHT}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="1"
          />
          <line
            x1={PADDING + PLOT_WIDTH * 0.5}
            y1={PADDING}
            x2={PADDING + PLOT_WIDTH * 0.5}
            y2={PADDING + PLOT_HEIGHT}
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="1"
          />
          <line
            x1={PADDING + PLOT_WIDTH * 0.75}
            y1={PADDING}
            x2={PADDING + PLOT_WIDTH * 0.75}
            y2={PADDING + PLOT_HEIGHT}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="1"
          />

          {/* Diagonal Identity Reference Line */}
          <line
            x1={PADDING}
            y1={PADDING + PLOT_HEIGHT}
            x2={PADDING + PLOT_WIDTH}
            y2={PADDING}
            stroke="rgba(255,255,255,0.12)"
            strokeWidth="1"
            strokeDasharray="3 3"
          />

          {/* Area fill */}
          <path d={curvePathData.fillD} fill={config.fill} />

          {/* Spline Path */}
          <path
            d={curvePathData.strokeD}
            fill="none"
            stroke={config.stroke}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Control points */}
          {activePoints.map((pt, idx) => {
            const [cx, cy] = normToSvg(pt);
            const isSelected = selectedPointIndex === idx;
            return (
              <g key={idx}>
                {isSelected && (
                  <circle
                    cx={cx}
                    cy={cy}
                    r="8"
                    fill="none"
                    stroke={config.stroke}
                    strokeWidth="1.5"
                    strokeOpacity="0.6"
                  />
                )}
                <circle
                  cx={cx}
                  cy={cy}
                  r="5"
                  fill={config.stroke}
                  stroke="#000000"
                  strokeWidth="1.5"
                  className="cursor-grab active:cursor-grabbing hover:scale-125 transition-transform"
                  onPointerDown={(e) => handlePointerDown(idx, e)}
                  onContextMenu={(e) => handleDeletePoint(idx, e)}
                  onDoubleClick={(e) => handleDeletePoint(idx, e)}
                />
              </g>
            );
          })}
        </svg>
      </div>

      <div className="flex items-center justify-between px-1 text-[9px] text-text-muted">
        <span>Double-click grid to add point</span>
        <span>Right-click point to delete</span>
      </div>
    </div>
  );
};

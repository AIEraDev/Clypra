import React, { useState, useRef } from "react";
import { Lock } from "lucide-react";
import type { Gap } from "@/types/gap";
import { timeToPixel } from "@/lib/timeline/timelineViewport";

export interface GapIndicatorProps {
  gap: Gap;
  pixelsPerSecond: number;
  selected?: boolean;
  locked?: boolean;
  onContextMenu?: (params: {
    gap: Gap;
    locked: boolean;
    position: { x: number; y: number };
  }) => void;
}

/**
 * GapIndicator - Visual representation of a gap on the timeline
 *
 * Features:
 * - Non-selectable: left-clicks bubble through to track/timeline to seek playhead
 * - Hover duration badge in decimal seconds
 * - Right-click triggers centralized timeline Gap Context Menu
 * - Protected indicator badge
 */
export const GapIndicator: React.FC<GapIndicatorProps> = ({
  gap,
  pixelsPerSecond,
  locked = false,
  onContextMenu,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const gapRef = useRef<HTMLDivElement>(null);

  // Calculate position and dimensions
  const left = timeToPixel(gap.startTime, pixelsPerSecond);
  const right = timeToPixel(gap.startTime + gap.duration, pixelsPerSecond);
  const width = right - left;

  // Format duration for display in decimal seconds (e.g. 38.3s, 5s)
  const formatDuration = (seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds < 0) return "0s";
    const rounded = Number(seconds.toFixed(2));
    return `${rounded}s`;
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu?.({
      gap,
      locked,
      position: { x: e.clientX, y: e.clientY },
    });
  };

  return (
    <div
      ref={gapRef}
      data-gap-id={gap.id}
      className={`
        absolute top-0 h-full select-none
        transition-colors
        ${isHovered ? "z-5" : "z-0"}
      `}
      style={{
        left: `${left}px`,
        width: `${width}px`,
      }}
      onContextMenu={handleContextMenu}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Subtle gap background with diagonal stripes on hover */}
      <div
        className={`
          w-full h-full border border-dashed transition-colors
          ${
            isHovered
              ? "bg-surface-hover/30 border-border-soft"
              : "bg-surface-app/15 border-border/30"
          }
        `}
        style={{
          backgroundImage: isHovered
            ? `repeating-linear-gradient(
                45deg,
                transparent,
                transparent 4px,
                rgba(100, 116, 139, 0.08) 4px,
                rgba(100, 116, 139, 0.08) 8px
              )`
            : undefined,
        }}
      >
        {/* Protected indicator */}
        {gap.protected && (
          <div className="absolute top-1 left-1 text-yellow-400/80 pointer-events-none">
            <Lock size={12} />
          </div>
        )}

        {/* Duration label badge on hover */}
        {isHovered && width > 36 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="px-2 py-0.5 bg-black/75 rounded text-[11px] text-white/90 font-mono shadow-sm backdrop-blur-xs border border-white/10">
              {formatDuration(gap.duration)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};



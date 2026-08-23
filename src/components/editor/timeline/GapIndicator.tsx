import React, { useState, useRef } from "react";
import { Lock, Trash2 } from "lucide-react";
import { useUIStore } from "@/store/uiStore";
import { useProjectStore } from "@/store/projectStore";
import { GapManager } from "@/lib/timeline/gapManager";
import type { Gap } from "@/types/gap";
import { timeToPixel } from "@/lib/timeline/timelineViewport";

interface GapIndicatorProps {
  gap: Gap;
  pixelsPerSecond: number;
  selected?: boolean;
  locked?: boolean;
}

/**
 * GapIndicator - Visual representation of a gap on the timeline
 *
 * Features:
 * - Click to select
 * - Double-click to remove (if not protected)
 * - Right-click for context menu
 * - Resize handles (future)
 * - Shows duration on hover
 * - Visual indicator for protected gaps
 */
export const GapIndicator: React.FC<GapIndicatorProps> = ({ gap, pixelsPerSecond, selected = false, locked = false }) => {
  const { selectGap } = useUIStore();
  const [isHovered, setIsHovered] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
  const gapRef = useRef<HTMLDivElement>(null);

  // Calculate position and dimensions (derived from right edge to align with clip boundaries)
  const left = timeToPixel(gap.startTime, pixelsPerSecond);
  const right = timeToPixel(gap.startTime + gap.duration, pixelsPerSecond);
  const width = right - left;



  const frameRate = useProjectStore((s) => s.project?.frameRate ?? 30);

  // Format duration for display
  const formatDuration = (seconds: number): string => {
    const safeFps = frameRate > 0 ? frameRate : 30;
    const totalFrames = Math.round(seconds * safeFps);
    const totalSecs = Math.floor(totalFrames / safeFps);
    const frames = totalFrames % safeFps;
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;

    if (mins > 0) {
      return `${mins}:${secs.toString().padStart(2, "0")}:${frames.toString().padStart(2, "0")}`;
    }
    return `${secs}:${frames.toString().padStart(2, "0")}`;
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!locked) {
      selectGap(gap.id);
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!locked && !gap.protected) {
      // Double-click to remove gap (ripple delete)
      GapManager.removeGap(gap.id);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!locked) {
      setContextMenuPos({ x: e.clientX, y: e.clientY });
      setShowContextMenu(true);
    }
  };

  const handleRemove = () => {
    GapManager.removeGap(gap.id);
    setShowContextMenu(false);
  };

  const handleToggleProtection = () => {
    GapManager.toggleProtection(gap.id);
    setShowContextMenu(false);
  };

  // Close context menu when clicking outside
  React.useEffect(() => {
    if (!showContextMenu) return;

    const handleClickOutside = () => setShowContextMenu(false);
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [showContextMenu]);

  return (
    <>
      <div
        ref={gapRef}
        data-gap-id={gap.id}
        className={`
          absolute top-0 h-full
          transition-colors cursor-pointer
          ${selected ? "ring-2 ring-accent ring-inset z-10" : ""}
          ${isHovered ? "z-5" : "z-0"}
        `}
        style={{
          left: `${left}px`,
          width: `${width}px`,
        }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Gap background with diagonal stripes */}
        <div
          className={`
            w-full h-full
            border border-dashed
            ${selected ? "bg-accent/20 border-accent" : isHovered ? "bg-slate-700/40 border-slate-500" : "bg-slate-800/30 border-slate-600"}
          `}
          style={{
            backgroundImage:
              selected || isHovered
                ? `repeating-linear-gradient(
                  45deg,
                  transparent,
                  transparent 4px,
                  ${selected ? "rgba(59, 130, 246, 0.1)" : "rgba(100, 116, 139, 0.1)"} 4px,
                  ${selected ? "rgba(59, 130, 246, 0.1)" : "rgba(100, 116, 139, 0.1)"} 8px
                )`
                : undefined,
          }}
        >
          {/* Protected indicator */}
          {gap.protected && (
            <div className="absolute top-1 left-1 text-yellow-400 opacity-70">
              <Lock size={12} />
            </div>
          )}

          {/* Duration label (show on hover or when selected) */}
          {(isHovered || selected) && width > 40 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="px-2 py-0.5 bg-black/60 rounded text-xs text-white font-mono">{formatDuration(gap.duration)}</div>
            </div>
          )}

          {/* Gap type indicator (only for manual/protected gaps, small clips) */}
          {gap.type !== "auto" && width <= 40 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-1 h-1 bg-accent rounded-full" />
            </div>
          )}
        </div>
      </div>

      {/* Context Menu */}
      {showContextMenu && (
        <div
          className="fixed z-9999 bg-surface-raised border border-border rounded-md shadow-lg py-1 min-w-[160px]"
          style={{
            left: `${contextMenuPos.x}px`,
            top: `${contextMenuPos.y}px`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button className="w-full px-3 py-1.5 text-left text-sm hover:bg-surface-hover flex items-center gap-2" onClick={handleRemove} disabled={gap.protected}>
            <Trash2 size={14} />
            <span>Remove Gap</span>
            <span className="ml-auto text-xs text-muted">,</span>
          </button>

          <button className="w-full px-3 py-1.5 text-left text-sm hover:bg-surface-hover flex items-center gap-2" onClick={handleToggleProtection}>
            <Lock size={14} />
            <span>{gap.protected ? "Unprotect" : "Protect"} Gap</span>
          </button>

          <div className="border-t border-border my-1" />

          <div className="px-3 py-1.5 text-xs text-muted space-y-0.5">
            <div>Duration: {formatDuration(gap.duration)}</div>
            <div>Start: {formatDuration(gap.startTime)}</div>
            <div>Type: {gap.type}</div>
            {gap.source !== "unknown" && <div>Source: {gap.source.replace("-", " ")}</div>}
          </div>
        </div>
      )}
    </>
  );
};

/**
 * Clip Component for Timeline Engine v1
 * Renders individual clips on the timeline with visual layout, trim handles, and selection
 */

import { useMemo, memo } from "react";
import type { Clip as ClipType } from "../types/core";
import { CoordinateSystem } from "../utils/coordinateSystem";
import { formatTime } from "../utils/timeFormat";
import { COLORS } from "../../../constants/colors";
import { Waveform } from "./Waveform";
import { useWaveform } from "../hooks/useWaveform";
import { useFilmstrip } from "../hooks/useFilmstrip";
import { useClipDrag } from "../hooks/useClipDrag";
import { useClipTrim } from "../hooks/useClipTrim";
import { useTimelineStore } from "../store/timelineStore";

interface ClipProps {
  clip: ClipType;
  isSelected: boolean;
  pxPerSec: number;
  onSelect: (id: string, multi: boolean) => void;
}

/**
 * Get track-specific styling colors based on clip type
 */
function getClipColors(type: ClipType["type"]): { background: string; border: string } {
  switch (type) {
    case "video":
      return {
        background: "linear-gradient(180deg, #0d9488 0%, #0f766e 100%)",
        border: "#14b8a6",
      };
    case "audio":
      return {
        background: "linear-gradient(180deg, #10b981 0%, #059669 100%)",
        border: "#34d399",
      };
    case "text":
      return {
        background: "linear-gradient(180deg, #ea580c 0%, #c2410c 100%)",
        border: "#f97316",
      };
    default:
      return {
        background: "linear-gradient(180deg, #6366f1 0%, #4f46e5 100%)",
        border: "#818cf8",
      };
  }
}

/**
 * Clip component with memoization for performance
 */
export const Clip = memo(function Clip({ clip, isSelected, pxPerSec, onSelect }: ClipProps) {
  const coords = useMemo(() => new CoordinateSystem(pxPerSec), [pxPerSec]);
  const dragState = useTimelineStore((state) => state.dragState);

  // Calculate clip position and width with memoization
  const { x: baseX, width } = useMemo(
    () => ({
      x: coords.timeToPixels(clip.startTime),
    }),
    [coords, clip.startTime, clip.duration],
  );

  let x = baseX;

  const isDragging = dragState && dragState.clipIds.includes(clip.id);
  if (isDragging && dragState) {
    const offsetPixels = coords.timeToPixels(dragState.currentOffset);
    x += offsetPixels;
  }

  const colors = getClipColors(clip.type);

  const hasAudio = clip.type === "audio" || clip.type === "video";
  const { peaks, loading: waveformLoading, error: waveformError } = useWaveform(clip.sourceMediaPath, hasAudio);

  const hasVideo = clip.type === "video";
  const { stripUrl, loading: filmstripLoading } = useFilmstrip(hasVideo ? clip.sourceMediaPath : null, clip.duration);

  const { handlePointerDown: handleDragStart } = useClipDrag({ clipId: clip.id, coords });

  const { handlePointerDown: handleTrimStartDown } = useClipTrim({ clipId: clip.id, edge: "start", coords });
  const { handlePointerDown: handleTrimEndDown } = useClipTrim({ clipId: clip.id, edge: "end", coords });

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;

    // Check for modifier keys
    const isCtrl = e.ctrlKey || e.metaKey; // Ctrl on Windows/Linux, Cmd on Mac
    const isShift = e.shiftKey;

    // Handle selection based on modifier keys
    if (isShift) {
      const store = useTimelineStore.getState();
      store.selectRange(clip.id);
      // Don't initiate drag for shift+click
      return;
    } else if (isCtrl) {
      onSelect(clip.id, true);
      // Don't initiate drag for ctrl+click
      return;
    } else {
      onSelect(clip.id, false);
    }

    // Initiate drag
    handleDragStart(e);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Enter or Space to select
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(clip.id, e.ctrlKey || e.metaKey);
    }
    // Arrow keys for navigation
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      // Focus management will be handled by the parent component
      const direction = e.key === "ArrowLeft" ? "left" : e.key === "ArrowRight" ? "right" : e.key === "ArrowUp" ? "up" : "down";
      // Dispatch custom event for parent to handle focus navigation
      const event = new CustomEvent("clipNavigate", { detail: { clipId: clip.id, direction }, bubbles: true });
      e.currentTarget.dispatchEvent(event);
    }
  };

  return (
    <div
      className="absolute top-1 flex cursor-grab items-center overflow-hidden rounded-sm shadow-md"
      style={{
        left: x,
        width,
        height: "calc(100% - 8px)",
        background: colors.background,
        outline: isSelected ? `2px solid ${COLORS.ACCENT}` : "none",
        outlineOffset: isSelected ? "1px" : "0",
        opacity: isDragging ? 0.7 : 1,
        cursor: isDragging ? "grabbing" : "grab",
      }}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`${clip.type} clip: ${clip.name}, duration ${formatTime(clip.duration)}, starts at ${formatTime(clip.startTime)}`}
      aria-selected={isSelected}
      aria-grabbed={isDragging ? "true" : "false"}
    >
      {hasVideo && (
        <div className="absolute inset-0 pointer-events-none" role="img" aria-label={filmstripLoading ? "Loading video preview" : stripUrl ? `Video preview for ${clip.name}` : "Video preview unavailable"}>
          {filmstripLoading && (
            <div className="flex items-center justify-center h-full">
              <div className="text-[10px] text-white/60">Loading filmstrip...</div>
            </div>
          )}
          {!filmstripLoading && !stripUrl && (
            <div className="flex items-center justify-center h-full">
              <div className="text-[10px] text-white/40">No preview</div>
            </div>
          )}
          {!filmstripLoading && stripUrl && (
            <div
              className="w-full h-full bg-cover bg-center opacity-40"
              style={{
                backgroundImage: `url(${stripUrl})`,
                backgroundSize: "100% 100%",
                backgroundRepeat: "no-repeat",
              }}
            />
          )}
        </div>
      )}

      {hasAudio && (
        <div className="absolute inset-0 pointer-events-none" role="img" aria-label={waveformLoading ? "Loading audio waveform" : waveformError ? "Audio waveform unavailable" : `Audio waveform for ${clip.name}`}>
          {waveformLoading && (
            <div className="flex items-center justify-center h-full">
              <div className="text-[10px] text-white/60">Loading waveform...</div>
            </div>
          )}
          {waveformError && (
            <div className="flex items-center justify-center h-full">
              <div className="text-[10px] text-white/40">No waveform</div>
            </div>
          )}
          {!waveformLoading && !waveformError && peaks && <Waveform peaks={peaks} width={width} height={60} className="opacity-60" />}
        </div>
      )}

      {/* Clip content */}
      <div className="relative flex min-w-0 flex-1 flex-col justify-between px-2 py-1 pointer-events-none">
        <div className="truncate text-[11px] font-medium text-white/95">{clip.name}</div>

        <div className="text-[10px] font-mono text-white/80 tabular-nums">{formatTime(clip.duration)}</div>
      </div>

      <div
        className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/20 transition-colors"
        style={{
          background: "linear-gradient(90deg, rgba(255,255,255,0.15) 0%, transparent 100%)",
        }}
        onPointerDown={handleTrimStartDown}
        role="slider"
        aria-label={`Trim start of ${clip.name}`}
        aria-valuemin={0}
        aria-valuemax={clip.startTime + clip.duration}
        aria-valuenow={clip.startTime}
        aria-valuetext={`Start time: ${formatTime(clip.startTime)}`}
        tabIndex={0}
      />

      <div
        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/20 transition-colors"
        style={{
          background: "linear-gradient(270deg, rgba(255,255,255,0.15) 0%, transparent 100%)",
        }}
        onPointerDown={handleTrimEndDown}
        role="slider"
        aria-label={`Trim end of ${clip.name}`}
        aria-valuemin={clip.startTime}
        aria-valuemax={clip.startTime + clip.duration}
        aria-valuenow={clip.startTime + clip.duration}
        aria-valuetext={`End time: ${formatTime(clip.startTime + clip.duration)}`}
        tabIndex={0}
      />
    </div>
  );
});

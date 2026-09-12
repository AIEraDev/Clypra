import React from "react";
import { formatEditorTimecode } from "@/lib/media/projectThumbnail";
import { Play, RotateCcw, ChevronLeft, ChevronRight } from "lucide-react";

interface ThumbnailFrameScrubberProps {
  durationSeconds: number;
  currentTimestampSeconds: number;
  onSeek: (seconds: number) => void;
  onSyncPlayhead: () => void;
  currentPlayheadSeconds?: number;
  isRendering?: boolean;
}

export const ThumbnailFrameScrubber: React.FC<ThumbnailFrameScrubberProps> = ({
  durationSeconds,
  currentTimestampSeconds,
  onSeek,
  onSyncPlayhead,
  currentPlayheadSeconds = 0,
  isRendering = false,
}) => {
  const maxDuration = Math.max(1, durationSeconds || 10);
  const clampedTime = Math.min(maxDuration, Math.max(0, currentTimestampSeconds));

  return (
    <div className="flex flex-col gap-2 p-3 bg-neutral-900/60 rounded-xl border border-neutral-800">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Source Frame
        </label>
        <div className="flex items-center gap-2">
          {isRendering && (
            <span className="text-[11px] text-amber-400 animate-pulse flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              Rendering...
            </span>
          )}
          <span className="text-xs font-mono font-bold text-neutral-200 bg-neutral-800 px-2 py-0.5 rounded border border-neutral-700">
            {formatEditorTimecode(clampedTime)} ({clampedTime.toFixed(2)}s)
          </span>
        </div>
      </div>

      {/* Range Scrubber Slider */}
      <div className="relative flex items-center py-1">
        <input
          type="range"
          min={0}
          max={maxDuration}
          step={0.05}
          value={clampedTime}
          onChange={(e) => onSeek(parseFloat(e.target.value))}
          className="w-full h-2 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-sky-500 focus:outline-none"
        />
      </div>

      {/* Frame Stepping and Sync Controls */}
      <div className="flex items-center justify-between gap-1.5 pt-1">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onSeek(Math.max(0, clampedTime - 1.0))}
            className="px-2 py-1 text-xs rounded bg-neutral-800 text-neutral-300 hover:bg-neutral-700 border border-neutral-700 flex items-center gap-0.5"
            title="Step backward 1.0s"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            1s
          </button>
          <button
            type="button"
            onClick={() => onSeek(Math.max(0, clampedTime - 0.1))}
            className="px-2 py-1 text-xs rounded bg-neutral-800 text-neutral-300 hover:bg-neutral-700 border border-neutral-700"
            title="Step backward 1 frame (0.1s)"
          >
            -0.1s
          </button>
          <button
            type="button"
            onClick={() => onSeek(Math.min(maxDuration, clampedTime + 0.1))}
            className="px-2 py-1 text-xs rounded bg-neutral-800 text-neutral-300 hover:bg-neutral-700 border border-neutral-700"
            title="Step forward 1 frame (0.1s)"
          >
            +0.1s
          </button>
          <button
            type="button"
            onClick={() => onSeek(Math.min(maxDuration, clampedTime + 1.0))}
            className="px-2 py-1 text-xs rounded bg-neutral-800 text-neutral-300 hover:bg-neutral-700 border border-neutral-700 flex items-center gap-0.5"
            title="Step forward 1.0s"
          >
            1s
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <button
          type="button"
          onClick={onSyncPlayhead}
          className="px-2.5 py-1 text-xs rounded bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 border border-sky-500/30 flex items-center gap-1 font-medium transition-colors"
          title={`Sync to editor playhead @ ${formatEditorTimecode(currentPlayheadSeconds)}`}
        >
          <Play className="w-3 h-3" />
          Playhead ({formatEditorTimecode(currentPlayheadSeconds)})
        </button>
      </div>
    </div>
  );
};

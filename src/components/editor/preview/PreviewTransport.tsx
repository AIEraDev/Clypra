import React, { useRef, useCallback, useEffect, useState } from "react";
import { Play, Pause, SkipBack, SkipForward } from "lucide-react";
import { parseSmpteTimecode } from "@/lib/timecode";
import { EditorFeatureTelemetry } from "@/services/editorFeatureTelemetry";

interface PreviewTransportProps {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  onPlayPause: () => void;
  onSeek: (time: number) => void;
  formatTime: (seconds: number) => string;
  frameRate?: number;

  // Scrub callbacks
  onScrubStart?: (time: number) => void;
  onScrubUpdate?: (time: number) => void;
  onScrubEnd?: (time: number) => void;

  // Source-specific: in/out range overlay on scrub bar
  inPoint?: number | null;
  outPoint?: number | null;

  // Program-specific: frame-step buttons
  onStepBack?: () => void;
  onStepForward?: () => void;

  // Slot for left-side extras (speed menu, etc.)
  leftActions?: React.ReactNode;

  // Slot for right-side extras (IN/OUT/Add, aspect/volume, etc.)
  rightActions?: React.ReactNode;

  // Disable all controls (for empty timeline)
  disabled?: boolean;
}

export const PreviewTransport: React.FC<PreviewTransportProps> = ({
  currentTime,
  duration,
  isPlaying,
  onPlayPause,
  onSeek,
  onScrubStart,
  onScrubUpdate,
  onScrubEnd,
  formatTime,
  inPoint,
  outPoint,
  onStepBack,
  onStepForward,
  leftActions,
  rightActions,
  disabled = false,
  frameRate = 30,
}) => {
  const scrubRef = useRef<HTMLDivElement>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [isEditingTimecode, setIsEditingTimecode] = useState(false);
  const [timecodeInputValue, setTimecodeInputValue] = useState("");
  const timecodeInputRef = useRef<HTMLInputElement>(null);

  const commitTimecodeJump = useCallback(() => {
    const trimmed = timecodeInputValue.trim();
    if (trimmed) {
      const t0 = performance.now();
      const parsed = parseSmpteTimecode(trimmed, currentTime, frameRate);
      if (parsed.success && parsed.seconds !== undefined) {
        const clamped = Math.max(0, Math.min(duration > 0 ? duration : Infinity, parsed.seconds));
        onSeek(clamped);
        EditorFeatureTelemetry.recordTimecodeJump({
          rawInput: trimmed,
          fromTime: currentTime,
          toTime: clamped,
          deltaSeconds: clamped - currentTime,
          isRelative: parsed.isRelative ?? false,
          frameRate,
          dropFrame: parsed.dropFrame ?? false,
          durationMs: performance.now() - t0,
          success: true,
        });
      } else {
        EditorFeatureTelemetry.recordTimecodeJump({
          rawInput: trimmed,
          fromTime: currentTime,
          toTime: currentTime,
          deltaSeconds: 0,
          isRelative: false,
          frameRate,
          dropFrame: false,
          durationMs: performance.now() - t0,
          success: false,
          error: parsed.error || "Failed to parse timecode",
        });
      }
    }
    setIsEditingTimecode(false);
  }, [timecodeInputValue, currentTime, frameRate, duration, onSeek]);

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  const seekToPosition = useCallback(
    (clientX: number, phase: "start" | "update" | "end" = "update") => {
      if (!scrubRef.current || duration <= 0 || disabled) return;
      const rect = scrubRef.current.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const targetTime = ratio * duration;
      if (phase === "start") {
        if (onScrubStart) onScrubStart(targetTime);
        else onSeek(targetTime);
      } else if (phase === "update") {
        if (onScrubUpdate) onScrubUpdate(targetTime);
        else onSeek(targetTime);
      } else if (phase === "end") {
        if (onScrubEnd) onScrubEnd(targetTime);
        else onSeek(targetTime);
      }
    },
    [duration, onSeek, onScrubStart, onScrubUpdate, onScrubEnd, disabled],
  );

  useEffect(() => {
    if (!isScrubbing) return;
    const handleMove = (e: MouseEvent) => seekToPosition(e.clientX, "update");
    const handleUp = (e: MouseEvent) => {
      setIsScrubbing(false);
      seekToPosition(e.clientX, "end");
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [isScrubbing, seekToPosition]);

  return (
    <div className="@container flex flex-col w-full shrink-0 bg-surface/30 border-t border-white/5 select-none relative z-30">
      {/* ── Scrub Bar (padded, rounded pill track) ────────────────────────── */}
      <div className="px-3 pt-1.5 pb-0.5">
        <div
          ref={scrubRef}
          className={`h-3 w-full group relative flex items-center shrink-0 ${
            disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"
          }`}
          onMouseDown={(e) => {
            if (disabled) return;
            setIsScrubbing(true);
            seekToPosition(e.clientX, "start");
          }}
        >
          {/* Track background */}
          <div className="w-full h-1 group-hover:h-1.5 rounded-full bg-white/10 group-hover:bg-white/15 transition-all overflow-hidden relative">
            {/* In/Out range */}
            {inPoint != null && outPoint != null && duration > 0 && (
              <div
                className="absolute top-0 bottom-0 bg-accent/20"
                style={{
                  left: `${(inPoint / duration) * 100}%`,
                  width: `${((outPoint - inPoint) / duration) * 100}%`,
                }}
              />
            )}
            {/* Progress fill */}
            <div
              className={`absolute top-0 bottom-0 left-0 transition-all duration-100 ease-linear rounded-full ${
                disabled ? "bg-text-muted/30" : "bg-accent"
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          {/* Playhead dot */}
          {!disabled && (
            <div
              className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-accent border border-white shadow-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
              style={{ left: `calc(${progressPct}% - 5px)` }}
            />
          )}
        </div>
      </div>

      {/* ── Bottom Controls ────────────────────────────────────────── */}
      <div
        className={`flex items-center justify-between h-10 px-3 shrink-0 gap-2 ${
          disabled ? "opacity-40" : ""
        }`}
      >
        {/* Left Column: Timecode + optional left actions */}
        <div className="flex items-center gap-2 min-w-0 shrink">
          <div
            className="flex items-baseline gap-1 select-none shrink-0 font-mono tracking-tight"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {isEditingTimecode ? (
              <input
                ref={timecodeInputRef}
                type="text"
                autoFocus
                value={timecodeInputValue}
                onChange={(e) => setTimecodeInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitTimecodeJump();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setIsEditingTimecode(false);
                  }
                }}
                onBlur={commitTimecodeJump}
                placeholder={formatTime(currentTime)}
                className="w-20 px-1 py-0.5 text-[11px] font-semibold font-mono bg-surface-raised border border-accent rounded text-text-primary outline-none"
              />
            ) : (
              <span
                onClick={() => {
                  if (!disabled) {
                    setTimecodeInputValue("");
                    setIsEditingTimecode(true);
                  }
                }}
                className={`text-[11px] font-semibold ${
                  disabled
                    ? "text-text-muted cursor-not-allowed"
                    : "text-accent cursor-pointer hover:underline"
                }`}
                title={disabled ? undefined : "Click to jump to timecode (e.g. +10, -1:00, 01:23:00)"}
              >
                {formatTime(currentTime)}
              </span>
            )}
            <span className="text-[10px] text-text-muted/40 hidden @[300px]:inline">
              /
            </span>
            <span className="text-[11px] text-text-muted hidden @[300px]:inline">
              {formatTime(duration)}
            </span>
          </div>
          {!disabled && leftActions && (
            <div className="hidden @[460px]:block shrink-0">{leftActions}</div>
          )}
        </div>

        {/* Center Column: Play / Step controls */}
        <div className="flex items-center justify-center gap-0.5 shrink-0">
          {onStepBack && (
            <button
              onClick={disabled ? undefined : onStepBack}
              disabled={disabled}
              className={`hidden @[380px]:flex w-6 h-6 items-center justify-center rounded transition-colors cursor-pointer ${
                disabled
                  ? "cursor-not-allowed text-text-muted/50"
                  : "hover:bg-white/6 text-text-muted hover:text-text-primary"
              }`}
              title={disabled ? "No clips on timeline" : "Previous frame"}
              aria-label="Previous frame"
            >
              <SkipBack className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={disabled ? undefined : onPlayPause}
            disabled={disabled}
            className={`w-7 h-7 flex items-center justify-center rounded-full transition-all cursor-pointer mx-0.5 active:scale-95 ${
              disabled
                ? "cursor-not-allowed text-text-muted/50"
                : "hover:bg-white/10 text-text-primary hover:shadow-sm"
            }`}
            title={disabled ? "No clips on timeline" : isPlaying ? "Pause (Space)" : "Play (Space)"}
            aria-label={isPlaying ? "Pause playback" : "Play playback"}
          >
            {isPlaying ? (
              <Pause className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4 ml-0.5" />
            )}
          </button>
          {onStepForward && (
            <button
              onClick={disabled ? undefined : onStepForward}
              disabled={disabled}
              className={`hidden @[380px]:flex w-6 h-6 items-center justify-center rounded transition-colors cursor-pointer ${
                disabled
                  ? "cursor-not-allowed text-text-muted/50"
                  : "hover:bg-white/6 text-text-muted hover:text-text-primary"
              }`}
              title={disabled ? "No clips on timeline" : "Next frame"}
              aria-label="Next frame"
            >
              <SkipForward className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Right Column: Actions (Aspect / Fit / Volume) */}
        {rightActions && (
          <div className="flex items-center gap-1.5 shrink-0 justify-end min-w-0">
            {rightActions}
          </div>
        )}
      </div>
    </div>
  );
};

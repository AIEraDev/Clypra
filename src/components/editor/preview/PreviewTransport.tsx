import React, { useRef, useCallback, useEffect, useState } from "react";
import { Play, Pause, SkipBack, SkipForward } from "lucide-react";
import { t } from "@/i18n";

interface PreviewTransportProps {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  onPlayPause: () => void;
  onSeek: (time: number) => void;
  formatTime: (seconds: number) => string;

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

export const PreviewTransport: React.FC<PreviewTransportProps> = ({ currentTime, duration, isPlaying, onPlayPause, onSeek, formatTime, inPoint, outPoint, onStepBack, onStepForward, leftActions, rightActions, disabled = false }) => {
  const scrubRef = useRef<HTMLDivElement>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  const seekToPosition = useCallback(
    (clientX: number) => {
      if (!scrubRef.current || duration <= 0 || disabled) return;
      const rect = scrubRef.current.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      onSeek(ratio * duration);
    },
    [duration, onSeek, disabled],
  );

  useEffect(() => {
    if (!isScrubbing) return;
    const handleMove = (e: MouseEvent) => seekToPosition(e.clientX);
    const handleUp = () => setIsScrubbing(false);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [isScrubbing, seekToPosition]);

  return (
    <>
      {/* ── Scrub Bar (thin, edge-to-edge) ────────────────────────── */}
      <div
        ref={scrubRef}
        className={`h-[5px] w-full group relative shrink-0 ${disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
        onMouseDown={(e) => {
          if (disabled) return;
          setIsScrubbing(true);
          seekToPosition(e.clientX);
        }}
      >
        {/* Track bg */}
        <div className="absolute inset-0 bg-surface" />
        {/* In/Out range */}
        {inPoint != null && outPoint != null && duration > 0 && (
          <div
            className="absolute top-0 bottom-0 bg-accent/15"
            style={{
              left: `${(inPoint / duration) * 100}%`,
              width: `${((outPoint - inPoint) / duration) * 100}%`,
            }}
          />
        )}
        {/* Progress fill */}
        <div className={`absolute top-0 bottom-0 left-0 transition-all duration-100 ease-linear ${disabled ? "bg-text-muted/30" : "bg-accent"}`} style={{ width: `${progressPct}%` }} />
        {/* Playhead dot */}
        {!disabled && <div className="absolute top-1/2 -translate-y-1/2 w-[10px] h-[10px] rounded-full bg-accent border-2 border-white shadow-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" style={{ left: `calc(${progressPct}% - 5px)` }} />}
      </div>

      {/* ── Bottom Controls ────────────────────────────────────────── */}
      <div className={`flex items-center h-10 px-3 shrink-0 relative ${disabled ? "opacity-40" : ""}`}>
        {/* Timecodes + left actions */}
        <div className="flex items-center gap-1">
          <div className="flex items-baseline gap-1 select-none" style={{ fontVariantNumeric: "tabular-nums" }}>
            <span className={`text-[12px] font-medium ${disabled ? "text-text-muted" : "text-accent"}`}>{formatTime(currentTime)}</span>
            <span className="text-[11px] text-text-muted/50">/</span>
            <span className="text-[12px] text-text-muted">{formatTime(duration)}</span>
          </div>
          {!disabled && leftActions}
        </div>

        {/* Center play controls */}
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1">
          {onStepBack && (
            <button onClick={disabled ? undefined : onStepBack} disabled={disabled} className={`w-7 h-7 flex items-center justify-center rounded transition-colors cursor-pointer ${disabled ? "cursor-not-allowed text-text-muted/50" : "hover:bg-white/6 text-text-muted hover:text-text-primary"}`} title={disabled ? t("editor.preview.transport.emptyTimeline") : t("editor.preview.transport.previousFrame")} aria-label={t("editor.preview.transport.previousFrame")}>
              <SkipBack className="w-3.5 h-3.5" />
            </button>
          )}
          <button onClick={disabled ? undefined : onPlayPause} disabled={disabled} className={`w-8 h-8 flex items-center justify-center rounded-full transition-colors cursor-pointer mx-1 ${disabled ? "cursor-not-allowed text-text-muted/50" : "hover:bg-white/6 text-text-primary"}`} title={disabled ? t("editor.preview.transport.emptyTimeline") : isPlaying ? t("editor.preview.transport.pause") : t("editor.preview.transport.play")} aria-label={isPlaying ? t("editor.preview.transport.pause") : t("editor.preview.transport.play")}>
            {isPlaying ? <Pause className="w-[18px] h-[18px]" /> : <Play className="w-[18px] h-[18px] ml-0.5" />}
          </button>
          {onStepForward && (
            <button onClick={disabled ? undefined : onStepForward} disabled={disabled} className={`w-7 h-7 flex items-center justify-center rounded transition-colors cursor-pointer ${disabled ? "cursor-not-allowed text-text-muted/50" : "hover:bg-white/6 text-text-muted hover:text-text-primary"}`} title={disabled ? t("editor.preview.transport.emptyTimeline") : t("editor.preview.transport.nextFrame")} aria-label={t("editor.preview.transport.nextFrame")}>
              <SkipForward className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Right side actions */}
        {rightActions && <div className="ml-auto flex items-center gap-2">{rightActions}</div>}
      </div>
    </>
  );
};

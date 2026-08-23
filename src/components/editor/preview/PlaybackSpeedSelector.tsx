import React, { useRef } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useClickOutside } from "@/hooks";

interface PlaybackSpeedSelectorProps {
  playbackSpeed: number;
  speedMenuOpen: boolean;
  setSpeedMenuOpen: (open: boolean) => void;
  setSpeed: (speed: number) => void;
}

export const PlaybackSpeedSelector: React.FC<PlaybackSpeedSelectorProps> = ({
  playbackSpeed,
  speedMenuOpen,
  setSpeedMenuOpen,
  setSpeed,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useClickOutside(containerRef, () => setSpeedMenuOpen(false), {
    enabled: speedMenuOpen,
  });

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setSpeedMenuOpen(!speedMenuOpen)}
        className={cn(
          "flex items-center gap-1 px-2 h-6 rounded text-[10px] font-medium transition-colors cursor-pointer",
          speedMenuOpen
            ? "bg-accent/15 text-accent"
            : "text-text-muted hover:text-text-primary hover:bg-white/6"
        )}
        title="Playback speed"
        aria-expanded={speedMenuOpen}
        aria-haspopup="listbox"
      >
        <span className="max-w-18 truncate">{playbackSpeed}x</span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />
      </button>
      {speedMenuOpen && (
        <div
          className="absolute bottom-full left-0 z-50 mb-1.5 w-[140px] overflow-hidden rounded-xl border border-border bg-surface-floating/95 backdrop-blur-xl py-1 text-text-primary shadow-2xl animate-in fade-in zoom-in-95 duration-100"
          role="listbox"
        >
          <div className="px-1 space-y-0.5">
            {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => (
              <button
                key={speed}
                type="button"
                role="option"
                aria-selected={playbackSpeed === speed}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-text-primary hover:bg-surface-raised transition-colors cursor-pointer",
                  playbackSpeed === speed && "bg-surface-raised text-accent font-semibold"
                )}
                onClick={() => {
                  setSpeed(speed);
                  setSpeedMenuOpen(false);
                }}
              >
                <span className="flex w-4 shrink-0 justify-center">
                  {playbackSpeed === speed ? (
                    <Check className="h-3.5 w-3.5 text-accent" />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{speed}x</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

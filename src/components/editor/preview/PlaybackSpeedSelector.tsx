import React from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";

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
  const currentSpeedLabel = t("editor.preview.speed.current", { speed: playbackSpeed });

  return (
    <div className="relative">
      <button
        onClick={() => setSpeedMenuOpen(!speedMenuOpen)}
        className="flex items-center gap-1 px-2 h-6 rounded text-[10px] font-medium text-text-muted hover:text-text-primary hover:bg-white/6 transition-colors cursor-pointer"
        title={currentSpeedLabel}
        aria-label={currentSpeedLabel}
        aria-expanded={speedMenuOpen}
      >
        <span className="max-w-18 truncate">{playbackSpeed}x</span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />
      </button>
      {speedMenuOpen && (
        <div
          className="absolute bottom-full right-0 z-50 mb-1 w-[140px] overflow-hidden rounded-lg border border-border bg-surface py-1 text-text-primary shadow-xl"
          role="listbox"
          aria-label={t("editor.preview.speed.label")}
        >
          <div className="px-1">
            {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => (
              <button
                key={speed}
                type="button"
                role="option"
                aria-selected={playbackSpeed === speed}
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-text-primary hover:bg-surface-raised cursor-pointer",
                  playbackSpeed === speed && "bg-surface-raised"
                )}
                onClick={() => {
                  setSpeed(speed);
                  setSpeedMenuOpen(false);
                }}
              >
                <span className="flex w-5 shrink-0 justify-center">
                  {playbackSpeed === speed ? (
                    <Check className="h-3.5 h-3.5 text-accent" />
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

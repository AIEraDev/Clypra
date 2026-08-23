import React, { useRef } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useClickOutside } from "@/hooks";

interface PlaybackQualitySelectorProps {
  previewQuality: "full" | "high" | "medium" | "low";
  qualityMenuOpen: boolean;
  setQualityMenuOpen: (open: boolean) => void;
  setPreviewQuality: (quality: "full" | "high" | "medium" | "low") => void;
}

export const PlaybackQualitySelector: React.FC<PlaybackQualitySelectorProps> = ({
  previewQuality,
  qualityMenuOpen,
  setQualityMenuOpen,
  setPreviewQuality,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useClickOutside(containerRef, () => setQualityMenuOpen(false), {
    enabled: qualityMenuOpen,
  });

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setQualityMenuOpen(!qualityMenuOpen)}
        className={cn(
          "flex items-center gap-1 px-2 h-6 rounded text-[10px] font-medium transition-colors cursor-pointer",
          qualityMenuOpen
            ? "bg-accent/15 text-accent"
            : "text-text-muted hover:text-text-primary hover:bg-white/6"
        )}
        title="Playback quality"
        aria-expanded={qualityMenuOpen}
        aria-haspopup="listbox"
      >
        <span className="max-w-18 truncate capitalize">{previewQuality}</span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />
      </button>
      {qualityMenuOpen && (
        <div
          className="absolute bottom-full left-0 z-50 mb-1.5 w-[280px] overflow-hidden rounded-xl border border-border bg-surface-floating/95 backdrop-blur-xl py-1.5 text-text-primary shadow-2xl animate-in fade-in zoom-in-95 duration-100"
          role="listbox"
        >
          <div className="px-1.5 space-y-0.5">
            {[
              {
                value: "full",
                label: "Full quality",
                description: "Original video resolution",
              },
              {
                value: "high",
                label: "High quality",
                description: "Smooth playback, no impact on exported video",
              },
              {
                value: "medium",
                label: "Medium quality",
                description: "Smoother playback, no impact on exported video",
              },
              {
                value: "low",
                label: "Low quality",
                description: "Smoothest playback, no impact on exported video",
              },
            ].map((q) => (
              <button
                key={q.value}
                type="button"
                role="option"
                aria-selected={previewQuality === q.value}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-surface-raised transition-colors duration-150 cursor-pointer",
                  previewQuality === q.value && "bg-surface-raised text-accent font-semibold"
                )}
                onClick={() => {
                  setPreviewQuality(q.value as any);
                  setQualityMenuOpen(false);
                }}
              >
                <span className="flex w-4 shrink-0 justify-center pt-0.5">
                  {previewQuality === q.value ? (
                    <Check className="h-3.5 w-3.5 text-accent" />
                  ) : null}
                </span>
                <div className="flex flex-col min-w-0 flex-1 leading-none">
                  <span className="text-xs font-semibold text-text-primary">
                    {q.label}
                  </span>
                  <span className="text-[10px] text-text-muted mt-1 leading-normal whitespace-normal">
                    {q.description}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

import React, { useRef } from "react";
import { ChevronDown } from "lucide-react";
import { AspectRatio, PREVIEW_ASPECT_LABEL } from "@/types";
import { AspectMenuRow } from "../../ui/AspectRatio";
import { cn } from "@/lib/utils";
import { useClickOutside } from "@/hooks";

const PREVIEW_ASPECT_RATIO: Record<AspectRatio, number | null> = {
  original: null,
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "1:1": 1,
  "4:5": 4 / 5,
  "21:9": 21 / 9,
  "4:3": 4 / 3,
};

function PreviewAspectShapeIcon({ widthOverHeight }: { widthOverHeight: number }) {
  const max = 22;
  const min = 8;
  let w: number;
  let h: number;
  if (widthOverHeight >= 1) {
    h = 12;
    w = Math.round(Math.min(max, Math.max(min, h * widthOverHeight)));
  } else {
    w = 12;
    h = Math.round(Math.min(max, Math.max(min, w / widthOverHeight)));
  }
  return (
    <span
      className="inline-flex shrink-0 rounded-sm border border-border-soft bg-bg"
      style={{ width: w, height: h }}
      aria-hidden
    />
  );
}

interface AspectSelectorProps {
  aspectMenuOpen: boolean;
  setAspectMenuOpen: (open: boolean) => void;
  previewAspectPreset: AspectRatio;
  selectAspectPreset: (preset: AspectRatio) => void;
  canvasWidth: number;
  canvasHeight: number;
}

export const AspectSelector: React.FC<AspectSelectorProps> = ({
  aspectMenuOpen,
  setAspectMenuOpen,
  previewAspectPreset,
  selectAspectPreset,
  canvasWidth,
  canvasHeight,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useClickOutside(containerRef, () => setAspectMenuOpen(false), {
    enabled: aspectMenuOpen,
  });

  return (
    <div className="relative shrink-0" ref={containerRef}>
      <button
        onClick={() => setAspectMenuOpen(!aspectMenuOpen)}
        className={cn(
          "flex items-center gap-1 px-2 h-6 rounded text-[10px] font-medium transition-colors cursor-pointer",
          aspectMenuOpen
            ? "bg-accent/15 text-accent"
            : "text-text-muted hover:text-text-primary hover:bg-white/6"
        )}
        title="Preview aspect ratio"
        aria-expanded={aspectMenuOpen}
        aria-haspopup="listbox"
      >
        <span className="font-semibold text-text-primary">
          {previewAspectPreset === "original" ? "Orig" : previewAspectPreset}
        </span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />
      </button>
      {aspectMenuOpen && (
        <div
          className="absolute bottom-full right-0 z-50 mb-1.5 w-[200px] overflow-hidden rounded-xl border border-border bg-surface-floating/95 backdrop-blur-xl py-1 text-text-primary shadow-2xl animate-in fade-in zoom-in-95 duration-100"
          role="listbox"
        >
          <div className="px-1">
            <AspectMenuRow
              preset="original"
              selected={previewAspectPreset}
              onSelect={(preset) => {
                selectAspectPreset(preset);
                setAspectMenuOpen(false);
              }}
              icon={
                <PreviewAspectShapeIcon
                  widthOverHeight={canvasWidth / Math.max(1, canvasHeight)}
                />
              }
            />
          </div>
          <div className="my-1 h-px bg-border/60" />
          <div className="px-1 space-y-0.5">
            {(["16:9", "9:16", "1:1", "4:5", "21:9", "4:3"] as const).map((p) => (
              <AspectMenuRow
                key={p}
                preset={p}
                selected={previewAspectPreset}
                onSelect={(preset) => {
                  selectAspectPreset(preset);
                  setAspectMenuOpen(false);
                }}
                icon={
                  <PreviewAspectShapeIcon
                    widthOverHeight={PREVIEW_ASPECT_RATIO[p]!}
                  />
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

import React from "react";
import { ChevronDown } from "lucide-react";
import { AspectRatio, PREVIEW_ASPECT_MESSAGE_KEY } from "@/types";
import { AspectMenuRow } from "../../ui/AspectRatio";
import { t } from "@/i18n";

const PREVIEW_ASPECT_RATIO: Record<AspectRatio, number | null> = {
  original: null,
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "1:1": 1,
  "4:5": 4 / 5,
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
  const selectedAspect = t(PREVIEW_ASPECT_MESSAGE_KEY[previewAspectPreset]);

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setAspectMenuOpen(!aspectMenuOpen)}
        className="flex items-center gap-1 px-2 h-6 rounded text-[10px] font-medium text-text-muted hover:text-text-primary hover:bg-white/6 transition-colors cursor-pointer"
        title={t("editor.preview.aspect.label")}
        aria-label={t("editor.preview.aspect.current", { aspect: selectedAspect })}
        aria-expanded={aspectMenuOpen}
      >
        <span className="max-w-18 truncate">{selectedAspect}</span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />
      </button>
      {aspectMenuOpen && (
        <div
          className="absolute bottom-full right-0 z-50 mb-1 w-[200px] overflow-hidden rounded-lg border border-border bg-surface py-1 text-text-primary shadow-xl"
          role="listbox"
        >
          <div className="px-1">
            <AspectMenuRow
              preset="original"
              selected={previewAspectPreset}
              onSelect={selectAspectPreset}
              icon={
                <PreviewAspectShapeIcon
                  widthOverHeight={canvasWidth / Math.max(1, canvasHeight)}
                />
              }
            />
          </div>
          <div className="my-1 h-px bg-border" />
          <div className="px-1">
            {(["16:9", "9:16", "1:1", "4:5"] as const).map((p) => (
              <AspectMenuRow
                key={p}
                preset={p}
                selected={previewAspectPreset}
                onSelect={selectAspectPreset}
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

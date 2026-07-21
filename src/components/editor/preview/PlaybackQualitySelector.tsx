import React from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { t, type MessageKey } from "@/i18n";

type PreviewQuality = PlaybackQualitySelectorProps["previewQuality"];

const QUALITY_OPTIONS: Array<{
  value: PreviewQuality;
  labelKey: MessageKey;
  descriptionKey: MessageKey;
}> = [
  { value: "full", labelKey: "editor.preview.quality.full", descriptionKey: "editor.preview.quality.fullDescription" },
  { value: "high", labelKey: "editor.preview.quality.high", descriptionKey: "editor.preview.quality.highDescription" },
  { value: "medium", labelKey: "editor.preview.quality.medium", descriptionKey: "editor.preview.quality.mediumDescription" },
  { value: "low", labelKey: "editor.preview.quality.low", descriptionKey: "editor.preview.quality.lowDescription" },
];

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
  return (
    <div className="relative">
      <button
        onClick={() => setQualityMenuOpen(!qualityMenuOpen)}
        className="flex items-center gap-1 px-2 h-6 rounded text-[10px] font-medium text-text-muted hover:text-text-primary hover:bg-white/6 transition-colors cursor-pointer"
        title={t("editor.preview.quality.label")}
        aria-label={t("editor.preview.quality.label")}
        aria-expanded={qualityMenuOpen}
      >
        <span className="max-w-18 truncate">{t(QUALITY_OPTIONS.find((option) => option.value === previewQuality)!.labelKey)}</span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />
      </button>
      {qualityMenuOpen && (
        <div
          className="absolute bottom-full left-0 z-50 mb-1 w-[300px] overflow-hidden rounded-lg border border-border bg-surface py-1.5 text-text-primary shadow-xl"
          role="listbox"
          aria-label={t("editor.preview.quality.label")}
        >
          <div className="px-1.5 space-y-0.5">
            {QUALITY_OPTIONS.map((q) => (
              <button
                key={q.value}
                type="button"
                role="option"
                aria-selected={previewQuality === q.value}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded px-2 py-2 text-left hover:bg-surface-raised transition-colors duration-150 cursor-pointer",
                  previewQuality === q.value && "bg-surface-raised"
                )}
                onClick={() => {
                  setPreviewQuality(q.value);
                  setQualityMenuOpen(false);
                }}
              >
                <span className="flex w-4 shrink-0 justify-center pt-0.5">
                  {previewQuality === q.value ? (
                    <Check className="h-3.5 h-3.5 text-accent" />
                  ) : null}
                </span>
                <div className="flex flex-col min-w-0 flex-1 leading-none">
                  <span className="text-xs font-semibold text-text-primary">
                    {t(q.labelKey)}
                  </span>
                  <span className="text-[10px] text-text-muted mt-1 leading-normal whitespace-normal">
                    {t(q.descriptionKey)}
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

import React from "react";
import { MousePointerClick, Film } from "lucide-react";
import { useTimelineStore } from "@/store/timelineStore";
import { t } from "@/i18n";

export const EmptyPropertiesState: React.FC = () => {
  const clipCount = useTimelineStore((s) => s.clips.length);
  const hasClips = clipCount > 0;

  return (
    <div className="w-full md:w-92 min-h-0 panel-shell flex flex-col overflow-y-auto scrollbar-thin shrink-0 select-none">
      {/* Header */}
      <div className="panel-head flex items-center gap-2 px-4 py-3 border-b border-border">
        <div className="w-5 h-5 rounded bg-accent/10 flex items-center justify-center">
          <Film className="w-3 h-3 text-accent" />
        </div>
        <span className="text-sm font-semibold text-text-primary">{t("properties.title")}</span>
      </div>

      {/* Empty State */}
      <div className="flex-1 flex flex-col items-center justify-center p-8 gap-4">
        <div className="w-12 h-12 rounded-xl bg-surface-raised/60 border border-border/40 flex items-center justify-center">
          <MousePointerClick className="w-5 h-5 text-text-muted/50" />
        </div>
        <div className="text-center space-y-1.5">
          <p className="text-xs font-medium text-text-muted">
            {t(hasClips ? "properties.empty.selectClipTitle" : "properties.empty.addMediaTitle")}
          </p>
          <p className="text-[10px] text-text-muted/50 leading-relaxed max-w-[180px]">
            {hasClips
              ? t("properties.empty.selectClipDescription")
              : t("properties.empty.addMediaDescription")
            }
          </p>
        </div>
      </div>
    </div>
  );
};

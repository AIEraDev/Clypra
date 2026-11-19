import React from "react";
import { Sparkles, Scissors, RefreshCw, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import type { TextEffectDefinition } from "@/features/text-effects/types/types";

interface EffectStylePanelProps {
  effectId: string;
  effectDefinition?: TextEffectDefinition;
  onDetach: () => void;
  onChangeEffect: () => void;
  isModified: boolean;
}

export const EffectStylePanel: React.FC<EffectStylePanelProps> = ({
  effectId,
  effectDefinition,
  onDetach,
  onChangeEffect,
  isModified,
}) => {
  const { t } = useI18n();
  const effectName =
    effectDefinition?.name ||
    effectId
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  const effectCategory = effectDefinition?.category || "Custom";

  return (
    <div className="space-y-3 mb-4">
      <div className="flex items-center justify-between p-3 bg-surface-elevated border border-border-default rounded-lg select-none">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded bg-violet-600/20 border border-violet-500/30 flex items-center justify-center text-violet-400">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <div className="text-xs font-semibold text-text-primary leading-tight">
              {effectName}
            </div>
            <div className="text-[10px] text-text-muted capitalize">
              {effectCategory} Effect
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={onChangeEffect}
            title={t("properties.effects.changeEffect")}
            className="p-1.5 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary transition-all duration-150 flex items-center justify-center"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={onDetach}
            title={t("properties.effects.detachEffect")}
            className="p-1.5 rounded hover:bg-red-500/10 text-text-muted hover:text-red-400 transition-all duration-150 flex items-center justify-center"
          >
            <Scissors className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {isModified && (
        <div className="flex items-start gap-2 p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-md text-[11px] text-amber-400 select-none">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{t("properties.effects.modifiedWarning")}</span>
        </div>
      )}
    </div>
  );
};

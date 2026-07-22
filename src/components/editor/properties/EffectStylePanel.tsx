import React from "react";
import { Sparkles, Scissors, RefreshCw, AlertTriangle } from "lucide-react";
import type { TextEffectDefinition } from "@/features/text-effects/types/types";
import { t, type MessageKey } from "@/i18n";

const CATEGORY_LABEL_KEYS = new Map<string, MessageKey>([
  ["3d", "features.textEffects.category.3d"],
  ["neon", "features.textEffects.category.neon"],
  ["essentials", "features.textEffects.category.essentials"],
  ["glitch", "features.textEffects.category.glitch"],
  ["gradient", "features.textEffects.category.gradient"],
  ["outline", "features.textEffects.category.outline"],
]);

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
  const effectName = effectDefinition?.name || effectId;
  const rawCategory = effectDefinition?.category;
  const categoryKey = rawCategory ? CATEGORY_LABEL_KEYS.get(rawCategory) : undefined;
  const effectCategory = categoryKey ? t(categoryKey) : rawCategory || t("properties.effectStyle.custom");

  return (
    <div className="space-y-3 mb-4">
      <div className="flex items-center justify-between p-3 bg-zinc-900 border border-zinc-800 rounded-lg select-none">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded bg-violet-600/20 border border-violet-500/30 flex items-center justify-center text-violet-400">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <div className="text-xs font-semibold text-white leading-tight">
              {effectName}
            </div>
            <div className="text-[10px] text-zinc-400">
              {t("properties.effectStyle.categoryLabel", { category: effectCategory })}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onChangeEffect}
            aria-label={t("properties.effectStyle.changeEffect")}
            title={t("properties.effectStyle.changeEffect")}
            className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white transition-all duration-150 flex items-center justify-center"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          
          <button
            type="button"
            onClick={onDetach}
            aria-label={t("properties.effectStyle.detachEffect")}
            title={t("properties.effectStyle.detachEffect")}
            className="p-1.5 rounded hover:bg-red-500/10 text-zinc-400 hover:text-red-400 transition-all duration-150 flex items-center justify-center"
          >
            <Scissors className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {isModified && (
        <div className="flex items-start gap-2 p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-md text-[11px] text-amber-400 select-none">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{t("properties.effectStyle.modifiedTip")}</span>
        </div>
      )}
    </div>
  );
};

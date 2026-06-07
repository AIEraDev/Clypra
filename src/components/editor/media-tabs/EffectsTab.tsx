import React from "react";
import { useTranslation } from "react-i18next";
import type { TabProps } from "./types";

export const EffectsTab: React.FC<TabProps> = ({ onAddToTimeline }) => {
  const { t } = useTranslation();
  const effects = [
    { id: "fx-1", name: t("media.effects.blur"), category: "filter", icon: "🌫️", description: "Gaussian blur" },
    { id: "fx-2", name: t("media.effects.blackWhite"), category: "color", icon: "⚫", description: "Grayscale" },
    { id: "fx-3", name: t("media.effects.sepia"), category: "color", icon: "🟤", description: "Vintage tone" },
    { id: "fx-4", name: t("media.effects.vignette"), category: "filter", icon: "⭕", description: "Darken edges" },
    { id: "fx-5", name: t("media.effects.sharpen"), category: "filter", icon: "🔪", description: "Enhance details" },
    { id: "fx-6", name: t("media.effects.glow"), category: "light", icon: "💡", description: "Soft glow" },
    {
      id: "fx-7",
      name: t("media.effects.chromatic"),
      category: "distortion",
      icon: "🌈",
      description: "RGB split",
    },
    {
      id: "fx-8",
      name: t("media.effects.pixelate"),
      category: "distortion",
      icon: "🟦",
      description: "Mosaic effect",
    },
    { id: "fx-9", name: t("media.effects.brightness"), category: "color", icon: "☀️", description: "Adjust light" },
    { id: "fx-10", name: t("media.effects.contrast"), category: "color", icon: "◐", description: "Enhance depth" },
    { id: "fx-11", name: t("media.effects.saturation"), category: "color", icon: "🎨", description: "Color intensity" },
    { id: "fx-12", name: t("media.effects.noise"), category: "distortion", icon: "📺", description: "Film grain" },
  ];

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-3">
      <div className="grid grid-cols-2 gap-2">
        {effects.map((effect) => (
          <EffectCard key={effect.id} effect={effect} onAddToTimeline={() => onAddToTimeline?.(effect, "effects")} />
        ))}
      </div>
    </div>
  );
};

// EffectCard Component
const EffectCard: React.FC<{ effect: any; onAddToTimeline: () => void }> = ({ effect, onAddToTimeline }) => {
  return (
    <button onClick={onAddToTimeline} className="p-4 bg-surface-raised hover:bg-surface-raised/80 rounded-lg transition-colors group text-left">
      <div className="text-3xl mb-2">{effect.icon}</div>
      <p className="text-sm font-medium text-text-primary">{effect.name}</p>
      <p className="text-xs text-text-muted mt-1">{effect.category}</p>
    </button>
  );
};

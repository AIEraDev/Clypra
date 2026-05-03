import React from "react";
import type { TabProps } from "./types";

export const EffectsTab: React.FC<TabProps> = ({ onAddToTimeline }) => {
  const effects = [
    { id: "fx-1", name: "Blur", category: "filter", icon: "🌫️", description: "Gaussian blur" },
    { id: "fx-2", name: "Black & White", category: "color", icon: "⚫", description: "Grayscale" },
    { id: "fx-3", name: "Sepia", category: "color", icon: "🟤", description: "Vintage tone" },
    { id: "fx-4", name: "Vignette", category: "filter", icon: "⭕", description: "Darken edges" },
    { id: "fx-5", name: "Sharpen", category: "filter", icon: "🔪", description: "Enhance details" },
    { id: "fx-6", name: "Glow", category: "light", icon: "💡", description: "Soft glow" },
    {
      id: "fx-7",
      name: "Chromatic",
      category: "distortion",
      icon: "🌈",
      description: "RGB split",
    },
    {
      id: "fx-8",
      name: "Pixelate",
      category: "distortion",
      icon: "🟦",
      description: "Mosaic effect",
    },
    { id: "fx-9", name: "Brightness", category: "color", icon: "☀️", description: "Adjust light" },
    { id: "fx-10", name: "Contrast", category: "color", icon: "◐", description: "Enhance depth" },
    { id: "fx-11", name: "Saturation", category: "color", icon: "🎨", description: "Color intensity" },
    { id: "fx-12", name: "Noise", category: "distortion", icon: "📺", description: "Film grain" },
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

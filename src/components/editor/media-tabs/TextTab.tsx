import React from "react";
import { Plus } from "lucide-react";
import { Button } from "../../ui/Button";
import type { TabProps } from "./types";

export const TextTab: React.FC<TabProps> = ({ onAddToTimeline }) => {
  const textPresets = [
    { id: "text-1", name: "Title", style: "bold", fontSize: 72, animation: "fade-in" },
    { id: "text-2", name: "Subtitle", style: "regular", fontSize: 48, animation: "slide-up" },
    { id: "text-3", name: "Lower Third", style: "medium", fontSize: 32, animation: "slide-left" },
    { id: "text-4", name: "Caption", style: "regular", fontSize: 24, animation: "none" },
    { id: "text-5", name: "Headline", style: "bold", fontSize: 64, animation: "zoom-in" },
    { id: "text-6", name: "Quote", style: "italic", fontSize: 36, animation: "fade-in" },
  ];

  return (
    <>
      <div className="p-3 border-b border-border">
        <Button variant="secondary" size="sm" className="w-full" onClick={() => onAddToTimeline?.({ type: "custom" }, "text")}>
          <Plus className="w-4 h-4" />
          Add Custom Text
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-2">
        {textPresets.map((preset) => (
          <TextPresetCard key={preset.id} preset={preset} onAddToTimeline={() => onAddToTimeline?.(preset, "text")} />
        ))}
      </div>
    </>
  );
};

// TextPresetCard Component
const TextPresetCard: React.FC<{ preset: any; onAddToTimeline: () => void }> = ({ preset, onAddToTimeline }) => {
  return (
    <button onClick={onAddToTimeline} className="w-full p-4 bg-surface-raised hover:bg-surface-raised/80 rounded-lg text-left transition-colors group">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-medium text-text-primary">{preset.name}</p>
        <Plus className="w-4 h-4 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <div
        className="text-text-muted"
        style={{
          fontSize: `${Math.min(preset.fontSize / 3, 20)}px`,
          fontWeight: preset.style === "bold" ? "bold" : "normal",
          fontStyle: preset.style === "italic" ? "italic" : "normal",
        }}
      >
        Sample Text
      </div>
      <p className="text-xs text-text-muted mt-2">{preset.animation}</p>
    </button>
  );
};

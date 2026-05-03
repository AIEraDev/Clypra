import React from "react";
import { Wand2, Plus } from "lucide-react";
import { Button } from "../../ui/Button";
import type { TabProps } from "./types";

export const CaptionsTab: React.FC<TabProps> = ({ onAddToTimeline }) => {
  const captionStyles = [
    {
      id: "style-1",
      name: "Default",
      description: "Standard white text with black outline",
      preview: "Sample caption text",
    },
    {
      id: "style-2",
      name: "Bold",
      description: "Heavy weight with strong contrast",
      preview: "Sample caption text",
    },
    {
      id: "style-3",
      name: "Minimal",
      description: "Clean and simple appearance",
      preview: "Sample caption text",
    },
    {
      id: "style-4",
      name: "Boxed",
      description: "Text with background box",
      preview: "Sample caption text",
    },
    {
      id: "style-5",
      name: "Outlined",
      description: "Thick outline, no fill",
      preview: "Sample caption text",
    },
    {
      id: "style-6",
      name: "Shadow",
      description: "Drop shadow effect",
      preview: "Sample caption text",
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-3">
      <Button variant="secondary" size="sm" className="w-full" onClick={() => onAddToTimeline?.({ type: "auto" }, "captions")}>
        <Wand2 className="w-4 h-4" />
        Auto-Generate Captions
      </Button>

      <Button variant="secondary" size="sm" className="w-full" onClick={() => onAddToTimeline?.({ type: "manual" }, "captions")}>
        <Plus className="w-4 h-4" />
        Add Manual Caption
      </Button>

      <div className="pt-3 border-t border-border">
        <h4 className="text-xs font-semibold text-text-muted mb-2">Caption Styles</h4>
        <div className="space-y-2">
          {captionStyles.map((style) => (
            <CaptionStyleCard key={style.id} style={style} onAddToTimeline={() => onAddToTimeline?.(style, "captions")} />
          ))}
        </div>
      </div>
    </div>
  );
};

// CaptionStyleCard Component
const CaptionStyleCard: React.FC<{ style: any; onAddToTimeline: () => void }> = ({ style, onAddToTimeline }) => {
  return (
    <button onClick={onAddToTimeline} className="w-full p-3 bg-surface-raised hover:bg-surface-raised/80 rounded-lg text-left transition-colors group">
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm font-medium text-text-primary">{style.name}</p>
        <Plus className="w-4 h-4 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <p className="text-xs text-text-muted">{style.description}</p>
    </button>
  );
};

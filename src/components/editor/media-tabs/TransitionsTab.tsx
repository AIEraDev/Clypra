import React from "react";
import { Shuffle } from "lucide-react";
import type { TabProps } from "./types";

export const TransitionsTab: React.FC<TabProps> = ({ onAddToTimeline }) => {
  const transitions = [
    { id: "trans-1", name: "Fade", duration: 0.5, preview: "fade", description: "Smooth fade" },
    {
      id: "trans-2",
      name: "Dissolve",
      duration: 1.0,
      preview: "dissolve",
      description: "Cross dissolve",
    },
    { id: "trans-3", name: "Wipe", duration: 0.8, preview: "wipe", description: "Directional wipe" },
    { id: "trans-4", name: "Slide", duration: 0.6, preview: "slide", description: "Slide motion" },
    { id: "trans-5", name: "Zoom", duration: 0.7, preview: "zoom", description: "Scale transition" },
    { id: "trans-6", name: "Spin", duration: 1.0, preview: "spin", description: "Rotate effect" },
    {
      id: "trans-7",
      name: "Push",
      duration: 0.8,
      preview: "push",
      description: "Push transition",
    },
    {
      id: "trans-8",
      name: "Blur",
      duration: 0.6,
      preview: "blur",
      description: "Blur transition",
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-3">
      <div className="grid grid-cols-2 gap-2">
        {transitions.map((transition) => (
          <TransitionCard key={transition.id} transition={transition} onAddToTimeline={() => onAddToTimeline?.(transition, "transitions")} />
        ))}
      </div>
    </div>
  );
};

// TransitionCard Component
const TransitionCard: React.FC<{ transition: any; onAddToTimeline: () => void }> = ({ transition, onAddToTimeline }) => {
  return (
    <button onClick={onAddToTimeline} className="p-4 bg-surface-raised hover:bg-surface-raised/80 rounded-lg transition-colors group text-left">
      <div className="aspect-video bg-surface mb-2 rounded flex items-center justify-center">
        <Shuffle className="w-6 h-6 text-text-muted" />
      </div>
      <p className="text-sm font-medium text-text-primary">{transition.name}</p>
      <p className="text-xs text-text-muted mt-1">{transition.duration}s</p>
    </button>
  );
};

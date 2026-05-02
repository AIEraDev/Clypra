import React from "react";
import { Settings } from "lucide-react";
import { EmptyState } from "../ui/EmptyState";
import { useUIStore } from "../../store/uiStore";
import { useTimelineStore } from "../../store/timelineStore";

export const PropertiesPanel: React.FC = () => {
  const { selectedClipId } = useUIStore();
  const { clips, updateClip } = useTimelineStore();

  const selectedClip = clips.find((c) => c.id === selectedClipId);

  if (!selectedClipId || !selectedClip) {
    return (
      <div className="w-[24rem] min-h-0 bg-surface border-l border-border flex flex-col p-4 overflow-y-auto scrollbar-thin shrink-0">
        <div className="flex items-center gap-2 mb-4">
          <Settings className="w-4 h-4" />
          <span className="text-sm font-medium">Properties</span>
        </div>
        <EmptyState icon={Settings} title="Select a clip to edit" />
      </div>
    );
  }

  const handleUpdate = (key: keyof typeof selectedClip, value: any) => {
    updateClip(selectedClipId, { [key]: value });
  };

  return (
    <div className="w-[24rem] min-h-0 bg-surface border-l border-border flex flex-col overflow-y-auto scrollbar-thin shrink-0">
      <div className="p-4 border-b border-border">
        <h3 className="font-semibold text-text-primary">Clip Properties</h3>
      </div>

      <div className="flex-1 p-4 space-y-6">
        {/* Transform Section */}
        <div>
          <h4 className="text-sm font-semibold text-text-primary mb-3">Transform</h4>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-text-muted block mb-1">X</label>
                <input type="number" value={Math.round(selectedClip.x)} onChange={(e) => handleUpdate("x", Number(e.target.value))} className="w-full bg-surface-raised border border-border rounded px-2 py-1 text-xs text-text-primary" />
              </div>
              <div>
                <label className="text-xs text-text-muted block mb-1">Y</label>
                <input type="number" value={Math.round(selectedClip.y)} onChange={(e) => handleUpdate("y", Number(e.target.value))} className="w-full bg-surface-raised border border-border rounded px-2 py-1 text-xs text-text-primary" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-text-muted block mb-1">Width</label>
                <input type="number" value={Math.round(selectedClip.width)} onChange={(e) => handleUpdate("width", Number(e.target.value))} className="w-full bg-surface-raised border border-border rounded px-2 py-1 text-xs text-text-primary" />
              </div>
              <div>
                <label className="text-xs text-text-muted block mb-1">Height</label>
                <input type="number" value={Math.round(selectedClip.height)} onChange={(e) => handleUpdate("height", Number(e.target.value))} className="w-full bg-surface-raised border border-border rounded px-2 py-1 text-xs text-text-primary" />
              </div>
            </div>

            <div>
              <label className="text-xs text-text-muted block mb-1">Rotation</label>
              <div className="flex items-center gap-2">
                <input type="range" min="-180" max="180" value={selectedClip.rotation} onChange={(e) => handleUpdate("rotation", Number(e.target.value))} className="flex-1" />
                <input type="number" value={Math.round(selectedClip.rotation)} onChange={(e) => handleUpdate("rotation", Number(e.target.value))} className="w-12 bg-surface-raised border border-border rounded px-2 py-1 text-xs text-text-primary" />
              </div>
            </div>

            <div>
              <label className="text-xs text-text-muted block mb-1">Opacity</label>
              <div className="flex items-center gap-2">
                <input type="range" min="0" max="100" value={selectedClip.opacity} onChange={(e) => handleUpdate("opacity", Number(e.target.value))} className="flex-1" />
                <span className="text-xs text-text-primary w-8">{Math.round(selectedClip.opacity)}%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Clip Section */}
        <div>
          <h4 className="text-sm font-semibold text-text-primary mb-3">Clip</h4>
          <div className="space-y-2">
            <div>
              <label className="text-xs text-text-muted block mb-1">Speed</label>
              <select className="w-full bg-surface-raised border border-border rounded px-2 py-1 text-xs text-text-primary">
                <option>0.25x</option>
                <option>0.5x</option>
                <option selected>1x</option>
                <option>1.5x</option>
                <option>2x</option>
              </select>
            </div>

            <div>
              <label className="text-xs text-text-muted block mb-1">Trim In (s)</label>
              <input type="number" value={selectedClip.trimIn.toFixed(2)} onChange={(e) => handleUpdate("trimIn", Number(e.target.value))} className="w-full bg-surface-raised border border-border rounded px-2 py-1 text-xs text-text-primary" />
            </div>

            <div>
              <label className="text-xs text-text-muted block mb-1">Trim Out (s)</label>
              <input type="number" value={selectedClip.trimOut.toFixed(2)} onChange={(e) => handleUpdate("trimOut", Number(e.target.value))} className="w-full bg-surface-raised border border-border rounded px-2 py-1 text-xs text-text-primary" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

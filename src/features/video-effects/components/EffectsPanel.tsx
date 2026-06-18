/**
 * Main Effects Panel Component
 * Video Effects (renderer-based) and Body Effects only
 */

import React, { useState } from "react";
import { EffectPicker } from "./EffectPicker";
import { RendererEffectsBrowser } from "./RendererEffectsBrowser";
import type { EffectPreset } from "../types";
import type { EffectRenderer as EffectRendererType } from "@clypra/engine";
import type { TabType } from "@/components/editor/media-tabs/types";

type EffectTab = "video" | "body";

export interface EffectsPanelProps {
  onAddToTimeline?: (item: any, type: TabType) => void;
}

export function EffectsPanel({ onAddToTimeline }: EffectsPanelProps) {
  const [activeTab, setActiveTab] = useState<EffectTab>("video");

  const handleEffectSelect = (effect: EffectPreset) => {
    if (onAddToTimeline) {
      onAddToTimeline(effect, "body-effects");
    }
  };

  const handleRendererEffectSelect = (effectId: EffectRendererType) => {
    console.log("Renderer effect selected:", effectId);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-surface/5 select-none">
      {/* Top Header Control Navigation Row */}
      <div className="flex items-center gap-2 p-1 border-b border-border/50 shrink-0 bg-surface/10">
        <div className="grow overflow-x-auto flex items-center gap-2 pb-0.5 whitespace-nowrap" style={{ scrollbarWidth: "none" }}>
          <button onClick={() => setActiveTab("video")} className={`px-2 py-0.5 rounded-sm text-xs font-semibold transition-all cursor-pointer ${activeTab === "video" ? "bg-accent text-white" : "text-text-muted hover:text-text-primary hover:bg-surface-raised/40"}`}>
            Video Effects
          </button>
          <button onClick={() => setActiveTab("body")} className={`px-2 py-0.5 rounded-sm text-xs font-semibold transition-all cursor-pointer ${activeTab === "body" ? "bg-accent text-white" : "text-text-muted hover:text-text-primary hover:bg-surface-raised/40"}`}>
            Body Effects
          </button>
        </div>
      </div>

      {/* Tab Content */}
      <div className="grow overflow-y-auto scrollbar-thin">
        {activeTab === "video" && <RendererEffectsBrowser onEffectSelect={handleRendererEffectSelect} onAddToTimeline={onAddToTimeline} showApplyButton={true} />}
        {activeTab === "body" && <EffectPicker onSelect={handleEffectSelect} />}
      </div>
    </div>
  );
}

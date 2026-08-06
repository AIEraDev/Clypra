/**
 * Main Effects Panel Component
 * Video Effects (renderer-based) and Body Effects only
 */

import { useState } from "react";
import { EffectPicker } from "./EffectPicker";
import { RendererEffectsBrowser } from "./RendererEffectsBrowser";
import type { EffectPreset } from "../types";
import type { EffectRenderer as EffectRendererType } from "@clypra-studio/engine";
import type { TabType } from "@/components/editor/sidebar";

const VIDEO_EFFECT_CATEGORIES = [
  { id: "essentials", name: "Essentials" },
  { id: "glitch", name: "Glitch" },
  { id: "retro", name: "Retro" },
  { id: "light", name: "Light" },
  { id: "motion", name: "Motion" },
  { id: "color", name: "Color" },
];

const BODY_EFFECT_CATEGORIES = [
  { id: "trending", name: "Trending" },
  { id: "motion", name: "Motion" },
  { id: "aura", name: "Aura" },
  { id: "wings", name: "Wings" },
  { id: "energy", name: "Energy" },
  { id: "fun", name: "Fun" },
];

type EffectTab = "video" | "body";

export interface EffectsPanelProps {
  onAddToTimeline?: (item: any, type: TabType) => void;
}

export function EffectsPanel({ onAddToTimeline }: EffectsPanelProps) {
  const [activeTab, setActiveTab] = useState<EffectTab>("video");
  const [selectedCategory, setSelectedCategory] = useState<string>("essentials");

  const handleTabChange = (tab: EffectTab) => {
    setActiveTab(tab);
    // Set default category based on tab
    if (tab === "video") {
      setSelectedCategory("essentials");
    } else if (tab === "body") {
      setSelectedCategory("trending");
    }
  };

  const handleEffectSelect = (effect: EffectPreset) => {
    if (onAddToTimeline) {
      onAddToTimeline(effect, "body-effects");
    }
  };

  const handleRendererEffectSelect = (_effectId: EffectRendererType) => {
    // Effect selected
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-surface/5 select-none">
      {/* Top Header Control Navigation Row */}
      <div className="flex items-center gap-1.5 p-1 border-b border-border/50 shrink-0 bg-surface/10">
        {/* Video/Body Tabs */}
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => handleTabChange("video")} className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-all cursor-pointer ${activeTab === "video" ? "bg-accent text-white" : "text-text-muted hover:text-text-primary hover:bg-surface-raised/40"}`}>
            Video
          </button>
          <button onClick={() => handleTabChange("body")} className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-all cursor-pointer ${activeTab === "body" ? "bg-accent text-white" : "text-text-muted hover:text-text-primary hover:bg-surface-raised/40"}`}>
            Body
          </button>
        </div>

        <div className="w-[2px] h-full bg-accent" />

        {/* Category Pills - Scrollable */}
        <div className="flex gap-1 overflow-x-auto scrollbar-none" style={{ scrollbarWidth: "none" }}>
          {activeTab === "video" &&
            VIDEO_EFFECT_CATEGORIES.map((cat) => (
              <button key={cat.id} onClick={() => setSelectedCategory(cat.id)} className={`shrink-0 cursor-pointer rounded px-2 py-0.5 text-[11px] font-semibold transition-colors flex items-center hover:bg-accent/10 hover:text-accent ${selectedCategory === cat.id ? "bg-accent/10 text-accent" : "text-text-muted"}`}>
                <span>{cat.name}</span>
              </button>
            ))}
          {activeTab === "body" &&
            BODY_EFFECT_CATEGORIES.map((cat) => (
              <button key={cat.id} onClick={() => setSelectedCategory(cat.id)} className={`shrink-0 cursor-pointer rounded px-2 py-0.5 text-[11px] font-semibold transition-colors flex items-center hover:bg-accent/10 hover:text-accent ${selectedCategory === cat.id ? "bg-accent/10 text-accent" : "text-text-muted"}`}>
                <span>{cat.name}</span>
              </button>
            ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="grow overflow-y-auto scrollbar-thin">
        {activeTab === "video" && <RendererEffectsBrowser onEffectSelect={handleRendererEffectSelect} onAddToTimeline={onAddToTimeline} showApplyButton={true} selectedCategory={selectedCategory} />}
        {activeTab === "body" && <EffectPicker onSelect={handleEffectSelect} />}
      </div>
    </div>
  );
}

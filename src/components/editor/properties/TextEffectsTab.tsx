/**
 * TextEffectsTab.tsx
 *
 * The "Effects" sub-tab of TextStyleSection.
 * Shows the active effect banner (if any) and a searchable grid of
 * text-effect presets from the effects store.
 */

import React, { useState } from "react";
import { Search } from "lucide-react";
import type { TextClip } from "@/types";
import type { TextEffectDefinition } from "@/features/text-effects/types/types";
import { EffectStylePanel } from "./EffectStylePanel";

interface TextEffectsTabProps {
  textClip: TextClip;
  activeEffectDefinition: TextEffectDefinition | undefined;
  filteredEffects: TextEffectDefinition[];
  onApplyEffect: (effect: TextEffectDefinition) => void;
  onDetachEffect: () => void;
}

export const TextEffectsTab: React.FC<TextEffectsTabProps> = ({
  textClip,
  activeEffectDefinition,
  filteredEffects,
  onApplyEffect,
  onDetachEffect,
}) => {
  const [searchQuery, setSearchQuery] = useState("");

  const visibleEffects = searchQuery
    ? filteredEffects.filter((e) =>
        e.name.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : filteredEffects;

  return (
    <div className="space-y-4">
      {/* Active effect banner */}
      {textClip.styleId && activeEffectDefinition && (
        <div className="space-y-3">
          <EffectStylePanel
            effectId={textClip.styleId}
            effectDefinition={activeEffectDefinition}
            onDetach={onDetachEffect}
            onChangeEffect={() => {}}
            isModified={false}
          />
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="w-3.5 h-3.5 text-[#8e8e93] absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search text effects..."
          className="w-full bg-[#202024] border border-white/5 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-text-muted/40 outline-none focus:border-cyan-400/50"
        />
      </div>

      {/* Effects grid */}
      <div className="grid grid-cols-2 gap-2 max-h-[380px] overflow-y-auto scrollbar-thin pr-1">
        {visibleEffects.map((effect) => {
          const isSelected = textClip.styleId === effect.id;
          return (
            <div
              key={effect.id}
              onClick={() => onApplyEffect(effect)}
              className={`p-3 rounded-xl border transition-all cursor-pointer flex flex-col items-center justify-center min-h-[80px] relative text-center group ${
                isSelected
                  ? "bg-[#27272a] border-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.2)]"
                  : "bg-[#202024] border-white/5 hover:border-white/20"
              }`}
            >
              <div
                className="text-sm font-bold truncate max-w-full mb-1"
                style={{
                  color: effect.fills?.[0]?.color || "#ffffff",
                  textShadow: effect.shadows?.[0]
                    ? `0 0 ${effect.shadows[0].blur}px ${effect.shadows[0].color}`
                    : undefined,
                }}
              >
                {effect.name}
              </div>
              <span className="text-[10px] text-[#8e8e93] truncate max-w-full">
                {effect.category || "Style"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

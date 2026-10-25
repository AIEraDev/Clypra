/**
 * TextBubbleTab.tsx
 *
 * CapCut-parity "Bubble" sub-tab in TextStyleSection.
 * Features:
 * - Category filter dropdown (All, Speech, Comic, Cute, Notes, Banner, Neon, Floral)
 * - Authentic 7-column grid with miniature preview cards replicating CapCut desktop
 * - None/Reset ban card (⃠)
 * - Corner download badges (↓)
 * - Active cyan selection ring
 * - Seamless integration with live timeline & evaluator
 */

import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  Ban,
  ArrowDown,
  Check,
  SlidersHorizontal,
  Search,
  X,
} from "lucide-react";
import { useTranslation } from "@/i18n";
import type { TextClip } from "@/types";
import {
  BUBBLE_PRESETS,
  BUBBLE_CATEGORIES,
  isBubblePresetActive,
  type BubbleCategory,
  type BubblePreset,
} from "../../data/bubblePresets";
import { BubblePresetCanvas } from "../sections/BubblePresetCanvas";

interface TextBubbleTabProps {
  textClip: TextClip;
  handleCustomStyleUpdate: (key: string, value: any) => void;
  handleUpdateMultiple?: (fields: Record<string, any>) => void;
}

export const TextBubbleTab: React.FC<TextBubbleTabProps> = ({
  textClip,
  handleCustomStyleUpdate,
  handleUpdateMultiple,
}) => {
  const { t } = useTranslation();
  const [selectedCategory, setSelectedCategory] =
    useState<BubbleCategory>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  // Close filter dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setIsFilterOpen(false);
      }
    };
    if (isFilterOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isFilterOpen]);

  // Filter presets by category and search query
  const filteredPresets = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return BUBBLE_PRESETS.filter((preset) => {
      if (preset.isReset) return true; // Always show Reset card

      // Category filter
      if (selectedCategory !== "all") {
        const matchesCategory =
          preset.category === selectedCategory ||
          (selectedCategory === "paper" &&
            (preset.category === "notes" || preset.tags?.includes("paper"))) ||
          (selectedCategory === "labels" &&
            (preset.category === "banner" || preset.tags?.includes("label"))) ||
          (selectedCategory === "decorative" &&
            (preset.category === "floral" ||
              preset.tags?.includes("decorative")));

        if (!matchesCategory) return false;
      }

      // Search query filter
      if (query) {
        const matchName = preset.name.toLowerCase().includes(query);
        const matchSample = preset.sampleText?.toLowerCase().includes(query);
        const matchTags = preset.tags?.some((t) =>
          t.toLowerCase().includes(query),
        );
        if (!matchName && !matchSample && !matchTags) return false;
      }

      return true;
    });
  }, [selectedCategory, searchQuery]);

  const handleApplyBubble = (preset: BubblePreset) => {
    if (preset.isReset) {
      if (handleUpdateMultiple) {
        handleUpdateMultiple({
          background: undefined,
        });
      } else {
        handleCustomStyleUpdate("background", undefined);
      }
      return;
    }

    const updates: Record<string, any> = {
      background: preset.background,
      styleId: undefined,
      styleDefinition: undefined,
    };
    if (preset.textColor) {
      updates.color = preset.textColor;
    }
    if (preset.defaultTextStyle) {
      if (preset.defaultTextStyle.color)
        updates.color = preset.defaultTextStyle.color;
      if (preset.defaultTextStyle.fontStyle)
        updates.fontStyle = preset.defaultTextStyle.fontStyle;
      if (preset.defaultTextStyle.textDecoration)
        updates.textDecoration = preset.defaultTextStyle.textDecoration;
    }

    if (handleUpdateMultiple) {
      handleUpdateMultiple(updates);
    } else {
      handleCustomStyleUpdate("background", preset.background);
      handleCustomStyleUpdate("styleId", undefined);
      handleCustomStyleUpdate("styleDefinition", undefined);
      if (updates.color) handleCustomStyleUpdate("color", updates.color);
      if (updates.fontStyle)
        handleCustomStyleUpdate("fontStyle", updates.fontStyle);
      if (updates.textDecoration)
        handleCustomStyleUpdate("textDecoration", updates.textDecoration);
    }
  };

  const activeCategoryLabel =
    BUBBLE_CATEGORIES.find((c) => c.id === selectedCategory)?.label || "All";

  return (
    <div className="space-y-2.5 pb-6">
      {/* ── Search Input ── */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#8e8e93]" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search text bubbles..."
          className="w-full bg-[#18181b] border border-white/10 rounded-md pl-8 pr-8 py-1.5 text-xs text-white placeholder-[#8e8e93]/50 outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/20 transition-colors"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8e8e93] hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* ── Horizontal Category Filter Pills ── */}
      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5 select-none">
        {BUBBLE_CATEGORIES.map((cat) => {
          const isSelected = selectedCategory === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-3 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors cursor-pointer shrink-0 ${
                isSelected
                  ? "bg-white/20 text-white border border-white/30 shadow-xs"
                  : "bg-[#242426] text-[#8e8e93] hover:text-white hover:bg-[#2c2c30] border border-white/5"
              }`}
            >
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* ── Header Title & Category Dropdown ── */}
      <div className="flex items-center justify-between pt-0.5 relative">
        <span className="text-[10px] text-[#8e8e93] uppercase font-semibold tracking-wider select-none">
          {t("properties.text.speechBubbles") || "Speech Bubbles"}
        </span>

        {/* Category Filter Button */}
        <div className="relative" ref={filterRef}>
          <button
            type="button"
            onClick={() => setIsFilterOpen(!isFilterOpen)}
            className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[#242426] hover:bg-[#2c2c30] border border-white/10 text-[11px] text-white font-medium transition-colors cursor-pointer"
            title={t("properties.bubble.filterTooltip") || "Filter by category"}
          >
            <span>{activeCategoryLabel}</span>
            <SlidersHorizontal className="w-3 h-3 text-[#8e8e93]" />
          </button>

          {/* Filter Dropdown Popover */}
          {isFilterOpen && (
            <div className="absolute right-0 top-full mt-1 w-36 bg-[#1e1e22] border border-white/10 rounded-lg shadow-xl z-50 py-1 overflow-hidden">
              {BUBBLE_CATEGORIES.map((cat) => {
                const isSelected = selectedCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => {
                      setSelectedCategory(cat.id);
                      setIsFilterOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-1.5 text-xs text-left transition-colors cursor-pointer ${
                      isSelected
                        ? "bg-cyan-500/10 text-cyan-400 font-semibold"
                        : "text-text-muted hover:text-white hover:bg-white/5"
                    }`}
                  >
                    <span>{cat.label}</span>
                    {isSelected && <Check className="w-3.5 h-3.5" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── 7-Column Responsive Preset Grid ── */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(2.85rem,1fr))] gap-2">
        {filteredPresets.map((preset) => {
          const active = isBubblePresetActive(preset, textClip);

          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => handleApplyBubble(preset)}
              title={preset.name}
              className={`aspect-square rounded-xl flex items-center justify-center transition-all cursor-pointer relative shrink-0 p-1 select-none overflow-hidden ${
                active
                  ? "border-2 border-cyan-400 bg-[#28282c] shadow-[0_0_12px_rgba(34,211,238,0.2)]"
                  : "border border-white/5 bg-[#242426] hover:border-white/20 hover:bg-[#2a2a2e]"
              }`}
            >
              {preset.isReset ? (
                <Ban className="w-5 h-5 text-[#8e8e93]" />
              ) : (
                <>
                  {/* Canvas preset preview (uses HTML5 canvas, not HTML document elements) */}
                  <BubblePresetCanvas preset={preset} size={56} />

                  {/* Corner download icon badge */}
                  <div className="absolute bottom-1 right-1 w-3.5 h-3.5 rounded-full bg-black/70 backdrop-blur-xs flex items-center justify-center pointer-events-none">
                    <ArrowDown className="w-2 h-2 text-white/90" />
                  </div>
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

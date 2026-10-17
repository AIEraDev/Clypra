/**
 * Motion Preset & Kinetic Behavior Inspector Section.
 *
 * Provides CapCut-parity animation browsing and preset compilation:
 * - 5-column square card grid with live hover previews and cyan active border
 * - In, Out, Loop segmented tabs
 * - Real-time search across names, tags, and categories
 * - Category filter pills (★ Favorites, All, Basic, Motion, 3D, Glitch)
 * - Pinned bottom duration slider and numeric stepper
 * - Compiles high-level presets into responsive visualKeyframes
 */

import React, { useState, useCallback, useMemo, useEffect } from "react";
import {
  Sparkles,
  Zap,
  Activity,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ZoomIn,
  ZoomOut,
  Sun,
  Moon,
  FastForward,
  Minimize2,
  Download,
  Waves,
  Heart,
  Shuffle,
  Compass,
  Ban,
  Clock,
  Gauge,
  Search,
  X,
  Star,
  RotateCw,
  RotateCcw,
  Type,
  Gem,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import type { Clip } from "@/types";
import type {
  ClipMotionConfig,
  MotionBehaviorCategory,
  MotionPresetMeta,
  MotionSubCategory,
} from "@/types/motion";
import {
  MOTION_IN_PRESETS,
  MOTION_OUT_PRESETS,
  MOTION_LOOP_PRESETS,
  compileClipMotionKeyframes,
} from "@/core/animation/motionPresets";
import { useI18n } from "@/i18n";
import { PropertySection } from "./primitives/PropertySection";
import { PropertySlider } from "./primitives/PropertySlider";

interface MotionPresetSectionProps {
  selectedClip: Clip;
  handleUpdateMultiple: (fields: Record<string, any>) => void;
  canvasWidth?: number;
  canvasHeight?: number;
}

const FAVORITES_STORAGE_KEY = "clypra_favorite_animation_presets";

const getStoredFavorites = (): Set<string> => {
  try {
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
};

const saveStoredFavorites = (favs: Set<string>) => {
  try {
    localStorage.setItem(
      FAVORITES_STORAGE_KEY,
      JSON.stringify(Array.from(favs)),
    );
  } catch {
    // Ignore storage errors in sandbox/incognito
  }
};

const ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
  Zap,
  Activity,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ZoomIn,
  ZoomOut,
  Sun,
  Moon,
  FastForward,
  Minimize2,
  Download,
  Waves,
  Heart,
  Shuffle,
  Compass,
  RotateCw,
  RotateCcw,
  Type,
  Gem,
};

type CategoryFilter = "all" | "favorites" | MotionSubCategory;

export const MotionPresetSection: React.FC<MotionPresetSectionProps> = ({
  selectedClip,
  handleUpdateMultiple,
  canvasWidth = 1920,
  canvasHeight = 1080,
}) => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<MotionBehaviorCategory>("in");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>("all");
  const [favorites, setFavorites] = useState<Set<string>>(() =>
    getStoredFavorites(),
  );

  const toggleFavorite = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      saveStoredFavorites(next);
      return next;
    });
  }, []);

  const motion: ClipMotionConfig = selectedClip.motion ?? {};
  const hasIn = Boolean(motion.inPreset && motion.inPreset !== "none");
  const hasOut = Boolean(motion.outPreset && motion.outPreset !== "none");
  const hasLoop = Boolean(motion.loopPreset && motion.loopPreset !== "none");

  const updateMotion = useCallback(
    (updates: Partial<ClipMotionConfig>) => {
      const nextMotion: ClipMotionConfig = {
        ...motion,
        ...updates,
      };

      const compiledKeyframes = compileClipMotionKeyframes(
        selectedClip,
        nextMotion,
        canvasWidth,
        canvasHeight,
      );

      handleUpdateMultiple({
        motion: nextMotion,
        visualKeyframes: compiledKeyframes,
      });
    },
    [motion, selectedClip, canvasWidth, canvasHeight, handleUpdateMultiple],
  );

  // Active catalog according to active tab
  const currentCatalog = useMemo(() => {
    switch (activeTab) {
      case "in":
        return MOTION_IN_PRESETS;
      case "out":
        return MOTION_OUT_PRESETS;
      case "loop":
        return MOTION_LOOP_PRESETS;
    }
  }, [activeTab]);

  // Filter presets based on category and search query
  const filteredPresets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return currentCatalog.filter((preset) => {
      // Category filter
      if (activeCategory === "favorites" && !favorites.has(preset.id)) {
        return false;
      }
      if (
        activeCategory !== "all" &&
        activeCategory !== "favorites" &&
        preset.subCategory !== activeCategory
      ) {
        return false;
      }

      // Query filter
      if (q) {
        const matchesName = preset.name.toLowerCase().includes(q);
        const matchesDesc = preset.description.toLowerCase().includes(q);
        const matchesTags = preset.tags?.some((tag) =>
          tag.toLowerCase().includes(q),
        );
        if (!matchesName && !matchesDesc && !matchesTags) {
          return false;
        }
      }

      return true;
    });
  }, [currentCatalog, activeCategory, searchQuery, favorites]);

  const activePresetId =
    activeTab === "in"
      ? motion.inPreset
      : activeTab === "out"
        ? motion.outPreset
        : motion.loopPreset;

  const currentDuration =
    activeTab === "in"
      ? (motion.inDuration ?? 0.5)
      : activeTab === "out"
        ? (motion.outDuration ?? 0.5)
        : 0.5;

  const maxAllowedDuration = Math.max(
    0.5,
    Math.min(5.0, selectedClip.duration),
  );

  const handleDurationStep = useCallback(
    (delta: number) => {
      const next = Math.max(
        0.1,
        Math.min(maxAllowedDuration, +(currentDuration + delta).toFixed(2)),
      );
      if (activeTab === "in") {
        updateMotion({ inDuration: next });
      } else if (activeTab === "out") {
        updateMotion({ outDuration: next });
      }
    },
    [currentDuration, maxAllowedDuration, activeTab, updateMotion],
  );

  const handleSelectPreset = useCallback(
    (id: string) => {
      if (activeTab === "in") {
        updateMotion({ inPreset: id });
      } else if (activeTab === "out") {
        updateMotion({ outPreset: id });
      } else {
        updateMotion({ loopPreset: id });
      }
    },
    [activeTab, updateMotion],
  );

  return (
    <PropertySection
      title={t("properties.animation.title")}
      icon={<Sparkles className="w-3.5 h-3.5" />}
      defaultCollapsed={false}
      action={
        hasIn || hasOut || hasLoop ? (
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
        ) : undefined
      }
    >
      <div className="space-y-2.5">
        {/* ── 1. CapCut Phase Switcher Tabs (In, Out, Loop) ────────────────────── */}
        <div
          role="tablist"
          className="flex bg-[#1E1E20] p-0.5 rounded-lg border border-border/40"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "in"}
            aria-label="In (Build-In)"
            onClick={() => setActiveTab("in")}
            className={`flex-1 py-1.5 text-[11px] font-semibold rounded-md transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              activeTab === "in"
                ? "bg-[#2D2D32] text-white shadow-xs"
                : "text-text-muted hover:text-text-primary"
            }`}
          >
            {hasIn && (
              <span className="w-1.5 h-1.5 rounded-full bg-[#00E5FF]" />
            )}
            <span>{t("properties.animation.inDetailed")}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "out"}
            aria-label="Out (Build-Out)"
            onClick={() => setActiveTab("out")}
            className={`flex-1 py-1.5 text-[11px] font-semibold rounded-md transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              activeTab === "out"
                ? "bg-[#2D2D32] text-white shadow-xs"
                : "text-text-muted hover:text-text-primary"
            }`}
          >
            {hasOut && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            )}
            <span>{t("properties.animation.outDetailed")}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "loop"}
            aria-label="Loop"
            onClick={() => setActiveTab("loop")}
            className={`flex-1 py-1.5 text-[11px] font-semibold rounded-md transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              activeTab === "loop"
                ? "bg-[#2D2D32] text-white shadow-xs"
                : "text-text-muted hover:text-text-primary"
            }`}
          >
            {hasLoop && (
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
            )}
            <span>{t("properties.animation.loop")}</span>
          </button>
        </div>

        {/* ── 2. CapCut Search Bar ────────────────────────────────────────────── */}
        <div className="relative flex items-center bg-[#18181A] rounded-lg border border-border/40 px-2.5 py-1 focus-within:border-[#00E5FF]/60 focus-within:ring-1 focus-within:ring-[#00E5FF]/30 transition-all">
          <Search className="w-3.5 h-3.5 text-text-muted shrink-0 mr-2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("properties.animation.searchPlaceholder")}
            className="bg-transparent text-[11px] text-text-primary placeholder:text-text-muted/60 outline-none w-full"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="text-text-muted hover:text-text-primary p-0.5"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* ── 3. Category Filter Pills ────────────────────────────────────────── */}
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5">
          {/* Favorite Star Pill */}
          <button
            type="button"
            onClick={() =>
              setActiveCategory(
                activeCategory === "favorites" ? "all" : "favorites",
              )
            }
            title={t("properties.animation.favorites")}
            className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
              activeCategory === "favorites"
                ? "bg-amber-400/20 text-amber-400 border border-amber-400/50"
                : "bg-[#242428] text-text-muted hover:text-text-primary hover:bg-[#2E2E34]"
            }`}
          >
            <Star
              className={`w-3 h-3 ${
                activeCategory === "favorites"
                  ? "fill-amber-400 text-amber-400"
                  : ""
              }`}
            />
          </button>

          {/* All Pill */}
          <button
            type="button"
            onClick={() => setActiveCategory("all")}
            className={`px-2.5 py-0.5 rounded-full text-[10px] font-medium shrink-0 transition-colors cursor-pointer ${
              activeCategory === "all"
                ? "bg-[#3A3A40] text-white font-semibold"
                : "bg-[#242428] text-text-muted hover:text-text-primary hover:bg-[#2E2E34]"
            }`}
          >
            {t("properties.animation.categories.all")}
          </button>

          {/* Basic Pill */}
          <button
            type="button"
            onClick={() => setActiveCategory("Basic")}
            className={`px-2.5 py-0.5 rounded-full text-[10px] font-medium shrink-0 transition-colors cursor-pointer ${
              activeCategory === "Basic"
                ? "bg-[#3A3A40] text-white font-semibold"
                : "bg-[#242428] text-text-muted hover:text-text-primary hover:bg-[#2E2E34]"
            }`}
          >
            {t("properties.animation.categories.basic")}
          </button>

          {/* Motion Pill */}
          <button
            type="button"
            onClick={() => setActiveCategory("Motion")}
            className={`px-2.5 py-0.5 rounded-full text-[10px] font-medium shrink-0 transition-colors cursor-pointer ${
              activeCategory === "Motion"
                ? "bg-[#3A3A40] text-white font-semibold"
                : "bg-[#242428] text-text-muted hover:text-text-primary hover:bg-[#2E2E34]"
            }`}
          >
            {t("properties.animation.categories.motion")}
          </button>

          {/* 3D Pill */}
          <button
            type="button"
            onClick={() => setActiveCategory("3D")}
            className={`px-2.5 py-0.5 rounded-full text-[10px] font-medium shrink-0 transition-colors cursor-pointer ${
              activeCategory === "3D"
                ? "bg-[#3A3A40] text-white font-semibold"
                : "bg-[#242428] text-text-muted hover:text-text-primary hover:bg-[#2E2E34]"
            }`}
          >
            {t("properties.animation.categories.3d")}
          </button>

          {/* Glitch Pill */}
          <button
            type="button"
            onClick={() => setActiveCategory("Glitch")}
            className={`px-2.5 py-0.5 rounded-full text-[10px] font-medium shrink-0 transition-colors cursor-pointer ${
              activeCategory === "Glitch"
                ? "bg-[#3A3A40] text-white font-semibold"
                : "bg-[#242428] text-text-muted hover:text-text-primary hover:bg-[#2E2E34]"
            }`}
          >
            {t("properties.animation.categories.glitch")}
          </button>
        </div>

        {/* ── 4. CapCut 5-Column Preset Card Grid ──────────────────────────────── */}
        <div className="grid grid-cols-5 gap-2 max-h-[320px] overflow-y-auto pr-0.5 scrollbar-thin">
          {/* Card 0: None */}
          <button
            type="button"
            onClick={() => handleSelectPreset("none")}
            className="flex flex-col items-center group cursor-pointer text-left"
          >
            <div
              className={`w-full aspect-square rounded-lg flex flex-col items-center justify-center transition-all relative ${
                !activePresetId || activePresetId === "none"
                  ? "border-2 border-[#00E5FF] shadow-[0_0_8px_rgba(0,229,255,0.35)] bg-[#00E5FF]/10 text-[#00E5FF]"
                  : "bg-[#202024] border border-border/30 text-text-muted hover:border-border hover:bg-[#28282E]"
              }`}
            >
              <Ban className="w-5 h-5 opacity-80" />
            </div>
            <span className="text-[10px] font-medium text-text-muted mt-1 truncate max-w-full group-hover:text-text-primary">
              {t("properties.animation.none")}
            </span>
          </button>

          {/* Preset Cards 1..N */}
          {filteredPresets.map((preset) => {
            const isSelected = activePresetId === preset.id;
            const isFavorite = favorites.has(preset.id);
            const IconComp = ICON_MAP[preset.icon] || Sparkles;

            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleSelectPreset(preset.id)}
                title={preset.description}
                className="flex flex-col items-center group cursor-pointer text-left relative"
              >
                <div
                  className={`w-full aspect-square rounded-lg flex flex-col items-center justify-center transition-all relative overflow-hidden ${
                    isSelected
                      ? "border-2 border-[#00E5FF] shadow-[0_0_10px_rgba(0,229,255,0.4)] bg-[#00E5FF]/10"
                      : "bg-[#202024] border border-border/30 hover:border-border/80 hover:bg-[#28282E]"
                  }`}
                >
                  {/* Pro Badge (Top-Left) */}
                  {preset.isPro && (
                    <span className="absolute top-1 left-1 z-10">
                      <Gem className="w-2.5 h-2.5 text-purple-400 fill-purple-400/30" />
                    </span>
                  )}

                  {/* Favorite Toggle (Top-Right on hover/active) */}
                  <span
                    onClick={(e) => toggleFavorite(preset.id, e)}
                    className={`absolute top-1 right-1 z-10 p-0.5 rounded hover:bg-black/40 transition-opacity ${
                      isFavorite
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100"
                    }`}
                  >
                    <Star
                      className={`w-2.5 h-2.5 ${
                        isFavorite
                          ? "fill-amber-400 text-amber-400"
                          : "text-white/60 hover:text-white"
                      }`}
                    />
                  </span>

                  {/* Center Mini-Stage / Visual Thumbnail */}
                  <div className="flex flex-col items-center justify-center w-full h-full p-1 group-hover:scale-105 transition-transform duration-200">
                    <span className="text-[10px] font-black tracking-tight text-white/90 select-none">
                      ABC123
                    </span>
                    <IconComp
                      className={`w-3 h-3 mt-0.5 transition-colors ${
                        isSelected
                          ? "text-[#00E5FF]"
                          : "text-text-muted group-hover:text-white"
                      }`}
                    />
                  </div>

                  {/* Download indicator badge (Bottom-Right) */}
                  <span className="absolute bottom-1 right-1 opacity-40 group-hover:opacity-80 transition-opacity">
                    <Download className="w-2 h-2 text-white" />
                  </span>
                </div>

                {/* Preset Label Underneath */}
                <span
                  className={`text-[10px] font-medium mt-1 truncate max-w-full text-center transition-colors ${
                    isSelected
                      ? "text-[#00E5FF] font-semibold"
                      : "text-text-muted group-hover:text-text-primary"
                  }`}
                >
                  {preset.name}
                </span>
              </button>
            );
          })}
        </div>

        {/* ── 5. CapCut Pinned Bottom Duration Bar (when In or Out preset is active) ── */}
        {(activeTab === "in"
          ? hasIn
          : activeTab === "out"
            ? hasOut
            : false) && (
          <div className="pt-2 border-t border-border/30 flex items-center gap-2.5 bg-surface-base/90">
            <span className="text-[11px] font-medium text-text-muted shrink-0 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {t("properties.animation.duration")}
            </span>

            {/* Stepper Input: [ 0.5s ↕ ] */}
            <div className="flex items-center bg-[#1B1B1E] border border-border/40 rounded-md px-1.5 py-0.5 shrink-0">
              <span className="text-[11px] font-semibold text-text-primary tabular-nums mr-1">
                {currentDuration.toFixed(1)}s
              </span>
              <div className="flex flex-col -space-y-1">
                <button
                  type="button"
                  onClick={() => handleDurationStep(0.05)}
                  className="hover:text-[#00E5FF] text-text-muted p-0.5"
                >
                  <ChevronUp className="w-2.5 h-2.5" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDurationStep(-0.05)}
                  className="hover:text-[#00E5FF] text-text-muted p-0.5"
                >
                  <ChevronDown className="w-2.5 h-2.5" />
                </button>
              </div>
            </div>

            {/* Continuous Slider Track */}
            <input
              type="range"
              min={0.1}
              max={maxAllowedDuration}
              step={0.05}
              value={currentDuration}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                if (activeTab === "in") {
                  updateMotion({ inDuration: val });
                } else if (activeTab === "out") {
                  updateMotion({ outDuration: val });
                }
              }}
              className="flex-1 h-1 bg-[#333338] rounded-lg appearance-none cursor-pointer accent-[#00E5FF]"
            />
          </div>
        )}

        {/* ── 6. Loop Speed & Intensity Controls (when Loop tab is active and has loop) ── */}
        {activeTab === "loop" && hasLoop && (
          <div className="space-y-2 pt-2 border-t border-border/30">
            <PropertySlider
              label={t("properties.animation.speed")}
              value={motion.loopSpeed ?? 1.0}
              min={0.2}
              max={3.0}
              step={0.1}
              suffix="x"
              decimals={1}
              icon={<Gauge className="w-3 h-3 text-text-muted" />}
              onChange={(val) => updateMotion({ loopSpeed: val })}
            />

            <PropertySlider
              label={t("properties.animation.intensity")}
              value={motion.loopIntensity ?? 1.0}
              min={0.2}
              max={2.5}
              step={0.1}
              decimals={1}
              icon={<Activity className="w-3 h-3 text-text-muted" />}
              onChange={(val) => updateMotion({ loopIntensity: val })}
            />
          </div>
        )}
      </div>
    </PropertySection>
  );
};

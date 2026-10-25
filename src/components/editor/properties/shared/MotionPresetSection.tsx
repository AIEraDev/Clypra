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
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import type { Clip } from "@/types";
import type {
  ClipMotionConfig,
  MotionBehaviorCategory,
  MotionSubCategory,
} from "@/types/motion";
import { compileClipMotionKeyframes } from "@/core/animation/motionPresets";
import {
  useAnimationPhase,
  useTextAnimationCatalog,
  downloadAnimationPreset,
} from "@/features/text-animations/animationCatalog";
import { useI18n } from "@/i18n";
import { PropertySection } from "../primitives/PropertySection";
import { SliderTrack } from "../primitives/SliderTrack";
import { NumericControl } from "../primitives/NumericControl";

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
  const animationCatalog = useTextAnimationCatalog();
  // Phase-specific snapshot — triggers a lazy fetch the first time each tab is opened.
  const phaseData = useAnimationPhase(activeTab);

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
        animationCatalog.presets,
      );

      handleUpdateMultiple({
        motion: nextMotion,
        visualKeyframes: compiledKeyframes,
      });
    },
    [
      motion,
      selectedClip,
      canvasWidth,
      canvasHeight,
      handleUpdateMultiple,
      animationCatalog.presets,
    ],
  );

  // Active catalog comes directly from the per-phase snapshot — no redundant filter.
  const currentCatalog = phaseData.presets;

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
      if (id === "none") {
        // Clear the active preset for this phase without downloading anything.
        if (activeTab === "in") {
          updateMotion({ inPreset: "none" });
        } else if (activeTab === "out") {
          updateMotion({ outPreset: "none" });
        } else {
          updateMotion({ loopPreset: "none" });
        }
        return;
      }

      // Find the catalog-index entry so we have the revisionId for the revision route.
      const catalogEntry = phaseData.presets.find((p) => p.id === id);

      // Apply the preset optimistically from the catalog index entry first so
      // the UI responds immediately, then download the full revision and
      // update the compiled keyframes once it arrives.
      if (activeTab === "in") {
        updateMotion({ inPreset: id });
      } else if (activeTab === "out") {
        updateMotion({ outPreset: id });
      } else {
        updateMotion({ loopPreset: id });
      }

      // Download the immutable revision and cache it in-memory so the
      // compositor can always resolve this preset's tracks for the session.
      if (catalogEntry) {
        void downloadAnimationPreset(catalogEntry);
      }
    },
    [activeTab, updateMotion, phaseData.presets],
  );

  return (
    <div className="space-y-1.5 select-none text-white relative p-2">
      {/* ── 1. CapCut Phase Switcher Tabs (In, Out, Loop) ────────────────────── */}
      <div className="bg-panel p-0.5 rounded-sm flex gap-1 border border-white/5">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "in"}
          aria-label="In"
          onClick={() => setActiveTab("in")}
          className={`flex-1 py-0.5 text-xs rounded-sm transition-all text-center capitalize flex items-center justify-center gap-1 ${
            activeTab === "in"
              ? "bg-[#38383e] text-white shadow-sm font-semibold cursor-pointer"
              : "text-[#8e8e93] hover:text-white cursor-pointer"
          }`}
        >
          {hasIn && <span className="w-1.5 h-1.5 rounded-full bg-[#00E5FF]" />}
          <span>{t("properties.animation.inDetailed")}</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "out"}
          aria-label="Out"
          onClick={() => setActiveTab("out")}
          className={`flex-1 py-0.5 text-xs rounded-sm transition-all text-center capitalize flex items-center justify-center gap-1 ${
            activeTab === "out"
              ? "bg-[#38383e] text-white shadow-sm font-semibold cursor-pointer"
              : "text-[#8e8e93] hover:text-white cursor-pointer"
          }`}
        >
          {hasOut && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
          <span>{t("properties.animation.outDetailed")}</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "loop"}
          aria-label="Loop"
          onClick={() => setActiveTab("loop")}
          className={`flex-1 py-0.5 text-xs rounded-sm transition-all text-center capitalize flex items-center justify-center gap-1 ${
            activeTab === "loop"
              ? "bg-[#38383e] text-white shadow-sm font-semibold cursor-pointer"
              : "text-[#8e8e93] hover:text-white cursor-pointer"
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
      {/* <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5"> */}
      {/* Favorite Star Pill */}
      {/* <button
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
        </button> */}

      {/* All Pill */}
      {/* <button
          type="button"
          onClick={() => setActiveCategory("all")}
          className={`px-2.5 py-0.5 rounded-full text-[10px] font-medium shrink-0 transition-colors cursor-pointer ${
            activeCategory === "all"
              ? "bg-[#3A3A40] text-white font-semibold"
              : "bg-[#242428] text-text-muted hover:text-text-primary hover:bg-[#2E2E34]"
          }`}
        >
          {t("properties.animation.categories.all")}
        </button> */}

      {/* Basic Pill */}
      {/* <button
          type="button"
          onClick={() => setActiveCategory("Basic")}
          className={`px-2.5 py-0.5 rounded-full text-[10px] font-medium shrink-0 transition-colors cursor-pointer ${
            activeCategory === "Basic"
              ? "bg-[#3A3A40] text-white font-semibold"
              : "bg-[#242428] text-text-muted hover:text-text-primary hover:bg-[#2E2E34]"
          }`}
        >
          {t("properties.animation.categories.basic")}
        </button> */}

      {/* Motion Pill */}
      {/* <button
          type="button"
          onClick={() => setActiveCategory("Motion")}
          className={`px-2.5 py-0.5 rounded-full text-[10px] font-medium shrink-0 transition-colors cursor-pointer ${
            activeCategory === "Motion"
              ? "bg-[#3A3A40] text-white font-semibold"
              : "bg-[#242428] text-text-muted hover:text-text-primary hover:bg-[#2E2E34]"
          }`}
        >
          {t("properties.animation.categories.motion")}
        </button> */}

      {/* 3D Pill */}
      {/* <button
          type="button"
          onClick={() => setActiveCategory("3D")}
          className={`px-2.5 py-0.5 rounded-full text-[10px] font-medium shrink-0 transition-colors cursor-pointer ${
            activeCategory === "3D"
              ? "bg-[#3A3A40] text-white font-semibold"
              : "bg-[#242428] text-text-muted hover:text-text-primary hover:bg-[#2E2E34]"
          }`}
        >
          {t("properties.animation.categories.3d")}
        </button> */}

      {/* Glitch Pill */}
      {/* <button
          type="button"
          onClick={() => setActiveCategory("Glitch")}
          className={`px-2.5 py-0.5 rounded-full text-[10px] font-medium shrink-0 transition-colors cursor-pointer ${
            activeCategory === "Glitch"
              ? "bg-[#3A3A40] text-white font-semibold"
              : "bg-[#242428] text-text-muted hover:text-text-primary hover:bg-[#2E2E34]"
          }`}
        >
          {t("properties.animation.categories.glitch")}
        </button> */}
      {/* </div> */}

      {/* ── 4. CapCut 5-Column Preset Card Grid ──────────────────────────────── */}
      {phaseData.status === "error" && currentCatalog.length === 0 && (
        <div className="rounded-md border border-amber-400/20 bg-amber-400/5 p-2 text-[10px] text-amber-200">
          Animation catalog is unavailable. Reconnect to load published presets.
        </div>
      )}
      <div className="grid grid-cols-5 gap-2 max-h-[320px] overflow-y-auto pr-0.5 scrollbar-thin">
        {/* Card 0: None — always first */}
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

        {/* Skeleton cards — shown while the phase catalog is loading */}
        {phaseData.status === "loading" &&
          currentCatalog.length === 0 &&
          Array.from({ length: 9 }).map((_, i) => (
            <div key={`skel-${i}`} className="flex flex-col items-center">
              <div className="w-full aspect-square rounded-lg bg-[#202024] border border-border/20 overflow-hidden relative">
                <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.4s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
              </div>
              <div className="mt-1 h-2 w-3/4 rounded bg-[#202024] overflow-hidden relative">
                <div
                  className="absolute inset-0 -translate-x-full animate-[shimmer_1.4s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/[0.06] to-transparent"
                  style={{ animationDelay: `${i * 0.08}s` }}
                />
              </div>
            </div>
          ))}

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
      {(activeTab === "in" ? hasIn : activeTab === "out" ? hasOut : false) && (
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
        <div className="space-y-3 pt-2 border-t border-border/30">
          {/* Speed control */}
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <Gauge className="w-3 h-3 text-text-muted" />
              <span className="text-[11px] text-white select-none block">
                {t("properties.animation.speed")}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <SliderTrack
                value={motion.loopSpeed ?? 1.0}
                min={0.2}
                max={3.0}
                step={0.1}
                onChange={(val) => updateMotion({ loopSpeed: val })}
              />
              <NumericControl
                value={motion.loopSpeed ?? 1.0}
                onChange={(val) => updateMotion({ loopSpeed: val })}
                step={0.1}
                suffix="x"
                ariaLabel={t("properties.animation.speed")}
                min={0.2}
                max={3.0}
                inputPosition="text-right"
                decimals={1}
              />
            </div>
          </div>

          {/* Intensity control */}
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <Activity className="w-3 h-3 text-text-muted" />
              <span className="text-[11px] text-white select-none block">
                {t("properties.animation.intensity")}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <SliderTrack
                value={motion.loopIntensity ?? 1.0}
                min={0.2}
                max={2.5}
                step={0.1}
                onChange={(val) => updateMotion({ loopIntensity: val })}
              />
              <NumericControl
                value={motion.loopIntensity ?? 1.0}
                onChange={(val) => updateMotion({ loopIntensity: val })}
                step={0.1}
                ariaLabel={t("properties.animation.intensity")}
                min={0.2}
                max={2.5}
                inputPosition="text-right"
                decimals={1}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

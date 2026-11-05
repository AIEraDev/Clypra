/**
 * MediaAnimationSection — Animation browser for Video and Image clips.
 *
 * Mirrors MotionPresetSection but:
 * - Tabs: In / Out / Combo (no Loop)
 * - Fetches from /media-animations catalog (positionX/Y slide presets)
 * - Shows thumbnail images on preset cards when available
 * - On hover: plays previewUrl video from the start; on blur: pauses and
 *   reverts to the thumbnail image
 * - Combo tab shows "Coming soon" placeholder when empty
 */

import React, { useState, useCallback, useMemo, useRef } from "react";
import { Ban, Search, X, Star, ChevronUp, ChevronDown } from "lucide-react";
import type { Clip } from "@/types";
import type { ClipMotionConfig } from "@/types/motion";
import { compileClipMotionKeyframes } from "@/core/animation/motionPresets";
import {
  useMediaAnimationCategory,
  useMediaAnimationCatalogSnapshot,
  type MediaAnimationCategory,
} from "./mediaAnimationCatalog";
import { useI18n } from "@/i18n";
import { SliderTrack } from "@/components/editor/properties/primitives/SliderTrack";
import { NumericControl } from "@/components/editor/properties/primitives/NumericControl";
import PresetCard from "./PresetCard";

interface MediaAnimationSectionProps {
  selectedClip: Clip;
  handleUpdateMultiple: (fields: Record<string, any>) => void;
  canvasWidth?: number;
  canvasHeight?: number;
}

const FAVORITES_KEY = "clypra_favorite_media_animation_presets";

const getStoredFavorites = (): Set<string> => {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
};

const saveStoredFavorites = (favs: Set<string>) => {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(favs)));
  } catch {}
};

type CategoryFilter = "all" | "favorites";

// ── MediaAnimationSection ─────────────────────────────────────────────────────

export const MediaAnimationSection: React.FC<MediaAnimationSectionProps> = ({
  selectedClip,
  handleUpdateMultiple,
  canvasWidth = 1920,
  canvasHeight = 1080,
}) => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<MediaAnimationCategory>("in");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>("all");
  const [favorites, setFavorites] = useState<Set<string>>(() =>
    getStoredFavorites(),
  );

  const catalogSnapshot = useMediaAnimationCatalogSnapshot();
  const phaseData = useMediaAnimationCategory(activeTab);

  const toggleFavorite = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveStoredFavorites(next);
      return next;
    });
  }, []);

  const motion: ClipMotionConfig = selectedClip.motion ?? {};
  const hasIn = Boolean(motion.inPreset && motion.inPreset !== "none");
  const hasOut = Boolean(motion.outPreset && motion.outPreset !== "none");

  const updateMotion = useCallback(
    (updates: Partial<ClipMotionConfig>) => {
      const nextMotion: ClipMotionConfig = { ...motion, ...updates };
      const compiledKeyframes = compileClipMotionKeyframes(
        selectedClip,
        nextMotion,
        canvasWidth,
        canvasHeight,
        catalogSnapshot.presets,
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
      catalogSnapshot.presets,
    ],
  );

  const currentCatalog = phaseData.presets;

  const filteredPresets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return currentCatalog.filter((preset) => {
      if (activeCategory === "favorites" && !favorites.has(preset.id))
        return false;
      if (q) {
        const matchesName = preset.name.toLowerCase().includes(q);
        const matchesDesc = preset.description.toLowerCase().includes(q);
        const matchesTags = preset.tags?.some((tag) =>
          tag.toLowerCase().includes(q),
        );
        if (!matchesName && !matchesDesc && !matchesTags) return false;
      }
      return true;
    });
  }, [currentCatalog, activeCategory, searchQuery, favorites]);

  const activePresetId =
    activeTab === "in"
      ? motion.inPreset
      : activeTab === "out"
        ? motion.outPreset
        : motion.inPreset; // combo stored as inPreset

  const currentDuration =
    activeTab === "in"
      ? (motion.inDuration ?? 0.5)
      : (motion.outDuration ?? 0.5);

  const maxAllowedDuration = Math.max(
    0.5,
    Math.min(5.0, selectedClip.duration),
  );

  const handleDurationStep = useCallback(
    (delta: number) => {
      if (activeTab === "combo") return; // combo has fixed timing
      const next = Math.max(
        0.1,
        Math.min(maxAllowedDuration, +(currentDuration + delta).toFixed(2)),
      );
      updateMotion(
        activeTab === "in" ? { inDuration: next } : { outDuration: next },
      );
    },
    [currentDuration, maxAllowedDuration, activeTab, updateMotion],
  );

  const handleSelectPreset = useCallback(
    (id: string) => {
      if (id === "none") {
        if (activeTab === "in" || activeTab === "combo")
          updateMotion({ inPreset: "none" });
        else updateMotion({ outPreset: "none" });
        return;
      }
      if (activeTab === "in") updateMotion({ inPreset: id });
      else if (activeTab === "out") updateMotion({ outPreset: id });
      else updateMotion({ inPreset: id }); // combo
    },
    [activeTab, updateMotion],
  );

  return (
    <div className="space-y-1.5 select-none text-white relative p-2">
      {/* ── Tabs: In / Out / Combo ── */}
      <div className="bg-panel p-0.5 rounded-sm flex gap-1 border border-white/5">
        {(["in", "out", "combo"] as MediaAnimationCategory[]).map((tab) => {
          const isActive = activeTab === tab;
          const hasDot = tab === "in" ? hasIn : tab === "out" ? hasOut : false;
          const dotColor =
            tab === "in"
              ? "bg-[#00E5FF]"
              : tab === "out"
                ? "bg-amber-400"
                : "bg-purple-400";
          const label =
            tab === "in"
              ? t("properties.animation.inDetailed")
              : tab === "out"
                ? t("properties.animation.outDetailed")
                : t("properties.mediaAnimation.combo");
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-0.5 text-xs rounded-sm transition-all text-center capitalize flex items-center justify-center gap-1 cursor-pointer ${
                isActive
                  ? "bg-[#38383e] text-white shadow-sm font-semibold"
                  : "text-[#8e8e93] hover:text-white"
              }`}
            >
              {hasDot && (
                <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
              )}
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      {/* ── Search ── */}
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

      {/* ── Error banner ── */}
      {phaseData.status === "error" && currentCatalog.length === 0 && (
        <div className="rounded-md border border-amber-400/20 bg-amber-400/5 p-2 text-[10px] text-amber-200">
          Media animation catalog is unavailable. Reconnect to load published
          presets.
        </div>
      )}

      {/* ── Preset Grid ── */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-2 max-h-80 overflow-y-auto pr-0.5 scrollbar-thin">
        {/* None card */}
        <button
          type="button"
          onClick={() => handleSelectPreset("none")}
          className="flex flex-col items-center group cursor-pointer text-left"
        >
          <div
            className={`w-full h-16 rounded-md flex flex-col items-center justify-center transition-all relative ${
              !activePresetId || activePresetId === "none"
                ? "bg-accent/10 text-gray-50"
                : "bg-accent/10 border border-accent/30 text-text-muted"
            }`}
          >
            <Ban className="w-5 h-5 opacity-80" />
          </div>
          <span
            title="None"
            className="text-[10px] font-medium text-text-muted mt-0.5 truncate max-w-full group-hover:text-text-primary"
          >
            {t("properties.animation.none")}
          </span>
        </button>

        {/* Combo empty state */}
        {activeTab === "combo" &&
          filteredPresets.length === 0 &&
          phaseData.status !== "loading" && (
            <div className="col-span-4 flex items-center justify-center py-8 text-[11px] text-text-muted">
              {t("properties.mediaAnimation.comboComingSoon")}
            </div>
          )}

        {/* Loading skeletons */}
        {phaseData.status === "loading" &&
          Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center">
              <div className="w-full h-16 rounded-md bg-accent/10 animate-pulse" />
            </div>
          ))}

        {/* Preset cards */}
        {filteredPresets.map((preset) => (
          <PresetCard
            key={preset.id}
            name={preset.name}
            icon={preset.icon}
            thumbnailUrl={(preset as any).thumbnailUrl as string | undefined}
            previewUrl={(preset as any).previewUrl as string | undefined}
            isSelected={activePresetId === preset.id}
            isFavorite={favorites.has(preset.id)}
            onSelect={() => handleSelectPreset(preset.id)}
            onToggleFavorite={(e) => toggleFavorite(preset.id, e)}
          />
        ))}
      </div>

      {/* ── Duration slider (In/Out only) ── */}
      {activeTab !== "combo" && activePresetId && activePresetId !== "none" && (
        <div className="pt-2 border-t border-white/5 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-text-muted">
              {t("properties.animation.duration")}
            </span>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => handleDurationStep(-0.1)}
                className="p-0.5 rounded hover:bg-white/10 text-text-muted hover:text-white"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
              <NumericControl
                value={currentDuration}
                min={0.1}
                max={maxAllowedDuration}
                step={0.1}
                onChange={(v: number) =>
                  updateMotion(
                    activeTab === "in" ? { inDuration: v } : { outDuration: v },
                  )
                }
              />
              <button
                type="button"
                onClick={() => handleDurationStep(0.1)}
                className="p-0.5 rounded hover:bg-white/10 text-text-muted hover:text-white"
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <SliderTrack
            value={currentDuration}
            min={0.1}
            max={maxAllowedDuration}
            step={0.01}
            onChange={(v) =>
              updateMotion(
                activeTab === "in" ? { inDuration: v } : { outDuration: v },
              )
            }
          />
        </div>
      )}
    </div>
  );
};

export default MediaAnimationSection;

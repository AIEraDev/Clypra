/**
 * Motion Preset & Kinetic Behavior Inspector Section.
 *
 * Provides CapCut-parity animation browsing and preset compilation for text clips:
 * - In, Out, Loop segmented tabs
 * - Real-time search across names, tags, and descriptions
 * - Favorites toggle filter (All vs. Favorites)
 * - All three PhaseGrids (in/out/loop) are always mounted; the active tab uses
 *   `contents` display while inactive use `hidden`, preserving fetch lifecycles and scroll
 * - Gated lazy fetching on first tab visit via visitedTabs set
 * - Pinned bottom duration slider and numeric stepper for In/Out
 * - Loop speed and intensity controls for Loop
 * - Compiles high-level presets into responsive visualKeyframes
 */

import React, { useState, useCallback, useRef, useEffect } from "react";
import { Gauge, Activity, Search, X, Star } from "lucide-react";
import type { Clip } from "@/types";
import type { ClipMotionConfig, MotionBehaviorCategory } from "@/types/motion";
import { compileClipMotionKeyframes } from "@/core/animation/motionPresets";
import {
  useTextAnimationCatalog,
  downloadAnimationPreset,
  getTextAnimationPreset,
} from "@/features/text-animations/animationCatalog";
import { textAnimationCacheManager } from "@/features/text-animations/cache/textAnimationCache";
import { useI18n } from "@/i18n";
import PhaseGrid, {
  type CategoryFilter,
} from "@/features/text-animations/PhaseGrid";
import { SliderTrack } from "../primitives/SliderTrack";
import { NumericControl } from "../primitives/NumericControl";

interface MotionPresetSectionProps {
  selectedClip: Clip;
  handleUpdateMultiple: (fields: Record<string, any>) => void;
  canvasWidth?: number;
  canvasHeight?: number;
  activeTab?: MotionBehaviorCategory;
  onTabChange?: (tab: MotionBehaviorCategory) => void;
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

export const MotionPresetSection: React.FC<MotionPresetSectionProps> = ({
  selectedClip,
  handleUpdateMultiple,
  canvasWidth = 1920,
  canvasHeight = 1080,
  activeTab: controlledActiveTab,
  onTabChange,
}) => {
  const { t } = useI18n();
  const [internalActiveTab, setInternalActiveTab] =
    useState<MotionBehaviorCategory>("in");
  const activeTab = controlledActiveTab ?? internalActiveTab;
  const [visitedTabs, setVisitedTabs] = useState<Set<MotionBehaviorCategory>>(
    () => new Set<MotionBehaviorCategory>([controlledActiveTab ?? "in"]),
  );

  useEffect(() => {
    if (controlledActiveTab) {
      setVisitedTabs((prev) => {
        if (prev.has(controlledActiveTab)) return prev;
        const next = new Set(prev);
        next.add(controlledActiveTab);
        return next;
      });
    }
  }, [controlledActiveTab]);

  const handleTabChange = useCallback(
    (tab: MotionBehaviorCategory) => {
      if (onTabChange) {
        onTabChange(tab);
      } else {
        setInternalActiveTab(tab);
      }
      setVisitedTabs((prev) => {
        if (prev.has(tab)) return prev;
        const next = new Set(prev);
        next.add(tab);
        return next;
      });
    },
    [onTabChange],
  );

  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<CategoryFilter>("all");
  const [favorites, setFavorites] = useState<Set<string>>(() =>
    getStoredFavorites(),
  );
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(() => {
    const keys = Array.from(textAnimationCacheManager.manifests.keys()).map(
      (k) => k.split("@")[0],
    );
    return new Set(keys);
  });

  useEffect(() => {
    return textAnimationCacheManager.onHydrated(() => {
      setDownloadedIds((prev) => {
        const keys = Array.from(textAnimationCacheManager.manifests.keys()).map(
          (k) => k.split("@")[0],
        );
        return new Set([...prev, ...keys]);
      });
    });
  }, []);

  const animationCatalog = useTextAnimationCatalog();

  const motion: ClipMotionConfig = selectedClip.motion ?? {};
  const hasIn = Boolean(motion.inPreset && motion.inPreset !== "none");
  const hasOut = Boolean(motion.outPreset && motion.outPreset !== "none");
  const hasLoop = Boolean(motion.loopPreset && motion.loopPreset !== "none");

  const latestSelectedClipRef = useRef(selectedClip);
  latestSelectedClipRef.current = selectedClip;
  const latestMotionRef = useRef(motion);
  latestMotionRef.current = motion;

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

  const updateMotion = useCallback(
    (updates: Partial<ClipMotionConfig>) => {
      const nextMotion: ClipMotionConfig = {
        ...latestMotionRef.current,
        ...updates,
      };
      latestMotionRef.current = nextMotion;

      const mergedCatalog = animationCatalog.presets.map((p) => {
        const merged = getTextAnimationPreset(p.id);
        return merged ?? p;
      });

      const currentClip = latestSelectedClipRef.current;
      const compiledKeyframes = compileClipMotionKeyframes(
        currentClip,
        nextMotion,
        canvasWidth,
        canvasHeight,
        mergedCatalog,
      );

      handleUpdateMultiple({
        motion: nextMotion,
        visualKeyframes: compiledKeyframes,
        ...(currentClip.kind === "text"
          ? { entranceAnimation: undefined, exitAnimation: undefined }
          : {}),
      });
    },
    [canvasWidth, canvasHeight, handleUpdateMultiple, animationCatalog.presets],
  );

  const handleDownload = useCallback(
    async (
      phase: MotionBehaviorCategory,
      presetId: string,
      e?: React.MouseEvent,
      motionOverride?: ClipMotionConfig,
    ) => {
      e?.stopPropagation();
      if (downloadingIds.has(presetId)) return;
      const preset = getTextAnimationPreset(presetId);
      const version = preset?.revisionId;
      if (!version) {
        const updates: Partial<ClipMotionConfig> =
          phase === "in"
            ? { inPreset: presetId }
            : phase === "out"
              ? { outPreset: presetId }
              : { loopPreset: presetId };
        updateMotion(updates);
        return;
      }
      setDownloadingIds((prev) => new Set(prev).add(presetId));
      try {
        await downloadAnimationPreset(preset);
        setDownloadedIds((prev) => new Set(prev).add(presetId));

        const targetMotion: ClipMotionConfig =
          motionOverride ?? latestMotionRef.current;
        const isActivePreset =
          targetMotion.inPreset === presetId ||
          targetMotion.outPreset === presetId ||
          targetMotion.loopPreset === presetId;
        if (!isActivePreset && !motionOverride) return;

        const currentMotion: ClipMotionConfig = { ...targetMotion };
        const freshCatalog = animationCatalog.presets.map((p) => {
          const cached = getTextAnimationPreset(p.id);
          return cached ?? p;
        });
        const currentClip = latestSelectedClipRef.current;
        const recompiledKeyframes = compileClipMotionKeyframes(
          currentClip,
          currentMotion,
          canvasWidth,
          canvasHeight,
          freshCatalog,
        );
        handleUpdateMultiple({
          motion: currentMotion,
          visualKeyframes: recompiledKeyframes,
          ...(currentClip.kind === "text"
            ? { entranceAnimation: undefined, exitAnimation: undefined }
            : {}),
        });
      } catch (err) {
        console.error("[MotionPresetSection] Download failed:", err);
      } finally {
        setDownloadingIds((prev) => {
          const next = new Set(prev);
          next.delete(presetId);
          return next;
        });
      }
    },
    [
      downloadingIds,
      animationCatalog.presets,
      canvasWidth,
      canvasHeight,
      handleUpdateMultiple,
      updateMotion,
    ],
  );

  const presetIdForPhase = useCallback(
    (phase: MotionBehaviorCategory): string | undefined => {
      if (phase === "in") return motion.inPreset;
      if (phase === "out") return motion.outPreset;
      return motion.loopPreset;
    },
    [motion.inPreset, motion.outPreset, motion.loopPreset],
  );

  const handleSelectPreset = useCallback(
    (phase: MotionBehaviorCategory, id: string) => {
      if (id === "none") {
        if (phase === "in") {
          updateMotion({ inPreset: "none" });
        } else if (phase === "out") {
          updateMotion({ outPreset: "none" });
        } else {
          updateMotion({ loopPreset: "none" });
        }
        return;
      }

      const updates: Partial<ClipMotionConfig> =
        phase === "in"
          ? { inPreset: id }
          : phase === "out"
            ? { outPreset: id }
            : { loopPreset: id };

      const targetMotion: ClipMotionConfig = {
        ...latestMotionRef.current,
        ...updates,
      };

      updateMotion(updates);

      const preset = getTextAnimationPreset(id);
      const version = preset?.revisionId;
      if (version && !textAnimationCacheManager.isCached(id, version)) {
        void handleDownload(phase, id, undefined, targetMotion);
      }
    },
    [updateMotion, handleDownload],
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
          onClick={() => handleTabChange("in")}
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
          onClick={() => handleTabChange("out")}
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
          onClick={() => handleTabChange("loop")}
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

      {/* ── 2. CapCut Search Bar & Favorites Toggle ─────────────────────────── */}
      <div className="flex items-center gap-1">
        <div className="relative flex-1 flex items-center bg-[#18181A] rounded-md border border-border/40 px-2.5 py-1 focus-within:border-[#00E5FF]/60 focus-within:ring-1 focus-within:ring-[#00E5FF]/30 transition-all">
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
              className="text-text-muted hover:text-text-primary p-0.5 cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() =>
            setActiveFilter(activeFilter === "favorites" ? "all" : "favorites")
          }
          title={t("properties.animation.favorites")}
          aria-label={t("properties.animation.favorites")}
          className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 transition-colors cursor-pointer border ${
            activeFilter === "favorites"
              ? "bg-amber-400/20 text-amber-400 border-amber-400/50"
              : "bg-[#18181A] border-border/40 text-text-muted hover:text-text-primary hover:bg-[#2E2E34]"
          }`}
        >
          <Star
            className={`w-3.5 h-3.5 ${
              activeFilter === "favorites"
                ? "fill-amber-400 text-amber-400"
                : ""
            }`}
          />
        </button>
      </div>

      {/* ── 3. Isolated Grids (Always Mounted, CSS Hidden/Contents) ─────────── */}
      {(["in", "out", "loop"] as MotionBehaviorCategory[]).map((phase) => (
        <div
          key={phase}
          className={activeTab === phase ? "contents" : "hidden"}
        >
          <PhaseGrid
            phase={phase}
            enabled={visitedTabs.has(phase)}
            activePresetId={presetIdForPhase(phase)}
            searchQuery={searchQuery}
            activeFilter={activeFilter}
            favorites={favorites}
            downloadingIds={downloadingIds}
            downloadedIds={downloadedIds}
            onSelect={(id) => handleSelectPreset(phase, id)}
            onToggleFavorite={toggleFavorite}
            onDownload={(id, e) => handleDownload(phase, id, e)}
          />
        </div>
      ))}

      {/* ── 4. Loop Speed & Intensity Controls (when Loop tab is active and has loop) ── */}
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

export default MotionPresetSection;

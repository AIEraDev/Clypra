/**
 * MediaAnimationSection — Animation browser for Video and Image clips.
 *
 * Mirrors MotionPresetSection but:
 * - Tabs: In / Out / Combo (no Loop)
 * - Fetches from /media-animations catalog (positionX/Y slide presets)
 * - Shows thumbnail images on preset cards when available
 * - On hover: plays previewUrl video from the start; on blur: pauses and
 *   reverts to the thumbnail image
 * - All three CategoryGrids (in/out/combo) are always mounted; the active
 *   tab's container uses `contents` display while the others use `hidden`,
 *   so each category keeps its fetch lifecycle alive across tab switches
 */

import React, { useState, useCallback, useEffect } from "react";
import { Search, Star, X } from "lucide-react";
import type { Clip } from "@/types";
import type { ClipMotionConfig } from "@/types/motion";
import { compileClipMotionKeyframes } from "@/core/animation/motionPresets";
import {
  useMediaAnimationCatalogSnapshot,
  type MediaAnimationCategory,
  downloadManifest,
  getMediaAnimationPreset,
} from "./mediaAnimationCatalog";
import { mediaAnimationCacheManager } from "./cache/mediaAnimationCache";
import { useI18n } from "@/i18n";
import CategoryGrid, { type CategoryFilter } from "./CategoryGrid";
import { MediaAnimationTelemetry } from "./telemetry/mediaAnimationTelemetry";
import { mediaAnimationRollup } from "./telemetry/mediaAnimationRollup";
import { toast } from "@/lib/toast";

interface MediaAnimationSectionProps {
  selectedClip: Clip;
  handleUpdateMultiple: (fields: Record<string, any>) => void;
  canvasWidth?: number;
  canvasHeight?: number;
  activeTab?: MediaAnimationCategory;
  onTabChange?: (tab: MediaAnimationCategory) => void;
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

// ── MediaAnimationSection ─────────────────────────────────────────────────────

export const MediaAnimationSection: React.FC<MediaAnimationSectionProps> = ({
  selectedClip,
  handleUpdateMultiple,
  canvasWidth = 1920,
  canvasHeight = 1080,
  activeTab: controlledActiveTab,
  onTabChange,
}) => {
  const { t } = useI18n();
  const [internalActiveTab, setInternalActiveTab] =
    useState<MediaAnimationCategory>("in");
  const activeTab = controlledActiveTab ?? internalActiveTab;

  // Track which tabs have been visited so we only fetch on first visit.
  const [visitedTabs, setVisitedTabs] = useState<Set<MediaAnimationCategory>>(
    () => new Set<MediaAnimationCategory>([controlledActiveTab ?? "in"]),
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
    (tab: MediaAnimationCategory) => {
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
    const keys = Array.from(mediaAnimationCacheManager.manifests.keys()).map(
      (k) => k.split("@")[0],
    );
    return new Set(keys);
  });

  React.useEffect(() => {
    return mediaAnimationCacheManager.onHydrated(() => {
      setDownloadedIds((prev) => {
        const keys = Array.from(
          mediaAnimationCacheManager.manifests.keys(),
        ).map((k) => k.split("@")[0]);
        return new Set([...prev, ...keys]);
      });
    });
  }, []);

  const catalogSnapshot = useMediaAnimationCatalogSnapshot();

  const motion: ClipMotionConfig = selectedClip.motion ?? {};
  const hasIn = Boolean(motion.inPreset && motion.inPreset !== "none");
  const hasOut = Boolean(motion.outPreset && motion.outPreset !== "none");

  const latestSelectedClipRef = React.useRef(selectedClip);
  latestSelectedClipRef.current = selectedClip;
  const latestMotionRef = React.useRef(motion);
  latestMotionRef.current = motion;

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

  const handleDownload = useCallback(
    async (
      presetId: string,
      e?: React.MouseEvent,
      motionOverride?: ClipMotionConfig,
    ) => {
      e?.stopPropagation();
      if (downloadingIds.has(presetId)) return;
      const preset = getMediaAnimationPreset(presetId);
      const version = preset?.revisionId;
      if (!version) return;
      setDownloadingIds((prev) => new Set(prev).add(presetId));
      try {
        await downloadManifest(presetId, version);
        setDownloadedIds((prev) => new Set(prev).add(presetId));

        // Use the explicit target motion if passed (e.g. from handleSelectPreset),
        // or read the latest active motion ref to avoid stale closure erasure.
        const targetMotion: ClipMotionConfig =
          motionOverride ?? latestMotionRef.current;
        const isActivePreset =
          targetMotion.inPreset === presetId ||
          targetMotion.outPreset === presetId;
        if (!isActivePreset && !motionOverride) return;

        const currentMotion: ClipMotionConfig = { ...targetMotion };
        const freshCatalog = catalogSnapshot.presets.map((p) => {
          const m = getMediaAnimationPreset(p.id);
          return m ?? p;
        });
        const currentClip = latestSelectedClipRef.current;
        const t0Download = performance.now();
        const recompiledKeyframes = compileClipMotionKeyframes(
          currentClip,
          currentMotion,
          canvasWidth,
          canvasHeight,
          freshCatalog,
        );
        const evalDurationMsDownload = Math.round(
          performance.now() - t0Download,
        );
        const downloadTrackCount = Object.keys(recompiledKeyframes).length;
        const downloadKeyframeCount = Object.values(
          recompiledKeyframes as Record<string, unknown[]>,
        ).reduce((sum, kfs) => sum + (Array.isArray(kfs) ? kfs.length : 0), 0);
        MediaAnimationTelemetry.recordAnimationEval({
          durationMs: evalDurationMsDownload,
          clipType: currentClip.kind ?? "unknown",
          presetId: currentMotion.inPreset ?? currentMotion.outPreset,
          trackCount: downloadTrackCount,
          keyframeCount: downloadKeyframeCount,
        });
        mediaAnimationRollup.recordAnimationEval(
          evalDurationMsDownload,
          downloadTrackCount,
        );
        handleUpdateMultiple({
          motion: currentMotion,
          visualKeyframes: recompiledKeyframes,
        });
      } catch (err) {
        console.error("[MediaAnimationSection] Download failed:", err);
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
      catalogSnapshot.presets,
      canvasWidth,
      canvasHeight,
      handleUpdateMultiple,
    ],
  );

  const updateMotion = useCallback(
    (updates: Partial<ClipMotionConfig>) => {
      const nextMotion: ClipMotionConfig = {
        ...latestMotionRef.current,
        ...updates,
      };
      latestMotionRef.current = nextMotion;
      const mergedCatalog = catalogSnapshot.presets.map((p) => {
        const merged = getMediaAnimationPreset(p.id);
        return merged ?? p;
      });
      const currentClip = latestSelectedClipRef.current;
      const t0 = performance.now();
      const compiledKeyframes = compileClipMotionKeyframes(
        currentClip,
        nextMotion,
        canvasWidth,
        canvasHeight,
        mergedCatalog,
      );
      const evalDurationMs = Math.round(performance.now() - t0);
      const trackCount = Object.keys(compiledKeyframes).length;
      const keyframeCount = Object.values(
        compiledKeyframes as Record<string, unknown[]>,
      ).reduce((sum, kfs) => sum + (Array.isArray(kfs) ? kfs.length : 0), 0);
      MediaAnimationTelemetry.recordAnimationEval({
        durationMs: evalDurationMs,
        clipType: currentClip.kind ?? "unknown",
        presetId: nextMotion.inPreset ?? nextMotion.outPreset,
        trackCount,
        keyframeCount,
      });
      mediaAnimationRollup.recordAnimationEval(evalDurationMs, trackCount);
      handleUpdateMultiple({
        motion: nextMotion,
        visualKeyframes: compiledKeyframes,
      });
    },
    [canvasWidth, canvasHeight, handleUpdateMultiple, catalogSnapshot.presets],
  );

  // Each grid needs the preset ID for its own category, not the active tab's.
  const presetIdForCategory = useCallback(
    (cat: MediaAnimationCategory): string | undefined => {
      if (cat === "in") return motion.inPreset;
      if (cat === "out") return motion.outPreset;
      return motion.inPreset; // combo shares the in-preset slot
    },
    [motion.inPreset, motion.outPreset],
  );

  const handleSelectPreset = useCallback(
    (cat: MediaAnimationCategory, id: string) => {
      if (id === "none") {
        if (cat === "in" || cat === "combo") updateMotion({ inPreset: "none" });
        else updateMotion({ outPreset: "none" });
        toast.info("properties.mediaAnimation.toastRemoved");
        return;
      }

      const updates: Partial<ClipMotionConfig> =
        cat === "out" ? { outPreset: id } : { inPreset: id };
      const targetMotion: ClipMotionConfig = {
        ...latestMotionRef.current,
        ...updates,
      };

      updateMotion(updates);

      const preset = getMediaAnimationPreset(id);
      const presetName = preset?.name || id;
      toast.success("properties.mediaAnimation.toastApplied", {
        interpolation: { name: presetName },
      });

      // Auto-download the manifest if not already cached so the clip gets
      // real keyframes immediately — passing targetMotion avoids stale closure issues.
      const version = preset?.revisionId;
      if (version && !mediaAnimationCacheManager.isCached(id, version)) {
        handleDownload(id, undefined, targetMotion);
      }
    },
    [updateMotion, handleDownload],
  );

  return (
    <div className="space-y-1.5 select-none text-white relative p-2">
      {/* ── Tabs ── */}
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
              onClick={() => handleTabChange(tab)}
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
          className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 transition-colors cursor-pointer border ${
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

      {/* ── Per-category isolated grids — all three are always mounted so
           each keeps its own fetch lifecycle and state. Visibility is
           toggled via CSS so switching tabs is instant with no remount. ── */}
      {(["in", "out", "combo"] as MediaAnimationCategory[]).map((cat) => (
        <div key={cat} className={activeTab === cat ? "contents" : "hidden"}>
          <CategoryGrid
            category={cat}
            enabled={visitedTabs.has(cat)}
            activePresetId={presetIdForCategory(cat)}
            searchQuery={searchQuery}
            activeFilter={activeFilter}
            favorites={favorites}
            downloadingIds={downloadingIds}
            downloadedIds={downloadedIds}
            onSelect={(id) => handleSelectPreset(cat, id)}
            onToggleFavorite={toggleFavorite}
            onDownload={handleDownload}
          />
        </div>
      ))}
    </div>
  );
};

export default MediaAnimationSection;

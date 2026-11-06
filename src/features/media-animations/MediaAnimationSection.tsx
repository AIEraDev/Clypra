/**
 * MediaAnimationSection — Animation browser for Video and Image clips.
 *
 * Mirrors MotionPresetSection but:
 * - Tabs: In / Out / Combo (no Loop)
 * - Fetches from /media-animations catalog (positionX/Y slide presets)
 * - Shows thumbnail images on preset cards when available
 * - On hover: plays previewUrl video from the start; on blur: pauses and
 *   reverts to the thumbnail image
 * - Each tab mounts its own CategoryGrid (keyed by tab) so each category's
 *   fetch, state, and render tree are fully isolated
 */

import React, { useState, useCallback } from "react";
import { Search, X } from "lucide-react";
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

// ── CategoryGrid ──────────────────────────────────────────────────────────────
// Isolated per-tab grid component. Keyed by `category` in the parent so each
// tab gets a completely independent React subtree — no shared hook state, no
// stale snapshot bleed between tabs.

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
    async (presetId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (downloadingIds.has(presetId)) return;
      const preset = getMediaAnimationPreset(presetId);
      const version = preset?.revisionId;
      if (!version) return;
      setDownloadingIds((prev) => new Set(prev).add(presetId));
      try {
        await downloadManifest(presetId, version);
        setDownloadedIds((prev) => new Set(prev).add(presetId));

        // Recompile visualKeyframes for the clip if this preset is currently
        // applied — download just populated the manifest so tracks are now
        // available. This is the only place recompile fires after a download.
        const currentMotion: ClipMotionConfig = selectedClip.motion ?? {};
        const isApplied =
          currentMotion.inPreset === presetId ||
          currentMotion.outPreset === presetId;
        if (isApplied) {
          const freshCatalog = catalogSnapshot.presets.map((p) => {
            const m = getMediaAnimationPreset(p.id);
            return m ?? p;
          });
          const recompiledKeyframes = compileClipMotionKeyframes(
            selectedClip,
            currentMotion,
            canvasWidth,
            canvasHeight,
            freshCatalog,
          );
          handleUpdateMultiple({
            motion: currentMotion,
            visualKeyframes: recompiledKeyframes,
          });
        }
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
      selectedClip,
      catalogSnapshot.presets,
      canvasWidth,
      canvasHeight,
      handleUpdateMultiple,
    ],
  );

  const motion: ClipMotionConfig = selectedClip.motion ?? {};
  const hasIn = Boolean(motion.inPreset && motion.inPreset !== "none");
  const hasOut = Boolean(motion.outPreset && motion.outPreset !== "none");

  const updateMotion = useCallback(
    (updates: Partial<ClipMotionConfig>) => {
      const nextMotion: ClipMotionConfig = { ...motion, ...updates };
      const mergedCatalog = catalogSnapshot.presets.map((p) => {
        const merged = getMediaAnimationPreset(p.id);
        return merged ?? p;
      });
      const compiledKeyframes = compileClipMotionKeyframes(
        selectedClip,
        nextMotion,
        canvasWidth,
        canvasHeight,
        mergedCatalog,
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

  const activePresetId =
    activeTab === "in"
      ? motion.inPreset
      : activeTab === "out"
        ? motion.outPreset
        : motion.inPreset;

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
      else updateMotion({ inPreset: id });
    },
    [activeTab, updateMotion],
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

      {/* ── Per-tab isolated grid — keyed by activeTab so each tab mounts
           a completely independent CategoryGrid instance with its own
           useMediaAnimationCategory hook and fetch lifecycle. ── */}
      <CategoryGrid
        key={activeTab}
        category={activeTab}
        activePresetId={activePresetId}
        searchQuery={searchQuery}
        activeFilter={activeFilter}
        favorites={favorites}
        downloadingIds={downloadingIds}
        downloadedIds={downloadedIds}
        onSelect={handleSelectPreset}
        onToggleFavorite={toggleFavorite}
        onDownload={handleDownload}
      />
    </div>
  );
};

export default MediaAnimationSection;

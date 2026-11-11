import React, { useMemo, useEffect } from "react";
import { Ban } from "lucide-react";
import { useI18n } from "@/i18n";
import PresetCard from "@/features/media-animations/PresetCard";
import {
  useAnimationPhase,
  type RemoteTextAnimationPreset,
} from "./animationCatalog";
import { textAnimationCacheManager } from "./cache/textAnimationCache";
import type { MotionBehaviorCategory } from "@/types/motion";

export type CategoryFilter = "all" | "favorites";

interface PhaseGridProps {
  phase: MotionBehaviorCategory;
  enabled: boolean;
  activePresetId: string | undefined;
  searchQuery: string;
  activeFilter: CategoryFilter;
  favorites: Set<string>;
  downloadingIds: Set<string>;
  downloadedIds: Set<string>;
  onSelect: (id: string) => void;
  onToggleFavorite: (id: string, e: React.MouseEvent) => void;
  onDownload: (id: string, e: React.MouseEvent) => void;
}

const PhaseGrid: React.FC<PhaseGridProps> = ({
  phase,
  enabled,
  activePresetId,
  searchQuery,
  activeFilter,
  favorites,
  downloadingIds,
  downloadedIds,
  onSelect,
  onToggleFavorite,
  onDownload,
}) => {
  const { t } = useI18n();
  const phaseData = useAnimationPhase(phase, enabled);

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log(`[PhaseGrid "${phase}"] fetched`, phaseData.presets);
    }
  }, [phaseData.presets, phase]);

  const filteredPresets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return phaseData.presets.filter((preset) => {
      if (activeFilter === "favorites" && !favorites.has(preset.id)) {
        return false;
      }
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
  }, [phaseData.presets, activeFilter, searchQuery, favorites]);

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-2 max-h-80 overflow-y-auto pr-0.5 scrollbar-thin">
      {/* None card */}
      <button
        type="button"
        onClick={() => onSelect("none")}
        className="flex flex-col items-center group cursor-pointer text-left"
      >
        <div
          className={`w-full h-16 rounded-md flex flex-col items-center justify-center transition-all relative ${
            !activePresetId || activePresetId === "none"
              ? "bg-accent/10 text-gray-50 border border-accent/40"
              : "bg-accent/10 border border-accent/30 text-text-muted"
          }`}
        >
          <Ban className="w-5 h-5 opacity-80" />
        </div>
        <span
          title="None"
          className="text-[10px] font-medium text-text-muted mt-0.5 truncate max-w-full group-hover:text-text-primary text-center"
        >
          {t("properties.animation.none")}
        </span>
      </button>

      {/* Empty state */}
      {filteredPresets.length === 0 && phaseData.status === "ready" && (
        <div className="col-span-4 flex items-center justify-center py-8 text-[11px] text-text-muted">
          {t("properties.animation.none")}
        </div>
      )}

      {/* Error state */}
      {phaseData.status === "error" && filteredPresets.length === 0 && (
        <div className="col-span-4 rounded-md border border-amber-400/20 bg-amber-400/5 p-2 text-[10px] text-amber-200">
          Animation catalog is unavailable. Reconnect to load published presets.
        </div>
      )}

      {/* Loading skeletons */}
      {phaseData.status === "loading" &&
        filteredPresets.length === 0 &&
        Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center">
            <div className="w-full h-16 rounded-md bg-accent/10 animate-pulse" />
          </div>
        ))}

      {/* Preset cards */}
      {filteredPresets.map((preset) => {
        const isDownloaded =
          !preset.revisionId ||
          downloadedIds.has(preset.id) ||
          textAnimationCacheManager.isCached(
            preset.id,
            preset.revisionId ?? "",
          );
        return (
          <PresetCard
            key={preset.id}
            name={preset.name}
            icon={preset.icon}
            thumbnailUrl={preset.thumbnailUrl}
            previewUrl={preset.previewUrl}
            isSelected={activePresetId === preset.id}
            isFavorite={favorites.has(preset.id)}
            onSelect={() => onSelect(preset.id)}
            onToggleFavorite={(e) => onToggleFavorite(preset.id, e)}
            isDownloaded={isDownloaded}
            isDownloading={downloadingIds.has(preset.id)}
            onDownload={(e) => onDownload(preset.id, e)}
          />
        );
      })}
    </div>
  );
};

export default PhaseGrid;

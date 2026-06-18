import { useState, useEffect } from "react";
import { useEffectsStore } from "../store/effectsStore";
import { EffectCard } from "@/components/ui/EffectCard";
import { TextEffectsApi, TEXT_EFFECT_CATEGORIES } from "../api/textEffectsApi";
import type { TextEffectDefinition } from "../types/types";
import { useFavoritesStore } from "@/store/favoritesStore";
import { useUIStore } from "@/store/uiStore";
import { getActiveSessionOrNull } from "@/core/runtime/ProjectSession";

const CATEGORIES = TEXT_EFFECT_CATEGORIES;

interface EffectGridProps {
  searchQuery?: string;
  onAddToTimeline?: (payload: any, type: any) => void;
}

export function EffectGrid({ searchQuery = "", onAddToTimeline }: EffectGridProps) {
  const [activeCategory, setActiveCategory] = useState("3d");
  const { index, indexLoading, indexError, loadCategory } = useEffectsStore();

  // Consume global favorites and downloads store
  const { favorites, downloadedEffects, downloadingIds, toggleFavorite, startDownload, completeDownload, cancelDownload } = useFavoritesStore();

  // Load index when category changes
  useEffect(() => {
    loadCategory(activeCategory);
  }, [activeCategory, loadCategory]);

  const items = index[activeCategory] ?? [];
  const filteredItems = items.filter((item) => item.name.toLowerCase().includes(searchQuery.toLowerCase()));

  const handleToggleFavorite = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFavorite(id);
  };

  const applyEffectToTimeline = (effect: any) => {
    onAddToTimeline?.(
      {
        name: effect.name,
        text: effect.text || "CLYPRA",
        presetType: "effect",
        styleId: effect.id,
        effectDefinition: effect,
        fontFamily: effect.font?.family,
        color: effect.fills?.[0]?.color,
        fontWeight: effect.font?.weight,
        fontStyle: effect.font?.style,
        stroke: effect.strokes?.[0] ? { color: effect.strokes[0].color, width: effect.strokes[0].width } : undefined,
        shadow: effect.shadows?.[0] ? { color: effect.shadows[0].color, blur: effect.shadows[0].blur, offsetX: effect.shadows[0].offsetX ?? 0, offsetY: effect.shadows[0].offsetY ?? 0 } : undefined,
        background: effect.panel
          ? {
              color: effect.panel.color || "rgba(0,0,0,0.6)",
              padding: effect.panel.paddingX !== undefined ? effect.panel.paddingX : 12,
              borderRadius: effect.panel.radius !== undefined ? effect.panel.radius : 6,
            }
          : undefined,
      },
      "text",
    );
  };

  const handleDownloadAndApply = async (item: any, e: React.MouseEvent) => {
    e.stopPropagation();
    const itemId = item.id;
    if (downloadingIds.includes(itemId)) return;

    const cachedEffect = useEffectsStore.getState().definitions[itemId];
    if (downloadedEffects.includes(itemId) && cachedEffect) {
      applyEffectToTimeline(cachedEffect);
      return;
    }

    if (!downloadedEffects.includes(itemId)) {
      startDownload(itemId);
    }

    // Lazy load the full effect definition
    try {
      const fullEffect = cachedEffect || (await TextEffectsApi.getFullEffect(item.category, item.id));

      setTimeout(() => {
        completeDownload(itemId, "effect");
        applyEffectToTimeline(fullEffect || item);
      }, 850);
    } catch (err) {
      console.error("[EffectGrid] Failed to load effect:", err);
      cancelDownload(itemId);
    }
  };

  const handlePreview = async (item: any) => {
    console.log(`[EffectGrid:Preview] 👁️ Preview requested for: ${item.name} (${item.id})`);

    const itemId = item.id;
    const isDownloaded = downloadedEffects.includes(itemId);

    if (downloadingIds.includes(itemId)) {
      console.log(`[EffectGrid:Preview] ⏸️ Already downloading: ${item.id}`);
      return;
    }

    // Set the latest targeted preview ID immediately to track user intent and resolve race conditions
    useUIStore.getState().setPreviewMedia(itemId);
    console.log(`[EffectGrid:Preview] 🎯 Set preview target: ${itemId}`);

    if (!isDownloaded) {
      console.log(`[EffectGrid:Preview] 📥 Effect not downloaded, starting download: ${itemId}`);
      startDownload(itemId);
    } else {
      console.log(`[EffectGrid:Preview] ✅ Effect already downloaded: ${itemId}`);
    }

    try {
      const startTime = performance.now();

      // Resolve the full effect configuration
      const fullEffect = useEffectsStore.getState().definitions[itemId] || (await TextEffectsApi.getFullEffect(item.category, itemId));

      const loadTime = (performance.now() - startTime).toFixed(2);
      console.log(`[EffectGrid:Preview] ✅ Effect loaded in ${loadTime}ms: ${itemId}`);

      // Mark as downloaded
      completeDownload(itemId, "effect");
      console.log(`[EffectGrid:Preview] ✅ Marked as downloaded: ${itemId}`);

      // Only project to the preview player if this item is still the active preview target
      if (useUIStore.getState().previewMediaId === itemId) {
        console.log(`[EffectGrid:Preview] 🎬 Sending to preview player: ${itemId}`);

        // Send directly to the main preview player — same as template preview flow
        useUIStore.getState().previewTextPreset(fullEffect, "effect");

        // Activate transport source context
        const session = getActiveSessionOrNull();
        session?.transportAuthority?.setActiveContext("source");

        console.log(`[EffectGrid:Preview] ✅ Preview active for: ${itemId}`);
      } else {
        console.log(`[EffectGrid:Preview] ⚠️ Preview cancelled - target changed to: ${useUIStore.getState().previewMediaId}`);
      }
    } catch (e) {
      console.error(`[EffectGrid:Preview] ❌ Failed to load effect ${itemId}:`, e);
      cancelDownload(itemId);

      // Fallback: still preview with partial data if this item is still the active target
      if (useUIStore.getState().previewMediaId === itemId) {
        console.log(`[EffectGrid:Preview] 🔄 Fallback preview with partial data: ${itemId}`);
        useUIStore.getState().previewTextPreset(item, "effect");
        const session = getActiveSessionOrNull();
        session?.transportAuthority?.setActiveContext("source");
      }
    }
  };

  // Convert EffectIndexItem to TextEffectDefinition for the UI component
  const convertToEffectDefinition = (item: any): TextEffectDefinition => {
    return {
      ...item,
      text: "CLYPRA",
      description: item.description || "",
      tags: item.tags || [],
      font: {
        family: "Inter",
        weight: 700,
        style: "normal",
        letterSpacing: 0,
        lineHeight: 1.2,
      },
      fills: [],
      strokes: [],
      shadows: [],
    };
  };

  return (
    <div className="flex flex-col h-full bg-surface/5">
      {/* ── Category tabs ───────────────────────────────────── */}
      <div className="relative shrink-0 border-b border-border/40 bg-surface/5">
        <div className="absolute left-0 top-0 bottom-0 w-3 bg-linear-to-l to-surface from-transparent pointer-events-none" />
        <div className="flex overflow-x-auto gap-2 p-1 whitespace-nowrap" style={{ scrollbarWidth: "none" }}>
          {CATEGORIES.map((cat) => (
            <button key={cat} onClick={() => setActiveCategory(cat)} className={`px-2 py-1 capitalize text-xs font-medium rounded-sm transition-colors cursor-pointer hover:bg-accent/10 hover:text-accent ${activeCategory === cat ? "bg-accent/10 text-accent" : "text-text-muted"}`}>
              {cat}
            </button>
          ))}
        </div>
        <div className="absolute right-0 top-0 bottom-0 w-3 bg-linear-to-l from-surface to-transparent pointer-events-none" />
      </div>

      {/* ── Grid body ───────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-1 scrollbar-thin">
        {indexLoading && <GridSkeleton />}

        {indexError && (
          <div className="flex flex-col items-center justify-center h-40 gap-2">
            <p className="text-sm text-text-muted">{indexError}</p>
            <button onClick={() => loadCategory(activeCategory)} className="text-xs text-accent underline cursor-pointer hover:text-accent-soft">
              Retry
            </button>
          </div>
        )}

        {!indexLoading && !indexError && filteredItems.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 gap-1 text-xs text-text-muted">
            <p>No matching effects found</p>
            <p className="opacity-60">Try searching for other styles</p>
          </div>
        )}

        {!indexLoading && !indexError && filteredItems.length > 0 && (
          <div className="grid grid-cols-3 gap-1.5">
            {filteredItems.map((effect) => (
              <EffectCard key={effect.id} effect={convertToEffectDefinition(effect)} isFavorite={favorites.includes(effect.id)} isDownloading={downloadingIds.includes(effect.id)} isDownloaded={downloadedEffects.includes(effect.id)} onFavorite={(e) => handleToggleFavorite(effect.id, e)} onApply={(e) => handleDownloadAndApply(effect, e)} onPreview={() => handlePreview(effect)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {Array.from({ length: 9 }).map((_, i) => (
        <div key={i} className="rounded-xl bg-white/5 animate-pulse aspect-square" style={{ animationDelay: `${i * 45}ms` }} />
      ))}
    </div>
  );
}

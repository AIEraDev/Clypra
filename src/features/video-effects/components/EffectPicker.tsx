import React, { useState, useEffect, useMemo } from "react";
import { Search, Sparkles, AlertCircle, Star, Download, Plus, AlertTriangle } from "lucide-react";
import type { EffectPreset } from "../types";
import { VideoEffectsApi } from "../api/videoEffectsApi";
import { useFavoritesStore } from "@/store/favoritesStore";
import {
  evaluateEffectCompatibility,
  getActiveEngineCapabilities,
  syncEngineCapabilitiesWithGpuStatus,
  isGpuStatusKnown,
} from "@/features/body-effects/capabilities";
import { isTauriRuntime, getNativeGpuStatus } from "@/lib/platform/tauri";
// Canonical GPU limits — same file build.rs reads. The @gpu-limits alias is defined in vite.config.ts.
import GPU_LIMITS from "@gpu-limits";

interface EffectPickerProps {
  selectedCategory?: string;
  onSelect: (effect: EffectPreset) => void;
}

export function EffectPicker({ selectedCategory: propCategory, onSelect }: EffectPickerProps) {
  const [internalCategory, setInternalCategory] = useState<string>("trending");
  const activeCategory = (propCategory ?? internalCategory).toLowerCase();
  const [searchQuery, setSearchQuery] = useState("");
  const [effects, setEffects] = useState<EffectPreset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tracks whether real GPU hardware data has been received from the Tauri IPC layer.
  // Effects grid must not render until this resolves: otherwise compatibility badges
  // are evaluated against the "unknown" default and an incompatible effect could
  // appear available during the async startup window before real adapter limits land.
  const [gpuStatusKnown, setGpuStatusKnown] = useState<boolean>(
    // On non-Tauri runtimes (web preview) there's no hardware to probe — treat as known.
    !isTauriRuntime() || isGpuStatusKnown(),
  );
  // Set when all retries have been exhausted. Enables a manual "Retry" affordance
  // so users aren't locked out for the entire session by a single transient IPC failure.
  const [gpuStatusError, setGpuStatusError] = useState<boolean>(false);

  const { favorites, downloadedEffects, downloadingIds, toggleFavorite, startDownload, completeDownload } = useFavoritesStore();

  const probeGpuStatus = async () => {
    if (!isTauriRuntime()) return;

    // Exponential backoff: attempt 1 immediately, attempt 2 after 800ms, attempt 3 after 2s.
    const delays = [0, 800, 2000];
    let lastError: unknown;

    for (let attempt = 0; attempt < delays.length; attempt++) {
      if (delays[attempt] > 0) {
        await new Promise((r) => setTimeout(r, delays[attempt]));
      }
      try {
        const status = await getNativeGpuStatus();
        if (status) {
          syncEngineCapabilitiesWithGpuStatus(status);
        }
        setGpuStatusError(false);
        setGpuStatusKnown(true);
        return; // success — stop retrying
      } catch (err) {
        lastError = err;
        console.warn(`[EffectPicker] GPU status probe attempt ${attempt + 1} failed:`, err);
      }
    }

    // All retries exhausted. Fail closed:
    // Seed a pessimistic stub so both gating checks run with real values.
    //   - meetsCanonicalLimits: false                      → Gate 1 fires for unannotated + canonical effects
    //   - maxTextureDimension2D: GPU_LIMITS.maxTextureDimension2D → Gate 2 fires against our own baseline.
    //     Semantics: "adapter cannot be confirmed to meet our baseline" — not a recalled WebGPU spec floor.
    //     This also means Gate 2 will fire for any effect requiring more than our baseline permits,
    //     even if it has requiresCanonicalLimits: false (it opted out of Gate 1, Gate 2 still runs).
    syncEngineCapabilitiesWithGpuStatus({
      contractVersion: 0,
      state: "failed",
      available: false,
      adapterName: null,
      backend: null,
      deviceType: null,
      surfaceAvailable: false,
      failureReason: String(lastError),
      meetsCanonicalLimits: false,
      maxTextureDimension2D: GPU_LIMITS.maxTextureDimension2D,
      limitWarnings: ["GPU status IPC failed after 3 attempts — pessimistic hardware floor applied"],
    });
    console.error("[EffectPicker] GPU status probe failed after all retries — fail-closed applied:", lastError);
    setGpuStatusError(true);
    setGpuStatusKnown(true);
  };

  useEffect(() => {
    probeGpuStatus();
    loadBodyEffects();
  }, []);

  const loadBodyEffects = async () => {
    setLoading(true);
    setError(null);
    try {
      const bodyEffects = await VideoEffectsApi.getBodyEffects();
      setEffects(bodyEffects);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load body effects";
      setError(message);
      console.error("Failed to load body effects:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleApplyEffect = (effect: EffectPreset) => {
    onSelect(effect);
  };

  const handleDownloadAndApply = async (effect: EffectPreset) => {
    const itemId = effect.id;
    if (downloadingIds.includes(itemId)) return;

    if (downloadedEffects.includes(itemId)) {
      handleApplyEffect(effect);
      return;
    }

    startDownload(itemId);
    setTimeout(() => {
      completeDownload(itemId, "effect");
      handleApplyEffect(effect);
    }, 650);
  };

  const filteredEffects = useMemo(() => {
    let filtered = effects;

    if (activeCategory && activeCategory !== "all") {
      filtered = filtered.filter((e: EffectPreset) => {
        const cat = e.category?.toLowerCase() === "body" ? "aura" : e.category?.toLowerCase();
        return cat === activeCategory;
      });
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((e: EffectPreset) => e.name.toLowerCase().includes(query) || e.description.toLowerCase().includes(query) || e.tags?.some((t) => t.toLowerCase().includes(query)));
    }

    return filtered;
  }, [effects, activeCategory, searchQuery]);

  return (
    <div className="flex flex-col h-full bg-transparent">
      {/* Search Input */}
      <div className="p-1 border-b border-border shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search body effects..." className="w-full bg-surface-raised border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent" />
        </div>
      </div>

      {/* Grid Content */}
      <div className="flex-1 overflow-y-auto p-1.5 scrollbar-thin">
        {loading && (
          <div className="flex items-center justify-center h-40">
            <div className="animate-spin rounded-full h-5 w-5 border-2 border-accent border-t-transparent" />
          </div>
        )}

        {/* Hardware probe pending: hold the grid until real GPU limits are known.
            Without this gate, compatibility badges are evaluated against undefined
            meetsCanonicalLimits and an incompatible effect would appear available
            for however long the Tauri IPC adapter query takes to resolve. */}
        {!loading && !gpuStatusKnown && (
          <div className="flex items-center justify-center h-40 gap-2 text-xs text-text-muted">
            <div className="animate-spin rounded-full h-3 w-3 border-2 border-text-muted border-t-transparent" />
            <span>Checking hardware compatibility…</span>
          </div>
        )}

        {/* GPU probe permanently failed: grid shows with pessimistic caps applied (fail-closed).
            Offer a manual retry so users aren't stuck UNSUPPORTED for the whole session
            due to a single transient IPC failure. */}
        {!loading && gpuStatusKnown && gpuStatusError && (
          <div className="flex items-center justify-between gap-2 p-2 mb-1.5 bg-amber-500/10 border border-amber-500/25 rounded-lg text-xs text-amber-400">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              <span>Hardware check failed — compatibility badges may be conservative.</span>
            </div>
            <button
              onClick={() => {
                setGpuStatusKnown(false);
                setGpuStatusError(false);
                probeGpuStatus();
              }}
              className="shrink-0 px-2 py-0.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 rounded text-amber-300 cursor-pointer transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {!loading && gpuStatusKnown && !error && filteredEffects.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 gap-1 text-xs text-text-muted">
            <p>No matching effects found</p>
            <p className="opacity-60">Try another search or category</p>
          </div>
        )}

        {!loading && gpuStatusKnown && !error && filteredEffects.length > 0 && (
          <div className="grid grid-cols-3 gap-1.5">
            {filteredEffects.map((effect) => {
              // Evaluate compatibility against live engine capabilities.
              // getActiveEngineCapabilities() reflects real adapter limits once
              // syncEngineCapabilitiesWithGpuStatus() has fired and React has re-rendered.
              let isCompatible = true;
              let incompatibleReason: string | undefined;

              if (effect.requirements?.captureType && effect.compositing?.primitive) {
                const evalResult = evaluateEffectCompatibility(
                  {
                    requirements: {
                      minEngineVersion: effect.requirements.minEngineVersion ?? "1.0.0",
                      captureType: effect.requirements.captureType as any,
                      maskCategory: (effect.requirements.maskCategory as any) ?? "person",
                      requiredLandmarks: effect.requirements.keypoints,
                      minTextureDimension2D: effect.requirements.minTextureDimension2D,
                      requiresCanonicalLimits: effect.requirements.requiresCanonicalLimits,
                    },
                    compositing: {
                      primitive: effect.compositing.primitive as any,
                      layerZOrder: effect.compositing.layerZOrder,
                      blendMode: (effect.compositing.blendMode as any) ?? "normal",
                    },
                  },
                  getActiveEngineCapabilities(),
                );
                isCompatible = evalResult.compatible;
                incompatibleReason = evalResult.reason;
              }

              return (
                <EffectCard
                  key={effect.id}
                  effect={effect}
                  isCompatible={isCompatible}
                  incompatibleReason={incompatibleReason}
                  isFavorite={favorites.includes(effect.id)}
                  isDownloaded={downloadedEffects.includes(effect.id)}
                  isDownloading={downloadingIds.includes(effect.id)}
                  onFavorite={(e) => {
                    e.stopPropagation();
                    toggleFavorite(effect.id);
                  }}
                  onApply={(e) => {
                    e.stopPropagation();
                    if (isCompatible) {
                      handleDownloadAndApply(effect);
                    }
                  }}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

interface EffectCardProps {
  effect: EffectPreset;
  isCompatible?: boolean;
  incompatibleReason?: string;
  isFavorite: boolean;
  isDownloaded: boolean;
  isDownloading: boolean;
  onFavorite: (e: React.MouseEvent) => void;
  onApply: (e: React.MouseEvent) => void;
}

function EffectCard({
  effect,
  isCompatible = true,
  incompatibleReason,
  isFavorite,
  isDownloaded,
  isDownloading,
  onFavorite,
  onApply,
}: EffectCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  const isSkeletal =
    effect.requirements?.captureType === "skeletal_pose" ||
    effect.requirements?.captureType === "hybrid_body";
  const isBehindSubject = effect.compositing?.layerZOrder === "behind-subject";

  return (
    <div
      onClick={isCompatible ? onApply : undefined}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      title={!isCompatible ? `Incompatible: ${incompatibleReason}` : effect.name}
      className={`w-full aspect-square bg-surface-raised/40 hover:bg-surface-raised/80 border rounded-xl relative overflow-hidden flex flex-col justify-between p-1 transition-all duration-300 group shadow-[0_4px_16px_rgba(0,0,0,0.3)] ${
        !isCompatible
          ? "opacity-50 grayscale border-red-500/30 cursor-not-allowed"
          : "border-border/40 hover:border-accent/40 cursor-pointer"
      }`}
    >
      {/* Downloading Overlay */}
      {isDownloading && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] flex items-center justify-center z-20 pointer-events-none">
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 rounded-full border-3 border-accent border-t-transparent animate-spin" />
            <span className="text-[10px] font-semibold text-accent">Downloading...</span>
          </div>
        </div>
      )}

      {/* Badges container (top-left) */}
      <div className="absolute top-1 left-1 z-10 flex items-center gap-0.5 pointer-events-none">
        {/* Premium badge */}
        {effect.isPremium && (
          <div className="bg-linear-to-r from-purple-500 to-pink-500 rounded-full p-0.5">
            <Sparkles className="w-2.5 h-2.5 text-white" />
          </div>
        )}
        {/* Skeletal Pose requirement badge */}
        {isSkeletal && (
          <span className="bg-sky-500/80 text-[7px] font-bold text-white px-1 py-0.2 rounded tracking-wide shadow-xs">
            POSE
          </span>
        )}
        {/* Behind subject badge */}
        {isBehindSubject && (
          <span className="bg-purple-600/80 text-[7px] font-bold text-white px-1 py-0.2 rounded tracking-wide shadow-xs">
            BEHIND
          </span>
        )}
        {/* Incompatibility badge */}
        {!isCompatible && (
          <span className="bg-red-500/90 text-[7px] font-bold text-white px-1 py-0.2 rounded tracking-wide shadow-xs flex items-center gap-0.5">
            <AlertTriangle className="w-2 h-2" />
            UNSUPPORTED
          </span>
        )}
      </div>

      {/* Favorite Star */}
      <button
        onClick={onFavorite}
        className={`absolute top-1 right-1 p-1 cursor-pointer rounded-full bg-surface/40 hover:bg-surface/60 border border-border/50 text-text-muted hover:text-text-primary transition-all duration-200 z-10 ${
          isFavorite ? "opacity-100 text-yellow-400!" : "opacity-0 group-hover:opacity-100 group-hover:translate-y-0 translate-y-2"
        }`}
      >
        <Star className={`w-3 h-3 ${isFavorite ? "fill-yellow-400 text-yellow-400!" : ""}`} />
      </button>

      {/* Thumbnail or Category fallback */}
      <div className="flex-1 flex items-center justify-center w-full select-none relative overflow-hidden rounded-lg bg-surface">
        {effect.thumbnail ? (
          <img src={effect.thumbnail} alt={effect.name} className="w-full h-full object-cover rounded-lg" />
        ) : (
          <div className="flex flex-col items-center justify-center h-full w-full bg-linear-to-br from-accent/10 to-accent/0 text-center rounded-lg p-2">
            <span className="text-4xl filter drop-shadow-[0_4px_8px_rgba(0,0,0,0.3)] group-hover:scale-[1.05] transition-transform duration-300">
              {getCategoryIcon(effect.category || "aura")}
            </span>
          </div>
        )}
      </div>

      {/* Footer Title / Apply Button */}
      <div className="flex items-center justify-between w-full mt-0.5 z-10 px-0.5">
        <span
          className="text-[9px] text-text-muted font-medium group-hover:text-text-primary transition-colors truncate max-w-[65px]"
          title={effect.name}
        >
          {effect.name}
        </span>
        <button
          onClick={onApply}
          disabled={!isCompatible || isDownloading}
          className={`w-4 h-4 rounded-full flex items-center justify-center transition-all relative ${
            !isCompatible
              ? "bg-surface/20 border border-border/30 text-text-muted/40 cursor-not-allowed"
              : isDownloaded
              ? "bg-accent hover:bg-accent/85 border border-accent text-white cursor-pointer"
              : isDownloading
              ? "bg-accent/20 border border-accent cursor-wait"
              : "bg-surface/40 hover:bg-surface/60 border border-border/50 text-text-muted hover:text-text-primary cursor-pointer"
          }`}
        >
          {isDownloading ? (
            <div className="w-2 h-2 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          ) : isDownloaded ? (
            <Plus className="w-3 h-3 group-hover:scale-110 transition-transform" />
          ) : (
            <Download className="w-2 h-2 group-hover:scale-115 transition-transform" />
          )}
        </button>
      </div>
    </div>
  );
}

function getCategoryIcon(category: string): string {
  const icons: Record<string, string> = {
    trending: "🔥",
    motion: "🌀",
    aura: "✨",
    wings: "🪽",
    energy: "⚡",
    fun: "🎉",
  };
  return icons[category.toLowerCase()] || icons[category] || "✨";
}

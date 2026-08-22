import React, { useState, useEffect } from "react";
import { Trash2, HardDrive, RefreshCw, AlertCircle, CheckCircle, Cloud, Database, Music2, Layers, Film, Gauge } from "lucide-react";
import { useCacheManager } from "@/hooks/useCacheManager";
import { TextEffectsApi } from "@/features/text-effects/api/textEffectsApi";
import { TextEffectsCacheManager } from "@/features/text-effects/cache/cacheManager";
import { useAudioLibraryStore } from "@/features/audio-library/store/audioLibraryStore";
import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "@/lib/platform/tauri";
import { filmstripTelemetry, type FilmstripSessionSummary } from "@/lib/filmstrip/filmstripTelemetry";

export const CacheSettings: React.FC = () => {
  const { isClearing, cacheInfo, lastResult, clearAllCaches, clearAppCache, clearWebViewCache, clearGPUCache } = useCacheManager();
  const { getCacheStats, clearAllCache: clearAudioCache } = useAudioLibraryStore();

  const [apiCacheStatus, setApiCacheStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [isClearingApi, setIsClearingApi] = useState(false);
  const [textEffectsCacheStats, setTextEffectsCacheStats] = useState<{ zustand: number; indexedDB: number; totalMB: number } | null>(null);
  const [audioCacheStats, setAudioCacheStats] = useState({ count: 0, totalSize: 0, items: [] as any[] });
  const [isClearingAudio, setIsClearingAudio] = useState(false);

  const [filmstripDiskStats, setFilmstripDiskStats] = useState<{
    total_bytes: number;
    atlas_count: number;
    cache_dir: string;
    limit_bytes: number;
    hit_rate_pct: number;
  } | null>(null);
  const [isClearingFilmstrip, setIsClearingFilmstrip] = useState(false);
  const [filmstripLimitGb, setFilmstripLimitGb] = useState<string>("5");
  const [telemetrySummary, setTelemetrySummary] = useState<FilmstripSessionSummary>(filmstripTelemetry.getSummary());

  const loadFilmstripStats = async () => {
    if (isTauriRuntime()) {
      try {
        const stats = await invoke<any>("get_disk_cache_stats");
        setFilmstripDiskStats(stats);
        if (stats.limit_bytes === 0) {
          setFilmstripLimitGb("0");
        } else {
          const gb = Math.round(stats.limit_bytes / (1024 * 1024 * 1024));
          setFilmstripLimitGb(String(gb));
        }
      } catch (e) {
        console.warn("[CacheSettings] Failed to fetch filmstrip disk stats:", e);
      }
    }
    setTelemetrySummary(filmstripTelemetry.getSummary());
  };

  useEffect(() => {
    loadFilmstripStats();
  }, []);

  const handleClearFilmstripCache = async () => {
    setIsClearingFilmstrip(true);
    try {
      if (isTauriRuntime()) {
        const purgedCount = await invoke<number>("clear_disk_cache");
        filmstripTelemetry.clear();
        await loadFilmstripStats();
        setApiCacheStatus({
          type: "success",
          message: `Filmstrip & media disk cache purged (${purgedCount} atlas files deleted)`,
        });
      } else {
        filmstripTelemetry.clear();
        setApiCacheStatus({ type: "success", message: "Filmstrip cache reset" });
      }
      setTimeout(() => setApiCacheStatus(null), 3000);
    } catch (e) {
      setApiCacheStatus({ type: "error", message: "Failed to clear filmstrip disk cache" });
      setTimeout(() => setApiCacheStatus(null), 5000);
    } finally {
      setIsClearingFilmstrip(false);
    }
  };

  const handleSetFilmstripLimit = async (val: string) => {
    setFilmstripLimitGb(val);
    const gb = Number(val);
    const limitBytes = gb === 0 ? 0 : gb * 1024 * 1024 * 1024;
    if (isTauriRuntime()) {
      try {
        await invoke("set_cache_size_limit", { limitBytes });
        await loadFilmstripStats();
      } catch (e) {
        console.error("Failed to set cache limit:", e);
      }
    }
  };

  // Load text effects cache stats
  useEffect(() => {
    loadTextEffectsCacheStats();
  }, []);

  const loadTextEffectsCacheStats = async () => {
    try {
      const stats = await TextEffectsCacheManager.getStats();
      setTextEffectsCacheStats({
        zustand: stats.zustand.count,
        indexedDB: stats.indexedDB.count,
        totalMB: stats.indexedDB.sizeMB,
      });
    } catch (e) {
      console.error("[CacheSettings] Failed to load text effects cache stats:", e);
    }
  };

  // Load audio cache stats
  useEffect(() => {
    const stats = getCacheStats();
    setAudioCacheStats(stats);
  }, [getCacheStats]);

  // Refresh audio cache stats
  const refreshAudioStats = () => {
    const stats = getCacheStats();
    setAudioCacheStats(stats);
  };

  const handleClearLocalApiCache = async () => {
    setIsClearingApi(true);
    try {
      await TextEffectsCacheManager.clearAll();
      await loadTextEffectsCacheStats();

      setApiCacheStatus({ type: "success", message: "All text effects cache cleared (Memory + IndexedDB + API + Downloaded tracking)" });
      setTimeout(() => setApiCacheStatus(null), 3000);
    } catch (error) {
      setApiCacheStatus({ type: "error", message: "Failed to clear text effects cache" });
      setTimeout(() => setApiCacheStatus(null), 5000);
    } finally {
      setIsClearingApi(false);
    }
  };

  const handleClearAudioCache = async () => {
    setIsClearingAudio(true);
    try {
      await clearAudioCache();
      refreshAudioStats();
      setApiCacheStatus({ type: "success", message: "Audio library cache cleared successfully" });
      setTimeout(() => setApiCacheStatus(null), 3000);
    } catch (error) {
      console.error("[CacheSettings] Audio cache clear error:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to clear audio cache";
      setApiCacheStatus({ type: "error", message: `Audio cache error: ${errorMessage}` });
      setTimeout(() => setApiCacheStatus(null), 5000);
    } finally {
      setIsClearingAudio(false);
    }
  };



  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-text-muted mb-2">Cache Management</h3>
        <p className="text-[11px] text-text-muted">Clear cached data to free up disk space or resolve performance issues.</p>
      </div>

      {/* Cache Info */}
      {cacheInfo && (
        <div className="bg-surface-raised/30 border border-white/6 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs">
            <HardDrive className="w-4 h-4 text-accent" />
            <span className="font-semibold text-text-primary">Cache Status</span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-[11px]">
            <div className="bg-surface-raised/50 rounded p-2 border border-white/5">
              <div className="text-text-muted">localStorage Items</div>
              <div className="text-text-primary font-semibold mt-1">{cacheInfo.localStorage}</div>
            </div>

            <div className="bg-surface-raised/50 rounded p-2 border border-white/5">
              <div className="text-text-muted">sessionStorage Items</div>
              <div className="text-text-primary font-semibold mt-1">{cacheInfo.sessionStorage}</div>
            </div>

            {cacheInfo.gpuCache && (
              <>
                <div className="bg-surface-raised/50 rounded p-2 border border-white/5">
                  <div className="text-text-muted">GPU Textures</div>
                  <div className="text-text-primary font-semibold mt-1">{cacheInfo.gpuCache.textureCount || 0}</div>
                </div>

                <div className="bg-surface-raised/50 rounded p-2 border border-white/5">
                  <div className="text-text-muted">GPU Memory</div>
                  <div className="text-text-primary font-semibold mt-1">{cacheInfo.gpuCache.memoryMB || "0"} MB</div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Clear Result Message */}
      {lastResult && (
        <div className={`flex items-center gap-3 p-2 rounded-lg border text-xs ${lastResult.success ? "bg-green-500/10 border-green-500/30 text-green-400" : "bg-red-500/10 border-red-500/30 text-red-400"}`}>
          {lastResult.success ? <CheckCircle className="w-5 h-5 shrink-0 mt-0.5" /> : <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />}
          <div className="flex-1">
            <p className="font-medium">{lastResult.message}</p>
            {lastResult.stats?.errors && lastResult.stats.errors.length > 0 && (
              <ul className="mt-2 text-[10px] space-y-1">
                {lastResult.stats.errors.map((error: string, idx: number) => (
                  <li key={idx}>• {error}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Clear Cache Actions */}
      <div className="space-y-3">
        <button onClick={() => clearAllCaches({ localStorage: false })} disabled={isClearing} className="w-full flex items-center justify-between p-4 bg-surface-raised/30 hover:bg-surface-raised/50 border border-white/6 hover:border-accent/40 rounded-lg transition-all group disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent/20 flex items-center justify-center group-hover:bg-accent/30 transition-colors">
              <Trash2 className="w-5 h-5 text-accent" />
            </div>
            <div className="text-left">
              <div className="font-medium text-text-primary text-xs">Clear All Caches</div>
              <div className="text-[10px] text-text-muted">App cache, WebView, GPU, and IndexedDB</div>
            </div>
          </div>
          {isClearing && <RefreshCw className="w-5 h-5 text-accent animate-spin" />}
        </button>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button onClick={() => clearAppCache()} disabled={isClearing} className="flex flex-col items-center gap-2 p-4 bg-surface-raised/20 hover:bg-surface-raised/40 border border-white/6 hover:border-accent/30 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer">
            <HardDrive className="w-5 h-5 text-accent" />
            <div className="text-[11px] font-medium text-text-primary">App Cache</div>
          </button>

          <button onClick={() => clearWebViewCache()} disabled={isClearing} className="flex flex-col items-center gap-2 p-4 bg-surface-raised/20 hover:bg-surface-raised/40 border border-white/6 hover:border-accent/30 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer">
            <RefreshCw className="w-5 h-5 text-accent" />
            <div className="text-[11px] font-medium text-text-primary">WebView</div>
          </button>

          <button onClick={() => clearGPUCache()} disabled={isClearing} className="flex flex-col items-center gap-2 p-4 bg-surface-raised/20 hover:bg-surface-raised/40 border border-white/6 hover:border-accent/30 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer">
            <Trash2 className="w-5 h-5 text-accent" />
            <div className="text-[11px] font-medium text-text-primary">GPU Cache</div>
          </button>
        </div>
      </div>

      {/* API Cache Management */}
      <div className="space-y-3 pt-4 border-t border-white/6">
        <div>
          <h3 className="text-[13px] font-semibold uppercase tracking-wider text-text-muted mb-2">Text Effects Cache</h3>
          <p className="text-[11px] text-text-muted">Manage cached text effects from local storage and API.</p>
        </div>

        {/* Text Effects Cache Stats */}
        {textEffectsCacheStats && (
          <div className="bg-surface-raised/30 border border-white/6 rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs">
              <Layers className="w-4 h-4 text-accent" />
              <span className="font-semibold text-text-primary">Cached Text Effects</span>
            </div>

            <div className="grid grid-cols-3 gap-3 text-[11px]">
              <div className="bg-surface-raised/50 rounded p-2 border border-white/5">
                <div className="text-text-muted">Memory</div>
                <div className="text-text-primary font-semibold mt-1">{textEffectsCacheStats.zustand} effects</div>
              </div>

              <div className="bg-surface-raised/50 rounded p-2 border border-white/5">
                <div className="text-text-muted">IndexedDB</div>
                <div className="text-text-primary font-semibold mt-1">{textEffectsCacheStats.indexedDB} effects</div>
              </div>

              <div className="bg-surface-raised/50 rounded p-2 border border-white/5">
                <div className="text-text-muted">Disk Size</div>
                <div className="text-text-primary font-semibold mt-1">{textEffectsCacheStats.totalMB.toFixed(2)} MB</div>
              </div>
            </div>
          </div>
        )}

        {apiCacheStatus && (
          <div className={`flex items-center gap-3 p-2 rounded-lg border text-xs ${apiCacheStatus.type === "success" ? "bg-green-500/10 border-green-500/30 text-green-400" : "bg-red-500/10 border-red-500/30 text-red-400"}`}>
            {apiCacheStatus.type === "success" ? <CheckCircle className="w-5 h-5 shrink-0 mt-0.5" /> : <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />}
            <p className="font-medium flex-1">{apiCacheStatus.message}</p>
          </div>
        )}

        <div className="w-full">
          <button onClick={handleClearLocalApiCache} disabled={isClearingApi} className="w-full flex items-center gap-3 p-4 bg-surface-raised/20 hover:bg-surface-raised/40 border border-white/6 hover:border-blue-500/30 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer">
            <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">{isClearingApi ? <RefreshCw className="w-5 h-5 text-blue-400 animate-spin" /> : <Database className="w-5 h-5 text-blue-400" />}</div>
            <div className="text-left flex-1">
              <div className="font-medium text-text-primary text-xs">Clear Local Cache</div>
              <div className="text-[10px] text-text-muted">Memory + IndexedDB</div>
            </div>
          </button>
        </div>

        <div className="flex items-start gap-3 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <AlertCircle className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
          <p className="text-[11px] text-blue-200/90">Local cache stores effects on your device for faster access.</p>
        </div>
      </div>

      {/* Filmstrip & Media Pipeline Disk Cache */}
      <div className="space-y-3 pt-4 border-t border-white/6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-[13px] font-semibold uppercase tracking-wider text-text-muted mb-1">Filmstrip & Media Cache</h3>
            <p className="text-[11px] text-text-muted">High-performance WebP atlases and persistent timeline frames.</p>
          </div>
          <button
            onClick={loadFilmstripStats}
            title="Refresh Filmstrip Stats"
            className="p-1.5 rounded-md hover:bg-surface-raised/40 text-text-muted hover:text-text-primary transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Filmstrip Disk Cache Stats */}
        <div className="bg-surface-raised/30 border border-white/6 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs">
            <Film className="w-4 h-4 text-accent" />
            <span className="font-semibold text-text-primary">Timeline Frame Cache</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]">
            <div className="bg-surface-raised/50 rounded p-2 border border-white/5">
              <div className="text-text-muted">Disk Usage</div>
              <div className="text-text-primary font-semibold mt-1">
                {filmstripDiskStats ? `${(filmstripDiskStats.total_bytes / (1024 * 1024)).toFixed(1)} MB` : "0.0 MB"}
              </div>
            </div>

            <div className="bg-surface-raised/50 rounded p-2 border border-white/5">
              <div className="text-text-muted">WebP Atlases</div>
              <div className="text-text-primary font-semibold mt-1">
                {filmstripDiskStats ? filmstripDiskStats.atlas_count : 0} files
              </div>
            </div>

            <div className="bg-surface-raised/50 rounded p-2 border border-white/5">
              <div className="text-text-muted">Cache Hit Rate</div>
              <div className="text-text-primary font-semibold mt-1">
                {filmstripDiskStats ? `${filmstripDiskStats.hit_rate_pct.toFixed(1)}%` : "0.0%"}
              </div>
            </div>

            <div className="bg-surface-raised/50 rounded p-2 border border-white/5">
              <div className="text-text-muted">Avg Time-to-Visible</div>
              <div className="text-text-primary font-semibold mt-1 text-green-400">
                {telemetrySummary.avgTimeToVisibleMs > 0 ? `${telemetrySummary.avgTimeToVisibleMs.toFixed(1)} ms` : "< 10 ms"}
              </div>
            </div>
          </div>

          {/* Cache Size Limit Selector */}
          <div className="flex items-center justify-between pt-2 border-t border-white/5 text-[11px]">
            <span className="text-text-muted">Disk Cache Storage Limit</span>
            <select
              value={filmstripLimitGb}
              onChange={(e) => handleSetFilmstripLimit(e.target.value)}
              className="bg-surface-raised/80 border border-white/10 rounded px-2 py-1 text-text-primary text-xs focus:outline-none focus:border-accent"
            >
              <option value="1">1 GB (Conservative)</option>
              <option value="5">5 GB (Recommended)</option>
              <option value="10">10 GB (High Performance)</option>
              <option value="20">20 GB (Heavy Timeline)</option>
              <option value="0">Unlimited</option>
            </select>
          </div>
        </div>

        <div className="w-full">
          <button
            onClick={handleClearFilmstripCache}
            disabled={isClearingFilmstrip}
            className="w-full flex items-center gap-3 p-4 bg-surface-raised/20 hover:bg-surface-raised/40 border border-white/6 hover:border-red-500/30 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center">
              {isClearingFilmstrip ? <RefreshCw className="w-5 h-5 text-red-400 animate-spin" /> : <Trash2 className="w-5 h-5 text-red-400" />}
            </div>
            <div className="text-left flex-1">
              <div className="font-medium text-text-primary text-xs">Purge Filmstrip Disk Cache</div>
              <div className="text-[10px] text-text-muted">Deletes all cached timeline WebP atlases and resets tier cache</div>
            </div>
          </button>
        </div>
      </div>

      {/* Audio Library Cache Management */}
      <div className="space-y-3 pt-4 border-t border-white/6">
        <div>
          <h3 className="text-[13px] font-semibold uppercase tracking-wider text-text-muted mb-2">Audio Library Cache</h3>
          <p className="text-[11px] text-text-muted">Manage downloaded audio files from the audio library.</p>
        </div>

        {/* Audio Cache Stats */}
        <div className="bg-surface-raised/30 border border-white/6 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs">
            <Music2 className="w-4 h-4 text-accent" />
            <span className="font-semibold text-text-primary">Cached Audio Files</span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-[11px]">
            <div className="bg-surface-raised/50 rounded p-2 border border-white/5">
              <div className="text-text-muted">Files</div>
              <div className="text-text-primary font-semibold mt-1">{audioCacheStats.count}</div>
            </div>

            <div className="bg-surface-raised/50 rounded p-2 border border-white/5">
              <div className="text-text-muted">Total Size</div>
              <div className="text-text-primary font-semibold mt-1">{(audioCacheStats.totalSize / (1024 * 1024)).toFixed(2)} MB</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button onClick={refreshAudioStats} disabled={isClearingAudio} className="flex items-center gap-3 p-4 bg-surface-raised/20 hover:bg-surface-raised/40 border border-white/6 hover:border-accent/30 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer">
            <div className="w-10 h-10 rounded-lg bg-accent/20 flex items-center justify-center">
              <RefreshCw className="w-5 h-5 text-accent" />
            </div>
            <div className="text-left flex-1">
              <div className="font-medium text-text-primary text-xs">Refresh Stats</div>
              <div className="text-[10px] text-text-muted">Update cache information</div>
            </div>
          </button>

          <button onClick={handleClearAudioCache} disabled={isClearingAudio} className="flex items-center gap-3 p-4 bg-surface-raised/20 hover:bg-surface-raised/40 border border-white/6 hover:border-red-500/30 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer">
            <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center">{isClearingAudio ? <RefreshCw className="w-5 h-5 text-red-400 animate-spin" /> : <Trash2 className="w-5 h-5 text-red-400" />}</div>
            <div className="text-left flex-1">
              <div className="font-medium text-text-primary text-xs">Clear Audio Cache</div>
              <div className="text-[10px] text-text-muted">Delete all downloaded files</div>
            </div>
          </button>
        </div>

        <div className="flex items-start gap-3 p-3 bg-orange-500/10 border border-orange-500/30 rounded-lg">
          <AlertCircle className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" />
          <p className="text-[11px] text-orange-200/90">Clearing audio cache will remove all downloaded library files. You'll need to download them again when adding to timeline.</p>
        </div>
      </div>

      {/* Warning Note */}
      <div className="flex items-start gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
        <AlertCircle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
        <div className="text-[11px] text-yellow-200/90">
          <p className="font-semibold mb-1">Important Notes:</p>
          <ul className="space-y-1 list-disc list-inside">
            <li>Clearing cache may require an application restart for full effect</li>
            <li>WebView cache (Windows) may be locked by running processes</li>
            <li>Your settings and preferences will be preserved</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

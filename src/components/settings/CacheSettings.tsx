import React, { useState, useEffect } from "react";
import {
  Trash2,
  HardDrive,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Cloud,
  Database,
  Music2,
  Layers,
  Film,
  Gauge,
  ChevronDown,
  Sparkles,
  LayoutTemplate,
} from "lucide-react";
import { useCacheManager } from "@/hooks/useCacheManager";
import { TextEffectsCacheManager } from "@/features/text-effects/cache/cacheManager";
import { TextTemplatesCacheManager } from "@/features/text-templates/cache/cacheManager";
import { useAudioLibraryStore } from "@/features/audio-library/store/audioLibraryStore";
import { useSettingsStore } from "@/store/settingsStore";
import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "@/lib/platform/tauri";
import {
  filmstripTelemetry,
  type FilmstripSessionSummary,
} from "@/lib/filmstrip/filmstripTelemetry";
import { toast } from "@/lib/toast";

export const CacheSettings: React.FC = () => {
  const {
    isClearing,
    cacheInfo,
    lastResult,
    clearAllCaches,
    clearAppCache,
    clearWebViewCache,
    clearGPUCache,
  } = useCacheManager();
  const { getCacheStats, clearAllCache: clearAudioCache } =
    useAudioLibraryStore();

  const { autoClearCacheOnProjectClose, setAutoClearCacheOnProjectClose } =
    useSettingsStore();
  const [tipsExpanded, setTipsExpanded] = useState(false);
  const [apiCacheStatus, setApiCacheStatus] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [isClearingApi, setIsClearingApi] = useState(false);
  const [textEffectsCacheStats, setTextEffectsCacheStats] = useState<{
    zustand: number;
    indexedDB: number;
    totalMB: number;
  } | null>(null);
  const [textTemplatesCacheStats, setTextTemplatesCacheStats] = useState<{
    memory: number;
    indexedDB: number;
    totalMB: number;
  } | null>(null);
  const [isClearingTemplates, setIsClearingTemplates] = useState(false);
  const [audioCacheStats, setAudioCacheStats] = useState({
    count: 0,
    totalSize: 0,
    items: [] as any[],
  });
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
  const [telemetrySummary, setTelemetrySummary] =
    useState<FilmstripSessionSummary>(filmstripTelemetry.getSummary());

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
        console.warn(
          "[CacheSettings] Failed to fetch filmstrip disk stats:",
          e,
        );
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
        const msg = `Filmstrip & media disk cache purged (${purgedCount} atlas files deleted)`;
        setApiCacheStatus({
          type: "success",
          message: msg,
        });
        toast.success(msg);
      } else {
        filmstripTelemetry.clear();
        setApiCacheStatus({
          type: "success",
          message: "Filmstrip cache reset",
        });
        toast.success("Filmstrip cache reset");
      }
      setTimeout(() => setApiCacheStatus(null), 3000);
    } catch (e) {
      setApiCacheStatus({
        type: "error",
        message: "Failed to clear filmstrip disk cache",
      });
      toast.error("Failed to clear filmstrip disk cache");
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
        toast.success(
          `Cache size limit set to ${gb === 0 ? "Unlimited" : `${gb} GB`}`,
        );
      } catch (e) {
        console.error("Failed to set cache limit:", e);
        toast.error("Failed to set cache limit");
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
      console.error(
        "[CacheSettings] Failed to load text effects cache stats:",
        e,
      );
    }
  };

  const loadTextTemplatesCacheStats = async () => {
    try {
      const stats = await TextTemplatesCacheManager.getStats();
      setTextTemplatesCacheStats({
        memory: stats.memoryCount,
        indexedDB: stats.indexedDBCount,
        totalMB: stats.sizeMB,
      });
    } catch (e) {
      console.error(
        "[CacheSettings] Failed to load text template cache stats:",
        e,
      );
    }
  };

  useEffect(() => {
    loadTextTemplatesCacheStats();
  }, []);

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

      const msg = "All text effects cache cleared";
      setApiCacheStatus({ type: "success", message: msg });
      toast.success(msg);
      setTimeout(() => setApiCacheStatus(null), 3000);
    } catch (error) {
      setApiCacheStatus({
        type: "error",
        message: "Failed to clear text effects cache",
      });
      toast.error("Failed to clear text effects cache");
      setTimeout(() => setApiCacheStatus(null), 5000);
    } finally {
      setIsClearingApi(false);
    }
  };

  const handleClearTextTemplatesCache = async () => {
    setIsClearingTemplates(true);
    try {
      const result = await TextTemplatesCacheManager.clearAll();
      await loadTextTemplatesCacheStats();
      const msg = `Text template cache cleared (${result.apiEntries} API entries)`;
      setApiCacheStatus({ type: "success", message: msg });
      toast.success(msg);
      setTimeout(() => setApiCacheStatus(null), 3000);
    } catch (error) {
      console.error("[CacheSettings] Text template cache clear error:", error);
      setApiCacheStatus({
        type: "error",
        message: "Failed to clear text template cache",
      });
      toast.error("Failed to clear text template cache");
      setTimeout(() => setApiCacheStatus(null), 5000);
    } finally {
      setIsClearingTemplates(false);
    }
  };

  const handleClearAudioCache = async () => {
    setIsClearingAudio(true);
    try {
      await clearAudioCache();
      refreshAudioStats();
      const msg = "Audio library cache cleared successfully";
      setApiCacheStatus({ type: "success", message: msg });
      toast.success(msg);
      setTimeout(() => setApiCacheStatus(null), 3000);
    } catch (error) {
      console.error("[CacheSettings] Audio cache clear error:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Failed to clear audio cache";
      setApiCacheStatus({
        type: "error",
        message: `Audio cache error: ${errorMessage}`,
      });
      toast.error(`Audio cache error: ${errorMessage}`);
      setTimeout(() => setApiCacheStatus(null), 5000);
    } finally {
      setIsClearingAudio(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-[13px] font-semibold text-text-primary mb-1">Cache Management</h2>
        <p className="text-[11px] text-text-muted leading-relaxed">
          Clear cached data to free up disk space or resolve performance issues.
        </p>
      </div>

      {/* Cache Status Overview */}
      {cacheInfo && (
        <section className="rounded-xl bg-surface-raised/40 border border-white/5 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <HardDrive className="w-3.5 h-3.5 text-accent" />
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Cache Status</h3>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="bg-surface-raised/60 rounded-lg p-2.5 border border-white/5">
              <div className="text-text-muted mb-1">localStorage</div>
              <div className="text-text-primary font-semibold">{cacheInfo.localStorage} items</div>
            </div>
            <div className="bg-surface-raised/60 rounded-lg p-2.5 border border-white/5">
              <div className="text-text-muted mb-1">sessionStorage</div>
              <div className="text-text-primary font-semibold">{cacheInfo.sessionStorage} items</div>
            </div>
            {cacheInfo.gpuCache && (
              <>
                <div className="bg-surface-raised/60 rounded-lg p-2.5 border border-white/5">
                  <div className="text-text-muted mb-1">GPU Textures</div>
                  <div className="text-text-primary font-semibold">{cacheInfo.gpuCache.textureCount || 0}</div>
                </div>
                <div className="bg-surface-raised/60 rounded-lg p-2.5 border border-white/5">
                  <div className="text-text-muted mb-1">GPU Memory</div>
                  <div className="text-text-primary font-semibold">{cacheInfo.gpuCache.memoryMB || "0"} MB</div>
                </div>
              </>
            )}
          </div>
        </section>
      )}

      {/* Inline clear result */}
      {lastResult && (
        <div className={`flex items-start gap-2.5 p-3 rounded-lg border text-xs ${lastResult.success ? "bg-green-500/10 border-green-500/25 text-green-400" : "bg-red-500/10 border-red-500/25 text-red-400"}`}>
          {lastResult.success ? <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />}
          <div className="flex-1">
            <p className="font-medium">{lastResult.message}</p>
            {lastResult.stats?.errors && lastResult.stats.errors.length > 0 && (
              <ul className="mt-1.5 space-y-0.5 text-[10px] opacity-80">
                {lastResult.stats.errors.map((error: string, idx: number) => (<li key={idx}>• {error}</li>))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* General Cache Actions */}
      <section className="space-y-2">
        {/* Clear All — prominent row */}
        <button
          onClick={() => clearAllCaches({ localStorage: false })}
          disabled={isClearing}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-raised/40 hover:bg-surface-raised/60 border border-white/6 hover:border-accent/30 transition-all group disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          <div className="w-8 h-8 rounded-lg bg-accent/15 flex items-center justify-center group-hover:bg-accent/25 transition-colors shrink-0">
            <Trash2 className="w-4 h-4 text-accent" />
          </div>
          <div className="text-left flex-1 min-w-0">
            <div className="text-[12px] font-semibold text-text-primary">Clear All Caches</div>
            <div className="text-[10px] text-text-muted truncate">App cache, WebView, GPU, and IndexedDB</div>
          </div>
          {isClearing && <RefreshCw className="w-4 h-4 text-accent animate-spin shrink-0" />}
        </button>

        {/* Individual cache buttons */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "App Cache", icon: HardDrive, action: clearAppCache },
            { label: "WebView", icon: RefreshCw, action: clearWebViewCache },
            { label: "GPU Cache", icon: Trash2, action: clearGPUCache },
          ].map(({ label, icon: Icon, action }) => (
            <button
              key={label}
              onClick={() => action()}
              disabled={isClearing}
              className="flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl bg-surface-raised/30 hover:bg-surface-raised/50 border border-white/5 hover:border-accent/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <Icon className="w-4 h-4 text-accent" />
              <span className="text-[10px] font-medium text-text-muted text-center leading-tight">{label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Text Effects Cache */}
      <section className="space-y-2.5 pt-4 border-t border-white/6">
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Text Effects Cache</h3>
          <p className="text-[10px] text-text-muted mt-0.5">Memory and IndexedDB cache for text effects.</p>
        </div>

        {textEffectsCacheStats && (
          <div className="grid grid-cols-3 gap-2 text-[11px]">
            <div className="bg-surface-raised/40 rounded-lg p-2.5 border border-white/5 text-center">
              <div className="text-text-muted text-[10px] mb-1">Memory</div>
              <div className="text-text-primary font-semibold">{textEffectsCacheStats.zustand}</div>
            </div>
            <div className="bg-surface-raised/40 rounded-lg p-2.5 border border-white/5 text-center">
              <div className="text-text-muted text-[10px] mb-1">IndexedDB</div>
              <div className="text-text-primary font-semibold">{textEffectsCacheStats.indexedDB}</div>
            </div>
            <div className="bg-surface-raised/40 rounded-lg p-2.5 border border-white/5 text-center">
              <div className="text-text-muted text-[10px] mb-1">Disk</div>
              <div className="text-text-primary font-semibold">{textEffectsCacheStats.totalMB.toFixed(1)} MB</div>
            </div>
          </div>
        )}

        {apiCacheStatus && (
          <div className={`flex items-center gap-2.5 p-2.5 rounded-lg border text-xs ${apiCacheStatus.type === "success" ? "bg-green-500/10 border-green-500/25 text-green-400" : "bg-red-500/10 border-red-500/25 text-red-400"}`}>
            {apiCacheStatus.type === "success" ? <CheckCircle className="w-3.5 h-3.5 shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
            <p className="font-medium flex-1">{apiCacheStatus.message}</p>
          </div>
        )}

        <button
          onClick={handleClearLocalApiCache}
          disabled={isClearingApi}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-raised/30 hover:bg-surface-raised/50 border border-white/5 hover:border-blue-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          <div className="w-8 h-8 rounded-lg bg-blue-500/15 flex items-center justify-center shrink-0">
            {isClearingApi ? <RefreshCw className="w-4 h-4 text-blue-400 animate-spin" /> : <Database className="w-4 h-4 text-blue-400" />}
          </div>
          <div className="text-left flex-1">
            <div className="text-[12px] font-medium text-text-primary">Clear Text Effects Cache</div>
            <div className="text-[10px] text-text-muted">Memory + IndexedDB</div>
          </div>
        </button>

        <p className="text-[10px] text-text-muted px-1 leading-relaxed">Local cache stores effects on your device for faster access.</p>
      </section>

      {/* Text Templates Cache */}
      <section className="space-y-2.5 pt-4 border-t border-white/6">
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Text Templates Cache</h3>
          <p className="text-[10px] text-text-muted mt-0.5">Revision-pinned catalogs stored locally for offline-safe editor previews.</p>
        </div>

        {textTemplatesCacheStats && (
          <div className="grid grid-cols-3 gap-2 text-[11px]">
            <div className="bg-surface-raised/40 rounded-lg p-2.5 border border-white/5 text-center">
              <div className="text-text-muted text-[10px] mb-1">Memory</div>
              <div className="text-text-primary font-semibold">{textTemplatesCacheStats.memory}</div>
            </div>
            <div className="bg-surface-raised/40 rounded-lg p-2.5 border border-white/5 text-center">
              <div className="text-text-muted text-[10px] mb-1">IndexedDB</div>
              <div className="text-text-primary font-semibold">{textTemplatesCacheStats.indexedDB}</div>
            </div>
            <div className="bg-surface-raised/40 rounded-lg p-2.5 border border-white/5 text-center">
              <div className="text-text-muted text-[10px] mb-1">Disk</div>
              <div className="text-text-primary font-semibold">{textTemplatesCacheStats.totalMB.toFixed(1)} MB</div>
            </div>
          </div>
        )}

        <button
          onClick={handleClearTextTemplatesCache}
          disabled={isClearingTemplates}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-raised/30 hover:bg-surface-raised/50 border border-white/5 hover:border-purple-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          <div className="w-8 h-8 rounded-lg bg-purple-500/15 flex items-center justify-center shrink-0">
            {isClearingTemplates ? <RefreshCw className="w-4 h-4 text-purple-400 animate-spin" /> : <LayoutTemplate className="w-4 h-4 text-purple-400" />}
          </div>
          <div className="text-left flex-1">
            <div className="text-[12px] font-medium text-text-primary">Clear Text Template Cache</div>
            <div className="text-[10px] text-text-muted">Catalogs, revision payloads, memory, and IndexedDB</div>
          </div>
        </button>

        <p className="text-[10px] text-text-muted px-1 leading-relaxed">Timeline instances keep their immutable snapshot and are not affected by this action.</p>
      </section>

      {/* Filmstrip & Media Pipeline Disk Cache */}
      <section className="space-y-2.5 pt-4 border-t border-white/6">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Filmstrip &amp; Media Cache</h3>
            <p className="text-[10px] text-text-muted mt-0.5">High-performance WebP atlases and persistent timeline frames.</p>
          </div>
          <button
            onClick={loadFilmstripStats}
            title="Refresh Filmstrip Stats"
            className="p-1.5 rounded-lg hover:bg-surface-raised/50 text-text-muted hover:text-text-primary transition-colors cursor-pointer shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="rounded-xl bg-surface-raised/40 border border-white/5 p-3.5 space-y-3">
          <div className="flex items-center gap-2">
            <Film className="w-3.5 h-3.5 text-accent" />
            <span className="text-[11px] font-semibold text-text-primary">Timeline Frame Cache</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
            <div className="bg-surface-raised/60 rounded-lg p-2.5 border border-white/5">
              <div className="text-text-muted text-[10px] mb-1">Disk Usage</div>
              <div className="text-text-primary font-semibold">
                {filmstripDiskStats ? `${(filmstripDiskStats.total_bytes / (1024 * 1024)).toFixed(1)} MB` : "0.0 MB"}
              </div>
            </div>
            <div className="bg-surface-raised/60 rounded-lg p-2.5 border border-white/5">
              <div className="text-text-muted text-[10px] mb-1">WebP Atlases</div>
              <div className="text-text-primary font-semibold">{filmstripDiskStats ? filmstripDiskStats.atlas_count : 0} files</div>
            </div>
            <div className="bg-surface-raised/60 rounded-lg p-2.5 border border-white/5">
              <div className="text-text-muted text-[10px] mb-1">Hit Rate</div>
              <div className="text-text-primary font-semibold">
                {filmstripDiskStats ? `${filmstripDiskStats.hit_rate_pct.toFixed(1)}%` : "0.0%"}
              </div>
            </div>
            <div className="bg-surface-raised/60 rounded-lg p-2.5 border border-white/5">
              <div className="text-text-muted text-[10px] mb-1">Avg Latency</div>
              <div className="text-green-400 font-semibold">
                {telemetrySummary.avgTimeToVisibleMs > 0 ? `${telemetrySummary.avgTimeToVisibleMs.toFixed(1)} ms` : "< 10 ms"}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-white/5">
            <span className="text-[10px] text-text-muted">Disk Cache Limit</span>
            <select
              value={filmstripLimitGb}
              onChange={(e) => handleSetFilmstripLimit(e.target.value)}
              className="bg-surface-raised/80 border border-white/10 rounded-lg px-2.5 py-1 text-text-primary text-[11px] focus:outline-none focus:border-accent/40 cursor-pointer"
            >
              <option value="1">1 GB — Conservative</option>
              <option value="5">5 GB — Recommended</option>
              <option value="10">10 GB — High Performance</option>
              <option value="20">20 GB — Heavy Timeline</option>
              <option value="0">Unlimited</option>
            </select>
          </div>
        </div>

        <button
          onClick={handleClearFilmstripCache}
          disabled={isClearingFilmstrip}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-raised/30 hover:bg-surface-raised/50 border border-white/5 hover:border-red-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          <div className="w-8 h-8 rounded-lg bg-red-500/15 flex items-center justify-center shrink-0">
            {isClearingFilmstrip ? <RefreshCw className="w-4 h-4 text-red-400 animate-spin" /> : <Trash2 className="w-4 h-4 text-red-400" />}
          </div>
          <div className="text-left flex-1">
            <div className="text-[12px] font-medium text-text-primary">Purge Filmstrip Disk Cache</div>
            <div className="text-[10px] text-text-muted">Deletes all cached timeline WebP atlases and resets tier cache</div>
          </div>
        </button>
      </section>

      {/* Audio Library Cache Management */}
      <section className="space-y-2.5 pt-4 border-t border-white/6">
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Audio Library Cache</h3>
          <p className="text-[10px] text-text-muted mt-0.5">Manage downloaded audio files from the audio library.</p>
        </div>

        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="bg-surface-raised/40 rounded-lg p-2.5 border border-white/5 flex items-center gap-2.5">
            <Music2 className="w-3.5 h-3.5 text-accent shrink-0" />
            <div>
              <div className="text-text-muted text-[10px]">Files cached</div>
              <div className="text-text-primary font-semibold">{audioCacheStats.count}</div>
            </div>
          </div>
          <div className="bg-surface-raised/40 rounded-lg p-2.5 border border-white/5 flex items-center gap-2.5">
            <Gauge className="w-3.5 h-3.5 text-accent shrink-0" />
            <div>
              <div className="text-text-muted text-[10px]">Total size</div>
              <div className="text-text-primary font-semibold">{(audioCacheStats.totalSize / (1024 * 1024)).toFixed(2)} MB</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={refreshAudioStats}
            disabled={isClearingAudio}
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-surface-raised/30 hover:bg-surface-raised/50 border border-white/5 hover:border-accent/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5 text-accent shrink-0" />
            <div className="text-left min-w-0">
              <div className="text-[11px] font-medium text-text-primary">Refresh Stats</div>
              <div className="text-[9px] text-text-muted">Update information</div>
            </div>
          </button>

          <button
            onClick={handleClearAudioCache}
            disabled={isClearingAudio}
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-surface-raised/30 hover:bg-surface-raised/50 border border-white/5 hover:border-red-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <div className="shrink-0">
              {isClearingAudio ? <RefreshCw className="w-3.5 h-3.5 text-red-400 animate-spin" /> : <Trash2 className="w-3.5 h-3.5 text-red-400" />}
            </div>
            <div className="text-left min-w-0">
              <div className="text-[11px] font-medium text-text-primary">Clear Audio Cache</div>
              <div className="text-[9px] text-text-muted">Delete downloaded files</div>
            </div>
          </button>
        </div>

        <p className="text-[10px] text-text-muted px-1 leading-relaxed">Clearing audio cache removes all downloaded library files. They'll re-download when needed.</p>
      </section>

      {/* Auto Cache Cleanup Preference */}
      <section className="pt-4 border-t border-white/6">
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl bg-surface-raised/40 border border-white/5">
          <div>
            <div className="text-[12px] font-medium text-text-primary">Auto-clear Cache on Project Close</div>
            <div className="text-[10px] text-text-muted mt-0.5">Frees temporary GPU frame cache when switching or closing projects.</div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={autoClearCacheOnProjectClose}
            onClick={() => setAutoClearCacheOnProjectClose(!autoClearCacheOnProjectClose)}
            className={`w-9 h-5 rounded-full relative shrink-0 transition-colors cursor-pointer ${autoClearCacheOnProjectClose ? "bg-accent" : "bg-white/10"}`}
          >
            <div
              className={`absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform duration-150 ${
                autoClearCacheOnProjectClose ? "translate-x-4.5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </section>

      {/* Tips — collapsible */}
      <div className="rounded-xl border border-white/6 overflow-hidden bg-surface-raised/20">
        <button
          onClick={() => setTipsExpanded((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-[12px] font-semibold text-text-primary hover:bg-white/[0.03] transition-colors cursor-pointer"
        >
          <span className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-accent" />
            Long-Form &amp; Large Project Tips
          </span>
          <ChevronDown className={`w-3.5 h-3.5 text-text-muted transition-transform duration-150 ${tipsExpanded ? "rotate-180" : ""}`} />
        </button>
        {tipsExpanded && (
          <ul className="px-4 pb-4 pt-3 space-y-2 border-t border-white/6">
            {[
              "Editing 4K+ footage over 30 min? Enable Proxy Editing Mode in Editor → Performance settings.",
              "Set Preview Resolution to Medium or Proxy for multi-hour timelines to maintain 60 FPS scrub.",
              "Use the cache clear buttons above between long editing sessions to free GPU memory.",
              "Clypra never loads full video files into RAM — only decoded frames are cached (1 GiB default).",
              "Long exports run as streaming GPU pipelines — Clypra will not overheat or crash on hour-long exports.",
            ].map((tip, i) => (
              <li key={i} className="text-[10px] text-text-muted leading-relaxed flex gap-2">
                <span className="text-accent shrink-0 mt-0.5">•</span>
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Note */}
      <p className="text-[10px] text-text-muted leading-relaxed px-1">
        Clearing cache may require a restart for full effect. Your settings and preferences are always preserved.
      </p>
    </div>
  );
};

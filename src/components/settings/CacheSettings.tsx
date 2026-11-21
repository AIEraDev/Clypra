import React, { useState, useEffect, useCallback } from "react";
import {
  Trash2,
  HardDrive,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Database,
  Music2,
  Layers,
  Film,
  Gauge,
  ChevronDown,
  Sparkles,
  LayoutTemplate,
  ShieldCheck,
} from "lucide-react";
import { useCacheManager } from "@/hooks/useCacheManager";
import { TextEffectsCacheManager } from "@/features/text-effects/cache/cacheManager";
import { TextTemplatesCacheManager } from "@/features/text-templates/cache/cacheManager";
import { useAudioLibraryStore } from "@/features/audio-library/store/audioLibraryStore";
import { useSettingsStore } from "@/store/settingsStore";
import { isTauriRuntime } from "@/lib/platform/tauri";
import {
  filmstripTelemetry,
  type FilmstripSessionSummary,
} from "@/lib/filmstrip/filmstripTelemetry";
import { toast } from "@/lib/toast";
import { useUnifiedCache, type IntegrityReport } from "@/hooks/useUnifiedCache";

export const CacheSettings: React.FC = () => {
  // ---------------------------------------------------------------------------
  // Unified cache hook — disk stats + IPC commands via useUnifiedCache
  // ---------------------------------------------------------------------------
  const {
    stats: unifiedStats,
    memoryStats,
    isLoading: isUnifiedLoading,
    refresh: refreshUnified,
    setLimit: setUnifiedLimit,
    purge: purgeUnified,
    verifyIntegrity,
    compact: compactUnified,
  } = useUnifiedCache();

  const [integrityReport, setIntegrityReport] =
    useState<IntegrityReport | null>(null);
  const [isVerifyingIntegrity, setIsVerifyingIntegrity] = useState(false);
  const [isCompacting, setIsCompacting] = useState(false);
  const [diskLimitGb, setDiskLimitGb] = useState<string>("5");
  const [isClearingFilmstrip, setIsClearingFilmstrip] = useState(false);

  // Sync diskLimitGb dropdown when unified stats load
  useEffect(() => {
    if (unifiedStats) {
      if (unifiedStats.limitBytes === 0) {
        setDiskLimitGb("0");
      } else {
        const gb = Math.round(unifiedStats.limitBytes / (1024 * 1024 * 1024));
        setDiskLimitGb(String(gb));
      }
    }
  }, [unifiedStats]);

  // ---------------------------------------------------------------------------
  // General / legacy hooks
  // ---------------------------------------------------------------------------
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
  const [isHardReloadingText, setIsHardReloadingText] = useState(false);
  const [audioCacheStats, setAudioCacheStats] = useState({
    count: 0,
    totalSize: 0,
    items: [] as any[],
  });
  const [isClearingAudio, setIsClearingAudio] = useState(false);

  const [telemetrySummary, setTelemetrySummary] =
    useState<FilmstripSessionSummary>(filmstripTelemetry.getSummary());

  /** Refresh telemetry summary snapshot. */
  const loadTelemetrySummary = useCallback(() => {
    setTelemetrySummary(filmstripTelemetry.getSummary());
  }, []);

  useEffect(() => {
    loadTelemetrySummary();
  }, [loadTelemetrySummary]);

  // ---------------------------------------------------------------------------
  // Unified disk cache actions (replace old clear_disk_cache / set_cache_size_limit)
  // ---------------------------------------------------------------------------

  const handleClearFilmstripCache = async () => {
    setIsClearingFilmstrip(true);
    try {
      await purgeUnified({ namespaces: ["thumbnails"] });
      filmstripTelemetry.clear();
      loadTelemetrySummary();
      const msg = "Filmstrip & media disk cache purged";
      setApiCacheStatus({ type: "success", message: msg });
      toast.success(msg);
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

  const handleSetDiskLimit = async (val: string) => {
    setDiskLimitGb(val);
    const gb = Number(val);
    const limitBytes = gb === 0 ? 0 : gb * 1024 * 1024 * 1024;
    try {
      await setUnifiedLimit(limitBytes);
      toast.success(
        `Cache size limit set to ${gb === 0 ? "Unlimited" : `${gb} GB`}`,
      );
    } catch (e) {
      console.error("Failed to set cache limit:", e);
      toast.error("Failed to set cache limit");
    }
  };

  const handleVerifyIntegrity = async () => {
    setIsVerifyingIntegrity(true);
    try {
      const report = await verifyIntegrity();
      setIntegrityReport(report);
      if (report) {
        if (report.quarantinedFiles === 0 && report.errors.length === 0) {
          toast.success("Cache integrity verified — no issues found");
        } else {
          toast.error(`${report.quarantinedFiles} integrity issues found`);
        }
      }
    } catch (e) {
      console.error("[CacheSettings] Integrity verification failed:", e);
      toast.error("Integrity verification failed");
    } finally {
      setIsVerifyingIntegrity(false);
    }
  };

  const handleCompact = async () => {
    setIsCompacting(true);
    try {
      const report = await compactUnified();
      if (report) {
        toast.success(
          `Cache compacted: ${(report.reclaimedBytes / (1024 * 1024)).toFixed(1)} MB reclaimed (${report.removedOrphans} files removed)`,
        );
      }
    } catch (e) {
      console.error("[CacheSettings] Compaction failed:", e);
      toast.error("Cache compaction failed");
    } finally {
      setIsCompacting(false);
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

  const handleHardReloadAllTextData = async () => {
    setIsHardReloadingText(true);
    try {
      const { TextEffectsApi } =
        await import("@/features/text-effects/api/textEffectsApi");
      const { clearTemplateGridCache } =
        await import("@/features/text-templates/components/TemplateGrid");
      clearTemplateGridCache();

      const result = await TextEffectsApi.hardReloadAllTextData();
      await loadTextEffectsCacheStats();
      await loadTextTemplatesCacheStats();

      const msg = `Hard reloaded all text data (${result.effectsCount} effects, ${result.templatesCount} templates)`;
      setApiCacheStatus({ type: "success", message: msg });
      toast.success(msg);
      setTimeout(() => setApiCacheStatus(null), 4000);
    } catch (error) {
      console.error("[CacheSettings] Hard reload text data failed:", error);
      const msg =
        error instanceof Error
          ? error.message
          : "Failed to hard reload text data";
      setApiCacheStatus({ type: "error", message: msg });
      toast.error(msg);
      setTimeout(() => setApiCacheStatus(null), 5000);
    } finally {
      setIsHardReloadingText(false);
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
        <h2 className="text-[13px] font-semibold text-text-primary mb-1">
          Cache Management
        </h2>
        <p className="text-[11px] text-text-muted leading-relaxed">
          Clear cached data to free up disk space or resolve performance issues.
        </p>
      </div>

      {/* Cache Status Overview */}
      {cacheInfo && (
        <section className="rounded-xl bg-surface-raised/40 border border-border-subtle p-4 space-y-3">
          <div className="flex items-center gap-2">
            <HardDrive className="w-3.5 h-3.5 text-accent" />
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
              Cache Status
            </h3>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="bg-surface-raised/60 rounded-lg p-2.5 border border-border-subtle">
              <div className="text-text-muted mb-1">localStorage</div>
              <div className="text-text-primary font-semibold">
                {cacheInfo.localStorage} items
              </div>
            </div>
            <div className="bg-surface-raised/60 rounded-lg p-2.5 border border-border-subtle">
              <div className="text-text-muted mb-1">sessionStorage</div>
              <div className="text-text-primary font-semibold">
                {cacheInfo.sessionStorage} items
              </div>
            </div>
            {cacheInfo.gpuCache && (
              <>
                <div className="bg-surface-raised/60 rounded-lg p-2.5 border border-border-subtle">
                  <div className="text-text-muted mb-1">GPU Textures</div>
                  <div className="text-text-primary font-semibold">
                    {cacheInfo.gpuCache.textureCount || 0}
                  </div>
                </div>
                <div className="bg-surface-raised/60 rounded-lg p-2.5 border border-border-subtle">
                  <div className="text-text-muted mb-1">GPU Memory</div>
                  <div className="text-text-primary font-semibold">
                    {cacheInfo.gpuCache.memoryMB || "0"} MB
                  </div>
                </div>
              </>
            )}
          </div>
        </section>
      )}

      {/* Inline clear result */}
      {lastResult && (
        <div
          className={`flex items-start gap-2.5 p-3 rounded-lg border text-xs ${lastResult.success ? "bg-green-500/10 border-green-500/25 text-green-400" : "bg-red-500/10 border-red-500/25 text-red-400"}`}
        >
          {lastResult.success ? (
            <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          )}
          <div className="flex-1">
            <p className="font-medium">{lastResult.message}</p>
            {lastResult.stats?.errors && lastResult.stats.errors.length > 0 && (
              <ul className="mt-1.5 space-y-0.5 text-[10px] opacity-80">
                {lastResult.stats.errors.map((error: string, idx: number) => (
                  <li key={idx}>• {error}</li>
                ))}
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
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-raised/40 hover:bg-surface-hover border border-border hover:border-accent/30 transition-all group disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          <div className="w-8 h-8 rounded-lg bg-accent/15 flex items-center justify-center group-hover:bg-accent/25 transition-colors shrink-0">
            <Trash2 className="w-4 h-4 text-accent" />
          </div>
          <div className="text-left flex-1 min-w-0">
            <div className="text-[12px] font-semibold text-text-primary">
              Clear All Caches
            </div>
            <div className="text-[10px] text-text-muted truncate">
              App cache, WebView, GPU, and IndexedDB
            </div>
          </div>
          {isClearing && (
            <RefreshCw className="w-4 h-4 text-accent animate-spin shrink-0" />
          )}
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
              className="flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl bg-surface-raised/30 hover:bg-surface-hover border border-border-subtle hover:border-accent/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <Icon className="w-4 h-4 text-accent" />
              <span className="text-[10px] font-medium text-text-muted text-center leading-tight">
                {label}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Text Effects Cache */}
      <section className="space-y-2.5 pt-4 border-t border-border">
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            Text Effects Cache
          </h3>
          <p className="text-[10px] text-text-muted mt-0.5">
            Memory and IndexedDB cache for text effects.
          </p>
        </div>

        {textEffectsCacheStats && (
          <div className="grid grid-cols-3 gap-2 text-[11px]">
            <div className="bg-surface-raised/40 rounded-lg p-2.5 border border-border-subtle text-center">
              <div className="text-text-muted text-[10px] mb-1">Memory</div>
              <div className="text-text-primary font-semibold">
                {textEffectsCacheStats.zustand}
              </div>
            </div>
            <div className="bg-surface-raised/40 rounded-lg p-2.5 border border-border-subtle text-center">
              <div className="text-text-muted text-[10px] mb-1">IndexedDB</div>
              <div className="text-text-primary font-semibold">
                {textEffectsCacheStats.indexedDB}
              </div>
            </div>
            <div className="bg-surface-raised/40 rounded-lg p-2.5 border border-border-subtle text-center">
              <div className="text-text-muted text-[10px] mb-1">Disk</div>
              <div className="text-text-primary font-semibold">
                {textEffectsCacheStats.totalMB.toFixed(1)} MB
              </div>
            </div>
          </div>
        )}

        {apiCacheStatus && (
          <div
            className={`flex items-center gap-2.5 p-2.5 rounded-lg border text-xs ${apiCacheStatus.type === "success" ? "bg-green-500/10 border-green-500/25 text-green-400" : "bg-red-500/10 border-red-500/25 text-red-400"}`}
          >
            {apiCacheStatus.type === "success" ? (
              <CheckCircle className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            )}
            <p className="font-medium flex-1">{apiCacheStatus.message}</p>
          </div>
        )}

        <button
          onClick={handleClearLocalApiCache}
          disabled={isClearingApi}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-raised/30 hover:bg-surface-hover border border-border-subtle hover:border-blue-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          <div className="w-8 h-8 rounded-lg bg-blue-500/15 flex items-center justify-center shrink-0">
            {isClearingApi ? (
              <RefreshCw className="w-4 h-4 text-blue-400 animate-spin" />
            ) : (
              <Database className="w-4 h-4 text-blue-400" />
            )}
          </div>
          <div className="text-left flex-1">
            <div className="text-[12px] font-medium text-text-primary">
              Clear Text Effects Cache
            </div>
            <div className="text-[10px] text-text-muted">
              Memory + IndexedDB
            </div>
          </div>
        </button>

        <p className="text-[10px] text-text-muted px-1 leading-relaxed">
          Local cache stores effects on your device for faster access.
        </p>
      </section>

      {/* Text Templates Cache */}
      <section className="space-y-2.5 pt-4 border-t border-border">
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            Text Templates Cache
          </h3>
          <p className="text-[10px] text-text-muted mt-0.5">
            Revision-pinned catalogs stored locally for offline-safe editor
            previews.
          </p>
        </div>

        {textTemplatesCacheStats && (
          <div className="grid grid-cols-3 gap-2 text-[11px]">
            <div className="bg-surface-raised/40 rounded-lg p-2.5 border border-border-subtle text-center">
              <div className="text-text-muted text-[10px] mb-1">Memory</div>
              <div className="text-text-primary font-semibold">
                {textTemplatesCacheStats.memory}
              </div>
            </div>
            <div className="bg-surface-raised/40 rounded-lg p-2.5 border border-border-subtle text-center">
              <div className="text-text-muted text-[10px] mb-1">IndexedDB</div>
              <div className="text-text-primary font-semibold">
                {textTemplatesCacheStats.indexedDB}
              </div>
            </div>
            <div className="bg-surface-raised/40 rounded-lg p-2.5 border border-border-subtle text-center">
              <div className="text-text-muted text-[10px] mb-1">Disk</div>
              <div className="text-text-primary font-semibold">
                {textTemplatesCacheStats.totalMB.toFixed(1)} MB
              </div>
            </div>
          </div>
        )}

        <button
          onClick={handleClearTextTemplatesCache}
          disabled={isClearingTemplates}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-raised/30 hover:bg-surface-hover border border-border-subtle hover:border-purple-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          <div className="w-8 h-8 rounded-lg bg-purple-500/15 flex items-center justify-center shrink-0">
            {isClearingTemplates ? (
              <RefreshCw className="w-4 h-4 text-purple-400 animate-spin" />
            ) : (
              <LayoutTemplate className="w-4 h-4 text-purple-400" />
            )}
          </div>
          <div className="text-left flex-1">
            <div className="text-[12px] font-medium text-text-primary">
              Clear Text Template Cache
            </div>
            <div className="text-[10px] text-text-muted">
              Catalogs, revision payloads, memory, and IndexedDB
            </div>
          </div>
        </button>

        <p className="text-[10px] text-text-muted px-1 leading-relaxed">
          Timeline instances keep their immutable snapshot and are not affected
          by this action.
        </p>
      </section>

      {/* Dev Mode: Hard Reload Text Effects & Templates */}
      <section className="space-y-2.5 pt-4 border-t border-border">
        <div>
          <div className="flex items-center gap-1.5">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-accent">
              Developer Mode: Text Catalog
            </h3>
            <span className="px-1.5 py-0.5 rounded bg-accent/15 text-accent text-[9px] font-medium">
              Auto-refreshes every 30m
            </span>
          </div>
          <p className="text-[10px] text-text-muted mt-0.5">
            Purges all local RAM, IndexedDB, and browser caches for both text
            effects and text templates, then re-fetches the latest catalog fresh
            from the API.
          </p>
        </div>

        <button
          onClick={handleHardReloadAllTextData}
          disabled={isHardReloadingText}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-accent/10 hover:bg-accent/20 border border-accent/25 hover:border-accent/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center shrink-0">
            {isHardReloadingText ? (
              <RefreshCw className="w-4 h-4 text-accent animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 text-accent" />
            )}
          </div>
          <div className="text-left flex-1">
            <div className="text-[12px] font-semibold text-text-primary">
              Hard Reload &amp; Refresh All Text Data
            </div>
            <div className="text-[10px] text-text-muted">
              Purges all text effects and template caches &amp; refetches latest
              catalog
            </div>
          </div>
        </button>
      </section>

      {/* Unified Disk Cache Breakdown */}
      <section className="space-y-2.5 pt-4 border-t border-border">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
              Disk Cache
            </h3>
            <p className="text-[10px] text-text-muted mt-0.5">
              Unified disk storage across all media pipeline namespaces.
            </p>
          </div>
          <button
            onClick={refreshUnified}
            disabled={isUnifiedLoading}
            title="Refresh disk cache stats"
            className="p-1.5 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors cursor-pointer shrink-0 disabled:opacity-50"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isUnifiedLoading ? "animate-spin" : ""}`}
            />
          </button>
        </div>

        {/* Storage breakdown bar */}
        {unifiedStats && unifiedStats.totalBytes > 0 && (
          <div className="rounded-xl bg-surface-raised/40 border border-border-subtle p-3.5 space-y-3">
            {/* Total + limit */}
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-text-muted">Total used</span>
              <span className="text-text-primary font-semibold">
                {(unifiedStats.totalBytes / (1024 * 1024)).toFixed(0)} MB
                {unifiedStats.limitBytes > 0 && (
                  <span className="text-text-muted font-normal">
                    {" "}
                    /{" "}
                    {(unifiedStats.limitBytes / (1024 * 1024 * 1024)).toFixed(
                      0,
                    )}{" "}
                    GB
                  </span>
                )}
              </span>
            </div>

            {/* Progress bar */}
            {unifiedStats.limitBytes > 0 && (
              <div className="w-full h-1.5 rounded-full bg-surface-elevated overflow-hidden">
                <div
                  className="h-full rounded-full bg-accent transition-all"
                  style={{
                    width: `${Math.min(100, (unifiedStats.totalBytes / unifiedStats.limitBytes) * 100).toFixed(1)}%`,
                  }}
                />
              </div>
            )}

            {/* Per-namespace breakdown */}
            <div className="grid grid-cols-2 gap-1.5 text-[10px]">
              {(
                [
                  {
                    key: "thumbnails",
                    label: "Thumbnails & Filmstrips",
                    color: "text-blue-400",
                  },
                  {
                    key: "audio",
                    label: "Audio Stems",
                    color: "text-purple-400",
                  },
                  {
                    key: "proxies",
                    label: "Video Proxies",
                    color: "text-green-400",
                  },
                  {
                    key: "mattes",
                    label: "AI Mattes",
                    color: "text-orange-400",
                  },
                  {
                    key: "assets",
                    label: "Asset Library",
                    color: "text-cyan-400",
                  },
                  {
                    key: "temp",
                    label: "Temp / Scratch",
                    color: "text-text-muted",
                  },
                ] as const
              ).map(({ key, label, color }) => {
                const bytes = unifiedStats.namespaceBytes[key] ?? 0;
                if (bytes === 0) return null;
                return (
                  <div key={key} className="flex items-center gap-1.5">
                    <span className={`${color} shrink-0`}>■</span>
                    <span className="text-text-muted truncate">{label}</span>
                    <span className="text-text-primary font-medium ml-auto pl-1 shrink-0">
                      {(bytes / (1024 * 1024)).toFixed(0)} MB
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Stats row */}
            <div className="flex items-center gap-4 pt-2 border-t border-border-subtle text-[10px] text-text-muted flex-wrap">
              <span>
                Hit rate:{" "}
                <span className="text-text-primary font-medium">
                  {unifiedStats.hitRatePct.toFixed(1)}%
                </span>
              </span>
              <span>
                Evictions:{" "}
                <span className="text-text-primary font-medium">
                  {unifiedStats.evictionCount}
                </span>
              </span>
              {unifiedStats.mmapCacheBytes != null &&
                unifiedStats.mmapCacheBytes > 0 && (
                  <span>
                    Mmap scrub:{" "}
                    <span className="text-text-primary font-medium">
                      {(unifiedStats.mmapCacheBytes / (1024 * 1024)).toFixed(0)}{" "}
                      MB ({unifiedStats.mmapSlotCount ?? 0} frames)
                    </span>
                  </span>
                )}
            </div>
          </div>
        )}

        {/* In-memory tier breakdown */}
        {memoryStats.totalBytesUsed > 0 && (
          <div className="rounded-xl bg-surface-raised/30 border border-border-subtle p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Gauge className="w-3.5 h-3.5 text-accent" />
              <span className="text-[11px] font-semibold text-text-primary">
                In-Memory Cache
              </span>
              <span className="ml-auto text-[10px] text-text-muted">
                {(memoryStats.totalBytesUsed / (1024 * 1024)).toFixed(0)} MB /{" "}
                {(memoryStats.maxBudgetBytes / (1024 * 1024)).toFixed(0)} MB
                budget
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1.5 text-[10px]">
              {(["memory", "gpu"] as const).map((tier) => {
                const bytes = memoryStats.tierBytes[tier] ?? 0;
                if (bytes === 0) return null;
                return (
                  <div
                    key={tier}
                    className="flex items-center justify-between bg-surface-raised/40 rounded-lg px-2.5 py-1.5 border border-border-subtle"
                  >
                    <span className="text-text-muted capitalize">
                      {tier === "gpu" ? "GPU VRAM" : "RAM"}
                    </span>
                    <span className="text-text-primary font-medium">
                      {(bytes / (1024 * 1024)).toFixed(0)} MB
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Disk quota selector */}
        <div className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-surface-raised/30 border border-border-subtle">
          <span className="text-[11px] text-text-muted">Disk Cache Limit</span>
          <select
            value={diskLimitGb}
            onChange={(e) => handleSetDiskLimit(e.target.value)}
            className="bg-surface-input border border-border rounded-lg px-2.5 py-1 text-text-primary text-[11px] focus:outline-none focus:border-accent/40 cursor-pointer"
          >
            <option value="1">1 GB</option>
            <option value="2">2 GB</option>
            <option value="5">5 GB — Recommended</option>
            <option value="10">10 GB</option>
            <option value="25">25 GB</option>
            <option value="50">50 GB</option>
            <option value="0">Unlimited</option>
          </select>
        </div>

        {/* Integrity report */}
        {integrityReport && (
          <div
            className={`flex items-start gap-2.5 p-3 rounded-lg border text-xs ${
              integrityReport.quarantinedFiles === 0 &&
              integrityReport.errors.length === 0
                ? "bg-green-500/10 border-green-500/25 text-green-400"
                : "bg-red-500/10 border-red-500/25 text-red-400"
            }`}
          >
            {integrityReport.quarantinedFiles === 0 &&
            integrityReport.errors.length === 0 ? (
              <CheckCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            )}
            <div>
              {integrityReport.quarantinedFiles === 0 &&
              integrityReport.errors.length === 0 ? (
                <p>
                  Cache integrity verified — {integrityReport.scannedFiles}{" "}
                  files scanned, no issues.
                </p>
              ) : (
                <p>
                  {integrityReport.quarantinedFiles} integrity issues found (
                  {(integrityReport.quarantinedBytes / 1024).toFixed(0)} KB
                  quarantined).
                </p>
              )}
            </div>
          </div>
        )}

        {/* Per-namespace purge buttons + verify */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={handleClearFilmstripCache}
            disabled={isClearingFilmstrip || isUnifiedLoading}
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-surface-raised/30 hover:bg-surface-hover border border-border-subtle hover:border-red-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <div className="shrink-0">
              {isClearingFilmstrip ? (
                <RefreshCw className="w-3.5 h-3.5 text-red-400 animate-spin" />
              ) : (
                <Film className="w-3.5 h-3.5 text-red-400" />
              )}
            </div>
            <div className="text-left min-w-0">
              <div className="text-[11px] font-medium text-text-primary">
                Purge Filmstrips
              </div>
              <div className="text-[9px] text-text-muted">
                Thumbnails namespace
              </div>
            </div>
          </button>

          <button
            onClick={async () => {
              try {
                await purgeUnified({ namespaces: ["proxies"] });
                toast.success("Video proxies purged");
              } catch {
                toast.error("Failed to purge proxies");
              }
            }}
            disabled={isUnifiedLoading}
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-surface-raised/30 hover:bg-surface-hover border border-border-subtle hover:border-red-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <Layers className="w-3.5 h-3.5 text-orange-400 shrink-0" />
            <div className="text-left min-w-0">
              <div className="text-[11px] font-medium text-text-primary">
                Purge Proxies
              </div>
              <div className="text-[9px] text-text-muted">
                Preview proxy namespace
              </div>
            </div>
          </button>
        </div>

        {/* Verify integrity & Compact cache */}
        {isTauriRuntime() && (
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleVerifyIntegrity}
              disabled={isVerifyingIntegrity || isUnifiedLoading}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-surface-raised/30 hover:bg-surface-hover border border-border-subtle hover:border-accent/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <div className="w-7 h-7 rounded-lg bg-accent/15 flex items-center justify-center shrink-0">
                {isVerifyingIntegrity ? (
                  <RefreshCw className="w-3.5 h-3.5 text-accent animate-spin" />
                ) : (
                  <ShieldCheck className="w-3.5 h-3.5 text-accent" />
                )}
              </div>
              <div className="text-left min-w-0">
                <div className="text-[11px] font-medium text-text-primary">
                  Verify Integrity
                </div>
                <div className="text-[9px] text-text-muted truncate">
                  Quarantine corrupted files
                </div>
              </div>
            </button>

            <button
              onClick={handleCompact}
              disabled={isCompacting || isUnifiedLoading}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-surface-raised/30 hover:bg-surface-hover border border-border-subtle hover:border-accent/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <div className="w-7 h-7 rounded-lg bg-accent/15 flex items-center justify-center shrink-0">
                {isCompacting ? (
                  <RefreshCw className="w-3.5 h-3.5 text-accent animate-spin" />
                ) : (
                  <Database className="w-3.5 h-3.5 text-accent" />
                )}
              </div>
              <div className="text-left min-w-0">
                <div className="text-[11px] font-medium text-text-primary">
                  Compact Cache
                </div>
                <div className="text-[9px] text-text-muted truncate">
                  Reclaim space &amp; orphans
                </div>
              </div>
            </button>
          </div>
        )}
      </section>

      {/* Filmstrip & Media Pipeline Disk Cache (telemetry) */}
      <section className="space-y-2.5 pt-4 border-t border-border">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
              Filmstrip &amp; Media Cache
            </h3>
            <p className="text-[10px] text-text-muted mt-0.5">
              High-performance WebP atlases and persistent timeline frames.
            </p>
          </div>
          <button
            onClick={loadTelemetrySummary}
            title="Refresh Filmstrip Stats"
            className="p-1.5 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors cursor-pointer shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="rounded-xl bg-surface-raised/40 border border-border-subtle p-3.5 space-y-3">
          <div className="flex items-center gap-2">
            <Film className="w-3.5 h-3.5 text-accent" />
            <span className="text-[11px] font-semibold text-text-primary">
              Timeline Frame Cache
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
            <div className="bg-surface-raised/60 rounded-lg p-2.5 border border-border-subtle">
              <div className="text-text-muted text-[10px] mb-1">Disk Usage</div>
              <div className="text-text-primary font-semibold">
                {unifiedStats
                  ? `${((unifiedStats.namespaceBytes["thumbnails"] ?? 0) / (1024 * 1024)).toFixed(1)} MB`
                  : "0.0 MB"}
              </div>
            </div>
            <div className="bg-surface-raised/60 rounded-lg p-2.5 border border-border-subtle">
              <div className="text-text-muted text-[10px] mb-1">
                Atlas Files
              </div>
              <div className="text-text-primary font-semibold">
                {unifiedStats?.namespaceCounts?.["thumbnails"] ?? 0} files
              </div>
            </div>
            <div className="bg-surface-raised/60 rounded-lg p-2.5 border border-border-subtle">
              <div className="text-text-muted text-[10px] mb-1">Hit Rate</div>
              <div className="text-text-primary font-semibold">
                {unifiedStats
                  ? `${unifiedStats.hitRatePct.toFixed(1)}%`
                  : "0.0%"}
              </div>
            </div>
            <div className="bg-surface-raised/60 rounded-lg p-2.5 border border-border-subtle">
              <div className="text-text-muted text-[10px] mb-1">
                Avg Latency
              </div>
              <div className="text-green-400 font-semibold">
                {telemetrySummary.avgTimeToVisibleMs > 0
                  ? `${telemetrySummary.avgTimeToVisibleMs.toFixed(1)} ms`
                  : "< 10 ms"}
              </div>
            </div>
          </div>
        </div>

        <button
          onClick={handleClearFilmstripCache}
          disabled={isClearingFilmstrip}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-raised/30 hover:bg-surface-hover border border-border-subtle hover:border-red-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          <div className="w-8 h-8 rounded-lg bg-red-500/15 flex items-center justify-center shrink-0">
            {isClearingFilmstrip ? (
              <RefreshCw className="w-4 h-4 text-red-400 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4 text-red-400" />
            )}
          </div>
          <div className="text-left flex-1">
            <div className="text-[12px] font-medium text-text-primary">
              Purge Filmstrip Disk Cache
            </div>
            <div className="text-[10px] text-text-muted">
              Deletes all cached timeline WebP atlases and resets tier cache
            </div>
          </div>
        </button>
      </section>

      {/* Audio Library Cache Management */}
      <section className="space-y-2.5 pt-4 border-t border-border">
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            Audio Library Cache
          </h3>
          <p className="text-[10px] text-text-muted mt-0.5">
            Manage downloaded audio files from the audio library.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="bg-surface-raised/40 rounded-lg p-2.5 border border-border-subtle flex items-center gap-2.5">
            <Music2 className="w-3.5 h-3.5 text-accent shrink-0" />
            <div>
              <div className="text-text-muted text-[10px]">Files cached</div>
              <div className="text-text-primary font-semibold">
                {audioCacheStats.count}
              </div>
            </div>
          </div>
          <div className="bg-surface-raised/40 rounded-lg p-2.5 border border-border-subtle flex items-center gap-2.5">
            <Gauge className="w-3.5 h-3.5 text-accent shrink-0" />
            <div>
              <div className="text-text-muted text-[10px]">Total size</div>
              <div className="text-text-primary font-semibold">
                {(audioCacheStats.totalSize / (1024 * 1024)).toFixed(2)} MB
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={refreshAudioStats}
            disabled={isClearingAudio}
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-surface-raised/30 hover:bg-surface-hover border border-border-subtle hover:border-accent/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5 text-accent shrink-0" />
            <div className="text-left min-w-0">
              <div className="text-[11px] font-medium text-text-primary">
                Refresh Stats
              </div>
              <div className="text-[9px] text-text-muted">
                Update information
              </div>
            </div>
          </button>

          <button
            onClick={handleClearAudioCache}
            disabled={isClearingAudio}
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-surface-raised/30 hover:bg-surface-hover border border-border-subtle hover:border-red-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <div className="shrink-0">
              {isClearingAudio ? (
                <RefreshCw className="w-3.5 h-3.5 text-red-400 animate-spin" />
              ) : (
                <Trash2 className="w-3.5 h-3.5 text-red-400" />
              )}
            </div>
            <div className="text-left min-w-0">
              <div className="text-[11px] font-medium text-text-primary">
                Clear Audio Cache
              </div>
              <div className="text-[9px] text-text-muted">
                Delete downloaded files
              </div>
            </div>
          </button>
        </div>

        <p className="text-[10px] text-text-muted px-1 leading-relaxed">
          Clearing audio cache removes all downloaded library files. They'll
          re-download when needed.
        </p>
      </section>

      {/* Auto Cache Cleanup Preference */}
      <section className="pt-4 border-t border-border">
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl bg-surface-raised/40 border border-border-subtle">
          <div>
            <div className="text-[12px] font-medium text-text-primary">
              Auto-clear Cache on Project Close
            </div>
            <div className="text-[10px] text-text-muted mt-0.5">
              Frees temporary GPU frame cache when switching or closing
              projects.
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={autoClearCacheOnProjectClose}
            onClick={() =>
              setAutoClearCacheOnProjectClose(!autoClearCacheOnProjectClose)
            }
            className={`w-9 h-5 rounded-full relative shrink-0 transition-colors cursor-pointer ${autoClearCacheOnProjectClose ? "bg-accent" : "bg-surface-elevated"}`}
          >
            <div
              className={`absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform duration-150 ${
                autoClearCacheOnProjectClose
                  ? "translate-x-4.5"
                  : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </section>

      {/* Tips — collapsible */}
      <div className="rounded-xl border border-border overflow-hidden bg-surface-raised/20">
        <button
          onClick={() => setTipsExpanded((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-[12px] font-semibold text-text-primary hover:bg-white/[0.03] transition-colors cursor-pointer"
        >
          <span className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-accent" />
            Long-Form &amp; Large Project Tips
          </span>
          <ChevronDown
            className={`w-3.5 h-3.5 text-text-muted transition-transform duration-150 ${tipsExpanded ? "rotate-180" : ""}`}
          />
        </button>
        {tipsExpanded && (
          <ul className="px-4 pb-4 pt-3 space-y-2 border-t border-border">
            {[
              "Editing 4K+ footage over 30 min? Enable Proxy Editing Mode in Editor → Performance settings.",
              "Set Preview Resolution to Medium or Proxy for multi-hour timelines to maintain 60 FPS scrub.",
              "Use the cache clear buttons above between long editing sessions to free GPU memory.",
              "Clypra never loads full video files into RAM — only decoded frames are cached (1 GiB default).",
              "Long exports run as streaming GPU pipelines — Clypra will not overheat or crash on hour-long exports.",
            ].map((tip, i) => (
              <li
                key={i}
                className="text-[10px] text-text-muted leading-relaxed flex gap-2"
              >
                <span className="text-accent shrink-0 mt-0.5">•</span>
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Note */}
      <p className="text-[10px] text-text-muted leading-relaxed px-1">
        Clearing cache may require a restart for full effect. Your settings and
        preferences are always preserved.
      </p>
    </div>
  );
};

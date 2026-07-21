import React, { useState, useEffect } from "react";
import { Trash2, HardDrive, RefreshCw, AlertCircle, CheckCircle, Database, Music2, Layers } from "lucide-react";
import { useCacheManager } from "@/hooks/useCacheManager";
import { TextEffectsCacheManager } from "@/features/text-effects/cache/cacheManager";
import { useAudioLibraryStore } from "@/features/audio-library/store/audioLibraryStore";
import { t, type MessageKey } from "@/i18n";

const CACHE_FAILURE_PREFIXES: Array<{ prefix: string; cacheNameKey: MessageKey }> = [
  { prefix: "Failed to clear app cache: ", cacheNameKey: "settings.cache.name.app" },
  { prefix: "Failed to clear WebView cache: ", cacheNameKey: "settings.cache.name.webView" },
  { prefix: "Failed to clear GPU cache: ", cacheNameKey: "settings.cache.name.gpu" },
];

const CACHE_ERROR_PREFIXES: Array<{ prefix: string; messageKey: MessageKey }> = [
  { prefix: "App cache: ", messageKey: "settings.cache.errorDetail.app" },
  { prefix: "WebView cache: ", messageKey: "settings.cache.errorDetail.webView" },
  { prefix: "HTTP cache: ", messageKey: "settings.cache.errorDetail.http" },
  { prefix: "IndexedDB: ", messageKey: "settings.cache.errorDetail.indexedDB" },
  { prefix: "GPU cache: ", messageKey: "settings.cache.errorDetail.gpu" },
  { prefix: "localStorage: ", messageKey: "settings.cache.errorDetail.localStorage" },
  { prefix: "sessionStorage: ", messageKey: "settings.cache.errorDetail.sessionStorage" },
];

export function localizeCacheResultMessage(message: string): string {
  const successMessages: Record<string, MessageKey> = {
    "App cache cleared successfully!": "settings.cache.appCleared",
    "WebView cache cleared successfully!": "settings.cache.webViewCleared",
    "GPU cache cleared successfully!": "settings.cache.gpuCleared",
    "All caches cleared successfully!": "settings.cache.allCleared",
  };

  const successKey = successMessages[message];
  if (successKey) return t(successKey);

  const errorCountMatch = message.match(/^Cleared with (\d+) error\(s\)$/);
  if (errorCountMatch) {
    return t("settings.cache.clearedWithErrors", { count: errorCountMatch[1] });
  }

  for (const { prefix, cacheNameKey } of CACHE_FAILURE_PREFIXES) {
    if (message.startsWith(prefix)) {
      return t("settings.cache.clearFailed", {
        cache: t(cacheNameKey),
        error: message.slice(prefix.length),
      });
    }
  }

  if (message === "Unknown error occurred") {
    return t("settings.cache.unknownError");
  }

  return t("settings.cache.operationFailed", { error: message });
}

export function localizeCacheErrorDetail(error: string): string {
  for (const { prefix, messageKey } of CACHE_ERROR_PREFIXES) {
    if (error.startsWith(prefix)) {
      return t(messageKey, { error: error.slice(prefix.length) });
    }
  }

  return t("settings.cache.operationFailed", { error });
}

export const CacheSettings: React.FC = () => {
  const { isClearing, cacheInfo, lastResult, clearAllCaches, clearAppCache, clearWebViewCache, clearGPUCache } = useCacheManager();
  const { getCacheStats, clearAllCache: clearAudioCache } = useAudioLibraryStore();

  const [apiCacheStatus, setApiCacheStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [isClearingApi, setIsClearingApi] = useState(false);
  const [textEffectsCacheStats, setTextEffectsCacheStats] = useState<{ zustand: number; indexedDB: number; totalMB: number } | null>(null);
  const [audioCacheStats, setAudioCacheStats] = useState({ count: 0, totalSize: 0, items: [] as any[] });
  const [isClearingAudio, setIsClearingAudio] = useState(false);

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

      setApiCacheStatus({ type: "success", message: t("settings.cache.textEffects.cleared") });
      setTimeout(() => setApiCacheStatus(null), 3000);
    } catch (error) {
      setApiCacheStatus({
        type: "error",
        message:
          error instanceof Error
            ? t("settings.cache.textEffects.error", { error: error.message })
            : t("settings.cache.textEffects.clearFailed"),
      });
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
      setApiCacheStatus({ type: "success", message: t("settings.cache.audio.cleared") });
      setTimeout(() => setApiCacheStatus(null), 3000);
    } catch (error) {
      console.error("[CacheSettings] Audio cache clear error:", error);
      setApiCacheStatus({
        type: "error",
        message:
          error instanceof Error
            ? t("settings.cache.audio.error", { error: error.message })
            : t("settings.cache.audio.clearFailed"),
      });
      setTimeout(() => setApiCacheStatus(null), 5000);
    } finally {
      setIsClearingAudio(false);
    }
  };



  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-text-muted mb-2">{t("settings.cache.management.title")}</h3>
        <p className="text-[11px] text-text-muted">{t("settings.cache.management.description")}</p>
      </div>

      {/* Cache Info */}
      {cacheInfo && (
        <div className="bg-surface-raised/30 border border-white/6 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs">
            <HardDrive className="w-4 h-4 text-accent" />
            <span className="font-semibold text-text-primary">{t("settings.cache.status")}</span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-[11px]">
            <div className="bg-surface-raised/50 rounded p-2 border border-white/5">
              <div className="text-text-muted">{t("settings.cache.localStorageItems")}</div>
              <div className="text-text-primary font-semibold mt-1">{t("settings.cache.itemCount", { count: cacheInfo.localStorage })}</div>
            </div>

            <div className="bg-surface-raised/50 rounded p-2 border border-white/5">
              <div className="text-text-muted">{t("settings.cache.sessionStorageItems")}</div>
              <div className="text-text-primary font-semibold mt-1">{t("settings.cache.itemCount", { count: cacheInfo.sessionStorage })}</div>
            </div>

            {cacheInfo.gpuCache && (
              <>
                <div className="bg-surface-raised/50 rounded p-2 border border-white/5">
                  <div className="text-text-muted">{t("settings.cache.gpuTextures")}</div>
                  <div className="text-text-primary font-semibold mt-1">
                    {t("settings.cache.textureCount", { count: cacheInfo.gpuCache.textureCount ?? cacheInfo.gpuCache.textures ?? 0 })}
                  </div>
                </div>

                <div className="bg-surface-raised/50 rounded p-2 border border-white/5">
                  <div className="text-text-muted">{t("settings.cache.gpuMemory")}</div>
                  <div className="text-text-primary font-semibold mt-1">{t("settings.cache.sizeMB", { size: cacheInfo.gpuCache.memoryMB || "0" })}</div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Clear Result Message */}
      {lastResult && (
        <div
          role={lastResult.success ? "status" : "alert"}
          aria-live={lastResult.success ? "polite" : "assertive"}
          className={`flex items-center gap-3 p-2 rounded-lg border text-xs ${lastResult.success ? "bg-green-500/10 border-green-500/30 text-green-400" : "bg-red-500/10 border-red-500/30 text-red-400"}`}
        >
          {lastResult.success ? <CheckCircle className="w-5 h-5 shrink-0 mt-0.5" /> : <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />}
          <div className="flex-1">
            <p className="font-medium">{localizeCacheResultMessage(lastResult.message)}</p>
            {lastResult.stats?.errors && lastResult.stats.errors.length > 0 && (
              <ul className="mt-2 text-[10px] space-y-1">
                {lastResult.stats.errors.map((error: string, idx: number) => (
                  <li key={idx}>• {localizeCacheErrorDetail(error)}</li>
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
              <div className="font-medium text-text-primary text-xs">{t("settings.cache.clearAll")}</div>
              <div className="text-[10px] text-text-muted">{t("settings.cache.clearAllDescription")}</div>
            </div>
          </div>
          {isClearing && <RefreshCw className="w-5 h-5 text-accent animate-spin" />}
        </button>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button onClick={() => clearAppCache()} disabled={isClearing} className="flex flex-col items-center gap-2 p-4 bg-surface-raised/20 hover:bg-surface-raised/40 border border-white/6 hover:border-accent/30 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer">
            <HardDrive className="w-5 h-5 text-accent" />
            <div className="text-[11px] font-medium text-text-primary">{t("settings.cache.appCache")}</div>
          </button>

          <button onClick={() => clearWebViewCache()} disabled={isClearing} className="flex flex-col items-center gap-2 p-4 bg-surface-raised/20 hover:bg-surface-raised/40 border border-white/6 hover:border-accent/30 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer">
            <RefreshCw className="w-5 h-5 text-accent" />
            <div className="text-[11px] font-medium text-text-primary">{t("settings.cache.webView")}</div>
          </button>

          <button onClick={() => clearGPUCache()} disabled={isClearing} className="flex flex-col items-center gap-2 p-4 bg-surface-raised/20 hover:bg-surface-raised/40 border border-white/6 hover:border-accent/30 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer">
            <Trash2 className="w-5 h-5 text-accent" />
            <div className="text-[11px] font-medium text-text-primary">{t("settings.cache.gpuCache")}</div>
          </button>
        </div>
      </div>

      {/* API Cache Management */}
      <div className="space-y-3 pt-4 border-t border-white/6">
        <div>
          <h3 className="text-[13px] font-semibold uppercase tracking-wider text-text-muted mb-2">{t("settings.cache.textEffects.title")}</h3>
          <p className="text-[11px] text-text-muted">{t("settings.cache.textEffects.description")}</p>
        </div>

        {/* Text Effects Cache Stats */}
        {textEffectsCacheStats && (
          <div className="bg-surface-raised/30 border border-white/6 rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs">
              <Layers className="w-4 h-4 text-accent" />
              <span className="font-semibold text-text-primary">{t("settings.cache.textEffects.cached")}</span>
            </div>

            <div className="grid grid-cols-3 gap-3 text-[11px]">
              <div className="bg-surface-raised/50 rounded p-2 border border-white/5">
                <div className="text-text-muted">{t("settings.cache.textEffects.memory")}</div>
                <div className="text-text-primary font-semibold mt-1">{t("settings.cache.effectCount", { count: textEffectsCacheStats.zustand })}</div>
              </div>

              <div className="bg-surface-raised/50 rounded p-2 border border-white/5">
                <div className="text-text-muted">{t("settings.cache.textEffects.indexedDB")}</div>
                <div className="text-text-primary font-semibold mt-1">{t("settings.cache.effectCount", { count: textEffectsCacheStats.indexedDB })}</div>
              </div>

              <div className="bg-surface-raised/50 rounded p-2 border border-white/5">
                <div className="text-text-muted">{t("settings.cache.textEffects.diskSize")}</div>
                <div className="text-text-primary font-semibold mt-1">{t("settings.cache.sizeMB", { size: textEffectsCacheStats.totalMB.toFixed(2) })}</div>
              </div>
            </div>
          </div>
        )}

        {apiCacheStatus && (
          <div
            role={apiCacheStatus.type === "success" ? "status" : "alert"}
            aria-live={apiCacheStatus.type === "success" ? "polite" : "assertive"}
            className={`flex items-center gap-3 p-2 rounded-lg border text-xs ${apiCacheStatus.type === "success" ? "bg-green-500/10 border-green-500/30 text-green-400" : "bg-red-500/10 border-red-500/30 text-red-400"}`}
          >
            {apiCacheStatus.type === "success" ? <CheckCircle className="w-5 h-5 shrink-0 mt-0.5" /> : <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />}
            <p className="font-medium flex-1">{apiCacheStatus.message}</p>
          </div>
        )}

        <div className="w-full">
          <button onClick={handleClearLocalApiCache} disabled={isClearingApi} className="w-full flex items-center gap-3 p-4 bg-surface-raised/20 hover:bg-surface-raised/40 border border-white/6 hover:border-blue-500/30 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer">
            <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">{isClearingApi ? <RefreshCw className="w-5 h-5 text-blue-400 animate-spin" /> : <Database className="w-5 h-5 text-blue-400" />}</div>
            <div className="text-left flex-1">
              <div className="font-medium text-text-primary text-xs">{t("settings.cache.textEffects.clearLocal")}</div>
              <div className="text-[10px] text-text-muted">{t("settings.cache.textEffects.clearLocalDescription")}</div>
            </div>
          </button>
        </div>

        <div className="flex items-start gap-3 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <AlertCircle className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
          <p className="text-[11px] text-blue-200/90">{t("settings.cache.textEffects.localInfo")}</p>
        </div>
      </div>

      {/* Audio Library Cache Management */}
      <div className="space-y-3 pt-4 border-t border-white/6">
        <div>
          <h3 className="text-[13px] font-semibold uppercase tracking-wider text-text-muted mb-2">{t("settings.cache.audio.title")}</h3>
          <p className="text-[11px] text-text-muted">{t("settings.cache.audio.description")}</p>
        </div>

        {/* Audio Cache Stats */}
        <div className="bg-surface-raised/30 border border-white/6 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs">
            <Music2 className="w-4 h-4 text-accent" />
            <span className="font-semibold text-text-primary">{t("settings.cache.audio.cached")}</span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-[11px]">
            <div className="bg-surface-raised/50 rounded p-2 border border-white/5">
              <div className="text-text-muted">{t("settings.cache.audio.files")}</div>
              <div className="text-text-primary font-semibold mt-1">{t("settings.cache.fileCount", { count: audioCacheStats.count })}</div>
            </div>

            <div className="bg-surface-raised/50 rounded p-2 border border-white/5">
              <div className="text-text-muted">{t("settings.cache.audio.totalSize")}</div>
              <div className="text-text-primary font-semibold mt-1">{t("settings.cache.sizeMB", { size: (audioCacheStats.totalSize / (1024 * 1024)).toFixed(2) })}</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button onClick={refreshAudioStats} disabled={isClearingAudio} className="flex items-center gap-3 p-4 bg-surface-raised/20 hover:bg-surface-raised/40 border border-white/6 hover:border-accent/30 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer">
            <div className="w-10 h-10 rounded-lg bg-accent/20 flex items-center justify-center">
              <RefreshCw className="w-5 h-5 text-accent" />
            </div>
            <div className="text-left flex-1">
              <div className="font-medium text-text-primary text-xs">{t("settings.cache.audio.refreshStats")}</div>
              <div className="text-[10px] text-text-muted">{t("settings.cache.audio.refreshDescription")}</div>
            </div>
          </button>

          <button onClick={handleClearAudioCache} disabled={isClearingAudio} className="flex items-center gap-3 p-4 bg-surface-raised/20 hover:bg-surface-raised/40 border border-white/6 hover:border-red-500/30 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer">
            <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center">{isClearingAudio ? <RefreshCw className="w-5 h-5 text-red-400 animate-spin" /> : <Trash2 className="w-5 h-5 text-red-400" />}</div>
            <div className="text-left flex-1">
              <div className="font-medium text-text-primary text-xs">{t("settings.cache.audio.clear")}</div>
              <div className="text-[10px] text-text-muted">{t("settings.cache.audio.clearDescription")}</div>
            </div>
          </button>
        </div>

        <div className="flex items-start gap-3 p-3 bg-orange-500/10 border border-orange-500/30 rounded-lg">
          <AlertCircle className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" />
          <p className="text-[11px] text-orange-200/90">{t("settings.cache.audio.warning")}</p>
        </div>
      </div>

      {/* Warning Note */}
      <div className="flex items-start gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
        <AlertCircle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
        <div className="text-[11px] text-yellow-200/90">
          <p className="font-semibold mb-1">{t("settings.cache.notes.title")}</p>
          <ul className="space-y-1 list-disc list-inside">
            <li>{t("settings.cache.notes.restart")}</li>
            <li>{t("settings.cache.notes.webViewLocked")}</li>
            <li>{t("settings.cache.notes.preferencesPreserved")}</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

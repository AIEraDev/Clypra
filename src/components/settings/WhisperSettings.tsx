import React, { useState, useEffect, useMemo, useRef } from "react";
import { Search, Check, Download, Trash2, AlertCircle, Sparkles, RefreshCw } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { t, type MessageKey } from "@/i18n";
import { useCaptionStore, WhisperModelSize } from "@/store/captionStore";

// Whisper language options used by Clypra.
// Source: https://github.com/openai/whisper/blob/main/whisper/tokenizer.py
const WHISPER_LANGUAGE_BASE = [
  { code: "auto", name: "Auto-detect" },
  { code: "en", name: "English" },
  { code: "zh", name: "Chinese" },
  { code: "de", name: "German" },
  { code: "es", name: "Spanish" },
  { code: "ru", name: "Russian" },
  { code: "ko", name: "Korean" },
  { code: "fr", name: "French" },
  { code: "ja", name: "Japanese" },
  { code: "pt", name: "Portuguese" },
  { code: "tr", name: "Turkish" },
  { code: "pl", name: "Polish" },
  { code: "ca", name: "Catalan" },
  { code: "nl", name: "Dutch" },
  { code: "ar", name: "Arabic" },
  { code: "sv", name: "Swedish" },
  { code: "it", name: "Italian" },
  { code: "id", name: "Indonesian" },
  { code: "hi", name: "Hindi" },
  { code: "fi", name: "Finnish" },
  { code: "vi", name: "Vietnamese" },
  { code: "he", name: "Hebrew" },
  { code: "uk", name: "Ukrainian" },
  { code: "el", name: "Greek" },
  { code: "ms", name: "Malay" },
  { code: "cs", name: "Czech" },
  { code: "ro", name: "Romanian" },
  { code: "da", name: "Danish" },
  { code: "hu", name: "Hungarian" },
  { code: "ta", name: "Tamil" },
  { code: "no", name: "Norwegian" },
  { code: "th", name: "Thai" },
  { code: "ur", name: "Urdu" },
  { code: "hr", name: "Croatian" },
  { code: "bg", name: "Bulgarian" },
  { code: "lt", name: "Lithuanian" },
  { code: "la", name: "Latin" },
  { code: "mi", name: "Maori" },
  { code: "ml", name: "Malayalam" },
  { code: "cy", name: "Welsh" },
  { code: "sk", name: "Slovak" },
  { code: "te", name: "Telugu" },
  { code: "fa", name: "Persian" },
  { code: "lv", name: "Latvian" },
  { code: "bn", name: "Bengali" },
  { code: "sr", name: "Serbian" },
  { code: "az", name: "Azerbaijani" },
  { code: "sl", name: "Slovenian" },
  { code: "kn", name: "Kannada" },
  { code: "et", name: "Estonian" },
  { code: "mk", name: "Macedonian" },
  { code: "br", name: "Breton" },
  { code: "eu", name: "Basque" },
  { code: "is", name: "Icelandic" },
  { code: "hy", name: "Armenian" },
  { code: "ne", name: "Nepali" },
  { code: "mn", name: "Mongolian" },
  { code: "bs", name: "Bosnian" },
  { code: "kk", name: "Kazakh" },
  { code: "sq", name: "Albanian" },
  { code: "sw", name: "Swahili" },
  { code: "gl", name: "Galician" },
  { code: "mr", name: "Marathi" },
  { code: "pa", name: "Punjabi" },
  { code: "si", name: "Sinhala" },
  { code: "km", name: "Khmer" },
  { code: "sn", name: "Shona" },
  { code: "yo", name: "Yoruba" },
  { code: "so", name: "Somali" },
  { code: "af", name: "Afrikaans" },
  { code: "oc", name: "Occitan" },
  { code: "ka", name: "Georgian" },
  { code: "be", name: "Belarusian" },
  { code: "tg", name: "Tajik" },
  { code: "sd", name: "Sindhi" },
  { code: "gu", name: "Gujarati" },
  { code: "am", name: "Amharic" },
  { code: "yi", name: "Yiddish" },
  { code: "lo", name: "Lao" },
  { code: "uz", name: "Uzbek" },
  { code: "fo", name: "Faroese" },
  { code: "ht", name: "Haitian Creole" },
  { code: "ps", name: "Pashto" },
  { code: "tk", name: "Turkmen" },
  { code: "nn", name: "Nynorsk" },
  { code: "mt", name: "Maltese" },
  { code: "sa", name: "Sanskrit" },
  { code: "lb", name: "Luxembourgish" },
  { code: "my", name: "Myanmar" },
  { code: "bo", name: "Tibetan" },
  { code: "tl", name: "Tagalog" },
  { code: "mg", name: "Malagasy" },
  { code: "as", name: "Assamese" },
  { code: "tt", name: "Tatar" },
  { code: "ha", name: "Hausa" },
  { code: "ba", name: "Bashkir" },
  { code: "jw", name: "Javanese" },
  { code: "su", name: "Sundanese" },
] as const;

export const WHISPER_LANGUAGES = WHISPER_LANGUAGE_BASE.map((language) => ({
  ...language,
  messageKey: `settings.whisper.language.${language.code}` as MessageKey,
}));

interface ModelInfo {
  size: WhisperModelSize;
  params: string;
  vram: string;
  speedMessageKey: MessageKey;
  qualityMessageKey: MessageKey;
  recommended?: boolean;
}

export const MODEL_INFO: ModelInfo[] = [
  {
    size: "tiny",
    params: "39M",
    vram: "~1 GB",
    speedMessageKey: "settings.whisper.model.speed.tiny",
    qualityMessageKey: "settings.whisper.model.quality.tiny",
  },
  {
    size: "base",
    params: "74M",
    vram: "~1 GB",
    speedMessageKey: "settings.whisper.model.speed.base",
    qualityMessageKey: "settings.whisper.model.quality.base",
  },
  {
    size: "small",
    params: "244M",
    vram: "~2 GB",
    speedMessageKey: "settings.whisper.model.speed.small",
    qualityMessageKey: "settings.whisper.model.quality.small",
    recommended: true,
  },
  {
    size: "medium",
    params: "769M",
    vram: "~5 GB",
    speedMessageKey: "settings.whisper.model.speed.medium",
    qualityMessageKey: "settings.whisper.model.quality.medium",
  },
  {
    size: "large-v3",
    params: "1550M",
    vram: "~10 GB",
    speedMessageKey: "settings.whisper.model.speed.largeV3",
    qualityMessageKey: "settings.whisper.model.quality.largeV3",
  },
];

const MODEL_FILES_MISSING_ERROR = "Model files not found on disk. Please re-download.";
const MODEL_VERIFY_FAILED_ERROR = "Failed to verify model files.";
const MODEL_VERIFY_FAILED_PREFIX = "Failed to verify model files: ";

export function formatWhisperBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const index = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, index)).toFixed(1)} ${sizes[index]}`;
}

export function localizeWhisperError(error?: string): string {
  if (!error) return t("settings.whisper.error.downloadFailed");
  if (error === MODEL_FILES_MISSING_ERROR) {
    return t("settings.whisper.error.filesMissing");
  }
  if (error === MODEL_VERIFY_FAILED_ERROR) {
    return t("settings.whisper.error.verifyFailed");
  }
  if (error.startsWith(MODEL_VERIFY_FAILED_PREFIX)) {
    return t("settings.whisper.error.verifyDetail", {
      error: error.slice(MODEL_VERIFY_FAILED_PREFIX.length),
    });
  }
  return t("settings.whisper.error.downloadDetail", { error });
}

function LanguageSelector() {
  const { captionSettings, setLanguage } = useCaptionStore();
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredLanguages = useMemo(() => {
    if (!searchQuery) return WHISPER_LANGUAGES;
    const query = searchQuery.trim().toLocaleLowerCase();
    return WHISPER_LANGUAGES.filter((language) => {
      const displayName = t(language.messageKey).toLocaleLowerCase();
      return (
        displayName.includes(query) ||
        language.name.toLocaleLowerCase().includes(query) ||
        language.code.toLocaleLowerCase().includes(query)
      );
    });
  }, [searchQuery]);

  const selectedLanguage = WHISPER_LANGUAGES.find((lang) => lang.code === captionSettings.language);
  const selectedLanguageName = selectedLanguage
    ? t(selectedLanguage.messageKey)
    : t("settings.whisper.language.select");
  const listboxId = "whisper-language-listbox";

  return (
    <div className="space-y-2">
      <label className="text-[13px] font-semibold uppercase tracking-wider text-(--clypra-muted,#666677)">{t("settings.whisper.language.label")}</label>

      <div className="relative">
        <button
          type="button"
          role="combobox"
          aria-controls={listboxId}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-label={t("settings.whisper.language.currentLabel", {
            language: selectedLanguageName,
          })}
          onClick={() => setIsOpen(!isOpen)}
          className="w-full flex items-center justify-between px-3 py-2 bg-(--clypra-surface,#1E1E26) border border-(--clypra-border,#2A2A38) rounded-lg text-sm text-text-primary hover:border-(--clypra-violet,#7C6FFF) transition-colors"
        >
          <span className="flex items-center gap-2">
            {selectedLanguage?.code === "auto" && <Sparkles className="w-4 h-4 text-(--clypra-violet,#7C6FFF)" />}
            {selectedLanguageName}
          </span>
          <Search className="w-4 h-4 text-(--clypra-muted,#666677)" />
        </button>

        {isOpen && (
          <>
            <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setIsOpen(false)} />
            <div className="absolute top-full left-0 right-0 mt-1 bg-(--clypra-surface,#1E1E26) border border-(--clypra-border,#2A2A38) rounded-lg shadow-lg z-50 overflow-hidden">
              <div className="p-2 border-b border-(--clypra-border,#2A2A38)">
                <input
                  type="search"
                  aria-label={t("settings.whisper.language.searchLabel")}
                  placeholder={t("settings.whisper.language.searchPlaceholder")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full px-3 py-1.5 bg-(--clypra-ink,#0E0E12) border border-(--clypra-border,#2A2A38) rounded text-sm text-text-primary placeholder:text-(--clypra-muted,#666677) focus:outline-none focus:border-(--clypra-violet,#7C6FFF)"
                  autoFocus
                />
              </div>
              <div
                id={listboxId}
                role="listbox"
                aria-label={t("settings.whisper.language.listLabel")}
                className="max-h-[240px] overflow-y-auto scrollbar-thin"
              >
                {filteredLanguages.length > 0 ? (
                  filteredLanguages.map((language) => {
                    const displayName = t(language.messageKey);
                    const isSelected = language.code === captionSettings.language;

                    return (
                      <button
                        key={language.code}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        data-language-code={language.code}
                        onClick={() => {
                          setLanguage(language.code);
                          setIsOpen(false);
                          setSearchQuery("");
                        }}
                        className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors ${isSelected ? "bg-(--clypra-violet,#7C6FFF)/15 text-(--clypra-violet,#7C6FFF)" : "text-text-primary hover:bg-(--clypra-surface,#1E1E26)"}`}
                      >
                        <span className="flex items-center gap-2">
                          {language.code === "auto" && <Sparkles className="w-3.5 h-3.5" />}
                          {displayName}
                        </span>
                        {isSelected && <Check className="w-4 h-4" />}
                      </button>
                    );
                  })
                ) : (
                  <p role="status" className="px-3 py-4 text-center text-xs text-(--clypra-muted,#666677)">
                    {t("settings.whisper.language.noMatches", { query: searchQuery })}
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      <p className="text-[11px] text-(--clypra-muted,#666677) leading-relaxed">{t("settings.whisper.language.autoHint")}</p>
    </div>
  );
}

function ModelCard({ model }: { model: ModelInfo }) {
  const { captionSettings, setActiveModel, updateModelDownloadState, resetModelState } = useCaptionStore();
  const modelState = captionSettings.models[model.size];
  const isActive = captionSettings.activeModel === model.size;
  const [isDownloading, setIsDownloading] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string>();
  const [isVerifying, setIsVerifying] = useState(false);
  const downloadAttemptRef = useRef(0);

  // Verify model exists on disk when component mounts (if marked as downloaded)
  useEffect(() => {
    const verifyModelOnMount = async () => {
      if (modelState.status === "downloaded") {
        try {
          const exists = await invoke<boolean>("verify_whisper_model_exists", { size: model.size });
          if (!exists) {
            console.warn(`[WhisperSettings] Model "${model.size}" marked as downloaded but files not found. Resetting state.`);
            resetModelState(model.size);
            if (isActive) {
              setActiveModel(null as any);
            }
          }
        } catch (error) {
          console.error(`[WhisperSettings] Failed to verify model "${model.size}":`, error);
        }
      }
    };

    verifyModelOnMount();
  }, []); // Run once on mount

  useEffect(() => {
    // Listen for download progress events
    const unlisten = listen<{
      size: string;
      downloadedBytes: number;
      totalBytes: number;
      speedBytesPerSec: number;
    }>("whisper_model_progress", (event) => {
      console.log(`[WhisperSettings] Received progress event for ${event.payload.size}:`, event.payload);
      if (event.payload.size === model.size) {
        updateModelDownloadState(model.size, {
          progressBytes: event.payload.downloadedBytes,
          totalBytes: event.payload.totalBytes,
          speedBytesPerSec: event.payload.speedBytesPerSec,
        });
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [model.size, updateModelDownloadState]);

  const handleDownload = async () => {
    const downloadAttempt = ++downloadAttemptRef.current;
    try {
      setIsDownloading(true);
      setCancelError(undefined);
      updateModelDownloadState(model.size, {
        status: "downloading",
        progressBytes: 0,
        totalBytes: 0,
        speedBytesPerSec: 0,
        errorMessage: undefined,
      });

      await invoke("download_whisper_model", { size: model.size });

      if (downloadAttempt !== downloadAttemptRef.current) return;
      updateModelDownloadState(model.size, {
        status: "downloaded",
      });
    } catch (error) {
      if (downloadAttempt !== downloadAttemptRef.current) return;
      updateModelDownloadState(model.size, {
        status: "error",
        errorMessage: String(error),
      });
    } finally {
      if (downloadAttempt === downloadAttemptRef.current) {
        setIsDownloading(false);
      }
    }
  };

  const handleDelete = async () => {
    try {
      await invoke("delete_whisper_model", { size: model.size });
      resetModelState(model.size);
      if (isActive) {
        setActiveModel(null as any);
      }
    } catch (error) {
      console.error("Failed to delete model:", error);
    }
  };

  const handleRetry = () => {
    handleDownload();
  };

  const handleCancel = async () => {
    if (isCancelling) return;

    downloadAttemptRef.current += 1;
    setIsCancelling(true);
    setCancelError(undefined);

    try {
      await invoke("cancel_whisper_download", { size: model.size });
      resetModelState(model.size);
      setIsDownloading(false);
    } catch (error) {
      setCancelError(String(error));
    } finally {
      setIsCancelling(false);
    }
  };

  const handleSetActive = async () => {
    if (modelState.status === "downloaded") {
      // Verify the model actually exists on disk before setting as active
      setIsVerifying(true);
      try {
        const exists = await invoke<boolean>("verify_whisper_model_exists", { size: model.size });
        if (!exists) {
          updateModelDownloadState(model.size, {
            status: "error",
            errorMessage: MODEL_FILES_MISSING_ERROR,
          });
          return;
        }
        setActiveModel(model.size);
      } catch (error) {
        console.error("Failed to verify model:", error);
        updateModelDownloadState(model.size, {
          status: "error",
          errorMessage: `${MODEL_VERIFY_FAILED_PREFIX}${String(error)}`,
        });
      } finally {
        setIsVerifying(false);
      }
    }
  };

  const progressPercent = modelState.totalBytes > 0 ? (modelState.progressBytes / modelState.totalBytes) * 100 : 0;
  const roundedProgressPercent = Math.round(progressPercent);
  const deleteModelLabel = t("settings.whisper.model.deleteTitle", {
    model: model.size,
  });

  return (
    <article
      aria-label={t("settings.whisper.model.cardLabel", { model: model.size })}
      className={`bg-(--clypra-surface,#1E1E26) border rounded-xl p-4 transition-all ${isActive ? "border-(--clypra-violet,#7C6FFF) shadow-lg shadow-(--clypra-violet,#7C6FFF)/20" : "border-(--clypra-border,#2A2A38) hover:border-(--clypra-border,#2A2A38)"}`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-sm font-medium text-text-primary">{model.size}</h4>
            {model.recommended && <span className="px-2 py-0.5 text-[10px] font-medium bg-(--clypra-violet,#7C6FFF)/15 text-(--clypra-violet,#7C6FFF) rounded-full">{t("settings.whisper.model.recommended")}</span>}
            {modelState.status === "downloaded" && !isActive && <span className="px-2 py-0.5 text-[10px] font-medium bg-blue-500/15 text-blue-300 rounded-full">{t("settings.whisper.model.installed")}</span>}
            {isActive && <span className="px-2 py-0.5 text-[10px] font-medium bg-green-500/15 text-green-400 rounded-full">{t("settings.whisper.model.activeBadge")}</span>}
          </div>
          <div className="flex items-center gap-3 text-[11px] font-mono text-(--clypra-muted,#666677)">
            <span>{t("settings.whisper.model.params", { params: model.params })}</span>
            <span>•</span>
            <span>{model.vram}</span>
          </div>
        </div>
        <div className="px-2 py-1 text-[10px] font-mono bg-(--clypra-violet,#7C6FFF)/10 text-(--clypra-violet,#7C6FFF) rounded">{t(model.speedMessageKey)}</div>
      </div>

      <p className="text-[13px] text-(--clypra-muted,#666677) mb-3">{t(model.qualityMessageKey)}</p>

      {/* Download state UI */}
      {modelState.status === "idle" && (
        <button onClick={handleDownload} disabled={isDownloading} className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-(--clypra-violet,#7C6FFF) text-(--clypra-violet,#7C6FFF) rounded-lg text-sm font-medium hover:bg-(--clypra-violet,#7C6FFF)/10 transition-colors disabled:opacity-50 cursor-pointer">
          <Download className="w-4 h-4" />
          {t("settings.whisper.download.button")}
        </button>
      )}

      {modelState.status === "downloading" && (
        <div className="space-y-2">
          <p className="text-[11px] text-(--clypra-muted,#666677)">{t("settings.whisper.download.downloading")}</p>
          <div
            role="progressbar"
            aria-label={t("settings.whisper.download.progressLabel", {
              model: model.size,
              percent: roundedProgressPercent,
            })}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={roundedProgressPercent}
            className="w-full bg-(--clypra-ink,#0E0E12) rounded-full h-2 overflow-hidden"
          >
            <div className="h-full bg-(--clypra-violet,#7C6FFF) transition-all duration-300" style={{ width: `${progressPercent}%` }} />
          </div>
          <div className="flex items-center justify-between text-[11px] font-mono text-(--clypra-muted,#666677)">
            <span>
              {modelState.speedBytesPerSec > 0
                ? t("settings.whisper.download.progressWithSpeed", {
                    downloaded: formatWhisperBytes(modelState.progressBytes),
                    total: formatWhisperBytes(modelState.totalBytes),
                    speed: formatWhisperBytes(modelState.speedBytesPerSec),
                  })
                : t("settings.whisper.download.progress", {
                    downloaded: formatWhisperBytes(modelState.progressBytes),
                    total: formatWhisperBytes(modelState.totalBytes),
                  })}
            </span>
            <button
              onClick={handleCancel}
              disabled={isCancelling}
              className="text-danger hover:underline disabled:opacity-50 disabled:no-underline"
            >
              {t(
                isCancelling
                  ? "settings.whisper.download.cancelling"
                  : "settings.whisper.download.cancel",
              )}
            </button>
          </div>
          {cancelError && (
            <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-red-400 flex-1">
                {t("settings.whisper.error.cancelDetail", { error: cancelError })}
              </p>
            </div>
          )}
        </div>
      )}

      {modelState.status === "downloaded" && !isActive && (
        <div className="flex items-center gap-2">
          <button onClick={handleSetActive} disabled={isVerifying} className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-(--clypra-violet,#7C6FFF) text-white rounded-lg text-sm font-medium hover:bg-(--clypra-deep-violet,#5B4EE8) transition-colors disabled:opacity-60">
            <Check className="w-4 h-4" />
            {isVerifying ? t("settings.whisper.model.verifying") : t("settings.whisper.model.use")}
          </button>
          <button onClick={handleDelete} className="px-3 py-2 border border-(--clypra-border,#2A2A38) text-(--clypra-muted,#666677) rounded-lg hover:border-red-500/50 hover:text-red-400 transition-colors" title={deleteModelLabel} aria-label={deleteModelLabel}>
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      )}

      {modelState.status === "downloaded" && isActive && (
        <div className="flex items-center gap-2 px-4 py-2 bg-green-500/10 border border-green-500/30 rounded-lg text-sm text-green-400">
          <Check className="w-4 h-4" />
          <span className="flex-1">{t("settings.whisper.model.activeStatus")}</span>
          <button onClick={handleDelete} className="text-(--clypra-muted,#666677) hover:text-red-400 transition-colors" title={deleteModelLabel} aria-label={deleteModelLabel}>
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      )}

      {modelState.status === "error" && (
        <div className="space-y-2">
          <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-red-400 flex-1">{localizeWhisperError(modelState.errorMessage)}</p>
          </div>
          <button onClick={handleRetry} className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-(--clypra-violet,#7C6FFF) text-(--clypra-violet,#7C6FFF) rounded-lg text-sm font-medium hover:bg-(--clypra-violet,#7C6FFF)/10 transition-colors">
            <RefreshCw className="w-4 h-4" />
            {t("settings.whisper.download.retry")}
          </button>
        </div>
      )}
    </article>
  );
}

function ActiveModelIndicator() {
  const { captionSettings } = useCaptionStore();
  const activeModel = captionSettings.activeModel;
  const hasDownloadedModel = Object.values(captionSettings.models).some((model) => model.status === "downloaded");

  if (!activeModel && !hasDownloadedModel) {
    return (
      <div className="flex items-start gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
        <AlertCircle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
        <p className="text-[13px] text-yellow-200/90">{t("settings.whisper.status.noneDownloaded")}</p>
      </div>
    );
  }

  if (!activeModel) {
    return (
      <div className="flex items-start gap-3 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
        <AlertCircle className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
        <p className="text-[13px] text-blue-200/90">{t("settings.whisper.status.noneActive")}</p>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 p-4 bg-(--clypra-surface,#1E1E26) border border-(--clypra-border,#2A2A38) rounded-lg">
      <Check className="w-5 h-5 text-green-400" />
      <div className="flex-1">
        <p className="text-[13px] text-text-primary">{t("settings.whisper.status.activeModel", { model: activeModel })}</p>
      </div>
    </div>
  );
}

export const WhisperSettings: React.FC = () => {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-(--clypra-muted,#666677) mb-2">{t("settings.whisper.title")}</h3>
        <p className="text-[11px] text-(--clypra-muted,#666677)">{t("settings.whisper.description")}</p>
      </div>

      {/* Language Selection */}
      <LanguageSelector />

      {/* Model Download Manager */}
      <div className="space-y-3">
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-(--clypra-muted,#666677)">{t("settings.whisper.models.title")}</h3>
        <div className="grid grid-cols-1 gap-3">
          {MODEL_INFO.map((model) => (
            <ModelCard key={model.size} model={model} />
          ))}
        </div>
      </div>

      {/* Active Model Indicator */}
      <ActiveModelIndicator />

      {/* Info Note */}
      <div className="flex items-start gap-3 p-4 bg-(--clypra-violet,#7C6FFF)/10 border border-(--clypra-violet,#7C6FFF)/30 rounded-lg">
        <Sparkles className="w-5 h-5 text-(--clypra-violet,#7C6FFF) shrink-0 mt-0.5" />
        <div className="text-[11px] text-text-primary/90">
          <p className="font-semibold mb-1">{t("settings.whisper.privacy.title")}</p>
          <p className="text-(--clypra-muted,#666677)">{t("settings.whisper.privacy.description")}</p>
        </div>
      </div>
    </div>
  );
};

import React, { useState, useEffect, useMemo } from "react";
import {
  Search,
  Check,
  Download,
  Trash2,
  X,
  AlertCircle,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  useCaptionStore,
  WhisperModelSize,
  ModelDownloadStatus,
} from "@/store/captionStore";

// Complete list of 99 Whisper-supported languages
// Source: https://github.com/openai/whisper/blob/main/whisper/tokenizer.py
const WHISPER_LANGUAGES: { code: string; name: string }[] = [
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
];

interface ModelInfo {
  size: WhisperModelSize;
  params: string;
  vram: string;
  speed: string;
  quality: string;
  recommended?: boolean;
}

const MODEL_INFO: ModelInfo[] = [
  {
    size: "tiny",
    params: "39M",
    vram: "~1 GB",
    speed: "32× faster than large",
    quality: "Fast, lower accuracy. Good for drafts.",
  },
  {
    size: "base",
    params: "74M",
    vram: "~1 GB",
    speed: "16× faster than large",
    quality: "Balanced for everyday use.",
  },
  {
    size: "small",
    params: "244M",
    vram: "~2 GB",
    speed: "6× faster than large",
    quality: "Good quality. Recommended for most users.",
    recommended: true,
  },
  {
    size: "medium",
    params: "769M",
    vram: "~5 GB",
    speed: "2× faster than large",
    quality: "High accuracy. Better for accents.",
  },
  {
    size: "large-v3",
    params: "1550M",
    vram: "~10 GB",
    speed: "1× (baseline)",
    quality:
      "Best quality. Ideal for Nigerian/African accents and multilingual content.",
  },
];

function LanguageSelector() {
  const { captionSettings, setLanguage } = useCaptionStore();
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredLanguages = useMemo(() => {
    if (!searchQuery) return WHISPER_LANGUAGES;
    const query = searchQuery.toLowerCase();
    return WHISPER_LANGUAGES.filter(
      (lang) =>
        lang.name.toLowerCase().includes(query) ||
        lang.code.toLowerCase().includes(query),
    );
  }, [searchQuery]);

  const selectedLanguage = WHISPER_LANGUAGES.find(
    (lang) => lang.code === captionSettings.language,
  );

  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-semibold uppercase tracking-wider text-text-muted block">
        Transcription Language
      </label>

      <div className="relative">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-surface-raised border border-white/8 text-[12px] text-text-primary hover:border-white/15 transition-colors"
        >
          <span className="flex items-center gap-2">
            {selectedLanguage?.code === "auto" && (
              <Sparkles className="w-3.5 h-3.5 text-accent" />
            )}
            {selectedLanguage?.name || "Select language"}
          </span>
          <Search className="w-3.5 h-3.5 text-text-muted" />
        </button>

        {isOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
            <div className="absolute top-full left-0 right-0 mt-1 bg-surface-raised border border-white/10 rounded-lg shadow-xl z-50 overflow-hidden">
              <div className="p-2 border-b border-white/6">
                <input
                  type="text"
                  placeholder="Search languages..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full px-3 py-1.5 bg-surface-raised/50 border border-white/6 rounded text-[12px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/40"
                  autoFocus
                />
              </div>
              <div className="max-h-56 overflow-y-auto scrollbar-thin">
                {filteredLanguages.map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => {
                      setLanguage(lang.code);
                      setIsOpen(false);
                      setSearchQuery("");
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 text-[12px] transition-colors ${lang.code === captionSettings.language ? "bg-accent/10 text-accent" : "text-text-primary hover:bg-surface-raised"}`}
                  >
                    <span className="flex items-center gap-2">
                      {lang.code === "auto" && <Sparkles className="w-3 h-3" />}
                      {lang.name}
                    </span>
                    {lang.code === captionSettings.language && <Check className="w-3.5 h-3.5" />}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <p className="text-[10px] text-text-muted leading-relaxed">
        Auto-detect works well for most content. Set a language explicitly to improve accuracy for accented or mixed-language speech.
      </p>
    </div>
  );
}

function ModelCard({ model }: { model: ModelInfo }) {
  const {
    captionSettings,
    setActiveModel,
    updateModelDownloadState,
    resetModelState,
  } = useCaptionStore();
  const modelState = captionSettings.models[model.size];
  const isActive = captionSettings.activeModel === model.size;
  const [isDownloading, setIsDownloading] = useState(false);

  // Verify model exists on disk when component mounts (if marked as downloaded)
  useEffect(() => {
    const verifyModelOnMount = async () => {
      if (modelState.status === "downloaded") {
        try {
          const exists = await invoke<boolean>("verify_whisper_model_exists", {
            size: model.size,
          });
          if (!exists) {
            console.warn(
              `[WhisperSettings] Model "${model.size}" marked as downloaded but files not found. Resetting state.`,
            );
            resetModelState(model.size);
            if (isActive) {
              setActiveModel(null as any);
            }
          }
        } catch (error) {
          console.error(
            `[WhisperSettings] Failed to verify model "${model.size}":`,
            error,
          );
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
      if (event.payload.size === model.size) {
        updateModelDownloadState(model.size, {
          progressBytes: event.payload.downloadedBytes,
          totalBytes: event.payload.totalBytes,
          speedBytesPerSec: event.payload.speedBytesPerSec,
        });
      }
    });

    return () => {
      unlisten
        .then((fn) => {
          void Promise.resolve(fn()).catch(() => {});
        })
        .catch(() => {});
    };
  }, [model.size, updateModelDownloadState]);

  const handleDownload = async () => {
    try {
      setIsDownloading(true);
      updateModelDownloadState(model.size, {
        status: "downloading",
        progressBytes: 0,
        totalBytes: 0,
        speedBytesPerSec: 0,
        errorMessage: undefined,
      });

      await invoke("download_whisper_model", { size: model.size });

      updateModelDownloadState(model.size, {
        status: "downloaded",
      });
    } catch (error) {
      updateModelDownloadState(model.size, {
        status: "error",
        errorMessage: String(error),
      });
    } finally {
      setIsDownloading(false);
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

  const handleCancel = () => {
    invoke("cancel_whisper_download", { size: model.size }).catch(
      console.error,
    );
    resetModelState(model.size);
    setIsDownloading(false);
  };

  const handleSetActive = async () => {
    if (modelState.status === "downloaded") {
      // Verify the model actually exists on disk before setting as active
      try {
        const exists = await invoke<boolean>("verify_whisper_model_exists", {
          size: model.size,
        });
        if (!exists) {
          updateModelDownloadState(model.size, {
            status: "error",
            errorMessage: "Model files not found on disk. Please re-download.",
          });
          return;
        }
        setActiveModel(model.size);
      } catch (error) {
        console.error("Failed to verify model:", error);
        updateModelDownloadState(model.size, {
          status: "error",
          errorMessage: "Failed to verify model files.",
        });
      }
    }
  };

  const progressPercent =
    modelState.totalBytes > 0
      ? (modelState.progressBytes / modelState.totalBytes) * 100
      : 0;

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  return (
    <div
      className={`rounded-xl p-4 border transition-all ${isActive ? "bg-accent/5 border-accent/30" : "bg-surface-raised/40 border-white/6 hover:border-white/10"}`}
    >
      {/* Model header */}
      <div className="flex items-start justify-between gap-3 mb-2.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-[13px] font-semibold text-text-primary capitalize">{model.size}</h4>
            {model.recommended && (
              <span className="px-1.5 py-0.5 text-[9px] font-semibold bg-accent/15 text-accent rounded-full uppercase tracking-wide">
                Recommended
              </span>
            )}
            {isActive && (
              <span className="px-1.5 py-0.5 text-[9px] font-semibold bg-green-500/15 text-green-400 rounded-full uppercase tracking-wide">
                Active
              </span>
            )}
          </div>
          <p className="text-[11px] text-text-muted mt-1 leading-relaxed">{model.quality}</p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] font-mono text-accent bg-accent/10 px-2 py-0.5 rounded">{model.speed}</div>
          <div className="text-[9px] text-text-muted mt-1 font-mono">{model.params} · {model.vram}</div>
        </div>
      </div>

      {/* Download state UI */}
      {modelState.status === "idle" && (
        <button
          onClick={handleDownload}
          disabled={isDownloading}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 border border-accent/40 text-accent rounded-lg text-[12px] font-medium hover:bg-accent/8 transition-colors disabled:opacity-50 cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" />
          Download
        </button>
      )}

      {modelState.status === "downloading" && (
        <div className="space-y-1.5">
          <div className="w-full bg-surface-raised rounded-full h-1.5 overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] font-mono text-text-muted">
            <span>
              {formatBytes(modelState.progressBytes)} / {formatBytes(modelState.totalBytes)}
              {modelState.speedBytesPerSec > 0 && ` · ${formatBytes(modelState.speedBytesPerSec)}/s`}
            </span>
            <button onClick={handleCancel} className="text-danger hover:underline">
              Cancel
            </button>
          </div>
        </div>
      )}

      {modelState.status === "downloaded" && !isActive && (
        <div className="flex items-center gap-2">
          <button
            onClick={handleSetActive}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-accent text-white rounded-lg text-[12px] font-medium hover:bg-accent/90 transition-colors"
          >
            <Check className="w-3.5 h-3.5" />
            Use this model
          </button>
          <button
            onClick={handleDelete}
            className="px-3 py-2 border border-white/8 text-text-muted rounded-lg hover:border-danger/40 hover:text-danger transition-colors"
            title="Delete model"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {modelState.status === "downloaded" && isActive && (
        <div className="flex items-center gap-2 px-3 py-2 bg-green-500/10 border border-green-500/20 rounded-lg text-[12px] text-green-400">
          <Check className="w-3.5 h-3.5" />
          <span className="flex-1">Model active</span>
          <button
            onClick={handleDelete}
            className="text-text-muted hover:text-danger transition-colors"
            title="Delete model"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {modelState.status === "error" && (
        <div className="space-y-2">
          <div className="flex items-start gap-2 p-2.5 bg-red-500/10 border border-red-500/20 rounded-lg">
            <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-red-400 flex-1">{modelState.errorMessage || "Download failed"}</p>
          </div>
          <button
            onClick={handleRetry}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 border border-accent/40 text-accent rounded-lg text-[12px] font-medium hover:bg-accent/8 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

function ActiveModelIndicator() {
  const { captionSettings } = useCaptionStore();
  const activeModel = captionSettings.activeModel;
  const hasDownloadedModel = Object.values(captionSettings.models).some(
    (model) => model.status === "downloaded",
  );

  if (!activeModel && !hasDownloadedModel) {
    return (
      <div className="flex items-start gap-2.5 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
        <AlertCircle className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
        <p className="text-[11px] text-yellow-300/90 leading-relaxed">
          No model downloaded yet — download one above to enable auto-captions.
        </p>
      </div>
    );
  }

  if (!activeModel) {
    return (
      <div className="flex items-start gap-2.5 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
        <AlertCircle className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
        <p className="text-[11px] text-blue-300/90 leading-relaxed">
          No active model selected. Click "Use this model" on a downloaded model to enable auto-captions.
        </p>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5 bg-green-500/8 border border-green-500/20 rounded-lg">
      <div className="w-6 h-6 rounded-full bg-green-500/15 flex items-center justify-center shrink-0">
        <Check className="w-3.5 h-3.5 text-green-400" />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-[11px] text-text-muted">Active model: </span>
        <span className="text-[11px] font-semibold text-text-primary capitalize">{activeModel}</span>
      </div>
    </div>
  );
}

export const WhisperSettings: React.FC = () => {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-[13px] font-semibold text-text-primary mb-1">Auto-Captions</h2>
        <p className="text-[11px] text-text-muted leading-relaxed">
          Configure Whisper speech recognition for automatic caption generation.
        </p>
      </div>

      {/* Language Selection */}
      <LanguageSelector />

      {/* Model Download Manager */}
      <section className="space-y-2.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Whisper Models</h3>
        <div className="space-y-2">
          {MODEL_INFO.map((model) => (
            <ModelCard key={model.size} model={model} />
          ))}
        </div>
      </section>

      {/* Active Model Indicator */}
      <ActiveModelIndicator />

      {/* Privacy note */}
      <div className="flex items-start gap-3 px-3.5 py-3 bg-surface-raised/40 border border-white/6 rounded-xl">
        <Sparkles className="w-4 h-4 text-accent shrink-0 mt-0.5" />
        <div>
          <p className="text-[11px] font-semibold text-text-primary mb-0.5">Local-First Privacy</p>
          <p className="text-[10px] text-text-muted leading-relaxed">
            All models run locally on your device. Your audio never leaves your computer, ensuring complete privacy and offline functionality.
          </p>
        </div>
      </div>
    </div>
  );
};

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type WhisperModelSize = "tiny" | "base" | "small" | "medium" | "large-v3";
export type ModelDownloadStatus = "idle" | "downloading" | "downloaded" | "error";
export const DEFAULT_WHISPER_MODEL: WhisperModelSize = "tiny";

export interface ModelDownloadState {
  status: ModelDownloadStatus;
  progressBytes: number;
  totalBytes: number;
  speedBytesPerSec: number;
  errorMessage?: string;
}

export interface CaptionSettings {
  language: string | "auto";
  activeModel: WhisperModelSize | null;
  models: Record<WhisperModelSize, ModelDownloadState>;
  languageHints: string[]; // List of language codes to watch for (e.g., ["en", "es", "fr"])
}

interface CaptionStore {
  captionSettings: CaptionSettings;
  setLanguage: (lang: string | "auto") => void;
  setActiveModel: (size: WhisperModelSize | null) => void;
  setLanguageHints: (hints: string[]) => void;
  updateModelDownloadState: (size: WhisperModelSize, state: Partial<ModelDownloadState>) => void;
  resetModelState: (size: WhisperModelSize) => void;
}

const DEFAULT_MODEL_STATE: ModelDownloadState = {
  status: "idle",
  progressBytes: 0,
  totalBytes: 0,
  speedBytesPerSec: 0,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWhisperModelSize(value: unknown): value is WhisperModelSize {
  return (
    value === "tiny" ||
    value === "base" ||
    value === "small" ||
    value === "medium" ||
    value === "large-v3"
  );
}

function isModelDownloadStatus(value: unknown): value is ModelDownloadStatus {
  return (
    value === "idle" ||
    value === "downloading" ||
    value === "downloaded" ||
    value === "error"
  );
}

function isDownloadMetric(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function sanitizeCurrentModel(model: ModelDownloadState): ModelDownloadState {
  return model.status === "downloading" ? { ...DEFAULT_MODEL_STATE } : model;
}

function mergePersistedModelState(
  persistedModel: unknown,
  currentModel: ModelDownloadState,
): ModelDownloadState {
  const fallbackModel = sanitizeCurrentModel(currentModel);
  if (persistedModel === undefined) {
    return fallbackModel;
  }
  if (!isRecord(persistedModel) || !isModelDownloadStatus(persistedModel.status)) {
    return fallbackModel;
  }
  if (persistedModel.status === "downloading") {
    return { ...DEFAULT_MODEL_STATE };
  }
  if (
    !isDownloadMetric(persistedModel.progressBytes) ||
    !isDownloadMetric(persistedModel.totalBytes) ||
    !isDownloadMetric(persistedModel.speedBytesPerSec) ||
    (persistedModel.errorMessage !== undefined &&
      typeof persistedModel.errorMessage !== "string")
  ) {
    return fallbackModel;
  }

  return {
    status: persistedModel.status,
    progressBytes: persistedModel.progressBytes,
    totalBytes: persistedModel.totalBytes,
    speedBytesPerSec: persistedModel.speedBytesPerSec,
    ...(persistedModel.errorMessage === undefined
      ? {}
      : { errorMessage: persistedModel.errorMessage }),
  };
}

function mergePersistedCaptionStore(
  persistedState: unknown,
  currentState: CaptionStore,
): CaptionStore {
  const currentSettings = currentState.captionSettings;
  const fallbackState: CaptionStore = {
    ...currentState,
    captionSettings: {
      ...currentSettings,
      models: {
        tiny: sanitizeCurrentModel(currentSettings.models.tiny),
        base: sanitizeCurrentModel(currentSettings.models.base),
        small: sanitizeCurrentModel(currentSettings.models.small),
        medium: sanitizeCurrentModel(currentSettings.models.medium),
        "large-v3": sanitizeCurrentModel(currentSettings.models["large-v3"]),
      },
    },
  };
  if (!isRecord(persistedState) || !isRecord(persistedState.captionSettings)) {
    return fallbackState;
  }

  const persistedSettings = persistedState.captionSettings;
  const persistedModels = isRecord(persistedSettings.models)
    ? persistedSettings.models
    : {};

  return {
    ...fallbackState,
    captionSettings: {
      language:
        typeof persistedSettings.language === "string"
          ? persistedSettings.language
          : currentSettings.language,
      activeModel:
        persistedSettings.activeModel === null ||
        isWhisperModelSize(persistedSettings.activeModel)
          ? persistedSettings.activeModel
          : currentSettings.activeModel,
      languageHints: Array.isArray(persistedSettings.languageHints)
        ? persistedSettings.languageHints.filter(
            (hint): hint is string => typeof hint === "string",
          )
        : currentSettings.languageHints,
      models: {
        tiny: mergePersistedModelState(
          persistedModels.tiny,
          currentSettings.models.tiny,
        ),
        base: mergePersistedModelState(
          persistedModels.base,
          currentSettings.models.base,
        ),
        small: mergePersistedModelState(
          persistedModels.small,
          currentSettings.models.small,
        ),
        medium: mergePersistedModelState(
          persistedModels.medium,
          currentSettings.models.medium,
        ),
        "large-v3": mergePersistedModelState(
          persistedModels["large-v3"],
          currentSettings.models["large-v3"],
        ),
      },
    },
  };
}

export const useCaptionStore = create<CaptionStore>()(
  persist(
    (set) => ({
      captionSettings: {
        language: "auto",
        activeModel: null,
        languageHints: [], // Default: no hints, auto-detect all languages
        models: {
          tiny: { ...DEFAULT_MODEL_STATE },
          base: { ...DEFAULT_MODEL_STATE },
          small: { ...DEFAULT_MODEL_STATE },
          medium: { ...DEFAULT_MODEL_STATE },
          "large-v3": { ...DEFAULT_MODEL_STATE },
        },
      },

      setLanguage: (lang) =>
        set((state) => ({
          captionSettings: {
            ...state.captionSettings,
            language: lang,
          },
        })),

      setActiveModel: (size) =>
        set((state) => ({
          captionSettings: {
            ...state.captionSettings,
            activeModel: size,
          },
        })),

      setLanguageHints: (hints) =>
        set((state) => ({
          captionSettings: {
            ...state.captionSettings,
            languageHints: hints,
          },
        })),

      updateModelDownloadState: (size, partialState) =>
        set((state) => ({
          captionSettings: {
            ...state.captionSettings,
            models: {
              ...state.captionSettings.models,
              [size]: {
                ...state.captionSettings.models[size],
                ...partialState,
              },
            },
          },
        })),

      resetModelState: (size) =>
        set((state) => ({
          captionSettings: {
            ...state.captionSettings,
            models: {
              ...state.captionSettings.models,
              [size]: { ...DEFAULT_MODEL_STATE },
            },
          },
        })),
    }),
    {
      name: "clypra-caption-settings",
      merge: mergePersistedCaptionStore,
      // Only persist language and model statuses, not download progress
      partialize: (state) => ({
        captionSettings: {
          language: state.captionSettings.language,
          activeModel: state.captionSettings.activeModel,
          languageHints: state.captionSettings.languageHints,
          models: Object.fromEntries(
            Object.entries(state.captionSettings.models).map(([key, value]) => [
              key,
              {
                status: value.status,
                progressBytes: value.status === "downloaded" ? value.totalBytes : 0,
                totalBytes: value.totalBytes,
                speedBytesPerSec: 0,
                errorMessage: value.errorMessage,
              },
            ]),
          ) as Record<WhisperModelSize, ModelDownloadState>,
        },
      }),
    },
  ),
);

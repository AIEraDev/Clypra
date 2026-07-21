import { create } from "zustand";
import { persist } from "zustand/middleware";

export type WhisperModelSize = "tiny" | "base" | "small" | "medium" | "large-v3";
export type ModelDownloadStatus = "idle" | "downloading" | "downloaded" | "error";

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
  setActiveModel: (size: WhisperModelSize) => void;
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

function mergePersistedCaptionStore(
  persistedState: unknown,
  currentState: CaptionStore,
): CaptionStore {
  if (!persistedState || typeof persistedState !== "object") {
    return currentState;
  }

  const persisted = persistedState as Partial<CaptionStore>;
  if (!persisted.captionSettings) {
    return { ...currentState, ...persisted };
  }

  const persistedSettings = persisted.captionSettings;
  const models = {
    ...currentState.captionSettings.models,
    ...persistedSettings.models,
  };

  return {
    ...currentState,
    ...persisted,
    captionSettings: {
      ...currentState.captionSettings,
      ...persistedSettings,
      models: Object.fromEntries(
        Object.entries(models).map(([size, model]) => [
          size,
          model.status === "downloading" ? { ...DEFAULT_MODEL_STATE } : model,
        ]),
      ) as Record<WhisperModelSize, ModelDownloadState>,
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

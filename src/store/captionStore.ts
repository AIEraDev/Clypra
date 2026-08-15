import { create } from "zustand";
import { persist } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import type { SubtitleSegment, KaraokeStyleConfig } from "@/types/captions";
import { DEFAULT_KARAOKE_STYLE } from "@/types/captions";

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
  languageHints: string[];
}

interface CaptionStore {
  captionSettings: CaptionSettings;
  // Generated subtitle data (not persisted — regenerated each session)
  segments: SubtitleSegment[];
  isGenerating: boolean;
  generationError: string | null;
  // Karaoke overlay
  karaokeOverlayEnabled: boolean;
  karaokeStyle: KaraokeStyleConfig;
  // Actions
  setLanguage: (lang: string | "auto") => void;
  setActiveModel: (size: WhisperModelSize) => void;
  setLanguageHints: (hints: string[]) => void;
  updateModelDownloadState: (size: WhisperModelSize, state: Partial<ModelDownloadState>) => void;
  resetModelState: (size: WhisperModelSize) => void;
  setKaraokeOverlayEnabled: (enabled: boolean) => void;
  setKaraokeStyle: (style: Partial<KaraokeStyleConfig>) => void;
  generateCaptions: (videoPath: string, modelSize: string, language?: string) => Promise<void>;
  clearSegments: () => void;
}

const DEFAULT_MODEL_STATE: ModelDownloadState = {
  status: "idle",
  progressBytes: 0,
  totalBytes: 0,
  speedBytesPerSec: 0,
};

export const useCaptionStore = create<CaptionStore>()(
  persist(
    (set) => ({
      captionSettings: {
        language: "auto",
        activeModel: null,
        languageHints: [],
        models: {
          tiny: { ...DEFAULT_MODEL_STATE },
          base: { ...DEFAULT_MODEL_STATE },
          small: { ...DEFAULT_MODEL_STATE },
          medium: { ...DEFAULT_MODEL_STATE },
          "large-v3": { ...DEFAULT_MODEL_STATE },
        },
      },
      segments: [],
      isGenerating: false,
      generationError: null,
      karaokeOverlayEnabled: false,
      karaokeStyle: { ...DEFAULT_KARAOKE_STYLE },

      setLanguage: (lang) =>
        set((state) => ({
          captionSettings: { ...state.captionSettings, language: lang },
        })),

      setActiveModel: (size) =>
        set((state) => ({
          captionSettings: { ...state.captionSettings, activeModel: size },
        })),

      setLanguageHints: (hints) =>
        set((state) => ({
          captionSettings: { ...state.captionSettings, languageHints: hints },
        })),

      updateModelDownloadState: (size, partialState) =>
        set((state) => ({
          captionSettings: {
            ...state.captionSettings,
            models: {
              ...state.captionSettings.models,
              [size]: { ...state.captionSettings.models[size], ...partialState },
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

      setKaraokeOverlayEnabled: (enabled) => set({ karaokeOverlayEnabled: enabled }),

      setKaraokeStyle: (partial) =>
        set((state) => ({
          karaokeStyle: { ...state.karaokeStyle, ...partial },
        })),

      generateCaptions: async (videoPath, modelSize, language) => {
        set({ isGenerating: true, generationError: null, segments: [] });
        try {
          const segments = await invoke<SubtitleSegment[]>("generate_auto_captions", {
            videoPath,
            modelSize: modelSize || null,
            language: language && language !== "auto" ? language : null,
          });
          set({ segments, isGenerating: false });
        } catch (err) {
          const errorMsg = typeof err === "string" ? err : String(err);
          console.error("[CaptionStore] generate_auto_captions failed:", errorMsg);
          set({ isGenerating: false, generationError: errorMsg });
          throw err;
        }
      },

      clearSegments: () => set({ segments: [], generationError: null }),
    }),
    {
      name: "clypra-caption-settings",
      // Persist caption settings and karaoke style, but NOT runtime segments
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
        karaokeOverlayEnabled: state.karaokeOverlayEnabled,
        karaokeStyle: state.karaokeStyle,
      }),
    },
  ),
);

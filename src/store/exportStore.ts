import { create } from "zustand";
import type { ExportProgress } from "@/types/export";

export type ExportPhase = "idle" | "configuring" | "exporting" | "complete" | "error";

export interface ExportState {
  isExporting: boolean;
  phase: ExportPhase;
  progress: ExportProgress | null;
  error: string | null;
  presetId: string;
  outputPath: string;
  cancelFn: (() => Promise<void>) | null;

  setPhase: (phase: ExportPhase) => void;
  setProgress: (progress: ExportProgress | null) => void;
  setError: (error: string | null) => void;
  setPresetId: (presetId: string) => void;
  setOutputPath: (path: string) => void;
  setCancelFn: (fn: (() => Promise<void>) | null) => void;
  startExporting: (outputPath: string) => void;
  cancelExport: () => Promise<void>;
  reset: () => void;
}

export const useExportStore = create<ExportState>((set, get) => ({
  isExporting: false,
  phase: "idle",
  progress: null,
  error: null,
  presetId: "1080p",
  outputPath: "",
  cancelFn: null,

  setPhase: (phase) => set({ phase, isExporting: phase === "exporting" }),
  setProgress: (progress) => set({ progress }),
  setError: (error) => set({ error, phase: error ? "error" : get().phase, isExporting: false }),
  setPresetId: (presetId) => set({ presetId }),
  setOutputPath: (outputPath) => set({ outputPath }),
  setCancelFn: (cancelFn) => set({ cancelFn }),

  startExporting: (outputPath) =>
    set({
      isExporting: true,
      phase: "exporting",
      progress: { currentFrame: 0, totalFrames: 1, progress: 0, etaSeconds: 0, fps: 0 },
      error: null,
      outputPath,
    }),

  cancelExport: async () => {
    const { cancelFn } = get();
    if (cancelFn) {
      try {
        await cancelFn();
      } catch (err) {
        console.error("[exportStore] Error during cancelExport:", err);
      }
    }
    set({
      isExporting: false,
      phase: "idle",
      progress: null,
      cancelFn: null,
    });
  },

  reset: () =>
    set({
      isExporting: false,
      phase: "idle",
      progress: null,
      error: null,
      cancelFn: null,
    }),
}));

import { create } from "zustand";
import type { ViralCutSuggestion } from "./types";

interface ViralCutsStore {
  status: "idle" | "analyzing" | "ready" | "error";
  suggestions: ViralCutSuggestion[];
  error: string | null;
  dismissedIds: string[];
  insertedIds: string[];
  setAnalyzing: () => void;
  setResults: (suggestions: ViralCutSuggestion[]) => void;
  setError: (error: string) => void;
  dismissSuggestion: (id: string) => void;
  markInserted: (id: string) => void;
  reset: () => void;
}

export const useViralCutsStore = create<ViralCutsStore>((set) => ({
  status: "idle",
  suggestions: [],
  error: null,
  dismissedIds: [],
  insertedIds: [],
  setAnalyzing: () => set({ status: "analyzing", error: null }),
  setResults: (suggestions) => set({ status: "ready", suggestions, error: null, dismissedIds: [] }),
  setError: (error) => set({ status: "error", error }),
  dismissSuggestion: (id) => set((state) => ({ dismissedIds: [...new Set([...state.dismissedIds, id])] })),
  markInserted: (id) => set((state) => ({ insertedIds: [...new Set([...state.insertedIds, id])] })),
  reset: () => set({ status: "idle", suggestions: [], error: null, dismissedIds: [], insertedIds: [] }),
}));

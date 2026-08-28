import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { MissingTextEffect } from "@/lib/export/exportPreflight";

const MAX_EXPORT_HISTORY_ENTRIES = 50;

function createExportHistoryId(exportedAt: number): string {
  const uuid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `export-${exportedAt}-${uuid}`;
}

export interface ExportHistoryEntry {
  id: string;
  projectId: string;
  projectName: string;
  outputPath: string;
  exportedAt: number;
  totalFrames: number;
  totalTimeMs: number;
  degradedTextEffects: MissingTextEffect[];
}

interface ExportHistoryState {
  entries: ExportHistoryEntry[];
  addEntry: (entry: Omit<ExportHistoryEntry, "id">) => void;
  clear: () => void;
}

export const useExportHistoryStore = create<ExportHistoryState>()(
  persist(
    (set) => ({
      entries: [],

      addEntry: (entry) =>
        set((state) => ({
          entries: [
            { ...entry, id: createExportHistoryId(entry.exportedAt) },
            ...state.entries,
          ].slice(0, MAX_EXPORT_HISTORY_ENTRIES),
        })),

      clear: () => set({ entries: [] }),
    }),
    { name: "clypra-export-history" },
  ),
);

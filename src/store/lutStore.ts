/**
 * lutStore.ts
 *
 * Per-session LUT library. Stores imported .cube LUTs by id so the LUT
 * Name dropdown in VideoAdjustTab can be populated from the library.
 *
 * Entries are kept in memory for the session; the lutId is persisted on the
 * clip via clip.adjustments.lut.id (or clip.colorGrade.lutId). The GPU cache
 * (LutCache in Rust) survives the session as long as the app is running.
 */

import { create } from "zustand";

export interface LutEntry {
  /** Stable id — used as the lutId in the GPU pipeline */
  id: string;
  /** Human-readable name derived from the file stem */
  name: string;
  /** Absolute filesystem path to the .cube file */
  path: string;
  /** LUT size (typically 17, 33, or 65) */
  size: number;
}

interface LutStore {
  entries: LutEntry[];
  addEntry: (entry: LutEntry) => void;
  removeEntry: (id: string) => void;
}

export const useLutStore = create<LutStore>((set) => ({
  entries: [],
  addEntry: (entry) =>
    set((s) => ({
      entries: s.entries.some((e) => e.id === entry.id)
        ? s.entries
        : [...s.entries, entry],
    })),
  removeEntry: (id) =>
    set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),
}));

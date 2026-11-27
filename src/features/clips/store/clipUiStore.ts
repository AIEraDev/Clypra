/**
 * Clip UI Store — ephemeral browsing state
 *
 * Intentionally NOT persisted. The sidebar unmounts inactive tabs
 * (Architecture Invariant confirmed), so this store survives remounts
 * but resets on full app restart — which is correct for a browsing UI.
 */

import { create } from "zustand";
import type { ClipCategory } from "../types";

/** Sentinel value meaning "show all categories" */
export const ALL_CLIP_CATEGORY = "all" as const;
export type ClipCategoryFilter = ClipCategory | typeof ALL_CLIP_CATEGORY;

interface ClipUiState {
  /** Currently selected category filter */
  activeCategory: ClipCategoryFilter;
  /** Search input value (client-side filter) */
  searchQuery: string;
  /** ID of the tile currently playing its hover preview */
  hoveredClipId: string | null;
  // Actions
  setActiveCategory: (category: ClipCategoryFilter) => void;
  setSearchQuery: (query: string) => void;
  setHoveredClipId: (id: string | null) => void;
}

/** Ephemeral clip browsing state; not persisted. */
export const useClipUiStore = create<ClipUiState>((set) => ({
  activeCategory: ALL_CLIP_CATEGORY,
  searchQuery: "",
  hoveredClipId: null,
  setActiveCategory: (activeCategory) => set({ activeCategory }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setHoveredClipId: (hoveredClipId) => set({ hoveredClipId }),
}));

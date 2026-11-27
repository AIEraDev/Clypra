import { create } from "zustand";

export type StickerSubTab = "stickers" | "shapes" | "yours" | "giphy";
export type StickerYoursFilter = "recent" | "favorites" | "imported";

interface StickerUiState {
  activeSubTab: StickerSubTab;
  searchQuery: string;
  activeCategory: string;
  yoursFilter: StickerYoursFilter;
  scrollTop: number;
  setActiveSubTab: (activeSubTab: StickerSubTab) => void;
  setSearchQuery: (searchQuery: string) => void;
  setActiveCategory: (activeCategory: string) => void;
  setYoursFilter: (yoursFilter: StickerYoursFilter) => void;
  setScrollTop: (scrollTop: number) => void;
}

/** Ephemeral browsing state; intentionally not persisted with projects or settings. */
export const useStickerUiStore = create<StickerUiState>((set) => ({
  activeSubTab: "stickers",
  searchQuery: "",
  activeCategory: "all",
  yoursFilter: "recent",
  scrollTop: 0,
  setActiveSubTab: (activeSubTab) => set({ activeSubTab }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setActiveCategory: (activeCategory) => set({ activeCategory }),
  setYoursFilter: (yoursFilter) => set({ yoursFilter }),
  setScrollTop: (scrollTop) => set({ scrollTop }),
}));

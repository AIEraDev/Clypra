import { create } from "zustand";

interface FavoritesState {
  favorites: string[];
  downloadedEffects: string[];
  downloadedTemplates: string[];
  downloadingIds: string[]; // array for easy Zustand state diffing

  // Actions
  toggleFavorite: (id: string) => void;
  startDownload: (id: string) => void;
  completeDownload: (id: string, type: "effect" | "template") => void;
  cancelDownload: (id: string) => void;
  clearDownloadedEffects: () => void;
  clearDownloadedTemplates: () => void;
  clearAllDownloaded: () => void;
}

// Safe localStorage parsers
const getSavedArray = (key: string): string[] => {
  if (typeof window === "undefined") return [];
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : [];
  } catch (e) {
    return [];
  }
};

const saveArray = (key: string, arr: string[]) => {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(arr));
  } catch (e) {
    // Silent fail
  }
};

export const useFavoritesStore = create<FavoritesState>((set, get) => {
  // Initialize from localStorage on creation
  const initialFavorites = getSavedArray("vireostudio_text_favorites");
  const initialDownloadedEffects = getSavedArray("vireostudio_downloaded_effects");
  const initialDownloadedTemplates = getSavedArray("vireostudio_downloaded_templates");

  return {
    favorites: initialFavorites,
    downloadedEffects: initialDownloadedEffects,
    downloadedTemplates: initialDownloadedTemplates,
    downloadingIds: [],

    toggleFavorite: (id) => {
      const current = get().favorites;
      const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
      set({ favorites: next });
      saveArray("vireostudio_text_favorites", next);
    },

    startDownload: (id) => {
      set((state) => ({
        downloadingIds: [...state.downloadingIds, id],
      }));
    },

    completeDownload: (id, type) => {
      set((state) => {
        const nextDownloading = state.downloadingIds.filter((x) => x !== id);

        if (type === "effect") {
          const nextDownloaded = state.downloadedEffects.includes(id) ? state.downloadedEffects : [...state.downloadedEffects, id];
          saveArray("vireostudio_downloaded_effects", nextDownloaded);
          return {
            downloadingIds: nextDownloading,
            downloadedEffects: nextDownloaded,
          };
        } else {
          const nextDownloaded = state.downloadedTemplates.includes(id) ? state.downloadedTemplates : [...state.downloadedTemplates, id];
          saveArray("vireostudio_downloaded_templates", nextDownloaded);
          return {
            downloadingIds: nextDownloading,
            downloadedTemplates: nextDownloaded,
          };
        }
      });
    },

    cancelDownload: (id) => {
      set((state) => ({
        downloadingIds: state.downloadingIds.filter((x) => x !== id),
      }));
    },

    clearDownloadedEffects: () => {
      set({ downloadedEffects: [] });
      saveArray("vireostudio_downloaded_effects", []);
    },

    clearDownloadedTemplates: () => {
      set({ downloadedTemplates: [] });
      saveArray("vireostudio_downloaded_templates", []);
    },

    clearAllDownloaded: () => {
      set({ downloadedEffects: [], downloadedTemplates: [] });
      saveArray("vireostudio_downloaded_effects", []);
      saveArray("vireostudio_downloaded_templates", []);
    },
  };
});

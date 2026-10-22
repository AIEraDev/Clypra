export type AudioLibraryCategory =
  | "music" // Background music and soundtracks
  | "sound-effects" // General sound effects (impacts, whooshes, etc.)
  | "transitions" // Transition sound effects (swooshes, risers, etc.)
  | "ambient" // Atmospheric and background ambience
  | "ui-interface"; // UI sounds (clicks, beeps, notifications)

export interface AudioLibraryItem {
  id: string;
  name: string;
  category: AudioLibraryCategory | string;
  description?: string;
  tags?: string[];
  author: string;
  duration: number;
  bpm?: number;
  loopable?: boolean;
  license: {
    type: "cc0" | "cc-by" | "royalty-free" | "public-domain";
    url?: string;
    attributionRequired: boolean;
  };
  source: {
    provider: string;
    url: string;
  };
  audioUrl: string;
  waveformUrl?: string;
  coverArtUrl?: string;
  isPremium?: boolean;
}

import { getApiHeaders, getApiBaseUrl } from "@/lib/api";

const BASE = getApiBaseUrl();

export const AUDIO_LIBRARY_CATEGORIES: AudioLibraryCategory[] = [
  "music",
  "sound-effects",
  "transitions",
  "ambient",
  "ui-interface",
];

export const AudioLibraryApi = {
  async getAudioByCategory(
    category: AudioLibraryCategory,
  ): Promise<AudioLibraryItem[]> {
    try {
      const res = await fetch(`${BASE}/audio/${category}`, {
        headers: getApiHeaders(),
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => res.statusText);
        console.error(
          `[AudioLibraryApi] Failed to load audio category ${category}:`,
          {
            status: res.status,
            statusText: res.statusText,
            error: errorText,
          },
        );
        throw new Error(`HTTP ${res.status}: ${errorText || res.statusText}`);
      }

      const data = await res.json();
      return data;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Network error: ${String(error)}`);
    }
  },

  async getAudioAsset(category: string, id: string): Promise<AudioLibraryItem> {
    try {
      const res = await fetch(`${BASE}/audio/${category}/${id}`, {
        headers: getApiHeaders(),
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => res.statusText);
        console.error(`[AudioLibraryApi] Failed to load audio asset ${id}:`, {
          status: res.status,
          statusText: res.statusText,
          error: errorText,
        });
        throw new Error(`HTTP ${res.status}: ${errorText || res.statusText}`);
      }

      return res.json();
    } catch (error) {
      console.error(
        `[AudioLibraryApi] Exception loading audio asset ${id}:`,
        error,
      );
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Network error: ${String(error)}`);
    }
  },
};

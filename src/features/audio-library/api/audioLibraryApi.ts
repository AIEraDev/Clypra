export type AudioLibraryCategory =
  | "music" // catch-all browsable music library — the primary tab
  | "cinematic" // YouTube creators, vlogs, montages — highest demand
  | "upbeat" // social content, reels, highlights — second highest demand
  | "lo-fi" // study/productivity content — massive creator niche
  | "hip-hop" // most requested genre globally on CapCut
  | "ambient" // background for talking-head/interview content
  | "sfx"; // sound effects — non-negotiable, every editor needs this

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

export class AudioLibraryNetworkError extends Error {
  constructor(error: unknown) {
    super(error instanceof Error ? error.message : String(error));
    this.name = "AudioLibraryNetworkError";
  }
}

export const isAudioLibraryNetworkError = (error: unknown): error is AudioLibraryNetworkError => error instanceof AudioLibraryNetworkError;

const fetchAudioLibrary = async (...args: Parameters<typeof fetch>): Promise<Response> => {
  try {
    return await fetch(...args);
  } catch (error) {
    throw new AudioLibraryNetworkError(error);
  }
};

export const AUDIO_LIBRARY_CATEGORIES: AudioLibraryCategory[] = ["music", "cinematic", "upbeat", "lo-fi", "hip-hop", "ambient", "sfx"];

export const AUDIO_LIBRARY_CATEGORY_LABEL_KEYS = {
  music: "features.audio.category.music",
  cinematic: "features.audio.category.cinematic",
  upbeat: "features.audio.category.upbeat",
  "lo-fi": "features.audio.category.loFi",
  "hip-hop": "features.audio.category.hipHop",
  ambient: "features.audio.category.ambient",
  sfx: "features.audio.category.sfx",
} as const satisfies Record<AudioLibraryCategory, string>;

export const AudioLibraryApi = {
  async getAudioByCategory(category: AudioLibraryCategory): Promise<AudioLibraryItem[]> {
    try {
      const res = await fetchAudioLibrary(`${BASE}/audio/${category}`, {
        headers: getApiHeaders(),
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => res.statusText);
        console.error(`[AudioLibraryApi] Failed to load audio category ${category}:`, {
          status: res.status,
          statusText: res.statusText,
          error: errorText,
        });
        throw new Error(`HTTP ${res.status}: ${errorText || res.statusText}`);
      }

      const data = await res.json();
      if (!Array.isArray(data)) {
        throw new Error("Invalid audio library response: expected an array");
      }
      console.log(`[AudioLibraryApi] Successfully loaded ${data.length} audio items for category: ${category}`);
      return data;
    } catch (error) {
      console.error(`[AudioLibraryApi] Exception loading audio category ${category}:`, error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(String(error));
    }
  },

  async getAudioAsset(category: string, id: string): Promise<AudioLibraryItem> {
    try {
      const res = await fetchAudioLibrary(`${BASE}/audio/${category}/${id}`, {
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
      console.error(`[AudioLibraryApi] Exception loading audio asset ${id}:`, error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(String(error));
    }
  },
};

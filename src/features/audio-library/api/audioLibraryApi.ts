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

export const AUDIO_LIBRARY_CATEGORIES: AudioLibraryCategory[] = ["music", "cinematic", "upbeat", "lo-fi", "hip-hop", "ambient", "sfx"];

export const AudioLibraryApi = {
  async getAudioIndex(): Promise<AudioLibraryItem[]> {
    const res = await fetch(`${BASE}/audio`, {
      cache: "reload",
      headers: getApiHeaders(),
    });
    if (!res.ok) throw new Error("Failed to load audio library");
    return res.json();
  },

  async getAudioByCategory(category: AudioLibraryCategory): Promise<AudioLibraryItem[]> {
    const res = await fetch(`${BASE}/audio/${category}`, {
      cache: "reload",
      headers: getApiHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to load audio category: ${category}`);
    return res.json();
  },

  async getAudioAsset(category: string, id: string): Promise<AudioLibraryItem> {
    const res = await fetch(`${BASE}/audio/${category}/${id}`, {
      cache: "reload",
      headers: getApiHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to load audio asset: ${id}`);
    return res.json();
  },
};

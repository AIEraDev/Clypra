export type StickerCategory = "emoji" | "text" | "gaming" | "sports" | "animals" | "love" | "mood" | "food" | "travel" | "birthday" | "frames" | "shapes" | "fashion" | "retro" | "illustration";

export interface StickerItem {
  id: string;
  name: string;
  category: StickerCategory | string;
  thumbnailUrl: string;
  imageUrl: string;
  animatedUrl?: string;
  lottieUrl?: string;
  format: "static" | "gif" | "lottie";
  isAnimated: boolean;
  isPremium?: boolean;
  tags?: string[];
}

import { getApiHeaders, getApiBaseUrl } from "@/lib/api";

const BASE = getApiBaseUrl();

export const STICKER_CATEGORIES: StickerCategory[] = ["emoji", "text", "gaming", "sports", "animals", "love", "mood", "food", "travel", "birthday", "frames", "shapes", "fashion", "retro", "illustration"];

export const StickersApi = {
  async getStickersIndex(): Promise<StickerItem[]> {
    const res = await fetch(`${BASE}/stickers`, {
      cache: "reload",
      headers: getApiHeaders(),
    });
    if (!res.ok) throw new Error("Failed to load stickers library");
    return res.json();
  },

  async getStickersByCategory(category: StickerCategory): Promise<StickerItem[]> {
    const res = await fetch(`${BASE}/stickers/${category}`, {
      cache: "reload",
      headers: getApiHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to load stickers category: ${category}`);
    return res.json();
  },

  async getSticker(category: string, id: string): Promise<StickerItem> {
    const res = await fetch(`${BASE}/stickers/${category}/${id}`, {
      cache: "reload",
      headers: getApiHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to load sticker: ${id}`);
    return res.json();
  },
};

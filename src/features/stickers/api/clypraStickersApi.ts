export type StickerCategory = "trending" | "football" | "classic" | "new" | "animal-meme" | "hits" | "free-fire" | "icons" | "emoji" | "fun" | "emphasis" | "cover-ups" | "wrong" | "love" | "letters" | "mood" | "sale" | "gaming" | "text-sticker" | "vlog" | "collage" | "y2k" | "countdown" | "music-festival" | "journal" | "campus" | "cartoon" | "animal" | "fashion" | "eco-friendly" | "basketball" | "birthday" | "barbie" | "vibes" | "shimmer" | "glitter" | "frame" | "travel" | "winter" | "fall" | "neon-text" | "details" | "techniques" | "lip-illustration" | "handwriting" | "retro-character" | "illustration" | "alphabet" | "pixelated-style" | "bubble" | "weather" | "label" | "plog" | "cyber" | "stylish" | "food" | "shapes";

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

const BASE = "https://clypra-worker-api.abdulkabirmusa.com";
const API_KEY = import.meta.env.VITE_CLYPRA_API_KEY || "";

const getHeaders = (): HeadersInit => {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    "X-Clypra-Client": "clypra-desktop-v1",
    "User-Agent": "Clypra-Desktop/1.0.0",
  };

  if (API_KEY) {
    headers["X-API-Key"] = API_KEY;
  }

  return headers;
};

export const STICKER_CATEGORIES: StickerCategory[] = ["trending", "football", "classic", "new", "animal-meme", "hits", "free-fire", "icons", "emoji", "fun", "emphasis", "cover-ups", "wrong", "love", "letters", "mood", "sale", "gaming", "text-sticker", "vlog", "collage", "y2k", "countdown", "music-festival", "journal", "campus", "cartoon", "animal", "fashion", "eco-friendly", "basketball", "birthday", "barbie", "vibes", "shimmer", "glitter", "frame", "travel", "winter", "fall", "neon-text", "details", "techniques", "lip-illustration", "handwriting", "retro-character", "illustration", "alphabet", "pixelated-style", "bubble", "weather", "label", "plog", "cyber", "stylish", "food", "shapes"];

export const ClypraStickersApi = {
  async getStickersIndex(): Promise<StickerItem[]> {
    const res = await fetch(`${BASE}/stickers`, {
      cache: "reload",
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error("Failed to load stickers library");
    return res.json();
  },

  async getStickersByCategory(category: StickerCategory): Promise<StickerItem[]> {
    const res = await fetch(`${BASE}/stickers/${category}`, {
      cache: "reload",
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to load stickers category: ${category}`);
    return res.json();
  },

  async getSticker(category: string, id: string): Promise<StickerItem> {
    const res = await fetch(`${BASE}/stickers/${category}/${id}`, {
      cache: "reload",
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to load sticker: ${id}`);
    return res.json();
  },
};

import type { AspectRatio } from "@/types";

export interface TemplateTrack {
  type: "video" | "audio" | "text";
  name: string;
}

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  aspectRatio: AspectRatio;
  resolution: string;
  width: number;
  height: number;
  frameRate: 24 | 30 | 60;
  category: "social" | "video" | "podcast" | "cinematic";
  badge: string;
  initialTracks: TemplateTrack[];
}

export const BUILTIN_PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: "reels-tiktok",
    name: "Reels & TikTok Shorts",
    description: "Vertical 9:16 layout optimized for mobile social feeds with auto-caption subtitles track.",
    aspectRatio: "9:16",
    resolution: "1080×1920",
    width: 1080,
    height: 1920,
    frameRate: 30,
    category: "social",
    badge: "9:16 Mobile",
    initialTracks: [
      { type: "text", name: "Auto Captions" },
      { type: "video", name: "Main Video" },
      { type: "audio", name: "Background Music" },
    ],
  },
  {
    id: "youtube-widescreen",
    name: "YouTube Widescreen",
    description: "Standard 16:9 1080p 60fps HD video layout with B-Roll overlay track.",
    aspectRatio: "16:9",
    resolution: "1920×1080",
    width: 1920,
    height: 1080,
    frameRate: 60,
    category: "video",
    badge: "16:9 60FPS",
    initialTracks: [
      { type: "video", name: "B-Roll Overlay" },
      { type: "video", name: "Main Video" },
      { type: "text", name: "Titles & Lower Thirds" },
      { type: "audio", name: "Background Audio" },
    ],
  },
  {
    id: "podcast-speech",
    name: "Podcast & Interview",
    description: "Dual-microphone audio layout with speaker tracks and waveform visualization.",
    aspectRatio: "16:9",
    resolution: "1920×1080",
    width: 1920,
    height: 1080,
    frameRate: 30,
    category: "podcast",
    badge: "Multi-Audio",
    initialTracks: [
      { type: "text", name: "Speaker Labels" },
      { type: "video", name: "Camera View" },
      { type: "audio", name: "Host Mic (Speaker A)" },
      { type: "audio", name: "Guest Mic (Speaker B)" },
    ],
  },
  {
    id: "cinematic-ultrawide",
    name: "Cinematic Ultra-Wide",
    description: "21:9 anamorphic widescreen aspect ratio at 24fps cinematic frame rate.",
    aspectRatio: "21:9", // Aspect ratio canvas scaling
    resolution: "2520×1080",
    width: 2520,
    height: 1080,
    frameRate: 24,
    category: "cinematic",
    badge: "21:9 24FPS",
    initialTracks: [
      { type: "video", name: "Main Feature" },
      { type: "audio", name: "Film Score" },
      { type: "audio", name: "Foley & SFX" },
    ],
  },
  {
    id: "square-instagram",
    name: "Instagram Square Post",
    description: "1:1 square canvas preset tailored for Instagram feed posts and carousels.",
    aspectRatio: "1:1",
    resolution: "1080×1080",
    width: 1080,
    height: 1080,
    frameRate: 30,
    category: "social",
    badge: "1:1 Square",
    initialTracks: [
      { type: "text", name: "Header Text" },
      { type: "video", name: "Main Media" },
      { type: "audio", name: "Audio Track" },
    ],
  },
];

export function getTemplateById(id: string): ProjectTemplate | undefined {
  return BUILTIN_PROJECT_TEMPLATES.find((t) => t.id === id);
}

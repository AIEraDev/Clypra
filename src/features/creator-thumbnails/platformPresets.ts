import type { ThumbnailPlatformPreset } from "@/types";

export const PLATFORM_PRESETS: ThumbnailPlatformPreset[] = [
  {
    kind: "youtube",
    label: "YouTube Video",
    width: 1280,
    height: 720,
    aspectRatioLabel: "16:9",
  },
  {
    kind: "shorts",
    label: "YouTube Shorts",
    width: 1080,
    height: 1920,
    aspectRatioLabel: "9:16",
  },
  {
    kind: "tiktok",
    label: "TikTok Cover",
    width: 1080,
    height: 1920,
    aspectRatioLabel: "9:16",
  },
  {
    kind: "instagram",
    label: "Instagram Post",
    width: 1080,
    height: 1080,
    aspectRatioLabel: "1:1",
  },
  {
    kind: "custom",
    label: "Custom Canvas",
    width: 1920,
    height: 1080,
    aspectRatioLabel: "Custom",
  },
];

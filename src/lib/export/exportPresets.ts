/**
 * Export Preset Definitions
 *
 * Single source of truth for all export presets.
 *
 * FIX (BUG-L4): Previously PRESET_CONFIGS lived in ExportDialog.tsx and a
 * separate manual copy lived in videoExport.ts's getExportPresets(). Divergence
 * between the two was silent — UI showed one thing, export ran another. This
 * module is now imported by both to guarantee they stay in sync.
 */

import type { ExportPreset, PresetConfig } from "@/components/ui/ExportPresetCard";

export type { ExportPreset };

export const PRESET_CONFIGS: Record<ExportPreset, PresetConfig> = {
  "720p-fast": {
    label: "720p Fast",
    shortLabel: "720p",
    resolution: "1280×720",
    codec: "H.264",
    codecLabel: "H.264",
    tier: "fast",
    tierLabel: "Fast",
    width: 1280,
    height: 720,
    codecValue: "h264",
    preset: "fast",
    crf: 23,
    pixelFormat: "yuv420p",
    estimatedBitrateMbps: 4,
  },
  "1080p-fast": {
    label: "1080p Fast",
    shortLabel: "1080p",
    resolution: "1920×1080",
    codec: "H.264",
    codecLabel: "H.264",
    tier: "fast",
    tierLabel: "Fast",
    width: 1920,
    height: 1080,
    codecValue: "h264",
    preset: "fast",
    crf: 23,
    pixelFormat: "yuv420p",
    estimatedBitrateMbps: 8,
  },
  "1080p-quality": {
    label: "1080p Quality",
    shortLabel: "1080p",
    resolution: "1920×1080",
    codec: "H.264",
    codecLabel: "H.264",
    tier: "quality",
    tierLabel: "Quality",
    width: 1920,
    height: 1080,
    codecValue: "h264",
    preset: "slow",
    crf: 18,
    pixelFormat: "yuv420p",
    estimatedBitrateMbps: 15,
  },
  "4k-quality": {
    label: "4K Quality",
    shortLabel: "4K",
    resolution: "3840×2160",
    codec: "H.265",
    codecLabel: "H.265 / HEVC",
    tier: "quality",
    tierLabel: "Quality",
    width: 3840,
    height: 2160,
    codecValue: "h265",
    preset: "medium",
    crf: 20,
    pixelFormat: "yuv420p",
    estimatedBitrateMbps: 30,
  },
  "prores-422hq": {
    label: "ProRes 422 HQ",
    shortLabel: "ProRes",
    resolution: "1920×1080",
    codec: "ProRes",
    codecLabel: "ProRes 422 HQ",
    tier: "pro",
    tierLabel: "Professional",
    width: 1920,
    height: 1080,
    codecValue: "prores",
    preset: "medium",
    crf: 0,
    pixelFormat: "yuv422p10le",
    estimatedBitrateMbps: 220,
  },
  "webm-vp9": {
    label: "WebM VP9",
    shortLabel: "WebM",
    resolution: "1920×1080",
    codec: "VP9",
    codecLabel: "WebM / VP9",
    tier: "quality",
    tierLabel: "Web Video",
    width: 1920,
    height: 1080,
    codecValue: "vp9",
    preset: "medium",
    crf: 30,
    pixelFormat: "yuv420p",
    estimatedBitrateMbps: 6,
  },
  "gif-animated": {
    label: "Animated GIF",
    shortLabel: "GIF",
    resolution: "480×270",
    codec: "GIF",
    codecLabel: "Animated GIF (Palette)",
    tier: "fast",
    tierLabel: "Animation",
    width: 480,
    height: 270,
    codecValue: "gif",
    preset: "fast",
    crf: 0,
    pixelFormat: "rgb24",
    estimatedBitrateMbps: 2,
  },
};

export const PRESET_ORDER: ExportPreset[] = [
  "720p-fast",
  "1080p-fast",
  "1080p-quality",
  "webm-vp9",
  "gif-animated",
  "4k-quality",
  "prores-422hq",
];

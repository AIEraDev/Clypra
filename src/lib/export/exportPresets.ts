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
    labelKey: "system.export.preset.720pFast",
    shortLabel: "720p",
    resolution: "1280×720",
    codec: "H.264",
    codecLabel: "H.264",
    tier: "fast",
    tierLabelKey: "system.export.tier.fast",
    width: 1280,
    height: 720,
    codecValue: "h264",
    preset: "fast",
    crf: 23,
    pixelFormat: "yuv420p",
    estimatedBitrateMbps: 4,
  },
  "1080p-fast": {
    labelKey: "system.export.preset.1080pFast",
    shortLabel: "1080p",
    resolution: "1920×1080",
    codec: "H.264",
    codecLabel: "H.264",
    tier: "fast",
    tierLabelKey: "system.export.tier.fast",
    width: 1920,
    height: 1080,
    codecValue: "h264",
    preset: "fast",
    crf: 23,
    pixelFormat: "yuv420p",
    estimatedBitrateMbps: 8,
  },
  "1080p-quality": {
    labelKey: "system.export.preset.1080pQuality",
    shortLabel: "1080p",
    resolution: "1920×1080",
    codec: "H.264",
    codecLabel: "H.264",
    tier: "quality",
    tierLabelKey: "system.export.tier.quality",
    width: 1920,
    height: 1080,
    codecValue: "h264",
    preset: "slow",
    crf: 18,
    pixelFormat: "yuv420p",
    estimatedBitrateMbps: 15,
  },
  "4k-quality": {
    labelKey: "system.export.preset.4kQuality",
    shortLabel: "4K",
    resolution: "3840×2160",
    codec: "H.265",
    codecLabel: "H.265 / HEVC",
    tier: "quality",
    tierLabelKey: "system.export.tier.quality",
    width: 3840,
    height: 2160,
    codecValue: "h265",
    preset: "medium",
    crf: 20,
    pixelFormat: "yuv420p",
    estimatedBitrateMbps: 30,
  },
  "prores-422hq": {
    labelKey: "system.export.preset.prores422hq",
    shortLabel: "ProRes",
    resolution: "1920×1080",
    codec: "ProRes",
    codecLabel: "ProRes 422 HQ",
    tier: "pro",
    tierLabelKey: "system.export.tier.professional",
    width: 1920,
    height: 1080,
    codecValue: "prores",
    preset: "medium",
    crf: 0,
    pixelFormat: "yuv422p10le",
    estimatedBitrateMbps: 220,
  },
};

export const PRESET_ORDER: ExportPreset[] = [
  "720p-fast",
  "1080p-fast",
  "1080p-quality",
  "4k-quality",
  "prores-422hq",
];

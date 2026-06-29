/**
 * Scale V2 effect stack params by filter intensity (0–1).
 */

import type { MpgStackNode, TimelineEffectLike } from "./manifestAdapter";

const INTENSITY_SCALABLE_KEYS = [
  "brightness",
  "contrast",
  "saturation",
  "temperature",
  "tint",
  "sepia",
  "grayscale",
  "vignette",
  "blur",
  "blurAmount",
] as const;

function scaleNodeParams(type: string, params: Record<string, unknown>, intensity: number): Record<string, unknown> {
  const scaled = { ...params };

  for (const key of INTENSITY_SCALABLE_KEYS) {
    if (params[key] !== undefined) {
      scaled[key] = Number(params[key]) * intensity;
    }
  }

  if (params.hueRotate !== undefined) {
    scaled.hueRotate = Number(params.hueRotate) * intensity;
  }

  return scaled;
}

export function scaleEffectStackByIntensity(stack: MpgStackNode[], intensity: number): TimelineEffectLike[] {
  const clamped = Math.max(0, Math.min(1, intensity));
  return stack.map((node, i) => ({
    id: `filter-fx-${i}`,
    type: node.type,
    params: scaleNodeParams(node.type, node.params ?? {}, clamped),
  }));
}

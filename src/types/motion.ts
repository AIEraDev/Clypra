/**
 * Motion Behavior & Kinetic Preset Contracts.
 *
 * Defines one-click animation presets across In, Out,
 * and Loop (Continuous Emphasis) categories.
 */

import type { KeyframeEasing, KeyframeSpringConfig } from "./keyframes";

export type MotionBehaviorCategory = "in" | "out" | "loop";
export type MotionSubCategory = "Basic" | "Motion" | "3D" | "Glitch";

export interface ClipMotionConfig {
  inPreset?: string;
  inDuration?: number;
  inEasing?: KeyframeEasing;
  inSpring?: KeyframeSpringConfig;
  inDistance?: number;

  outPreset?: string;
  outDuration?: number;
  outEasing?: KeyframeEasing;
  outSpring?: KeyframeSpringConfig;
  outDistance?: number;

  loopPreset?: string;
  loopSpeed?: number;
  loopIntensity?: number;
}

export interface MotionPresetMeta {
  id: string;
  name: string;
  category: MotionBehaviorCategory;
  subCategory?: MotionSubCategory;
  tags?: string[];
  description: string;
  defaultDuration?: number;
  defaultEasing?: KeyframeEasing;
  icon: string;
}

/**
 * Text Animation System
 *
 * Provides entrance and exit animations for text clips using the keyframe infrastructure.
 */

import type { TextAnimation, TextAnimationType } from "@/types";
import type { MessageKey } from "@/i18n";

export interface AnimationPreset {
  nameKey: MessageKey;
  type: TextAnimationType;
  duration: number;
  easing: "linear" | "ease-in" | "ease-out" | "ease-in-out";
  icon?: string;
}

/**
 * Predefined entrance animation presets
 */
export const ENTRANCE_PRESETS: AnimationPreset[] = [
  { nameKey: "properties.textAnimation.preset.none", type: "none", duration: 0, easing: "linear" },
  { nameKey: "properties.textAnimation.preset.fadeIn", type: "fade", duration: 0.5, easing: "ease-in" },
  { nameKey: "properties.textAnimation.preset.slideUp", type: "slide-up", duration: 0.6, easing: "ease-out" },
  { nameKey: "properties.textAnimation.preset.slideDown", type: "slide-down", duration: 0.6, easing: "ease-out" },
  { nameKey: "properties.textAnimation.preset.slideLeft", type: "slide-left", duration: 0.6, easing: "ease-out" },
  { nameKey: "properties.textAnimation.preset.slideRight", type: "slide-right", duration: 0.6, easing: "ease-out" },
  { nameKey: "properties.textAnimation.preset.scale", type: "scale", duration: 0.5, easing: "ease-out" },
  { nameKey: "properties.textAnimation.preset.zoomIn", type: "zoom-in", duration: 0.6, easing: "ease-out" },
];

/**
 * Predefined exit animation presets
 */
export const EXIT_PRESETS: AnimationPreset[] = [
  { nameKey: "properties.textAnimation.preset.none", type: "none", duration: 0, easing: "linear" },
  { nameKey: "properties.textAnimation.preset.fadeOut", type: "fade", duration: 0.5, easing: "ease-out" },
  { nameKey: "properties.textAnimation.preset.slideUp", type: "slide-up", duration: 0.6, easing: "ease-in" },
  { nameKey: "properties.textAnimation.preset.slideDown", type: "slide-down", duration: 0.6, easing: "ease-in" },
  { nameKey: "properties.textAnimation.preset.slideLeft", type: "slide-left", duration: 0.6, easing: "ease-in" },
  { nameKey: "properties.textAnimation.preset.slideRight", type: "slide-right", duration: 0.6, easing: "ease-in" },
  { nameKey: "properties.textAnimation.preset.scale", type: "scale", duration: 0.5, easing: "ease-in" },
  { nameKey: "properties.textAnimation.preset.zoomOut", type: "zoom-out", duration: 0.6, easing: "ease-in" },
];

export interface AnimationState {
  opacity: number;
  translateX: number;
  translateY: number;
  scale: number;
}

/**
 * Calculate animation progress (0.0 to 1.0) for a given time within clip duration
 */
export function calculateAnimationProgress(currentTime: number, clipStartTime: number, clipDuration: number, animation: TextAnimation | undefined, isEntrance: boolean): number {
  if (!animation || animation.type === "none" || animation.duration === 0) {
    return 1.0; // No animation, fully visible
  }

  const relativeTime = currentTime - clipStartTime;

  if (isEntrance) {
    // Entrance: animate from 0 to animation.duration
    if (relativeTime < 0) return 0;
    if (relativeTime >= animation.duration) return 1.0;
    return relativeTime / animation.duration;
  } else {
    // Exit: animate from (clipDuration - animation.duration) to clipDuration
    const exitStartTime = clipDuration - animation.duration;
    if (relativeTime < exitStartTime) return 1.0; // Not started yet
    if (relativeTime >= clipDuration) return 0; // Fully exited
    return 1.0 - (relativeTime - exitStartTime) / animation.duration;
  }
}

/**
 * Apply easing function to progress
 */
export function applyEasing(progress: number, easing: TextAnimation["easing"]): number {
  switch (easing) {
    case "linear":
      return progress;
    case "ease-in":
      return progress * progress;
    case "ease-out":
      return progress * (2 - progress);
    case "ease-in-out":
      return progress < 0.5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress;
    default:
      return progress;
  }
}

/**
 * Calculate the animation state for a text clip at a specific time
 */
export function calculateTextAnimationState(currentTime: number, clipStartTime: number, clipDuration: number, entranceAnimation: TextAnimation | undefined, exitAnimation: TextAnimation | undefined): AnimationState {
  const state: AnimationState = {
    opacity: 1.0,
    translateX: 0,
    translateY: 0,
    scale: 1.0,
  };

  const relativeTime = currentTime - clipStartTime;

  // Before clip starts or after clip ends
  if (relativeTime < 0 || relativeTime > clipDuration) {
    state.opacity = 0;
    return state;
  }

  // Calculate entrance animation
  if (entranceAnimation && entranceAnimation.type !== "none") {
    const entranceProgress = calculateAnimationProgress(currentTime, clipStartTime, clipDuration, entranceAnimation, true);
    const easedProgress = applyEasing(entranceProgress, entranceAnimation.easing);

    if (easedProgress < 1.0) {
      applyAnimationType(state, entranceAnimation.type, 1.0 - easedProgress, true);
    }
  }

  // Calculate exit animation
  if (exitAnimation && exitAnimation.type !== "none") {
    const exitProgress = calculateAnimationProgress(currentTime, clipStartTime, clipDuration, exitAnimation, false);
    const easedProgress = applyEasing(exitProgress, exitAnimation.easing);

    if (easedProgress < 1.0) {
      applyAnimationType(state, exitAnimation.type, 1.0 - easedProgress, false);
    }
  }

  return state;
}

/**
 * Apply animation type transformations to the state
 * @param state - Current animation state (mutated)
 * @param type - Animation type
 * @param intensity - How much to apply (0 = no animation, 1 = full animation)
 * @param isEntrance - Whether this is entrance (true) or exit (false)
 */
function applyAnimationType(state: AnimationState, type: TextAnimationType, intensity: number, isEntrance: boolean): void {
  switch (type) {
    case "fade":
      state.opacity *= 1.0 - intensity;
      break;

    case "slide-up":
      state.translateY = isEntrance ? intensity * 50 : -intensity * 50;
      state.opacity *= 1.0 - intensity;
      break;

    case "slide-down":
      state.translateY = isEntrance ? -intensity * 50 : intensity * 50;
      state.opacity *= 1.0 - intensity;
      break;

    case "slide-left":
      state.translateX = isEntrance ? intensity * 100 : -intensity * 100;
      state.opacity *= 1.0 - intensity;
      break;

    case "slide-right":
      state.translateX = isEntrance ? -intensity * 100 : intensity * 100;
      state.opacity *= 1.0 - intensity;
      break;

    case "scale":
      const scaleValue = 1.0 - intensity * 0.5; // Scale from 0.5 to 1.0
      state.scale *= scaleValue;
      state.opacity *= 1.0 - intensity * 0.8;
      break;

    case "zoom-in":
      const zoomInScale = 1.0 + intensity * 0.5; // Scale from 1.0 to 1.5
      state.scale *= zoomInScale;
      state.opacity *= 1.0 - intensity;
      break;

    case "zoom-out":
      const zoomOutScale = 1.0 - intensity * 0.3; // Scale from 1.0 to 0.7
      state.scale *= zoomOutScale;
      state.opacity *= 1.0 - intensity;
      break;

    case "none":
    default:
      // No animation
      break;
  }
}

/**
 * Get CSS transform string from animation state
 */
export function getAnimationTransform(state: AnimationState): string {
  const transforms: string[] = [];

  if (state.translateX !== 0 || state.translateY !== 0) {
    transforms.push(`translate(${state.translateX}px, ${state.translateY}px)`);
  }

  if (state.scale !== 1.0) {
    transforms.push(`scale(${state.scale})`);
  }

  return transforms.length > 0 ? transforms.join(" ") : "none";
}

/**
 * Create default animation
 */
export function createDefaultAnimation(type: TextAnimationType = "none"): TextAnimation {
  const preset = [...ENTRANCE_PRESETS, ...EXIT_PRESETS].find((p) => p.type === type);
  return {
    type,
    duration: preset?.duration || 0.5,
    easing: preset?.easing || "ease-out",
  };
}

/**
 * API-backed text-animation compiler.
 *
 * Preset definitions are intentionally not stored in the editor. The editor
 * consumes the Animation API catalog, caches it locally in the catalog store,
 * and persists the resulting keyframes on the clip for deterministic playback.
 */

import type { VisualPropertyKey, VisualPropertyKeyframe } from "@/types";
import type { ClipMotionConfig } from "@/types/motion";
import {
  getTextAnimationPreset,
  toKeyframeEasing,
  type RemoteTextAnimationPreset,
} from "@/features/text-animations/animationCatalog";

type AnimatableClip = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  opacity?: number;
  visualKeyframes?: Partial<Record<VisualPropertyKey, VisualPropertyKeyframe[]>>;
};

interface BaseValues {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
}

function getBaseValues(clip: AnimatableClip): BaseValues {
  return {
    x: clip.x ?? 0,
    y: clip.y ?? 0,
    width: Math.abs(clip.width ?? 100),
    height: Math.abs(clip.height ?? 100),
    rotation: clip.rotation ?? 0,
    opacity: clip.opacity ?? 1,
  };
}

function propertyFor(trackProperty: string): VisualPropertyKey | null {
  switch (trackProperty) {
    case "opacity": return "opacity";
    case "translateX": return "x";
    case "translateY": return "y";
    case "rotation": return "rotation";
    case "scale":
    case "scaleX": return "width";
    case "scaleY": return "height";
    // The editor's generic visual-keyframe contract does not yet expose these.
    // They stay in the remote definition for renderers that support them.
    default: return null;
  }
}

function valueFor(trackProperty: string, rawValue: number, base: BaseValues): number {
  switch (trackProperty) {
    case "opacity": return base.opacity * rawValue;
    case "translateX": return base.x + rawValue;
    case "translateY": return base.y + rawValue;
    case "rotation": return base.rotation + rawValue;
    case "scale": return base.width * rawValue;
    case "scaleX": return base.width * rawValue;
    case "scaleY": return base.height * rawValue;
    default: return rawValue;
  }
}

function addTrackKeyframes(
  result: Partial<Record<VisualPropertyKey, VisualPropertyKeyframe[]>>,
  preset: RemoteTextAnimationPreset,
  phase: "in" | "out" | "loop",
  duration: number,
  base: BaseValues,
  easingOverride: ClipMotionConfig["inEasing"] | ClipMotionConfig["outEasing"],
) {
  for (const track of preset.tracks) {
    const property = propertyFor(track.property);
    if (!property) continue;
    const keyframes = [...track.keyframes]
      .filter((keyframe) => Number.isFinite(keyframe.progress) && Number.isFinite(keyframe.value))
      .sort((a, b) => a.progress - b.progress)
      .map((keyframe, index) => ({
        id: `api-${phase}-${preset.id}-${track.property}-${index}`,
        // End-anchored keyframes count backwards from the clip end.
        time: phase === "out" ? duration * (1 - keyframe.progress) : duration * keyframe.progress,
        anchor: phase === "out" ? "end" as const : "start" as const,
        value: valueFor(track.property, keyframe.value, base),
        easing: easingOverride ?? toKeyframeEasing(keyframe.easing),
      }));
    if (keyframes.length) result[property] = [...(result[property] ?? []), ...keyframes];
  }
}

/**
 * Compiles API preset tracks into the editor's persistent visual-keyframe
 * format. The optional catalog argument makes a caller's just-fetched catalog
 * available immediately; the cache is used by default for all other calls.
 */
export function compileClipMotionKeyframes(
  clip: AnimatableClip,
  motion: ClipMotionConfig | undefined,
  _canvasWidth = 1920,
  _canvasHeight = 1080,
  catalog?: readonly RemoteTextAnimationPreset[],
): Partial<Record<VisualPropertyKey, VisualPropertyKeyframe[]>> {
  if (!motion) return clip.visualKeyframes ? { ...clip.visualKeyframes } : {};

  const findPreset = (id: string | undefined) => catalog?.find((preset) => preset.id === id) ?? getTextAnimationPreset(id);
  const result: Partial<Record<VisualPropertyKey, VisualPropertyKeyframe[]>> = {};
  const base = getBaseValues(clip);

  const inPreset = findPreset(motion.inPreset);
  if (inPreset?.phase === "in") {
    addTrackKeyframes(result, inPreset, "in", Math.max(0.1, motion.inDuration ?? inPreset.defaultDuration ?? 0.6), base, motion.inEasing);
  }

  const outPreset = findPreset(motion.outPreset);
  if (outPreset?.phase === "out") {
    addTrackKeyframes(result, outPreset, "out", Math.max(0.1, motion.outDuration ?? outPreset.defaultDuration ?? 0.6), base, motion.outEasing);
  }

  return result;
}

function interpolateTrack(
  keyframes: RemoteTextAnimationPreset["tracks"][number]["keyframes"],
  progress: number,
): number | null {
  if (!keyframes.length) return null;
  const sorted = [...keyframes].sort((a, b) => a.progress - b.progress);
  if (progress <= sorted[0].progress) return sorted[0].value;
  if (progress >= sorted[sorted.length - 1].progress) return sorted[sorted.length - 1].value;
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const start = sorted[index];
    const end = sorted[index + 1];
    if (progress >= start.progress && progress <= end.progress) {
      const segmentProgress = (progress - start.progress) / (end.progress - start.progress);
      return start.value + (end.value - start.value) * segmentProgress;
    }
  }
  return null;
}

/** Evaluate loop tracks directly from the cached API definition on every frame. */
export function applyLoopMotion(
  presetId: string | undefined,
  time: number,
  transform: { x: number; y: number; width: number; height: number; rotation: number; opacity: number },
  speed = 1,
  intensity = 1,
): typeof transform {
  const preset = getTextAnimationPreset(presetId);
  if (!preset || preset.phase !== "loop") return transform;
  const period = Math.max(0.1, preset.defaultDuration ?? 1.2) / Math.max(0.1, speed);
  const progress = ((time % period) + period) % period / period;
  const result = { ...transform };
  for (const track of preset.tracks) {
    const value = interpolateTrack(track.keyframes, progress);
    if (value === null) continue;
    switch (track.property) {
      case "opacity": result.opacity = transform.opacity * value; break;
      case "translateX": result.x = transform.x + value * intensity; break;
      case "translateY": result.y = transform.y + value * intensity; break;
      case "rotation": result.rotation = transform.rotation + value * intensity; break;
      case "scale": result.width = transform.width * (1 + (value - 1) * intensity); result.height = transform.height * (1 + (value - 1) * intensity); break;
      case "scaleX": result.width = transform.width * (1 + (value - 1) * intensity); break;
      case "scaleY": result.height = transform.height * (1 + (value - 1) * intensity); break;
    }
  }
  return result;
}

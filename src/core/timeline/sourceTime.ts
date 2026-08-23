import type { Clip, TimelineSourceRange } from "@/types";

export interface SourceTimeResolution {
  localTime: number;
  sourceTime: number;
  active: boolean;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export function resolveClipSourceTime(
  clip: Pick<Clip, "startTime" | "duration" | "trimIn" | "trimOut"> & { speed?: number },
  timelineTime: number,
  options?: { clampToRange?: boolean; frameRate?: number }
): SourceTimeResolution {
  const localTime = timelineTime - clip.startTime;
  const active = localTime >= 0 && localTime < clip.duration;
  const speed = typeof clip.speed === "number" && clip.speed > 0 ? clip.speed : 1;
  const rawSourceTime = clip.trimIn + localTime * speed;

  if (options?.clampToRange) {
    // Enforce trimOut as required
    // If trimOut is undefined, this indicates a bug in clip creation/split/trim logic
    // Fail fast rather than silently falling back to incorrect behavior
    if (clip.trimOut === undefined) {
      console.error("[resolveClipSourceTime] CRITICAL: trimOut is undefined", {
        clipStartTime: clip.startTime,
        clipDuration: clip.duration,
        clipTrimIn: clip.trimIn,
        timelineTime,
      });
      // Use fallback for now but log aggressively
      // TODO: After verifying all clip operations set trimOut correctly, change to throw
      // throw new Error("trimOut must be defined when clampToRange is true");
    }

    const safeTrimOut = clip.trimOut ?? clip.trimIn + clip.duration;
    // Subtract one frame time to stay before the boundary
    const frameTime = options.frameRate ? 1 / options.frameRate : 0.001;
    const maxSourceTime = safeTrimOut - frameTime;
    const clamped = Math.min(rawSourceTime, maxSourceTime);
    const sourceTime = Math.max(clamped, clip.trimIn);
    return { localTime, sourceTime, active };
  }

  return { localTime, sourceTime: Math.max(0, rawSourceTime), active };
}

export function resolveTimelineItemSourceTime(source: TimelineSourceRange, placement: { startTime: number; duration: number }, timelineTime: number, options?: { clampToRange?: boolean }): SourceTimeResolution {
  const localTime = timelineTime - placement.startTime;
  const active = localTime >= 0 && localTime < placement.duration;
  const rate = source.playbackRate || 1;
  const rawOffset = localTime * rate;
  const rawSourceTime = source.reverse ? source.trimOut - rawOffset : source.trimIn + rawOffset;
  const min = Math.min(source.trimIn, source.trimOut);
  const max = Math.max(source.trimIn, source.trimOut);
  const sourceTime = options?.clampToRange ? clamp(rawSourceTime, min, max) : rawSourceTime;
  return { localTime, sourceTime: Math.max(0, sourceTime), active };
}

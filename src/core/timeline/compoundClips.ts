import type { Clip } from "@/types";

/** Returns whether a clip is a persisted nested compound. */
export function isCompoundClip(clip: Clip): boolean {
  return clip.kind === "compound" && Array.isArray(clip.compoundChildren);
}

/**
 * Expands nested compound parents into ordinary absolute-time clips.
 * The parent is intentionally omitted so every runtime consumer sees the
 * same render/audio/export inputs it had before grouping was introduced.
 */
export function expandCompoundClips(clips: Clip[]): Clip[] {
  const expand = (clip: Clip, absoluteStart: number): Clip[] => {
    if (!isCompoundClip(clip)) {
      return [{ ...clip, startTime: absoluteStart }];
    }

    return clip.compoundChildren!.flatMap((child) =>
      expand({ ...child, trackId: clip.trackId }, absoluteStart + child.startTime),
    );
  };

  return clips.flatMap((clip) => expand(clip, clip.startTime));
}

export function hasTransitionReference(clipId: string, transitions: Array<{ fromItemId: string; toItemId: string }>): boolean {
  return transitions.some((transition) => transition.fromItemId === clipId || transition.toItemId === clipId);
}

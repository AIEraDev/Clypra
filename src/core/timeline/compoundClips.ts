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
    if (clip.kind === "text-template") {
      // Canonical template clips remain first-class runtime entities. The
      // evaluator owns their timeline geometry and the engine package owns
      // their composition semantics; converting them to a legacy text clip
      // here discarded nodes, panels, controls and timing.
      return [{ ...clip, startTime: absoluteStart }];
    }
    if (!isCompoundClip(clip)) {
      return [{ ...clip, startTime: absoluteStart }];
    }

    // The compound parent is only a timeline handle. Children retain their
    // persisted track identity so visual stacking, audio routing, export, and
    // ungroup all see the same multi-track timeline they represented before
    // grouping. Legacy same-track compounds already have matching child and
    // parent track IDs, so this is backward compatible.
    return clip.compoundChildren!.flatMap((child) =>
      expand(child, absoluteStart + child.startTime),
    );
  };

  return clips.flatMap((clip) => expand(clip, clip.startTime));
}

export function hasTransitionReference(clipId: string, transitions: Array<{ fromItemId: string; toItemId: string }>): boolean {
  return transitions.some((transition) => transition.fromItemId === clipId || transition.toItemId === clipId);
}

/**
 * Canonical visual stacking contract.
 *
 * Timeline position is the user's ordering authority for ordinary visual
 * material. Semantic roles describe behavior, not a hidden alternate stack:
 * a text, primary, or overlay clip follows the same track/z ordering. Only
 * generated backgrounds and post-composite effects have structural bands.
 */

import type { CompositorClip } from "./types";

function roleBand(role: CompositorClip["role"]): number {
  switch (role) {
    case "audio":
      // Audio has no visual contribution. Keep the generic resolver stable for
      // callers that include it while the evaluator filters it from visuals.
      return -1;
    case "background":
      return 0;
    case "effect":
      return 2;
    case "primary":
    case "overlay":
    case "text":
      return 1;
    default:
      return 1;
  }
}

/** Bottom-to-top ordering for a composited frame. The last item is foreground. */
export function compareCompositorClips(a: CompositorClip, b: CompositorClip): number {
  const bandOrder = roleBand(a.role) - roleBand(b.role);
  if (bandOrder !== 0) return bandOrder;

  // Track index 0 is the top row in the editor, hence must render last.
  const trackOrder = b.trackIndex - a.trackIndex;
  if (trackOrder !== 0) return trackOrder;

  const zOrder = a.zIndex - b.zIndex;
  if (zOrder !== 0) return zOrder;

  const priorityOrder = a.evaluationPriority - b.evaluationPriority;
  if (priorityOrder !== 0) return priorityOrder;

  // Project serialization does not promise array order. Stable IDs make an
  // otherwise identical stack deterministic across preview and export.
  return a.id.localeCompare(b.id);
}

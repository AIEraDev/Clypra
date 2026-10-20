import type { DragGeometry } from "@/core/interactions";
import type { Clip, TextClip } from "@/types";

/**
 * Applies the signal-plane transform to the private clip snapshot consumed by
 * the preview evaluator. This deliberately does not write Zustand or history.
 *
 * Text resize has a different live contract from its committed state: during
 * the pointer gesture, the already-correct texture is scaled as one unit with
 * its panel, glyphs, and origin. Re-rasterizing a new font/layout on every
 * pointer frame races the transform border and lets the panel shift relative
 * to the handles. The final command persists the new font/base layout at
 * mouse-up, then the normal raster path replaces this scaled preview.
 */
export function applyDragPreviewGeometry(
  clip: Clip,
  geometry: DragGeometry,
): Clip {
  const transformed: Clip = {
    ...clip,
    x: geometry.x,
    y: geometry.y,
    width: geometry.width,
    height: geometry.height,
    rotation: geometry.rotation,
    ...(geometry.conform ? { conform: geometry.conform } : {}),
  };

  if (!("text" in clip)) {
    return transformed;
  }

  // Preserve the drag-start text raster contract. `width` / `height` are the
  // live presentation rectangle; nativeTextPreview derives its scale from
  // those values against this unchanged authored base rectangle.
  return {
    ...transformed,
  } as TextClip;
}

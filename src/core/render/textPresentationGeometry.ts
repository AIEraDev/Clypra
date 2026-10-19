/**
 * Presentation geometry for an evaluated text layer.
 *
 * Text layout and raster ink are deliberately separate concerns. A renderer
 * may crop transparent pixels from an uploaded texture, but that optimisation
 * must never move the text object's transform origin. All preview presenters
 * rotate the raster draw quad around the persisted/evaluated layout box.
 */

export interface TextLayoutBox {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface TextRasterDrawBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextPresentationGeometry {
  /** Stable editor-facing text object bounds. */
  layout: TextLayoutBox;
  /** Rotation origin shared by interaction and every renderer. */
  pivotX: number;
  pivotY: number;
  /** Raster placement after rotating its unrotated draw box around `pivot`. */
  drawX: number;
  drawY: number;
  drawWidth: number;
  drawHeight: number;
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Resolve the quad a cropped raster must occupy for a layout-box transform.
 * Canvas coordinates use a positive Y axis, so this matrix intentionally
 * matches Canvas2D/CSS positive-angle rotation semantics.
 */
export function resolveTextPresentationGeometry(
  layoutInput: TextLayoutBox,
  drawInput: TextRasterDrawBox,
): TextPresentationGeometry {
  const layout: TextLayoutBox = {
    x: finite(layoutInput.x, 0),
    y: finite(layoutInput.y, 0),
    width: Math.max(0, finite(layoutInput.width, 0)),
    height: Math.max(0, finite(layoutInput.height, 0)),
    rotation: finite(layoutInput.rotation, 0),
  };
  const drawWidth = Math.max(0, finite(drawInput.width, 0));
  const drawHeight = Math.max(0, finite(drawInput.height, 0));
  const drawCenterX = finite(drawInput.x, layout.x) + drawWidth / 2;
  const drawCenterY = finite(drawInput.y, layout.y) + drawHeight / 2;
  const pivotX = layout.x + layout.width / 2;
  const pivotY = layout.y + layout.height / 2;
  const radians = (layout.rotation * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const offsetX = drawCenterX - pivotX;
  const offsetY = drawCenterY - pivotY;
  const rotatedCenterX = pivotX + offsetX * cosine - offsetY * sine;
  const rotatedCenterY = pivotY + offsetX * sine + offsetY * cosine;

  return {
    layout,
    pivotX,
    pivotY,
    drawX: rotatedCenterX - drawWidth / 2,
    drawY: rotatedCenterY - drawHeight / 2,
    drawWidth,
    drawHeight,
  };
}

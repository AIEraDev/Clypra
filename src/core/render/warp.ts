/**
 * VireoStudio Advanced Typography layout & Warping Engine
 */

export interface PathPoint {
  x: number;
  y: number;
  tangentX: number;
  tangentY: number;
}

/**
 * Computes coordinate and normal points along a circular arc path.
 */
export function getArcPath(
  centerX: number,
  centerY: number,
  radius: number,
  startAngleDeg: number,
  arcLengthDeg: number,
  stepsCount: number
): PathPoint[] {
  const points: PathPoint[] = [];
  const startRad = (startAngleDeg * Math.PI) / 180;
  const lengthRad = (arcLengthDeg * Math.PI) / 180;

  for (let i = 0; i < stepsCount; i++) {
    const progress = i / Math.max(1, stepsCount - 1);
    const angle = startRad + lengthRad * progress;

    const x = centerX + radius * Math.cos(angle);
    const y = centerY + radius * Math.sin(angle);

    // Tangent vector is perpendicular to normal (radius vector)
    const tangentX = -Math.sin(angle);
    const tangentY = Math.cos(angle);

    points.push({ x, y, tangentX, tangentY });
  }

  return points;
}

/**
 * Draws text character-by-character along a circular arc path on the Canvas 2D context.
 */
export function drawTextOnArc(
  ctx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  centerY: number,
  radius: number,
  startAngleDeg: number,
  spacingFactor = 1.0,
  drawFunc: (char: string, x: number, y: number) => void
): void {
  const len = text.length;
  if (len === 0) return;

  const startRad = (startAngleDeg * Math.PI) / 180;

  ctx.save();

  // Draw each character with exact rotational offset
  for (let i = 0; i < len; i++) {
    const char = text[i];
    // Dynamic angular offset per letter
    const angle = startRad + (i * 0.08 * spacingFactor);

    const x = centerX + radius * Math.cos(angle);
    const y = centerY + radius * Math.sin(angle);

    ctx.save();
    ctx.translate(x, y);
    // Align character rotation perpendicular to radial vector (tangent angle)
    ctx.rotate(angle + Math.PI / 2);

    // Render character centered at local origin
    drawFunc(char, 0, 0);
    ctx.restore();
  }

  ctx.restore();
}

/**
 * Applies coordinate displacement warp filters (e.g. Wave, Bulge) to an OffscreenCanvas context.
 */
export function applyWarpDisplacement(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  type: "wave" | "bulge",
  amplitude = 15
): void {
  const sourceImg = ctx.getImageData(0, 0, width, height);
  const destImg = ctx.createImageData(width, height);

  const srcData = sourceImg.data;
  const destData = destImg.data;

  for (let y = 0; y < height; y++) {
    // Bulge center coordinates
    const normalizedY = (y / height) - 0.5;

    for (let x = 0; x < width; x++) {
      const normalizedX = (x / width) - 0.5;

      let srcX = x;
      let srcY = y;

      if (type === "wave") {
        // Vertical shift using sine displacement mapping
        srcY = y + amplitude * Math.sin((x / width) * 2 * Math.PI);
      } else if (type === "bulge") {
        // Coordinate expansion from center to create standard fisheye bulge
        const dist = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY);
        const factor = 1.0 - dist * dist * (amplitude / 40);

        srcX = width * (normalizedX * factor + 0.5);
        srcY = height * (normalizedY * factor + 0.5);
      }

      // Safe bilinear/nearest-neighbor pixel mapping
      const mappedX = Math.round(srcX);
      const mappedY = Math.round(srcY);

      if (mappedX >= 0 && mappedX < width && mappedY >= 0 && mappedY < height) {
        const destIdx = (y * width + x) * 4;
        const srcIdx = (mappedY * width + mappedX) * 4;

        destData[destIdx] = srcData[srcIdx];
        destData[destIdx + 1] = srcData[srcIdx + 1];
        destData[destIdx + 2] = srcData[srcIdx + 2];
        destData[destIdx + 3] = srcData[srcIdx + 3];
      }
    }
  }

  ctx.putImageData(destImg, 0, 0);
}

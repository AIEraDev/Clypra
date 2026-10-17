/**
 * bubbleRenderer.ts
 *
 * Dedicated Canvas2D Bubble Renderer for Clypra's Text Appearance System.
 *
 * Renders decorative background shapes (torn paper, speech bubbles,
 * thought clouds, ribbons, comic bursts, receipts) behind live editable text.
 *
 * Invariants:
 * - Deterministic output based on preset ID and dimensions.
 * - Always restores canvas state (save/restore).
 * - Operates in unscaled layout coordinates matching text composition.
 */

export interface BubbleRenderOptions {
  color?: string;
  opacity?: number;
  borderRadius?: number;
}

/**
 * Procedural pseudo-random helper for deterministic edge irregularities
 */
function pseudoNoise(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Draws a realistic torn paper strip with jagged top/bottom edges,
 * paper texture, and drop shadow. (Matches CapCut reference in screenshot 4)
 */
export function drawTornPaper(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  fillColor = "#faf9f6",
  shadow = true,
) {
  ctx.save();

  if (shadow) {
    ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
    ctx.shadowBlur = 12;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 4;
  }

  ctx.fillStyle = fillColor;
  ctx.beginPath();

  const steps = Math.max(16, Math.floor(width / 14));
  const stepW = width / steps;

  // Start top-left
  ctx.moveTo(x, y + 6);

  // Top jagged edge (slight dips and peaks)
  for (let i = 0; i <= steps; i++) {
    const curX = x + i * stepW;
    const n = pseudoNoise(i * 1.37 + 10);
    const wave = Math.sin((i / steps) * Math.PI * 3) * 3;
    const curY = y + (n * 5 - 2.5) + wave;
    if (i === 0) ctx.lineTo(curX, curY);
    else ctx.lineTo(curX, curY);
  }

  // Right edge (mostly straight with subtle fiber wobble)
  ctx.lineTo(x + width, y + height - 6);

  // Bottom jagged edge (reverse direction)
  for (let i = steps; i >= 0; i--) {
    const curX = x + i * stepW;
    const n = pseudoNoise(i * 2.19 + 50);
    const wave = Math.sin((i / steps) * Math.PI * 2) * 4;
    const curY = y + height + (n * 6 - 3) + wave;
    ctx.lineTo(curX, curY);
  }

  // Left edge back to top-left
  ctx.lineTo(x, y + 6);
  ctx.closePath();
  ctx.fill();

  // Reset shadow for inner details
  if (shadow) {
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
  }

  // Subtle paper grain overlay: soft horizontal wash
  const paperGrad = ctx.createLinearGradient(x, y, x, y + height);
  paperGrad.addColorStop(0, "rgba(255, 255, 255, 0.4)");
  paperGrad.addColorStop(0.5, "rgba(0, 0, 0, 0.02)");
  paperGrad.addColorStop(1, "rgba(0, 0, 0, 0.06)");
  ctx.fillStyle = paperGrad;
  ctx.fill();

  ctx.restore();
}

/**
 * Draws a smooth speech bubble balloon with a curved tail.
 */
export function drawSpeechBubble(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  fillColor = "#ffffff",
  strokeColor = "#000000",
  strokeWidth = 2,
  radius = 16,
) {
  ctx.save();
  const tailH = Math.min(16, height * 0.25);
  const bodyH = height - tailH;

  ctx.fillStyle = fillColor;
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = strokeWidth;

  ctx.beginPath();
  // Rounded body
  ctx.roundRect(x, y, width, bodyH, radius);
  ctx.fill();
  if (strokeWidth > 0) ctx.stroke();

  // Tail pointing down-left
  const tailBaseX = x + width * 0.25;
  const tailBaseW = Math.min(24, width * 0.2);
  const tailTipX = x + width * 0.15;
  const tailTipY = y + height;

  ctx.beginPath();
  ctx.moveTo(tailBaseX, y + bodyH - 2);
  ctx.quadraticCurveTo(tailBaseX + 2, y + bodyH + tailH * 0.6, tailTipX, tailTipY);
  ctx.quadraticCurveTo(tailBaseX + tailBaseW * 0.7, y + bodyH + tailH * 0.4, tailBaseX + tailBaseW, y + bodyH - 2);
  ctx.closePath();
  ctx.fill();
  if (strokeWidth > 0) ctx.stroke();

  // Re-fill body to clear overlapping tail stroke
  ctx.beginPath();
  ctx.roundRect(x + 1, y + 1, width - 2, bodyH - 2, radius);
  ctx.fill();

  ctx.restore();
}

/**
 * Draws a fluffy thought cloud bubble.
 */
export function drawThoughtCloud(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  fillColor = "#ffffff",
  strokeColor = "#000000",
  strokeWidth = 2,
) {
  ctx.save();
  ctx.fillStyle = fillColor;
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = strokeWidth;

  const cx = x + width / 2;
  const cy = y + height / 2;
  const rx = width * 0.44;
  const ry = height * 0.38;

  ctx.beginPath();
  // 6 overlapping lobes
  const lobes = 8;
  for (let i = 0; i < lobes; i++) {
    const angle = (i / lobes) * Math.PI * 2;
    const lx = cx + Math.cos(angle) * rx;
    const ly = cy + Math.sin(angle) * ry;
    const lobeR = Math.min(width, height) * 0.28;
    ctx.moveTo(lx + lobeR, ly);
    ctx.arc(lx, ly, lobeR, 0, Math.PI * 2);
  }
  ctx.fill();
  if (strokeWidth > 0) ctx.stroke();

  ctx.restore();
}

/**
 * Draws an energetic comic starburst explosion.
 */
export function drawComicBurst(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  fillColor = "#ffffff",
  strokeColor = "#000000",
  strokeWidth = 3,
) {
  ctx.save();
  ctx.fillStyle = fillColor;
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = strokeWidth;

  const cx = x + width / 2;
  const cy = y + height / 2;
  const points = 16;
  const outerRx = width / 2;
  const outerRy = height / 2;
  const innerRx = width * 0.32;
  const innerRy = height * 0.32;

  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const isOuter = i % 2 === 0;
    const rx = isOuter ? outerRx : innerRx;
    const ry = isOuter ? outerRy : innerRy;
    const px = cx + Math.cos(angle) * rx;
    const py = cy + Math.sin(angle) * ry;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  if (strokeWidth > 0) ctx.stroke();

  ctx.restore();
}

/**
 * Draws a folded ribbon / banner with chevron notch ends.
 */
export function drawRibbonBanner(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  fillColor = "#facc15",
  strokeColor = "#000000",
  strokeWidth = 2,
) {
  ctx.save();
  ctx.fillStyle = fillColor;
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = strokeWidth;

  const notch = Math.min(18, width * 0.08);

  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + width - notch, y);
  ctx.lineTo(x + width, y + height / 2);
  ctx.lineTo(x + width - notch, y + height);
  ctx.lineTo(x, y + height);
  ctx.lineTo(x + notch, y + height / 2);
  ctx.closePath();
  ctx.fill();
  if (strokeWidth > 0) ctx.stroke();

  ctx.restore();
}

/**
 * Main dispatcher: renders a bubble decoration based on its presetId.
 */
export function renderBubbleBackground(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  presetId: string,
  x: number,
  y: number,
  width: number,
  height: number,
  options?: BubbleRenderOptions,
): boolean {
  if (!presetId || presetId === "none") return false;

  const color = options?.color || "#ffffff";
  const opacity = options?.opacity ?? 1;

  ctx.save();
  if (opacity < 1) {
    ctx.globalAlpha *= opacity;
  }

  // 1. Torn Paper category (matches Screenshot 2 & Screenshot 4)
  if (
    presetId === "bubble-paper-torn" ||
    presetId === "bubble-paper-torn-beige" ||
    presetId === "bubble-paper-kraft" ||
    presetId === "bubble-paper-notebook"
  ) {
    const paperColor =
      presetId === "bubble-paper-kraft"
        ? "#d4a373"
        : presetId === "bubble-paper-torn-beige"
        ? "#f3eed9"
        : "#faf9f6";
    drawTornPaper(ctx, x, y, width, height, color || paperColor, true);
    ctx.restore();
    return true;
  }

  // 2. Speech Bubbles
  if (
    presetId === "bubble-speech-round" ||
    presetId === "bubble-speech-oval" ||
    presetId === "bubble-speech-tall"
  ) {
    drawSpeechBubble(ctx, x, y, width, height, color, "#000000", 2, 16);
    ctx.restore();
    return true;
  }

  // 3. Clouds
  if (
    presetId === "bubble-cloud-dotted" ||
    presetId === "bubble-cloud-morning" ||
    presetId === "bubble-cloud-yellow"
  ) {
    drawThoughtCloud(ctx, x, y, width, height, color, "#000000", 2);
    ctx.restore();
    return true;
  }

  // 4. Comic Bursts
  if (presetId === "bubble-comic-bam" || presetId === "bubble-comic-dark-hero") {
    const burstColor = presetId === "bubble-comic-dark-hero" ? "#18181b" : color;
    const strokeColor = presetId === "bubble-comic-dark-hero" ? "#ef4444" : "#000000";
    drawComicBurst(ctx, x, y, width, height, burstColor, strokeColor, 3);
    ctx.restore();
    return true;
  }

  // 5. Ribbons & Banners
  if (presetId === "bubble-ribbon-sunny" || presetId === "bubble-ribbon-yellow") {
    drawRibbonBanner(ctx, x, y, width, height, color || "#facc15", "#000000", 2);
    ctx.restore();
    return true;
  }

  // Default fallback: rounded rectangle card with shadow
  const radius = options?.borderRadius ?? 8;
  ctx.shadowColor = "rgba(0, 0, 0, 0.2)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fill();

  ctx.restore();
  return true;
}

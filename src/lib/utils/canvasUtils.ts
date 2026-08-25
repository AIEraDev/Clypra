/**
 * Shared canvas drawing utilities for waveform components
 */

/** Draw a rounded rectangle on a canvas context */
export function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  if (width < 2 * radius) radius = width / 2;
  if (height < 2 * radius) radius = height / 2;

  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.fill();
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  if (!hex || typeof hex !== "string") return null;
  let cleanHex = hex.trim();
  if (/^#?[a-f\d]{3}$/i.test(cleanHex)) {
    const raw = cleanHex.replace("#", "");
    cleanHex = `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`;
  }
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(cleanHex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

/** Read a resolved theme color from CSS and convert it to RGB for canvas APIs. */
export function getThemeAccentRgb(): { r: number; g: number; b: number } | null {
  if (typeof document === "undefined") return null;

  const probe = document.createElement("span");
  probe.style.color = "var(--clypra-interaction-focus)";
  probe.style.display = "none";
  document.body?.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();

  const rgb = resolved.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i,
  );
  return rgb
    ? { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) }
    : hexToRgb(resolved);
}

/**
 * Professional waveform rendering with thin 1px bar style
 * Single-direction bars growing upward from baseline (bottom)
 *
 * @param canvas - Canvas element to render on
 * @param buckets - Waveform data with peak and RMS values
 * @param color - Single color for the waveform bars
 * @param logicalWidth - Logical width (before DPR scaling)
 * @param logicalHeight - Logical height (before DPR scaling)
 */
export function drawProfessionalWaveform(canvas: HTMLCanvasElement, buckets: { peak: number; rms: number }[], color: string, logicalWidth?: number, logicalHeight?: number): void {
  const ctx = canvas.getContext("2d");
  if (!ctx || !buckets || buckets.length === 0) return;

  // Use logical dimensions if provided, otherwise use canvas dimensions
  const width = logicalWidth || canvas.width;
  const height = logicalHeight || canvas.height;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const bucketWidth = width / buckets.length;

  // Fixed 1px bar width with natural spacing from bucket width
  const barWidth = 1;

  ctx.fillStyle = color;

  for (let i = 0; i < buckets.length; i++) {
    // Use peak for maximum visual impact (shows full dynamic range)
    const amplitude = buckets[i].peak;
    const x = i * bucketWidth + (bucketWidth - barWidth) / 2; // Center the 1px bar in its bucket

    // Calculate bar height from bottom - use full available height
    const minHeight = 2; // Minimum visible height
    const barHeight = Math.max(minHeight, amplitude * height * 0.95); // Use 95% of canvas height

    // Draw thin 1px bar from bottom, growing upward
    const y = height - barHeight; // Start position (from bottom)
    ctx.fillRect(x, y, barWidth, barHeight);
  }
}

/**
 * Fallback: Convert old RMS-only data to peak + RMS format
 * For dense bar style, we use RMS directly as the amplitude
 */
export function convertLegacyWaveform(rmsOnly: number[]): { peak: number; rms: number }[] {
  return rmsOnly.map((rms) => ({
    peak: rms, // Use RMS as peak for dense bar display
    rms,
  }));
}

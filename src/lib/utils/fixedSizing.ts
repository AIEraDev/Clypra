/**
 * Fixed Sizing System for Cross-OS Design Output Consistency
 *
 * Provides deterministic, OS-agnostic normalization for:
 * 1. Font sizes (points/pixels)
 * 2. Icon/Sticker dimensions and bounds
 * 3. Text baseline offsets and rasterization metrics
 * 4. Reference canvas resolution scaling (1920x1080 canonical baseline)
 */

export interface CanvasDimensions {
  width: number;
  height: number;
}

export const REFERENCE_CANVAS: CanvasDimensions = {
  width: 1920,
  height: 1080,
};

export interface NormalizedFontSizeOptions {
  dpr?: number;
  referenceCanvas?: CanvasDimensions;
}

export interface NormalizedIconSizeOptions {
  dpr?: number;
  referenceCanvas?: CanvasDimensions;
  maintainAspectRatio?: boolean;
}

export interface TextRenderMetrics {
  fontSize: number;
  baselineOffset: number;
  lineHeight: number;
  paddingX: number;
  paddingY: number;
}

/**
 * Calculates canonical reference scale factor for canvas dimensions.
 * Maps canvas size to 1920x1080 reference resolution.
 */
export function getFixedScaleFactor(
  canvasWidth: number,
  canvasHeight: number,
  referenceWidth: number = REFERENCE_CANVAS.width,
  referenceHeight: number = REFERENCE_CANVAS.height
): number {
  if (canvasWidth <= 0 || canvasHeight <= 0 || referenceWidth <= 0 || referenceHeight <= 0) {
    return 1.0;
  }
  const scaleX = canvasWidth / referenceWidth;
  const scaleY = canvasHeight / referenceHeight;
  return Math.min(scaleX, scaleY);
}

/**
 * Normalizes font size to maintain identical physical visual weight across operating systems,
 * system display scaling (100%, 125%, 150%, 200%), and device pixel ratios.
 */
export function normalizeFontSize(
  fontSize: number,
  canvasWidth: number = REFERENCE_CANVAS.width,
  canvasHeight: number = REFERENCE_CANVAS.height,
  options?: NormalizedFontSizeOptions
): number {
  if (fontSize <= 0) return 1;

  const ref = options?.referenceCanvas ?? REFERENCE_CANVAS;
  const scale = getFixedScaleFactor(canvasWidth, canvasHeight, ref.width, ref.height);

  // Normalize OS DPI factor: font sizes operate strictly in canonical project pixel space.
  // OS devicePixelRatio variations (e.g. 1.25 on Windows, 2.0 on Mac Retina) do NOT alter
  // project font size.
  const normalizedSize = fontSize * scale;
  return Math.round(normalizedSize * 100) / 100;
}

/**
 * Normalizes icon and sticker dimensions (width/height) across OS environments.
 */
export function normalizeIconSize(
  width: number,
  height: number,
  canvasWidth: number = REFERENCE_CANVAS.width,
  canvasHeight: number = REFERENCE_CANVAS.height,
  options?: NormalizedIconSizeOptions
): { width: number; height: number } {
  const safeW = Math.max(1, width);
  const safeH = Math.max(1, height);

  const ref = options?.referenceCanvas ?? REFERENCE_CANVAS;
  const scale = getFixedScaleFactor(canvasWidth, canvasHeight, ref.width, ref.height);

  const normW = Math.round(safeW * scale * 100) / 100;
  const normH = Math.round(safeH * scale * 100) / 100;

  return { width: normW, height: normH };
}

/**
 * Standardizes text rendering baseline metrics across OS font engines
 * (DirectWrite on Windows, CoreText on macOS, FreeType on Linux).
 */
export function getTextRenderMetrics(
  fontSize: number,
  lineHeightScale: number = 1.2
): TextRenderMetrics {
  const safeSize = Math.max(1, fontSize);
  
  // Baseline offset coefficient (0.82 * fontSize) standardizes vertical alignment
  // across operating systems to avoid sub-pixel font rendering shifts.
  const baselineOffset = Math.round(safeSize * 0.82 * 100) / 100;
  const lineHeight = Math.round(safeSize * lineHeightScale * 100) / 100;
  const paddingX = Math.round(safeSize * 0.25 * 100) / 100;
  const paddingY = Math.round(safeSize * 0.25 * 100) / 100;

  return {
    fontSize: safeSize,
    baselineOffset,
    lineHeight,
    paddingX,
    paddingY,
  };
}

/**
 * High-level helper returning consolidated fixed sizing configuration for design output.
 */
export function getFixedSizingConfig(
  canvasWidth: number,
  canvasHeight: number
): {
  scaleFactor: number;
  referenceCanvas: CanvasDimensions;
  normalizeFont: (size: number) => number;
  normalizeIcon: (w: number, h: number) => { width: number; height: number };
  getTextMetrics: (size: number, lineHeightScale?: number) => TextRenderMetrics;
} {
  const scaleFactor = getFixedScaleFactor(canvasWidth, canvasHeight);

  return {
    scaleFactor,
    referenceCanvas: REFERENCE_CANVAS,
    normalizeFont: (size: number) => normalizeFontSize(size, canvasWidth, canvasHeight),
    normalizeIcon: (w: number, h: number) => normalizeIconSize(w, h, canvasWidth, canvasHeight),
    getTextMetrics: (size: number, lineHeightScale?: number) => getTextRenderMetrics(size, lineHeightScale),
  };
}

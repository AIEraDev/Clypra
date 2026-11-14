/**
 * captionRasterizer.ts
 *
 * Main-thread caption rasterizer for the **export** path.
 *
 * Responsibilities:
 * - Block until every preset font is fully loaded (FontFace.status === "loaded").
 *   Unlike the preview path, the export path MUST NOT proceed with a system
 *   fallback font. If a font fails to load, it throws ExportFontResolutionError.
 * - Render a CaptionCue to an OffscreenCanvas using renderCaptionToCanvas from
 *   @clypra-studio/engine/captions (the shared, single implementation used by
 *   the worker path and preview fallback as well — no duplicate logic here).
 * - Return raw RGBA bytes, cropped to the content bounding box, alongside the
 *   bounding box offset for compositor placement.
 *
 * NOT for preview / playback: use the worker path in
 * templateRasterizerWorkerClient.ts for playback, which degrades gracefully on
 * font errors.
 *
 * Threading notes:
 * - Runs on the main thread only.
 * - Uses document.fonts (FontFaceSet) for font loading — not self.fonts.
 * - The worker uses self.fonts via ensureWorkerFontLoaded() in
 *   templateRasterizer.worker.ts; both call the same renderCaptionToCanvas().
 */

import { renderCaptionToCanvas } from "@clypra-studio/engine";
import type {
  CaptionCue,
  CaptionPresetDefinition,
  CaptionRenderOptions,
} from "@clypra-studio/engine";
import { ExportFontResolutionError, isSpecificFontFaceLoaded } from "@/core/fonts/fontErrors";

export interface CaptionRasterResult {
  /** RGBA pixel data for the cropped bounding box. */
  rgba: Uint8ClampedArray;
  /** Cropped width in pixels. */
  width: number;
  /** Cropped height in pixels. */
  height: number;
  /** Absolute X offset of the crop within the full canvas (compositor placement). */
  x: number;
  /** Absolute Y offset of the crop within the full canvas (compositor placement). */
  y: number;
}

export interface ExportCaptionRasterOptions {
  /** Full canvas width in pixels (equals the output video width). */
  canvasWidth: number;
  /** Full canvas height in pixels (equals the output video height). */
  canvasHeight: number;
  /** Scale factor (default: 1.0). */
  scale?: number;
  /** Vertical centre position as a ratio of canvas height (default: 0.85). */
  positionYRatio?: number;
}

function createExportCanvas(
  width: number,
  height: number,
): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  if (typeof document !== "undefined" && typeof document.createElement === "function") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new Error("[captionRasterizer] Canvas environment unavailable");
}

/**
 * Rasterize a caption cue for export.
 *
 * Font loading:
 * - Checks FontFace.status directly (not `document.fonts.check()` which can
 *   match system fallbacks for unregistered families).
 * - If the font is registered but not yet "loaded", awaits face.load().
 * - If the font is not registered at all, throws ExportFontResolutionError.
 *
 * @throws {ExportFontResolutionError} if the preset font cannot be resolved.
 */
export async function rasterizeCaptionForExport(
  cue: CaptionCue,
  activeWordIndex: number,
  preset: CaptionPresetDefinition,
  options: ExportCaptionRasterOptions,
): Promise<CaptionRasterResult> {
  const { canvasWidth, canvasHeight, scale = 1.0, positionYRatio = 0.85 } = options;
  const fontFamily = preset.fontFamily;

  // ── Font resolution (export must block; no deadline fallback allowed) ──────
  if (fontFamily) {
    await ensureExportFontLoaded(fontFamily);
  }

  // ── Render to full canvas ─────────────────────────────────────────────────
  const w = Math.max(1, Math.round(canvasWidth));
  const h = Math.max(1, Math.round(canvasHeight));

  const canvas = createExportCanvas(w, h);
  const ctx = canvas.getContext("2d", { alpha: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) {
    throw new Error("[captionRasterizer] Failed to create 2D canvas context");
  }

  ctx.clearRect(0, 0, w, h);

  const renderOptions: CaptionRenderOptions = {
    cue,
    activeWordIndex,
    preset,
    canvasWidth: w,
    canvasHeight: h,
    scale,
    positionYRatio,
  };

  const result = renderCaptionToCanvas(ctx, renderOptions);
  const bounds = result.bounds;

  // ── Crop to content bounding box ─────────────────────────────────────────
  const croppedWidth = Math.max(1, bounds.width);
  const croppedHeight = Math.max(1, bounds.height);

  const croppedCanvas = createExportCanvas(croppedWidth, croppedHeight);
  const croppedCtx = croppedCanvas.getContext("2d", { alpha: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!croppedCtx) {
    throw new Error("[captionRasterizer] Failed to create cropped 2D canvas context");
  }

  croppedCtx.drawImage(canvas, bounds.x, bounds.y, croppedWidth, croppedHeight, 0, 0, croppedWidth, croppedHeight);
  const rgba = croppedCtx.getImageData(0, 0, croppedWidth, croppedHeight).data;

  return {
    rgba: rgba as Uint8ClampedArray,
    width: croppedWidth,
    height: croppedHeight,
    x: bounds.x,
    y: bounds.y,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Block until `fontFamily` is loaded in `document.fonts`.
 *
 * Uses FontFace.status directly — NOT document.fonts.check() — to avoid false
 * positives from system font fallbacks (see fontErrors.ts for rationale).
 *
 * @throws {ExportFontResolutionError} if the font is missing or fails to load.
 */
async function ensureExportFontLoaded(fontFamily: string): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) {
    // Non-browser export environment (e.g. headless Node). Cannot load fonts.
    throw new ExportFontResolutionError(
      fontFamily,
      "document.fonts is not available in this environment",
    );
  }

  // Find the registered FontFace entry by family name.
  const targetFamily = fontFamily.trim().replace(/^['"]|['"]$/g, "").toLowerCase();
  let matchedFace: FontFace | null = null;

  for (const face of document.fonts) {
    const faceFamily = face.family.replace(/^['"]|['"]$/g, "").toLowerCase();
    if (faceFamily === targetFamily) {
      matchedFace = face;
      break;
    }
  }

  if (!matchedFace) {
    throw new ExportFontResolutionError(
      fontFamily,
      `Font family "${fontFamily}" is not registered in document.fonts`,
    );
  }

  if (matchedFace.status === "loaded") return;

  if (matchedFace.status === "error") {
    throw new ExportFontResolutionError(
      fontFamily,
      `FontFace for "${fontFamily}" previously failed to load`,
    );
  }

  // Status is "unloaded" or "loading" — await the load promise.
  try {
    const loaded = await matchedFace.load();
    if (loaded.status !== "loaded") {
      throw new ExportFontResolutionError(
        fontFamily,
        `FontFace.load() completed with status "${loaded.status}" instead of "loaded"`,
      );
    }
  } catch (err) {
    if (err instanceof ExportFontResolutionError) throw err;
    throw new ExportFontResolutionError(
      fontFamily,
      err instanceof Error ? err.message : String(err),
    );
  }

  // Verify the face is now reported as loaded via isSpecificFontFaceLoaded.
  if (!isSpecificFontFaceLoaded(document.fonts, fontFamily)) {
    throw new ExportFontResolutionError(
      fontFamily,
      "Font loaded but isSpecificFontFaceLoaded returned false — possible FontFaceSet race",
    );
  }
}

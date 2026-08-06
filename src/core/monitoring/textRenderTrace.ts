const DEBUG_KEY = "clypra.debug.textRender";

/**
 * Text Render Trace - Disabled by default to reduce console noise
 *
 * To enable for debugging:
 * 1. Open browser console
 * 2. Run: localStorage.setItem("clypra.debug.textRender", "1")
 * 3. Refresh the page
 *
 * To disable:
 * localStorage.removeItem("clypra.debug.textRender")
 */
export function isTextRenderTraceEnabled(): boolean {
  // Disabled by default - uncomment below to enable via localStorage
  return false;
  // if (typeof window === "undefined") return false;
  // if (!import.meta.env.DEV) return false;
  // return window.localStorage?.getItem(DEBUG_KEY) === "1" || (window as any).__CLYPRA_TEXT_RENDER_DEBUG__ === true;
}

export function textRenderTrace(stage: string, payload: Record<string, unknown>): void {
  if (!isTextRenderTraceEnabled()) return;
  console.log(`[TextRenderTrace:${stage}]`, payload);
}

export function textRenderWarn(stage: string, payload: Record<string, unknown>): void {
  if (!isTextRenderTraceEnabled()) return;
  console.warn(`[TextRenderTrace:${stage}]`, payload);
}

export interface CanvasAlphaBounds {
  visiblePixels: number;
  sampledPixels: number;
  alphaMax: number;
  sampledRegion: { width: number; height: number; clipped: boolean };
  bounds: { x: number; y: number; width: number; height: number } | null;
}

export function sampleCanvasAlpha(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, width: number, height: number): CanvasAlphaBounds | null {
  if (!isTextRenderTraceEnabled()) return null;

  try {
    const w = Math.max(1, Math.min(Math.floor(width), 4096));
    const h = Math.max(1, Math.min(Math.floor(height), 4096));
    const image = ctx.getImageData(0, 0, w, h);
    const step = Math.max(4, Math.floor(image.data.length / 4096 / 4) * 4);
    let visiblePixels = 0;
    let sampledPixels = 0;
    let alphaMax = 0;
    let minX = w;
    let minY = h;
    let maxX = -1;
    let maxY = -1;

    for (let i = 3; i < image.data.length; i += step) {
      const alpha = image.data[i];
      if (alpha > 8) {
        visiblePixels++;
        const pixel = Math.floor((i - 3) / 4);
        const x = pixel % w;
        const y = Math.floor(pixel / w);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      if (alpha > alphaMax) alphaMax = alpha;
      sampledPixels++;
    }

    return {
      visiblePixels,
      sampledPixels,
      alphaMax,
      sampledRegion: { width: w, height: h, clipped: w < Math.floor(width) || h < Math.floor(height) },
      bounds: maxX >= minX && maxY >= minY ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null,
    };
  } catch (error) {
    textRenderWarn("alpha-sample-failed", { error });
    return null;
  }
}

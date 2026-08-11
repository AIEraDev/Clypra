import { getSharedPixiRenderer as getShared, releaseSharedPixiRenderer as releaseShared } from "@clypra-studio/engine";

export function getSharedPixiRenderer(canvas: HTMLCanvasElement | OffscreenCanvas, width: number, height: number) {
  const renderer = getShared(canvas, width, height);
  if (renderer && (renderer as any).initPromise?.catch) {
    (renderer as any).initPromise.catch((err: unknown) => {
      console.warn("[SharedPixiRenderer] WebGL renderer initialization deferred error:", err);
    });
  }
  return renderer;
}

export function releaseSharedPixiRenderer(canvas: HTMLCanvasElement | OffscreenCanvas): void {
  releaseShared(canvas);
}

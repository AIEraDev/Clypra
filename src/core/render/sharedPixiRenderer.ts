import { getSharedPixiRenderer as getShared, releaseSharedPixiRenderer as releaseShared } from "@clypra/engine";

export function getSharedPixiRenderer(canvas: HTMLCanvasElement | OffscreenCanvas, width: number, height: number) {
  return getShared(canvas, width, height);
}

export function releaseSharedPixiRenderer(canvas: HTMLCanvasElement | OffscreenCanvas): void {
  releaseShared(canvas);
}

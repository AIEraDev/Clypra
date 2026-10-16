/**
 * Canvas Pixel Helper — Layer A (Browser Rasterization) Assertions
 *
 * Provides utilities for reading and asserting canvas pixel values
 * in Playwright E2E tests. Operates on the real browser canvas via
 * page.evaluate(), reading actual rendered pixels.
 */

import type { Page } from "@playwright/test";

export interface PixelSample {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * Read a single pixel from a canvas identified by data-testid.
 */
export async function readCanvasPixel(
  page: Page,
  canvasTestId: string,
  x: number,
  y: number,
): Promise<PixelSample> {
  return page.evaluate(
    ({ testId, px, py }) => {
      const canvas = document.querySelector(
        `[data-testid="${testId}"]`,
      ) as HTMLCanvasElement;
      if (!canvas)
        throw new Error(`Canvas [data-testid="${testId}"] not found`);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Failed to get 2d context");
      const imageData = ctx.getImageData(px, py, 1, 1);
      return {
        x: px,
        y: py,
        r: imageData.data[0],
        g: imageData.data[1],
        b: imageData.data[2],
        a: imageData.data[3],
      };
    },
    { testId: canvasTestId, px: x, py: y },
  );
}

/**
 * Read a rectangular region of pixel data from a canvas.
 */
export async function readCanvasRegion(
  page: Page,
  canvasTestId: string,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<{ data: number[]; width: number; height: number }> {
  return page.evaluate(
    ({ testId, rx, ry, rw, rh }) => {
      const canvas = document.querySelector(
        `[data-testid="${testId}"]`,
      ) as HTMLCanvasElement;
      if (!canvas) throw new Error(`Canvas not found`);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Failed to get 2d context");
      const imageData = ctx.getImageData(rx, ry, rw, rh);
      return { data: Array.from(imageData.data), width: rw, height: rh };
    },
    { testId: canvasTestId, rx: x, ry: y, rw: width, rh: height },
  );
}

/**
 * Assert that a pixel matches an expected RGBA colour within tolerance.
 * Throws a descriptive error if any channel exceeds the tolerance.
 */
export function assertPixelColor(
  pixel: PixelSample,
  expected: { r: number; g: number; b: number; a?: number },
  tolerance: number = 5,
  label: string = "",
): void {
  const prefix = label ? `[${label}] ` : "";
  const diffs = [
    Math.abs(pixel.r - expected.r),
    Math.abs(pixel.g - expected.g),
    Math.abs(pixel.b - expected.b),
  ];
  if (expected.a !== undefined) {
    diffs.push(Math.abs(pixel.a - expected.a));
  }
  const maxDiff = Math.max(...diffs);
  if (maxDiff > tolerance) {
    throw new Error(
      `${prefix}Pixel at (${pixel.x}, ${pixel.y}): expected RGBA(${expected.r}, ${expected.g}, ${expected.b}, ${expected.a ?? 255}) ` +
        `but got RGBA(${pixel.r}, ${pixel.g}, ${pixel.b}, ${pixel.a}) — max channel diff ${maxDiff} exceeds tolerance ${tolerance}`,
    );
  }
}

/**
 * Assert that a pixel does NOT match a forbidden colour (within tolerance).
 * Throws if the pixel is too close to the forbidden colour.
 */
export function assertPixelNotColor(
  pixel: PixelSample,
  notExpected: { r: number; g: number; b: number },
  tolerance: number = 5,
  label: string = "",
): void {
  const prefix = label ? `[${label}] ` : "";
  const diffs = [
    Math.abs(pixel.r - notExpected.r),
    Math.abs(pixel.g - notExpected.g),
    Math.abs(pixel.b - notExpected.b),
  ];
  const maxDiff = Math.max(...diffs);
  if (maxDiff <= tolerance) {
    throw new Error(
      `${prefix}Pixel at (${pixel.x}, ${pixel.y}) matches forbidden color ` +
        `RGBA(${notExpected.r}, ${notExpected.g}, ${notExpected.b}) within tolerance ${tolerance}`,
    );
  }
}

/**
 * Check whether a canvas has any non-transparent, non-black pixels.
 * Samples a grid of points across the canvas.
 */
export async function isCanvasNonBlank(
  page: Page,
  canvasTestId: string,
  sampleCount: number = 9,
): Promise<boolean> {
  return page.evaluate(
    ({ testId, samples }) => {
      const canvas = document.querySelector(
        `[data-testid="${testId}"]`,
      ) as HTMLCanvasElement;
      if (!canvas || canvas.width === 0 || canvas.height === 0) return false;
      const ctx = canvas.getContext("2d");
      if (!ctx) return false;
      const cols = Math.ceil(Math.sqrt(samples));
      const rows = cols;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = Math.floor(((c + 0.5) * canvas.width) / cols);
          const y = Math.floor(((r + 0.5) * canvas.height) / rows);
          const px = ctx.getImageData(x, y, 1, 1).data;
          if (px[0] !== 0 || px[1] !== 0 || px[2] !== 0 || px[3] !== 0) {
            return true;
          }
        }
      }
      return false;
    },
    { testId: canvasTestId, samples: sampleCount },
  );
}

/**
 * Compute a simple hash of all pixel data in a canvas region.
 * Useful for comparing whether two renders produce identical output.
 */
export async function hashCanvasRegion(
  page: Page,
  canvasTestId: string,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<number> {
  return page.evaluate(
    ({ testId, rx, ry, rw, rh }) => {
      const canvas = document.querySelector(
        `[data-testid="${testId}"]`,
      ) as HTMLCanvasElement;
      if (!canvas) throw new Error("Canvas not found");
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("No 2d context");
      const data = ctx.getImageData(rx, ry, rw, rh).data;
      let hash = 0;
      for (let i = 0; i < data.length; i++) {
        hash = ((hash << 5) - hash + data[i]) | 0;
      }
      return hash;
    },
    { testId: canvasTestId, rx: x, ry: y, rw: width, rh: height },
  );
}

/**
 * Count the number of pixels in a canvas region that exceed a brightness
 * threshold on any channel. Useful for verifying content presence.
 */
export async function countBrightPixels(
  page: Page,
  canvasTestId: string,
  threshold: number = 10,
): Promise<{ bright: number; total: number }> {
  return page.evaluate(
    ({ testId, thresh }) => {
      const canvas = document.querySelector(
        `[data-testid="${testId}"]`,
      ) as HTMLCanvasElement;
      if (!canvas) throw new Error("Canvas not found");
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("No 2d context");
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let bright = 0;
      const total = canvas.width * canvas.height;
      for (let i = 0; i < data.length; i += 4) {
        if (
          data[i] > thresh ||
          data[i + 1] > thresh ||
          data[i + 2] > thresh
        ) {
          bright++;
        }
      }
      return { bright, total };
    },
    { testId: canvasTestId, thresh: threshold },
  );
}

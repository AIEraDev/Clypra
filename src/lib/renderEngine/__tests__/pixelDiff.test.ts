/**
 * pixelDiff.test.ts
 *
 * Validates:
 * - Parity verification: Mean Squared Error (MSE), PSNR, and differing pixel count calculations
 * - Tolerance handling for sub-pixel anti-aliasing differences
 */

import { describe, it, expect } from "vitest";
import { computePixelDiff } from "../pixelDiff";

describe("Pixel Diff & Parity Analysis", () => {
  it("returns identical result for identical RGBA buffers", () => {
    const width = 4;
    const height = 4;
    const bufA = new Uint8Array(width * height * 4);
    const bufB = new Uint8Array(width * height * 4);

    // Fill with sample RGBA data
    for (let i = 0; i < bufA.length; i++) {
      bufA[i] = i % 256;
      bufB[i] = i % 256;
    }

    const result = computePixelDiff(bufA, bufB, width, height);

    expect(result.isIdentical).toBe(true);
    expect(result.meanSquaredError).toBe(0);
    expect(result.differingPixels).toBe(0);
    expect(result.psnr).toBe(Infinity);
  });

  it("accurately detects single pixel difference and computes MSE", () => {
    const width = 2;
    const height = 2;
    const totalPixels = 4;
    const bufA = new Uint8Array(totalPixels * 4);
    const bufB = new Uint8Array(totalPixels * 4);

    // Set 1 pixel (pixel 0) red channel to 255 in bufB while bufA is 0
    bufB[0] = 255;

    const result = computePixelDiff(bufA, bufB, width, height);

    expect(result.isIdentical).toBe(false);
    expect(result.differingPixels).toBe(1);
    expect(result.differingPercentage).toBe(25);
    // (1 / 4) normalized error for 1 channel in 1 pixel out of 4 pixels = 0.25 / 4 = 0.0625
    expect(result.meanSquaredError).toBeCloseTo(0.0625, 4);
    expect(result.psnr).toBeGreaterThan(0);
  });

  it("respects per-channel tolerance for subtle anti-aliasing variations", () => {
    const width = 2;
    const height = 2;
    const bufA = new Uint8Array(16);
    const bufB = new Uint8Array(16);

    // Subtle 2-value difference in color channels
    bufA.fill(128);
    bufB.fill(130);

    // With tolerance 0 -> differs
    const strictResult = computePixelDiff(bufA, bufB, width, height, { tolerance: 0 });
    expect(strictResult.isIdentical).toBe(false);
    expect(strictResult.differingPixels).toBe(4);

    // With tolerance 3 -> identical
    const tolerantResult = computePixelDiff(bufA, bufB, width, height, { tolerance: 3 });
    expect(tolerantResult.isIdentical).toBe(true);
    expect(tolerantResult.differingPixels).toBe(0);
  });

  it("throws descriptive error on buffer dimension mismatch", () => {
    const bufA = new Uint8Array(16);
    const bufB = new Uint8Array(12); // Wrong size

    expect(() => computePixelDiff(bufA, bufB, 2, 2)).toThrow("Buffer size mismatch");
  });
});

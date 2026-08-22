/**
 * pixelDiff.ts
 *
 * High-performance Pixel Diff & Parity Analysis for Native vs. Baseline Renderers.
 * Computes Mean Squared Error (MSE), Peak Signal-to-Noise Ratio (PSNR),
 * and differing pixel counts across RGBA8 byte buffers.
 */

export interface PixelDiffResult {
  /** Mean Squared Error across all color channels [0..1] */
  meanSquaredError: number;
  /** Peak Signal-to-Noise Ratio in dB (infinity if identical) */
  psnr: number;
  /** Total number of pixels that differ beyond channel tolerance */
  differingPixels: number;
  /** Total pixels compared */
  totalPixels: number;
  /** Percentage of differing pixels [0..100] */
  differingPercentage: number;
  /** True if buffers are identical within tolerance */
  isIdentical: boolean;
}

export interface PixelDiffOptions {
  /** Per-channel difference tolerance [0..255] (default: 0) */
  tolerance?: number;
}

/**
 * Compare two RGBA8 pixel buffers and return quantitative difference metrics.
 */
export function computePixelDiff(
  bufA: Uint8Array | Uint8ClampedArray,
  bufB: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  options: PixelDiffOptions = {}
): PixelDiffResult {
  const tolerance = options.tolerance ?? 0;
  const totalPixels = width * height;
  const expectedBytes = totalPixels * 4;

  if (bufA.length !== expectedBytes || bufB.length !== expectedBytes) {
    throw new Error(
      `Buffer size mismatch: expected ${expectedBytes} bytes (${width}x${height} RGBA), got bufA=${bufA.length} and bufB=${bufB.length}`
    );
  }

  let sumSquaredError = 0;
  let differingPixels = 0;

  for (let i = 0; i < expectedBytes; i += 4) {
    const dr = Math.abs(bufA[i] - bufB[i]);
    const dg = Math.abs(bufA[i + 1] - bufB[i + 1]);
    const db = Math.abs(bufA[i + 2] - bufB[i + 2]);
    const da = Math.abs(bufA[i + 3] - bufB[i + 3]);

    const isPixelDiffering =
      dr > tolerance || dg > tolerance || db > tolerance || da > tolerance;

    if (isPixelDiffering) {
      differingPixels++;
    }

    // Accumulate squared errors normalized to [0..1]
    const normDr = dr / 255;
    const normDg = dg / 255;
    const normDb = db / 255;
    const normDa = da / 255;

    sumSquaredError += (normDr * normDr + normDg * normDg + normDb * normDb + normDa * normDa) / 4;
  }

  const mse = totalPixels > 0 ? sumSquaredError / totalPixels : 0;
  const psnr = mse === 0 ? Infinity : 10 * Math.log10(1 / mse);
  const differingPercentage = totalPixels > 0 ? (differingPixels / totalPixels) * 100 : 0;

  return {
    meanSquaredError: mse,
    psnr,
    differingPixels,
    totalPixels,
    differingPercentage,
    isIdentical: differingPixels === 0,
  };
}

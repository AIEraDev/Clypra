import { describe, it, expect } from "vitest";
import {
  computeColorScopesVectorized,
  computeWaveformLodVectorized,
  isWasmSimdSupported,
  getVectorComputeTelemetrySnapshot,
  resetVectorComputeTelemetry,
} from "../vectorCompute";

describe("vectorCompute", () => {
  describe("computeColorScopesVectorized", () => {
    it("computes accurate histogram bins for pure solid color frame", () => {
      // 4 pixels of pure red: RGBA(255, 0, 0, 255)
      const width = 2;
      const height = 2;
      const rgba = new Uint8ClampedArray([
        255, 0, 0, 255,
        255, 0, 0, 255,
        255, 0, 0, 255,
        255, 0, 0, 255,
      ]);

      const result = computeColorScopesVectorized(rgba, width, height, {
        needHistogram: true,
      });

      expect(result.histogram).toBeDefined();
      expect(result.histogram!.r[255]).toBe(4);
      expect(result.histogram!.g[0]).toBe(4);
      expect(result.histogram!.b[0]).toBe(4);

      // BT.709 Luma for pure red: 0.2126 * 255 = ~54.2
      // Fixed point: (54 * 255) >> 8 = 53
      const expectedLuma = (54 * 255) >> 8;
      expect(result.histogram!.luma[expectedLuma]).toBe(4);
    });

    it("handles non-multiple of 4 dimensions cleanly with remainder loop", () => {
      // 5x3 = 15 pixels (not a multiple of 4)
      const width = 5;
      const height = 3;
      const rgba = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < rgba.length; i += 4) {
        rgba[i] = 100;     // R
        rgba[i + 1] = 150; // G
        rgba[i + 2] = 200; // B
        rgba[i + 3] = 255; // A
      }

      const result = computeColorScopesVectorized(rgba, width, height, {
        needHistogram: true,
        needVectorscope: true,
        needParade: true,
      });

      expect(result.histogram!.r[100]).toBe(15);
      expect(result.histogram!.g[150]).toBe(15);
      expect(result.histogram!.b[200]).toBe(15);

      expect(result.vectorscope).toBeDefined();
      expect(result.vectorscope!.length).toBe(15 * 3);

      expect(result.parade).toBeDefined();
      expect(result.parade!.length).toBe(15 * 3);
      expect(result.parade![0]).toBe(100);
      expect(result.parade![1]).toBe(150);
      expect(result.parade![2]).toBe(200);
    });

    it("computes vectorscope UV coordinates accurately", () => {
      const width = 1;
      const height = 1;
      // White: RGBA(255, 255, 255, 255) -> Neutral center (U=0, V=0)
      const rgba = new Uint8ClampedArray([255, 255, 255, 255]);

      const result = computeColorScopesVectorized(rgba, width, height, {
        needVectorscope: true,
      });

      const u = result.vectorscope![0];
      const v = result.vectorscope![1];
      const alpha = result.vectorscope![2];

      // White should map close to center (0, 0)
      expect(Math.abs(u)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(v)).toBeLessThanOrEqual(0.01);
      expect(alpha).toBe(1.0);
    });
  });

  describe("computeWaveformLodVectorized", () => {
    it("computes exact peak and RMS across standard buckets", () => {
      // 16 samples: two buckets of 8 samples each
      const monoPcm = new Float32Array([
        0.5, -0.5, 0.5, -0.5, 0.5, -0.5, 0.5, -0.5, // bucket 0: all 0.5, peak=0.5, RMS=0.5
        0.8, -0.2, 0.1, -0.1, 0.0,  0.0, 0.0,  0.0, // bucket 1: max=0.8
      ]);

      const lod = computeWaveformLodVectorized(monoPcm, 8);
      expect(lod.step).toBe(8);
      expect(lod.peaks.length).toBe(2);
      expect(lod.rms.length).toBe(2);

      // Bucket 0
      expect(lod.peaks[0]).toBeCloseTo(0.5, 5);
      expect(lod.rms[0]).toBeCloseTo(0.5, 5);

      // Bucket 1: peak is 0.8
      expect(lod.peaks[1]).toBeCloseTo(0.8, 5);
      // RMS: sqrt((0.64 + 0.04 + 0.01 + 0.01) / 8) = sqrt(0.70 / 8) = sqrt(0.0875) = ~0.2958
      const expectedRms = Math.sqrt((0.8 * 0.8 + 0.2 * 0.2 + 0.1 * 0.1 + 0.1 * 0.1) / 8);
      expect(lod.rms[1]).toBeCloseTo(expectedRms, 4);
    });

    it("handles non-multiple of 8 sample count with remainder pass", () => {
      // 11 samples, step 11 (1 bucket of 11 items, 8 unrolled + 3 remainder)
      const monoPcm = new Float32Array([
        0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, // 8 items
        0.9, 0.2, 0.3,                          // 3 remainder items
      ]);

      const lod = computeWaveformLodVectorized(monoPcm, 11);
      expect(lod.peaks.length).toBe(1);
      expect(lod.peaks[0]).toBeCloseTo(0.9, 5);
    });

    it("clamps peaks above 1.0", () => {
      const monoPcm = new Float32Array([1.5, -2.0, 0.5]);
      const lod = computeWaveformLodVectorized(monoPcm, 3);
      expect(lod.peaks[0]).toBe(1.0);
    });
  });

  describe("isWasmSimdSupported", () => {
    it("runs feature probe without throwing", () => {
      const supported = isWasmSimdSupported();
      expect(typeof supported).toBe("boolean");
    });
  });

  describe("vectorCompute telemetry", () => {
    it("tracks calls and compute throughput", () => {
      resetVectorComputeTelemetry();

      const rgba = new Uint8ClampedArray(4 * 4 * 4); // 16 pixels
      computeColorScopesVectorized(rgba, 4, 4, { needHistogram: true });

      const pcm = new Float32Array(64);
      computeWaveformLodVectorized(pcm, 8);

      const snap = getVectorComputeTelemetrySnapshot();
      expect(snap.colorScopesCalls).toBe(1);
      expect(snap.colorScopesTotalPixels).toBe(16);
      expect(snap.waveformCalls).toBe(1);
      expect(snap.waveformTotalSamples).toBe(64);
      expect(snap.avgColorScopesMpixPerSec).toBeGreaterThanOrEqual(0);
      expect(snap.avgWaveformMsamplesPerSec).toBeGreaterThanOrEqual(0);
    });
  });
});

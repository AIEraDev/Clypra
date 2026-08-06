import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";
import { drawRoundedRect, hexToRgb, drawProfessionalWaveform, convertLegacyWaveform } from "../canvasUtils";

describe("canvasUtils Generative & Edge Case Invariants", () => {
  describe("hexToRgb", () => {
    it("parses 6-digit hex colors correctly", () => {
      expect(hexToRgb("#ff0000")).toEqual({ r: 255, g: 0, b: 0 });
      expect(hexToRgb("00ff00")).toEqual({ r: 0, g: 255, b: 0 });
    });

    it("parses 3-digit shorthand hex colors correctly", () => {
      expect(hexToRgb("#fff")).toEqual({ r: 255, g: 255, b: 255 });
      expect(hexToRgb("f00")).toEqual({ r: 255, g: 0, b: 0 });
    });

    it("returns null for invalid hex strings", () => {
      expect(hexToRgb("invalid")).toBeNull();
      expect(hexToRgb("#12345")).toBeNull();
      expect(hexToRgb("")).toBeNull();
    });

    it("property test: hexToRgb never throws and returns valid 0..255 RGB values when non-null", () => {
      fc.assert(
        fc.property(fc.string(), (hex) => {
          const res = hexToRgb(hex);
          if (res !== null) {
            expect(res.r).toBeGreaterThanOrEqual(0);
            expect(res.r).toBeLessThanOrEqual(255);
            expect(res.g).toBeGreaterThanOrEqual(0);
            expect(res.g).toBeLessThanOrEqual(255);
            expect(res.b).toBeGreaterThanOrEqual(0);
            expect(res.b).toBeLessThanOrEqual(255);
          }
        })
      );
    });
  });

  describe("drawRoundedRect & drawProfessionalWaveform", () => {
    it("safely handles empty buckets array without divide-by-zero errors", () => {
      const mockCtx = {
        clearRect: vi.fn(),
        fillRect: vi.fn(),
      };
      const mockCanvas = {
        getContext: () => mockCtx,
        width: 100,
        height: 50,
      } as unknown as HTMLCanvasElement;

      drawProfessionalWaveform(mockCanvas, [], "#ffffff");
      expect(mockCtx.fillRect).not.toHaveBeenCalled();
    });

    it("converts legacy RMS-only numbers array to peak/rms objects", () => {
      const legacy = [0.1, 0.5, 0.9];
      const converted = convertLegacyWaveform(legacy);
      expect(converted).toHaveLength(3);
      expect(converted[0]).toEqual({ peak: 0.1, rms: 0.1 });
    });
  });
});

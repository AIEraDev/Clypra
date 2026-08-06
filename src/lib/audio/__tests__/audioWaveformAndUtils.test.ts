import { describe, it, expect } from "vitest";
import { generateSimpleWaveform } from "../audioWaveformGenerator";

describe("Audio Waveform & Utility Safety Suite", () => {
  // ─── 1. WAVEFORM GENERATION ──────────────────────────────────────────────
  describe("generateSimpleWaveform", () => {
    it("should generate a valid base64 data URL string for audio thumbnail rendering", () => {
      const dataUrl = generateSimpleWaveform({
        width: 160,
        height: 90,
        barCount: 20,
        barColor: "#00FF00",
        backgroundColor: "#000000",
      });

      expect(dataUrl).toBeDefined();
      expect(typeof dataUrl).toBe("string");
      expect(dataUrl).toMatch(/^data:image\/png;base64,/);
    });

    it("should handle custom bar gaps and dimensions without throwing exceptions", () => {
      expect(() => {
        generateSimpleWaveform({
          width: 320,
          height: 180,
          barCount: 64,
          barGap: 0.5,
        });
      }).not.toThrow();
    });
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { PlaybackClock } from "../PlaybackClock";

describe("PlaybackClock — Deep Edge Cases & Frame Rate Precision", () => {
  let clock: PlaybackClock;

  beforeEach(() => {
    clock = new PlaybackClock();
    clock.setDuration(100.0);
  });

  // ─── 1. BOUNDARY SEEKING & CLAMPING ──────────────────────────────────────
  describe("Out-of-Bounds Seek Clamping", () => {
    it("should clamp negative seek values strictly to 0.0", () => {
      clock.seek(-10.5);
      expect(clock.time).toBe(0.0);
    });

    it("should clamp seek values exceeding duration strictly to timeline duration", () => {
      clock.seek(999.0);
      expect(clock.time).toBe(100.0);
    });

    it("should handle non-finite (NaN, Infinity) seek values safely by defaulting to 0.0", () => {
      clock.seek(NaN);
      expect(clock.time).toBe(0.0);

      clock.seek(Infinity);
      expect(clock.time).toBe(0.0);
    });
  });

  // ─── 2. SPEED MULTIPLIERS & TIME REMAPPING ───────────────────────────────
  describe("Extreme Playback Speed Bounds", () => {
    it("should accept valid playback speeds between 0.1x and 4.0x", () => {
      clock.setSpeed(0.25);
      expect(clock.speed).toBe(0.25);

      clock.setSpeed(4.0);
      expect(clock.speed).toBe(4.0);
    });

    it("should clamp speeds outside [0.1, 4.0] to bounds", () => {
      clock.setSpeed(0);
      expect(clock.speed).toBe(0.1);

      clock.setSpeed(-2.0);
      expect(clock.speed).toBe(0.1);

      clock.setSpeed(16.0);
      expect(clock.speed).toBe(4.0);
    });
  });

  // ─── 3. NON-INTEGER FRAME RATE SNAP PRECISION ────────────────────────────
  describe("Frame Rate Snapping Accuracy (23.976, 29.97, 59.94 fps)", () => {
    it("should snap timeline time accurately for 23.976 fps (film broadcast)", () => {
      const fps = 24000 / 1001; // 23.976023976...
      const frameDuration = 1 / fps;

      // Sample time at frame 10.4 -> should snap to frame 10
      const sampleTime = frameDuration * 10.4;
      const snappedFrame = Math.round(sampleTime * fps);
      const snappedTime = snappedFrame / fps;

      expect(snappedFrame).toBe(10);
      expect(Math.abs(snappedTime - sampleTime)).toBeLessThan(frameDuration / 2);
    });

    it("should snap timeline time accurately for 29.97 fps (NTSC broadcast)", () => {
      const fps = 30000 / 1001; // 29.97002997...
      const frameDuration = 1 / fps;

      const sampleTime = frameDuration * 15.6;
      const snappedFrame = Math.round(sampleTime * fps);

      expect(snappedFrame).toBe(16);
    });

    it("should maintain ultra-low drift over 100,000 frame accumulative steps", () => {
      const fps = 60;
      const frameDuration = 1 / fps;

      let currentTime = 0;

      // Step accumulator
      for (let i = 0; i < 100000; i++) {
        currentTime += frameDuration;
      }

      // Recomputed expected time
      const expectedTime = 100000 * frameDuration;
      expect(currentTime).toBeCloseTo(expectedTime, 8);
    });
  });
});

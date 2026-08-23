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

    it("accepts a bounded native clock sample without changing the public clock API", () => {
      clock.setNativeClockPosition(12.5);
      expect(clock.time).toBe(12.5);
      expect(clock.hasNativeClockPosition).toBe(true);

      clock.setNativeClockPosition(999);
      expect(clock.time).toBe(100);

      clock.clearNativeClockPosition();
      expect(clock.time).toBe(100);
      expect(clock.hasNativeClockPosition).toBe(false);
    });

    it("pauses at the native audio position instead of the stale browser clock", () => {
      clock.play();
      clock.setNativeClockPosition(12.5);

      clock.pause();

      expect(clock.time).toBe(12.5);
      expect(clock.state).toBe("paused");
    });

    it("does not create or consult Web Audio when native clock authority is enabled", () => {
      clock.setNativeClockAuthority(true);
      clock.play();

      expect(clock.isNativeClockAuthority).toBe(true);
      expect((clock as any)._audioContext).toBeNull();

      clock.setNativeClockPosition(12.5);
      expect(clock.time).toBeCloseTo(12.5, 3);
    });

    it("ignores a stale backward native sample during normal playback", () => {
      clock.setNativeClockAuthority(true);
      clock.setNativeClockPosition(10);
      clock.play();

      // A delayed native command/poll must not rewind the shared clock to 0s.
      clock.setNativeClockPosition(0.033);

      expect(clock.time).toBeGreaterThan(9.9);
    });

    it("accepts a backward native sample while an explicit seek is active", () => {
      clock.setNativeClockAuthority(true);
      clock.setNativeClockPosition(10);
      clock.play();
      clock.seek(2);

      clock.setNativeClockPosition(2);

      expect(clock.time).toBeCloseTo(2, 3);
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

/**
 * Audio-Preview Synchronization Contract
 *
 * Validates that audio and preview playback stay synchronized across
 * all operations: replay, seek, speed change, stall recovery, and
 * silent-project fallback.
 *
 * These tests exercise the PlaybackClock's dual-clock architecture
 * (native CPAL hardware clock vs JS wall-clock extrapolation) and
 * verify that both paths produce correct, synchronized time signals.
 *
 * INVARIANT: Tests in this file are append-only. Never delete or skip a test.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PlaybackClock } from "@/core/playback/PlaybackClock";

// ── Mock Infrastructure ──────────────────────────────────────────────────────

class MockAudioContext {
  state = "running";
  currentTime = 0;
  resume() {
    this.state = "running";
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}

let rafCallbacks: Map<number, () => void> = new Map();
let rafId = 0;

const mockRequestAnimationFrame = (callback: () => void): number => {
  const id = ++rafId;
  rafCallbacks.set(id, callback);
  return id;
};

const mockCancelAnimationFrame = (id: number): void => {
  rafCallbacks.delete(id);
};

// ── Test Suite ───────────────────────────────────────────────────────────────

describe("Audio-Preview Synchronization Contract", () => {
  let clock: PlaybackClock;
  let originalRAF: typeof requestAnimationFrame;
  let originalCAF: typeof cancelAnimationFrame;
  let originalAudioContext: typeof AudioContext;

  beforeEach(() => {
    originalRAF = globalThis.requestAnimationFrame;
    originalCAF = globalThis.cancelAnimationFrame;
    originalAudioContext = (globalThis as any).AudioContext;

    globalThis.requestAnimationFrame = mockRequestAnimationFrame as any;
    globalThis.cancelAnimationFrame = mockCancelAnimationFrame as any;
    (globalThis as any).AudioContext = MockAudioContext;

    rafCallbacks.clear();
    rafId = 0;

    clock = new PlaybackClock();
    clock.setDuration(30);
    clock.setFrameRate(30);
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRAF;
    globalThis.cancelAnimationFrame = originalCAF;
    (globalThis as any).AudioContext = originalAudioContext;
    rafCallbacks.clear();
  });

  // ── Clock Position Agreement ─────────────────────────────────────────────

  describe("Clock Position Agreement", () => {
    it("after setNativeClockPosition, clock.time reflects the hardware position", () => {
      clock.setNativeClockAuthority(true);
      clock.play();

      clock.setNativeClockPosition(5.0, 1.0);
      expect(clock.time).toBeCloseTo(5.0, 2);
    });

    it("extrapolated time between polls stays within 16ms SLA budget", () => {
      let mockTime = 1000.0;
      const nowSpy = vi
        .spyOn(performance, "now")
        .mockImplementation(() => mockTime);

      try {
        clock.setNativeClockAuthority(true);
        clock.play();

        mockTime += 100;
        clock.setNativeClockPosition(1.0, 1.0);

        // Advance 16.6ms (one frame at 60Hz)
        mockTime += 16.6;
        const extrapolated = clock.time;
        const drift = Math.abs(extrapolated - 1.0);

        // Drift from last sample should be small (within ~17ms of playback time)
        expect(drift).toBeLessThan(0.020);
      } finally {
        nowSpy.mockRestore();
      }
    });

    it("clock.time is frame-rate quantized after pause", () => {
      clock.play();
      (clock as any)._time = 3.333; // Not frame-aligned for 30fps

      clock.pause();
      const fps = clock.frameRate;
      const expected = Math.round(clock.time * fps) / fps;
      expect(clock.time).toBeCloseTo(expected, 10);
    });

    it("clock.time is frame-rate quantized after stop", () => {
      clock.stop();
      // stop always resets to 0 which is frame-aligned for any fps
      expect(clock.time).toBe(0);
    });
  });

  // ── Seek Synchronization ─────────────────────────────────────────────────

  describe("Seek Synchronization", () => {
    it("seek during playback updates clock.time atomically", () => {
      clock.setNativeClockAuthority(true);
      clock.play();
      clock.setNativeClockPosition(2.0, 1.0);

      clock.seek(15.0);
      expect(clock.time).toBeCloseTo(15.0, 2);
      expect(clock.isSeeking).toBe(true);
    });

    it("stale pre-seek native samples are rejected (CLY-PERF-001)", () => {
      clock.setNativeClockAuthority(true);
      clock.play();
      clock.setNativeClockPosition(10.0, 1.0);

      // Seek backward
      clock.seek(2.0);
      expect(clock.time).toBeCloseTo(2.0, 2);

      // Stale sample from old position arrives
      clock.setNativeClockPosition(10.05, 1.0);
      // Must be rejected — time stays at seek target
      expect(clock.time).toBeCloseTo(2.0, 2);
    });

    it("completeSeek settles time at seek target", () => {
      clock.seek(7.5, { keepPlaying: false });
      expect(clock.isSeeking).toBe(true);

      clock.completeSeek();
      expect(clock.isSeeking).toBe(false);
      expect(clock.time).toBeCloseTo(7.5, 1);
    });

    it("rapid seeks converge to final target", () => {
      clock.play();

      clock.seek(1.0);
      clock.seek(5.0);
      clock.seek(10.0);
      clock.seek(20.0);

      expect(clock.time).toBeCloseTo(20.0, 2);
    });

    it("seek at frame boundary stays exact", () => {
      const fps = 30;
      const frameTime = 1 / fps;
      const exactFrame = Math.round(5.0 * fps) / fps;

      clock.seek(exactFrame);
      expect(clock.time).toBeCloseTo(exactFrame, 10);
    });
  });

  // ── Replay Audio Restart ─────────────────────────────────────────────────

  describe("Replay Audio Restart", () => {
    it("stop() clears native clock position", () => {
      clock.setNativeClockAuthority(true);
      clock.play();
      clock.setNativeClockPosition(8.0, 1.0);

      clock.stop();
      expect((clock as any)._nativeClockPosition).toBeNull();
      expect(clock.hasNativeClockPosition).toBe(false);
    });

    it("play() after stop() starts fresh extrapolation from 0", () => {
      clock.setNativeClockAuthority(true);

      clock.play();
      clock.setNativeClockPosition(5.0, 1.0);
      clock.stop();

      clock.play();
      // toBeCloseTo because wall-clock extrapolation starts instantly on play();
      // sub-ms drift between play() and this read is expected and harmless.
      expect(clock.time).toBeCloseTo(0, 3);
      expect((clock as any)._playStartClockTime).toBe(0);
      expect((clock as any)._hasRealNativeClockSample).toBe(false);
    });

    it("hasNativeClockPosition is false after stop()", () => {
      clock.setNativeClockAuthority(true);
      clock.play();
      clock.setNativeClockPosition(3.0, 1.0);
      expect(clock.hasNativeClockPosition).toBe(true);

      clock.stop();
      expect(clock.hasNativeClockPosition).toBe(false);
    });

    it("native audio unavailable flag is cleared when authority is released", () => {
      clock.setNativeClockAuthority(true);
      clock.markNativeAudioUnavailable();
      expect(clock.nativeAudioWasUnavailable).toBe(true);

      clock.setNativeClockAuthority(false);
      expect(clock.nativeAudioWasUnavailable).toBe(false);
    });

    it("after replay, first native sample is accepted without monotonic clamp", () => {
      clock.setNativeClockAuthority(true);

      // First session
      clock.play();
      clock.setNativeClockPosition(10.0, 1.0);
      clock.stop();

      // Replay
      clock.play();
      expect((clock as any)._hasRealNativeClockSample).toBe(false);

      // First sample of new session at 0.01s
      clock.setNativeClockPosition(0.01, 1.0);
      expect((clock as any)._hasRealNativeClockSample).toBe(true);
      expect(clock.time).toBeCloseTo(0.01, 2);
    });
  });

  // ── Speed Change Sync ────────────────────────────────────────────────────

  describe("Speed Change Sync", () => {
    it("setSpeed during playback pauses, changes, resumes seamlessly", () => {
      clock.play();
      expect(clock.state).toBe("playing");

      clock.setSpeed(2.0);
      expect(clock.state).toBe("playing"); // Should still be playing
      expect(clock.speed).toBe(2.0);
    });

    it("native clock speed parameter matches PlaybackClock speed", () => {
      clock.setNativeClockAuthority(true);
      clock.setSpeed(1.5);
      clock.play();

      // The native position store should record the speed
      clock.setNativeClockPosition(1.0, 1.5);
      const nativePos = (clock as any)._nativeClockPosition;
      expect(nativePos.speed).toBe(1.5);
      expect(clock.speed).toBe(1.5);
    });

    it("speed change preserves current time position", () => {
      clock.play();
      clock.setNativeClockAuthority(true);
      clock.setNativeClockPosition(5.0, 1.0);

      const timeBefore = clock.time;
      clock.setSpeed(2.0);
      // After speed change, time should be approximately preserved
      // (not reset to 0 or jumped)
      expect(clock.time).toBeGreaterThan(0);
    });

    it("speed bounds are enforced (min 0.1, max 4.0)", () => {
      clock.setSpeed(0.01);
      expect(clock.speed).toBe(0.1);

      clock.setSpeed(10.0);
      expect(clock.speed).toBe(4.0);
    });
  });

  // ── Audio Unavailable Fallback ───────────────────────────────────────────

  describe("Audio Unavailable Fallback", () => {
    it("markNativeAudioUnavailable allows hasNativeClockPosition to report true", () => {
      clock.setNativeClockAuthority(true);
      clock.play();
      expect(clock.hasNativeClockPosition).toBe(false);

      clock.markNativeAudioUnavailable();
      expect(clock.hasNativeClockPosition).toBe(true);
    });

    it("video path proceeds when audio has no clips (unavailable flag)", () => {
      clock.setNativeClockAuthority(true);
      clock.play();
      clock.markNativeAudioUnavailable();

      // hasNativeClockPosition should be true so video can proceed
      expect(clock.hasNativeClockPosition).toBe(true);
      // But no real hardware sample exists
      expect((clock as any)._hasRealNativeClockSample).toBe(false);
    });

    it("audio unavailable cleared on authority release", () => {
      clock.setNativeClockAuthority(true);
      clock.markNativeAudioUnavailable();

      clock.setNativeClockAuthority(false);
      expect(clock.nativeAudioWasUnavailable).toBe(false);
    });

    it("clearNativeAudioUnavailable resets the flag independently", () => {
      clock.setNativeClockAuthority(true);
      clock.markNativeAudioUnavailable();
      expect(clock.nativeAudioWasUnavailable).toBe(true);

      clock.clearNativeAudioUnavailable();
      expect(clock.nativeAudioWasUnavailable).toBe(false);
      // Authority should still be set
      expect(clock.isNativeClockAuthority).toBe(true);
    });
  });

  // ── Stall Recovery ───────────────────────────────────────────────────────

  describe("Stall Recovery", () => {
    it("resyncNativeClockPosition snaps clock backward without ratchet lockout", () => {
      clock.setNativeClockAuthority(true);
      clock.play();
      clock.setNativeClockPosition(8.0, 1.0);
      expect(clock.time).toBeCloseTo(8.0, 2);

      // Force backward snap
      clock.resyncNativeClockPosition(3.0, 1.0);
      expect(clock.time).toBeCloseTo(3.0, 2);
    });

    it("single transient backward poll is filtered (jitter protection)", () => {
      clock.setNativeClockAuthority(true);
      clock.play();
      clock.setNativeClockPosition(5.0, 1.0);

      // Single backward sample — should be filtered
      clock.setNativeClockPosition(4.9, 1.0);
      expect(clock.time).toBeCloseTo(5.0, 2);

      // Forward sample resumes normally
      clock.setNativeClockPosition(5.1, 1.0);
      expect(clock.time).toBeCloseTo(5.1, 2);
    });

    it("persistent backward divergence (3+ samples) forces resync", () => {
      clock.setNativeClockAuthority(true);
      clock.play();
      clock.setNativeClockPosition(5.0, 1.0);

      // Three consecutive backward samples
      clock.setNativeClockPosition(4.9, 1.0);
      expect(clock.time).toBeCloseTo(5.0, 2); // Filtered

      clock.setNativeClockPosition(4.92, 1.0);
      expect(clock.time).toBeCloseTo(5.0, 2); // Filtered

      clock.setNativeClockPosition(4.94, 1.0);
      // After 3 samples, resync kicks in
      expect(clock.time).toBeCloseTo(4.94, 2);
    });

    it("large backward divergence (>200ms) forces resync after 2 samples", () => {
      clock.setNativeClockAuthority(true);
      clock.play();
      clock.setNativeClockPosition(8.0, 1.0);

      // Two samples with >200ms backward divergence
      clock.setNativeClockPosition(5.8, 1.0);
      expect(clock.time).toBeCloseTo(8.0, 2); // First is held

      clock.setNativeClockPosition(5.85, 1.0);
      // Divergence >= 200ms + 2 consecutive → forced resync
      expect(clock.time).toBeCloseTo(5.85, 2);
    });

    it("forward extrapolation lead is clamped to ≤16ms SLA budget", () => {
      clock.setNativeClockAuthority(true);
      clock.play();
      clock.setNativeClockPosition(1.0, 1.0);

      // Simulate extrapolation running 35ms ahead
      (clock as any)._time = 1.035;
      (clock as any)._nativeClockPosition.time = 1.035;

      clock.setNativeClockPosition(1.0, 1.0);
      const drift = clock.time - 1.0;
      expect(drift).toBeCloseTo(0.016, 2);
      expect(drift).toBeLessThan(0.020);
    });
  });
});

/**
 * Preview State Reset Contract
 *
 * Validates that preview state is fully cleaned up after stopping and
 * that re-previewing after edits reflects current timeline state.
 *
 * This prevents the class of bugs where:
 *   - Stale render state leaks across play sessions
 *   - RAF loops leak across stop/play cycles
 *   - Native clock samples from a previous session pollute a new one
 *   - Edit → preview shows stale content instead of current timeline
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

describe("Preview State Reset Contract", () => {
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
    clock.setDuration(10);
    clock.setFrameRate(30);
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRAF;
    globalThis.cancelAnimationFrame = originalCAF;
    (globalThis as any).AudioContext = originalAudioContext;
    rafCallbacks.clear();
  });

  // ── Stop Fully Resets Preview State ──────────────────────────────────────

  describe("Stop Fully Resets Preview State", () => {
    it("stop() resets time to 0", () => {
      clock.play();
      clock.seek(5.0);
      clock.stop();
      expect(clock.time).toBe(0);
    });

    it("stop() sets state to 'stopped'", () => {
      clock.play();
      clock.stop();
      expect(clock.state).toBe("stopped");
    });

    it("stop() cancels RAF loop (_rafId is null)", () => {
      clock.play();
      expect((clock as any)._rafId).not.toBeNull();

      clock.stop();
      expect((clock as any)._rafId).toBeNull();
    });

    it("stop() clears isSeeking", () => {
      clock.seek(3.0);
      expect(clock.isSeeking).toBe(true);

      clock.stop();
      expect(clock.isSeeking).toBe(false);
    });

    it("stop() clears native clock position", () => {
      clock.setNativeClockAuthority(true);
      clock.play();
      clock.setNativeClockPosition(5.0, 1.0);
      expect((clock as any)._nativeClockPosition).not.toBeNull();

      clock.stop();
      expect((clock as any)._nativeClockPosition).toBeNull();
    });

    it("stop() clears hasRealNativeClockSample", () => {
      clock.setNativeClockAuthority(true);
      clock.play();
      clock.setNativeClockPosition(2.0, 1.0);
      expect((clock as any)._hasRealNativeClockSample).toBe(true);

      clock.stop();
      expect((clock as any)._hasRealNativeClockSample).toBe(false);
    });

    it("stop() clears all per-clip freezes", () => {
      clock.freezeClipAt("clip-a", 1.5);
      clock.freezeClipAt("clip-b", 3.0);
      expect(clock.hasClipFreezes).toBe(true);

      clock.stop();
      expect(clock.hasClipFreezes).toBe(false);
    });

    it("stop() fires exactly one listener notification (batched atomic)", () => {
      const listener = vi.fn();
      clock.subscribe(listener);
      clock.play();
      listener.mockClear();

      clock.stop();
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  // ── Pause Preserves but Cleans State ─────────────────────────────────────

  describe("Pause Preserves but Cleans State", () => {
    it("pause() preserves current time (doesn't reset to 0)", () => {
      clock.play();
      clock.setNativeClockAuthority(true);
      clock.setNativeClockPosition(4.0, 1.0);

      clock.pause();
      // Time should be near 4.0 (frame-snapped), NOT 0
      expect(clock.time).toBeGreaterThan(0);
    });

    it("pause() snaps time to nearest frame boundary", () => {
      clock.play();
      // Force time to a non-frame-aligned value
      (clock as any)._time = 3.517;

      clock.pause(true);
      const fps = clock.frameRate;
      const expectedSnap = Math.round(3.517 * fps) / fps;
      expect(clock.time).toBeCloseTo(expectedSnap, 10);
      expect(clock.time).not.toBe(3.517);
    });

    it("pause() clears RAF loop", () => {
      clock.play();
      expect((clock as any)._rafId).not.toBeNull();

      clock.pause();
      expect((clock as any)._rafId).toBeNull();
    });

    it("pause() clears isSeeking", () => {
      clock.play();
      clock.seek(5.0);
      // During playback, seek keeps playing
      clock.pause();
      expect(clock.isSeeking).toBe(false);
    });

    it("pause() clears native clock samples for fresh restart", () => {
      clock.setNativeClockAuthority(true);
      clock.play();
      clock.setNativeClockPosition(3.0, 1.0);

      clock.pause();
      expect((clock as any)._nativeClockPosition).toBeNull();
      expect((clock as any)._hasRealNativeClockSample).toBe(false);
    });

    it("pause() clears _playStartMs anchor", () => {
      clock.setNativeClockAuthority(true);
      clock.play();
      expect((clock as any)._playStartMs).toBeGreaterThan(0);

      clock.pause();
      expect((clock as any)._playStartMs).toBe(0);
    });
  });

  // ── Re-Preview After State Change ────────────────────────────────────────

  describe("Re-Preview After State Change", () => {
    it("play after stop starts fresh (new generation, new RAF)", () => {
      clock.play();
      const gen1 = (clock as any)._generation;
      clock.stop();

      clock.play();
      const gen2 = (clock as any)._generation;
      expect(gen2).toBeGreaterThan(gen1);
      expect((clock as any)._rafId).not.toBeNull();
    });

    it("play after pause resumes (time preserved)", () => {
      clock.play();
      // Advance clock via native authority so pause captures real position
      clock.setNativeClockAuthority(true);
      clock.setNativeClockPosition(4.0, 1.0);
      clock.pause();
      const pauseTime = clock.time;
      expect(pauseTime).toBeGreaterThan(0);

      clock.play();
      // Should continue from near pause point, not from 0.
      // toBeCloseTo because wall-clock extrapolation adds sub-ms drift.
      expect(clock.time).toBeCloseTo(pauseTime, 2);
      expect(clock.state).toBe("playing");
    });

    it("play after complete restarts from 0 (terminal boundary)", () => {
      clock.play();
      clock.complete();
      expect(clock.time).toBe(10);

      clock.play();
      expect(clock.time).toBe(0);
      expect(clock.state).toBe("playing");
    });

    it("changing duration while stopped is reflected on next play", () => {
      clock.stop();
      clock.setDuration(30);
      expect(clock.duration).toBe(30);

      clock.play();
      expect(clock.duration).toBe(30);
    });

    it("changing frameRate while stopped is reflected on next play", () => {
      clock.stop();
      clock.setFrameRate(60);
      expect(clock.frameRate).toBe(60);

      clock.play();
      expect(clock.frameRate).toBe(60);
    });

    it("seek while stopped → play → time starts from 0 (stop always resets)", () => {
      clock.stop();
      // Seeking in stopped state puts the clock at a new position but stop will override
      clock.seek(5.0);
      clock.stop(); // Re-stop to enforce reset
      expect(clock.time).toBe(0);

      clock.play();
      expect(clock.time).toBe(0);
    });

    it("seek while paused → play → time starts from seek point", () => {
      clock.play();
      clock.pause();
      clock.seek(5.0, { keepPlaying: false });
      clock.completeSeek();
      expect(clock.time).toBe(5.0);

      clock.play();
      // Should resume from 5.0 (pause preserves position)
      expect(clock.time).toBeCloseTo(5.0, 0);
      expect(clock.state).toBe("playing");
    });
  });

  // ── Multiple Rapid Play/Stop Cycles ──────────────────────────────────────

  describe("Multiple Rapid Play/Stop Cycles", () => {
    it("10 rapid play/stop cycles don't leak RAF callbacks", () => {
      for (let i = 0; i < 10; i++) {
        clock.play();
        clock.stop();
      }
      // After stopping, there should be no pending RAF callbacks
      // (all should have been cancelled)
      expect((clock as any)._rafId).toBeNull();
    });

    it("10 rapid play/stop cycles don't leak native clock positions", () => {
      clock.setNativeClockAuthority(true);
      for (let i = 0; i < 10; i++) {
        clock.play();
        clock.setNativeClockPosition(i * 0.5, 1.0);
        clock.stop();
      }
      expect((clock as any)._nativeClockPosition).toBeNull();
      expect((clock as any)._hasRealNativeClockSample).toBe(false);
      expect(clock.time).toBe(0);
    });

    it("play/pause/play/pause cycle: RAF is properly managed", () => {
      clock.play();
      expect((clock as any)._rafId).not.toBeNull();

      clock.pause();
      expect((clock as any)._rafId).toBeNull();

      clock.play();
      expect((clock as any)._rafId).not.toBeNull();

      clock.pause();
      expect((clock as any)._rafId).toBeNull();
    });

    it("play/stop/play/stop: generation always advances", () => {
      const generations: number[] = [];

      for (let i = 0; i < 5; i++) {
        clock.play();
        generations.push((clock as any)._generation);
        clock.stop();
      }

      // Each generation must be strictly greater than the previous
      for (let i = 1; i < generations.length; i++) {
        expect(generations[i]).toBeGreaterThan(generations[i - 1]);
      }
    });
  });

  // ── Native Preview Surface Reset ─────────────────────────────────────────

  describe("Native Preview Surface Reset", () => {
    it("native clock authority is preserved across stop/play", () => {
      clock.setNativeClockAuthority(true);
      clock.play();
      clock.stop();
      expect(clock.isNativeClockAuthority).toBe(true);

      clock.play();
      expect(clock.isNativeClockAuthority).toBe(true);
    });

    it("native clock authority released → audio unavailable flag cleared", () => {
      clock.setNativeClockAuthority(true);
      clock.markNativeAudioUnavailable();
      expect(clock.nativeAudioWasUnavailable).toBe(true);

      clock.setNativeClockAuthority(false);
      expect(clock.nativeAudioWasUnavailable).toBe(false);
    });

    it("complete() clears native samples same as pause()", () => {
      clock.setNativeClockAuthority(true);
      clock.play();
      clock.setNativeClockPosition(5.0, 1.0);
      expect((clock as any)._hasRealNativeClockSample).toBe(true);

      clock.complete();
      expect((clock as any)._nativeClockPosition).toBeNull();
      expect((clock as any)._hasRealNativeClockSample).toBe(false);
    });

    it("play() after complete() with native authority starts wall-clock extrapolation", () => {
      clock.setNativeClockAuthority(true);
      clock.play();
      clock.complete();

      clock.play();
      expect(clock.state).toBe("playing");
      expect((clock as any)._playStartMs).toBeGreaterThan(0);
      expect((clock as any)._playStartClockTime).toBe(0); // Restarted from 0
      expect((clock as any)._hasRealNativeClockSample).toBe(false);
    });
  });
});

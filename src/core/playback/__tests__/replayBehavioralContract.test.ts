/**
 * Replay Behavioral Contract
 *
 * This suite validates the complete replay lifecycle — the exact scenario
 * where a prior fix silently broke replay behavior. Every behavioral contract
 * that users depend on is codified here:
 *
 *   - play → stop → play restarts identically from t=0
 *   - play → complete → play auto-restarts from t=0
 *   - Audio/native clock state is fully reset across replay boundaries
 *   - Speed, seek, and clip-freeze state survives or resets correctly
 *   - Listener notifications are batched (stop = 1 event, not 3)
 *
 * INVARIANT: Tests in this file are append-only. Never delete or skip a test.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PlaybackClock, getPlaybackClock, resetPlaybackClock } from "../PlaybackClock";

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

describe("Replay Behavioral Contract", () => {
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

  // ── Core Replay Lifecycle ────────────────────────────────────────────────

  describe("Core Replay Lifecycle", () => {
    it("play → stop → play restarts from t=0", () => {
      clock.play();
      expect(clock.state).toBe("playing");

      // Simulate some time progression via native clock
      clock.setNativeClockAuthority(true);
      clock.setNativeClockPosition(3.5, 1.0);

      clock.stop();
      expect(clock.time).toBe(0);
      expect(clock.state).toBe("stopped");

      // Replay
      clock.play();
      expect(clock.state).toBe("playing");
      // toBeCloseTo because wall-clock extrapolation starts instantly on play();
      // sub-ms drift between play() and this read is expected and harmless.
      expect(clock.time).toBeCloseTo(0, 3);
    });

    it("play → pause → play resumes from pause point (not from 0)", () => {
      clock.play();
      clock.setNativeClockAuthority(true);
      clock.setNativeClockPosition(5.0, 1.0);

      clock.pause();
      const pausedTime = clock.time;
      expect(pausedTime).toBeCloseTo(5.0, 0); // Frame-snapped near 5.0

      // Resume — NOT a restart
      clock.play();
      expect(clock.state).toBe("playing");
      // Time should be near the pause point, not 0
      expect(clock.time).toBeGreaterThan(0);
    });

    it("play → stop → play is a full restart from 0 (distinct from pause/resume)", () => {
      clock.play();
      clock.seek(7.0, { keepPlaying: false });
      clock.completeSeek();
      expect(clock.time).toBe(7.0);

      clock.stop();
      expect(clock.time).toBe(0);

      clock.play();
      expect(clock.time).toBe(0);
      expect(clock.state).toBe("playing");
    });

    it("play to completion → play restarts from 0", () => {
      clock.play();
      clock.complete();

      expect(clock.state).toBe("paused");
      expect(clock.time).toBe(10); // At terminal boundary

      // Replay from terminal boundary
      clock.play();
      expect(clock.state).toBe("playing");
      expect(clock.time).toBe(0); // Auto-restart
    });

    it("mid-play seek → stop → play restarts from 0 (not from seek target)", () => {
      clock.play();
      clock.seek(8.5);
      expect(clock.time).toBe(8.5);

      clock.stop();
      expect(clock.time).toBe(0);

      clock.play();
      expect(clock.time).toBe(0);
    });

    it("rapid play/stop/play cycles maintain clean state", () => {
      for (let i = 0; i < 10; i++) {
        clock.play();
        expect(clock.state).toBe("playing");
        clock.stop();
        expect(clock.state).toBe("stopped");
        expect(clock.time).toBe(0);
      }

      // Final play should work cleanly
      clock.play();
      expect(clock.state).toBe("playing");
      expect(clock.time).toBe(0);
    });

    it("play → pause → stop → play restarts from 0 (stop always resets regardless of prior pause)", () => {
      clock.play();
      clock.pause();
      const pausedTime = clock.time;

      clock.stop();
      expect(clock.time).toBe(0);

      clock.play();
      expect(clock.time).toBe(0);
    });
  });

  // ── Clock State Integrity Across Replay ──────────────────────────────────

  describe("Clock State Integrity Across Replay", () => {
    it("clock.time === 0 after stop()", () => {
      clock.play();
      clock.stop();
      expect(clock.time).toBe(0);
    });

    it("clock.state === 'stopped' after stop()", () => {
      clock.play();
      clock.stop();
      expect(clock.state).toBe("stopped");
    });

    it("clock.state === 'playing' after stop() + play()", () => {
      clock.play();
      clock.stop();
      clock.play();
      expect(clock.state).toBe("playing");
    });

    it("clock.isSeeking === false after stop()", () => {
      clock.play();
      clock.seek(5.0, { keepPlaying: false });
      expect(clock.isSeeking).toBe(true);

      clock.stop();
      expect(clock.isSeeking).toBe(false);
    });

    it("seeking state is fully cleared on stop()", () => {
      clock.seek(3.0);
      expect(clock.isSeeking).toBe(true);

      clock.stop();
      expect(clock.isSeeking).toBe(false);
      expect(clock.time).toBe(0);
    });

    it("generation counter advances on each play() — prevents stale RAF ticks", () => {
      const getGeneration = () => (clock as any)._generation;

      const gen0 = getGeneration();
      clock.play();
      const gen1 = getGeneration();
      expect(gen1).toBeGreaterThan(gen0);

      clock.stop();
      clock.play();
      const gen2 = getGeneration();
      expect(gen2).toBeGreaterThan(gen1);

      clock.stop();
      clock.play();
      const gen3 = getGeneration();
      expect(gen3).toBeGreaterThan(gen2);
    });

    it("per-clip freezes are cleared on stop()", () => {
      clock.freezeClipAt("clip-1", 2.5);
      clock.freezeClipAt("clip-2", 4.0);
      expect(clock.hasClipFreezes).toBe(true);

      clock.stop();
      expect(clock.hasClipFreezes).toBe(false);
      expect(clock.getClipFreezeTime("clip-1")).toBeUndefined();
      expect(clock.getClipFreezeTime("clip-2")).toBeUndefined();
    });

    it("per-clip freezes survive pause but not stop", () => {
      clock.play();
      clock.freezeClipAt("clip-1", 2.5);
      expect(clock.hasClipFreezes).toBe(true);

      clock.pause();
      expect(clock.hasClipFreezes).toBe(true); // Survives pause

      clock.stop();
      expect(clock.hasClipFreezes).toBe(false); // Cleared on stop
    });
  });

  // ── Native Clock Authority Across Replay ─────────────────────────────────

  describe("Native Clock Authority Across Replay", () => {
    it("native clock position is cleared on stop()", () => {
      clock.setNativeClockAuthority(true);
      clock.play();
      clock.setNativeClockPosition(5.0, 1.0);
      expect(clock.hasNativeClockPosition).toBe(true);

      clock.stop();
      expect(clock.hasNativeClockPosition).toBe(false);
    });

    it("hasNativeClockPosition === false after stop()", () => {
      clock.setNativeClockAuthority(true);
      clock.play();
      clock.setNativeClockPosition(3.0, 1.0);

      clock.stop();
      expect(clock.hasNativeClockPosition).toBe(false);
      expect((clock as any)._nativeClockPosition).toBeNull();
      expect((clock as any)._hasRealNativeClockSample).toBe(false);
    });

    it("native clock authority is preserved across stop()/play() cycle", () => {
      clock.setNativeClockAuthority(true);
      expect(clock.isNativeClockAuthority).toBe(true);

      clock.play();
      clock.stop();
      // Authority should still be set — it's a session-level setting
      expect(clock.isNativeClockAuthority).toBe(true);

      clock.play();
      expect(clock.isNativeClockAuthority).toBe(true);
    });

    it("new play() after stop() starts fresh wall-clock extrapolation", () => {
      clock.setNativeClockAuthority(true);
      clock.play();

      const firstPlayStartMs = (clock as any)._playStartMs;
      expect(firstPlayStartMs).toBeGreaterThan(0);

      clock.stop();

      clock.play();
      const secondPlayStartMs = (clock as any)._playStartMs;
      expect(secondPlayStartMs).toBeGreaterThan(0);
      expect(secondPlayStartMs).toBeGreaterThanOrEqual(firstPlayStartMs);
      expect((clock as any)._playStartClockTime).toBe(0);
    });

    it("stale native samples from before stop() are not reused after replay", () => {
      clock.setNativeClockAuthority(true);
      clock.play();
      clock.setNativeClockPosition(7.0, 1.0);
      expect(clock.time).toBeCloseTo(7.0, 1);

      clock.stop();
      expect(clock.time).toBe(0);

      clock.play();
      // Time should be near 0, not carry over the 7.0 from the old session
      expect(clock.time).toBeLessThan(1.0);
      expect((clock as any)._hasRealNativeClockSample).toBe(false);
    });
  });

  // ── Speed Changes Across Replay ──────────────────────────────────────────

  describe("Speed Changes Across Replay", () => {
    it("speed is preserved across stop/play cycle", () => {
      clock.setSpeed(2.0);
      expect(clock.speed).toBe(2.0);

      clock.play();
      clock.stop();
      expect(clock.speed).toBe(2.0);

      clock.play();
      expect(clock.speed).toBe(2.0);
    });

    it("changing speed then replaying uses new speed", () => {
      clock.play();
      clock.stop();

      clock.setSpeed(0.5);
      clock.play();
      expect(clock.speed).toBe(0.5);
    });

    it("speed change during playback doesn't corrupt replay state", () => {
      clock.play();
      clock.setSpeed(1.5);
      expect(clock.speed).toBe(1.5);

      clock.stop();
      expect(clock.speed).toBe(1.5);
      expect(clock.time).toBe(0);
      expect(clock.state).toBe("stopped");

      clock.play();
      expect(clock.speed).toBe(1.5);
      expect(clock.state).toBe("playing");
    });
  });

  // ── Seek + Replay Interactions ───────────────────────────────────────────

  describe("Seek + Replay Interactions", () => {
    it("seek → stop → play starts from 0, not seek target", () => {
      clock.seek(6.0);
      expect(clock.time).toBe(6.0);

      clock.stop();
      expect(clock.time).toBe(0);

      clock.play();
      expect(clock.time).toBe(0);
    });

    it("seek during paused → stop → play starts from 0", () => {
      clock.play();
      clock.pause();
      clock.seek(4.0, { keepPlaying: false });
      clock.completeSeek();
      expect(clock.time).toBe(4.0);

      clock.stop();
      clock.play();
      expect(clock.time).toBe(0);
    });

    it("rapid seeks → stop → play starts clean from 0", () => {
      clock.seek(1.0);
      clock.seek(3.0);
      clock.seek(5.0);
      clock.seek(7.0);
      clock.seek(9.0);
      expect(clock.time).toBe(9.0);

      clock.stop();
      clock.play();
      expect(clock.time).toBe(0);
    });

    it("seekRevision advances correctly across replay boundary", () => {
      const rev0 = clock.seekRevision;

      clock.seek(3.0);
      expect(clock.seekRevision).toBe(rev0 + 1);

      clock.stop();
      // seekRevision is not reset by stop — it's a monotonic counter
      const revAfterStop = clock.seekRevision;

      clock.play();
      clock.seek(5.0);
      expect(clock.seekRevision).toBe(revAfterStop + 1);
    });

    it("isSeeking is cleared by stop regardless of prior seek state", () => {
      clock.seek(5.0);
      expect(clock.isSeeking).toBe(true);

      clock.stop();
      expect(clock.isSeeking).toBe(false);

      // play after stop should not carry seeking state
      clock.play();
      expect(clock.isSeeking).toBe(false);
    });
  });

  // ── Terminal Boundary Replay ─────────────────────────────────────────────

  describe("Terminal Boundary Replay", () => {
    it("complete() → play() restarts from 0", () => {
      clock.play();
      clock.complete();
      expect(clock.time).toBe(10);
      expect(clock.state).toBe("paused");

      clock.play();
      expect(clock.time).toBe(0);
      expect(clock.state).toBe("playing");
    });

    it("seek to duration → play() auto-restarts from 0", () => {
      clock.seek(10);
      clock.completeSeek();
      expect(clock.time).toBe(10);

      clock.play();
      expect(clock.time).toBe(0);
      expect(clock.state).toBe("playing");
    });

    it("stop at terminal boundary resets to 0", () => {
      clock.play();
      clock.complete();
      expect(clock.time).toBe(10);

      clock.stop();
      expect(clock.time).toBe(0);

      clock.play();
      expect(clock.time).toBe(0);
    });

    it("zero-duration timeline: complete() falls back to pause()", () => {
      const zeroClock = new PlaybackClock();
      zeroClock.setDuration(0);

      zeroClock.play();
      zeroClock.complete();
      expect(zeroClock.state).toBe("paused");
    });
  });

  // ── Listener Notification Contract ───────────────────────────────────────

  describe("Listener Notification Contract", () => {
    it("stop() fires exactly one notification (batched, not 3 separate)", () => {
      const listener = vi.fn();
      clock.subscribe(listener);

      clock.play();
      listener.mockClear();

      clock.stop();
      // stop() batches state=stopped + time=0 + isSeeking=false into one notification
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("replay cycle (stop + play) fires exactly 2 notifications", () => {
      const listener = vi.fn();
      clock.subscribe(listener);

      clock.play();
      listener.mockClear();

      clock.stop(); // 1 notification
      clock.play(); // 1 notification
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it("listener receives correct state in stop notification", () => {
      const states: Array<{ time: number; state: string }> = [];
      clock.subscribe((s) => states.push({ time: s.time, state: s.state }));

      clock.play();
      states.length = 0;

      clock.stop();
      expect(states).toHaveLength(1);
      expect(states[0]).toEqual({ time: 0, state: "stopped" });
    });

    it("listener receives correct state in replay notification", () => {
      const states: Array<{ time: number; state: string }> = [];
      clock.subscribe((s) => states.push({ time: s.time, state: s.state }));

      clock.play();
      states.length = 0;

      clock.stop();
      clock.play();

      expect(states).toHaveLength(2);
      expect(states[0]).toEqual({ time: 0, state: "stopped" });
      expect(states[1]).toEqual(
        expect.objectContaining({ time: 0, state: "playing" }),
      );
    });
  });

  // ── Global Singleton Replay ──────────────────────────────────────────────

  describe("Global Singleton Replay", () => {
    it("resetPlaybackClock fully resets the global singleton for replay", () => {
      const shared = getPlaybackClock();
      shared.setDuration(20);
      shared.play();

      resetPlaybackClock();

      expect(shared.state).toBe("stopped");
      expect(shared.time).toBe(0);
      expect(shared.duration).toBe(0);
    });

    it("global clock identity is preserved across reset (no new instance)", () => {
      const before = getPlaybackClock();
      resetPlaybackClock();
      const after = getPlaybackClock();
      expect(after).toBe(before);
    });
  });
});

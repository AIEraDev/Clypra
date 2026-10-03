import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PlaybackClock, getPlaybackClock, resetPlaybackClock } from "../PlaybackClock";

// Mock AudioContext
class MockAudioContext {
  state = "running";
  currentTime = 0;

  resume() {
    this.state = "running";
    return Promise.resolve();
  }
}

// Mock requestAnimationFrame/cancelAnimationFrame
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

const executeNextFrame = (): void => {
  const callbacks = Array.from(rafCallbacks.values());
  rafCallbacks.clear();
  callbacks.forEach((cb) => cb());
};

describe("PlaybackClock: RAF Generation Counter", () => {
  let clock: PlaybackClock;
  let originalRAF: typeof requestAnimationFrame;
  let originalCAF: typeof cancelAnimationFrame;
  let originalAudioContext: typeof AudioContext;

  beforeEach(() => {
    // Setup mocks
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
  });

  afterEach(() => {
    // Restore originals
    globalThis.requestAnimationFrame = originalRAF;
    globalThis.cancelAnimationFrame = originalCAF;
    (globalThis as any).AudioContext = originalAudioContext;

    rafCallbacks.clear();
  });

  it("should seamlessly continue playback on seek while playing", () => {
    clock.play();
    expect(clock.state).toBe("playing");

    // Seek during playback preserves playing state
    clock.seek(5.0);
    expect(clock.state).toBe("playing");
    expect(clock.time).toBe(5.0);

    // Old RAF callbacks from before the seek should not advance time
    const oldCallbacks = Array.from(rafCallbacks.values());
    for (const cb of oldCallbacks) {
      cb();
    }
    expect(clock.time).toBe(5.0);
  });

  it("exposes a stable revision so native consumers can handle each seek once", () => {
    const initialRevision = clock.seekRevision;

    clock.seek(2);
    expect(clock.seekRevision).toBe(initialRevision + 1);
    // Completing presentation does not create a new transport intent.
    clock.completeSeek();
    expect(clock.seekRevision).toBe(initialRevision + 1);

    clock.seek(4);
    expect(clock.seekRevision).toBe(initialRevision + 2);
  });

  it("should pause playback and cancel RAF when seek explicitly requests keepPlaying: false", () => {
    clock.play();
    clock.seek(5.0, { keepPlaying: false });
    expect(clock.state).toBe("paused");
    expect(clock.time).toBe(5.0);

    clock.play();
    expect(clock.state).toBe("playing");
    executeNextFrame();
  });

  it("should increment generation on each play() call", () => {
    // Access private generation counter for testing
    const getGeneration = () => (clock as any)._generation;

    const gen1 = getGeneration();

    clock.play();
    const gen2 = getGeneration();
    expect(gen2).toBe(gen1 + 1);

    clock.pause();
    const gen3 = getGeneration();
    expect(gen3).toBe(gen2); // Pause doesn't increment

    clock.play();
    const gen4 = getGeneration();
    expect(gen4).toBe(gen3 + 1);
  });

  it("should handle rapid seek during playback by seamlessly continuing playback from final seek position", () => {
    clock.play();

    // Rapid seeks
    clock.seek(1.0);
    clock.seek(2.0);
    clock.seek(3.0);

    expect(clock.state).toBe("playing");
    expect(clock.time).toBe(3.0);
  });

  it("should pause when seek explicitly requests keepPlaying: false", () => {
    clock.play();
    clock.seek(3.0, { keepPlaying: false });

    expect(clock.state).toBe("paused");
    expect(clock.time).toBe(3.0);
  });

  it("should not cause time jump forward after seek", () => {
    // This was the original symptom: user seeks to 5.000s, playhead shows 5.016s

    clock.play();
    executeNextFrame(); // Let playback run for one frame

    // Seek to specific time
    clock.seek(5.0);

    // Time should be exactly 5.0, not 5.016 or any other value
    expect(clock.time).toBe(5.0);

    // Complete the seek
    clock.completeSeek();

    // Time should still be 5.0
    expect(clock.time).toBe(5.0);
  });

  it("should handle seek while paused", () => {
    // Seek while paused shouldn't have generation issues
    clock.seek(3.0);
    expect(clock.time).toBe(3.0);
    expect(clock.state).toBe("stopped");

    // No RAF callbacks should be registered (not playing)
    expect(rafCallbacks.size).toBe(0);
  });

  it("should handle pause during RAF tick execution", () => {
    clock.play();

    // Get the current RAF callback
    const callbacks = Array.from(rafCallbacks.values());
    expect(callbacks.length).toBe(1);

    // Pause before RAF executes
    clock.pause();

    // Execute the RAF callback that was scheduled before pause
    callbacks[0]();

    // Should not crash or cause issues (generation check protects)
    expect(clock.state).toBe("paused");
  });

  it("should restart from zero when play is pressed at the timeline end", () => {
    clock.seek(10);
    expect(clock.time).toBe(10);

    clock.play();

    expect(clock.state).toBe("playing");
    expect(clock.time).toBe(0);
  });

  it("completes at the exact terminal boundary and can restart cleanly", () => {
    clock.play();
    clock.complete();

    expect(clock.state).toBe("paused");
    expect(clock.time).toBe(10);
    expect(rafCallbacks.size).toBe(0);

    clock.play();
    expect(clock.state).toBe("playing");
    expect(clock.time).toBe(0);
  });

  it("resyncNativeClockPosition overrides extrapolated drift without ratchet lockout", () => {
    clock.play();
    clock.setNativeClockPosition(5.0, 1.0);
    expect(clock.time).toBeCloseTo(5.0, 2);

    // Normal setNativeClockPosition would clamp forward if time is smaller than extrapolated:
    // With resyncNativeClockPosition, it forces backward snap to true audio hardware time:
    const notified = vi.fn();
    clock.subscribe(notified);

    clock.resyncNativeClockPosition(3.5, 1.0);
    expect(clock.time).toBeCloseTo(3.5, 2);
    expect(notified).toHaveBeenCalled();
  });

  it("preserves global clock identity across a project reset", () => {
    const shared = getPlaybackClock();
    const listener = vi.fn();
    shared.subscribe(listener);
    shared.setDuration(10);
    shared.play();

    resetPlaybackClock();

    expect(getPlaybackClock()).toBe(shared);
    expect(shared.getState()).toMatchObject({
      time: 0,
      duration: 0,
      state: "stopped",
    });
    expect(listener).toHaveBeenCalled();
  });

  it("observation-only proof: setNativeClockPosition with poll telemetry produces identical currentTime to baseline", () => {
    let mockTime = 1000.0;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => mockTime);

    try {
      const clockBaseline = new PlaybackClock();
      const clockTelemetry = new PlaybackClock();

      clockBaseline.setDuration(30.0);
      clockTelemetry.setDuration(30.0);

      clockBaseline.play();
      clockTelemetry.play();

      // Sequence of simulated audio clock polls with varying speeds, RTTs, and timestamps
      const testCases = [
        { time: 0.1, speed: 1.0, rtt: 12.4, sampledNs: 1_000_000 },
        { time: 0.5, speed: 1.0, rtt: 15.1, sampledNs: 400_000_000 },
        { time: 1.2, speed: 1.5, rtt: 14.8, sampledNs: 1_100_000_000 },
        { time: 1.8, speed: 1.5, rtt: 22.0, sampledNs: 1_700_000_000 },
        // Slightly late sample within backward tolerance
        { time: 1.78, speed: 1.5, rtt: 35.0, sampledNs: 1_750_000_000 },
        { time: 2.5, speed: 1.0, rtt: 11.2, sampledNs: 2_400_000_000 },
      ];

      for (const tc of testCases) {
        mockTime += 100.0;
        // Baseline call: 2 arguments (time, speed)
        clockBaseline.setNativeClockPosition(tc.time, tc.speed);
        // Telemetry call: 4 arguments (time, speed, pollRttMs, sampledAtNs)
        clockTelemetry.setNativeClockPosition(tc.time, tc.speed, tc.rtt, tc.sampledNs);

        // Immediate read
        expect(clockTelemetry.currentTime).toBe(clockBaseline.currentTime);
        expect(clockTelemetry.time).toBe(clockBaseline.time);
        expect(clockTelemetry.state).toBe(clockBaseline.state);
        expect(clockTelemetry.speed).toBe(clockBaseline.speed);

        // Extrapolated read 16.6ms later
        mockTime += 16.666;
        expect(clockTelemetry.currentTime).toBe(clockBaseline.currentTime);
        expect(clockTelemetry.time).toBe(clockBaseline.time);
      }
    } finally {
      nowSpy.mockRestore();
    }
  });
});

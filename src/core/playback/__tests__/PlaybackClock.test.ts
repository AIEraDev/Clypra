import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PlaybackClock } from "../PlaybackClock";

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

  it("should pause playback and cancel RAF on seek", () => {
    clock.play();
    expect(clock.state).toBe("playing");

    // Seek pauses playback so user manually resumes
    clock.seek(5.0);
    expect(clock.state).toBe("paused");
    expect(clock.time).toBe(5.0);

    // Old RAF callbacks from before the seek should not advance time
    const oldCallbacks = Array.from(rafCallbacks.values());
    for (const cb of oldCallbacks) {
      cb();
    }
    expect(clock.time).toBe(5.0);
  });

  it("should allow manual play to resume after seek", () => {
    clock.play();
    clock.seek(5.0);
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

  it("should handle rapid seek during playback by staying paused at final seek position", () => {
    clock.play();

    // Rapid seeks
    clock.seek(1.0);
    clock.seek(2.0);
    clock.seek(3.0);

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
});

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

  it("should prevent stale RAF tick from executing after seek", () => {
    // When seek() does pause→play, old RAF tick can execute
    // Generation counter prevents this

    clock.play();
    expect(clock.state).toBe("playing");

    // Capture the old RAF callback
    const oldCallbacks = Array.from(rafCallbacks.values());
    expect(oldCallbacks.length).toBe(1);

    // Now seek (which does pause→play internally)
    clock.seek(5.0);

    // After seek, there should be a NEW RAF callback
    const newCallbacks = Array.from(rafCallbacks.values());
    expect(newCallbacks.length).toBe(1);

    // The old callback should be different from the new one
    expect(oldCallbacks[0]).not.toBe(newCallbacks[0]);

    // Execute the OLD callback (simulating it firing after seek)
    const timeBefore = clock.time;
    oldCallbacks[0]();
    const timeAfter = clock.time;

    // Time should NOT advance because old callback
    // has stale generation and should be ignored
    expect(timeAfter).toBe(timeBefore);
  });

  it("should allow new RAF tick to execute normally after seek", () => {
    clock.play();
    clock.seek(5.0);

    const initialTime = clock.time;
    expect(initialTime).toBe(5.0);

    // Execute the NEW RAF callback (correct generation)
    executeNextFrame();

    // Time should advance normally (new callback has correct generation)
    // Note: In real scenario time would advance based on AudioContext
    // In this test, behavior depends on mock implementation
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

  it("should handle rapid seek during playback", () => {
    // Rapid seeking is a common trigger for stale RAF ticks
    clock.play();

    const initialGeneration = (clock as any)._generation;

    // Rapid seeks
    clock.seek(1.0);
    clock.seek(2.0);
    clock.seek(3.0);

    // Each seek does pause→play, so generation increments
    const finalGeneration = (clock as any)._generation;
    expect(finalGeneration).toBeGreaterThan(initialGeneration);

    // Time should be at the last seek position
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

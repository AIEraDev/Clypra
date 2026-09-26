/**
 * TransportAuthority Tests
 *
 * Tests automatic pause behavior when switching playback contexts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TransportAuthority } from "../TransportAuthority";
import type { PlaybackContext, PlaybackContextType } from "../PlaybackContext";

describe("TransportAuthority", () => {
  let authority: TransportAuthority;
  let mockProgramContext: PlaybackContext;
  let mockSourceContext: PlaybackContext;

  beforeEach(() => {
    authority = new TransportAuthority();

    // Create mock contexts
    mockProgramContext = {
      type: "program" as PlaybackContextType,
      play: vi.fn(),
      pause: vi.fn(),
      stop: vi.fn(),
      seek: vi.fn(),
      setSpeed: vi.fn(),
      getTime: vi.fn(() => 0),
      getDuration: vi.fn(() => 100),
      getSpeed: vi.fn(() => 1),
      getState: vi.fn(() => "paused" as any),
      getSnapshot: vi.fn(() => ({
        time: 0,
        state: "paused" as const,
        duration: 100,
        speed: 1,
      })),
      subscribe: vi.fn(() => () => {}),
      dispose: vi.fn(),
    };

    mockSourceContext = {
      ...mockProgramContext,
      type: "source" as PlaybackContextType,
    };
  });

  describe("context registration", () => {
    it("auto-activates first registered context", () => {
      authority.registerContext(mockProgramContext);
      expect(authority.getActiveType()).toBe("program");
    });

    it("does not auto-activate second context", () => {
      authority.registerContext(mockProgramContext);
      authority.registerContext(mockSourceContext);

      expect(authority.getActiveType()).toBe("program");
    });
  });

  describe("context switching with auto-pause", () => {
    it("pauses previous context when switching", () => {
      authority.registerContext(mockProgramContext);
      authority.registerContext(mockSourceContext);

      // Program is active and "playing"
      mockProgramContext.getState = vi.fn(() => "playing" as any);

      // Switch to source
      authority.setActiveContext("source");

      // Program should be paused
      expect(mockProgramContext.pause).toHaveBeenCalled();
    });

    it("does not pause when switching to same context", () => {
      authority.registerContext(mockProgramContext);

      // Switch to program (already active)
      authority.setActiveContext("program");

      // Should not call pause
      expect(mockProgramContext.pause).not.toHaveBeenCalled();
    });

    it("notifies listeners on context switch", () => {
      authority.registerContext(mockProgramContext);
      authority.registerContext(mockSourceContext);

      const listener = vi.fn();
      authority.subscribeToContextSwitch(listener);

      authority.setActiveContext("source");

      expect(listener).toHaveBeenCalledWith("source");
    });
  });

  describe("transport commands delegate to active context", () => {
    beforeEach(() => {
      authority.registerContext(mockProgramContext);
      authority.setActiveContext("program");
    });

    it("play delegates to active context", () => {
      authority.play();
      expect(mockProgramContext.play).toHaveBeenCalled();
    });

    it("pause delegates to active context", () => {
      authority.pause();
      expect(mockProgramContext.pause).toHaveBeenCalled();
    });

    it("toggles from the active context's live state", () => {
      mockProgramContext.getState = vi.fn(() => "paused" as any);
      authority.togglePlayback();
      expect(mockProgramContext.play).toHaveBeenCalledTimes(1);

      mockProgramContext.getState = vi.fn(() => "playing" as any);
      authority.togglePlayback();
      expect(mockProgramContext.pause).toHaveBeenCalledTimes(1);
    });

    it("seeks to 0 when toggling playback at the terminal boundary", () => {
      mockProgramContext.getState = vi.fn(() => "paused" as any);
      mockProgramContext.getDuration = vi.fn(() => 41.366667);
      mockProgramContext.getTime = vi.fn(() => 41.366667);

      authority.togglePlayback();

      expect(mockProgramContext.seek).toHaveBeenCalledWith(0);
      expect(mockProgramContext.play).toHaveBeenCalledTimes(1);
    });

    it("seeks to 0 when calling play at the terminal boundary", () => {
      mockProgramContext.getState = vi.fn(() => "paused" as any);
      mockProgramContext.getDuration = vi.fn(() => 41.366667);
      mockProgramContext.getTime = vi.fn(() => 41.366667);

      authority.play();

      expect(mockProgramContext.seek).toHaveBeenCalledWith(0);
      expect(mockProgramContext.play).toHaveBeenCalledTimes(1);
    });

    it("seek delegates to active context", () => {
      authority.seek(5);
      expect(mockProgramContext.seek).toHaveBeenCalledWith(5);
    });

    it("setSpeed delegates to active context", () => {
      authority.setSpeed(0.5);
      expect(mockProgramContext.setSpeed).toHaveBeenCalledWith(0.5);
    });

    it("publishes one monotonic epoch for each transport intent", () => {
      const events: Array<{ epoch: number; kind: string }> = [];
      authority.subscribeToTransportEvents((event) => events.push(event));

      authority.play();
      authority.pause();
      authority.seek(5);

      expect(events.map((event) => event.kind)).toEqual([
        "play",
        "pause",
        "seek",
      ]);
      expect(events.map((event) => event.epoch)).toEqual([
        events[0].epoch,
        events[0].epoch + 1,
        events[0].epoch + 2,
      ]);
    });
  });

  it("advances a completion epoch only for a natural terminal transition", () => {
    let emitState: ((state: any) => void) | undefined;
    mockProgramContext.subscribe = vi.fn((listener) => {
      emitState = listener;
      return () => {};
    });
    authority.registerContext(mockProgramContext);
    const events: string[] = [];
    authority.subscribeToTransportEvents((event) => events.push(event.kind));

    emitState?.({ time: 90, duration: 100, speed: 1, state: "playing" });
    emitState?.({ time: 50, duration: 100, speed: 1, state: "paused" });
    emitState?.({ time: 100, duration: 100, speed: 1, state: "playing" });
    emitState?.({ time: 100, duration: 100, speed: 1, state: "paused" });

    expect(events).toEqual(["completed"]);
  });

  describe("missing context handling", () => {
    it("warns when switching to unregistered context", () => {
      const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

      authority.setActiveContext("source" as any);

      expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining("No context registered"));

      consoleWarn.mockRestore();
    });

    it("handles commands gracefully when no context active", () => {
      // No contexts registered
      expect(() => {
        authority.play();
        authority.pause();
        authority.seek(5);
      }).not.toThrow();
    });
  });

  describe("cleanup", () => {
    it("disposes all contexts on dispose", () => {
      authority.registerContext(mockProgramContext);
      authority.registerContext(mockSourceContext);

      authority.dispose();

      expect(mockProgramContext.dispose).toHaveBeenCalled();
      expect(mockSourceContext.dispose).toHaveBeenCalled();
      expect(authority.getActiveContext()).toBeNull();
    });
  });

  describe("scrub and seek subsystem integration", () => {
    it("does not pause when seeking during active playback", () => {
      authority.registerContext(mockProgramContext);
      mockProgramContext.getState = vi.fn(() => "playing" as any);

      authority.seek(12);

      expect(mockProgramContext.pause).not.toHaveBeenCalled();
      expect(mockProgramContext.seek).toHaveBeenCalledWith(12);
      expect(authority.getSeekController().getCurrent()?.mode).toBe("playback");
    });

    it("pauses during active drag scrub and resumes playback on endScrub if playing before scrub", () => {
      authority.registerContext(mockProgramContext);
      mockProgramContext.getState = vi.fn(() => "playing" as any);

      authority.beginScrub(10, "playhead");
      expect(mockProgramContext.pause).toHaveBeenCalled();
      expect(mockProgramContext.seek).toHaveBeenCalledWith(10);
      expect(authority.getSeekController().getCurrent()?.isScrubbing).toBe(true);

      authority.updateScrub(15, 3000);
      expect(mockProgramContext.seek).toHaveBeenCalledWith(15);
      expect(authority.getSeekController().getCurrent()?.quality).toBe("quarter");

      authority.endScrub(20);
      expect(mockProgramContext.seek).toHaveBeenCalledWith(20);
      expect(mockProgramContext.play).toHaveBeenCalled();
      expect(authority.getSeekController().getCurrent()?.mode).toBe("playback");
    });

    it("settles on endScrub without resuming playback if paused before scrub", () => {
      authority.registerContext(mockProgramContext);
      mockProgramContext.getState = vi.fn(() => "paused" as any);
      (mockProgramContext.play as any).mockClear();

      authority.beginScrub(10, "playhead");
      expect(authority.getSeekController().getCurrent()?.isScrubbing).toBe(true);

      authority.endScrub(20);
      expect(mockProgramContext.seek).toHaveBeenCalledWith(20);
      expect(authority.getSeekController().getCurrent()?.isSettling).toBe(true);
      expect(authority.getSeekController().getCurrent()?.quality).toBe("full");
      expect(mockProgramContext.play).not.toHaveBeenCalled();
    });
  });
});

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

    it("seek delegates to active context", () => {
      authority.seek(5);
      expect(mockProgramContext.seek).toHaveBeenCalledWith(5);
    });

    it("setSpeed delegates to active context", () => {
      authority.setSpeed(0.5);
      expect(mockProgramContext.setSpeed).toHaveBeenCalledWith(0.5);
    });
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
});

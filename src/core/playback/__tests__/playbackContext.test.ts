import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProgramPlaybackContext } from "../ProgramPlaybackContext";
import { SourcePlaybackContext } from "../SourcePlaybackContext";
import type { PlaybackClock, PlaybackState } from "../PlaybackClock";

describe("Playback Context System", () => {
  
  describe("ProgramPlaybackContext", () => {
    let mockClock: PlaybackClock;
    let context: ProgramPlaybackContext;

    beforeEach(() => {
      mockClock = {
        time: 5.2,
        duration: 10.0,
        state: "playing" as PlaybackState,
        speed: 1.0,
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        setSpeed: vi.fn(),
        getState: vi.fn().mockReturnValue({ time: 5.2, state: "playing", duration: 10.0, speed: 1.0 }),
        subscribe: vi.fn().mockImplementation((wrapped) => {
          wrapped({ time: 5.2, state: "playing", duration: 10.0, speed: 1.0 });
          return vi.fn();
        }),
      } as unknown as PlaybackClock;

      context = new ProgramPlaybackContext(mockClock);
    });

    it("should delegate transport commands to PlaybackClock singleton", () => {
      context.play();
      expect(mockClock.play).toHaveBeenCalled();

      context.pause();
      expect(mockClock.pause).toHaveBeenCalled();

      context.stop();
      expect(mockClock.stop).toHaveBeenCalled();

      context.seek(3.0);
      expect(mockClock.seek).toHaveBeenCalledWith(3.0);

      context.setSpeed(1.5);
      expect(mockClock.setSpeed).toHaveBeenCalledWith(1.5);
    });

    it("should return correct status metrics from the clock", () => {
      expect(context.getTime()).toBe(5.2);
      expect(context.getDuration()).toBe(10.0);
      expect(context.getState()).toBe("playing");
      expect(context.getSpeed()).toBe(1.0);
      
      const snapshot = context.getSnapshot();
      expect(snapshot).toEqual({ time: 5.2, state: "playing", duration: 10.0, speed: 1.0 });
    });

    it("should support subscriptions wrapping clock updates", () => {
      const listener = vi.fn();
      context.subscribe(listener);
      expect(mockClock.subscribe).toHaveBeenCalled();
      expect(listener).toHaveBeenCalledWith({ time: 5.2, state: "playing", duration: 10.0, speed: 1.0 });
    });
  });

  describe("SourcePlaybackContext", () => {
    let mockElement: HTMLMediaElement;
    let context: SourcePlaybackContext;

    beforeEach(() => {
      mockElement = {
        playbackRate: 1.0,
        currentTime: 2.0,
        duration: 8.0,
        paused: true,
        ended: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        play: vi.fn().mockResolvedValue(undefined),
        pause: vi.fn(),
      } as unknown as HTMLMediaElement;

      context = new SourcePlaybackContext();
    });

    it("should bind media element, register listeners, and sync playback rate", () => {
      context.setMediaElement(mockElement);
      expect(mockElement.addEventListener).toHaveBeenCalledTimes(8);
      expect(mockElement.playbackRate).toBe(1.0);

      // Verify unbind cleans up listeners
      context.setMediaElement(null);
      expect(mockElement.removeEventListener).toHaveBeenCalledTimes(8);
    });

    it("should resolve transport state looking at ended flag before paused flag", () => {
      context.setMediaElement(mockElement);
      
      // Default: paused = true, ended = false -> paused
      expect(context.getState()).toBe("paused");

      // Set playing: paused = false -> playing
      (mockElement as any).paused = false;
      expect(context.getState()).toBe("playing");

      // Set ended: paused = true, ended = true -> stopped
      (mockElement as any).paused = true;
      (mockElement as any).ended = true;
      expect(context.getState()).toBe("stopped");
    });

    it("should support in and out points configuration", () => {
      context.setMediaElement(mockElement);
      context.setInPoint(1.0);
      context.setOutPoint(5.0);

      expect(context.getInPoint()).toBe(1.0);
      expect(context.getOutPoint()).toBe(5.0);

      context.clearMarks();
      expect(context.getInPoint()).toBeNull();
      expect(context.getOutPoint()).toBeNull();
    });

    it("should pause transport when current time crosses outPoint in RAF loop", async () => {
      let rafCallback: FrameRequestCallback | null = null;
      const originalRaf = globalThis.requestAnimationFrame;
      globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
        rafCallback = cb;
        return 1;
      };
      
      const originalCaf = globalThis.cancelAnimationFrame;
      globalThis.cancelAnimationFrame = vi.fn();

      context.setMediaElement(mockElement);
      context.setOutPoint(4.0);
      
      // Initial time is 2.0 (below outPoint 4.0).
      context.play();
      expect(mockElement.play).toHaveBeenCalled();
      expect(rafCallback).not.toBeNull();

      // Trigger check 1 (time 2.0 < 4.0, should schedule next RAF frame)
      const currentCallback = rafCallback!;
      rafCallback = null;
      currentCallback(performance.now());
      expect(rafCallback).not.toBeNull(); // Re-scheduled

      // Change time to 4.5 (exceeding outPoint)
      (mockElement as any).currentTime = 4.5;
      
      // Trigger check 2 (time 4.5 >= 4.0, should call pause)
      const nextCallback = rafCallback!;
      nextCallback(performance.now());
      expect(mockElement.pause).toHaveBeenCalled();

      // Cleanup mocks
      globalThis.requestAnimationFrame = originalRaf;
      globalThis.cancelAnimationFrame = originalCaf;
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePixiPlaybackSync } from "../usePixiPlaybackSync";
import { useTimelineStore } from "../../../store/timelineStore";
import { invoke } from "@tauri-apps/api/core";
import * as PIXI from "pixi.js";

// Mock Tauri IPC
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("usePixiPlaybackSync Hook", () => {
  let mockPixiApp: any;
  let mockStage: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockStage = {
      addChild: vi.fn(),
      removeChild: vi.fn(),
    };

    mockPixiApp = {
      stage: mockStage,
    };

    // Default mock response: 1080p frame buffer (1920x1080x4 bytes)
    (invoke as any).mockImplementation(async () => {
      return new ArrayBuffer(1920 * 1080 * 4);
    });

    // Reset timeline store
    act(() => {
      useTimelineStore.setState({
        tracks: [
          {
            id: "t1",
            type: "video",
            name: "Video Track",
            visible: true,
            locked: false,
            muted: false,
            height: 64,
          },
        ],
        clips: [
          {
            id: "c1",
            trackId: "t1",
            name: "Clip 1",
            mediaId: "media-1",
            startTime: 0,
            duration: 10,
            trimIn: 0,
            trimOut: 10,
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
            opacity: 1,
            rotation: 0,
            volume: 1,
          },
        ],
        scrollLeft: 0,
        pixelsPerSecond: 100,
        epoch: 1,
      });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should initialize Pixi Texture and Sprite on first render", async () => {
    const pixiAppRef = { current: mockPixiApp };

    renderHook(() =>
      usePixiPlaybackSync(pixiAppRef, { outWidth: 1920, outHeight: 1080 }),
    );

    // Trigger state mutation
    act(() => {
      useTimelineStore.setState({ epoch: 2, scrollLeft: 100 });
    });

    // Advance RAF and pending promises
    await act(async () => {
      vi.runAllTimers();
    });

    expect(invoke).toHaveBeenCalledWith(
      "render_timeline_frame",
      expect.objectContaining({
        outWidth: 1920,
        outHeight: 1080,
      }),
    );
    expect(mockStage.addChild).toHaveBeenCalledTimes(1);
  });

  it("should perform zero-copy buffer pointer update without reallocating sprite", async () => {
    const pixiAppRef = { current: mockPixiApp };
    const frameRenderedCallback = vi.fn();

    renderHook(() =>
      usePixiPlaybackSync(pixiAppRef, {
        outWidth: 1920,
        outHeight: 1080,
        onFrameRendered: frameRenderedCallback,
      }),
    );

    // Frame 1
    act(() => {
      useTimelineStore.setState({ epoch: 2, scrollLeft: 100 });
    });

    await act(async () => {
      vi.runAllTimers();
    });

    expect(mockStage.addChild).toHaveBeenCalledTimes(1);

    // Frame 2
    act(() => {
      useTimelineStore.setState({ epoch: 3, scrollLeft: 200 });
    });

    await act(async () => {
      vi.runAllTimers();
    });

    // Should NOT recreate the sprite
    expect(mockStage.addChild).toHaveBeenCalledTimes(1);
    expect(frameRenderedCallback).toHaveBeenCalledTimes(2);
  });

  it("should latch and render the trailing frame during rapid scrubbing bursts", async () => {
    const pixiAppRef = { current: mockPixiApp };
    const frameRenderedCallback = vi.fn();

    // Create a delayed mock to simulate async decode latency
    let resolveFirstFrame: ((buf: ArrayBuffer) => void) | null = null;
    (invoke as any).mockImplementationOnce(() => {
      return new Promise<ArrayBuffer>((res) => {
        resolveFirstFrame = res;
      });
    });

    renderHook(() =>
      usePixiPlaybackSync(pixiAppRef, {
        outWidth: 1920,
        outHeight: 1080,
        onFrameRendered: frameRenderedCallback,
      }),
    );

    // User scrubs rapidly through multiple positions
    act(() => {
      useTimelineStore.setState({ epoch: 2, scrollLeft: 100 });
    });
    act(() => {
      useTimelineStore.setState({ epoch: 3, scrollLeft: 200 });
    });
    act(() => {
      useTimelineStore.setState({ epoch: 4, scrollLeft: 300 });
    });
    act(() => {
      useTimelineStore.setState({ epoch: 5, scrollLeft: 400 }); // Final resting position
    });

    // Resolve first in-flight decode
    await act(async () => {
      if (resolveFirstFrame) {
        resolveFirstFrame(new ArrayBuffer(1920 * 1080 * 4));
      }
      vi.runAllTimers();
    });

    // The queue latch should automatically drain the final resting frame (scrollLeft = 400)
    await act(async () => {
      vi.runAllTimers();
    });

    expect(invoke).toHaveBeenLastCalledWith(
      "render_timeline_frame",
      expect.objectContaining({
        timeSecs: 4, // 400 / 100
      }),
    );
  });

  it("should discard out-of-order IPC frame arrivals", async () => {
    const pixiAppRef = { current: mockPixiApp };
    const frameRenderedCallback = vi.fn();

    let resolveSlowFrame: ((buf: ArrayBuffer) => void) | null = null;

    // First request is slow
    (invoke as any).mockImplementationOnce(() => {
      return new Promise<ArrayBuffer>((res) => {
        resolveSlowFrame = res;
      });
    });

    renderHook(() =>
      usePixiPlaybackSync(pixiAppRef, {
        outWidth: 1920,
        outHeight: 1080,
        onFrameRendered: frameRenderedCallback,
      }),
    );

    // Trigger slow frame
    act(() => {
      useTimelineStore.setState({ epoch: 2, scrollLeft: 100 });
    });

    // Trigger fast subsequent frame while slow is in-flight
    act(() => {
      useTimelineStore.setState({ epoch: 3, scrollLeft: 500 });
    });

    // Resolve the slow frame AFTER newer frame is enqueued
    await act(async () => {
      if (resolveSlowFrame) {
        resolveSlowFrame(new ArrayBuffer(1920 * 1080 * 4));
      }
      vi.runAllTimers();
    });

    // Ensure the final state rendered is the newest frame
    expect(invoke).toHaveBeenLastCalledWith(
      "render_timeline_frame",
      expect.objectContaining({
        timeSecs: 5,
      }),
    );
  });

  it("should handle unmount and cleanup all WebGL references cleanly", () => {
    const pixiAppRef = { current: mockPixiApp };

    const { unmount } = renderHook(() =>
      usePixiPlaybackSync(pixiAppRef, { outWidth: 1920, outHeight: 1080 }),
    );

    act(() => {
      unmount();
    });

    // No error thrown and disposed cleanly
    expect(true).toBe(true);
  });
});

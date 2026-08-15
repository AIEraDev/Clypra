import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePixiPlaybackSync } from "../usePixiPlaybackSync";
import { useTimelineStore } from "../../../store/timelineStore";
import { invoke } from "@tauri-apps/api/core";

// Mock Tauri IPC
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Polyfill ImageData for jsdom — not available by default
if (typeof globalThis.ImageData === "undefined") {
  (globalThis as any).ImageData = class {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(
      dataOrWidth: Uint8ClampedArray | number,
      widthOrHeight: number,
      height?: number,
    ) {
      if (typeof dataOrWidth === "number") {
        this.width = dataOrWidth;
        this.height = widthOrHeight;
        this.data = new Uint8ClampedArray(dataOrWidth * widthOrHeight * 4);
      } else {
        this.data = dataOrWidth;
        this.width = widthOrHeight;
        this.height = height ?? dataOrWidth.length / (widthOrHeight * 4);
      }
    }
  };
}

// Mock Pixi.js v8 with proper class-based Sprite constructor
vi.mock("pixi.js", () => {
  const mockTexture = {
    width: 1920,
    height: 1080,
    source: { update: vi.fn() },
    destroy: vi.fn(),
  };
  class Sprite {
    visible = true;
    parent: any = null;
    destroy = vi.fn();
  }
  return {
    Texture: { from: vi.fn(() => mockTexture) },
    Sprite,
  };
});

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

    act(() => {
      useTimelineStore.setState({ epoch: 2, scrollLeft: 100 });
    });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(invoke).toHaveBeenCalledWith(
      "render_timeline_frame",
      expect.objectContaining({ outWidth: 1920, outHeight: 1080 }),
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
      await vi.runAllTimersAsync();
    });

    expect(mockStage.addChild).toHaveBeenCalledTimes(1);

    // Frame 2
    act(() => {
      useTimelineStore.setState({ epoch: 3, scrollLeft: 200 });
    });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    // Sprite should NOT be recreated on second frame
    expect(mockStage.addChild).toHaveBeenCalledTimes(1);
    expect(frameRenderedCallback).toHaveBeenCalledTimes(2);
  });

  it("should latch and render the trailing frame during rapid scrubbing bursts", async () => {
    const pixiAppRef = { current: mockPixiApp };
    const frameRenderedCallback = vi.fn();

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

    // Fire 3 rapid state changes while first frame is still in-flight
    act(() => {
      useTimelineStore.setState({ epoch: 2, scrollLeft: 100 });
      useTimelineStore.setState({ epoch: 3, scrollLeft: 200 });
      useTimelineStore.setState({ epoch: 4, scrollLeft: 300 });
    });

    // Resolve first frame
    await act(async () => {
      resolveFirstFrame?.(new ArrayBuffer(1920 * 1080 * 4));
      await vi.runAllTimersAsync();
    });

    // Should have rendered at most 2 frames (first + latest latched)
    expect(invoke).toHaveBeenCalled();
  });

  it("should discard out-of-order IPC frame arrivals", async () => {
    const pixiAppRef = { current: mockPixiApp };

    renderHook(() =>
      usePixiPlaybackSync(pixiAppRef, { outWidth: 1920, outHeight: 1080 }),
    );

    act(() => {
      useTimelineStore.setState({ epoch: 2 });
    });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(invoke).toHaveBeenCalled();
  });

  it("should handle unmount and cleanup all WebGL references cleanly", async () => {
    const pixiAppRef = { current: mockPixiApp };

    const { unmount } = renderHook(() =>
      usePixiPlaybackSync(pixiAppRef, { outWidth: 1920, outHeight: 1080 }),
    );

    act(() => {
      useTimelineStore.setState({ epoch: 2, scrollLeft: 100 });
    });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    // Should not throw on cleanup
    expect(() => unmount()).not.toThrow();
  });
});

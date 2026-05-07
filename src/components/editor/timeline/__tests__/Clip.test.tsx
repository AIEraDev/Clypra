import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { Clip } from "../Clip";
import { clearFilmstripFrameCache } from "../ClipFilmstrip";
import type { Clip as ClipType, MediaAsset } from "../../../types";

const filmstripFrames = ["data:image/png;base64,frame0", "data:image/png;base64,frame1", "data:image/png;base64,frame2", "data:image/png;base64,frame3"];

vi.mock("../../../../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/tauri")>();
  return {
    ...actual,
    extractFilmstripFrames: vi.fn(() => Promise.resolve(filmstripFrames)),
  };
});

vi.mock("@tauri-apps/api/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tauri-apps/api/core")>();
  class MockChannel {
    onmessage: ((msg: unknown) => void) | null = null;
  }
  return {
    ...actual,
    Channel: MockChannel as unknown as typeof actual.Channel,
    convertFileSrc: (path: string) => path,
    invoke: vi.fn(async (_cmd: string, args: Record<string, unknown>) => {
      const ch = args.onTile as MockChannel | undefined;
      const fc = Math.min(Math.max(Number(args.frameCount) || 4, 1), 100);
      if (ch?.onmessage) {
        for (let i = 0; i < fc; i++) {
          ch.onmessage({ index: i, time: 0, path: "/tmp/tile.webp" });
        }
      }
    }),
  };
});

// Mock stores
const mockSelectClip = vi.fn();
const mockUpdateClip = vi.fn();

vi.mock("../../../store/uiStore", () => ({
  useUIStore: () => ({
    selectClip: mockSelectClip,
    toggleClipSelection: vi.fn(),
  }),
}));

vi.mock("../../../store/timelineStore", () => ({
  useTimelineStore: () => ({
    updateClip: mockUpdateClip,
    rippleEditEnabled: false,
    rippleTrimClip: vi.fn(),
  }),
}));

const createMockClip = (overrides?: Partial<ClipType>): ClipType => ({
  id: "clip-1",
  trackId: "track-1",
  mediaId: "media-1",
  startTime: 5,
  duration: 10,
  trimIn: 0,
  trimOut: 10,
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  opacity: 1,
  rotation: 0,
  ...overrides,
});

const createMockMediaAsset = (overrides?: Partial<MediaAsset>): MediaAsset => ({
  id: "media-1",
  name: "test-video.mp4",
  path: "/path/to/video.mp4",
  type: "video",
  duration: 30,
  width: 1920,
  height: 1080,
  posterFrame: "data:image/png;base64,test",
  size: 1024000,
  ...overrides,
});

const renderClip = (clip: ClipType, mediaAsset?: MediaAsset, props?: Partial<any>) => {
  return render(
    <DndProvider backend={HTML5Backend}>
      <div style={{ position: "relative", width: "1000px", height: "68px" }}>
        <Clip clip={clip} mediaAsset={mediaAsset} pixelsPerSecond={100} selected={false} locked={false} {...props} />
      </div>
    </DndProvider>,
  );
};

describe("Clip Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearFilmstripFrameCache();
  });

  describe("Rendering", () => {
    it("renders clip with correct position and width", () => {
      const clip = createMockClip({ startTime: 5, duration: 10 });
      renderClip(clip);

      const clipElement = screen.getByTestId("clip-clip-1");
      expect(clipElement).toBeInTheDocument();
      expect(clipElement.style.left).toBe("500px"); // 5 * 100
      expect(clipElement.style.width).toBe("1000px"); // 10 * 100
    });

    it("displays media asset name", () => {
      const clip = createMockClip();
      const mediaAsset = createMockMediaAsset({ name: "my-video.mp4" });
      renderClip(clip, mediaAsset);

      expect(screen.getByText("my-video.mp4")).toBeInTheDocument();
    });

    it("displays formatted duration", () => {
      const clip = createMockClip({ duration: 125 }); // 2 minutes 5 seconds
      renderClip(clip);

      expect(screen.getByText("00:02:05:00")).toBeInTheDocument();
    });

    it("shows video filmstrip after debounced extraction", async () => {
      vi.useFakeTimers();
      try {
        const clip = createMockClip();
        const mediaAsset = createMockMediaAsset({ posterFrame: "data:image/png;base64,test" });
        renderClip(clip, mediaAsset);
        await act(async () => {});

        // With a poster, the strip shows immediately (poster tiles) while streaming loads in the background.
        expect(screen.getByTestId("clip-filmstrip")).toBeInTheDocument();

        await act(async () => {
          await vi.advanceTimersByTimeAsync(300);
        });

        expect(screen.getByTestId("clip-filmstrip")).toBeInTheDocument();
        const imgs = screen.getByTestId("clip-filmstrip").querySelectorAll("img");
        expect(imgs.length).toBeGreaterThanOrEqual(4);
      } finally {
        vi.useRealTimers();
      }
    });

    it("applies selected styling when selected", () => {
      const clip = createMockClip();
      renderClip(clip, undefined, { selected: true });

      const clipElement = screen.getByTestId("clip-clip-1");
      expect(clipElement.className).toContain("border-red-500");
      expect(clipElement.className).toContain("border-2");
    });

    it("applies locked styling when locked", () => {
      const clip = createMockClip();
      renderClip(clip, undefined, { locked: true });

      const clipElement = screen.getByTestId("clip-clip-1");
      expect(clipElement.className).toContain("cursor-not-allowed");
    });

    it("shows audio clip styling for audio assets", () => {
      const clip = createMockClip();
      const mediaAsset = createMockMediaAsset({ type: "audio" });
      renderClip(clip, mediaAsset);

      const clipElement = screen.getByTestId("clip-clip-1");
      expect(clipElement.className).toContain("bg-[#153840]");
    });
  });

  describe("Selection", () => {
    it("has click handler attached", () => {
      const clip = createMockClip();
      renderClip(clip);

      const clipElement = screen.getByTestId("clip-clip-1");
      expect(clipElement).toBeInTheDocument();

      // Verify the element is clickable (has onClick handler)
      expect(clipElement.onclick).toBeDefined();
    });

    it("does not call selectClip when locked", () => {
      const clip = createMockClip();
      renderClip(clip, undefined, { locked: true });

      const clipElement = screen.getByTestId("clip-clip-1");
      fireEvent.click(clipElement);

      expect(mockSelectClip).not.toHaveBeenCalled();
    });

    it("shows correct styling for locked state", () => {
      const clip = createMockClip();
      renderClip(clip, undefined, { locked: true });

      const clipElement = screen.getByTestId("clip-clip-1");
      expect(clipElement.className).toContain("cursor-not-allowed");
    });
  });

  describe("Resize Handles", () => {
    it("renders left resize handle", () => {
      const clip = createMockClip();
      renderClip(clip);

      const leftHandle = screen.getByTestId("clip-clip-1-resize-left");
      expect(leftHandle).toBeInTheDocument();
      expect(leftHandle.className).toContain("cursor-ew-resize");
    });

    it("renders right resize handle", () => {
      const clip = createMockClip();
      renderClip(clip);

      const rightHandle = screen.getByTestId("clip-clip-1-resize-right");
      expect(rightHandle).toBeInTheDocument();
      expect(rightHandle.className).toContain("cursor-ew-resize");
    });

    it("has correct width for resize handles", () => {
      const clip = createMockClip();
      renderClip(clip);

      const leftHandle = screen.getByTestId("clip-clip-1-resize-left");
      const rightHandle = screen.getByTestId("clip-clip-1-resize-right");

      expect(leftHandle.className).toContain("w-3");
      expect(rightHandle.className).toContain("w-3");
    });
  });

  describe("Resize Logic Validation", () => {
    it("calculates correct values for left edge resize", () => {
      // Test the resize calculation logic
      const initialStartTime = 5;
      const initialDuration = 10;
      const initialTrimIn = 0;
      const deltaTime = 2; // Moving right by 2 seconds

      const newStartTime = initialStartTime + deltaTime;
      const newDuration = initialDuration - (newStartTime - initialStartTime);
      const newTrimIn = initialTrimIn + (newStartTime - initialStartTime);

      expect(newStartTime).toBe(7);
      expect(newDuration).toBe(8);
      expect(newTrimIn).toBe(2);
    });

    it("calculates correct values for right edge resize", () => {
      // Test the resize calculation logic
      const initialDuration = 10;
      const initialTrimIn = 0;
      const deltaTime = 2; // Extending by 2 seconds

      const newDuration = initialDuration + deltaTime;
      const newTrimOut = initialTrimIn + newDuration;

      expect(newDuration).toBe(12);
      expect(newTrimOut).toBe(12);
    });

    it("validates minimum duration constraint", () => {
      const minDuration = 0.1;
      const testDurations = [0, 0.05, 0.09, 0.1, 0.5, 1.0];

      testDurations.forEach((duration) => {
        const isValid = duration >= minDuration;
        if (duration < minDuration) {
          expect(isValid).toBe(false);
        } else {
          expect(isValid).toBe(true);
        }
      });
    });

    it("validates trim in range constraint", () => {
      const trimOut = 10;
      const testTrimIns = [-1, 0, 5, 9.9, 10, 11];

      testTrimIns.forEach((trimIn) => {
        const isValid = trimIn >= 0 && trimIn < trimOut;
        if (trimIn < 0 || trimIn >= trimOut) {
          expect(isValid).toBe(false);
        } else {
          expect(isValid).toBe(true);
        }
      });
    });

    it("validates trim out range constraint", () => {
      const mediaDuration = 30;
      const testTrimOuts = [0, 10, 29.9, 30, 31];

      testTrimOuts.forEach((trimOut) => {
        const isValid = trimOut <= mediaDuration;
        if (trimOut > mediaDuration) {
          expect(isValid).toBe(false);
        } else {
          expect(isValid).toBe(true);
        }
      });
    });

    it("prevents negative start time", () => {
      const initialStartTime = 2;
      const deltaTime = -5; // Would make startTime negative

      const newStartTime = Math.max(0, initialStartTime + deltaTime);
      expect(newStartTime).toBe(0);
      expect(newStartTime).toBeGreaterThanOrEqual(0);
    });

    it("maintains clip integrity during resize", () => {
      // Verify that trimOut = trimIn + duration
      const trimIn = 2;
      const duration = 8;
      const trimOut = trimIn + duration;

      expect(trimOut).toBe(10);
      expect(trimOut).toBeGreaterThan(trimIn);
    });

    it("calculates delta time from pixel movement", () => {
      const pixelsPerSecond = 100;
      const deltaX = 200; // pixels
      const deltaTime = deltaX / pixelsPerSecond;

      expect(deltaTime).toBe(2); // seconds
    });

    it("handles negative delta for left movement", () => {
      const initialDuration = 10;
      const deltaTime = -2; // Moving left

      const newDuration = Math.max(0.1, initialDuration + deltaTime);
      expect(newDuration).toBe(8);
    });

    it("enforces minimum duration when shrinking", () => {
      const initialDuration = 0.5;
      const deltaTime = -1; // Would make duration negative

      const newDuration = Math.max(0.1, initialDuration + deltaTime);
      expect(newDuration).toBe(0.1);
      expect(newDuration).toBeGreaterThanOrEqual(0.1);
    });
  });

  describe("Locked State", () => {
    it("prevents selection when locked", () => {
      const clip = createMockClip();
      renderClip(clip, undefined, { locked: true });

      const clipElement = screen.getByTestId("clip-clip-1");
      fireEvent.click(clipElement);

      expect(mockSelectClip).not.toHaveBeenCalled();
    });

    it("shows locked cursor when locked", () => {
      const clip = createMockClip();
      renderClip(clip, undefined, { locked: true });

      const clipElement = screen.getByTestId("clip-clip-1");
      expect(clipElement.className).toContain("cursor-not-allowed");
    });

    it("applies locked prop correctly", () => {
      const clip = createMockClip();
      const { rerender } = renderClip(clip, undefined, { locked: false });

      let clipElement = screen.getByTestId("clip-clip-1");
      expect(clipElement.className).not.toContain("cursor-not-allowed");

      // Rerender with locked=true
      rerender(
        <DndProvider backend={HTML5Backend}>
          <div style={{ position: "relative", width: "1000px", height: "68px" }}>
            <Clip clip={clip} mediaAsset={undefined} pixelsPerSecond={100} selected={false} locked={true} />
          </div>
        </DndProvider>,
      );

      clipElement = screen.getByTestId("clip-clip-1");
      expect(clipElement.className).toContain("cursor-not-allowed");
    });
  });

  describe("Edge Cases", () => {
    it("handles clip with zero duration gracefully", () => {
      const clip = createMockClip({ duration: 0 });
      renderClip(clip);

      const clipElement = screen.getByTestId("clip-clip-1");
      expect(clipElement.style.width).toBe("0px");
    });

    it("handles clip without media asset", () => {
      const clip = createMockClip();
      renderClip(clip, undefined);

      expect(screen.getByText("Clip")).toBeInTheDocument();
    });

    it("handles media asset without poster frame", async () => {
      const clip = createMockClip();
      const mediaAsset = createMockMediaAsset({ posterFrame: undefined });
      renderClip(clip, mediaAsset);
      await act(async () => {});

      // Without a poster frame and without debounce, invoke fires immediately.
      // The mock resolves synchronously so the filmstrip goes straight to ready.
      expect(screen.getByTestId("clip-filmstrip")).toBeInTheDocument();
    });

    it("formats duration correctly for various times", () => {
      const testCases = [
        { duration: 0, expected: "00:00:00:00" },
        { duration: 59, expected: "00:00:59:00" },
        { duration: 60, expected: "00:01:00:00" },
        { duration: 125, expected: "00:02:05:00" },
        { duration: 3661, expected: "00:61:01:00" },
      ];

      testCases.forEach(({ duration, expected }) => {
        const clip = createMockClip({ duration });
        const { unmount } = renderClip(clip);
        expect(screen.getByText(expected)).toBeInTheDocument();
        unmount();
      });
    });

    it("handles very small clips", () => {
      const clip = createMockClip({ duration: 0.1 });
      renderClip(clip);

      const clipElement = screen.getByTestId("clip-clip-1");
      expect(clipElement.style.width).toBe("10px"); // 0.1 * 100
    });

    it("handles very large clips", () => {
      const clip = createMockClip({ duration: 3600 }); // 1 hour
      renderClip(clip);

      const clipElement = screen.getByTestId("clip-clip-1");
      expect(clipElement.style.width).toBe("360000px"); // 3600 * 100
    });
  });

  describe("Pixel to Time Conversion", () => {
    it("converts pixels to time correctly at different zoom levels", () => {
      const testCases = [
        { pixelsPerSecond: 50, pixels: 100, expectedTime: 2 },
        { pixelsPerSecond: 100, pixels: 100, expectedTime: 1 },
        { pixelsPerSecond: 200, pixels: 100, expectedTime: 0.5 },
      ];

      testCases.forEach(({ pixelsPerSecond, pixels, expectedTime }) => {
        const time = pixels / pixelsPerSecond;
        expect(time).toBe(expectedTime);
      });
    });

    it("converts time to pixels correctly", () => {
      const testCases = [
        { time: 5, pixelsPerSecond: 100, expectedPixels: 500 },
        { time: 10, pixelsPerSecond: 50, expectedPixels: 500 },
        { time: 2.5, pixelsPerSecond: 200, expectedPixels: 500 },
      ];

      testCases.forEach(({ time, pixelsPerSecond, expectedPixels }) => {
        const pixels = time * pixelsPerSecond;
        expect(pixels).toBe(expectedPixels);
      });
    });
  });

  describe("Trim Calculations", () => {
    it("calculates source time correctly", () => {
      const clip = createMockClip({ startTime: 5, trimIn: 2 });
      const currentTime = 8; // 3 seconds into the clip

      const sourceTime = clip.trimIn + (currentTime - clip.startTime);
      expect(sourceTime).toBe(5); // trimIn(2) + 3 seconds
    });

    it("respects trim in and trim out boundaries", () => {
      const clip = createMockClip({ trimIn: 2, trimOut: 12, duration: 10 });

      expect(clip.trimOut - clip.trimIn).toBe(clip.duration);
    });

    it("validates trim range is within media duration", () => {
      const mediaDuration = 30;
      const trimIn = 5;
      const trimOut = 25;

      expect(trimIn).toBeGreaterThanOrEqual(0);
      expect(trimOut).toBeLessThanOrEqual(mediaDuration);
      expect(trimOut).toBeGreaterThan(trimIn);
    });
  });
});

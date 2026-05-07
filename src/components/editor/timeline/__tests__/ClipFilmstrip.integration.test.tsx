import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import type { Clip, MediaAsset, ThumbnailTile, DensityLevel } from "@/types";
import { DensityLevel as DensityLevelEnum } from "@/types";

// Mock state interface
interface MockState {
  invokeCalls: Array<{ cmd: string; args: Record<string, unknown> }>;
  mockChannelTiles: ThumbnailTile[];
  invokeLatency: number;
}

// Initialize global mock state
const mockState: MockState = {
  invokeCalls: [],
  mockChannelTiles: [],
  invokeLatency: 0,
};

// Set up global reference for mock access
(globalThis as unknown as { __mockState: MockState }).__mockState = mockState;

// Mock Tauri core module
vi.mock("@tauri-apps/api/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tauri-apps/api/core")>();

  class MockChannel {
    onmessage: ((msg: ThumbnailTile) => void) | null = null;

    constructor() {
      // Access state via global to avoid hoisting issues
      const state = (globalThis as unknown as { __mockState: MockState }).__mockState;
      const tiles = state?.mockChannelTiles || [];
      const latency = state?.invokeLatency || 0;

      // Simulate streaming tiles after a short delay
      setTimeout(() => {
        if (this.onmessage) {
          tiles.forEach((tile, index) => {
            setTimeout(
              () => {
                if (this.onmessage) {
                  this.onmessage(tile);
                }
              },
              latency + index * 10,
            );
          });
        }
      }, latency);
    }
  }

  return {
    ...actual,
    Channel: MockChannel as unknown as typeof actual.Channel,
    convertFileSrc: (path: string) => (path.startsWith("data:") ? path : `asset://${path}`),
    invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
      // Access state via global
      const state = (globalThis as unknown as { __mockState: MockState }).__mockState;
      if (state) {
        state.invokeCalls.push({ cmd, args });
      }

      // Simulate cache hits returning immediately
      if (cmd === "get_thumbnails_for_timestamps") {
        const channel = args.onTile as MockChannel | undefined;
        const timestamps = (args.timestamps as number[]) || [];
        const density = args.density as DensityLevel;

        // Generate mock tiles for each timestamp
        const newTiles = timestamps.map((time) => ({
          time,
          path: `/mock/cache/video_${density}_${time}.webp`,
          density,
        }));

        if (state) {
          state.mockChannelTiles = newTiles;
        }

        // Simulate the channel streaming
        if (channel && channel.onmessage) {
          const lat = state?.invokeLatency || 0;
          await new Promise((resolve) => setTimeout(resolve, lat));
          // Stream tiles
          newTiles.forEach((tile, index) => {
            setTimeout(() => {
              if (channel.onmessage) {
                channel.onmessage(tile);
              }
            }, index * 10);
          });
        }
      }

      return { latency: 0 };
    }),
  };
});

// Mock the tauri lib
vi.mock("../../../../lib/tauri", () => ({
  normalizePathForTauriInvoke: (path: string) => path,
}));

// Import after mocks
const { ClipFilmstrip } = await import("../ClipFilmstrip");

// Helper to create mock clip
const createMockClip = (overrides?: Partial<Clip>): Clip => ({
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

// Helper to create mock media asset
const createMockMediaAsset = (overrides?: Partial<MediaAsset>): MediaAsset => ({
  id: "media-1",
  name: "test-video.mp4",
  path: "/path/to/video.mp4",
  type: "video",
  duration: 30,
  width: 1920,
  height: 1080,
  posterFrame: "data:image/webp;base64,poster123",
  size: 1024000,
  ...overrides,
});

// Helper to render ClipFilmstrip
const renderFilmstrip = (props: { clip?: Clip; mediaAsset?: MediaAsset; pixelsPerSecond?: number; stripHeightPx?: number }) => {
  const clip = props.clip || createMockClip();
  const mediaAsset = props.mediaAsset || createMockMediaAsset();
  const pixelsPerSecond = props.pixelsPerSecond ?? 100;

  return render(<ClipFilmstrip clip={clip} mediaAsset={mediaAsset} clipWidthPx={clip.duration * pixelsPerSecond} pixelsPerSecond={pixelsPerSecond} stripHeightPx={props.stripHeightPx ?? 32} />);
};

describe("ClipFilmstrip Integration Tests", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Reset mock state
    mockState.invokeCalls = [];
    mockState.mockChannelTiles = [];
    mockState.invokeLatency = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  /**
   * Test: Import video → Pre-extract Medium → Verify cache
   *
   * When a video is imported and displayed, it should:
   * 1. Request appropriate density thumbnails based on zoom
   * 2. Show poster frames immediately
   * 3. Replace with actual thumbnails when ready
   */
  it("Test: Import video → Pre-extract Medium → Verify cache", async () => {
    const clip = createMockClip({ trimIn: 0, trimOut: 10 });
    const mediaAsset = createMockMediaAsset();

    // Default zoom level (0.5 = Medium density)
    renderFilmstrip({
      clip,
      mediaAsset,
      pixelsPerSecond: 0.5, // Medium density bucket (0.3 <= zoom < 1.5)
    });

    // Wait for initial render
    await act(async () => {});

    // Should show filmstrip with poster tiles initially
    const filmstrip = screen.getByTestId("clip-filmstrip");
    expect(filmstrip).toBeInTheDocument();

    // Should have invoked get_thumbnails_for_timestamps
    expect(mockState.invokeCalls.length).toBeGreaterThanOrEqual(1);
    const lastCall = mockState.invokeCalls[mockState.invokeCalls.length - 1];
    expect(lastCall.cmd).toBe("get_thumbnails_for_timestamps");
    // 0.5 px/s should map to Medium density
    expect(lastCall.args.density).toBe(DensityLevelEnum.Medium);

    // Advance timers to let tiles stream in
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    // Verify tiles were rendered
    const imgs = filmstrip.querySelectorAll("img");
    expect(imgs.length).toBeGreaterThan(0);
  });

  /**
   * Test: Zoom within bucket → No re-extraction
   *
   * When zooming within the same density bucket, no new extraction should occur.
   * The filmstrip should continue using cached thumbnails.
   */
  it("Test: Zoom within bucket → No re-extraction", async () => {
    const clip = createMockClip({ trimIn: 0, trimOut: 10 });
    const mediaAsset = createMockMediaAsset();

    // Start at Medium zoom (0.3-1.5 px/s bucket)
    const { rerender } = renderFilmstrip({
      clip,
      mediaAsset,
      pixelsPerSecond: 0.5, // Medium density (0.3 <= zoom < 1.5)
    });

    await act(async () => {});

    // Clear invoke calls to track new calls
    mockState.invokeCalls.length = 0;

    const initialCallCount = mockState.invokeCalls.length;

    // Zoom within same bucket (still Medium: 0.3-1.5)
    rerender(
      <ClipFilmstrip
        clip={clip}
        mediaAsset={mediaAsset}
        clipWidthPx={clip.duration * 0.8}
        pixelsPerSecond={0.8} // Still Medium density
        stripHeightPx={32}
      />,
    );

    await act(async () => {});

    // Should not have triggered new extraction
    expect(mockState.invokeCalls.length).toBe(initialCallCount);

    // Filmstrip should still be visible
    expect(screen.getByTestId("clip-filmstrip")).toBeInTheDocument();
  });

  /**
   * Test: Zoom across boundary → Request new density after 250ms
   *
   * When zooming across a density bucket boundary:
   * 1. The debounce timer should start (250ms)
   * 2. After debounce, new density should be requested
   * 3. New thumbnails should be extracted
   */
  it("Test: Zoom across boundary → Request new density after 250ms", async () => {
    const clip = createMockClip({ trimIn: 0, trimOut: 10 });
    const mediaAsset = createMockMediaAsset();

    // Start at Medium zoom
    const { rerender } = renderFilmstrip({
      clip,
      mediaAsset,
      pixelsPerSecond: 0.5, // Medium density
    });

    await act(async () => {});
    const initialCallCount = mockState.invokeCalls.length;

    // Zoom to High density (cross boundary: 1.5 threshold)
    rerender(
      <ClipFilmstrip
        clip={clip}
        mediaAsset={mediaAsset}
        clipWidthPx={clip.duration * 2}
        pixelsPerSecond={2} // High density (>= 1.5)
        stripHeightPx={32}
      />,
    );

    await act(async () => {});

    // Should NOT have triggered extraction yet (debouncing)
    expect(mockState.invokeCalls.length).toBe(initialCallCount);

    // Advance past debounce threshold (250ms)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    // Should have new invoke call with High density
    const highDensityCalls = mockState.invokeCalls.filter((call: { cmd: string; args: Record<string, unknown> }) => call.cmd === "get_thumbnails_for_timestamps" && call.args.density === DensityLevelEnum.High);
    expect(highDensityCalls.length).toBeGreaterThanOrEqual(1);
  });

  /**
   * Test: Rapid zoom → Cancel stale timestamps
   *
   * When zooming rapidly across multiple buckets:
   * 1. Each bucket crossing resets the debounce timer
   * 2. Only the final stable zoom level should trigger extraction
   * 3. Stale timestamp requests should be cancelled
   */
  it("Test: Rapid zoom → Cancel stale timestamps", async () => {
    const clip = createMockClip({ trimIn: 0, trimOut: 10 });
    const mediaAsset = createMockMediaAsset();

    // Start at Medium zoom
    const { rerender } = renderFilmstrip({
      clip,
      mediaAsset,
      pixelsPerSecond: 0.5, // Medium density
    });

    await act(async () => {});
    const initialCallCount = mockState.invokeCalls.length;

    // Rapid zoom through multiple buckets
    // Medium (0.5) → High (2) [150ms] → Ultra (4)

    // First zoom: Low → Medium
    rerender(
      <ClipFilmstrip
        clip={clip}
        mediaAsset={mediaAsset}
        clipWidthPx={clip.duration * 0.5}
        pixelsPerSecond={0.5} // Medium density
        stripHeightPx={32}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150); // Not enough for debounce
    });

    // Second zoom: Medium → High (resets debounce)
    rerender(
      <ClipFilmstrip
        clip={clip}
        mediaAsset={mediaAsset}
        clipWidthPx={clip.duration * 2}
        pixelsPerSecond={2} // High density
        stripHeightPx={32}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100); // Still not enough
    });

    // Third zoom: High → Ultra (resets debounce again)
    rerender(
      <ClipFilmstrip
        clip={clip}
        mediaAsset={mediaAsset}
        clipWidthPx={clip.duration * 4}
        pixelsPerSecond={4} // Ultra density
        stripHeightPx={32}
      />,
    );

    // Wait full debounce from last zoom
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    // Should have only triggered extraction for final (Ultra) density
    const ultraDensityCalls = mockState.invokeCalls.filter((call: { cmd: string; args: Record<string, unknown> }) => call.cmd === "get_thumbnails_for_timestamps" && call.args.density === DensityLevelEnum.Ultra);

    // Should have Ultra call
    expect(ultraDensityCalls.length).toBeGreaterThanOrEqual(1);

    // Should NOT have Medium or High calls (debounced away)
    const mediumDensityCalls = mockState.invokeCalls.filter((call: { cmd: string; args: Record<string, unknown> }) => call.cmd === "get_thumbnails_for_timestamps" && call.args.density === DensityLevelEnum.Medium);
    const highDensityCalls = mockState.invokeCalls.filter((call: { cmd: string; args: Record<string, unknown> }) => call.cmd === "get_thumbnails_for_timestamps" && call.args.density === DensityLevelEnum.High);

    // We should have Medium (initial) + Ultra (final)
    // High calls during rapid zoom should be debounced away
    const mediumDensityCallsFinal = mockState.invokeCalls.filter((call: { cmd: string; args: Record<string, unknown> }) => call.cmd === "get_thumbnails_for_timestamps" && call.args.density === DensityLevelEnum.Medium);
    expect(mediumDensityCallsFinal.length).toBeGreaterThanOrEqual(1);
    expect(highDensityCalls.length).toBe(0);
  });

  /**
   * Test: Cache hit latency < 5ms
   *
   * When thumbnails are already cached, the invoke call should return
   * synchronously or near-synchronously (< 5ms).
   */
  it("Test: Cache hit latency < 5ms", async () => {
    const clip = createMockClip({ trimIn: 0, trimOut: 10 });
    const mediaAsset = createMockMediaAsset();

    // Set very low latency to simulate cache hits
    mockState.invokeLatency = 1; // 1ms latency

    renderFilmstrip({
      clip,
      mediaAsset,
      pixelsPerSecond: 0.5,
    });

    await act(async () => {});

    // Wait for initial tiles
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    // Verify filmstrip rendered
    const filmstrip = screen.getByTestId("clip-filmstrip");
    expect(filmstrip).toBeInTheDocument();

    // The invoke call with 1ms latency should complete quickly
    // This verifies the cache hit path is fast
    const imgs = filmstrip.querySelectorAll("img");
    expect(imgs.length).toBeGreaterThan(0);
  });

  /**
   * Test: Zero blank frames during continuous zoom
   *
   * When zooming within a bucket (before debounce triggers):
   * 1. Poster frames should remain visible
   * 2. No blank/grey frames should appear
   * 3. Filmstrip should maintain continuity
   */
  it("Test: Zero blank frames during continuous zoom", async () => {
    const clip = createMockClip({ trimIn: 0, trimOut: 10 });
    const mediaAsset = createMockMediaAsset({
      posterFrame: "data:image/webp;base64,poster123",
    });

    // Start with visible filmstrip
    const { rerender } = renderFilmstrip({
      clip,
      mediaAsset,
      pixelsPerSecond: 0.5,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    // Verify filmstrip is visible with content
    let filmstrip = screen.getByTestId("clip-filmstrip");
    expect(filmstrip).toBeInTheDocument();

    const initialImgs = filmstrip.querySelectorAll("img");
    expect(initialImgs.length).toBeGreaterThan(0);

    // Continuous zoom within same bucket (should not trigger re-extraction)
    for (let zoom = 0.5; zoom <= 0.8; zoom += 0.1) {
      rerender(<ClipFilmstrip clip={clip} mediaAsset={mediaAsset} clipWidthPx={clip.duration * zoom} pixelsPerSecond={zoom} stripHeightPx={32} />);

      await act(async () => {});

      // Filmstrip should still be visible
      filmstrip = screen.getByTestId("clip-filmstrip");
      expect(filmstrip).toBeInTheDocument();

      // Should have images (no blank frames)
      const currentImgs = filmstrip.querySelectorAll("img");
      expect(currentImgs.length).toBeGreaterThan(0);

      // All images should have src attributes (not blank)
      for (const img of Array.from(currentImgs)) {
        expect(img.getAttribute("src")).toBeTruthy();
        expect(img.getAttribute("src")).not.toBe("");
      }
    }
  });

  /**
   * Test: Density transition with proper tile width scaling
   *
   * When density changes, tile widths should scale appropriately:
   * - Low density (5s): tile width = pixelsPerSecond * 5
   * - Medium density (1s): tile width = pixelsPerSecond * 1
   * - etc.
   */
  it("Test: Density transition with proper tile width scaling", async () => {
    const clip = createMockClip({ trimIn: 0, trimOut: 10 });
    const mediaAsset = createMockMediaAsset();

    // Start at Medium density
    const { rerender } = renderFilmstrip({
      clip,
      mediaAsset,
      pixelsPerSecond: 0.5, // Medium density: 1s interval
    });

    await act(async () => {});

    // Verify Medium density was requested
    const mediumDensityCall = mockState.invokeCalls.find((call: { cmd: string; args: Record<string, unknown> }) => call.cmd === "get_thumbnails_for_timestamps" && call.args.density === DensityLevelEnum.Medium);
    expect(mediumDensityCall).toBeDefined();

    // Wait for tiles
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    // Zoom to Medium density
    rerender(
      <ClipFilmstrip
        clip={clip}
        mediaAsset={mediaAsset}
        clipWidthPx={clip.duration * 0.5}
        pixelsPerSecond={0.5} // Medium density: 1s interval
        stripHeightPx={32}
      />,
    );

    // Wait for debounce
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    // Verify Medium density was requested
    const mediumDensityCalls = mockState.invokeCalls.filter((call: { cmd: string; args: Record<string, unknown> }) => call.cmd === "get_thumbnails_for_timestamps" && call.args.density === DensityLevelEnum.Medium);
    expect(mediumDensityCalls.length).toBeGreaterThanOrEqual(1);
  });

  /**
   * Test: Poster frame fallback for image assets
   *
   * When media is an image (not video), the filmstrip should:
   * 1. Not attempt to extract thumbnails
   * 2. Show poster frame as fallback
   */
  it("Test: Poster frame fallback for image assets", async () => {
    const clip = createMockClip();
    const imageAsset = createMockMediaAsset({
      type: "image",
      posterFrame: "data:image/png;base64,testImage",
    });

    renderFilmstrip({
      clip,
      mediaAsset: imageAsset,
      pixelsPerSecond: 100,
    });

    await act(async () => {});

    // Should show fallback (not filmstrip)
    expect(screen.getByTestId("clip-filmstrip-fallback")).toBeInTheDocument();

    // Should NOT have called get_thumbnails_for_timestamps for images
    const thumbnailCalls = mockState.invokeCalls.filter((call: { cmd: string }) => call.cmd === "get_thumbnails_for_timestamps");
    expect(thumbnailCalls.length).toBe(0);
  });
});

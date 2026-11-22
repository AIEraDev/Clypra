import { describe, it, expect } from "vitest";
import {
  computeViewportWindow,
  filterClipsInWindow,
  shouldBypassWindowing,
  type ClipBounds,
} from "../viewportWindow";

describe("Timeline Viewport Windowing Integration", () => {
  // Simulate 100 clips across 500 seconds on a single track
  const generateClips = (trackId: string, count: number): ClipBounds[] => {
    const list: ClipBounds[] = [];
    for (let i = 0; i < count; i++) {
      list.push({
        id: `clip-${trackId}-${i}`,
        trackId,
        startTime: i * 5, // clip every 5 seconds: 0, 5, 10, ... 495
        duration: 4,      // 4-second clips (1s gap between each)
      });
    }
    return list;
  };

  const allClips = generateClips("track-1", 100); // 0 to 499s
  const pixelsPerSecond = 100; // 100 px = 1s
  const viewportWidthPx = 1200; // 12 seconds visible
  const clipStartOffsetPx = 20;

  it("reduces rendered clip count by over 80% for standard viewport at t=0", () => {
    const scrollLeft = 0;
    const window = computeViewportWindow(
      scrollLeft,
      viewportWidthPx,
      pixelsPerSecond,
      clipStartOffsetPx,
      3.0, // 3s buffer
    );

    // Visible span: [0, 12 + 3] = [0, 15]s
    // Clips in [0, 15]: clip-0 (0..4), clip-1 (5..9), clip-2 (10..14), clip-3 (15..19 touching boundary)
    const windowedClips = filterClipsInWindow(
      allClips,
      window.windowStart,
      window.windowEnd,
    );

    expect(windowedClips.length).toBeLessThan(6);
    expect(windowedClips.length).toBeGreaterThanOrEqual(3);
    expect(windowedClips.map((c) => c.id)).toContain("clip-track-1-0");
    expect(windowedClips.map((c) => c.id)).toContain("clip-track-1-1");
    expect(windowedClips.map((c) => c.id)).not.toContain("clip-track-1-50");
    expect(windowedClips.map((c) => c.id)).not.toContain("clip-track-1-99");
  });

  it("updates visible clips when scrolled further down the timeline", () => {
    // Scroll to 250s (pixel 25,000)
    const scrollLeft = 250 * pixelsPerSecond + clipStartOffsetPx;
    const window = computeViewportWindow(
      scrollLeft,
      viewportWidthPx,
      pixelsPerSecond,
      clipStartOffsetPx,
      3.0,
    );

    // Visible span roughly [247, 265]s
    const windowedClips = filterClipsInWindow(
      allClips,
      window.windowStart,
      window.windowEnd,
    );

    // Early clips are unmounted
    expect(windowedClips.map((c) => c.id)).not.toContain("clip-track-1-0");
    expect(windowedClips.map((c) => c.id)).not.toContain("clip-track-1-10");

    // Clip at 250s (i = 50: startTime = 250) is mounted
    expect(windowedClips.map((c) => c.id)).toContain("clip-track-1-50");
    // Late clips are unmounted
    expect(windowedClips.map((c) => c.id)).not.toContain("clip-track-1-90");
  });

  it("bypasses windowing and mounts all clips when a clip on the track is selected", () => {
    const scrollLeft = 0;
    const window = computeViewportWindow(
      scrollLeft,
      viewportWidthPx,
      pixelsPerSecond,
      clipStartOffsetPx,
      3.0,
    );

    // User selects clip-track-1-50 (at 250s) while viewport is at t=0
    const selectedClipIds = ["clip-track-1-50"];
    const bypass = shouldBypassWindowing(
      allClips,
      [],
      selectedClipIds,
    );

    expect(bypass).toBe(true);

    const renderedClips = bypass
      ? allClips
      : filterClipsInWindow(allClips, window.windowStart, window.windowEnd);

    // All clips remain mounted so revealSelectedClip can find its DOM element
    expect(renderedClips.length).toBe(100);
    expect(renderedClips.map((c) => c.id)).toContain("clip-track-1-50");
  });

  it("bypasses windowing when a clip on the track is actively being dragged", () => {
    const scrollLeft = 0;
    const window = computeViewportWindow(
      scrollLeft,
      viewportWidthPx,
      pixelsPerSecond,
      clipStartOffsetPx,
      3.0,
    );

    const draggingClipIds = ["clip-track-1-2"];
    const bypass = shouldBypassWindowing(
      allClips,
      draggingClipIds,
      [],
    );

    expect(bypass).toBe(true);

    const renderedClips = bypass
      ? allClips
      : filterClipsInWindow(allClips, window.windowStart, window.windowEnd);

    expect(renderedClips.length).toBe(100);
  });
});

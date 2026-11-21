import { describe, it, expect } from "vitest";
import {
  computeViewportWindow,
  filterClipsInWindow,
  filterClipsLinear,
  shouldBypassWindowing,
  DEFAULT_VIEWPORT_BUFFER_SECS,
  type ClipBounds,
} from "../viewportWindow";
import { TimelineIntervalTree } from "@/core/evaluation/spatialIndex";

describe("viewportWindow", () => {
  describe("computeViewportWindow", () => {
    it("computes buffered window accurately for standard timeline parameters", () => {
      // scrollLeft = 220px, offset = 20px -> rawStartPx = 200px
      // at 100 px/s -> rawStart = 2.0s
      // viewportWidthPx = 1000px -> viewportSpan = 10.0s -> rawEnd = 12.0s
      // buffer = 3s -> windowStart = max(0, 2 - 3) = 0s, windowEnd = 12 + 3 = 15s
      const window = computeViewportWindow(220, 1000, 100, 20, 3.0);
      expect(window.windowStart).toBe(0);
      expect(window.windowEnd).toBe(15.0);
    });

    it("clamps windowStart to 0 when buffer extends before t=0", () => {
      const window = computeViewportWindow(50, 500, 100, 20, 2.0);
      // rawStart = (50 - 20) / 100 = 0.3s
      // rawStart - 2.0 = -1.7s -> clamped to 0
      expect(window.windowStart).toBe(0);
      expect(window.windowEnd).toBeCloseTo(0.3 + 5.0 + 2.0, 5);
    });

    it("preserves positive windowStart when scrolled further down timeline", () => {
      // rawStart = (1020 - 20) / 100 = 10.0s
      // buffer = 2.0s -> windowStart = 8.0s
      // rawEnd = 10.0 + 5.0 = 15.0s -> windowEnd = 17.0s
      const window = computeViewportWindow(1020, 500, 100, 20, 2.0);
      expect(window.windowStart).toBe(8.0);
      expect(window.windowEnd).toBe(17.0);
    });

    it("handles zero or negative pixelsPerSecond gracefully", () => {
      const window = computeViewportWindow(100, 1000, 0, 20);
      expect(window.windowStart).toBe(0);
      expect(window.windowEnd).toBe(Infinity);

      const windowNeg = computeViewportWindow(100, 1000, -10, 20);
      expect(windowNeg.windowStart).toBe(0);
      expect(windowNeg.windowEnd).toBe(Infinity);
    });

    it("uses DEFAULT_VIEWPORT_BUFFER_SECS when buffer is omitted", () => {
      const window = computeViewportWindow(1020, 500, 100, 20);
      expect(window.windowStart).toBeCloseTo(10.0 - DEFAULT_VIEWPORT_BUFFER_SECS, 5);
      expect(window.windowEnd).toBeCloseTo(15.0 + DEFAULT_VIEWPORT_BUFFER_SECS, 5);
    });
  });

  describe("filterClipsInWindow & filterClipsLinear", () => {
    const sampleClips: ClipBounds[] = [
      { id: "c1", startTime: 0, duration: 2, trackId: "t1" },       // 0..2
      { id: "c2", startTime: 2.5, duration: 1.5, trackId: "t1" },   // 2.5..4.0
      { id: "c3", startTime: 5, duration: 5, trackId: "t1" },       // 5..10
      { id: "c4", startTime: 12, duration: 3, trackId: "t1" },      // 12..15
      { id: "c5", startTime: 20, duration: 5, trackId: "t1" },      // 20..25
    ];

    it("returns empty array when clips array is empty", () => {
      expect(filterClipsInWindow([], 0, 10)).toEqual([]);
      expect(filterClipsLinear([], 0, 10)).toEqual([]);
    });

    it("returns all clips when window is full span [0, Infinity]", () => {
      const res = filterClipsInWindow(sampleClips, 0, Infinity);
      expect(res).toBe(sampleClips);
    });

    it("filters clips correctly for a narrow window", () => {
      // Window [4, 11]:
      // c1: 0..2 (outside)
      // c2: 2.5..4.0 (touching boundary at 4.0: 4.0 > 4 is false -> excluded)
      // c3: 5..10 (inside)
      // c4: 12..15 (outside)
      // c5: 20..25 (outside)
      const res = filterClipsLinear(sampleClips, 4.0, 11.0);
      expect(res.map((c) => c.id)).toEqual(["c3"]);
    });

    it("includes clips that partially overlap left or right boundary", () => {
      // Window [3.0, 13.0]:
      // c1: 0..2 (outside)
      // c2: 2.5..4.0 (overlaps 3.0: ends at 4.0 > 3.0, starts at 2.5 < 13.0 -> included)
      // c3: 5..10 (inside)
      // c4: 12..15 (overlaps 13.0: starts at 12 < 13.0, ends at 15 > 3.0 -> included)
      // c5: 20..25 (outside)
      const res = filterClipsLinear(sampleClips, 3.0, 13.0);
      expect(res.map((c) => c.id)).toEqual(["c2", "c3", "c4"]);
    });

    it("matches between tree-based filter and linear filter", () => {
      const tree = new TimelineIntervalTree(sampleClips);
      const resTree = filterClipsInWindow(sampleClips, 3.0, 13.0, tree);
      const resLinear = filterClipsLinear(sampleClips, 3.0, 13.0);

      const treeIds = resTree.map((c) => c.id).sort();
      const linearIds = resLinear.map((c) => c.id).sort();
      expect(treeIds).toEqual(linearIds);
      expect(treeIds).toEqual(["c2", "c3", "c4"]);
    });

    it("includes clips spanning entirely across the window", () => {
      const longClip: ClipBounds = { id: "long", startTime: 1, duration: 30, trackId: "t1" };
      const clips = [longClip];
      const res = filterClipsLinear(clips, 10, 15);
      expect(res).toEqual([longClip]);
    });
  });

  describe("shouldBypassWindowing", () => {
    const trackClipIds = new Set(["c1", "c2", "c3"]);
    const trackClips = [
      { id: "c1", startTime: 0, duration: 2, trackId: "t1" },
      { id: "c2", startTime: 3, duration: 2, trackId: "t1" },
      { id: "c3", startTime: 6, duration: 2, trackId: "t1" },
    ];

    it("returns true when forceAll is set", () => {
      expect(shouldBypassWindowing(trackClipIds, [], [], true)).toBe(true);
      expect(shouldBypassWindowing(trackClips, [], [], true)).toBe(true);
    });

    it("returns true when a dragging clip is on this track", () => {
      expect(shouldBypassWindowing(trackClipIds, ["c2"], [])).toBe(true);
      expect(shouldBypassWindowing(trackClipIds, ["other-clip", "c1"], [])).toBe(true);
      expect(shouldBypassWindowing(trackClips, ["c2"], [])).toBe(true);
    });

    it("returns false when dragging clips are on other tracks", () => {
      expect(shouldBypassWindowing(trackClipIds, ["c99"], [])).toBe(false);
      expect(shouldBypassWindowing(trackClips, ["c99"], [])).toBe(false);
    });

    it("returns true when a selected clip is on this track", () => {
      expect(shouldBypassWindowing(trackClipIds, [], ["c3"])).toBe(true);
      expect(shouldBypassWindowing(trackClipIds, [], ["unrelated", "c1"])).toBe(true);
      expect(shouldBypassWindowing(trackClips, [], ["c3"])).toBe(true);
    });

    it("returns false when no dragging or selected clips are on this track", () => {
      expect(shouldBypassWindowing(trackClipIds, [], [])).toBe(false);
      expect(shouldBypassWindowing(trackClipIds, ["other1"], ["other2"])).toBe(false);
      expect(shouldBypassWindowing(trackClips, [], [])).toBe(false);
    });
  });
});

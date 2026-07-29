import { describe, expect, it, vi } from "vitest";
import { getActiveVideoClipsForTime } from "../exportUtils";
import type { Clip, MediaAsset, TransitionTimelineItem } from "../../../types";

const mockVideoAsset1: MediaAsset = {
  id: "asset1",
  name: "Video 1",
  path: "/path/to/video1.mp4",
  type: "video",
  duration: 10,
  size: 1000,
};

const mockVideoAsset2: MediaAsset = {
  id: "asset2",
  name: "Video 2",
  path: "/path/to/video2.mp4",
  type: "video",
  duration: 10,
  size: 1000,
};

const mockAssets: MediaAsset[] = [mockVideoAsset1, mockVideoAsset2];

const clip1: Clip = {
  id: "clip1",
  kind: "video",
  trackId: "t1",
  mediaId: "asset1",
  startTime: 0,
  duration: 5,
  trimIn: 0,
  trimOut: 5,
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  opacity: 1,
  rotation: 0,
};

const clip2: Clip = {
  id: "clip2",
  kind: "video",
  trackId: "t1",
  mediaId: "asset2",
  startTime: 5,
  duration: 5,
  trimIn: 0,
  trimOut: 5,
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  opacity: 1,
  rotation: 0,
};

const transition: TransitionTimelineItem = {
  id: "tr1",
  kind: "transition",
  type: "dissolve",
  fromItemId: "clip1",
  toItemId: "clip2",
  alignment: "center",
  easing: "linear",
  placement: {
    trackId: "t1",
    startTime: 4.5,
    duration: 1,
    role: "effect",
    zIndex: 9999,
  },
  effects: { effects: [], version: 0 },
};

describe("getActiveVideoClipsForTime", () => {
  it("returns only clip1 before transition window", () => {
    const active = getActiveVideoClipsForTime(2.0, [clip1, clip2], mockAssets, [transition]);
    expect(active.map((c) => c.id)).toEqual(["clip1"]);
  });

  it("returns both clip1 and clip2 during transition window before midpoint (e.g. 4.8s)", () => {
    const active = getActiveVideoClipsForTime(4.8, [clip1, clip2], mockAssets, [transition]);
    expect(active.map((c) => c.id).sort()).toEqual(["clip1", "clip2"]);
  });

  it("returns both clip1 and clip2 during transition window after midpoint (e.g. 5.2s)", () => {
    const active = getActiveVideoClipsForTime(5.2, [clip1, clip2], mockAssets, [transition]);
    expect(active.map((c) => c.id).sort()).toEqual(["clip1", "clip2"]);
  });

  it("returns only clip2 after transition window", () => {
    const active = getActiveVideoClipsForTime(6.0, [clip1, clip2], mockAssets, [transition]);
    expect(active.map((c) => c.id)).toEqual(["clip2"]);
  });
});

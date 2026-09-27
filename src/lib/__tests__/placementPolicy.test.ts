import { describe, expect, it } from "vitest";
import type { Clip, Track } from "@/types";
import { resolveAddToTimelinePlacement, resolveDefaultFitModeForAsset } from "../timeline/placementPolicy";

function makeTrack(id: string, type: Track["type"], locked = false): Track {
  return {
    id,
    type,
    name: id,
    muted: false,
    locked,
    visible: true,
    height: type === "video" ? 68 : type === "audio" ? 52 : 56,
  };
}

function makeClip(id: string, trackId: string, startTime: number, duration: number): Clip {
  return {
    id,
    trackId,
    mediaId: `m-${id}`,
    startTime,
    duration,
    trimIn: 0,
    trimOut: duration,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    opacity: 1,
    rotation: 0,
  };
}

describe("resolveAddToTimelinePlacement", () => {
  it("creates a video track when timeline has no suitable video track", () => {
    const decision = resolveAddToTimelinePlacement({
      asset: { type: "video" },
      tracks: [],
      clips: [],
      playheadTime: 2,
      sequenceEndTime: 0,
    });

    expect(decision.trackType).toBe("video");
    expect(decision.startTime).toBe(0);
    expect(decision.shouldCreateTrack).toBe(true);
    expect(decision.targetTrackId).toBeNull();
  });

  it("uses preferred unlocked video track when not occupied at playhead", () => {
    const tracks = [makeTrack("v1", "video"), makeTrack("a1", "audio")];
    const clips = [makeClip("c1", "v1", 0, 2)];

    const decision = resolveAddToTimelinePlacement({
      asset: { type: "video" },
      tracks,
      clips,
      playheadTime: 2,
      sequenceEndTime: 10,
    });

    expect(decision.startTime).toBe(2);
    expect(decision.shouldCreateTrack).toBe(false);
    expect(decision.targetTrackId).toBe("v1");
  });

  it("creates a new video track when preferred video track is occupied at playhead", () => {
    const tracks = [makeTrack("v1", "video"), makeTrack("a1", "audio")];
    const clips = [makeClip("c1", "v1", 0, 4)];

    const decision = resolveAddToTimelinePlacement({
      asset: { type: "video" },
      tracks,
      clips,
      playheadTime: 1.5,
      sequenceEndTime: 10,
    });

    expect(decision.shouldCreateTrack).toBe(true);
    expect(decision.targetTrackId).toBeNull();
    expect(decision.startTime).toBe(1.5);
  });

  it("creates a new audio track when preferred audio track is occupied at playhead", () => {
    const tracks = [makeTrack("v1", "video"), makeTrack("a1", "audio")];
    const clips = [makeClip("c1", "a1", 0, 3)];

    const decision = resolveAddToTimelinePlacement({
      asset: { type: "audio" },
      tracks,
      clips,
      playheadTime: 1,
      sequenceEndTime: 10,
    });

    expect(decision.trackType).toBe("audio");
    expect(decision.shouldCreateTrack).toBe(true);
    expect(decision.targetTrackId).toBeNull();
    expect(decision.startTime).toBe(1);
  });

  it("skips locked tracks and requests a new track when no unlocked target exists", () => {
    const tracks = [makeTrack("v1", "video", true), makeTrack("a1", "audio", true)];
    const clips: Clip[] = [];

    const decision = resolveAddToTimelinePlacement({
      asset: { type: "audio" },
      tracks,
      clips,
      playheadTime: 3,
      sequenceEndTime: 12,
    });

    expect(decision.trackType).toBe("audio");
    expect(decision.shouldCreateTrack).toBe(true);
    expect(decision.targetTrackId).toBeNull();
    expect(decision.startTime).toBe(3);
  });
});

describe("resolveDefaultFitModeForAsset", () => {
  it("returns contain for video assets", () => {
    expect(resolveDefaultFitModeForAsset({ type: "video" })).toBe("contain");
  });

  it("returns contain for image assets", () => {
    expect(resolveDefaultFitModeForAsset({ type: "image" })).toBe("contain");
  });
});

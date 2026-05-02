import { describe, expect, it, vi } from "vitest";
import { DEFAULT_STILL_DURATION_SECONDS } from "../../constants/config";
import { createClipFromAsset, resolveClipDuration } from "../timelineClip";
import type { MediaAsset } from "../../types";

const makeAsset = (overrides: Partial<MediaAsset>): MediaAsset => ({
  id: "asset-1",
  name: "asset",
  path: "/tmp/asset",
  type: "video",
  duration: 12,
  size: 100,
  ...overrides,
});

describe("resolveClipDuration", () => {
  it("returns default duration for images", () => {
    const image = makeAsset({ type: "image", duration: 0 });
    expect(resolveClipDuration(image)).toBe(DEFAULT_STILL_DURATION_SECONDS);
  });

  it("returns media metadata duration for video/audio", () => {
    const video = makeAsset({ type: "video", duration: 23.5 });
    const audio = makeAsset({ type: "audio", duration: 88 });
    expect(resolveClipDuration(video)).toBe(23.5);
    expect(resolveClipDuration(audio)).toBe(88);
  });

  it("falls back to default duration for non-image assets with invalid duration", () => {
    const video = makeAsset({ type: "video", duration: 0 });
    expect(resolveClipDuration(video)).toBe(DEFAULT_STILL_DURATION_SECONDS);
  });
});

describe("createClipFromAsset", () => {
  it("creates clip with normalized defaults and resolved duration", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    vi.spyOn(Date, "now").mockReturnValue(1234);

    const clip = createClipFromAsset({
      asset: makeAsset({ type: "image", duration: 0 }),
      trackId: "track-video-1",
      startTime: 9,
      width: 1920,
      height: 1080,
    });

    expect(clip).toMatchObject({
      id: "clip-1234-0.5",
      trackId: "track-video-1",
      mediaId: "asset-1",
      startTime: 9,
      duration: DEFAULT_STILL_DURATION_SECONDS,
      trimIn: 0,
      trimOut: DEFAULT_STILL_DURATION_SECONDS,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 1,
      rotation: 0,
    });
  });
});

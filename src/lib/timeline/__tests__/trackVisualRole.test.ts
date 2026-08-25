import { describe, expect, it } from "vitest";
import {
  getTrackVisualSpec,
  getSafeTrackInsertionIndex,
  normalizeTrackOrderForMainVideo,
  type TrackVisualRole,
} from "../trackTypeConfig";
import type { Track, TrackType } from "@/types";

const track = (id: string, type: TrackType): Pick<Track, "id" | "type"> => ({
  id,
  type,
});

describe("track visual roles", () => {
  it("uses mainVideoTrackId as the A-roll identity regardless of order", () => {
    const tracks = [track("overlay", "video"), track("main", "video")];

    expect(getTrackVisualSpec(tracks[0], tracks, "main")).toMatchObject({
      role: "b-roll",
      label: "B-Roll",
      height: 60,
      opacity: 0.8,
    });
    expect(getTrackVisualSpec(tracks[1], tracks, "main")).toMatchObject({
      role: "a-roll",
      label: "A-Roll (Main)",
      height: 80,
      opacity: 1,
    });
  });

  it("keeps non-audio rows above main while allowing audio below", () => {
    const tracks = [track("main", "video"), track("audio", "audio"), track("old-overlay", "video")];

    expect(getSafeTrackInsertionIndex(tracks, "video", tracks.length, "main")).toBe(0);
    expect(getSafeTrackInsertionIndex(tracks, "audio", tracks.length, "main")).toBe(3);
    expect(normalizeTrackOrderForMainVideo(tracks, "main").map((item) => item.id)).toEqual([
      "old-overlay",
      "main",
      "audio",
    ]);
  });

  it("falls back to the first video track when mainVideoTrackId is absent", () => {
    const tracks = [track("main", "video"), track("secondary", "video")];

    expect(getTrackVisualSpec(tracks[0], tracks, null).role).toBe("a-roll");
    expect(getTrackVisualSpec(tracks[1], tracks, null).role).toBe("b-roll");
  });

  it.each([
    ["audio", "Audio", 40, 0.6],
    ["text", "Text", 30, 0.8],
    ["sticker", "Sticker", 30, 0.8],
    ["filter", "Filter", 30, 0.8],
    ["video-effect", "Video Effect", 30, 0.8],
    ["body-effect", "Body Effect", 30, 0.8],
    ["animated-overlay", "Animated Overlay", 30, 0.8],
  ] as const)("resolves %s strictly by TrackType", (type, label, height, opacity) => {
    const spec = getTrackVisualSpec(track(type, type), [track(type, type)], null);

    expect(spec).toMatchObject({
      role: type as TrackVisualRole,
      label,
      height,
      opacity,
    });
  });
});

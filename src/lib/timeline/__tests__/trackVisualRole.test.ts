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
      opacity: 1,
    });
    expect(getTrackVisualSpec(tracks[1], tracks, "main")).toMatchObject({
      role: "a-roll",
      label: "A-Roll (Main)",
      height: 80,
      opacity: 1,
    });
  });

  it("keeps non-audio rows above main and all audio rows at the bottom", () => {
    const tracks = [
      track("audio-above", "audio"),
      track("main", "video"),
      track("audio-below", "audio"),
      track("old-overlay", "video"),
    ];

    expect(getSafeTrackInsertionIndex(tracks, "video", tracks.length, "main")).toBe(1);
    expect(getSafeTrackInsertionIndex(tracks, "audio", 0, "main")).toBe(4);
    expect(normalizeTrackOrderForMainVideo(tracks, "main").map((item) => item.id)).toEqual([
      "old-overlay",
      "main",
      "audio-above",
      "audio-below",
    ]);
  });

  it("moves audio to the bottom even when there is no main video row", () => {
    const tracks = [track("audio", "audio"), track("text", "text")];

    expect(normalizeTrackOrderForMainVideo(tracks).map((item) => item.id)).toEqual([
      "text",
      "audio",
    ]);
  });

  it("falls back to the bottommost video track (A-roll) when mainVideoTrackId is absent in top-insertion layout", () => {
    const tracks = [track("overlay", "video"), track("main", "video")];

    expect(getTrackVisualSpec(tracks[0], tracks, null).role).toBe("b-roll");
    expect(getTrackVisualSpec(tracks[1], tracks, null).role).toBe("a-roll");
  });

  it.each([
    ["audio", "Audio", 60, 1],
    ["text", "Text", 30, 1],
    ["sticker", "Sticker", 30, 1],
    ["filter", "Filter", 30, 1],
    ["video-effect", "Video Effect", 30, 1],
    ["body-effect", "Body Effect", 30, 1],
    ["animated-overlay", "Animated Overlay", 30, 1],
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

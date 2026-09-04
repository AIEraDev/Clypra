import { describe, it, expect } from "vitest";
import { resolveTrackTypeForClip } from "../trackTypeConfig";
import type { Clip, Track } from "@/types";

describe("resolveTrackTypeForClip", () => {
  it("resolves text track for text and text-template clips", () => {
    const textClip: Partial<Clip> = {
      id: "clip-1",
      kind: "text",
      trackId: "track-text-1",
    };
    expect(resolveTrackTypeForClip(textClip)).toBe("text");

    const templateClip: Partial<Clip> = {
      id: "clip-2",
      kind: "text-template",
      trackId: "track-text-2",
    };
    expect(resolveTrackTypeForClip(templateClip)).toBe("text");
  });

  it("resolves text track from source track type", () => {
    const legacyClip: Partial<Clip> = {
      id: "clip-3",
      trackId: "track-text-1",
    };
    const sourceTrack: Partial<Track> = {
      id: "track-text-1",
      type: "text",
    };
    expect(resolveTrackTypeForClip(legacyClip, sourceTrack as Track)).toBe("text");
  });

  it("resolves text track from text heuristics", () => {
    const textPropClip: any = {
      id: "text-clip-custom-123",
      text: "CLYPRA",
    };
    expect(resolveTrackTypeForClip(textPropClip)).toBe("text");

    const styleIdClip: any = {
      id: "clip-4",
      styleId: "neon-glow",
    };
    expect(resolveTrackTypeForClip(styleIdClip)).toBe("text");
  });

  it("resolves stickers, audio, and effects properly", () => {
    expect(resolveTrackTypeForClip({ id: "sticker-1", kind: "sticker" })).toBe("sticker");
    expect(resolveTrackTypeForClip({ id: "audio-1", kind: "audio" })).toBe("audio");
    expect(resolveTrackTypeForClip({ id: "filter-1", kind: "filter" })).toBe("filter");
    expect(resolveTrackTypeForClip({ id: "fx-1", kind: "video-effect" })).toBe("video-effect");
  });

  it("resolves video for regular video clips", () => {
    expect(resolveTrackTypeForClip({ id: "video-1", kind: "video" })).toBe("video");
    expect(resolveTrackTypeForClip({ id: "img-1", kind: "image" })).toBe("video");
  });
});

import { describe, expect, it } from "vitest";
import type { Clip, MediaAsset, TextClip, Track } from "@/types";
import { legacyClipToTimelineItem, timelineItemToLegacyClip, toCompositorClip } from "..";
import { resolveClipSourceTime } from "../sourceTime";

const tracks: Track[] = [
  { id: "v1", type: "video", name: "Video 1", muted: false, locked: false, visible: true, height: 68 },
  { id: "v2", type: "video", name: "Video 2", muted: false, locked: false, visible: true, height: 68 },
  { id: "txt", type: "text", name: "Text", muted: false, locked: false, visible: true, height: 30 },
];

const asset: MediaAsset = { id: "m1", name: "Source", path: "/tmp/source.mp4", type: "video", duration: 20, width: 1920, height: 1080, size: 1 };

const clip: Clip = {
  id: "c1",
  trackId: "v2",
  mediaId: "m1",
  startTime: 4,
  duration: 5,
  trimIn: 2,
  trimOut: 7,
  x: 10,
  y: 20,
  width: 300,
  height: 200,
  opacity: 0.8,
  rotation: 5,
};

describe("timeline item compatibility adapters", () => {
  it("preserves legacy media clip fields in a typed timeline item", () => {
    const item = legacyClipToTimelineItem(clip, tracks, [asset]);

    expect(item.kind).toBe("video");
    if (item.kind === "text") throw new Error("Expected media item");
    expect(item.placement.trackId).toBe("v2");
    expect(item.placement.role).toBe("overlay");
    expect(item.source.mediaId).toBe("m1");
    expect(item.source.trimIn).toBe(2);
    expect(item.transform.opacity).toBe(0.8);
  });

  it("round-trips typed media items back to legacy clips", () => {
    const item = legacyClipToTimelineItem(clip, tracks, [asset]);
    expect(timelineItemToLegacyClip(item)).toMatchObject(clip);
  });

  it("preserves text generator fields", () => {
    const textClip: TextClip = {
      ...clip,
      id: "text1",
      trackId: "txt",
      mediaId: "",
      text: "Hello",
      fontFamily: "Inter",
      fontSize: 48,
      color: "#fff",
      align: "center",
      valign: "middle",
      lineHeight: 1.2,
      paddingX: 12,
      paddingY: 12,
    };

    const item = legacyClipToTimelineItem(textClip, tracks, []);
    expect(item.kind).toBe("text");
    expect(item.placement.role).toBe("text");
    expect(timelineItemToLegacyClip(item)).toMatchObject({ text: "Hello", fontSize: 48, mediaId: "" });
  });

  it("uses track position fallback for compositor roles", () => {
    // After z-order fix: all video tracks default to "overlay" role
    // Z-order is determined by trackIndex, not role distinction
    expect(toCompositorClip({ ...clip, trackId: "v1" }, tracks).role).toBe("overlay");
    expect(toCompositorClip(clip, tracks).role).toBe("overlay");

    // Text tracks still get text role
    expect(toCompositorClip({ ...clip, trackId: "txt" }, tracks).role).toBe("text");
  });

  it("resolves source time through the shared resolver", () => {
    expect(resolveClipSourceTime(clip, 6).sourceTime).toBe(4);
  });
});

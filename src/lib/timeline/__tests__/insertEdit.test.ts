import { describe, expect, it } from "vitest";
import type { Clip, MediaAsset, Track } from "@/types";
import { resolveInsertEdit } from "../insertEdit";

const videoTrack = { id: "v1", type: "video", locked: false } as Track;
const videoAsset = { id: "media", type: "video", duration: 5 } as MediaAsset;
const source = { id: "source", trackId: "v1", startTime: 0, duration: 10 } as Clip;

describe("resolveInsertEdit", () => {
  it("snaps and identifies a clip that must be split", () => {
    const result = resolveInsertEdit({ track: videoTrack, asset: videoAsset, clips: [source], requestedTime: 4.02, frameRate: 30 });
    expect(result.accepted).toBe(true);
    expect(result.insertionTime).toBe(4.033333333333333);
    expect(result.splitClipId).toBe("source");
  });

  it("uses an existing cut without a split", () => {
    const result = resolveInsertEdit({ track: videoTrack, asset: videoAsset, clips: [source], requestedTime: 10, frameRate: 30 });
    expect(result.splitClipId).toBeNull();
  });

  it("rejects locked and incompatible tracks", () => {
    expect(resolveInsertEdit({ track: { ...videoTrack, locked: true }, asset: videoAsset, clips: [], requestedTime: 0, frameRate: 30 }).accepted).toBe(false);
    expect(resolveInsertEdit({ track: videoTrack, asset: { ...videoAsset, type: "audio" }, clips: [], requestedTime: 0, frameRate: 30 }).accepted).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import type { NativeFrameRequest } from "@/lib/platform/nativeCore";
import { createNativePlaybackFrameDemand } from "@/lib/platform/nativeCore";
import { buildNativePlaybackSnapshotKey } from "../nativePlaybackSnapshot";

const baseRequest = {
  contractVersion: 1,
  requestId: "frame-1",
  frameTime: { frameIndex: 0, timescale: 30, value: 0 },
  outputWidth: 1920,
  outputHeight: 1080,
  quality: "full",
  colorPolicy: {
    version: 1,
    workingSpace: "linear-rec709",
    outputFormat: "rgba8",
    toneMapHdrToSdr: true,
    displayProfile: "srgb-reference",
  },
  renderGraphVersion: 1,
  project: {
    schemaVersion: 1,
    projectRevision: "project:1",
    canvasWidth: 1920,
    canvasHeight: 1080,
    clearColor: [0, 0, 0, 1],
    videoLayers: [{
      layerId: "video",
      assetId: "video-1",
      videoPath: "/tmp/video.mp4",
      sourceTime: { frameIndex: 0, timescale: 30, value: 0 },
      x: 0, y: 0, width: 1920, height: 1080, rotation: 0, opacity: 1, zIndex: 0,
      blendMode: "normal",
    }],
    rasterLayers: [{
      assetId: "native-text:title:abc",
      width: 640,
      height: 120,
      x: 100, y: 100, rotation: 0, opacity: 1, zIndex: 1,
      blendMode: "normal",
      isText: true,
    }],
    textLayers: [],
  },
} as unknown as NativeFrameRequest;

describe("native playback snapshot identity", () => {
  it("ignores per-frame demand values", () => {
    const first = buildNativePlaybackSnapshotKey(baseRequest);
    const next = buildNativePlaybackSnapshotKey({
      ...baseRequest,
      frameTime: { frameIndex: 30, timescale: 30, value: 30 },
      project: {
        ...baseRequest.project,
        videoLayers: [{ ...baseRequest.project.videoLayers[0], sourceTime: { frameIndex: 30, timescale: 30, value: 30 }, x: 40 }],
        rasterLayers: [{ ...baseRequest.project.rasterLayers?.[0], x: 240 }],
      },
    } as unknown as NativeFrameRequest);
    expect(next).toBe(first);
  });

  it("reconfigures when a prepared text layer is added, but swaps assets through demand", () => {
    const first = buildNativePlaybackSnapshotKey(baseRequest);
    const replaced = buildNativePlaybackSnapshotKey({
      ...baseRequest,
      project: {
        ...baseRequest.project,
        rasterLayers: [{ ...baseRequest.project.rasterLayers?.[0], assetId: "native-text:title:def" }],
      },
    } as unknown as NativeFrameRequest);
    expect(replaced).toBe(first);

    const added = buildNativePlaybackSnapshotKey({
      ...baseRequest,
      project: { ...baseRequest.project, rasterLayers: [] },
    } as unknown as NativeFrameRequest);
    expect(added).not.toBe(first);
  });

  it("carries the prepared raster identity and dimensions in compact demand", () => {
    const demand = createNativePlaybackFrameDemand(baseRequest);
    expect(demand.rasterLayers[0]).toMatchObject({
      assetId: "native-text:title:abc",
      width: 640,
      height: 120,
    });
  });
});

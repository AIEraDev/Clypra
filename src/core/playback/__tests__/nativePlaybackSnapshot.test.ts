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

  it("keeps the structural snapshot key unchanged when overlay layers are added, removed, or swapped through demand", () => {
    const first = buildNativePlaybackSnapshotKey(baseRequest);
    const replaced = buildNativePlaybackSnapshotKey({
      ...baseRequest,
      project: {
        ...baseRequest.project,
        rasterLayers: [{ ...baseRequest.project.rasterLayers?.[0], assetId: "native-text:title:def" }],
      },
    } as unknown as NativeFrameRequest);
    expect(replaced).toBe(first);

    const emptyOverlays = buildNativePlaybackSnapshotKey({
      ...baseRequest,
      project: { ...baseRequest.project, rasterLayers: [] },
    } as unknown as NativeFrameRequest);
    expect(emptyOverlays).toBe(first);
  });

  it("reconfigures when video stream layers change", () => {
    const first = buildNativePlaybackSnapshotKey(baseRequest);
    const differentVideo = buildNativePlaybackSnapshotKey({
      ...baseRequest,
      project: {
        ...baseRequest.project,
        videoLayers: [{ ...baseRequest.project.videoLayers[0], videoPath: "/tmp/other.mp4" }],
      },
    } as unknown as NativeFrameRequest);
    expect(differentVideo).not.toBe(first);
  });

  it("carries the prepared raster identity and dimensions in compact demand", () => {
    const demand = createNativePlaybackFrameDemand(baseRequest);
    expect(demand.rasterLayers[0]).toMatchObject({
      assetId: "native-text:title:abc",
      width: 640,
      height: 120,
    });
  });

  it("keeps the structural snapshot key unchanged when a text layer transitions from SDF to raster mid-playback", () => {
    const sdfRequest = {
      ...baseRequest,
      project: {
        ...baseRequest.project,
        rasterLayers: [],
        textLayers: [{
          layerId: "title",
          text: "Headline",
          fontId: "inter",
          fontSize: 64,
          x: 100,
          y: 100,
          rotation: 0,
          opacity: 1,
          zIndex: 1,
        }],
      },
    } as unknown as NativeFrameRequest;

    const rasterRequest = {
      ...baseRequest,
      project: {
        ...baseRequest.project,
        rasterLayers: [{
          layerId: "title",
          assetId: "native-text:title:abc12345",
          width: 640,
          height: 120,
          x: 100,
          y: 100,
          rotation: 0,
          opacity: 1,
          zIndex: 1,
          blendMode: "normal",
          isText: true,
        }],
        textLayers: [],
      },
    } as unknown as NativeFrameRequest;

    const sdfKey = buildNativePlaybackSnapshotKey(sdfRequest);
    const rasterKey = buildNativePlaybackSnapshotKey(rasterRequest);

    expect(rasterKey).toBe(sdfKey);
  });
});

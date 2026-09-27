import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
  invoke: vi.fn().mockResolvedValue(undefined),
}));

import { evaluateTimelineScene } from "../evaluator";
import { computeAssetsVersion, EvaluationCache } from "../cache";
import type { Clip, MediaAsset, Project } from "@/types";
import { PreviewMediaPool } from "@/core/resources/PreviewMediaPool";
import { NativeRasterBridge } from "@/core/render/nativeRasterBridge";

describe("NLE Offline Media Invalidation & Evaluation", () => {
  const dummyProject: any = {
    id: "proj-1",
    name: "Offline Media Project",
    canvasWidth: 1920,
    canvasHeight: 1080,
    frameRate: 30,
    duration: 10,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const imageAssetOnline: MediaAsset = {
    id: "asset-img-1",
    name: "Example 8 - Color Adjustment.jpg",
    type: "image",
    path: "/path/to/Example 8 - Color Adjustment.jpg",
    width: 1920,
    height: 1080,
    duration: 5,
    size: 1024,
    isMissing: false,
  };

  const imageAssetOffline: MediaAsset = {
    ...imageAssetOnline,
    isMissing: true,
  };

  const imageClip: Clip = {
    id: "clip-img-1",
    trackId: "track-visual-1",
    mediaId: "asset-img-1",
    kind: "image",
    startTime: 0,
    duration: 5,
    trimIn: 0,
    trimOut: 5,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    rotation: 0,
    opacity: 1,
    zIndex: 1,
  };

  const videoAssetOnline: MediaAsset = {
    id: "asset-vid-1",
    name: "ProtoArc Video.mp4",
    type: "video",
    path: "/path/to/ProtoArc Video.mp4",
    width: 1920,
    height: 1080,
    duration: 10,
    size: 2048,
    isMissing: false,
  };

  const videoAssetOffline: MediaAsset = {
    ...videoAssetOnline,
    isMissing: true,
  };

  const videoClip: Clip = {
    id: "clip-vid-1",
    trackId: "track-visual-2",
    mediaId: "asset-vid-1",
    kind: "video",
    startTime: 0,
    duration: 10,
    trimIn: 0,
    trimOut: 10,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    rotation: 0,
    opacity: 1,
    zIndex: 0,
  };

  it("does not emit visual layers on program preview when image media is missing", () => {
    const tracks: any[] = [{ id: "track-visual-1", name: "Track 1", type: "video" }];
    // 1. When online, the image layer is included in scene.visualLayers
    const sceneOnline = evaluateTimelineScene(
      2.0,
      [imageClip],
      tracks,
      [imageAssetOnline],
      dummyProject,
    );
    expect(sceneOnline.visualLayers.length).toBe(1);
    expect(sceneOnline.visualLayers[0].layerId).toBe("clip-img-1");

    // 2. When offline, evaluateTimelineScene skips the missing media - it must NEVER show in program preview
    const sceneOffline = evaluateTimelineScene(
      2.0,
      [imageClip],
      tracks,
      [imageAssetOffline],
      dummyProject,
    );
    expect(sceneOffline.visualLayers.length).toBe(0);
  });

  it("does not emit visual or audio layers when video media is missing", () => {
    const tracks: any[] = [{ id: "track-visual-2", name: "Track 2", type: "video" }];
    const sceneOnline = evaluateTimelineScene(
      1.0,
      [videoClip],
      tracks,
      [videoAssetOnline],
      dummyProject,
    );
    expect(sceneOnline.visualLayers.length).toBe(1);

    const sceneOffline = evaluateTimelineScene(
      1.0,
      [videoClip],
      tracks,
      [videoAssetOffline],
      dummyProject,
    );
    expect(sceneOffline.visualLayers.length).toBe(0);
    expect(sceneOffline.audioLayers.length).toBe(0);
  });

  it("invalidates EvaluationCache when media isMissing state changes", () => {
    const hashOnline = computeAssetsVersion([imageAssetOnline]);
    const hashOffline = computeAssetsVersion([imageAssetOffline]);

    expect(hashOnline).not.toBe(hashOffline);

    const cache = new EvaluationCache();
    const keyOnline = {
      time: 1.0,
      epoch: 1,
      clipVersion: "v1",
      assetsVersion: hashOnline,
    };
    const keyOffline = {
      time: 1.0,
      epoch: 1,
      clipVersion: "v1",
      assetsVersion: hashOffline,
    };

    const dummyScene: any = {
      time: 1.0,
      visualLayers: [{ layerId: "clip-img-1" }],
      audioLayers: [],
      transitions: [],
    };
    cache.set(keyOnline, dummyScene);

    expect(cache.get(keyOnline)).toBe(dummyScene);
    // When assets transition to offline, cache hit must be null (cache invalidated)
    expect(cache.get(keyOffline)).toBeNull();
  });

  it("evicts missing asset resources in PreviewMediaPool", () => {
    const pool = new PreviewMediaPool("proj-1", "session-1");
    // Call evictMissingAsset
    expect(() => pool.evictMissingAsset("asset-img-1")).not.toThrow();
    pool.dispose();
  });

  it("evicts missing asset in NativeRasterBridge", async () => {
    const bridge = new NativeRasterBridge();
    expect(typeof bridge.invalidateMediaAsset).toBe("function");
    await expect(bridge.invalidateMediaAsset("/path/to/Example 8 - Color Adjustment.jpg")).resolves.not.toThrow();
    bridge.dispose();
  });
});

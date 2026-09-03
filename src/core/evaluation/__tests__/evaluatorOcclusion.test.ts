import { describe, it, expect, vi } from "vitest";
import {
  evaluateTimelineScene,
  cullOccludedVisualLayers,
  isOpaqueFullFrameOccluder,
} from "../evaluator";
import {
  buildNativeVideoProjectRequest,
  buildNativeFrameRequest,
} from "@/components/editor/preview/nativeVideoPreview";
import type { Clip, Track, MediaAsset, Project, TextClip } from "@/types";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
  invoke: vi.fn(),
}));

describe("Top-Down Occlusion Culling in NLE Multi-Track Architecture", () => {
  const defaultProject: Project = {
    id: "test-proj",
    name: "Test Project",
    canvasWidth: 1920,
    canvasHeight: 1080,
    frameRate: 30,
    duration: 10,
    aspectRatio: "16:9",
    createdAt: 0,
    updatedAt: 0,
  };

  const tracks: Track[] = [
    { id: "v2", name: "Video Track 2", type: "video", visible: true, locked: false, muted: false, solo: false, height: 56 },
    { id: "v1", name: "Video Track 1", type: "video", visible: true, locked: false, muted: false, solo: false, height: 56 },
  ];

  const assets: MediaAsset[] = [
    { id: "asset-1", name: "video1.mp4", path: "/path/to/video1.mp4", type: "video", duration: 10, width: 1920, height: 1080, size: 1024 },
    { id: "asset-2", name: "video2.mp4", path: "/path/to/video2.mp4", type: "video", duration: 10, width: 1920, height: 1080, size: 1024 },
  ];

  it("culls bottom video from native frame requests when top video is fully opaque and fullscreen", () => {
    const clips: Clip[] = [
      {
        id: "clip-v1",
        trackId: "v1",
        mediaId: "asset-1",
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
        blendMode: "normal",
        kind: "video",
      } as any,
      {
        id: "clip-v2",
        trackId: "v2",
        mediaId: "asset-2",
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
        blendMode: "normal",
        kind: "video",
      } as any,
    ];

    const scene = evaluateTimelineScene(2.0, clips, tracks, assets, defaultProject);

    // Evaluated scene maintains full track information for timeline inspectors
    expect(scene.visualLayers).toHaveLength(2);

    // Occlusion culling engine prunes occluded layers
    const culled = cullOccludedVisualLayers(scene.visualLayers, 1920, 1080);
    expect(culled).toHaveLength(1);
    expect(culled[0].clipId).toBe("clip-v2");

    // Native project request for GPU/decoders only contains the topmost active video
    const nativeProjectReq = buildNativeVideoProjectRequest(scene);
    expect(nativeProjectReq?.layers).toHaveLength(1);
    expect(nativeProjectReq?.layers[0].layerId).toBe("clip-v2");

    // Native frame request contains only 1 video layer to decode
    const frameReq = buildNativeFrameRequest(scene, "rev-1", 60, 30, 1920, 1080);
    expect(frameReq?.project.videoLayers).toHaveLength(1);
    expect(frameReq?.project.videoLayers[0].layerId).toBe("clip-v2");

    // Audio layers should STILL contain both audio streams
    expect(scene.audioLayers.some((a) => a.clipId === "clip-v1")).toBe(true);
    expect(scene.audioLayers.some((a) => a.clipId === "clip-v2")).toBe(true);
  });

  it("retains both videos when top video is transformed (Picture-in-Picture)", () => {
    const clips: Clip[] = [
      {
        id: "clip-v1",
        trackId: "v1",
        mediaId: "asset-1",
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
        blendMode: "normal",
        kind: "video",
      } as any,
      {
        id: "clip-v2",
        trackId: "v2",
        mediaId: "asset-2",
        startTime: 0,
        duration: 5,
        trimIn: 0,
        trimOut: 5,
        x: 100,
        y: 100,
        width: 640,
        height: 360,
        rotation: 0,
        opacity: 1,
        blendMode: "normal",
        kind: "video",
      } as any,
    ];

    const scene = evaluateTimelineScene(2.0, clips, tracks, assets, defaultProject);

    const culled = cullOccludedVisualLayers(scene.visualLayers, 1920, 1080);
    expect(culled).toHaveLength(2);
    expect(culled[0].clipId).toBe("clip-v1");
    expect(culled[1].clipId).toBe("clip-v2");

    const frameReq = buildNativeFrameRequest(scene, "rev-1", 60, 30, 1920, 1080);
    expect(frameReq?.project.videoLayers).toHaveLength(2);
  });

  it("retains both videos when top video has opacity < 1.0", () => {
    const clips: Clip[] = [
      {
        id: "clip-v1",
        trackId: "v1",
        mediaId: "asset-1",
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
        blendMode: "normal",
        kind: "video",
      } as any,
      {
        id: "clip-v2",
        trackId: "v2",
        mediaId: "asset-2",
        startTime: 0,
        duration: 5,
        trimIn: 0,
        trimOut: 5,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        rotation: 0,
        opacity: 0.75,
        blendMode: "normal",
        kind: "video",
      } as any,
    ];

    const scene = evaluateTimelineScene(2.0, clips, tracks, assets, defaultProject);

    const culled = cullOccludedVisualLayers(scene.visualLayers, 1920, 1080);
    expect(culled).toHaveLength(2);
  });

  it("retains both videos when top video has non-normal blend mode", () => {
    const clips: Clip[] = [
      {
        id: "clip-v1",
        trackId: "v1",
        mediaId: "asset-1",
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
        blendMode: "normal",
        kind: "video",
      } as any,
      {
        id: "clip-v2",
        trackId: "v2",
        mediaId: "asset-2",
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
        blendMode: "screen",
        kind: "video",
      } as any,
    ];

    const scene = evaluateTimelineScene(2.0, clips, tracks, assets, defaultProject);

    const culled = cullOccludedVisualLayers(scene.visualLayers, 1920, 1080);
    expect(culled).toHaveLength(2);
  });

  it("retains underlying video when top layer is transparent text", () => {
    const textTrack: Track = { id: "v3", name: "Text Track", type: "text", visible: true, locked: false, muted: false, solo: false, height: 56 };
    const allTracks = [textTrack, ...tracks];

    const textClip: TextClip = {
      id: "clip-text",
      kind: "text",
      trackId: "v3",
      mediaId: "",
      startTime: 0,
      duration: 5,
      trimIn: 0,
      trimOut: 5,
      x: 500,
      y: 500,
      width: 400,
      height: 100,
      opacity: 1.0,
      rotation: 0,
      text: "Title",
      fontSize: 48,
      fontFamily: "Inter",
      color: "#ffffff",
      fontWeight: "bold",
      fontStyle: "normal",
      align: "center",
      valign: "middle",
      lineHeight: 1.2,
      paddingX: 0,
      paddingY: 0,
    };

    const clips: Clip[] = [
      {
        id: "clip-v1",
        trackId: "v1",
        mediaId: "asset-1",
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
        blendMode: "normal",
        kind: "video",
      } as any,
      textClip,
    ];

    const scene = evaluateTimelineScene(2.0, clips, allTracks, assets, defaultProject);

    const culled = cullOccludedVisualLayers(scene.visualLayers, 1920, 1080);
    expect(culled).toHaveLength(2);
    expect(culled[0].clipId).toBe("clip-v1");
    expect(culled[1].clipId).toBe("clip-text");
  });

  it("culls bottom clip when top clip completely encloses it, even if neither covers the full canvas", () => {
    const clips: Clip[] = [
      {
        id: "clip-bottom",
        trackId: "v1",
        mediaId: "asset-1",
        startTime: 0,
        duration: 5,
        trimIn: 0,
        trimOut: 5,
        x: 200,
        y: 200,
        width: 800,
        height: 600,
        rotation: 0,
        opacity: 1,
        blendMode: "normal",
        kind: "video",
      } as any,
      {
        id: "clip-top",
        trackId: "v2",
        mediaId: "asset-2",
        startTime: 0,
        duration: 5,
        trimIn: 0,
        trimOut: 5,
        x: 100,
        y: 100,
        width: 1000,
        height: 800,
        rotation: 0,
        opacity: 1,
        blendMode: "normal",
        kind: "video",
      } as any,
    ];

    const scene = evaluateTimelineScene(2.0, clips, tracks, assets, defaultProject);
    expect(scene.visualLayers).toHaveLength(2);

    const culled = cullOccludedVisualLayers(scene.visualLayers, 1920, 1080);
    expect(culled).toHaveLength(1);
    expect(culled[0].clipId).toBe("clip-top");
  });
});

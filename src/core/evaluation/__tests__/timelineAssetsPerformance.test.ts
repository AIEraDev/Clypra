import { describe, it, expect, vi } from "vitest";
import {
  evaluateTimelineScene,
  cullOccludedVisualLayers,
} from "../evaluator";
import {
  buildNativeFrameRequest,
  buildNativeVideoProjectRequest,
} from "@/components/editor/preview/nativeVideoPreview";
import type { Clip, Track, MediaAsset, Project } from "@/types";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
  invoke: vi.fn(),
}));

describe("Timeline Assets & Multi-Track Playback Performance Tests", () => {
  // Real project metadata matching 9:16 mobile canvas
  const canvasProject: Project = {
    id: "proj-vertical-9-16",
    name: "9:16 Portrait Canvas",
    canvasWidth: 720,
    canvasHeight: 1280,
    frameRate: 30,
    duration: 30,
    aspectRatio: "9:16",
    createdAt: 0,
    updatedAt: 0,
  };

  const tracks: Track[] = [
    { id: "track-top", name: "Track 0 (Top)", type: "video", visible: true, locked: false, muted: false, solo: false, height: 56 },
    { id: "track-mid", name: "Track 1 (Mid)", type: "video", visible: true, locked: false, muted: false, solo: false, height: 56 },
    { id: "track-bot", name: "Track 2 (Bottom)", type: "video", visible: true, locked: false, muted: false, solo: false, height: 56 },
  ];

  // Real assets modeled directly after `clypra-testing-assets`
  const assets: MediaAsset[] = [
    {
      id: "asset-4k-bellingham",
      name: "Mod - Is Jude Bellingham okay in the head？ [2077502998138273792].mp4",
      path: "/Users/AIEraDev/Documents/clypra-testing-assets/Mod - Is Jude Bellingham okay in the head？ [2077502998138273792].mp4",
      type: "video",
      duration: 26.52,
      width: 2160,
      height: 3840,
      size: 93617074,
    },
    {
      id: "asset-hd-antler",
      name: "Antler.mp4",
      path: "/Users/AIEraDev/Documents/clypra-testing-assets/Antler.mp4",
      type: "video",
      duration: 89.34,
      width: 1280,
      height: 720,
      size: 73775400,
    },
    {
      id: "asset-hevc-messi",
      name: "Messi is the greatest world cup player of all time [7662901034339028242].mp4",
      path: "/Users/AIEraDev/Documents/clypra-testing-assets/Messi is the greatest world cup player of all time #football #messi #... [7662901034339028242].mp4",
      type: "video",
      duration: 138.86,
      width: 720,
      height: 1280,
      size: 2601064,
    },
    {
      id: "asset-vp9-jomakaze",
      name: "Video by jomakaze [DaUvB4QJzOk].mp4",
      path: "/Users/AIEraDev/Documents/clypra-testing-assets/Video by jomakaze [DaUvB4QJzOk].mp4",
      type: "video",
      duration: 173.63,
      width: 1080,
      height: 1920,
      size: 24367761,
    },
    {
      id: "asset-av1-record",
      name: "54M views · 868K reactions [974631751768961].mp4",
      path: "/Users/AIEraDev/Documents/clypra-testing-assets/54M views · 868K reactions ｜ Guest arrivals at the Guinness World Record Attempt and Birthday Party of @djprettyplay last night ｜ Oga Yenne TV [974631751768961].mp4",
      type: "video",
      duration: 17.80,
      width: 1080,
      height: 1920,
      size: 4267362,
    },
  ];

  it("benchmarks single-stream scene evaluation throughput (> 20,000 FPS)", () => {
    const clip: Clip = {
      id: "clip-4k",
      trackId: "track-mid",
      mediaId: "asset-4k-bellingham",
      startTime: 0,
      duration: 20,
      trimIn: 0,
      trimOut: 20,
      x: 0,
      y: 0,
      width: 720,
      height: 1280,
      rotation: 0,
      opacity: 1,
      blendMode: "normal",
      kind: "video",
    } as any;

    const iterations = 500;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      const time = (i * 1.0) / 30.0;
      const scene = evaluateTimelineScene(time, [clip], tracks, assets, canvasProject);
      const req = buildNativeFrameRequest(scene, "test-epoch", i, 30, 720, 1280);
      expect(req?.project.videoLayers).toHaveLength(1);
    }

    const elapsedMs = performance.now() - start;
    const avgMs = elapsedMs / iterations;
    const fps = (iterations / elapsedMs) * 1000;

    console.log(`\n  [Single-Stream Evaluator Benchmark] ${iterations} frames evaluated in ${elapsedMs.toFixed(2)}ms (avg ${avgMs.toFixed(3)}ms/frame, ${fps.toFixed(0)} FPS)`);
    expect(avgMs).toBeLessThan(0.5); // Evaluation should take < 0.5ms per frame
  });

  it("correctly culls lower layer when 4K vertical video covers 720p horizontal video", () => {
    const clips: Clip[] = [
      // Bottom track: 16:9 horizontal clip (letterboxed)
      {
        id: "clip-bottom-horizontal",
        trackId: "track-bot",
        mediaId: "asset-hd-antler",
        startTime: 0,
        duration: 10,
        trimIn: 0,
        trimOut: 10,
        x: 0,
        y: 440,
        width: 720,
        height: 405,
        rotation: 0,
        opacity: 1,
        blendMode: "normal",
        kind: "video",
      } as any,
      // Top track: 9:16 vertical 4K video (covers full 720x1280 canvas)
      {
        id: "clip-top-4k",
        trackId: "track-top",
        mediaId: "asset-4k-bellingham",
        startTime: 0,
        duration: 10,
        trimIn: 0,
        trimOut: 10,
        x: 0,
        y: 0,
        width: 720,
        height: 1280,
        rotation: 0,
        opacity: 1,
        blendMode: "normal",
        kind: "video",
      } as any,
    ];

    const scene = evaluateTimelineScene(2.0, clips, tracks, assets, canvasProject);
    expect(scene.visualLayers).toHaveLength(2);

    const culled = cullOccludedVisualLayers(scene.visualLayers, 720, 1280);
    expect(culled).toHaveLength(1);
    expect(culled[0].clipId).toBe("clip-top-4k");

    const req = buildNativeFrameRequest(scene, "test-epoch", 60, 30, 720, 1280);
    expect(req?.project.videoLayers).toHaveLength(1);
    expect(req?.project.videoLayers[0].layerId).toBe("clip-top-4k");
  });

  it("preserves both layers when top video is a picture-in-picture overlay", () => {
    const clips: Clip[] = [
      // Fullscreen 9:16 background video (HEVC)
      {
        id: "clip-bg-hevc",
        trackId: "track-bot",
        mediaId: "asset-hevc-messi",
        startTime: 0,
        duration: 10,
        trimIn: 0,
        trimOut: 10,
        x: 0,
        y: 0,
        width: 720,
        height: 1280,
        rotation: 0,
        opacity: 1,
        blendMode: "normal",
        kind: "video",
      } as any,
      // Picture-in-picture top video (AV1 in top-right corner)
      {
        id: "clip-pip-av1",
        trackId: "track-top",
        mediaId: "asset-av1-record",
        startTime: 0,
        duration: 10,
        trimIn: 0,
        trimOut: 10,
        x: 450,
        y: 50,
        width: 240,
        height: 320,
        rotation: 0,
        opacity: 1,
        blendMode: "normal",
        kind: "video",
      } as any,
    ];

    const scene = evaluateTimelineScene(2.0, clips, tracks, assets, canvasProject);
    const culled = cullOccludedVisualLayers(scene.visualLayers, 720, 1280);

    // Both layers MUST remain because top is only an overlay
    expect(culled).toHaveLength(2);
    expect(culled[0].clipId).toBe("clip-bg-hevc");
    expect(culled[1].clipId).toBe("clip-pip-av1");

    const req = buildNativeFrameRequest(scene, "test-epoch", 60, 30, 720, 1280);
    expect(req?.project.videoLayers).toHaveLength(2);
  });

  it("culls bottom clip when top clip has identical bounding box (Relative Occlusion)", () => {
    const clips: Clip[] = [
      // Bottom clip (centered 16:9 video)
      {
        id: "clip-bot-same-size",
        trackId: "track-bot",
        mediaId: "asset-hd-antler",
        startTime: 0,
        duration: 10,
        trimIn: 0,
        trimOut: 10,
        x: 0,
        y: 440,
        width: 720,
        height: 405,
        rotation: 0,
        opacity: 1,
        blendMode: "normal",
        kind: "video",
      } as any,
      // Top clip directly over bottom clip (same dimensions, neither covers full canvas)
      {
        id: "clip-top-same-size",
        trackId: "track-top",
        mediaId: "asset-vp9-jomakaze",
        startTime: 0,
        duration: 10,
        trimIn: 0,
        trimOut: 10,
        x: 0,
        y: 440,
        width: 720,
        height: 405,
        rotation: 0,
        opacity: 1,
        blendMode: "normal",
        kind: "video",
      } as any,
    ];

    const scene = evaluateTimelineScene(2.0, clips, tracks, assets, canvasProject);
    const culled = cullOccludedVisualLayers(scene.visualLayers, 720, 1280);

    // Bottom clip must be culled via pairwise relative occlusion
    expect(culled).toHaveLength(1);
    expect(culled[0].clipId).toBe("clip-top-same-size");
  });
});

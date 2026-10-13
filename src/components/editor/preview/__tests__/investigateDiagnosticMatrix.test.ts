import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => path,
  invoke: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/platform/tauri", () => ({
  isTauriRuntime: vi.fn(() => true),
  hideNativeSurface: vi.fn(() => Promise.resolve()),
  probeNativeSurface: vi.fn(() => Promise.resolve({ success: true })),
  resizeNativeSurface: vi.fn(() => Promise.resolve()),
  showNativeSurface: vi.fn(() => Promise.resolve()),
  registerNativeRasterAsset: vi.fn(() => Promise.resolve()),
  unregisterNativeRasterAsset: vi.fn(() => Promise.resolve()),
  registerNativeImageAsset: vi.fn(() => Promise.resolve()),
}));
import { useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import { useHistoryStore } from "@/store/historyStore";
import { TimelinePlacementEngine } from "@/lib/timeline/placementEngine";
import { STARTER_STICKERS } from "@/features/stickers/starterStickers";
import { evaluateTimelineSceneCached } from "@/core/evaluation/evaluator";
import { NativeRasterBridge } from "@/core/render/nativeRasterBridge";
import { buildNativeFrameRequest } from "../nativeVideoPreview";

const nativeRasterBridge = new NativeRasterBridge();
import type { MediaAsset, Project } from "@/types";

describe("Authoritative Diagnostic Matrix: 5 Asset Types on Empty vs Video-Present Projects", () => {
  const setupEmptyProject = () => {
    useTimelineStore.setState({ tracks: [], clips: [], transitions: [], gaps: [] });
    useProjectStore.setState({
      project: {
        id: "empty-proj",
        name: "Empty Project",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        aspectRatio: "16:9",
        frameRate: 30,
        duration: 0,
        canvasWidth: 1920,
        canvasHeight: 1080,
        mediaAssets: [],
      },
      mediaAssets: [],
    });
    useHistoryStore.getState().clear();
  };

  const setupProjectWithVideo = async () => {
    setupEmptyProject();
    const videoAsset: MediaAsset = {
      id: "media-vid-1",
      name: "Test Video.mp4",
      path: "/mock/videos/test.mp4",
      type: "video",
      duration: 10.0,
      size: 1024,
      width: 1920,
      height: 1080,
    };
    useProjectStore.getState().addMediaAsset(videoAsset);
    await TimelinePlacementEngine.addToTimeline({
      item: videoAsset,
      type: "media",
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("EMPTY PROJECT (zero video, tracks: [], clips: [], duration: 0)", () => {
    it("Matrix 1.1: Add STICKER to empty project", async () => {
      setupEmptyProject();
      const sticker = STARTER_STICKERS[0];
      const res = await TimelinePlacementEngine.addToTimeline({
        item: sticker,
        type: "stickers",
      });

      console.log("\n--- [EMPTY + STICKER] ---");
      console.log("Add Result:", res);
      const clips = useTimelineStore.getState().clips;
      const tracks = useTimelineStore.getState().tracks;
      const project = useProjectStore.getState().project;
      const timelineDuration = useTimelineStore.getState().getTimelineEndTime();
      console.log("Clips in Store:", clips.length, clips.map(c => ({ id: c.id, kind: c.kind, trackId: c.trackId, start: c.startTime, duration: c.duration, path: (c as any).path, mediaId: c.mediaId, stickerFormat: (c as any).stickerFormat })));
      console.log("Tracks in Store:", tracks.length, tracks.map(t => ({ id: t.id, type: t.type })));
      console.log("Project Duration:", project?.duration, "Timeline Duration:", timelineDuration);

      const scene = evaluateTimelineSceneCached(0, clips, tracks, useProjectStore.getState().mediaAssets, project);
      console.log("Scene Visual Layers:", scene.visualLayers.length, scene.visualLayers.map(l => ({ layerId: l.layerId, type: l.layerType, clipKind: (l as any).clipKind, src: (l as any).sourcePath, format: (l as any).stickerFormat })));

      const nativeRasters = await nativeRasterBridge.rasterize(scene, { frameKey: 0, phase: "interactive-preview" });
      console.log("Native Raster Layers:", nativeRasters.length, nativeRasters.map(r => ({ assetId: r.assetId, w: r.width, h: r.height })));

      const nativeReq = buildNativeFrameRequest(scene, "rev-1", 0, 30, 1920, 1080, nativeRasters);
      console.log("Native Frame Request Built:", Boolean(nativeReq), nativeReq ? { videoLayers: nativeReq.project.videoLayers.length, rasterLayers: nativeReq.project.rasterLayers?.length } : null);

      expect(res.success).toBe(true);
      expect(clips.length).toBe(1);
      expect(tracks.length).toBe(1);
      expect(tracks[0].type).toBe("sticker");
    });

    it("Matrix 1.2: Add TEXT to empty project", async () => {
      setupEmptyProject();
      const res = await TimelinePlacementEngine.addToTimeline({
        item: { name: "Sample Title", text: "Sample Title" },
        type: "text",
      });

      console.log("\n--- [EMPTY + TEXT] ---");
      console.log("Add Result:", res);
      const clips = useTimelineStore.getState().clips;
      const tracks = useTimelineStore.getState().tracks;
      const project = useProjectStore.getState().project;
      console.log("Clips in Store:", clips.length, clips.map(c => ({ id: c.id, kind: c.kind, trackId: c.trackId, start: c.startTime, duration: c.duration, text: (c as any).text })));
      console.log("Tracks in Store:", tracks.length, tracks.map(t => ({ id: t.id, type: t.type })));

      const scene = evaluateTimelineSceneCached(0, clips, tracks, useProjectStore.getState().mediaAssets, project);
      console.log("Scene Visual Layers:", scene.visualLayers.length, scene.visualLayers.map(l => ({ layerId: l.layerId, type: l.layerType, text: (l as any).text })));

      const nativeRasters = await nativeRasterBridge.rasterize(scene, { frameKey: 0, phase: "interactive-preview" });
      const nativeReq = buildNativeFrameRequest(scene, "rev-1", 0, 30, 1920, 1080, nativeRasters);
      console.log("Native Frame Request Built:", Boolean(nativeReq));

      expect(res.success).toBe(true);
      expect(clips.length).toBe(1);
      expect(tracks.length).toBe(1);
      expect(tracks[0].type).toBe("text");
    });

    it("Matrix 1.3: Add AUDIO to empty project", async () => {
      setupEmptyProject();
      const audioAsset: MediaAsset = {
        id: "audio-sample-1",
        name: "Soundtrack.mp3",
        path: "/mock/audio/music.mp3",
        type: "audio",
        duration: 30.0,
        size: 1024,
      };
      useProjectStore.getState().addMediaAsset(audioAsset);
      const res = await TimelinePlacementEngine.addToTimeline({
        item: audioAsset,
        type: "media",
      });

      console.log("\n--- [EMPTY + AUDIO] ---");
      console.log("Add Result:", res);
      const clips = useTimelineStore.getState().clips;
      const tracks = useTimelineStore.getState().tracks;
      const project = useProjectStore.getState().project;
      console.log("Clips in Store:", clips.length, clips.map(c => ({ id: c.id, kind: c.kind, trackId: c.trackId, start: c.startTime, duration: c.duration })));
      console.log("Tracks in Store:", tracks.length, tracks.map(t => ({ id: t.id, type: t.type })));

      const scene = evaluateTimelineSceneCached(0, clips, tracks, useProjectStore.getState().mediaAssets, project);
      console.log("Scene Visual Layers:", scene.visualLayers.length, "Audio Layers:", scene.audioLayers.length);

      const nativeReq = buildNativeFrameRequest(scene, "rev-1", 0, 30, 1920, 1080, []);
      console.log("Native Frame Request Built:", Boolean(nativeReq));

      expect(res.success).toBe(true);
      expect(clips.length).toBe(1);
      expect(tracks.length).toBe(1);
      expect(tracks[0].type).toBe("audio");
    });

    it("Matrix 1.4: Add IMAGE to empty project", async () => {
      setupEmptyProject();
      const imageAsset: MediaAsset = {
        id: "img-photo-1",
        name: "Photo.png",
        path: "/mock/images/photo.png",
        type: "image",
        duration: 5.0,
        size: 1024,
        width: 1920,
        height: 1080,
      };
      useProjectStore.getState().addMediaAsset(imageAsset);
      const res = await TimelinePlacementEngine.addToTimeline({
        item: imageAsset,
        type: "media",
      });

      console.log("\n--- [EMPTY + IMAGE] ---");
      console.log("Add Result:", res);
      const clips = useTimelineStore.getState().clips;
      const tracks = useTimelineStore.getState().tracks;
      const project = useProjectStore.getState().project;
      console.log("Clips in Store:", clips.length, clips.map(c => ({ id: c.id, kind: c.kind, trackId: c.trackId })));
      console.log("Tracks in Store:", tracks.length, tracks.map(t => ({ id: t.id, type: t.type })));

      const scene = evaluateTimelineSceneCached(0, clips, tracks, useProjectStore.getState().mediaAssets, project);
      console.log("Scene Visual Layers:", scene.visualLayers.length, scene.visualLayers.map(l => ({ layerId: l.layerId, type: l.layerType, mediaType: (l as any).mediaType })));

      expect(res.success).toBe(true);
      expect(clips.length).toBe(1);
      expect(tracks.length).toBe(1);
    });

    it("Matrix 1.5: Add VIDEO to empty project", async () => {
      setupEmptyProject();
      const videoAsset: MediaAsset = {
        id: "vid-main-1",
        name: "Clip.mp4",
        path: "/mock/videos/clip.mp4",
        type: "video",
        duration: 12.0,
        size: 1024,
        width: 1920,
        height: 1080,
      };
      useProjectStore.getState().addMediaAsset(videoAsset);
      const res = await TimelinePlacementEngine.addToTimeline({
        item: videoAsset,
        type: "media",
      });

      console.log("\n--- [EMPTY + VIDEO] ---");
      console.log("Add Result:", res);
      const clips = useTimelineStore.getState().clips;
      const tracks = useTimelineStore.getState().tracks;
      console.log("Clips in Store:", clips.length);
      console.log("Tracks in Store:", tracks.length, tracks.map(t => ({ id: t.id, type: t.type })));

      expect(res.success).toBe(true);
      expect(clips.length).toBe(1);
      expect(tracks.length).toBe(1);
      expect(tracks[0].type).toBe("video");
    });
  });

  describe("PROJECT WITH VIDEO PRESENT", () => {
    it("Matrix 2.1: Add STICKER to project with video", async () => {
      await setupProjectWithVideo();
      const sticker = STARTER_STICKERS[0];
      const res = await TimelinePlacementEngine.addToTimeline({
        item: sticker,
        type: "stickers",
      });

      console.log("\n--- [VIDEO + STICKER] ---");
      console.log("Add Result:", res);
      const clips = useTimelineStore.getState().clips;
      const tracks = useTimelineStore.getState().tracks;
      console.log("Clips in Store:", clips.length, clips.map(c => ({ id: c.id, kind: c.kind, trackId: c.trackId })));
      console.log("Tracks in Store:", tracks.length, tracks.map(t => ({ id: t.id, type: t.type })));

      expect(res.success).toBe(true);
      expect(clips.length).toBe(2);
      expect(tracks.length).toBe(2);
    });

    it("Matrix 2.2: Add TEXT to project with video", async () => {
      await setupProjectWithVideo();
      const res = await TimelinePlacementEngine.addToTimeline({
        item: { name: "Overlay Text", text: "Overlay Text" },
        type: "text",
      });

      console.log("\n--- [VIDEO + TEXT] ---");
      console.log("Add Result:", res);
      const clips = useTimelineStore.getState().clips;
      const tracks = useTimelineStore.getState().tracks;
      console.log("Clips in Store:", clips.length);
      console.log("Tracks in Store:", tracks.length);

      expect(res.success).toBe(true);
      expect(clips.length).toBe(2);
      expect(tracks.length).toBe(2);
    });

    it("Matrix 2.3: Add AUDIO to project with video", async () => {
      await setupProjectWithVideo();
      const audioAsset: MediaAsset = {
        id: "audio-overlay-1",
        name: "Overlay Audio.mp3",
        path: "/mock/audio/sfx.mp3",
        type: "audio",
        duration: 5.0,
        size: 1024,
      };
      useProjectStore.getState().addMediaAsset(audioAsset);
      const res = await TimelinePlacementEngine.addToTimeline({
        item: audioAsset,
        type: "media",
      });

      console.log("\n--- [VIDEO + AUDIO] ---");
      console.log("Add Result:", res);
      const clips = useTimelineStore.getState().clips;
      const tracks = useTimelineStore.getState().tracks;
      console.log("Clips in Store:", clips.length);
      console.log("Tracks in Store:", tracks.length);

      expect(res.success).toBe(true);
      expect(clips.length).toBe(2);
      expect(tracks.length).toBe(2);
    });

    it("Matrix 2.4: Add IMAGE to project with video", async () => {
      await setupProjectWithVideo();
      const imageAsset: MediaAsset = {
        id: "img-overlay-1",
        name: "Watermark.png",
        path: "/mock/images/watermark.png",
        type: "image",
        duration: 5.0,
        size: 1024,
        width: 400,
        height: 400,
      };
      useProjectStore.getState().addMediaAsset(imageAsset);
      const res = await TimelinePlacementEngine.addToTimeline({
        item: imageAsset,
        type: "media",
      });

      console.log("\n--- [VIDEO + IMAGE] ---");
      console.log("Add Result:", res);
      const clips = useTimelineStore.getState().clips;
      const tracks = useTimelineStore.getState().tracks;
      console.log("Clips in Store:", clips.length);
      console.log("Tracks in Store:", tracks.length);

      expect(res.success).toBe(true);
      expect(clips.length).toBe(2);
    });

    it("Matrix 2.5: Add SECOND VIDEO to project with video", async () => {
      await setupProjectWithVideo();
      const secondVideo: MediaAsset = {
        id: "vid-second-2",
        name: "Second.mp4",
        path: "/mock/videos/second.mp4",
        type: "video",
        duration: 8.0,
        size: 1024,
        width: 1920,
        height: 1080,
      };
      useProjectStore.getState().addMediaAsset(secondVideo);
      const res = await TimelinePlacementEngine.addToTimeline({
        item: secondVideo,
        type: "media",
      });

      console.log("\n--- [VIDEO + VIDEO] ---");
      console.log("Add Result:", res);
      const clips = useTimelineStore.getState().clips;
      const tracks = useTimelineStore.getState().tracks;
      console.log("Clips in Store:", clips.length);
      console.log("Tracks in Store:", tracks.length);

      expect(res.success).toBe(true);
      expect(clips.length).toBe(2);
    });
  });
});

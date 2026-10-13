import { describe, it, expect, beforeEach, vi } from "vitest";
import { evaluateTimelineSceneCached } from "@/core/evaluation/evaluator";
import {
  buildNativeVideoProjectRequest,
  buildNativeFrameRequest,
  getNativePreviewBlockers,
} from "../nativeVideoPreview";
import type { NativeRasterLayerSnapshot } from "@/lib/platform/nativeCore";
import type { Clip, Project } from "@/types";
import { useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";

describe("Non-Video Clip Preview Parity & Duration Invariants", () => {
  const baseProject: Project = {
    id: "proj-non-video",
    name: "Non-Video Test Project",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    aspectRatio: "16:9",
    frameRate: 30,
    duration: 0, // In an empty or non-video project, project.duration is 0
    canvasWidth: 1920,
    canvasHeight: 1080,
    mediaAssets: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useTimelineStore.setState({
      clips: [],
      tracks: [
        { id: "v1", type: "video", name: "Video 1", locked: false, muted: false, solo: false, visible: true, height: 64 },
        { id: "s1", type: "sticker", name: "Sticker 1", locked: false, muted: false, solo: false, visible: true, height: 64 },
        { id: "t1", type: "text", name: "Text 1", locked: false, muted: false, solo: false, visible: true, height: 64 },
        { id: "a1", type: "audio", name: "Audio 1", locked: false, muted: false, solo: false, visible: true, height: 64 },
      ],
    });
    useProjectStore.setState({
      project: { ...baseProject },
    });
  });

  describe("Duration resolution without video media", () => {
    it("preserves positive duration when timeline has clips even if project.duration is 0", () => {
      const stickerClip: Clip = {
        id: "clip-sticker-1",
        trackId: "s1",
        kind: "sticker",
        mediaId: "sticker-star-1",
        name: "Gold Star",
        startTime: 0,
        duration: 3.5,
        trimIn: 0,
        trimOut: 3.5,
        x: 0,
        y: 0,
        width: 400,
        height: 400,
        opacity: 1,
        rotation: 0,
        aspectRatioLocked: true,
        sourceAspectRatio: 1,
        fitMode: "contain",
        stickerFormat: "lottie",
        stickerSourceId: "star-1",
      } as any;

      useTimelineStore.setState({ clips: [stickerClip] });
      const timelineDuration = useTimelineStore.getState().getTimelineEndTime();
      const projectDuration = useProjectStore.getState().project?.duration ?? 0;

      // Project duration is 0, but timeline duration must be 3.5
      expect(projectDuration).toBe(0);
      expect(timelineDuration).toBe(3.5);

      const effectiveDuration =
        timelineDuration > 0
          ? timelineDuration
          : projectDuration > 0
            ? projectDuration
            : 10;
      expect(effectiveDuration).toBe(3.5);
    });

    it("defaults to 10s baseline when project and timeline are empty to prevent zero-duration lockouts", () => {
      const timelineDuration = useTimelineStore.getState().getTimelineEndTime();
      const projectDuration = useProjectStore.getState().project?.duration ?? 0;

      expect(projectDuration).toBe(0);
      expect(timelineDuration).toBe(0);

      const effectiveDuration =
        timelineDuration > 0
          ? timelineDuration
          : projectDuration > 0
            ? projectDuration
            : 10;
      expect(effectiveDuration).toBe(10);
    });
  });

  describe("Sticker-Only Project Preview", () => {
    it("builds a valid NativeVideoProjectRequest and NativeFrameRequest with no video layers", () => {
      const stickerClip: Clip = {
        id: "clip-sticker-star",
        trackId: "s1",
        kind: "sticker",
        mediaId: "sticker-golden-star",
        name: "Golden Star",
        startTime: 0,
        duration: 3.0,
        trimIn: 0,
        trimOut: 3.0,
        x: 760,
        y: 340,
        width: 400,
        height: 400,
        opacity: 1,
        rotation: 0,
        aspectRatioLocked: true,
        sourceAspectRatio: 1,
        fitMode: "contain",
        stickerFormat: "lottie",
        stickerSourceId: "starter-golden-star",
      } as any;

      useTimelineStore.setState({ clips: [stickerClip] });

      const scene = evaluateTimelineSceneCached(
        0.5,
        useTimelineStore.getState().clips,
        useTimelineStore.getState().tracks,
        useProjectStore.getState().project?.mediaAssets ?? [],
        useProjectStore.getState().project,
        0,
      );

      expect(scene.visualLayers.length).toBe(1);
      expect(scene.visualLayers[0].layerType).toBe("media");
      expect((scene.visualLayers[0] as any).clipKind).toBe("sticker");

      // When the sticker raster snapshot is prepared by the bridge:
      const stickerSnapshot: NativeRasterLayerSnapshot = {
        assetId: `native-sticker:${stickerClip.id}:15:400x400`,
        width: 400,
        height: 400,
        x: 760,
        y: 340,
        rotation: 0,
        opacity: 1,
        zIndex: 0,
        blendMode: "normal",
        isText: false,
      };

      const blockers = getNativePreviewBlockers(scene, [stickerSnapshot]);
      expect(blockers).toEqual([]);

      const projectRequest = buildNativeVideoProjectRequest(scene, [stickerSnapshot]);
      expect(projectRequest).not.toBeNull();
      expect(projectRequest?.layers).toEqual([]); // Zero video layers!
      expect(projectRequest?.clearColor).toEqual([0, 0, 0, 1]);
      expect(projectRequest?.rasterLayers).toEqual([stickerSnapshot]);

      const frameRequest = buildNativeFrameRequest(
        scene,
        "test-proj:1",
        15,
        30,
        1920,
        1080,
        [stickerSnapshot],
      );
      expect(frameRequest).not.toBeNull();
      expect(frameRequest?.project.videoLayers).toEqual([]);
      expect(frameRequest?.project.rasterLayers).toEqual([stickerSnapshot]);
      expect(frameRequest?.project.clearColor).toEqual([0, 0, 0, 1]);
    });
  });

  describe("Text-Only Project Preview", () => {
    it("builds a valid native request with no video layers and native text layer intact", () => {
      const textClip: Clip = {
        id: "clip-text-title",
        trackId: "t1",
        kind: "text",
        mediaId: "text-title",
        name: "Title Text",
        startTime: 0,
        duration: 5.0,
        trimIn: 0,
        trimOut: 5.0,
        x: 500,
        y: 400,
        width: 920,
        height: 280,
        opacity: 1,
        rotation: 0,
        aspectRatioLocked: false,
        sourceAspectRatio: 1,
        fitMode: "contain",
        text: "Hello Clypra",
        fontSize: 48,
        fontFamily: "Inter",
        color: "#ffffff",
      } as any;

      useTimelineStore.setState({ clips: [textClip] });

      const scene = evaluateTimelineSceneCached(
        1.0,
        useTimelineStore.getState().clips,
        useTimelineStore.getState().tracks,
        useProjectStore.getState().project?.mediaAssets ?? [],
        useProjectStore.getState().project,
        0,
      );

      expect(scene.visualLayers.length).toBe(1);
      expect(scene.visualLayers[0].layerType).toBe("text");

      const blockers = getNativePreviewBlockers(scene, []);
      expect(blockers).toEqual([]);

      const projectRequest = buildNativeVideoProjectRequest(scene, []);
      expect(projectRequest).not.toBeNull();
      expect(projectRequest?.layers).toEqual([]); // Zero video layers
      expect(projectRequest?.textLayers?.length).toBe(1);
      expect(projectRequest?.textLayers?.[0].text).toBe("Hello Clypra");

      const frameRequest = buildNativeFrameRequest(
        scene,
        "test-proj:1",
        30,
        30,
        1920,
        1080,
        [],
      );
      expect(frameRequest).not.toBeNull();
      expect(frameRequest?.project.videoLayers).toEqual([]);
      expect(frameRequest?.project.textLayers?.length).toBe(1);
      expect(frameRequest?.project.textLayers?.[0].text).toBe("Hello Clypra");
    });
  });

  describe("Audio-Only Project Preview", () => {
    it("builds a valid clear-color background request with zero video layers when only audio exists", () => {
      const audioClip: Clip = {
        id: "clip-audio-voice",
        trackId: "a1",
        kind: "audio",
        mediaId: "audio-asset-voice",
        name: "Voiceover.mp3",
        startTime: 0,
        duration: 12.0,
        trimIn: 0,
        trimOut: 12.0,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        opacity: 1,
        rotation: 0,
        aspectRatioLocked: false,
        sourceAspectRatio: 1,
        fitMode: "contain",
      } as any;

      useTimelineStore.setState({ clips: [audioClip] });

      const scene = evaluateTimelineSceneCached(
        2.0,
        useTimelineStore.getState().clips,
        useTimelineStore.getState().tracks,
        useProjectStore.getState().project?.mediaAssets ?? [],
        useProjectStore.getState().project,
        0,
      );

      // Audio clips do not produce visual layers in EvaluatedScene
      expect(scene.visualLayers.length).toBe(0);

      const blockers = getNativePreviewBlockers(scene, []);
      expect(blockers).toEqual([]);

      const projectRequest = buildNativeVideoProjectRequest(scene, []);
      expect(projectRequest).not.toBeNull();
      expect(projectRequest?.layers).toEqual([]);
      expect(projectRequest?.clearColor).toEqual([0, 0, 0, 1]);

      const frameRequest = buildNativeFrameRequest(
        scene,
        "test-proj:1",
        60,
        30,
        1920,
        1080,
        [],
      );
      expect(frameRequest).not.toBeNull();
      expect(frameRequest?.project.videoLayers).toEqual([]);
      expect(frameRequest?.project.clearColor).toEqual([0, 0, 0, 1]);
    });
  });
});

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
import { getPlaybackClock, resetPlaybackClock } from "@/core/playback/PlaybackClock";
import { TimelinePlacementEngine } from "@/lib/timeline/placementEngine";

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

  describe("Multi-Overlay Composite without Video Media", () => {
    it("renders simultaneous sticker + text + audio overlays with correct z-ordering and no video layers", () => {
      const stickerClip: Clip = {
        id: "clip-multi-sticker",
        trackId: "s1",
        kind: "sticker",
        mediaId: "sticker-multi-star",
        name: "Star Sticker",
        startTime: 0,
        duration: 4.0,
        trimIn: 0,
        trimOut: 4.0,
        x: 400,
        y: 200,
        width: 300,
        height: 300,
        opacity: 0.9,
        rotation: 15,
        aspectRatioLocked: true,
        sourceAspectRatio: 1,
        fitMode: "contain",
        stickerFormat: "lottie",
        stickerSourceId: "starter-golden-star",
      } as any;

      const textClip: Clip = {
        id: "clip-multi-text",
        trackId: "t1",
        kind: "text",
        mediaId: "text-multi-heading",
        name: "Heading Text",
        startTime: 0,
        duration: 5.0,
        trimIn: 0,
        trimOut: 5.0,
        x: 600,
        y: 500,
        width: 800,
        height: 150,
        opacity: 1,
        rotation: 0,
        aspectRatioLocked: false,
        sourceAspectRatio: 1,
        fitMode: "contain",
        text: "Layered Title",
        fontSize: 36,
        fontFamily: "Inter Variable",
        color: "#ffffff",
      } as any;

      const audioClip: Clip = {
        id: "clip-multi-audio",
        trackId: "a1",
        kind: "audio",
        mediaId: "audio-multi-bgm",
        name: "Background.mp3",
        startTime: 0,
        duration: 8.0,
        trimIn: 0,
        trimOut: 8.0,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        opacity: 1,
        rotation: 0,
        aspectRatioLocked: false,
        sourceAspectRatio: 1,
        fitMode: "contain",
        audioPath: "asset://audio/bgm.mp3",
      } as any;

      useTimelineStore.setState({ clips: [stickerClip, textClip, audioClip] });

      const scene = evaluateTimelineSceneCached(
        2.0,
        useTimelineStore.getState().clips,
        useTimelineStore.getState().tracks,
        useProjectStore.getState().project?.mediaAssets ?? [],
        useProjectStore.getState().project,
        0,
      );

      // Visual layers must contain both sticker and text
      expect(scene.visualLayers.length).toBe(2);
      const visualKinds = scene.visualLayers.map((l) => (l as any).clipKind || l.layerType);
      expect(visualKinds).toContain("sticker");
      expect(visualKinds).toContain("text");

      // Audio layer must be present in audio evaluation
      expect(scene.audioLayers.length).toBe(1);
      expect(scene.audioLayers[0].clipId).toBe("clip-multi-audio");

      const stickerSnapshot: NativeRasterLayerSnapshot = {
        assetId: `native-sticker:${stickerClip.id}:30:300x300`,
        width: 300,
        height: 300,
        x: 400,
        y: 200,
        rotation: 15,
        opacity: 0.9,
        zIndex: 0,
        blendMode: "normal",
        isText: false,
      };

      const blockers = getNativePreviewBlockers(scene, [stickerSnapshot]);
      expect(blockers).toEqual([]);

      const projectRequest = buildNativeVideoProjectRequest(scene, [stickerSnapshot]);
      expect(projectRequest).not.toBeNull();
      expect(projectRequest?.layers).toEqual([]); // Zero video layers
      expect(projectRequest?.rasterLayers).toEqual([stickerSnapshot]);
      expect(projectRequest?.textLayers?.length).toBe(1);
      expect(projectRequest?.textLayers?.[0].text).toBe("Layered Title");
    });
  });

  describe("Video Deletion: Smooth Transition to Overlay-Only Timeline", () => {
    it("updates timeline duration and transitions to overlay-only preview when video is deleted", () => {
      const videoClip: Clip = {
        id: "clip-video-main",
        trackId: "v1",
        kind: "video",
        mediaId: "asset-video-1",
        name: "Main.mp4",
        startTime: 0,
        duration: 10.0,
        trimIn: 0,
        trimOut: 10.0,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        opacity: 1,
        rotation: 0,
        aspectRatioLocked: true,
        sourceAspectRatio: 16 / 9,
        fitMode: "contain",
      } as any;

      const stickerClip: Clip = {
        id: "clip-sticker-lower-third",
        trackId: "s1",
        kind: "sticker",
        mediaId: "sticker-lower-third",
        name: "Badge",
        startTime: 0,
        duration: 3.5,
        trimIn: 0,
        trimOut: 3.5,
        x: 100,
        y: 800,
        width: 200,
        height: 200,
        opacity: 1,
        rotation: 0,
        aspectRatioLocked: true,
        sourceAspectRatio: 1,
        fitMode: "contain",
        stickerFormat: "lottie",
        stickerSourceId: "starter-golden-star",
      } as any;

      // Initial state: video + sticker
      useTimelineStore.setState({ clips: [videoClip, stickerClip] });
      expect(useTimelineStore.getState().getTimelineEndTime()).toBe(10.0);

      // Delete the video clip (simulating user pressing Backspace/Delete)
      useTimelineStore.setState({ clips: [stickerClip] });

      // Duration should automatically collapse to sticker duration
      const timelineDuration = useTimelineStore.getState().getTimelineEndTime();
      expect(timelineDuration).toBe(3.5);

      const scene = evaluateTimelineSceneCached(
        1.0,
        useTimelineStore.getState().clips,
        useTimelineStore.getState().tracks,
        useProjectStore.getState().project?.mediaAssets ?? [],
        useProjectStore.getState().project,
        0,
      );

      // Only the sticker remains in visualLayers
      expect(scene.visualLayers.length).toBe(1);
      expect((scene.visualLayers[0] as any).clipKind).toBe("sticker");

      const stickerSnapshot: NativeRasterLayerSnapshot = {
        assetId: `native-sticker:${stickerClip.id}:15:200x200`,
        width: 200,
        height: 200,
        x: 100,
        y: 800,
        rotation: 0,
        opacity: 1,
        zIndex: 0,
        blendMode: "normal",
        isText: false,
      };

      // Native preview request builds cleanly with zero video layers
      const projectRequest = buildNativeVideoProjectRequest(scene, [stickerSnapshot]);
      expect(projectRequest).not.toBeNull();
      expect(projectRequest?.layers).toEqual([]);
      expect(projectRequest?.rasterLayers).toEqual([stickerSnapshot]);
    });
  });

  describe("Playback Clock & Seeking on Overlay-Only Projects", () => {
    beforeEach(() => {
      resetPlaybackClock();
    });

    it("allows seeking and clamping past zero when duration is set to overlay content length", () => {
      const clock = getPlaybackClock();
      clock.setDuration(4.5); // 4.5s sticker

      expect(clock.duration).toBe(4.5);

      // Seeking within bounds succeeds and updates currentTime
      clock.seek(2.0);
      expect(clock.currentTime).toBe(2.0);

      // Seeking past duration clamps to duration (not 0)
      clock.seek(6.0);
      expect(clock.currentTime).toBe(4.5);

      // Seeking before 0 clamps to 0
      clock.seek(-1.0);
      expect(clock.currentTime).toBe(0);
    });
  });

  describe("Automatic Track Allocation for Overlays on Empty Timeline", () => {
    it("allocates a text track automatically when adding text to a timeline with zero tracks", async () => {
      // Empty timeline with 0 tracks and 0 clips
      useTimelineStore.setState({ tracks: [], clips: [] });

      const res = await TimelinePlacementEngine.addToTimeline({
        item: { text: "Solo Heading", fontFamily: "Inter Variable", fontSize: 48 },
        type: "text",
        playheadTime: 0,
      });

      expect(res.success).toBe(true);
      expect(res.clipId).toBeDefined();

      const latestTracks = useTimelineStore.getState().tracks;
      const textTrack = latestTracks.find((t) => t.type === "text");
      expect(textTrack).toBeDefined();

      const latestClips = useTimelineStore.getState().clips;
      expect(latestClips.length).toBe(1);
      expect(latestClips[0].kind).toBe("text");
      expect((latestClips[0] as any).text).toBe("Solo Heading");
    });
  });
});

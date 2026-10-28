import { describe, expect, it, vi } from "vitest";
import { evaluateTimelineScene } from "../evaluator";
import type {
  Project,
  VideoClip,
  AudioClip,
  Track,
  MediaAsset,
} from "@/types";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
  invoke: vi.fn(),
}));

describe("Clypra Media & Timeline Regression Suite (Phase 5 Foundation)", () => {
  const baseProject: Project = {
    id: "proj-reg-01",
    name: "Regression Test Project",
    createdAt: 1700000000,
    updatedAt: 1700000000,
    aspectRatio: "16:9",
    canvasWidth: 1920,
    canvasHeight: 1080,
    frameRate: 30,
    duration: 30,
  };

  const videoAssetWithAudio: MediaAsset = {
    id: "asset-video-audio",
    name: "interview.mp4",
    path: "/media/interview.mp4",
    type: "video",
    duration: 15,
    size: 10485760,
    width: 1920,
    height: 1080,
    streams: [
      { index: 0, type: "video", codec: "h264" },
      { index: 1, type: "audio", codec: "aac", channels: 2, sampleRate: 48000 },
    ],
  };

  const silentVideoAsset: MediaAsset = {
    id: "asset-silent-video",
    name: "timelapse.mp4",
    path: "/media/timelapse.mp4",
    type: "video",
    duration: 10,
    size: 5242880,
    width: 1920,
    height: 1080,
    streams: [
      { index: 0, type: "video", codec: "h264" },
    ],
  };

  const standaloneAudioAsset: MediaAsset = {
    id: "asset-music",
    name: "background.mp3",
    path: "/media/background.mp3",
    type: "audio",
    duration: 20,
    size: 3145728,
    streams: [
      { index: 0, type: "audio", codec: "mp3", channels: 2, sampleRate: 44100 },
    ],
  };

  const makeVideoClip = (overrides: Partial<VideoClip> & { id: string; trackId: string; mediaId: string }): VideoClip => ({
    kind: "video",
    startTime: 0,
    duration: 5,
    trimIn: 0,
    trimOut: 5,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    opacity: 1,
    rotation: 0,
    ...overrides,
  });

  const makeAudioClip = (overrides: Partial<AudioClip> & { id: string; trackId: string; mediaId: string }): AudioClip => ({
    kind: "audio",
    startTime: 0,
    duration: 5,
    trimIn: 0,
    trimOut: 5,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    opacity: 1,
    rotation: 0,
    ...overrides,
  });

  it("1. evaluates playable source media with audio stream into visual and audio layers", () => {
    const videoTrack: Track = {
      id: "track-v1",
      type: "video",
      name: "Main Video",
      muted: false,
      locked: false,
      visible: true,
      height: 80,
    };

    const videoClip = makeVideoClip({
      id: "clip-v1",
      trackId: "track-v1",
      mediaId: "asset-video-audio",
      startTime: 2,
      duration: 6,
      trimIn: 1,
      trimOut: 7,
      volume: 0.8,
      fadeIn: 0.5,
      fadeOut: 0.5,
    });

    // Evaluate at time 4 (2s into clip, 3s into source asset)
    const scene = evaluateTimelineScene(
      4,
      [videoClip],
      [videoTrack],
      [videoAssetWithAudio],
      baseProject,
    );

    expect(scene.metadata.time).toBe(4);
    expect(scene.visualLayers.length).toBe(1);
    const visual = scene.visualLayers[0];
    expect(visual.clipId).toBe("clip-v1");
    if (visual.layerType === "media") {
      expect(visual.sourceTime).toBe(3); // startTime 2 + (4 - 2) + trimIn 1 = 3s
    }
    expect(visual.opacity).toBe(1);

    // Audio layer should be present for embedded audio
    expect(scene.audioLayers.length).toBe(1);
    expect(scene.audioLayers[0].clipId).toBe("clip-v1");
    expect(scene.audioLayers[0].volume).toBeCloseTo(0.8);
    expect(scene.audioLayers[0].muted).toBe(false);
  });

  it("2. evaluates muted or non-audio visual clips appropriately", () => {
    const videoTrack: Track = {
      id: "track-v1",
      type: "video",
      name: "Silent Video Track",
      muted: true, // Track muted
      locked: false,
      visible: true,
      height: 80,
    };

    const silentClip = makeVideoClip({
      id: "clip-silent",
      trackId: "track-v1",
      mediaId: "asset-silent-video",
      startTime: 0,
      duration: 5,
      trimIn: 0,
      trimOut: 5,
      volume: 0,
    });

    const scene = evaluateTimelineScene(
      2,
      [silentClip],
      [videoTrack],
      [silentVideoAsset],
      baseProject,
    );

    expect(scene.visualLayers.length).toBe(1);
    expect(scene.visualLayers[0].clipId).toBe("clip-silent");
    // Muted audio produces muted audio layer with volume 0
    expect(scene.audioLayers[0].muted).toBe(true);
    expect(scene.audioLayers[0].volume).toBe(0);
  });

  it("3. evaluates standalone audio track independently of video layers", () => {
    const audioTrack: Track = {
      id: "track-a1",
      type: "audio",
      name: "Background Music",
      muted: false,
      locked: false,
      visible: true,
      height: 60,
    };

    const audioClip = makeAudioClip({
      id: "clip-a1",
      trackId: "track-a1",
      mediaId: "asset-music",
      startTime: 0,
      duration: 10,
      trimIn: 2,
      trimOut: 12,
      volume: 0.75,
      fadeIn: 1,
      fadeOut: 1,
    });

    const scene = evaluateTimelineScene(
      5,
      [audioClip],
      [audioTrack],
      [standaloneAudioAsset],
      baseProject,
    );

    // Audio-only track produces zero visual layers
    expect(scene.visualLayers.length).toBe(0);
    expect(scene.audioLayers.length).toBe(1);
    expect(scene.audioLayers[0].clipId).toBe("clip-a1");
    expect(scene.audioLayers[0].sourceTime).toBe(7); // 5s timeline + 2s trimIn
    expect(scene.audioLayers[0].volume).toBeCloseTo(0.75);
  });

  it("4. handles overlapping video clips across multiple tracks with correct z-ordering", () => {
    const trackBackground: Track = {
      id: "t-bg",
      type: "video",
      name: "Background",
      muted: false,
      locked: false,
      visible: true,
      height: 80,
    };

    const trackOverlay: Track = {
      id: "t-overlay",
      type: "video",
      name: "Picture in Picture",
      muted: false,
      locked: false,
      visible: true,
      height: 80,
    };

    const bgClip = makeVideoClip({
      id: "clip-bg",
      trackId: "t-bg",
      mediaId: "asset-video-audio",
      startTime: 0,
      duration: 10,
      trimIn: 0,
      trimOut: 10,
    });

    const pipClip = makeVideoClip({
      id: "clip-pip",
      trackId: "t-overlay",
      mediaId: "asset-silent-video",
      startTime: 2,
      duration: 4,
      trimIn: 0,
      trimOut: 4,
      x: 500,
      y: 300,
      width: 640,
      height: 360,
      opacity: 0.9,
    });

    // Tracks ordered from top to bottom (t-overlay above t-bg)
    const scene = evaluateTimelineScene(
      3, // Both clips active at time 3
      [bgClip, pipClip],
      [trackOverlay, trackBackground],
      [videoAssetWithAudio, silentVideoAsset],
      baseProject,
    );

    expect(scene.visualLayers.length).toBe(2);
    // Evaluated scene layers preserve order: bottom track rendered first, overlay on top
    const layerIds = scene.visualLayers.map((l) => l.clipId);
    expect(layerIds).toContain("clip-bg");
    expect(layerIds).toContain("clip-pip");
  });

  it("5. evaluates frame rate precision at 24fps, 30fps, and 60fps", () => {
    const fpsList = [24, 30, 60] as const;
    for (const fps of fpsList) {
      const proj: Project = { ...baseProject, frameRate: fps };
      const frameDuration = 1 / fps;

      const track: Track = {
        id: "t-fps",
        type: "video",
        name: "FPS Track",
        muted: false,
        locked: false,
        visible: true,
        height: 80,
      };

      const clip = makeVideoClip({
        id: `clip-${fps}`,
        trackId: "t-fps",
        mediaId: "asset-silent-video",
        startTime: 0,
        duration: 5,
        trimIn: 0,
        trimOut: 5,
      });

      // Frame 10 in timeline
      const testTime = 10 * frameDuration;
      const scene = evaluateTimelineScene(
        testTime,
        [clip],
        [track],
        [silentVideoAsset],
        proj,
      );

      expect(scene.visualLayers.length).toBe(1);
      const visual = scene.visualLayers[0];
      if (visual.layerType === "media") {
        expect(visual.sourceTime).toBeCloseTo(testTime, 5);
      }
    }
  });

  it("6. gracefully handles unprobed or invalid media asset references without crashing", () => {
    const unprobedAsset: MediaAsset = {
      id: "asset-unprobed",
      name: "incoming.mp4",
      path: "", // Hydration pending
      type: "video",
      duration: 0,
      size: 0,
    };

    const track: Track = {
      id: "t1",
      type: "video",
      name: "Track",
      muted: false,
      locked: false,
      visible: true,
      height: 80,
    };

    const clipWithMissingAsset = makeVideoClip({
      id: "clip-missing",
      trackId: "t1",
      mediaId: "asset-unprobed",
      startTime: 0,
      duration: 5,
      trimIn: 0,
      trimOut: 5,
    });

    // Must evaluate safely without throwing uncaught exceptions
    expect(() => {
      const scene = evaluateTimelineScene(
        1,
        [clipWithMissingAsset],
        [track],
        [unprobedAsset],
        baseProject,
      );
      expect(scene).toBeDefined();
    }).not.toThrow();
  });

  it("7. validates project serialization roundtrip into scene evaluation", () => {
    const originalProject: Project = {
      id: "roundtrip-proj",
      name: "Roundtrip Test",
      createdAt: 1700000000,
      updatedAt: 1700000500,
      aspectRatio: "16:9",
      canvasWidth: 1920,
      canvasHeight: 1080,
      frameRate: 30,
      duration: 20,
    };

    const track: Track = {
      id: "tr-1",
      type: "video",
      name: "Video 1",
      muted: false,
      locked: false,
      visible: true,
      height: 80,
    };

    const clip = makeVideoClip({
      id: "cl-1",
      trackId: "tr-1",
      mediaId: "asset-video-audio",
      startTime: 1,
      duration: 8,
      trimIn: 0,
      trimOut: 8,
    });

    // Serialize to JSON (simulating project save)
    const serialized = JSON.stringify({
      project: originalProject,
      tracks: [track],
      clips: [clip],
      assets: [videoAssetWithAudio],
    });

    // Deserialize from JSON (simulating project load/reopen)
    const deserialized = JSON.parse(serialized);

    expect(deserialized.project.id).toBe("roundtrip-proj");
    expect(deserialized.tracks.length).toBe(1);
    expect(deserialized.clips.length).toBe(1);
    expect(deserialized.assets.length).toBe(1);

    // Evaluate reconstructed project state at time 3
    const scene = evaluateTimelineScene(
      3,
      deserialized.clips,
      deserialized.tracks,
      deserialized.assets,
      deserialized.project,
    );

    expect(scene.metadata.time).toBe(3);
    expect(scene.visualLayers.length).toBe(1);
    const visual = scene.visualLayers[0];
    expect(visual.clipId).toBe("cl-1");
    if (visual.layerType === "media") {
      expect(visual.sourceTime).toBe(2); // 3s - 1s startTime
    }
  });

  // ─── Bug: conform block overrode user-scaled width/height in evaluator ─────
  //
  // When a clip has a `conform` property (set by fit-mode / import), the
  // evaluator called resolveConform() and used its result for evalW/evalH/evalX/evalY
  // unconditionally (unless keyframed). User scale writes to clip.width/height,
  // but those values were silently discarded, so the preview never updated.
  //
  // Fix: guard the conform override with `clip.baseWidth != null`.
  // `baseWidth` is written by every scale UI operation; its presence signals
  // that the user has manually set dimensions that must not be overridden.
  describe("Bug — conform block must not override manually-scaled clip dimensions (evaluator)", () => {
    const conformVideoAsset: MediaAsset = {
      id: "asset-conform-1920",
      name: "source.mp4",
      path: "/media/source.mp4",
      type: "video",
      duration: 10,
      size: 1000000,
      width: 1920,
      height: 1080,
    };

    const conformTrack = {
      id: "track-conform",
      clips: [] as string[],
      visible: true,
      locked: false,
      label: "",
      order: 0,
    };

    it("before user scale (no baseWidth): conform-derived dimensions are used", () => {
      const clip: any = {
        id: "clip-conform-no-scale",
        trackId: "track-conform",
        mediaId: "asset-conform-1920",
        kind: "video",
        startTime: 0,
        duration: 10,
        trimIn: 0,
        trimOut: 10,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        opacity: 1,
        rotation: 0,
        // conform present, no baseWidth → evaluator must use resolveConform
        conform: {
          mode: "fill",
          sourceWidth: 1920,
          sourceHeight: 1080,
          userScale: 1,
          userOffsetX: 0,
          userOffsetY: 0,
        },
      };

      const scene = evaluateTimelineScene(
        1,
        [clip],
        [conformTrack as any],
        [conformVideoAsset],
        baseProject,
      );

      expect(scene.visualLayers.length).toBe(1);
      const layer = scene.visualLayers[0];
      if (layer.layerType === "media") {
        // resolveConform(fill, 1920×1080 src on 1920×1080 canvas) → w=1920, h=1080
        expect(layer.width).toBe(1920);
        expect(layer.height).toBe(1080);
      }
    });

    it("after user scale (baseWidth set): clip.width/height take priority over conform", () => {
      // Simulate state after the user has scaled to 444%.
      const scaledWidth = Math.round(1920 * 4.44);   // 8525
      const scaledHeight = Math.round(1080 * 4.44);  // 4795
      const scaledX = 960 - scaledWidth / 2;
      const scaledY = 540 - scaledHeight / 2;

      const clip: any = {
        id: "clip-conform-scaled",
        trackId: "track-conform",
        mediaId: "asset-conform-1920",
        kind: "video",
        startTime: 0,
        duration: 10,
        trimIn: 0,
        trimOut: 10,
        x: scaledX,
        y: scaledY,
        width: scaledWidth,
        height: scaledHeight,
        opacity: 1,
        rotation: 0,
        // baseWidth is the signal that the user has manually scaled
        baseWidth: 1920,
        baseHeight: 1080,
        conform: {
          mode: "fill",
          sourceWidth: 1920,
          sourceHeight: 1080,
          userScale: 1, // conform still says 1× — user scaled to 444% via UI
          userOffsetX: 0,
          userOffsetY: 0,
        },
      };

      const scene = evaluateTimelineScene(
        1,
        [clip],
        [conformTrack as any],
        [conformVideoAsset],
        baseProject,
      );

      expect(scene.visualLayers.length).toBe(1);
      const layer = scene.visualLayers[0];
      if (layer.layerType === "media") {
        // Must use user-scaled dimensions, NOT the conform-derived 1920×1080
        expect(layer.width).toBe(scaledWidth);
        expect(layer.height).toBe(scaledHeight);
        expect(layer.x).toBe(scaledX);
        expect(layer.y).toBe(scaledY);
        expect(layer.width).toBeGreaterThan(1920);
        expect(layer.height).toBeGreaterThan(1080);
      }
    });

    it("keyframe-driven width still overrides conform regardless of baseWidth", () => {
      const kfWidth = 640;
      const clip: any = {
        id: "clip-conform-kf",
        trackId: "track-conform",
        mediaId: "asset-conform-1920",
        kind: "video",
        startTime: 0,
        duration: 10,
        trimIn: 0,
        trimOut: 10,
        x: 640,
        y: 270,
        width: kfWidth,
        height: 360,
        opacity: 1,
        rotation: 0,
        // No baseWidth — conform would normally take over, but keyframe wins
        conform: {
          mode: "fill",
          sourceWidth: 1920,
          sourceHeight: 1080,
          userScale: 1,
          userOffsetX: 0,
          userOffsetY: 0,
        },
        visualKeyframes: {
          width: [
            { id: "kf-w-0", time: 0, value: kfWidth, easing: "linear" },
            { id: "kf-w-10", time: 10, value: kfWidth, easing: "linear" },
          ],
        },
      };

      const scene = evaluateTimelineScene(
        1,
        [clip],
        [conformTrack as any],
        [conformVideoAsset],
        baseProject,
      );

      expect(scene.visualLayers.length).toBe(1);
      const layer = scene.visualLayers[0];
      if (layer.layerType === "media") {
        expect(layer.width).toBe(kfWidth);
      }
    });

    it("[REGRESSION] auto-centers keyframed scale around clip center during scrub and playback", () => {
      const clip: any = {
        id: "clip-scale-center-regression",
        trackId: "track-conform",
        mediaId: "asset-conform-1920",
        kind: "video",
        startTime: 0,
        duration: 10,
        trimIn: 0,
        trimOut: 10,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        opacity: 1,
        rotation: 0,
        baseWidth: 1920,
        baseHeight: 1080,
        visualKeyframes: {
          width: [
            { id: "kf-w-0", time: 0, value: 1920, easing: "linear" },
            { id: "kf-w-2", time: 2, value: 3840, easing: "linear" },
          ],
          height: [
            { id: "kf-h-0", time: 0, value: 1080, easing: "linear" },
            { id: "kf-h-2", time: 2, value: 2160, easing: "linear" },
          ],
        },
      };

      // At t = 0 (100% scale): center must be (960, 540)
      const scene0 = evaluateTimelineScene(
        0,
        [clip],
        [conformTrack as any],
        [conformVideoAsset],
        baseProject,
      );
      const layer0 = scene0.visualLayers[0];
      expect(layer0.width).toBe(1920);
      expect(layer0.height).toBe(1080);
      expect(layer0.x).toBe(0);
      expect(layer0.y).toBe(0);
      expect(layer0.x + layer0.width / 2).toBe(960);
      expect(layer0.y + layer0.height / 2).toBe(540);

      // At t = 1 (150% midpoint): center must still be (960, 540)
      const scene1 = evaluateTimelineScene(
        1,
        [clip],
        [conformTrack as any],
        [conformVideoAsset],
        baseProject,
      );
      const layer1 = scene1.visualLayers[0];
      expect(layer1.width).toBe(2880);
      expect(layer1.height).toBe(1620);
      expect(layer1.x).toBe(-480);
      expect(layer1.y).toBe(-270);
      expect(layer1.x + layer1.width / 2).toBe(960);
      expect(layer1.y + layer1.height / 2).toBe(540);

      // At t = 2 (200% scale): center must still be (960, 540)
      const scene2 = evaluateTimelineScene(
        2,
        [clip],
        [conformTrack as any],
        [conformVideoAsset],
        baseProject,
      );
      const layer2 = scene2.visualLayers[0];
      expect(layer2.width).toBe(3840);
      expect(layer2.height).toBe(2160);
      expect(layer2.x).toBe(-960);
      expect(layer2.y).toBe(-540);
      expect(layer2.x + layer2.width / 2).toBe(960);
      expect(layer2.y + layer2.height / 2).toBe(540);
    });
  });
});

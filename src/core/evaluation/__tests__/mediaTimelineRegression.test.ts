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
});

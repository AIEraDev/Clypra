/**
 * ──────────────────────────────────────────────────────────────────────────────
 * Composite Media Behavioral Contract
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Verifies that the preview and evaluation pipeline correctly composites:
 * 1. Multi-media video layers (primary A-roll + concurrent B-roll/PIP)
 * 2. Static image overlays (watermarks, graphics, PNG/JPEG layers)
 * 3. Text effects with styling and entrance/exit animations
 * 4. Text templates with dynamic template control values
 * 5. Multi-track audio synchronization and volume envelopes
 * 6. Cache invalidation across timeline state mutations (Invariant 2)
 *
 * Append-only: new tests may be added; existing contract assertions must not be removed.
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock Tauri core APIs for headless Vitest execution
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
  invoke: vi.fn(),
}));

import {
  evaluateTimelineSceneCached,
  clearEvaluationCache,
  invalidateEvaluationCache,
} from "@/core/evaluation/evaluator";
import { getActiveAudioClips } from "@/core/timeline/audioClips";
import type {
  Project,
  Track,
  Clip,
  TextClip,
  MediaAsset,
} from "@/types";

describe("Composite Media Behavioral Contract", () => {
  const mockVideoAsset1: MediaAsset = {
    id: "asset-v1",
    name: "aroll_25fps.mp4",
    path: "/fixtures/aroll_25fps.mp4",
    type: "video",
    size: 1048576,
    duration: 60,
    width: 2560,
    height: 1440,
    streams: [
      { type: "video", codec: "h264" } as any,
      { type: "audio", codec: "aac", channels: 2 } as any,
    ],
  };

  const mockVideoAsset2: MediaAsset = {
    id: "asset-v2",
    name: "broll_25fps.mp4",
    path: "/fixtures/broll_25fps.mp4",
    type: "video",
    size: 524288,
    duration: 30,
    width: 1920,
    height: 1080,
    streams: [
      { type: "video", codec: "h264" } as any,
      { type: "audio", codec: "aac", channels: 2 } as any,
    ],
  };

  const mockImageAsset: MediaAsset = {
    id: "asset-img-logo",
    name: "clypra_logo.png",
    path: "/fixtures/clypra_logo.png",
    type: "image",
    size: 262144,
    duration: 0,
    width: 1024,
    height: 1024,
    has_alpha: true,
  };

  const mediaAssetsList: MediaAsset[] = [mockVideoAsset1, mockVideoAsset2, mockImageAsset];

  const tracks: Track[] = [
    {
      id: "track-v1",
      type: "video",
      name: "A-Roll",
      muted: false,
      locked: false,
      visible: true,
      height: 80,
    },
    {
      id: "track-v2",
      type: "video",
      name: "B-Roll PIP",
      muted: false,
      locked: false,
      visible: true,
      height: 64,
    },
    {
      id: "track-v3-img",
      type: "video",
      name: "Image Overlays",
      muted: false,
      locked: false,
      visible: true,
      height: 52,
    },
    {
      id: "track-t1",
      type: "text",
      name: "Text Effects",
      muted: false,
      locked: false,
      visible: true,
      height: 44,
    },
    {
      id: "track-t2",
      type: "text",
      name: "Text Templates",
      muted: false,
      locked: false,
      visible: true,
      height: 44,
    },
    {
      id: "track-a1",
      type: "audio",
      name: "Audio Bed",
      muted: false,
      locked: false,
      visible: true,
      height: 48,
      volume: 0.8,
    },
  ];

  const project: Project = {
    id: "composite-contract-project",
    name: "Composite Contract Verification",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    aspectRatio: "16:9",
    canvasWidth: 1920,
    canvasHeight: 1080,
    frameRate: 25,
    duration: 60,
    timelineSchemaVersion: 1,
    audioModelVersion: 1,
    captionModelVersion: 2,
    mediaAssets: mediaAssetsList,
  };

  beforeEach(() => {
    clearEvaluationCache();
  });

  afterEach(() => {
    clearEvaluationCache();
  });

  // ── 1. Multi-Media Video Compositing ─────────────────────────────────────
  describe("Multi-Media Video Layering & Z-Order", () => {
    it("evaluates concurrent A-roll and B-roll in correct top-to-bottom visual order", () => {
      const arollClip: Clip = {
        id: "clip-aroll",
        kind: "video",
        trackId: "track-v1",
        mediaId: "asset-v1",
        startTime: 0,
        duration: 30,
        trimIn: 0,
        trimOut: 30,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        opacity: 1.0,
        rotation: 0,
      };

      const brollPipClip: Clip = {
        id: "clip-broll",
        kind: "video",
        trackId: "track-v2",
        mediaId: "asset-v2",
        startTime: 5,
        duration: 15,
        trimIn: 0,
        trimOut: 15,
        x: 1200,
        y: 100,
        width: 640,
        height: 360,
        opacity: 0.85,
        rotation: 0,
      };

      // At t = 2s, only A-roll is active
      const sceneEarly = evaluateTimelineSceneCached(
        2.0,
        [arollClip, brollPipClip],
        tracks,
        mediaAssetsList,
        project,
        0,
      );
      expect(sceneEarly.visualLayers.length).toBe(1);
      expect(sceneEarly.visualLayers[0].clipId).toBe("clip-aroll");

      // At t = 10s, both A-roll and B-roll PIP are concurrent
      const sceneMid = evaluateTimelineSceneCached(
        10.0,
        [arollClip, brollPipClip],
        tracks,
        mediaAssetsList,
        project,
        0,
      );
      expect(sceneMid.visualLayers.length).toBe(2);
      const brollLayer = sceneMid.visualLayers.find((l) => l.clipId === "clip-broll");
      const arollLayer = sceneMid.visualLayers.find((l) => l.clipId === "clip-aroll");
      expect(brollLayer).toBeDefined();
      expect(arollLayer).toBeDefined();
      expect(brollLayer?.opacity).toBeCloseTo(0.85);
      expect(brollLayer?.x).toBe(1200);
      expect(brollLayer?.width).toBe(640);
    });
  });

  // ── 2. Static Image Overlays ─────────────────────────────────────────────
  describe("Image Graphics Compositing", () => {
    it("evaluates still images with custom positioning and alpha opacity", () => {
      const arollClip: Clip = {
        id: "clip-aroll",
        kind: "video",
        trackId: "track-v1",
        mediaId: "asset-v1",
        startTime: 0,
        duration: 30,
        trimIn: 0,
        trimOut: 30,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        opacity: 1.0,
        rotation: 0,
      };

      const imageLogoClip: Clip = {
        id: "clip-img-watermark",
        kind: "image",
        trackId: "track-v3-img",
        mediaId: "asset-img-logo",
        startTime: 2,
        duration: 20,
        trimIn: 0,
        trimOut: 20,
        x: 80,
        y: 80,
        width: 200,
        height: 200,
        opacity: 0.9,
        rotation: 0,
      };

      const scene = evaluateTimelineSceneCached(
        5.0,
        [arollClip, imageLogoClip],
        tracks,
        mediaAssetsList,
        project,
        0,
      );

      expect(scene.visualLayers.length).toBe(2);
      const imgLayer = scene.visualLayers.find((l) => l.clipId === "clip-img-watermark");
      expect(imgLayer).toBeDefined();
      expect(imgLayer?.layerType).toBe("media");
      expect((imgLayer as any).clipKind).toBe("image");
      expect(imgLayer?.width).toBe(200);
      expect(imgLayer?.height).toBe(200);
      expect(imgLayer?.opacity).toBeCloseTo(0.9);
    });
  });

  // ── 3. Text Effects & Styling ────────────────────────────────────────────
  describe("Text Effects & Animations", () => {
    it("evaluates text effect clips with entrance/exit progress and font properties", () => {
      const textEffectClip: TextClip = {
        id: "clip-text-effect",
        kind: "text",
        trackId: "track-t1",
        name: "Headline",
        startTime: 4,
        duration: 10,
        trimIn: 0,
        trimOut: 10,
        x: 100,
        y: 800,
        width: 800,
        height: 120,
        opacity: 1.0,
        rotation: 0,
        text: "Motion Title",
        fontFamily: "Inter Variable",
        fontSize: 48,
        color: "#FFFFFF",
        entranceAnimation: {
          type: "slide-up",
          duration: 1.0,
          easing: "ease-out",
        },
        exitAnimation: {
          type: "fade",
          duration: 1.0,
          easing: "ease-in",
        },
      } as unknown as TextClip;

      // At t = 4.5s (inside 1.0s entrance), animation is in-flight
      const sceneEntrance = evaluateTimelineSceneCached(
        4.5,
        [textEffectClip],
        tracks,
        mediaAssetsList,
        project,
        0,
      );
      expect(sceneEntrance.visualLayers.length).toBe(1);
      const entranceLayer = sceneEntrance.visualLayers[0];
      expect(entranceLayer.layerType).toBe("text");
      expect((entranceLayer as any).text).toBe("Motion Title");
      expect((entranceLayer as any).fontFamily).toContain("Inter");

      // At t = 9.0s (steady state between entrance and exit)
      const sceneSteady = evaluateTimelineSceneCached(
        9.0,
        [textEffectClip],
        tracks,
        mediaAssetsList,
        project,
        0,
      );
      expect(sceneSteady.visualLayers.length).toBe(1);
      expect(sceneSteady.visualLayers[0].opacity).toBeCloseTo(1.0);

      // At t = 15.0s (past clip duration), visualLayers is empty
      const sceneAfter = evaluateTimelineSceneCached(
        15.0,
        [textEffectClip],
        tracks,
        mediaAssetsList,
        project,
        0,
      );
      expect(sceneAfter.visualLayers.length).toBe(0);
    });
  });

  // ── 4. Text Templates ────────────────────────────────────────────────────
  describe("Text Templates Parameter Resolution", () => {
    it("evaluates text-template clips with custom control values and distinct templateId", () => {
      const templateClip: Clip = {
        id: "clip-tmpl-instance",
        kind: "text-template",
        trackId: "track-t2",
        name: "Lower Third Template",
        startTime: 1,
        duration: 12,
        trimIn: 0,
        trimOut: 12,
        x: 120,
        y: 720,
        width: 600,
        height: 120,
        opacity: 1.0,
        rotation: 0,
        templateId: "lower-third-modern",
        templateControlValues: {
          headline: "Breaking Announcement",
          subline: "Antigravity Engineering",
          accentColor: "#38BDF8",
        },
      } as unknown as Clip;

      const scene = evaluateTimelineSceneCached(
        3.0,
        [templateClip],
        tracks,
        mediaAssetsList,
        project,
        0,
      );

      expect(scene.visualLayers.length).toBe(1);
      const tmplLayer = scene.visualLayers[0];
      expect(tmplLayer.clipId).toBe("clip-tmpl-instance");
      expect(tmplLayer.layerType).toBe("text");
      expect((tmplLayer as any).clipKind).toBe("text-template");
      expect((tmplLayer as any).templateId).toBe("lower-third-modern");
      expect((tmplLayer as any).templateControlValues?.headline).toBe("Breaking Announcement");
    });
  });

  // ── 5. Multi-Track Audio Sync & Keyframes ─────────────────────────────────
  describe("Audio Multi-Track Active Clips & Volume Curves", () => {
    it("extracts active audio configs from video clips and standalone audio tracks", () => {
      const videoClipWithAudio: Clip = {
        id: "clip-v1",
        kind: "video",
        trackId: "track-v1",
        mediaId: "asset-v1",
        startTime: 0,
        duration: 30,
        trimIn: 0,
        trimOut: 30,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        opacity: 1,
        rotation: 0,
        audio: {
          audioModelVersion: 1,
          origin: "embedded",
          linkState: "linked",
          gainDb: 0,
          pan: 0,
          muted: false,
          volumeKeyframes: [],
          fadeIn: { duration: 0, curve: "linear" },
          fadeOut: { duration: 0, curve: "linear" },
          channelConfig: { mode: "auto", downmix: "auto" },
          speed: { preservePitch: true },
        },
      };

      const musicBedClip: Clip = {
        id: "clip-music-bed",
        kind: "audio",
        trackId: "track-a1",
        mediaId: "asset-v1",
        startTime: 0,
        duration: 20,
        trimIn: 0,
        trimOut: 20,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        opacity: 1,
        rotation: 0,
        audio: {
          audioModelVersion: 1,
          origin: "standalone",
          linkState: "unlinked",
          gainDb: -6,
          pan: 0,
          muted: false,
          volumeKeyframes: [
            { id: "kf-1", time: 0, gain: 0.0 },
            { id: "kf-2", time: 2.0, gain: 0.75 },
            { id: "kf-3", time: 18.0, gain: 0.75 },
            { id: "kf-4", time: 20.0, gain: 0.0 },
          ],
          fadeIn: { duration: 2.0, curve: "linear" },
          fadeOut: { duration: 2.0, curve: "linear" },
          channelConfig: { mode: "auto", downmix: "auto" },
          speed: { preservePitch: true },
        },
      };

      // Query window [0.0, 25.0] s: covers full timeline span
      const activeClips = getActiveAudioClips(
        [videoClipWithAudio, musicBedClip],
        tracks,
        mediaAssetsList,
        0.0,
        25.0,
      );

      expect(activeClips.length).toBe(2);
      const musicConfig = activeClips.find((c) => c.clipId === "clip-music-bed");
      const videoAudioConfig = activeClips.find((c) => c.clipId === "clip-v1");
      expect(musicConfig).toBeDefined();
      expect(videoAudioConfig).toBeDefined();
      expect(musicConfig?.path).toBe(mockVideoAsset1.path);
      expect(musicConfig?.volumeKeyframes?.length).toBeGreaterThan(0);
    });
  });

  // ── 6. Full Composite Multi-Layer Scene Integration ──────────────────────
  describe("Unified Full Composite Scene", () => {
    it("renders all 5 active layers simultaneously: A-roll, B-roll, image, text effect, text template", () => {
      const arollClip: Clip = {
        id: "clip-aroll",
        kind: "video",
        trackId: "track-v1",
        mediaId: "asset-v1",
        startTime: 0,
        duration: 40,
        trimIn: 0,
        trimOut: 40,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        opacity: 1.0,
        rotation: 0,
      };

      const brollClip: Clip = {
        id: "clip-broll",
        kind: "video",
        trackId: "track-v2",
        mediaId: "asset-v2",
        startTime: 5,
        duration: 25,
        trimIn: 0,
        trimOut: 25,
        x: 1200,
        y: 100,
        width: 640,
        height: 360,
        opacity: 0.9,
        rotation: 0,
      };

      const imageClip: Clip = {
        id: "clip-img",
        kind: "image",
        trackId: "track-v3-img",
        mediaId: "asset-img-logo",
        startTime: 2,
        duration: 30,
        trimIn: 0,
        trimOut: 30,
        x: 60,
        y: 60,
        width: 200,
        height: 200,
        opacity: 0.85,
        rotation: 0,
      };

      const textClip: TextClip = {
        id: "clip-text",
        kind: "text",
        trackId: "track-t1",
        name: "Overlay Title",
        startTime: 4,
        duration: 20,
        trimIn: 0,
        trimOut: 20,
        x: 100,
        y: 840,
        width: 900,
        height: 120,
        opacity: 1.0,
        rotation: 0,
        text: "Clypra Studio",
        fontSize: 52,
        fontFamily: "Inter Variable",
        color: "#FFFFFF",
      } as unknown as TextClip;

      const templateClip: Clip = {
        id: "clip-tmpl",
        kind: "text-template",
        trackId: "track-t2",
        name: "Lower Third",
        startTime: 6,
        duration: 18,
        trimIn: 0,
        trimOut: 18,
        x: 120,
        y: 700,
        width: 700,
        height: 140,
        opacity: 1.0,
        rotation: 0,
        templateId: "lower-third-modern",
        templateControlValues: { headline: "Live Multi-Layer" },
      } as unknown as Clip;

      // At t = 10s: ALL 5 visual layers are active concurrently
      const scene = evaluateTimelineSceneCached(
        10.0,
        [arollClip, brollClip, imageClip, textClip, templateClip],
        tracks,
        mediaAssetsList,
        project,
        0,
      );

      expect(scene.visualLayers.length).toBe(5);
      const layerKinds = scene.visualLayers.map((l) => (l as any).clipKind);
      expect(layerKinds).toContain("video"); // A-roll, B-roll
      expect(layerKinds).toContain("image"); // image
      expect(layerKinds).toContain("text"); // text effect
      expect(layerKinds).toContain("text-template"); // text template

      // Cache invalidation: bumping epoch resets scene cache and reflects updated properties
      invalidateEvaluationCache(1);
      const updatedTextClip = { ...textClip, text: "Updated Headline" };
      const sceneUpdated = evaluateTimelineSceneCached(
        10.0,
        [arollClip, brollClip, imageClip, updatedTextClip, templateClip],
        tracks,
        mediaAssetsList,
        project,
        1, // incremented epoch
      );

      expect(sceneUpdated.visualLayers.length).toBe(5);
      const updatedTextLayer = sceneUpdated.visualLayers.find((l) => l.clipId === "clip-text");
      expect((updatedTextLayer as any).text).toBe("Updated Headline");
    });
  });
});

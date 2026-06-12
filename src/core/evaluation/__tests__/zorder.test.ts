/**
 * Z-Order and Track Compositing Tests
 *
 * Validates that clips are rendered in the correct visual stacking order
 * based on role, trackIndex, and zIndex properties.
 *
 * KEY PRINCIPLES:
 * 1. Role sorting is PRIMARY: background(0) < primary(1) < overlay(2) < text(3) < effect(4)
 * 2. Within same role: higher trackIndex draws FIRST (bottom), lower trackIndex draws LAST (top)
 * 3. The rasterizer draws visualLayers[0] first, then [1], etc. Last drawn = on top visually
 */

import { describe, it, expect, vi } from "vitest";
import { evaluateTimelineScene as evaluateScene } from "../evaluator";
import type { Clip, Track, MediaAsset, Project, TextClip } from "@/types";

// Mock Tauri API
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
  invoke: vi.fn(),
}));

describe("Z-Order and Track Compositing", () => {
  const project: Project = {
    id: "test-project",
    name: "Test",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    aspectRatio: "16:9",
    canvasWidth: 1920,
    canvasHeight: 1080,
    frameRate: 30,
    duration: 10,
  };

  const createTrack = (id: string, type: "video" | "audio" | "text" = "video"): Track => ({
    id,
    type,
    name: `Track ${id}`,
    muted: false,
    locked: false,
    visible: true,
    height: 68,
  });

  const createVideoClip = (id: string, trackId: string, mediaId: string): Clip => ({
    id,
    trackId,
    mediaId,
    startTime: 0,
    duration: 10,
    trimIn: 0,
    trimOut: 10,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    opacity: 1.0,
    rotation: 0,
  });

  const createImageClip = (id: string, trackId: string, mediaId: string): Clip => ({
    id,
    trackId,
    mediaId,
    startTime: 0,
    duration: 10,
    trimIn: 0,
    trimOut: 10,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    opacity: 1.0,
    rotation: 0,
  });

  const createTextClip = (id: string, trackId: string, text: string): TextClip => ({
    id,
    kind: "text",
    trackId,
    mediaId: "",
    startTime: 0,
    duration: 10,
    trimIn: 0,
    trimOut: 10,
    x: 100,
    y: 900,
    width: 1720,
    height: 100,
    opacity: 1.0,
    rotation: 0,
    text,
    fontSize: 48,
    fontFamily: "Inter",
    color: "#ffffff",
    fontWeight: "normal",
    fontStyle: "normal",
    align: "center",
    valign: "middle",
    lineHeight: 1.2,
    letterSpacing: 0,
    paddingX: 16,
    paddingY: 16,
  });

  const createVideoAsset = (id: string, name: string): MediaAsset => ({
    id,
    name,
    path: `/path/to/${name}`,
    type: "video",
    duration: 10,
    width: 1920,
    height: 1080,
    size: 1000000,
  });

  const createImageAsset = (id: string, name: string): MediaAsset => ({
    id,
    name,
    path: `/path/to/${name}`,
    type: "image",
    duration: 0,
    width: 1920,
    height: 1080,
    size: 500000,
  });

  describe("Role-Based Sorting (Primary Concern)", () => {
    it("sorts clips by role: primary before overlay before text", () => {
      const tracks = [createTrack("t0"), createTrack("t1"), createTrack("t2", "text")];
      const assets = [createVideoAsset("v1", "video1.mp4"), createImageAsset("i1", "overlay.png")];

      const clips = [{ ...createVideoClip("overlay", "t1", "i1"), role: "overlay" } as Clip, { ...createVideoClip("primary", "t0", "v1"), role: "primary" } as Clip, createTextClip("text", "t2", "Title") as any];

      const scene = evaluateScene(5, clips, tracks, assets, project);

      expect(scene.visualLayers).toHaveLength(3);

      // Role order: primary(1) < overlay(2) < text(3)
      expect(scene.visualLayers[0].clipId).toBe("primary");
      expect(scene.visualLayers[0].role).toBe("primary");

      expect(scene.visualLayers[1].clipId).toBe("overlay");
      expect(scene.visualLayers[1].role).toBe("overlay");

      expect(scene.visualLayers[2].clipId).toBe("text");
      expect(scene.visualLayers[2].role).toBe("text");
    });

    it("places overlay role above primary role regardless of track position", () => {
      const tracks = [createTrack("t0"), createTrack("t1")];
      const assets = [createVideoAsset("v1", "main.mp4"), createImageAsset("img", "watermark.png")];

      const clips = [
        { ...createVideoClip("main", "t1", "v1"), role: "primary" } as Clip, // Bottom track
        { ...createImageClip("watermark", "t0", "img"), role: "overlay" } as Clip, // Top track
      ];

      const scene = evaluateScene(5, clips, tracks, assets, project);

      expect(scene.visualLayers).toHaveLength(2);

      // Primary draws first (background)
      expect(scene.visualLayers[0].clipId).toBe("main");
      expect(scene.visualLayers[0].role).toBe("primary");

      // Overlay draws last (on top)
      expect(scene.visualLayers[1].clipId).toBe("watermark");
      expect(scene.visualLayers[1].role).toBe("overlay");
    });
  });

  describe("Track Order Within Same Role", () => {
    it("within same role, higher trackIndex draws first (bottom), lower draws last (top)", () => {
      const tracks = [createTrack("t0"), createTrack("t1"), createTrack("t2")];
      const assets = [createImageAsset("i1", "1.png"), createImageAsset("i2", "2.png"), createImageAsset("i3", "3.png")];

      const clips = [
        { ...createImageClip("top", "t0", "i1"), role: "overlay" } as Clip, // trackIdx=0 (top in UI)
        { ...createImageClip("middle", "t1", "i2"), role: "overlay" } as Clip, // trackIdx=1
        { ...createImageClip("bottom", "t2", "i3"), role: "overlay" } as Clip, // trackIdx=2 (bottom in UI)
      ];

      const scene = evaluateScene(5, clips, tracks, assets, project);

      expect(scene.visualLayers).toHaveLength(3);

      // All same role (overlay), sorted by trackIndex descending
      expect(scene.visualLayers[0].clipId).toBe("bottom"); // trackIdx=2, draws FIRST
      expect(scene.visualLayers[1].clipId).toBe("middle"); // trackIdx=1
      expect(scene.visualLayers[2].clipId).toBe("top"); // trackIdx=0, draws LAST = ON TOP visually
    });

    it("image on top track appears above video on bottom track (same role)", () => {
      const tracks = [createTrack("t0"), createTrack("t1")];
      const assets = [createVideoAsset("video", "background.mp4"), createImageAsset("img", "logo.png")];

      const clips = [
        { ...createImageClip("overlay", "t0", "img"), role: "overlay" } as Clip, // Top track
        { ...createVideoClip("video", "t1", "video"), role: "overlay" } as Clip, // Bottom track, explicit overlay role
      ];

      const scene = evaluateScene(5, clips, tracks, assets, project);

      expect(scene.visualLayers).toHaveLength(2);

      // Both overlay role, sorted by trackIndex
      expect(scene.visualLayers[0].clipId).toBe("video"); // trackIdx=1, draws first (background)
      expect(scene.visualLayers[1].clipId).toBe("overlay"); // trackIdx=0, draws last (on top)
    });
  });

  describe("Complex Multi-Role and Multi-Track", () => {
    it("correctly orders 5 tracks with mixed roles", () => {
      const tracks = [
        createTrack("t0", "video"), // trackIndex=0
        createTrack("t1", "video"), // trackIndex=1
        createTrack("t2", "video"), // trackIndex=2
        createTrack("t3", "video"), // trackIndex=3
        createTrack("t4", "text"), // trackIndex=4
      ];

      const assets = [createVideoAsset("v0", "video0.mp4"), createImageAsset("i1", "layer1.png"), createImageAsset("i2", "layer2.png"), createVideoAsset("v3", "video3.mp4")];

      const clips = [{ ...createImageClip("top", "t0", "i1"), role: "overlay" } as Clip, { ...createImageClip("upper", "t1", "i2"), role: "overlay" } as Clip, { ...createVideoClip("middle", "t2", "v0"), role: "primary" } as Clip, { ...createVideoClip("lower", "t3", "v3"), role: "primary" } as Clip, createTextClip("text", "t4", "Caption") as any];

      const scene = evaluateScene(5, clips, tracks, assets, project);

      expect(scene.visualLayers).toHaveLength(5);

      // Role order: primary(1) < overlay(2) < text(3)
      // Within primary: higher trackIndex first
      expect(scene.visualLayers[0].clipId).toBe("lower"); // primary, trackIdx=3
      expect(scene.visualLayers[1].clipId).toBe("middle"); // primary, trackIdx=2

      // Within overlay: higher trackIndex first
      expect(scene.visualLayers[2].clipId).toBe("upper"); // overlay, trackIdx=1
      expect(scene.visualLayers[3].clipId).toBe("top"); // overlay, trackIdx=0

      // Text role highest
      expect(scene.visualLayers[4].clipId).toBe("text"); // text role
    });
  });

  describe("Edge Cases", () => {
    it("handles single clip", () => {
      const tracks = [createTrack("t0")];
      const assets = [createVideoAsset("v1", "video.mp4")];
      const clips = [createVideoClip("clip1", "t0", "v1")];

      const scene = evaluateScene(5, clips, tracks, assets, project);

      expect(scene.visualLayers).toHaveLength(1);
      expect(scene.visualLayers[0].clipId).toBe("clip1");
    });

    it("handles empty timeline", () => {
      const tracks = [createTrack("t0")];
      const clips: Clip[] = [];
      const assets: MediaAsset[] = [];

      const scene = evaluateScene(5, clips, tracks, assets, project);

      expect(scene.visualLayers).toHaveLength(0);
      expect(scene.metadata.isGap).toBe(true);
    });

    it("filters clips on invisible tracks", () => {
      const tracks = [createTrack("t0"), { ...createTrack("t1"), visible: false }, createTrack("t2")];

      const assets = [createVideoAsset("v1", "v1.mp4"), createVideoAsset("v2", "v2.mp4"), createVideoAsset("v3", "v3.mp4")];

      const clips = [
        { ...createVideoClip("c0", "t0", "v1"), role: "overlay" } as Clip,
        { ...createVideoClip("c1", "t1", "v2"), role: "overlay" } as Clip, // Invisible track
        { ...createVideoClip("c2", "t2", "v3"), role: "overlay" } as Clip,
      ];

      const scene = evaluateScene(5, clips, tracks, assets, project);

      expect(scene.visualLayers).toHaveLength(2);
      expect(scene.visualLayers.find((l) => l.clipId === "c1")).toBeUndefined();
    });

    it("handles clips with same role and track sorted by zIndex", () => {
      const tracks = [createTrack("t0")];
      const assets = [createImageAsset("i1", "1.png"), createImageAsset("i2", "2.png")];

      const clips = [{ ...createImageClip("low", "t0", "i1"), role: "overlay", zIndex: 5 } as Clip, { ...createImageClip("high", "t0", "i2"), role: "overlay", zIndex: 10 } as Clip];

      const scene = evaluateScene(5, clips, tracks, assets, project);

      expect(scene.visualLayers).toHaveLength(2);
      // Lower zIndex draws first
      expect(scene.visualLayers[0].clipId).toBe("low");
      expect(scene.visualLayers[1].clipId).toBe("high");
    });

    it("filters audio-only clips from visual layers", () => {
      const tracks = [createTrack("t0", "video"), createTrack("t1", "audio")];
      // Audio assets need explicit audio type to be filtered from visual layers
      const audioAsset: MediaAsset = {
        id: "a1",
        name: "audio.mp3",
        path: "/path/to/audio.mp3",
        type: "audio" as any, // Explicit audio type
        duration: 10,
        width: 0,
        height: 0,
        size: 500000,
      };
      const assets = [createVideoAsset("v1", "video.mp4"), audioAsset];

      const clips = [{ ...createVideoClip("video", "t0", "v1"), role: "primary" } as Clip, { ...createVideoClip("audio", "t1", "a1"), role: "audio" } as Clip];

      const scene = evaluateScene(5, clips, tracks, assets, project);

      // Only video clip should create visual layer (audio role + audio type asset = no visual layer)
      expect(scene.visualLayers).toHaveLength(1);
      expect(scene.visualLayers[0].clipId).toBe("video");

      // Both clips create audio layers:
      // - The "audio" clip because role="audio"
      // - The "video" clip because it's a video asset with role="primary"
      expect(scene.audioLayers).toHaveLength(2);
      expect(scene.audioLayers.some((l) => l.clipId === "video")).toBe(true);
      expect(scene.audioLayers.some((l) => l.clipId === "audio")).toBe(true);
    });

    it("maintains order regardless of opacity", () => {
      const tracks = [createTrack("t0"), createTrack("t1")];
      const assets = [createImageAsset("i1", "transparent.png"), createVideoAsset("v1", "background.mp4")];

      const clips = [{ ...createImageClip("transparent", "t0", "i1"), role: "overlay", opacity: 0.5 } as Clip, { ...createVideoClip("opaque", "t1", "v1"), role: "overlay" } as Clip];

      const scene = evaluateScene(5, clips, tracks, assets, project);

      expect(scene.visualLayers).toHaveLength(2);
      // Both overlay, sorted by trackIndex
      expect(scene.visualLayers[0].clipId).toBe("opaque"); // trackIdx=1
      expect(scene.visualLayers[1].clipId).toBe("transparent"); // trackIdx=0
      expect(scene.visualLayers[1].opacity).toBe(0.5);
    });

    it("preserves blend mode information", () => {
      const tracks = [createTrack("t0"), createTrack("t1")];
      const assets = [createImageAsset("i1", "overlay.png"), createVideoAsset("v1", "base.mp4")];

      const clips = [{ ...createImageClip("blend", "t0", "i1"), role: "overlay", blendMode: "multiply" } as Clip, { ...createVideoClip("base", "t1", "v1"), role: "overlay" } as Clip];

      const scene = evaluateScene(5, clips, tracks, assets, project);

      expect(scene.visualLayers).toHaveLength(2);
      expect(scene.visualLayers[0].clipId).toBe("base"); // trackIdx=1
      expect(scene.visualLayers[1].clipId).toBe("blend"); // trackIdx=0
      expect(scene.visualLayers[1].blendMode).toBe("multiply");
    });
  });

  describe("Regression Test: Original Z-Order Bug", () => {
    it("PNG on top track with overlay role appears above video with primary role", () => {
      const tracks = [createTrack("t0"), createTrack("t1"), createTrack("t2")];
      const assets = [createVideoAsset("video", "background.mp4"), createImageAsset("logo", "logo.png")];

      const clips = [
        { ...createImageClip("png-overlay", "t0", "logo"), role: "overlay" } as Clip, // Top track, overlay role
        { ...createVideoClip("video-bg", "t2", "video"), role: "primary" } as Clip, // Bottom track, primary role
      ];

      const scene = evaluateScene(5, clips, tracks, assets, project);

      expect(scene.visualLayers).toHaveLength(2);

      // Role sorting: primary before overlay
      expect(scene.visualLayers[0].clipId).toBe("video-bg");
      expect(scene.visualLayers[0].role).toBe("primary");

      // Overlay draws last = on top
      expect(scene.visualLayers[1].clipId).toBe("png-overlay");
      expect(scene.visualLayers[1].role).toBe("overlay");

      // Verify z-index progression
      expect(scene.visualLayers[0].zIndex).toBeLessThan(scene.visualLayers[1].zIndex);
    });

    it("within same overlay role, top track (lower trackIndex) draws last (on top)", () => {
      const tracks = [createTrack("t0"), createTrack("t1"), createTrack("t2")];
      const assets = [createImageAsset("i0", "0.png"), createImageAsset("i1", "1.png"), createImageAsset("i2", "2.png")];

      const clips = [
        { ...createImageClip("img0", "t0", "i0"), role: "overlay" } as Clip, // Top track
        { ...createImageClip("img1", "t1", "i1"), role: "overlay" } as Clip, // Middle track
        { ...createImageClip("img2", "t2", "i2"), role: "overlay" } as Clip, // Bottom track
      ];

      const scene = evaluateScene(5, clips, tracks, assets, project);

      expect(scene.visualLayers).toHaveLength(3);

      // All same role, sorted by trackIndex descending (higher first)
      expect(scene.visualLayers[0].clipId).toBe("img2"); // trackIdx=2, draws first
      expect(scene.visualLayers[1].clipId).toBe("img1"); // trackIdx=1
      expect(scene.visualLayers[2].clipId).toBe("img0"); // trackIdx=0, draws last = ON TOP
    });
  });

  describe("Time-Based Filtering", () => {
    it("shows only clips within time bounds", () => {
      const tracks = [createTrack("t0")];
      const assets = [createVideoAsset("v1", "clip1.mp4"), createVideoAsset("v2", "clip2.mp4")];

      const clip1 = { ...createVideoClip("clip1", "t0", "v1"), startTime: 0, duration: 5, trimOut: 5, role: "primary" } as Clip;
      const clip2 = { ...createVideoClip("clip2", "t0", "v2"), startTime: 5, duration: 5, trimIn: 0, trimOut: 5, role: "primary" } as Clip;

      // At time 3, only clip1
      const scene1 = evaluateScene(3, [clip1, clip2], tracks, assets, project);
      expect(scene1.visualLayers).toHaveLength(1);
      expect(scene1.visualLayers[0].clipId).toBe("clip1");

      // At time 7, only clip2
      const scene2 = evaluateScene(7, [clip1, clip2], tracks, assets, project);
      expect(scene2.visualLayers).toHaveLength(1);
      expect(scene2.visualLayers[0].clipId).toBe("clip2");
    });

    it("handles boundary time correctly", () => {
      const tracks = [createTrack("t0")];
      const assets = [createVideoAsset("v1", "video.mp4")];
      const clip = { ...createVideoClip("clip", "t0", "v1"), startTime: 5, duration: 0.01, trimOut: 0.01, role: "primary" } as Clip;

      const sceneBefore = evaluateScene(4.999, [clip], tracks, assets, project);
      expect(sceneBefore.visualLayers).toHaveLength(0);

      const sceneAt = evaluateScene(5, [clip], tracks, assets, project);
      expect(sceneAt.visualLayers).toHaveLength(1);
    });
  });
});

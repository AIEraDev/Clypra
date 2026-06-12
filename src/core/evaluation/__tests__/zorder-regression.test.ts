/**
 * Z-Order Regression Test — Verification of Fix
 *
 * This test specifically verifies that the role inference fix resolves
 * the reported bug: PNG on top track appearing behind video on bottom track.
 */

import { describe, it, expect, vi } from "vitest";
import { evaluateTimelineScene } from "../evaluator";
import type { Clip, Track, MediaAsset, Project } from "@/types";

// Mock Tauri API
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
  invoke: vi.fn(),
}));

describe("Z-Order Regression — Role Inference Fix", () => {
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

  describe("Original Bug Scenario", () => {
    it("PNG on top track (trackIndex=0) appears ABOVE video on bottom track (trackIndex=1)", () => {
      // Setup: Two video tracks
      const tracks = [
        createTrack("t0", "video"), // Top track in UI, trackIndex=0
        createTrack("t1", "video"), // Bottom track in UI, trackIndex=1
      ];

      const assets = [createImageAsset("png", "logo.png"), createVideoAsset("video", "background.mp4")];

      // PNG clip on top track, video clip on bottom track
      // NO explicit roles — rely on inference
      const clips = [createImageClip("png-clip", "t0", "png"), createVideoClip("video-clip", "t1", "video")];

      const scene = evaluateTimelineScene(5, clips, tracks, assets, project);

      expect(scene.visualLayers).toHaveLength(2);

      // CRITICAL: After fix, both clips should have role="overlay"
      expect(scene.visualLayers[0].role).toBe("overlay");
      expect(scene.visualLayers[1].role).toBe("overlay");

      // CRITICAL: Video (trackIndex=1) should draw FIRST (bottom)
      expect(scene.visualLayers[0].clipId).toBe("video-clip");
      expect(scene.visualLayers[0].zIndex).toBe(0);

      // CRITICAL: PNG (trackIndex=0) should draw LAST (on top)
      expect(scene.visualLayers[1].clipId).toBe("png-clip");
      expect(scene.visualLayers[1].zIndex).toBe(1);

      // Verify the array ordering implies correct draw order
      const videoLayerIndex = scene.visualLayers.findIndex((l) => l.clipId === "video-clip");
      const pngLayerIndex = scene.visualLayers.findIndex((l) => l.clipId === "png-clip");

      expect(videoLayerIndex).toBeLessThan(pngLayerIndex);
      // Video draws first (index 0) → below
      // PNG draws last (index 1) → on top ✅
    });

    it("Three video tracks: all get overlay role, sorted by trackIndex descending", () => {
      const tracks = [
        createTrack("t0", "video"), // Top, trackIndex=0
        createTrack("t1", "video"), // Middle, trackIndex=1
        createTrack("t2", "video"), // Bottom, trackIndex=2
      ];

      const assets = [createImageAsset("img0", "top.png"), createImageAsset("img1", "middle.png"), createImageAsset("img2", "bottom.png")];

      const clips = [createImageClip("clip0", "t0", "img0"), createImageClip("clip1", "t1", "img1"), createImageClip("clip2", "t2", "img2")];

      const scene = evaluateTimelineScene(5, clips, tracks, assets, project);

      expect(scene.visualLayers).toHaveLength(3);

      // All should be overlay role
      scene.visualLayers.forEach((layer) => {
        expect(layer.role).toBe("overlay");
      });

      // Draw order: highest trackIndex first (bottom), lowest last (top)
      expect(scene.visualLayers[0].clipId).toBe("clip2"); // trackIndex=2, draws first (bottom)
      expect(scene.visualLayers[1].clipId).toBe("clip1"); // trackIndex=1, draws middle
      expect(scene.visualLayers[2].clipId).toBe("clip0"); // trackIndex=0, draws last (top)
    });
  });

  describe("Role Inference Verification", () => {
    it("video track type infers role=overlay (not primary)", () => {
      const tracks = [createTrack("t0", "video")];
      const assets = [createVideoAsset("v", "video.mp4")];
      const clips = [createVideoClip("clip", "t0", "v")];

      const scene = evaluateTimelineScene(5, clips, tracks, assets, project);

      expect(scene.visualLayers).toHaveLength(1);
      expect(scene.visualLayers[0].role).toBe("overlay"); // Changed from "primary"
    });

    it("audio and text tracks still infer correct roles", () => {
      const tracks = [createTrack("t0", "video"), createTrack("t1", "audio"), createTrack("t2", "text")];

      // Create minimal clips with type information
      const videoClip = createVideoClip("video", "t0", "v1");
      const audioClip = { ...createVideoClip("audio", "t1", "a1") };
      const textClip: any = {
        id: "text",
        kind: "text",
        trackId: "t2",
        mediaId: "",
        startTime: 0,
        duration: 10,
        trimIn: 0,
        trimOut: 10,
        x: 0,
        y: 0,
        width: 1920,
        height: 100,
        opacity: 1.0,
        rotation: 0,
        text: "Title",
        fontSize: 48,
        fontFamily: "Inter",
        color: "#ffffff",
      };

      const assets = [createVideoAsset("v1", "video.mp4"), { ...createVideoAsset("a1", "audio.mp3"), type: "audio" as any }];

      const scene = evaluateTimelineScene(5, [videoClip, audioClip, textClip], tracks, assets, project);

      // Video should be overlay
      const videoLayer = scene.visualLayers.find((l) => l.clipId === "video");
      expect(videoLayer?.role).toBe("overlay");

      // Text should be text
      const textLayer = scene.visualLayers.find((l) => l.clipId === "text");
      expect(textLayer?.role).toBe("text");

      // Audio should create audio layer, not visual layer
      expect(scene.visualLayers.find((l) => l.clipId === "audio")).toBeUndefined();
      expect(scene.audioLayers.some((l) => l.clipId === "video" || l.clipId === "audio")).toBe(true);
    });
  });
});

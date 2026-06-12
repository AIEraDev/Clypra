/**
 * Text Layer Evaluation Tests
 *
 * Validates that text clips are correctly evaluated into EvaluatedTextLayer.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { evaluateTimelineScene as evaluateScene } from "../evaluator";
import type { TextClip, Track, MediaAsset, Project } from "@/types";

// Mock Tauri API
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
  invoke: vi.fn(),
}));

describe("Text Layer Evaluation", () => {
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

  const tracks: Track[] = [{ id: "t1", type: "text", name: "Text 1", muted: false, locked: false, visible: true, height: 56 }];

  it("evaluates text clip into EvaluatedTextLayer", () => {
    const textClip: TextClip = {
      id: "text1",
      kind: "text",
      trackId: "t1",
      mediaId: "",
      startTime: 0,
      duration: 5,
      trimIn: 0,
      trimOut: 5,
      x: 100,
      y: 200,
      width: 800,
      height: 100,
      opacity: 1.0,
      rotation: 0,
      text: "Hello World",
      fontSize: 48,
      fontFamily: "Inter",
      color: "#ffffff",
      fontWeight: "bold",
      fontStyle: "normal",
      align: "center",
      valign: "middle",
      lineHeight: 1.2,
      letterSpacing: 0,
      paddingX: 16,
      paddingY: 16,
    };

    const scene = evaluateScene(2.5, [textClip as any], tracks, [], project);

    expect(scene.visualLayers).toHaveLength(1);

    const layer = scene.visualLayers[0];
    expect(layer.layerType).toBe("text");

    if (layer.layerType === "text") {
      expect(layer.text).toBe("Hello World");
      expect(layer.fontSize).toBe(48);
      expect(layer.fontFamily).toBe("Inter");
      expect(layer.color).toBe("#ffffff");
      expect(layer.fontWeight).toBe("bold");
      expect(layer.fontStyle).toBe("normal");
      expect(layer.x).toBe(100);
      expect(layer.y).toBe(200);
      expect(layer.width).toBe(800);
      expect(layer.height).toBe(100);
    }
  });

  it("filters text clips outside time bounds", () => {
    const textClip: TextClip = {
      id: "text1",
      kind: "text",
      trackId: "t1",
      mediaId: "",
      startTime: 5,
      duration: 3,
      trimIn: 0,
      trimOut: 3,
      x: 100,
      y: 200,
      width: 800,
      height: 100,
      opacity: 1.0,
      rotation: 0,
      text: "Hello World",
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
    };

    // Time before clip starts
    const sceneBefore = evaluateScene(2, [textClip as any], tracks, [], project);
    expect(sceneBefore.visualLayers).toHaveLength(0);

    // Time during clip
    const sceneDuring = evaluateScene(6, [textClip as any], tracks, [], project);
    expect(sceneDuring.visualLayers).toHaveLength(1);

    // Time after clip ends
    const sceneAfter = evaluateScene(10, [textClip as any], tracks, [], project);
    expect(sceneAfter.visualLayers).toHaveLength(0);
  });

  it("filters text clips on invisible tracks", () => {
    const invisibleTrack: Track = {
      id: "t1",
      type: "text",
      name: "Text 1",
      muted: false,
      locked: false,
      visible: false,
      height: 56,
    };

    const textClip: TextClip = {
      id: "text1",
      kind: "text",
      trackId: "t1",
      mediaId: "",
      startTime: 0,
      duration: 5,
      trimIn: 0,
      trimOut: 5,
      x: 100,
      y: 200,
      width: 800,
      height: 100,
      opacity: 1.0,
      rotation: 0,
      text: "Hidden Text",
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
    };

    const scene = evaluateScene(2, [textClip as any], [invisibleTrack], [], project);
    expect(scene.visualLayers).toHaveLength(0);
  });

  it("composites text and video layers correctly", () => {
    const videoTrack: Track = {
      id: "t-video",
      type: "video",
      name: "Video 1",
      muted: false,
      locked: false,
      visible: true,
      height: 68,
    };

    const textTrack: Track = {
      id: "t-text",
      type: "text",
      name: "Text 1",
      muted: false,
      locked: false,
      visible: true,
      height: 56,
    };

    const videoClip = {
      id: "video1",
      trackId: "t-video",
      mediaId: "m1",
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
    };

    const textClip: TextClip = {
      id: "text1",
      kind: "text",
      trackId: "t-text",
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
      text: "Video Title",
      fontSize: 64,
      fontFamily: "Inter",
      color: "#ffffff",
      fontWeight: "bold",
      fontStyle: "normal",
      align: "center",
      valign: "middle",
      lineHeight: 1.2,
      letterSpacing: 0,
      paddingX: 16,
      paddingY: 16,
    };

    const assets: MediaAsset[] = [
      {
        id: "m1",
        name: "video.mp4",
        path: "/path/to/video.mp4",
        type: "video",
        duration: 10,
        width: 1920,
        height: 1080,
        size: 1000000,
      },
    ];

    const scene = evaluateScene(5, [videoClip, textClip as any], [videoTrack, textTrack], assets, project);

    expect(scene.visualLayers).toHaveLength(2);

    // Video should be first (lower z-index)
    expect(scene.visualLayers[0].layerType).toBe("media");
    expect(scene.visualLayers[0].clipId).toBe("video1");

    // Text should be second (higher z-index)
    expect(scene.visualLayers[1].layerType).toBe("text");
    expect(scene.visualLayers[1].clipId).toBe("text1");
  });

  it("applies opacity and transforms to text layers", () => {
    const textClip: TextClip = {
      id: "text1",
      kind: "text",
      trackId: "t1",
      mediaId: "",
      startTime: 0,
      duration: 5,
      trimIn: 0,
      trimOut: 5,
      x: 500,
      y: 400,
      width: 800,
      height: 100,
      opacity: 0.75,
      rotation: 15,
      text: "Rotated Text",
      fontSize: 48,
      fontFamily: "Inter",
      color: "#ff0000",
      fontWeight: "normal",
      fontStyle: "italic",
      align: "center",
      valign: "middle",
      lineHeight: 1.2,
      letterSpacing: 0,
      paddingX: 16,
      paddingY: 16,
    };

    const scene = evaluateScene(2, [textClip as any], tracks, [], project);

    expect(scene.visualLayers).toHaveLength(1);

    const layer = scene.visualLayers[0];
    if (layer.layerType === "text") {
      expect(layer.opacity).toBe(0.75);
      expect(layer.rotation).toBe(15);
      expect(layer.fontStyle).toBe("italic");
      expect(layer.color).toBe("#ff0000");
    }
  });

  it("evaluates custom stroke, shadow, and background styles", () => {
    const textClip: TextClip = {
      id: "text-styled",
      kind: "text",
      trackId: "t1",
      mediaId: "",
      startTime: 0,
      duration: 5,
      trimIn: 0,
      trimOut: 5,
      x: 100,
      y: 100,
      width: 400,
      height: 100,
      opacity: 1.0,
      rotation: 0,
      text: "Styled Text",
      fontSize: 32,
      fontFamily: "Outfit",
      color: "#ffffff",
      fontWeight: "bold",
      fontStyle: "normal",
      align: "center",
      valign: "middle",
      lineHeight: 1.2,
      letterSpacing: 2,
      paddingX: 16,
      paddingY: 16,
      stroke: { color: "#ff0000", width: 6 },
      shadow: { color: "#00ff00", blur: 15, offsetX: 2, offsetY: 2 },
      background: { color: "#000000", padding: 12, borderRadius: 8 },
    };

    const scene = evaluateScene(2, [textClip as any], tracks, [], project);
    expect(scene.visualLayers).toHaveLength(1);

    const layer = scene.visualLayers[0];
    expect(layer.layerType).toBe("text");
    if (layer.layerType === "text") {
      expect(layer.stroke).toEqual({ color: "#ff0000", width: 6 });
      expect(layer.shadow).toEqual({ color: "#00ff00", blur: 15, offsetX: 2, offsetY: 2 });
      expect(layer.background).toEqual({ color: "#000000", padding: 12, borderRadius: 8 });
      expect(layer.letterSpacing).toBe(2);
    }
  });

  it("resolves the clip at the exact end of the timeline (boundary condition)", () => {
    const textClip: TextClip = {
      id: "text-boundary",
      kind: "text",
      trackId: "t1",
      mediaId: "",
      startTime: 0,
      duration: 5,
      trimIn: 0,
      trimOut: 5,
      x: 100,
      y: 100,
      width: 400,
      height: 100,
      opacity: 1.0,
      rotation: 0,
      text: "End Frame Text",
      fontSize: 32,
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
    };

    // Query at exact clipEnd time (5.0) which is also the maxEndTime of the timeline
    const sceneAtEnd = evaluateScene(5.0, [textClip as any], tracks, [], project);
    expect(sceneAtEnd.visualLayers).toHaveLength(1);
    expect(sceneAtEnd.visualLayers[0].clipId).toBe("text-boundary");
    expect(sceneAtEnd.metadata.time).toBeCloseTo(4.999, 3);

    // Query slightly past the end time (e.g. 5.0005) - still within 1ms tolerance
    const sceneSlightlyPast = evaluateScene(5.0005, [textClip as any], tracks, [], project);
    expect(sceneSlightlyPast.visualLayers).toHaveLength(1);
    expect(sceneSlightlyPast.metadata.time).toBeCloseTo(4.999, 3);

    // Query significantly past the end time (e.g. 5.01) - should render blank
    const sceneFarPast = evaluateScene(5.01, [textClip as any], tracks, [], project);
    expect(sceneFarPast.visualLayers).toHaveLength(0);
  });
});

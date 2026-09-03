import { describe, it, expect } from "vitest";
import { evaluateVisualPropertyKeyframes } from "../animation";
import { evaluateTimelineScene } from "../evaluator";
import type { VisualPropertyKeyframe } from "@/types";

describe("Visual Property Keyframing & Easing Engine", () => {
  it("returns default value when no keyframes exist", () => {
    const val = evaluateVisualPropertyKeyframes([], 2.0, 100);
    expect(val).toBe(100);
  });

  it("interpolates linearly between keyframes", () => {
    const keyframes: VisualPropertyKeyframe[] = [
      { id: "kf-1", time: 1.0, value: 0, easing: "linear" },
      { id: "kf-2", time: 3.0, value: 180, easing: "linear" },
    ];

    expect(evaluateVisualPropertyKeyframes(keyframes, 1.0, 0)).toBe(0);
    expect(evaluateVisualPropertyKeyframes(keyframes, 2.0, 0)).toBe(90);
    expect(evaluateVisualPropertyKeyframes(keyframes, 3.0, 0)).toBe(180);
  });

  it("applies cubic bezier easing curves to keyframe progress", () => {
    const keyframes: VisualPropertyKeyframe[] = [
      { id: "kf-1", time: 0.0, value: 0, easing: "easeInOut" },
      { id: "kf-2", time: 2.0, value: 100, easing: "easeInOut" },
    ];

    const midVal = evaluateVisualPropertyKeyframes(keyframes, 1.0, 0);
    // At t=0.5 normalized progress, easeInOut stays smooth at ~50
    expect(midVal).toBeGreaterThan(45);
    expect(midVal).toBeLessThan(55);
  });

  it("clamps values outside keyframe time range", () => {
    const keyframes: VisualPropertyKeyframe[] = [
      { id: "kf-1", time: 1.0, value: 10, easing: "linear" },
      { id: "kf-2", time: 5.0, value: 50, easing: "linear" },
    ];

    expect(evaluateVisualPropertyKeyframes(keyframes, 0.5, 0)).toBe(10);
    expect(evaluateVisualPropertyKeyframes(keyframes, 6.0, 0)).toBe(50);
  });

  it("preserves keyframed position and dimension when clip has spatial conform", () => {
    const project: any = {
      id: "proj-1",
      canvasWidth: 1920,
      canvasHeight: 1080,
      fps: 30,
    };
    const track: any = {
      id: "track-1",
      type: "video",
      muted: false,
      visible: true,
      locked: false,
    };
    const clip: any = {
      id: "clip-conformed-kf",
      kind: "video",
      trackId: "track-1",
      mediaId: "asset-1",
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
      conform: {
        mode: "fit",
        sourceWidth: 1080,
        sourceHeight: 1920, // 9:16 vertical video
        userScale: 1,
        userOffsetX: 0,
        userOffsetY: 0,
      },
      keyframes: {
        x: {
          defaultValue: 0,
          keyframes: [
            { time: 0.0, value: 100, easing: "linear" },
            { time: 2.0, value: 300, easing: "linear" },
          ],
        },
        width: {
          defaultValue: 500,
          keyframes: [
            { time: 0.0, value: 500, easing: "linear" },
            { time: 2.0, value: 800, easing: "linear" },
          ],
        },
      },
    };

    const asset: any = {
      id: "asset-1",
      type: "video",
      name: "Video",
      path: "http://localhost/video.mp4",
      duration: 10,
      width: 1080,
      height: 1920,
      size: 1000,
    };

    const scene = evaluateTimelineScene(1.0, [clip], [track], [asset], project);
    expect(scene.visualLayers.length).toBe(1);
    const layer = scene.visualLayers[0];

    // At t=1.0, keyframed x is interpolated between 100 and 300 -> 200
    expect(layer.x).toBe(200);
    // At t=1.0, keyframed width is interpolated between 500 and 800 -> 650
    expect(layer.width).toBe(650);
    // Un-keyframed height and y are derived from conform
    expect(layer.height).toBe(1080);
    expect(layer.y).toBe(0);
  });
});

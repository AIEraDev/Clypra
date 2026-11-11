import { describe, expect, it } from "vitest";
import { applyLoopMotion, compileClipMotionKeyframes } from "../motionPresets";
import type { RemoteTextAnimationPreset } from "@/features/text-animations/animationCatalog";

const presets: RemoteTextAnimationPreset[] = [
  {
    id: "api-in-slide", name: "API Slide", phase: "in", category: "in", subCategory: "Motion",
    tags: ["slide"], description: "From the API", defaultDuration: 0.5, icon: "ArrowUp",
    minDuration: 0.1, maxDuration: 3, previewLoopDuration: 1.2,
    tracks: [
      { property: "opacity", keyframes: [{ progress: 0, value: 0 }, { progress: 1, value: 1, easing: "easeOut" }] },
      { property: "translateY", keyframes: [{ progress: 0, value: 60 }, { progress: 1, value: 0, easing: "easeOutCubic" }] },
    ],
  },
  {
    id: "api-out-fade", name: "API Fade", phase: "out", category: "out", subCategory: "Basic",
    tags: ["fade"], description: "From the API", defaultDuration: 0.5, icon: "Sun",
    minDuration: 0.1, maxDuration: 3, previewLoopDuration: 1.2,
    tracks: [{ property: "opacity", keyframes: [{ progress: 0, value: 1 }, { progress: 1, value: 0, easing: "easeIn" }] }],
  },
];

describe("API-backed motion preset compiler", () => {
  const clip = { x: 100, y: 200, width: 400, height: 300, rotation: 0, opacity: 1 };

  it("compiles a supplied API entrance definition without local preset data", () => {
    const keyframes = compileClipMotionKeyframes(clip, { inPreset: "api-in-slide", inDuration: 0.4 }, 1920, 1080, presets);
    expect(keyframes.opacity?.map((keyframe) => keyframe.value)).toEqual([0, 1]);
    expect(keyframes.y?.map((keyframe) => keyframe.value)).toEqual([260, 200]);
    expect(keyframes.y?.every((keyframe) => keyframe.anchor === "start")).toBe(true);
    expect(keyframes.y?.[1].time).toBe(0.4);
  });

  it("compiles an API exit definition against the clip end", () => {
    const keyframes = compileClipMotionKeyframes(clip, { outPreset: "api-out-fade", outDuration: 0.6 }, 1920, 1080, presets);
    expect(keyframes.opacity?.map((keyframe) => keyframe.value)).toEqual([1, 0]);
    expect(keyframes.opacity?.map((keyframe) => keyframe.time)).toEqual([0.6, 0]);
    expect(keyframes.opacity?.every((keyframe) => keyframe.anchor === "end")).toBe(true);
  });

  it("does not invent a local fallback when an API preset is absent", () => {
    expect(compileClipMotionKeyframes(clip, { inPreset: "not-in-catalog" }, 1920, 1080, presets)).toEqual({});
  });

  it("leaves transforms unchanged when a loop preset is absent from the cache", () => {
    expect(applyLoopMotion("not-in-catalog", 1, clip)).toEqual(clip);
  });

  it("recovers from degenerate manifest progress where keyframes collapsed to progress: 0", () => {
    const degeneratePreset: RemoteTextAnimationPreset = {
      id: "api-in-slide-flat",
      name: "API Slide Flat",
      phase: "in",
      category: "in",
      subCategory: "Motion",
      tags: ["slide"],
      description: "From the API with degenerate progress",
      defaultDuration: 0.5,
      icon: "ArrowUp",
      minDuration: 0.1,
      maxDuration: 3,
      previewLoopDuration: 1.2,
      tracks: [
        {
          property: "translateX",
          keyframes: [
            { progress: 0, value: -1815, easing: "easeOut" },
            { progress: 0, value: 0, easing: "linear" },
          ],
        },
      ],
    };

    const keyframes = compileClipMotionKeyframes(
      clip,
      { inPreset: "api-in-slide-flat", inDuration: 0.5 },
      1920,
      1080,
      [degeneratePreset],
    );

    expect(keyframes.x).toHaveLength(2);
    expect(keyframes.x?.[0].time).toBe(0);
    expect(keyframes.x?.[1].time).toBe(0.5);
    expect(keyframes.x?.[0].value).toBe(100 - 1815);
    expect(keyframes.x?.[1].value).toBe(100);
  });

  it("compiles scale property to both width and height keyframes for uniform scaling", () => {
    const scalePreset: RemoteTextAnimationPreset = {
      id: "api-in-zoom",
      name: "API Zoom In",
      phase: "in",
      category: "in",
      subCategory: "Motion",
      tags: ["zoom", "scale"],
      description: "API fixture",
      defaultDuration: 0.5,
      icon: "ZoomIn",
      minDuration: 0.1,
      maxDuration: 3,
      previewLoopDuration: 1.2,
      tracks: [
        {
          property: "scale",
          keyframes: [
            { progress: 0, value: 0 },
            { progress: 1, value: 1, easing: "easeOut" },
          ],
        },
      ],
    };

    const keyframes = compileClipMotionKeyframes(
      clip,
      { inPreset: "api-in-zoom", inDuration: 0.5 },
      1920,
      1080,
      [scalePreset],
    );

    expect(keyframes.width).toBeDefined();
    expect(keyframes.height).toBeDefined();
    expect(keyframes.width?.map((k) => k.value)).toEqual([0, 400]);
    expect(keyframes.height?.map((k) => k.value)).toEqual([0, 300]);
    expect(keyframes.width?.map((k) => k.time)).toEqual([0, 0.5]);
    expect(keyframes.height?.map((k) => k.time)).toEqual([0, 0.5]);
  });
});

import { describe, it, expect } from "vitest";
import { resolveRenderStack, evaluateClipAtTime, evaluateClip, getClipsInRange, hasContentAtTime } from "../resolver";
import { validateTimeline, validateForExport } from "../validator";
import type { CompositorClip } from "../types";

describe("WebGL Compositor & Validator", () => {
  const clips: CompositorClip[] = [
    {
      id: "clip-bg",
      trackId: "track-1",
      mediaId: "media-bg",
      startTime: 0,
      duration: 10,
      trimIn: 0,
      trimOut: 10,
      role: "background",
      opacity: 1,
      x: 0, y: 0, width: 1920, height: 1080, rotation: 0,
      trackIndex: 1, zIndex: 0, evaluationPriority: 0,
    } as unknown as CompositorClip,
    {
      id: "clip-primary",
      trackId: "track-2",
      mediaId: "media-primary",
      startTime: 1,
      duration: 5,
      trimIn: 0,
      trimOut: 5,
      role: "primary",
      opacity: 0.8,
      x: 0, y: 0, width: 1920, height: 1080, rotation: 0,
      trackIndex: 0, zIndex: 0, evaluationPriority: 0,
    } as unknown as CompositorClip,
    {
      id: "clip-text",
      trackId: "track-3",
      mediaId: "",
      startTime: 2,
      duration: 3,
      trimIn: 0,
      trimOut: 3,
      role: "text",
      opacity: 1,
      x: 10, y: 20, width: 500, height: 100, rotation: 0,
      trackIndex: 2, zIndex: 5, evaluationPriority: 0,
    } as unknown as CompositorClip,
  ];

  describe("Compositor Resolver", () => {
    it("should return hasContent: false if no active clips at specified time", () => {
      const stack = resolveRenderStack(12.0, clips);
      expect(stack.hasContent).toBe(false);
      expect(stack.layers.length).toBe(0);
    });

    it("should resolve render stack in correct composite sorting order (z-order priority)", () => {
      // At time 3.0: background (0-10), primary (1-6), text (2-5) are all active.
      const stack = resolveRenderStack(3.0, clips);
      expect(stack.hasContent).toBe(true);
      expect(stack.layers.length).toBe(3);

      // Background is structural. Ordinary visual roles follow track order.
      expect(stack.layers[0].clip.id).toBe("clip-bg");       // background
      expect(stack.layers[1].clip.id).toBe("clip-text");     // lower editor track
      expect(stack.layers[2].clip.id).toBe("clip-primary");  // top editor track
    });

    it("should sort track indices correctly as tie breakers (top tracks render on top)", () => {
      const sameRoleClips: CompositorClip[] = [
        {
          ...clips[0],
          id: "clip-track-1",
          role: "primary",
          trackIndex: 1, // Rendered below
        },
        {
          ...clips[0],
          id: "clip-track-0",
          role: "primary",
          trackIndex: 0, // Rendered above (lower index in UI is on top)
        },
      ];

      const stack = resolveRenderStack(3.0, sameRoleClips);
      expect(stack.layers[0].clip.id).toBe("clip-track-1");
      expect(stack.layers[1].clip.id).toBe("clip-track-0");
    });

    it("should evaluate clip localTime and basic transforms correctly", () => {
      const clip = clips[1]; // starts at 1, duration 5
      const layerState = evaluateClipAtTime(clip, 3.5);
      
      expect(layerState.localTime).toBe(2.5); // 3.5 - 1.0
      expect(layerState.opacity).toBe(0.8);
      expect(layerState.transform.width).toBe(1920);
    });

    it("should resolve clips in range correctly", () => {
      const rangeClips = getClipsInRange(1.5, 3.5, clips);
      // clip-bg (0-10), clip-primary (1-6), clip-text (2-5) all overlap [1.5, 3.5]
      expect(rangeClips.length).toBe(3);
    });
  });

  describe("Timeline Validator", () => {
    it("should detect gaps and renderable ranges on empty and populated timelines", () => {
      const emptyVal = validateTimeline([]);
      expect(emptyVal.warnings).toContain("Timeline is empty");
      expect(emptyVal.totalDuration).toBe(0);

      const val = validateTimeline(clips, 0.5);
      expect(val.totalDuration).toBe(10);
      expect(val.renderableRanges.length).toBe(1);
      expect(val.renderableRanges[0]).toEqual({ start: 0, end: 9.5 });
      expect(val.gapRanges.length).toBe(1);
      expect(val.gapRanges[0]).toEqual({ start: 10, end: 10 });
    });

    it("should raise warnings for very short clips and invalid trims", () => {
      const invalidClips: CompositorClip[] = [
        {
          ...clips[0],
          id: "short-clip",
          startTime: 0,
          duration: 0.05, // very short (<0.1s)
        },
        {
          ...clips[1],
          id: "invalid-trim",
          trimIn: 5,
          trimOut: 2, // trimIn >= trimOut
        }
      ];

      const val = validateTimeline(invalidClips);
      expect(val.warnings.some((w) => w.includes("very short"))).toBe(true);
      expect(val.warnings.some((w) => w.includes("invalid trim ranges"))).toBe(true);
    });

    it("should validate timeline readiness for export", () => {
      const validResult = validateForExport(clips);
      expect(validResult.isValid).toBe(true);

      const emptyResult = validateForExport([]);
      expect(emptyResult.isValid).toBe(false);
      expect(emptyResult.reasons).toContain("Timeline is empty");
    });
  });
});

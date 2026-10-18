/**
 * Text Animation & Visual Keyframe Parity Tests
 *
 * Verifies that TextClip animation powered by the unified visual keyframe
 * engine, motion presets compiler, and pure scene evaluator works end-to-end
 * before UI inspector integration.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { evaluateTimelineScene } from "../evaluator";
import { compileClipMotionKeyframes } from "@/core/animation/motionPresets";
import { toRustClip, fromRustClip } from "@/types/serialization";
import type { TextClip, Track, Project, VisualPropertyKeyframe } from "@/types";
import { useEffectsStore } from "@/features/text-effects/store/effectsStore";
import type { RemoteTextAnimationPreset } from "@/features/text-animations/animationCatalog";

const animationCatalog: RemoteTextAnimationPreset[] = [
  {
    id: "slide-up", name: "Slide Up", phase: "in", category: "in", subCategory: "Motion", tags: ["slide"], description: "API fixture", defaultDuration: 0.5, icon: "ArrowUp", minDuration: 0.1, maxDuration: 3, previewLoopDuration: 1.2,
    tracks: [
      { property: "translateY", keyframes: [{ progress: 0, value: 150 }, { progress: 1, value: 0, easing: "easeOutCubic" }] },
      { property: "opacity", keyframes: [{ progress: 0, value: 0 }, { progress: 1, value: 1, easing: "easeOut" }] },
    ],
  },
  {
    id: "fade-out", name: "Fade Out", phase: "out", category: "out", subCategory: "Basic", tags: ["fade"], description: "API fixture", defaultDuration: 0.5, icon: "Sun", minDuration: 0.1, maxDuration: 3, previewLoopDuration: 1.2,
    tracks: [{ property: "opacity", keyframes: [{ progress: 0, value: 1 }, { progress: 1, value: 0, easing: "easeIn" }] }],
  },
];

// Mock Tauri API
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
  invoke: vi.fn(),
}));

describe("Text Animation & Visual Keyframe Parity", () => {
  const project: Project = {
    id: "test-project",
    name: "Test Project",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    aspectRatio: "16:9",
    canvasWidth: 1920,
    canvasHeight: 1080,
    frameRate: 30,
    duration: 10,
  };

  const tracks: Track[] = [
    {
      id: "track-text-1",
      type: "text",
      name: "Text Track",
      muted: false,
      locked: false,
      visible: true,
      height: 56,
    },
  ];

  beforeEach(() => {
    useEffectsStore.setState({ definitions: {} });
  });

  const createBaseTextClip = (overrides: Partial<TextClip> = {}): TextClip => ({
    id: "text-clip-test-1",
    kind: "text",
    trackId: "track-text-1",
    mediaId: "",
    startTime: 1.0,
    duration: 4.0, // 1.0s to 5.0s on timeline
    trimIn: 0,
    trimOut: 4.0,
    x: 960,
    y: 540,
    width: 600,
    height: 120,
    opacity: 1.0,
    rotation: 0,
    text: "Animated Title",
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
    ...overrides,
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Text keyframe evaluation
  // ──────────────────────────────────────────────────────────────────────────
  describe("1. Text Keyframe Evaluation", () => {
    it("evaluates keyframed position X/Y, width, height, rotation, and opacity at exact and intermediate times", () => {
      // Keyframes defined relative to clip local time (0s to 4s)
      const xKeyframes: VisualPropertyKeyframe[] = [
        { id: "x-0", time: 0.0, value: 100, easing: "linear" },
        { id: "x-1", time: 2.0, value: 500, easing: "linear" },
      ];
      const yKeyframes: VisualPropertyKeyframe[] = [
        { id: "y-0", time: 0.0, value: 200, easing: "linear" },
        { id: "y-1", time: 2.0, value: 400, easing: "linear" },
      ];
      const widthKeyframes: VisualPropertyKeyframe[] = [
        { id: "w-0", time: 0.0, value: 300, easing: "linear" },
        { id: "w-1", time: 2.0, value: 600, easing: "linear" },
      ];
      const heightKeyframes: VisualPropertyKeyframe[] = [
        { id: "h-0", time: 0.0, value: 60, easing: "linear" },
        { id: "h-1", time: 2.0, value: 120, easing: "linear" },
      ];
      const rotationKeyframes: VisualPropertyKeyframe[] = [
        { id: "r-0", time: 0.0, value: 0, easing: "linear" },
        { id: "r-1", time: 2.0, value: 90, easing: "linear" },
      ];
      const opacityKeyframes: VisualPropertyKeyframe[] = [
        { id: "o-0", time: 0.0, value: 0.0, easing: "linear" },
        { id: "o-1", time: 2.0, value: 1.0, easing: "linear" },
      ];

      const clip = createBaseTextClip({
        visualKeyframes: {
          x: xKeyframes,
          y: yKeyframes,
          width: widthKeyframes,
          height: heightKeyframes,
          rotation: rotationKeyframes,
          opacity: opacityKeyframes,
        },
      });

      // At timeline t = 1.0 (local offset = 0.0s) -> exact start keyframe
      const sceneAtStart = evaluateTimelineScene(1.0, [clip], tracks, [], project);
      expect(sceneAtStart.visualLayers).toHaveLength(1);
      const layerAtStart = sceneAtStart.visualLayers[0];
      expect(layerAtStart.layerType).toBe("text");
      if (layerAtStart.layerType === "text") {
        expect(layerAtStart.x).toBe(100);
        expect(layerAtStart.y).toBe(200);
        expect(layerAtStart.width).toBe(300);
        expect(layerAtStart.height).toBe(60);
        expect(layerAtStart.rotation).toBe(0);
        expect(layerAtStart.opacity).toBe(0.0);
      }

      // At timeline t = 2.0 (local offset = 1.0s, exactly 50% between 0s and 2s)
      const sceneAtMid = evaluateTimelineScene(2.0, [clip], tracks, [], project);
      const layerAtMid = sceneAtMid.visualLayers[0];
      if (layerAtMid.layerType === "text") {
        expect(layerAtMid.x).toBeCloseTo(300, 3);
        expect(layerAtMid.y).toBeCloseTo(300, 3);
        expect(layerAtMid.width).toBeCloseTo(450, 3);
        expect(layerAtMid.height).toBeCloseTo(90, 3);
        expect(layerAtMid.rotation).toBeCloseTo(45, 3);
        expect(layerAtMid.opacity).toBeCloseTo(0.5, 3);
      }

      // At timeline t = 3.0 (local offset = 2.0s) -> exact end keyframe
      const sceneAtEnd = evaluateTimelineScene(3.0, [clip], tracks, [], project);
      const layerAtEnd = sceneAtEnd.visualLayers[0];
      if (layerAtEnd.layerType === "text") {
        expect(layerAtEnd.x).toBe(500);
        expect(layerAtEnd.y).toBe(400);
        expect(layerAtEnd.width).toBe(600);
        expect(layerAtEnd.height).toBe(120);
        expect(layerAtEnd.rotation).toBe(90);
        expect(layerAtEnd.opacity).toBe(1.0);
      }

      // Boundary condition: At timeline t = 4.0 (local offset = 3.0s, after final keyframe at 2s)
      // Should hold the final keyframe value until clip ends at t = 5.0
      const sceneAfterKfs = evaluateTimelineScene(4.0, [clip], tracks, [], project);
      const layerAfterKfs = sceneAfterKfs.visualLayers[0];
      if (layerAfterKfs.layerType === "text") {
        expect(layerAfterKfs.x).toBe(500);
        expect(layerAfterKfs.y).toBe(400);
        expect(layerAfterKfs.opacity).toBe(1.0);
      }

      // Outside clip time boundaries:
      const sceneBeforeClip = evaluateTimelineScene(0.5, [clip], tracks, [], project);
      expect(sceneBeforeClip.visualLayers).toHaveLength(0);

      const sceneAfterClip = evaluateTimelineScene(5.5, [clip], tracks, [], project);
      expect(sceneAfterClip.visualLayers).toHaveLength(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Preset compilation and evaluation
  // ──────────────────────────────────────────────────────────────────────────
  describe("2. Preset Compilation and Evaluation", () => {
    it("compiles 'slide-up' preset into visualKeyframes and correctly evaluates text layer properties", () => {
      const baseClip = createBaseTextClip({
        x: 960,
        y: 540,
        opacity: 1.0,
      });

      const inDuration = 0.5;
      const inDistance = 150;

      const compiledKeyframes = compileClipMotionKeyframes(
        baseClip,
        {
          inPreset: "slide-up",
          inDuration,
          inDistance,
          inEasing: "easeOutCubic",
        },
        1920,
        1080,
        animationCatalog,
      );

      // Verify compiler generates editable keyframes
      expect(compiledKeyframes.y).toBeDefined();
      expect(compiledKeyframes.opacity).toBeDefined();
      expect(compiledKeyframes.y).toHaveLength(2);
      expect(compiledKeyframes.opacity).toHaveLength(2);

      // Verify initial and resting keyframe contract
      const y0 = compiledKeyframes.y![0];
      const y1 = compiledKeyframes.y![1];
      expect(y0.time).toBe(0);
      expect(y0.value).toBe(540 + 150); // baseY + inDistance
      expect(y0.anchor).toBe("start");
      expect(y1.time).toBe(inDuration);
      expect(y1.value).toBe(540); // settles at baseY
      expect(y1.anchor).toBe("start");

      const op0 = compiledKeyframes.opacity![0];
      const op1 = compiledKeyframes.opacity![1];
      expect(op0.value).toBe(0);
      expect(op1.value).toBe(1.0);

      const clipWithPreset: TextClip = {
        ...baseClip,
        motion: {
          inPreset: "slide-up",
          inDuration,
          inDistance,
          inEasing: "easeOutCubic",
        },
        visualKeyframes: compiledKeyframes,
      };

      // Scene evaluation at t = clip.startTime (offset 0.0s)
      const sceneAtStart = evaluateTimelineScene(clipWithPreset.startTime, [clipWithPreset], tracks, [], project);
      const layerStart = sceneAtStart.visualLayers[0];
      if (layerStart.layerType === "text") {
        expect(layerStart.y).toBe(690);
        expect(layerStart.opacity).toBe(0);
      }

      // Scene evaluation at t = clip.startTime + 0.25s (mid-flight)
      const sceneAtMid = evaluateTimelineScene(clipWithPreset.startTime + 0.25, [clipWithPreset], tracks, [], project);
      const layerMid = sceneAtMid.visualLayers[0];
      if (layerMid.layerType === "text") {
        // easeOutCubic at t=0.5 of duration:
        // expected Y is smoothly transitioning between 690 and 540
        expect(layerMid.y).toBeLessThan(690);
        expect(layerMid.y).toBeGreaterThan(540);
        expect(layerMid.y).toBeCloseTo(559.17, 1);
        expect(layerMid.opacity).toBeGreaterThan(0);
        expect(layerMid.opacity).toBeLessThanOrEqual(1.0);
      }

      // Scene evaluation after preset completes (t >= clip.startTime + inDuration)
      const sceneAtRest = evaluateTimelineScene(clipWithPreset.startTime + 0.6, [clipWithPreset], tracks, [], project);
      const layerRest = sceneAtRest.visualLayers[0];
      if (layerRest.layerType === "text") {
        expect(layerRest.y).toBe(540);
        expect(layerRest.opacity).toBe(1.0);
      }
    });

    it("resolves start- and end-anchored keyframes correctly when clip duration is changed", () => {
      const baseClip = createBaseTextClip({ y: 500, opacity: 1.0 });

      // Compile preset with both In (Slide Up) and Out (Fade Out)
      const compiledKeyframes = compileClipMotionKeyframes(
        baseClip,
        {
          inPreset: "slide-up",
          inDuration: 0.5,
          inDistance: 100,
          outPreset: "fade-out",
          outDuration: 0.5,
        },
        1920,
        1080,
        animationCatalog,
      );

      // Test with Duration = 4.0s (starts at 1.0s, ends at 5.0s)
      const clip4s: TextClip = {
        ...baseClip,
        duration: 4.0,
        trimOut: 4.0,
        visualKeyframes: compiledKeyframes,
      };

      // End transition should run from local 3.5s to 4.0s (timeline 4.5s to 5.0s)
      const sceneAtRest4s = evaluateTimelineScene(4.0, [clip4s], tracks, [], project); // local 3.0s -> resting
      expect(sceneAtRest4s.visualLayers[0].opacity).toBe(1.0);

      const sceneExiting4s = evaluateTimelineScene(4.75, [clip4s], tracks, [], project); // local 3.75s -> mid exit
      expect(sceneExiting4s.visualLayers[0].opacity).toBeLessThan(1.0);
      expect(sceneExiting4s.visualLayers[0].opacity).toBeGreaterThan(0.0);

      // Now change clip duration to 8.0s (starts at 1.0s, ends at 9.0s)
      const clip8s: TextClip = {
        ...baseClip,
        duration: 8.0,
        trimOut: 8.0,
        visualKeyframes: compiledKeyframes,
      };

      // At timeline 4.75s (local 3.75s), clip8s should still be fully RESTING (opacity 1.0), NOT fading out!
      const sceneResting8s = evaluateTimelineScene(4.75, [clip8s], tracks, [], project);
      expect(sceneResting8s.visualLayers[0].opacity).toBe(1.0);

      // For clip8s, the exit fade should now occur at timeline 8.5s to 9.0s (local 7.5s to 8.0s)
      const sceneExiting8s = evaluateTimelineScene(8.75, [clip8s], tracks, [], project); // local 7.75s -> mid exit
      expect(sceneExiting8s.visualLayers[0].opacity).toBeLessThan(1.0);
      expect(sceneExiting8s.visualLayers[0].opacity).toBeGreaterThan(0.0);
    });

    it("evaluates deterministically across repeated seeks and evaluations at the exact same timestamp", () => {
      const baseClip = createBaseTextClip({
        visualKeyframes: {
          x: [
            { id: "x0", time: 0, value: 200, easing: "easeInOutCubic" },
            { id: "x1", time: 2, value: 800, easing: "easeInOutCubic" },
          ],
        },
      });

      const sampleTime = 2.37;
      const eval1 = evaluateTimelineScene(sampleTime, [baseClip], tracks, [], project);
      const eval2 = evaluateTimelineScene(sampleTime, [baseClip], tracks, [], project);
      const eval3 = evaluateTimelineScene(sampleTime, [baseClip], tracks, [], project);

      const x1 = eval1.visualLayers[0].x;
      const x2 = eval2.visualLayers[0].x;
      const x3 = eval3.visualLayers[0].x;

      expect(x1).toBe(x2);
      expect(x2).toBe(x3);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Serialization round-trip
  // ──────────────────────────────────────────────────────────────────────────
  describe("3. Serialization Round-Trip", () => {
    it("preserves visualKeyframes, motion configuration, anchors, control points, and spring parameters", () => {
      const originalClip = createBaseTextClip({
        motion: {
          inPreset: "pop-in",
          inDuration: 0.6,
          inEasing: "springSnappy",
          inSpring: { stiffness: 180, damping: 12, mass: 1 },
          outPreset: "fade-out",
          outDuration: 0.4,
          outEasing: "easeIn",
          loopPreset: "pulse",
          loopSpeed: 1.2,
          loopIntensity: 0.8,
        },
        visualKeyframes: {
          x: [
            {
              id: "x-0",
              time: 0,
              value: 100,
              easing: "cubic-bezier",
              controlPoints: [0.25, 0.1, 0.25, 1.0],
              anchor: "start",
            },
            {
              id: "x-1",
              time: 1.5,
              value: 700,
              easing: "linear",
              anchor: "start",
            },
          ],
          y: [
            {
              id: "y-0",
              time: 0.4,
              value: 300,
              easing: "spring",
              spring: { stiffness: 200, damping: 15, mass: 1.2 },
              anchor: "end",
            },
          ],
          rotation: [
            { id: "r-0", time: 0, value: 0, easing: "easeInOut", anchor: "start" },
            { id: "r-1", time: 1.0, value: 180, easing: "easeInOut", anchor: "start" },
          ],
          opacity: [
            { id: "o-0", time: 0, value: 0, easing: "easeOut", anchor: "start" },
            { id: "o-1", time: 0.5, value: 1, easing: "easeOut", anchor: "start" },
          ],
        },
      });

      // Frontend -> Rust
      const rustClip = toRustClip(originalClip);

      // Rust -> Frontend
      const roundTrippedClip = fromRustClip(rustClip) as TextClip;

      // Assert clip metadata survived
      expect(roundTrippedClip.id).toBe(originalClip.id);
      expect(roundTrippedClip.kind).toBe("text");
      expect(roundTrippedClip.text).toBe(originalClip.text);

      // Assert deep equality of motion configuration
      expect(roundTrippedClip.motion).toEqual(originalClip.motion);

      // Assert deep equality of all visual keyframes
      expect(roundTrippedClip.visualKeyframes).toBeDefined();
      expect(roundTrippedClip.visualKeyframes?.x).toEqual(originalClip.visualKeyframes?.x);
      expect(roundTrippedClip.visualKeyframes?.y).toEqual(originalClip.visualKeyframes?.y);
      expect(roundTrippedClip.visualKeyframes?.rotation).toEqual(originalClip.visualKeyframes?.rotation);
      expect(roundTrippedClip.visualKeyframes?.opacity).toEqual(originalClip.visualKeyframes?.opacity);

      // Specifically check control points and spring parameters
      expect(roundTrippedClip.visualKeyframes?.x?.[0].controlPoints).toEqual([0.25, 0.1, 0.25, 1.0]);
      expect(roundTrippedClip.visualKeyframes?.y?.[0].spring).toEqual({ stiffness: 200, damping: 15, mass: 1.2 });
      expect(roundTrippedClip.visualKeyframes?.y?.[0].anchor).toBe("end");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. Actual scene-evaluation parity
  // ──────────────────────────────────────────────────────────────────────────
  describe("4. Actual Scene-Evaluation Parity", () => {
    it("propagates animated x, y, width, height, rotation, and opacity directly into EvaluatedTextLayer", () => {
      const clip = createBaseTextClip({
        x: 500,
        y: 300,
        width: 400,
        height: 100,
        rotation: 0,
        opacity: 1.0,
        visualKeyframes: {
          x: [
            { id: "kx0", time: 0.0, value: 500, easing: "linear" },
            { id: "kx1", time: 1.0, value: 800, easing: "linear" },
          ],
          y: [
            { id: "ky0", time: 0.0, value: 300, easing: "linear" },
            { id: "ky1", time: 1.0, value: 450, easing: "linear" },
          ],
          width: [
            { id: "kw0", time: 0.0, value: 400, easing: "linear" },
            { id: "kw1", time: 1.0, value: 600, easing: "linear" },
          ],
          height: [
            { id: "kh0", time: 0.0, value: 100, easing: "linear" },
            { id: "kh1", time: 1.0, value: 150, easing: "linear" },
          ],
          rotation: [
            { id: "kr0", time: 0.0, value: 0, easing: "linear" },
            { id: "kr1", time: 1.0, value: 45, easing: "linear" },
          ],
          opacity: [
            { id: "ko0", time: 0.0, value: 0.2, easing: "linear" },
            { id: "ko1", time: 1.0, value: 0.8, easing: "linear" },
          ],
        },
      });

      // Sample at t = 1.5 (local offset = 0.5s, 50% between keyframes)
      const scene = evaluateTimelineScene(1.5, [clip], tracks, [], project);
      expect(scene.visualLayers).toHaveLength(1);

      const layer = scene.visualLayers[0];
      expect(layer.layerType).toBe("text");
      if (layer.layerType === "text") {
        expect(layer.clipId).toBe(clip.id);
        expect(layer.text).toBe("Animated Title");
        expect(layer.x).toBeCloseTo(650, 3);
        expect(layer.y).toBeCloseTo(375, 3);
        expect(layer.width).toBeCloseTo(500, 3);
        expect(layer.height).toBeCloseTo(125, 3);
        expect(layer.rotation).toBeCloseTo(22.5, 3);
        expect(layer.opacity).toBeCloseTo(0.5, 3);
      }
    });

    it("ensures visualKeyframes operate without interference when legacy entrance/exit animations are absent", () => {
      const clip = createBaseTextClip({
        entranceAnimation: undefined,
        exitAnimation: undefined,
        visualKeyframes: {
          opacity: [
            { id: "o0", time: 0.0, value: 0.25, easing: "linear" },
            { id: "o1", time: 1.0, value: 0.75, easing: "linear" },
          ],
        },
      });

      const scene = evaluateTimelineScene(1.5, [clip], tracks, [], project); // local 0.5s -> exactly 0.50 opacity
      const layer = scene.visualLayers[0];
      if (layer.layerType === "text") {
        expect(layer.opacity).toBeCloseTo(0.5, 3);
      }
    });
  });
});

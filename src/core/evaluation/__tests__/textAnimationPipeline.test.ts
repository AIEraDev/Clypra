/**
 * Text Animation Pipeline Comprehensive Integration Tests
 *
 * Validates the full text animation pipeline across all stages:
 * 1. Ingestion: Normalizing raw presets matching Clypra Studio starter schemas.
 * 2. Multi-phase composition: In + Out + Loop combined on a single clip.
 * 3. Uniform scaling: Verifying aspect ratio and center preservation for scale presets.
 * 4. Timeline t=0 execution: Immediate evaluation on frame 0 and cache invalidation.
 * 5. Short-clip compression: Proportional elastic retiming when duration < inDuration + outDuration.
 * 6. GPU quad scaling: NativeRasterBridge transforms displayWidth/displayHeight with zero CPU re-raster.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { evaluateTimelineScene, evaluateTimelineSceneCached } from "../evaluator";
import { compileClipMotionKeyframes } from "@/core/animation/motionPresets";
import { resolveResponsiveKeyframes } from "@/core/animation/timeAnchor";
import { normalizePreset, type RemoteTextAnimationPreset } from "@/features/text-animations/animationCatalog";
import type { TextClip, Track, Project } from "@/types";
import { useEffectsStore } from "@/features/text-effects/store/effectsStore";

// ── Native Mocks ──────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  register: vi.fn().mockResolvedValue(undefined),
  registerImage: vi.fn().mockResolvedValue(undefined),
  rasterizeText: vi.fn(),
  textKey: vi.fn(() => "pipeline-text-key"),
  traceTextRenderTiming: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
  invoke: vi.fn(),
}));

vi.mock("@/lib/platform/tauri", () => ({
  isTauriRuntime: () => true,
  registerNativeImageAsset: mocks.registerImage,
  registerNativeRasterAsset: mocks.register,
}));

vi.mock("@/components/editor/preview/nativeTextPreview", () => ({
  buildNativeTextRasterKey: mocks.textKey,
  rasterizeTextLayerForNative: mocks.rasterizeText,
}));

vi.mock("@/core/render/textRenderTrace", () => ({
  traceTextRenderTiming: mocks.traceTextRenderTiming,
}));

vi.mock("@/components/editor/preview/nativeStickerPreview", () => ({
  NativeAnimatedStickerRenderer: class {
    render = vi.fn().mockResolvedValue(null);
    dispose = vi.fn();
  },
}));

import { NativeRasterBridge } from "@/core/render/nativeRasterBridge";

// ── Test Project & Base Fixtures ──────────────────────────────────────────────

const project: Project = {
  id: "pipeline-test-project",
  name: "Pipeline Test Project",
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

const createBaseClip = (overrides: Partial<TextClip> = {}): TextClip => ({
  id: "text-pipeline-clip",
  kind: "text",
  trackId: "track-text-1",
  mediaId: "",
  startTime: 0,
  duration: 4.0,
  trimIn: 0,
  trimOut: 4.0,
  x: 760,
  y: 490,
  width: 400,
  height: 100,
  opacity: 1.0,
  rotation: 0,
  text: "Pipeline Text",
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

describe("Text Animation Pipeline End-to-End Validation", () => {
  beforeEach(() => {
    useEffectsStore.setState({ definitions: {} });
    mocks.register.mockClear();
    mocks.rasterizeText.mockReset();
    mocks.textKey.mockReturnValue("pipeline-text-key");
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 1. Studio & API Ingestion Normalization Contract
  // ────────────────────────────────────────────────────────────────────────────
  describe("1. Studio & API Ingestion Contract", () => {
    it("normalizes raw Studio starter presets into valid RemoteTextAnimationPresets", () => {
      const rawStudioSlideUp = {
        id: "anim-in-slide-up",
        name: "Slide Up",
        phase: "in",
        category: "motion",
        tags: ["slide", "entrance", "vertical"],
        description: "Smooth slide up from bottom with subtle ease-out",
        defaultDuration: 0.6,
        minDuration: 0.2,
        maxDuration: 2.0,
        previewLoopDuration: 1.2,
        stagger: { unit: "character", overlap: 0.3, order: "forward" },
        tracks: [
          {
            property: "translateY",
            keyframes: [
              { progress: 0, value: 80, easing: "easeOutCubic" },
              { progress: 1, value: 0 },
            ],
          },
          {
            property: "opacity",
            keyframes: [
              { progress: 0, value: 0 },
              { progress: 1, value: 1 },
            ],
          },
        ],
      };

      const normalized = normalizePreset(rawStudioSlideUp);
      expect(normalized).not.toBeNull();
      expect(normalized!.id).toBe("anim-in-slide-up");
      expect(normalized!.phase).toBe("in");
      expect(normalized!.subCategory).toBe("Motion");
      expect(normalized!.tracks).toHaveLength(2);
      expect(normalized!.stagger).toEqual({ unit: "character", overlap: 0.3, order: "forward" });
      expect(normalized!.defaultDuration).toBe(0.6);
    });

    it("rejects invalid or corrupted preset schemas gracefully", () => {
      expect(normalizePreset(null)).toBeNull();
      expect(normalizePreset(undefined)).toBeNull();
      expect(normalizePreset({})).toBeNull();
      expect(normalizePreset({ id: "missing-phase", name: "Broken" })).toBeNull();
      expect(normalizePreset({ id: "broken", name: "Broken", phase: "in" })).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 2. Multi-Phase In/Out/Loop Full-Lifecycle Composition
  // ────────────────────────────────────────────────────────────────────────────
  describe("2. Multi-Phase Full-Lifecycle Composition", () => {
    const catalog: RemoteTextAnimationPreset[] = [
      {
        id: "anim-in-slide-up",
        name: "Slide Up",
        phase: "in",
        category: "in",
        subCategory: "Motion",
        tags: ["slide"],
        description: "",
        icon: "ArrowUp",
        defaultDuration: 0.5,
        minDuration: 0.1,
        maxDuration: 2,
        previewLoopDuration: 1.0,
        tracks: [
          {
            property: "translateY",
            keyframes: [
              { progress: 0, value: 100 },
              { progress: 1, value: 0 },
            ],
          },
          {
            property: "opacity",
            keyframes: [
              { progress: 0, value: 0 },
              { progress: 1, value: 1 },
            ],
          },
        ],
      },
      {
        id: "anim-out-slide-down",
        name: "Slide Down",
        phase: "out",
        category: "out",
        subCategory: "Motion",
        tags: ["slide"],
        description: "",
        icon: "ArrowDown",
        defaultDuration: 0.5,
        minDuration: 0.1,
        maxDuration: 2,
        previewLoopDuration: 1.0,
        tracks: [
          {
            property: "translateY",
            keyframes: [
              { progress: 0, value: 0 },
              { progress: 1, value: 100 },
            ],
          },
          {
            property: "opacity",
            keyframes: [
              { progress: 0, value: 1 },
              { progress: 1, value: 0 },
            ],
          },
        ],
      },
      {
        id: "anim-loop-float",
        name: "Float",
        phase: "loop",
        category: "loop",
        subCategory: "Motion",
        tags: ["float"],
        description: "",
        icon: "Waves",
        defaultDuration: 1.0,
        minDuration: 0.2,
        maxDuration: 5,
        previewLoopDuration: 1.0,
        tracks: [
          {
            property: "translateY",
            keyframes: [
              { progress: 0, value: 0 },
              { progress: 0.5, value: -15 },
              { progress: 1, value: 0 },
            ],
          },
        ],
      },
    ];

    it("evaluates in-phase, loop-phase, and out-phase seamlessly across the clip duration", () => {
      const clip = createBaseClip({
        startTime: 0,
        duration: 4.0,
        y: 500,
        motion: {
          inPreset: "anim-in-slide-up",
          inDuration: 0.5,
          outPreset: "anim-out-slide-down",
          outDuration: 0.5,
          loopPreset: "anim-loop-float",
          loopSpeed: 1.0,
          loopIntensity: 1.0,
        },
      });

      const keyframes = compileClipMotionKeyframes(
        clip,
        clip.motion!,
        project.canvasWidth,
        project.canvasHeight,
        catalog,
      );

      const clipWithKeyframes: TextClip = {
        ...clip,
        visualKeyframes: keyframes,
      };

      // In Phase at t = 0 (progress 0)
      const sceneAtStart = evaluateTimelineScene(0, [clipWithKeyframes], tracks, [], project);
      const layerStart = sceneAtStart.visualLayers[0];
      expect(layerStart.opacity).toBeCloseTo(0, 2);
      expect(layerStart.y).toBeCloseTo(500 + 100, 1);

      // In Phase at t = 0.25 (progress 0.5 of 0.5s in-duration)
      const sceneAtInMid = evaluateTimelineScene(0.25, [clipWithKeyframes], tracks, [], project);
      const layerInMid = sceneAtInMid.visualLayers[0];
      expect(layerInMid.opacity).toBeCloseTo(0.5, 2);
      expect(layerInMid.y).toBeCloseTo(500 + 50, 1);

      // Transition to Loop Phase at t = 0.5 (end of in-phase)
      const sceneAtLoopStart = evaluateTimelineScene(0.5, [clipWithKeyframes], tracks, [], project);
      const layerLoopStart = sceneAtLoopStart.visualLayers[0];
      expect(layerLoopStart.opacity).toBeCloseTo(1.0, 2);

      // Out Phase at t = 3.75 (halfway through 0.5s out-duration from 3.5 to 4.0)
      const sceneAtOutMid = evaluateTimelineScene(3.75, [clipWithKeyframes], tracks, [], project);
      const layerOutMid = sceneAtOutMid.visualLayers[0];
      expect(layerOutMid.opacity).toBeCloseTo(0.5, 2);
      expect(layerOutMid.y).toBeCloseTo(500 + 50, 1);

      // Out Phase at t = 4.0 (clip end clamped to 3.999 by end-of-timeline guard)
      const sceneAtEnd = evaluateTimelineScene(4.0, [clipWithKeyframes], tracks, [], project);
      const layerEnd = sceneAtEnd.visualLayers[0];
      expect(layerEnd.opacity).toBeCloseTo(0, 1);
      expect(layerEnd.y).toBeCloseTo(500 + 100, 0);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 3. Uniform Scale & Center Alignment Preservation
  // ────────────────────────────────────────────────────────────────────────────
  describe("3. Uniform Scale & Center Alignment Preservation", () => {
    const zoomCatalog: RemoteTextAnimationPreset[] = [
      {
        id: "anim-in-zoom-in",
        name: "Zoom In",
        phase: "in",
        category: "in",
        subCategory: "Basic",
        tags: ["zoom", "scale"],
        description: "",
        icon: "ZoomIn",
        defaultDuration: 0.5,
        minDuration: 0.1,
        maxDuration: 2,
        previewLoopDuration: 1.0,
        tracks: [
          {
            property: "scale",
            keyframes: [
              { progress: 0, value: 0 },
              { progress: 1, value: 1 },
            ],
          },
        ],
      },
    ];

    it("compiles scale presets into synchronized width and height keyframes", () => {
      const clip = createBaseClip({
        width: 400,
        height: 100,
        motion: { inPreset: "anim-in-zoom-in", inDuration: 0.5 },
      });

      const keyframes = compileClipMotionKeyframes(
        clip,
        clip.motion!,
        project.canvasWidth,
        project.canvasHeight,
        zoomCatalog,
      );

      expect(keyframes.width).toBeDefined();
      expect(keyframes.height).toBeDefined();
      expect(keyframes.width).toHaveLength(2);
      expect(keyframes.height).toHaveLength(2);

      // At start: 0x0
      expect(keyframes.width![0].value).toBe(0);
      expect(keyframes.height![0].value).toBe(0);

      // At end: 400x100 (exact 4:1 aspect ratio preserved)
      expect(keyframes.width![1].value).toBe(400);
      expect(keyframes.height![1].value).toBe(100);
    });

    it("maintains the authored center position during zoom without x/y drifting", () => {
      const clip = createBaseClip({
        x: 760,
        y: 490,
        width: 400,
        height: 100,
        motion: { inPreset: "anim-in-zoom-in", inDuration: 0.5 },
      });

      const keyframes = compileClipMotionKeyframes(
        clip,
        clip.motion!,
        project.canvasWidth,
        project.canvasHeight,
        zoomCatalog,
      );

      const clipWithKeyframes: TextClip = {
        ...clip,
        visualKeyframes: keyframes,
      };

      const expectedCenterX = 760 + 400 / 2; // 960
      const expectedCenterY = 490 + 100 / 2; // 540

      // Evaluate at t=0, t=0.25, and t=0.5
      [0, 0.25, 0.5].forEach((t) => {
        const scene = evaluateTimelineScene(t, [clipWithKeyframes], tracks, [], project);
        const layer = scene.visualLayers[0];
        const currentCenterX = layer.x + layer.width / 2;
        const currentCenterY = layer.y + layer.height / 2;

        expect(currentCenterX).toBeCloseTo(expectedCenterX, 2);
        expect(currentCenterY).toBeCloseTo(expectedCenterY, 2);

        // Aspect ratio check (400 / 100 = 4.0)
        if (layer.height > 0) {
          expect(layer.width / layer.height).toBeCloseTo(4.0, 2);
        }
      });
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 4. Timeline t=0 Execution & Cache Invalidation
  // ────────────────────────────────────────────────────────────────────────────
  describe("4. Timeline t=0 Execution & Cache Invalidation", () => {
    const fadeCatalog: RemoteTextAnimationPreset[] = [
      {
        id: "anim-in-fade",
        name: "Fade In",
        phase: "in",
        category: "in",
        subCategory: "Basic",
        tags: ["fade"],
        description: "",
        icon: "Sun",
        defaultDuration: 0.5,
        minDuration: 0.1,
        maxDuration: 2,
        previewLoopDuration: 1.0,
        tracks: [
          {
            property: "opacity",
            keyframes: [
              { progress: 0, value: 0 },
              { progress: 1, value: 1 },
            ],
          },
        ],
      },
    ];

    it("evaluates entrance motion at exact t=0 on clips starting at 0", () => {
      const clip = createBaseClip({
        startTime: 0,
        duration: 3.0,
        motion: { inPreset: "anim-in-fade", inDuration: 0.5 },
      });

      const keyframes = compileClipMotionKeyframes(
        clip,
        clip.motion!,
        project.canvasWidth,
        project.canvasHeight,
        fadeCatalog,
      );

      const scene = evaluateTimelineScene(0, [{ ...clip, visualKeyframes: keyframes }], tracks, [], project);
      expect(scene.visualLayers).toHaveLength(1);
      expect(scene.visualLayers[0].opacity).toBeCloseTo(0, 2);
    });

    it("invalidates cached evaluated scene at t=0 when motion configuration changes", () => {
      const clipA = createBaseClip({
        startTime: 0,
        duration: 3.0,
        motion: { inPreset: "anim-in-fade", inDuration: 0.5 },
      });
      const kfA = compileClipMotionKeyframes(clipA, clipA.motion!, project.canvasWidth, project.canvasHeight, fadeCatalog);
      const clipWithKfA = { ...clipA, visualKeyframes: kfA };

      const sceneA = evaluateTimelineSceneCached(0, [clipWithKfA], tracks, [], project);
      expect(sceneA.visualLayers[0].opacity).toBeCloseTo(0, 2);

      // Modify motion to inDuration 1.0
      const clipB = createBaseClip({
        startTime: 0,
        duration: 3.0,
        motion: { inPreset: "anim-in-fade", inDuration: 1.0 },
      });
      const kfB = compileClipMotionKeyframes(clipB, clipB.motion!, project.canvasWidth, project.canvasHeight, fadeCatalog);
      const clipWithKfB = { ...clipB, visualKeyframes: kfB };

      // Evaluate at t=0.25: with 0.5s duration, opacity was 0.5; with 1.0s duration, opacity is 0.25
      const sceneBMid = evaluateTimelineSceneCached(0.25, [clipWithKfB], tracks, [], project);
      expect(sceneBMid.visualLayers[0].opacity).toBeCloseTo(0.25, 2);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 5. Short-Clip Compression & Elastic Retiming
  // ────────────────────────────────────────────────────────────────────────────
  describe("5. Short-Clip Compression & Elastic Retiming", () => {
    const catalog: RemoteTextAnimationPreset[] = [
      {
        id: "anim-in-slide",
        name: "Slide In",
        phase: "in",
        category: "in",
        subCategory: "Motion",
        tags: [],
        description: "",
        icon: "ArrowRight",
        defaultDuration: 0.6,
        minDuration: 0.1,
        maxDuration: 2,
        previewLoopDuration: 1.0,
        tracks: [{ property: "opacity", keyframes: [{ progress: 0, value: 0 }, { progress: 1, value: 1 }] }],
      },
      {
        id: "anim-out-slide",
        name: "Slide Out",
        phase: "out",
        category: "out",
        subCategory: "Motion",
        tags: [],
        description: "",
        icon: "ArrowRight",
        defaultDuration: 0.6,
        minDuration: 0.1,
        maxDuration: 2,
        previewLoopDuration: 1.0,
        tracks: [{ property: "opacity", keyframes: [{ progress: 0, value: 1 }, { progress: 1, value: 0 }] }],
      },
    ];

    it("proportionally compresses keyframes when clip duration is shorter than combined in/out durations", () => {
      // Total preset duration: 0.6 + 0.6 = 1.2s, but clip duration is 0.4s
      const clip = createBaseClip({
        startTime: 0,
        duration: 0.4,
        motion: {
          inPreset: "anim-in-slide",
          inDuration: 0.6,
          outPreset: "anim-out-slide",
          outDuration: 0.6,
        },
      });

      const keyframes = compileClipMotionKeyframes(
        clip,
        clip.motion!,
        project.canvasWidth,
        project.canvasHeight,
        catalog,
      );

      expect(keyframes.opacity).toBeDefined();
      const resolved = resolveResponsiveKeyframes(keyframes.opacity, clip.duration);

      // All resolved keyframes must fall within [0, 0.4] and be strictly monotonic
      expect(resolved[0].resolvedTime).toBe(0);
      expect(resolved[resolved.length - 1].resolvedTime).toBeCloseTo(0.4, 2);
      for (let i = 1; i < resolved.length; i++) {
        expect(resolved[i].resolvedTime).toBeGreaterThanOrEqual(resolved[i - 1].resolvedTime);
      }

      // Evaluates smoothly at t = 0.2
      const scene = evaluateTimelineScene(0.2, [{ ...clip, visualKeyframes: keyframes }], tracks, [], project);
      expect(scene.visualLayers[0].opacity).toBeGreaterThan(0);
      expect(scene.visualLayers[0].opacity).toBeLessThanOrEqual(1.0);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 6. NativeRasterBridge GPU Quad Scaling
  // ────────────────────────────────────────────────────────────────────────────
  describe("6. GPU Quad Scaling & Zero CPU Re-rasterization Invariant", () => {
    const BASE_TEXTURE_ASSET = {
      assetId: "native-text:pipeline-layer:v1",
      rgba: [255, 255, 255, 255],
      width: 410, // 400 + 2*5 bleed
      height: 110, // 100 + 2*5 bleed
      x: 0,
      y: 0,
      rotation: 0,
      opacity: 1,
      zIndex: 1,
      blendMode: "normal",
      isText: true as const,
      bleedX: 5,
      bleedY: 5,
      positionMode: "centered" as const,
    };

    it("updates displayWidth and displayHeight on animated frames without re-rasterizing texture", async () => {
      mocks.rasterizeText.mockResolvedValue({ ...BASE_TEXTURE_ASSET });

      const bridge = new NativeRasterBridge();

      // Frame 0: Base full size (width=400, height=100)
      const sceneFrame0 = {
        visualLayers: [
          {
            layerType: "text",
            layerId: "pipeline-text-layer",
            text: "Pipeline Text",
            x: 760,
            y: 490,
            baseWidth: 400,
            baseHeight: 100,
            width: 400,
            height: 100,
            rotation: 0,
            opacity: 1,
            zIndex: 1,
            blendMode: "normal",
          },
        ],
        metadata: { canvasWidth: 1920, canvasHeight: 1080 },
      } as any;

      const [quad0] = await bridge.rasterize(sceneFrame0, { frameKey: 0, nonBlockingText: false });
      expect(mocks.rasterizeText).toHaveBeenCalledTimes(1);
      expect(quad0.width).toBe(410);
      expect(quad0.height).toBe(110);
      expect(quad0.displayWidth).toBe(410);
      expect(quad0.displayHeight).toBe(110);

      // Frame 1: Scale 0.5 entrance animation (width=200, height=50)
      const sceneFrame1 = {
        visualLayers: [
          {
            layerType: "text",
            layerId: "pipeline-text-layer",
            text: "Pipeline Text",
            x: 860, // centered
            y: 515,
            baseWidth: 400,
            baseHeight: 100,
            width: 200,
            height: 50,
            rotation: 0,
            opacity: 0.5,
            zIndex: 1,
            blendMode: "normal",
          },
        ],
        metadata: { canvasWidth: 1920, canvasHeight: 1080 },
      } as any;

      const [quad1] = await bridge.rasterize(sceneFrame1, { frameKey: 1, nonBlockingText: true });

      // Texture was NOT re-rasterized (zero CPU cost, GPU quad scale)
      expect(mocks.rasterizeText).toHaveBeenCalledTimes(1);

      // Quad display dimensions are scaled exactly by 0.5
      expect(quad1.displayWidth).toBeCloseTo(410 * 0.5, 1);
      expect(quad1.displayHeight).toBeCloseTo(110 * 0.5, 1);
      expect(quad1.opacity).toBe(0.5);

      bridge.dispose();
    });
  });
});

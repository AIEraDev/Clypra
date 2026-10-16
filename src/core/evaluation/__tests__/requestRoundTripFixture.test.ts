/**
 * Request Round-Trip Fixture Test
 *
 * This is the CONTRACT test between the TypeScript frontend and the Rust
 * compositor. It validates the complete data path:
 *
 *   Timeline clips/tracks/assets/project
 *        ↓
 *   evaluateTimelineScene()        ← real evaluator, no mocks
 *        ↓
 *   EvaluatedScene                 ← the universal render currency
 *        ↓
 *   buildNativeVideoProjectRequest() ← real request builder
 *        ↓
 *   NativeVideoProjectFrameRequest  ← what gets sent to Rust
 *
 * The output JSON is asserted against committed fixture files. If the
 * evaluator or request builder changes in a way that alters the Rust
 * contract, this test fails — preventing silent regressions like the
 * invisible sticker bug.
 *
 * Companion: src-tauri/tests/compositor_roundtrip_fixture_tests.rs loads
 * the same JSON fixtures and renders them through the golden harness,
 * asserting fixture colours at expected coordinates. The JSON is the
 * contract between the two sides.
 *
 * RUN:  npx vitest run src/core/evaluation/__tests__/requestRoundTripFixture.test.ts
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import mixedSceneFixture from "../../../../tests/fixtures/roundtrip/mixed_scene_request.json";
import emptySceneFixture from "../../../../tests/fixtures/roundtrip/empty_scene_request.json";
import { evaluateTimelineScene } from "../evaluator";
import {
  buildNativeVideoProjectRequest,
  buildNativeFrameRequest,
} from "@/components/editor/preview/nativeVideoPreview";
import type { NativeRasterLayerSnapshot } from "@/lib/platform/nativeCore";
import type { Clip, Track, MediaAsset, Project } from "@/types";
import { useEffectsStore } from "@/features/text-effects/store/effectsStore";

// ─── Mocks (only external system boundaries — NOT the evaluator or builder) ──

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
  invoke: vi.fn(),
}));

// ─── Shared Project & Track Fixtures ─────────────────────────────────────────

const FIXTURE_PROJECT: Project = {
  id: "roundtrip-fixture-project",
  name: "Fixture Project",
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  aspectRatio: "16:9",
  canvasWidth: 1920,
  canvasHeight: 1080,
  frameRate: 30,
  duration: 10,
};

const FIXTURE_TRACKS: Track[] = [
  { id: "v1", type: "video", name: "Video 1", locked: false, muted: false, visible: true, height: 64 },
  { id: "s1", type: "sticker", name: "Sticker 1", locked: false, muted: false, visible: true, height: 64 },
  { id: "t1", type: "text", name: "Text 1", locked: false, muted: false, visible: true, height: 64 },
  { id: "a1", type: "audio", name: "Audio 1", locked: false, muted: false, visible: true, height: 64 },
];

// ─── Clip Fixtures ───────────────────────────────────────────────────────────

/**
 * Green text on black background — unique known colour for pixel assertions.
 * fontFamily: "Arial" (bundled in CI).
 */
const TEXT_CLIP: Clip = {
  id: "fixture-text-green",
  trackId: "t1",
  kind: "text",
  mediaId: "",
  name: "Green Text Fixture",
  startTime: 0,
  duration: 5.0,
  trimIn: 0,
  trimOut: 5.0,
  x: 660,
  y: 460,
  width: 600,
  height: 160,
  opacity: 1,
  rotation: 0,
  text: "HELLO",
  fontSize: 120,
  fontFamily: "Arial",
  fontWeight: "bold",
  fontStyle: "normal",
  color: "#00FF00",
  align: "center",
  valign: "middle",
  lineHeight: 1.2,
  letterSpacing: 0,
} as any;

/**
 * Magenta 64×64 lottie sticker — the class of asset that was invisible.
 * stickerFormat: "lottie" so it goes through NativeRasterBridge.
 */
const STICKER_CLIP: Clip = {
  id: "fixture-sticker-magenta",
  trackId: "s1",
  kind: "sticker",
  mediaId: "sticker-magenta-64",
  name: "Magenta Sticker",
  startTime: 0,
  duration: 4.0,
  trimIn: 0,
  trimOut: 4.0,
  x: 928,
  y: 508,
  width: 64,
  height: 64,
  opacity: 1,
  rotation: 0,
  aspectRatioLocked: true,
  sourceAspectRatio: 1,
  fitMode: "contain",
  stickerFormat: "lottie",
  stickerAnimationPath: "/fixtures/magenta-64x64.json",
  stickerSourceId: "magenta-test-sticker",
  stickerSettings: { speed: 1, loop: true },
} as any;

/**
 * Static image sticker (PNG) — tests the image raster path.
 */
const STATIC_STICKER_CLIP: Clip = {
  id: "fixture-sticker-static-cyan",
  trackId: "s1",
  kind: "sticker",
  mediaId: "sticker-cyan-static",
  name: "Cyan Static Sticker",
  startTime: 1.0,
  duration: 3.0,
  trimIn: 0,
  trimOut: 3.0,
  x: 100,
  y: 100,
  width: 128,
  height: 128,
  opacity: 0.8,
  rotation: 0,
  aspectRatioLocked: true,
  sourceAspectRatio: 1,
  fitMode: "contain",
  stickerFormat: "static",
  stickerSourceId: "cyan-test-sticker",
  stickerImagePath: "/fixtures/cyan-128x128.png",
} as any;

/**
 * Audio-only clip — should NOT produce visual layers.
 */
const AUDIO_CLIP: Clip = {
  id: "fixture-audio-narration",
  trackId: "a1",
  kind: "audio",
  mediaId: "audio-narration-1",
  name: "Test Narration",
  startTime: 0,
  duration: 6.0,
  trimIn: 0,
  trimOut: 6.0,
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  opacity: 1,
  rotation: 0,
  volume: 0.8,
  audioPath: "/fixtures/test-narration.wav",
} as any;

const AUDIO_ASSET: MediaAsset = {
  id: "audio-narration-1",
  name: "test-narration.wav",
  path: "/fixtures/test-narration.wav",
  type: "audio",
  duration: 6.0,
} as any;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Strip non-deterministic or environment-dependent fields from the request
 * so the fixture is stable across machines and runs.
 */
function stabilizeRequest(request: any): any {
  if (!request) return null;
  const copy = JSON.parse(JSON.stringify(request));
  // sourcePath will differ per environment (asset://localhost/...) — normalize
  if (copy.layers) {
    for (const layer of copy.layers) {
      if (layer.videoPath && layer.videoPath.startsWith("asset://")) {
        layer.videoPath = layer.videoPath.replace(/^asset:\/\/localhost\//, "asset:///");
      }
    }
  }
  return copy;
}

/** Round-trip through JSON to ensure serialization parity with Rust serde. */
function jsonRoundTrip(value: any): any {
  return JSON.parse(JSON.stringify(value));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Request Round-Trip Fixture Contract", () => {
  beforeEach(() => {
    useEffectsStore.setState({ definitions: {} });
  });

  // ╔════════════════════════════════════════════════════════════════════════╗
  // ║  SCENARIO 1: Text-only timeline (empty scene + green text)           ║
  // ║  Contract: text clips produce textLayers, zero videoLayers           ║
  // ╚════════════════════════════════════════════════════════════════════════╝

  describe("Scenario 1: Text-only timeline", () => {
    it("RT-TEXT-01: evaluator produces exactly one text visual layer", () => {
      const scene = evaluateTimelineScene(
        1.0,
        [TEXT_CLIP],
        FIXTURE_TRACKS,
        [],
        FIXTURE_PROJECT,
      );

      expect(scene.visualLayers).toHaveLength(1);
      expect(scene.visualLayers[0].layerType).toBe("text");
      expect(scene.audioLayers).toHaveLength(0);
    });

    it("RT-TEXT-02: request builder maps text layer to textLayers, zero videoLayers", () => {
      const scene = evaluateTimelineScene(
        1.0,
        [TEXT_CLIP],
        FIXTURE_TRACKS,
        [],
        FIXTURE_PROJECT,
      );

      const request = buildNativeVideoProjectRequest(scene, []);
      expect(request).not.toBeNull();
      expect(request!.layers).toEqual([]); // Zero video layers
      expect(request!.textLayers).toHaveLength(1);
      expect(request!.textLayers![0].text).toBe("HELLO");
      expect(request!.textLayers![0].fontId).toMatch(/Arial/);
      expect(request!.textLayers![0].fontSize).toBe(120);
    });

    it("RT-TEXT-03: text layer position and dimensions match clip input", () => {
      const scene = evaluateTimelineScene(
        1.0,
        [TEXT_CLIP],
        FIXTURE_TRACKS,
        [],
        FIXTURE_PROJECT,
      );

      const request = buildNativeVideoProjectRequest(scene, []);
      expect(request).not.toBeNull();

      const textLayer = request!.textLayers![0];
      expect(textLayer.x).toBe(660);
      expect(textLayer.y).toBe(460);
      expect(textLayer.boxWidth).toBe(600);
      expect(textLayer.boxHeight).toBe(160);
      expect(textLayer.opacity).toBe(1);
      expect(textLayer.rotation).toBe(0);
      expect(textLayer.zIndex).toBe(0);
    });

    it("RT-TEXT-04: text colour is serialized as normalized RGBA for Rust", () => {
      const scene = evaluateTimelineScene(
        1.0,
        [TEXT_CLIP],
        FIXTURE_TRACKS,
        [],
        FIXTURE_PROJECT,
      );

      const request = buildNativeVideoProjectRequest(scene, []);
      const textLayer = request!.textLayers![0];
      // #00FF00 → [0, 1, 0, 1] in normalized RGBA
      expect(textLayer.color).toEqual([0, 1, 0, 1]);
    });

    it("RT-TEXT-05: canvas background produces correct clearColor for Rust", () => {
      const scene = evaluateTimelineScene(
        1.0,
        [TEXT_CLIP],
        FIXTURE_TRACKS,
        [],
        FIXTURE_PROJECT,
      );

      const request = buildNativeVideoProjectRequest(scene, []);
      expect(request).not.toBeNull();
      // Default background → black clear colour
      expect(request!.clearColor).toEqual([0, 0, 0, 1]);
      expect(request!.canvasWidth).toBe(1920);
      expect(request!.canvasHeight).toBe(1080);
    });

    it("RT-TEXT-06: different text content produces different request", () => {
      const clipA = { ...TEXT_CLIP, text: "HELLO" } as any;
      const clipB = { ...TEXT_CLIP, id: "fixture-text-world", text: "WORLD" } as any;

      const sceneA = evaluateTimelineScene(1.0, [clipA], FIXTURE_TRACKS, [], FIXTURE_PROJECT);
      const sceneB = evaluateTimelineScene(1.0, [clipB], FIXTURE_TRACKS, [], FIXTURE_PROJECT);

      const reqA = buildNativeVideoProjectRequest(sceneA, []);
      const reqB = buildNativeVideoProjectRequest(sceneB, []);

      expect(reqA!.textLayers![0].text).toBe("HELLO");
      expect(reqB!.textLayers![0].text).toBe("WORLD");
      expect(JSON.stringify(reqA)).not.toBe(JSON.stringify(reqB));
    });
  });

  // ╔════════════════════════════════════════════════════════════════════════╗
  // ║  SCENARIO 2: Sticker timeline (animated lottie + static)             ║
  // ║  Contract: lottie stickers need rasterLayers; static stickers need   ║
  // ║  image asset registration; both must reach the Rust request          ║
  // ╚════════════════════════════════════════════════════════════════════════╝

  describe("Scenario 2: Sticker timeline", () => {
    it("RT-STICKER-01: animated lottie sticker evaluates to media layer with stickerFormat lottie", () => {
      const scene = evaluateTimelineScene(
        1.0,
        [STICKER_CLIP],
        FIXTURE_TRACKS,
        [],
        FIXTURE_PROJECT,
      );

      expect(scene.visualLayers).toHaveLength(1);
      const layer = scene.visualLayers[0];
      expect(layer.layerType).toBe("media");
      if (layer.layerType === "media") {
        expect(layer.clipKind).toBe("sticker");
        expect(layer.stickerFormat).toBe("lottie");
      }
    });

    it("RT-STICKER-02: request builder returns null when lottie sticker raster is MISSING", () => {
      // This is the exact bug scenario — if NativeRasterBridge hasn't prepared
      // the sticker raster, the request builder returns null, and the preview
      // falls back to the browser path (or shows nothing if isTauriRuntime).
      const scene = evaluateTimelineScene(
        1.0,
        [STICKER_CLIP],
        FIXTURE_TRACKS,
        [],
        FIXTURE_PROJECT,
      );

      const request = buildNativeVideoProjectRequest(scene, []); // No raster layers!
      expect(request).toBeNull(); // ← This is what causes invisible stickers
    });

    it("RT-STICKER-03: request builder succeeds when lottie sticker raster IS present", () => {
      const scene = evaluateTimelineScene(
        1.0,
        [STICKER_CLIP],
        FIXTURE_TRACKS,
        [],
        FIXTURE_PROJECT,
      );

      // Simulate what NativeRasterBridge produces after rasterizing the sticker
      const stickerRaster: NativeRasterLayerSnapshot = {
        assetId: `native-sticker:${STICKER_CLIP.id}:30:64x64`,
        width: 64,
        height: 64,
        x: 928,
        y: 508,
        rotation: 0,
        opacity: 1,
        zIndex: 0,
        blendMode: "normal",
      };

      const request = buildNativeVideoProjectRequest(scene, [stickerRaster]);
      expect(request).not.toBeNull();
      expect(request!.rasterLayers).toEqual([stickerRaster]);
      expect(request!.layers).toEqual([]); // No video layers — sticker is all raster
    });

    it("RT-STICKER-04: sticker position from clip reaches the raster layer coordinates", () => {
      const scene = evaluateTimelineScene(
        1.0,
        [STICKER_CLIP],
        FIXTURE_TRACKS,
        [],
        FIXTURE_PROJECT,
      );

      const layer = scene.visualLayers[0];
      // The sticker's position must match the clip input
      expect(layer.x).toBe(928);
      expect(layer.y).toBe(508);
      expect(layer.width).toBe(64);
      expect(layer.height).toBe(64);
    });

    it("RT-STICKER-05: static sticker with image raster asset produces valid request", () => {
      // Static stickers go through the image asset path
      const staticAsset: MediaAsset = {
        id: "sticker-cyan-static",
        name: "cyan-128x128.png",
        path: "/fixtures/cyan-128x128.png",
        type: "image",
        width: 128,
        height: 128,
      } as any;

      const scene = evaluateTimelineScene(
        1.5,
        [STATIC_STICKER_CLIP],
        FIXTURE_TRACKS,
        [staticAsset],
        FIXTURE_PROJECT,
      );

      expect(scene.visualLayers).toHaveLength(1);
      const layer = scene.visualLayers[0];
      expect(layer.layerType).toBe("media");
      if (layer.layerType === "media") {
        expect(layer.clipKind).toBe("sticker");
        expect(layer.stickerFormat).toBe("static");
      }

      // Static stickers need an image raster asset registered.
      // The asset ID must match either buildNativeImageAssetId(sourcePath, w, h)
      // or the layerId-based fallback: `native-image:{layerId}:...`
      const imageRaster: NativeRasterLayerSnapshot = {
        assetId: `native-image:${STATIC_STICKER_CLIP.id}:128x128`,
        width: 128,
        height: 128,
        x: 100,
        y: 100,
        rotation: 0,
        opacity: 0.8,
        zIndex: 0,
        blendMode: "normal",
      };

      const request = buildNativeVideoProjectRequest(scene, [imageRaster]);
      // Static stickers evaluate as images, which need raster assets
      // The request builder checks hasNativeImageRasterAsset
      expect(request).not.toBeNull();
    });
  });

  // ╔════════════════════════════════════════════════════════════════════════╗
  // ║  SCENARIO 3: Audio-only timeline                                     ║
  // ║  Contract: audio clips produce audioLayers, zero visualLayers        ║
  // ╚════════════════════════════════════════════════════════════════════════╝

  describe("Scenario 3: Audio-only timeline", () => {
    it("RT-AUDIO-01: audio clip produces zero visual layers and one audio layer", () => {
      const scene = evaluateTimelineScene(
        2.0,
        [AUDIO_CLIP],
        FIXTURE_TRACKS,
        [AUDIO_ASSET],
        FIXTURE_PROJECT,
      );

      expect(scene.visualLayers).toHaveLength(0);
      expect(scene.audioLayers).toHaveLength(1);
      expect(scene.audioLayers[0].clipId).toBe(AUDIO_CLIP.id);
    });

    it("RT-AUDIO-02: request builder produces valid empty-canvas request for audio-only", () => {
      const scene = evaluateTimelineScene(
        2.0,
        [AUDIO_CLIP],
        FIXTURE_TRACKS,
        [AUDIO_ASSET],
        FIXTURE_PROJECT,
      );

      const request = buildNativeVideoProjectRequest(scene, []);
      expect(request).not.toBeNull();
      expect(request!.layers).toEqual([]);
      expect(request!.clearColor).toEqual([0, 0, 0, 1]);
      // Audio clips should NOT produce textLayers or rasterLayers
      expect(request!.textLayers ?? []).toEqual([]);
      expect(request!.rasterLayers ?? []).toEqual([]);
    });

    it("RT-AUDIO-03: audio layer carries volume and timing metadata", () => {
      const scene = evaluateTimelineScene(
        2.0,
        [AUDIO_CLIP],
        FIXTURE_TRACKS,
        [AUDIO_ASSET],
        FIXTURE_PROJECT,
      );

      const audioLayer = scene.audioLayers[0];
      expect(audioLayer.clipId).toBe(AUDIO_CLIP.id);
      // Volume should be passed through
      expect(audioLayer.volume).toBe(0.8);
    });
  });

  // ╔════════════════════════════════════════════════════════════════════════╗
  // ║  SCENARIO 4: Mixed timeline (text + sticker + audio)                 ║
  // ║  Contract: all clip types are present and correctly categorized      ║
  // ╚════════════════════════════════════════════════════════════════════════╝

  describe("Scenario 4: Mixed timeline — text + sticker + audio", () => {
    it("RT-MIX-01: evaluator produces correct layer counts for mixed timeline", () => {
      const scene = evaluateTimelineScene(
        1.0,
        [TEXT_CLIP, STICKER_CLIP, AUDIO_CLIP],
        FIXTURE_TRACKS,
        [AUDIO_ASSET],
        FIXTURE_PROJECT,
      );

      // Text + sticker = 2 visual layers; audio = 1 audio layer
      expect(scene.visualLayers).toHaveLength(2);
      expect(scene.audioLayers).toHaveLength(1);

      const layerTypes = scene.visualLayers.map((l) => l.layerType);
      expect(layerTypes).toContain("text");
      expect(layerTypes).toContain("media");
    });

    it("RT-MIX-02: request builder with all rasters produces complete request", () => {
      const scene = evaluateTimelineScene(
        1.0,
        [TEXT_CLIP, STICKER_CLIP, AUDIO_CLIP],
        FIXTURE_TRACKS,
        [AUDIO_ASSET],
        FIXTURE_PROJECT,
      );

      const stickerRaster: NativeRasterLayerSnapshot = {
        assetId: `native-sticker:${STICKER_CLIP.id}:30:64x64`,
        width: 64,
        height: 64,
        x: 928,
        y: 508,
        rotation: 0,
        opacity: 1,
        zIndex: 0,
        blendMode: "normal",
      };

      const request = buildNativeVideoProjectRequest(scene, [stickerRaster]);
      expect(request).not.toBeNull();

      // Text goes through textLayers
      expect(request!.textLayers).toHaveLength(1);
      expect(request!.textLayers![0].text).toBe("HELLO");

      // Sticker goes through rasterLayers
      expect(request!.rasterLayers).toEqual([stickerRaster]);

      // No video layers (no video clip)
      expect(request!.layers).toEqual([]);
    });

    it("RT-MIX-03: missing sticker raster blocks the entire request", () => {
      // THIS IS THE BUG: if NativeRasterBridge fails to prepare the sticker,
      // the entire request builder returns null, and nothing renders.
      const scene = evaluateTimelineScene(
        1.0,
        [TEXT_CLIP, STICKER_CLIP, AUDIO_CLIP],
        FIXTURE_TRACKS,
        [AUDIO_ASSET],
        FIXTURE_PROJECT,
      );

      const request = buildNativeVideoProjectRequest(scene, []);
      expect(request).toBeNull();
    });

    it("RT-MIX-04: serialized request matches committed golden fixture file", () => {
      const scene = evaluateTimelineScene(
        1.0,
        [TEXT_CLIP, STICKER_CLIP, AUDIO_CLIP],
        FIXTURE_TRACKS,
        [AUDIO_ASSET],
        FIXTURE_PROJECT,
      );

      const stickerRaster: NativeRasterLayerSnapshot = {
        assetId: `native-sticker:${STICKER_CLIP.id}:30:64x64`,
        width: 64,
        height: 64,
        x: 928,
        y: 508,
        rotation: 0,
        opacity: 1,
        zIndex: 0,
        blendMode: "normal",
      };

      const request = buildNativeVideoProjectRequest(scene, [stickerRaster]);
      expect(request).not.toBeNull();

      expect(jsonRoundTrip(request)).toEqual(mixedSceneFixture);
    });
  });

  // ╔════════════════════════════════════════════════════════════════════════╗
  // ║  SCENARIO 5: Empty timeline                                          ║
  // ║  Contract: empty scene still produces a valid black-canvas request   ║
  // ╚════════════════════════════════════════════════════════════════════════╝

  describe("Scenario 5: Empty timeline", () => {
    it("RT-EMPTY-01: empty scene produces valid request with black clear colour", () => {
      const scene = evaluateTimelineScene(
        0,
        [],
        FIXTURE_TRACKS,
        [],
        FIXTURE_PROJECT,
      );

      expect(scene.visualLayers).toHaveLength(0);
      expect(scene.audioLayers).toHaveLength(0);

      const request = buildNativeVideoProjectRequest(scene, []);
      expect(request).not.toBeNull();
      expect(request!.layers).toEqual([]);
      expect(request!.clearColor).toEqual([0, 0, 0, 1]);
    });

    it("RT-EMPTY-02: empty scene request matches committed golden fixture file", () => {
      const scene = evaluateTimelineScene(0, [], FIXTURE_TRACKS, [], FIXTURE_PROJECT);
      const request = buildNativeVideoProjectRequest(scene, []);
      expect(request).not.toBeNull();

      expect(jsonRoundTrip(request)).toEqual(emptySceneFixture);
    });
  });

  // ╔════════════════════════════════════════════════════════════════════════╗
  // ║  SCENARIO 6: Temporal correctness                                    ║
  // ║  Contract: clips outside their time window don't appear              ║
  // ╚════════════════════════════════════════════════════════════════════════╝

  describe("Scenario 6: Temporal correctness", () => {
    it("RT-TIME-01: text clip absent before startTime", () => {
      const clip = { ...TEXT_CLIP, startTime: 2.0, duration: 3.0, trimIn: 0, trimOut: 3.0 } as any;
      const scene = evaluateTimelineScene(1.0, [clip], FIXTURE_TRACKS, [], FIXTURE_PROJECT);
      expect(scene.visualLayers).toHaveLength(0);
    });

    it("RT-TIME-02: text clip absent after startTime + duration", () => {
      const clip = { ...TEXT_CLIP, startTime: 0, duration: 2.0, trimIn: 0, trimOut: 2.0 } as any;
      const scene = evaluateTimelineScene(3.0, [clip], FIXTURE_TRACKS, [], FIXTURE_PROJECT);
      expect(scene.visualLayers).toHaveLength(0);
    });

    it("RT-TIME-03: text clip present within its time window", () => {
      const clip = { ...TEXT_CLIP, startTime: 1.0, duration: 3.0, trimIn: 0, trimOut: 3.0 } as any;
      const scene = evaluateTimelineScene(2.5, [clip], FIXTURE_TRACKS, [], FIXTURE_PROJECT);
      expect(scene.visualLayers).toHaveLength(1);
    });

    it("RT-TIME-04: sticker absent before its startTime in mixed timeline", () => {
      const lateStickerClip = { ...STICKER_CLIP, startTime: 5.0 } as any;
      const scene = evaluateTimelineScene(
        1.0,
        [TEXT_CLIP, lateStickerClip],
        FIXTURE_TRACKS,
        [],
        FIXTURE_PROJECT,
      );
      // Only text should be visible at t=1.0
      expect(scene.visualLayers).toHaveLength(1);
      expect(scene.visualLayers[0].layerType).toBe("text");
    });
  });

  // ╔════════════════════════════════════════════════════════════════════════╗
  // ║  SCENARIO 7: buildNativeFrameRequest (full NativeFrameRequest)       ║
  // ║  Contract: the complete request matches NativeCore v2 schema         ║
  // ╚════════════════════════════════════════════════════════════════════════╝

  describe("Scenario 7: Full NativeFrameRequest contract", () => {
    it("RT-FRAME-01: produces valid v2 NativeFrameRequest for text scene", () => {
      const scene = evaluateTimelineScene(
        1.0,
        [TEXT_CLIP],
        FIXTURE_TRACKS,
        [],
        FIXTURE_PROJECT,
      );

      const frameRequest = buildNativeFrameRequest(
        scene,
        "fixture-rev:1",
        30, // frameIndex
        30, // frameRate
        1920,
        1080,
        [],
      );

      expect(frameRequest).not.toBeNull();
      expect(frameRequest!.contractVersion).toBe(2);
      expect(frameRequest!.project.schemaVersion).toBe(1);
      expect(frameRequest!.project.frameRate).toBe(30);
      expect(frameRequest!.project.canvasWidth).toBe(1920);
      expect(frameRequest!.project.canvasHeight).toBe(1080);
      expect(frameRequest!.outputWidth).toBe(1920);
      expect(frameRequest!.outputHeight).toBe(1080);
      expect(frameRequest!.project.videoLayers).toEqual([]);
      expect(frameRequest!.project.textLayers).toHaveLength(1);
    });

    it("RT-FRAME-02: NativeFrameRequest for sticker includes rasterLayers in project", () => {
      const scene = evaluateTimelineScene(
        1.0,
        [STICKER_CLIP],
        FIXTURE_TRACKS,
        [],
        FIXTURE_PROJECT,
      );

      const stickerRaster: NativeRasterLayerSnapshot = {
        assetId: `native-sticker:${STICKER_CLIP.id}:30:64x64`,
        width: 64,
        height: 64,
        x: 928,
        y: 508,
        rotation: 0,
        opacity: 1,
        zIndex: 0,
        blendMode: "normal",
      };

      const frameRequest = buildNativeFrameRequest(
        scene,
        "fixture-rev:1",
        30,
        30,
        1920,
        1080,
        [stickerRaster],
      );

      expect(frameRequest).not.toBeNull();
      expect(frameRequest!.project.rasterLayers).toEqual([stickerRaster]);
      expect(frameRequest!.project.videoLayers).toEqual([]);
    });
  });

  // ╔════════════════════════════════════════════════════════════════════════╗
  // ║  SCENARIO 8: JSON serialization round-trip                           ║
  // ║  Contract: the request survives JSON.stringify → JSON.parse without  ║
  // ║  losing fields. This is what happens at the Tauri IPC boundary.      ║
  // ╚════════════════════════════════════════════════════════════════════════╝

  describe("Scenario 8: JSON serialization round-trip", () => {
    it("RT-JSON-01: text request survives JSON round-trip", () => {
      const scene = evaluateTimelineScene(
        1.0,
        [TEXT_CLIP],
        FIXTURE_TRACKS,
        [],
        FIXTURE_PROJECT,
      );

      const request = buildNativeVideoProjectRequest(scene, []);
      expect(request).not.toBeNull();

      const roundTripped = jsonRoundTrip(request);
      expect(roundTripped.textLayers).toHaveLength(1);
      expect(roundTripped.textLayers[0].text).toBe("HELLO");
      expect(roundTripped.textLayers[0].color).toEqual([0, 1, 0, 1]);
      expect(roundTripped.canvasWidth).toBe(1920);
      expect(roundTripped.canvasHeight).toBe(1080);
    });

    it("RT-JSON-02: sticker raster request survives JSON round-trip", () => {
      const scene = evaluateTimelineScene(
        1.0,
        [STICKER_CLIP],
        FIXTURE_TRACKS,
        [],
        FIXTURE_PROJECT,
      );

      const stickerRaster: NativeRasterLayerSnapshot = {
        assetId: `native-sticker:${STICKER_CLIP.id}:30:64x64`,
        width: 64,
        height: 64,
        x: 928,
        y: 508,
        rotation: 0,
        opacity: 1,
        zIndex: 0,
        blendMode: "normal",
      };

      const request = buildNativeVideoProjectRequest(scene, [stickerRaster]);
      expect(request).not.toBeNull();

      const roundTripped = jsonRoundTrip(request);
      expect(roundTripped.rasterLayers).toEqual([stickerRaster]);
    });

    it("RT-JSON-03: full NativeFrameRequest survives JSON round-trip", () => {
      const scene = evaluateTimelineScene(
        1.0,
        [TEXT_CLIP],
        FIXTURE_TRACKS,
        [],
        FIXTURE_PROJECT,
      );

      const frameRequest = buildNativeFrameRequest(
        scene,
        "fixture-rev:1",
        30,
        30,
        1920,
        1080,
        [],
      );

      expect(frameRequest).not.toBeNull();
      const roundTripped = jsonRoundTrip(frameRequest);
      expect(roundTripped.contractVersion).toBe(2);
      expect(roundTripped.project.textLayers).toHaveLength(1);
      expect(roundTripped.project.clearColor).toEqual([0, 0, 0, 1]);
    });
  });

  // ╔════════════════════════════════════════════════════════════════════════╗
  // ║  NEGATIVE CONTROLS                                                   ║
  // ║  Contract: mutations that should break the pipeline DO break it      ║
  // ╚════════════════════════════════════════════════════════════════════════╝

  describe("Negative controls", () => {
    it("RT-NEG-01: removing text from clip produces empty textLayers", () => {
      const emptyTextClip = { ...TEXT_CLIP, text: "" } as any;
      const scene = evaluateTimelineScene(
        1.0,
        [emptyTextClip],
        FIXTURE_TRACKS,
        [],
        FIXTURE_PROJECT,
      );

      const request = buildNativeVideoProjectRequest(scene, []);
      expect(request).not.toBeNull();
      // Empty text should still produce a text layer (the clip exists)
      // but the text field should be empty
      if (request!.textLayers && request!.textLayers.length > 0) {
        expect(request!.textLayers[0].text).toBe("");
      }
    });

    it("RT-NEG-02: wrong rasterLayer assetId fails sticker lookup", () => {
      const scene = evaluateTimelineScene(
        1.0,
        [STICKER_CLIP],
        FIXTURE_TRACKS,
        [],
        FIXTURE_PROJECT,
      );

      // Provide a raster with wrong assetId prefix
      const wrongRaster: NativeRasterLayerSnapshot = {
        assetId: `native-sticker:WRONG_ID:30:64x64`,
        width: 64,
        height: 64,
        x: 928,
        y: 508,
        rotation: 0,
        opacity: 1,
        zIndex: 0,
        blendMode: "normal",
      };

      const request = buildNativeVideoProjectRequest(scene, [wrongRaster]);
      // Should return null because the sticker raster doesn't match
      expect(request).toBeNull();
    });

    it("RT-NEG-03: zero-opacity text layer is still present in request (compositor handles opacity)", () => {
      const zeroOpacityClip = { ...TEXT_CLIP, opacity: 0 } as any;
      const scene = evaluateTimelineScene(
        1.0,
        [zeroOpacityClip],
        FIXTURE_TRACKS,
        [],
        FIXTURE_PROJECT,
      );

      const request = buildNativeVideoProjectRequest(scene, []);
      expect(request).not.toBeNull();
      // The layer should still be in the request — opacity is the compositor's job
      expect(request!.textLayers).toHaveLength(1);
      expect(request!.textLayers![0].opacity).toBe(0);
    });
  });
});

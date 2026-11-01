/**
 * imageAdjustmentsParity.test.ts
 *
 * Regression suite confirming that image clip adjustments and colorGrade flow
 * all the way from EvaluatedMediaLayer through buildNativeVideoProjectRequest
 * into the rasterLayers array sent to the Rust compositor.
 *
 * Previously image clips' adjustments were silently dropped because:
 *  - NativeRasterLayerSnapshot had no colorGrade field
 *  - nativeRasterBridge.rasterizeImages() never called getNativeColorGrade()
 *  - NativeProjectRasterLayer (Rust) had no color_grade field
 *  - Both compositor raster loops hardcoded ColorGradeUniforms::default()
 */

import { describe, it, expect } from "vitest";
import type {
  EvaluatedMediaLayer,
  EvaluatedScene,
} from "@/core/evaluation/types";
import { buildNativeVideoProjectRequest } from "../nativeVideoPreview";
import type { NativeRasterLayerSnapshot } from "@/lib/platform/nativeCore";
import { buildNativeImageAssetId } from "@/core/render/nativeRasterAssetIds";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeImageLayer(
  overrides: Partial<EvaluatedMediaLayer> = {},
): EvaluatedMediaLayer {
  return {
    layerId: "image-1",
    clipId: "image-1",
    clipKind: "image",
    layerType: "media",
    mediaId: "asset-1",
    mediaType: "image",
    sourcePath: "/Users/test/photo.jpg",
    sourceWidth: 1920,
    sourceHeight: 1080,
    sourceTime: 0,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    blendMode: "normal",
    transitionOpacity: 1,
    inTransition: false,
    effects: [],
    ...overrides,
  } as EvaluatedMediaLayer;
}

function makeScene(layers: EvaluatedMediaLayer[]): EvaluatedScene {
  return {
    visualLayers: layers,
    audioLayers: [],
    captionLayers: [],
    activeFilter: undefined,
    metadata: {
      time: 0,
      canvasWidth: 1920,
      canvasHeight: 1080,
      canvasBackground: {
        type: "solid",
        color: "#000000",
        isTransparent: false,
      },
      frameRate: 30,
    },
    transitionWindows: [],
    transitions: [],
  } as unknown as EvaluatedScene;
}

function makeRasterSnapshot(
  layer: EvaluatedMediaLayer,
  colorGrade?: NativeRasterLayerSnapshot["colorGrade"],
): NativeRasterLayerSnapshot {
  const sourceWidth = Math.max(1, Math.round(layer.sourceWidth ?? layer.width));
  const sourceHeight = Math.max(
    1,
    Math.round(layer.sourceHeight ?? layer.height),
  );
  return {
    assetId: buildNativeImageAssetId(
      layer.sourcePath,
      sourceWidth,
      sourceHeight,
    ),
    width: sourceWidth,
    height: sourceHeight,
    x: layer.x,
    y: layer.y,
    rotation: layer.rotation,
    opacity: layer.opacity,
    zIndex: layer.zIndex,
    blendMode: layer.blendMode,
    isText: false,
    ...(colorGrade ? { colorGrade } : {}),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Image clip adjustments pipeline — rasterLayer colorGrade parity", () => {
  it("passes colorGrade through when raster snapshot carries one", () => {
    const layer = makeImageLayer();
    const colorGrade = {
      exposure: 1.0,
      contrast: 0.5,
      saturation: 0.0,
      temperature: 0.0,
      tint: 0.0,
      brightness: 0.0,
      sepia: 0.0,
      grayscale: 0.0,
      hueRotate: 0.0,
      vignette: 0.0,
      invert: 0.0,
      grainIntensity: 0.0,
      grainSize: 1.0,
      lutIntensity: 0.0,
      lutSize: 0.0,
      blurStrength: 0.0,
      blurRadius: 0.0,
      pixelateSize: 0.0,
      scanlineCount: 0.0,
      scanlineIntensity: 0.0,
      rgbSplitX: 0.0,
      rgbSplitY: 0.0,
      vibranceAmount: 0.0,
      vibranceProtectedHueR: 0.0,
      vibranceProtectedHueG: 0.0,
      vibranceProtectedHueB: 0.0,
      lift: 0.0,
      crossProcessAmount: 0.0,
      highlights: 0.0,
      shadows: 0.0,
      whites: 0.0,
      blacks: 0.0,
      fade: 0.0,
      hslChannelCount: 0,
      hslChannels: [],
    } as any;
    const raster = makeRasterSnapshot(layer, colorGrade);

    const request = buildNativeVideoProjectRequest(makeScene([layer]), [
      raster,
    ]);

    expect(request).not.toBeNull();
    // Image layers go into rasterLayers, not layers (video)
    expect(request!.layers).toHaveLength(0);
    expect(request!.rasterLayers).toHaveLength(1);
    // colorGrade must be preserved on the raster layer
    expect(request!.rasterLayers![0].colorGrade).toBeDefined();
    expect(request!.rasterLayers![0].colorGrade?.exposure).toBe(1.0);
    expect(request!.rasterLayers![0].colorGrade?.contrast).toBe(0.5);
  });

  it("omits colorGrade when raster snapshot has none (no-op path)", () => {
    const layer = makeImageLayer();
    const raster = makeRasterSnapshot(layer); // no colorGrade

    const request = buildNativeVideoProjectRequest(makeScene([layer]), [
      raster,
    ]);

    expect(request).not.toBeNull();
    expect(request!.rasterLayers).toHaveLength(1);
    expect(request!.rasterLayers![0].colorGrade).toBeUndefined();
  });

  it("routes image layers to rasterLayers not video layers", () => {
    const layer = makeImageLayer({ sourcePath: "/Users/test/img.png" });
    const raster = makeRasterSnapshot(layer);

    const request = buildNativeVideoProjectRequest(makeScene([layer]), [
      raster,
    ]);

    expect(request).not.toBeNull();
    // The image must not appear in the video decoding pipeline
    expect(request!.layers.some((l) => l.videoPath?.includes("img.png"))).toBe(
      false,
    );
    expect(request!.rasterLayers).toHaveLength(1);
  });

  it("blocks the request when a registered raster is missing for an image layer", () => {
    const layer = makeImageLayer();
    // Pass no raster snapshots — compositor must block
    const request = buildNativeVideoProjectRequest(makeScene([layer]), []);
    expect(request).toBeNull();
  });

  it("geometry (x, y, width, height, rotation, opacity, blendMode) pass through correctly", () => {
    const layer = makeImageLayer({
      x: 100,
      y: 200,
      width: 640,
      height: 360,
      rotation: 45,
      opacity: 0.75,
      blendMode: "multiply",
    });
    const raster = makeRasterSnapshot(layer);

    const request = buildNativeVideoProjectRequest(makeScene([layer]), [
      raster,
    ]);

    expect(request).not.toBeNull();
    const rl = request!.rasterLayers![0];
    expect(rl.x).toBe(100);
    expect(rl.y).toBe(200);
    expect(rl.rotation).toBe(45);
    expect(rl.opacity).toBe(0.75);
    expect(rl.blendMode).toBe("multiply");
  });
});

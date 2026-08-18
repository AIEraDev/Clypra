import { describe, expect, it } from "vitest";
import type { EvaluatedMediaLayer, EvaluatedScene } from "@/core/evaluation/types";
import { buildNativeVideoProjectRequest, isRenderableNativePreviewFrame } from "../nativeVideoPreview";

function makeVideoLayer(overrides: Partial<EvaluatedMediaLayer> = {}): EvaluatedMediaLayer {
  return {
    layerId: "clip-1",
    clipId: "clip-1",
    role: "primary",
    clipKind: "video",
    zIndex: 0,
    trackIndex: 0,
    layerType: "media",
    mediaId: "asset-1",
    mediaType: "video",
    sourcePath: "/Users/test/clip.mp4",
    sourceTime: 2,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    rotation: 0,
    opacity: 1,
    inTransition: false,
    blendMode: "normal",
    ...overrides,
  };
}

function makeScene(visualLayers: EvaluatedScene["visualLayers"]): EvaluatedScene {
  return {
    visualLayers,
    audioLayers: [],
    transitions: [],
    metadata: {
      time: 2,
      canvasWidth: 1920,
      canvasHeight: 1080,
      frameRate: 30,
      isGap: false,
      canvasBackground: undefined,
      activeMediaHash: "video",
    },
  } as EvaluatedScene;
}

describe("buildNativeVideoProjectRequest", () => {
  it("maps evaluated video layers into a project-sized native request", () => {
    const layer = makeVideoLayer({ x: 100, y: 50, width: 640, height: 360, zIndex: 7 });

    expect(buildNativeVideoProjectRequest(makeScene([layer]))).toEqual({
      canvasWidth: 1920,
      canvasHeight: 1080,
      clearColor: [0, 0, 0, 1],
      layers: [{
        videoPath: "/Users/test/clip.mp4",
        timeSecs: 2,
        x: 100,
        y: 50,
        width: 640,
        height: 360,
        rotation: 0,
        opacity: 1,
        zIndex: 0,
        blendMode: "normal",
      }],
    });
  });

  it("keeps unsupported scenes on the existing Pixi path", () => {
    expect(buildNativeVideoProjectRequest(makeScene([
      makeVideoLayer({ filter: { id: "filter", name: "blur", intensity: 1 } }),
    ]))).toBeNull();
    expect(buildNativeVideoProjectRequest(makeScene([
      makeVideoLayer(),
      { ...makeVideoLayer({ mediaId: "image-1" }), mediaType: "image" } as never,
    ]))).toBeNull();
  });
});

describe("isRenderableNativePreviewFrame", () => {
  it("rejects an opaque black clear frame", () => {
    expect(isRenderableNativePreviewFrame(new Uint8Array([0, 0, 0, 255]).buffer, 1, 1)).toBe(false);
  });

  it("accepts a visible opaque pixel", () => {
    expect(isRenderableNativePreviewFrame(new Uint8Array([12, 24, 36, 255]).buffer, 1, 1)).toBe(true);
  });

  it("rejects invalid byte lengths", () => {
    expect(isRenderableNativePreviewFrame(new Uint8Array([12, 24, 36]).buffer, 1, 1)).toBe(false);
  });
});

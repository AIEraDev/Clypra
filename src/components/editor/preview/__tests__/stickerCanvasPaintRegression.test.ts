import { describe, it, expect, vi, beforeEach } from "vitest";
import { paintTextLayersToCanvas } from "../nativeTextPreview";
import { STARTER_STICKERS } from "@/features/stickers/starterStickers";
import type { EvaluatedMediaLayer, EvaluatedScene } from "@/core/evaluation/types";

describe("Sticker Canvas Paint Regression (Non-Video Timeline)", () => {
  let mockCanvas: HTMLCanvasElement;
  let mockCtx: any;

  beforeEach(() => {
    mockCtx = {
      clearRect: vi.fn(),
      setTransform: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      drawImage: vi.fn(),
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
    };

    mockCanvas = {
      width: 1920,
      height: 1080,
      getContext: vi.fn(() => mockCtx),
    } as any;
  });

  it("fails to draw when sticker image has not completed loading on first render and has no repaint trigger", async () => {
    const starter = STARTER_STICKERS[0];
    const starterSvgUrl = starter.svgThumbnail;

    const stickerLayer: EvaluatedMediaLayer = {
      layerId: "clip-sticker-1",
      clipId: "clip-sticker-1",
      role: "main",
      clipKind: "sticker",
      zIndex: 0,
      layerType: "media",
      mediaId: `sticker-${starter.id}`,
      mediaType: "image",
      sourcePath: starterSvgUrl,
      sourceWidth: 400,
      sourceHeight: 400,
      sourceTime: 0,
      x: 760,
      y: 340,
      width: 400,
      height: 400,
      rotation: 0,
      opacity: 1,
      blendMode: "normal",
      stickerFormat: "lottie",
      stickerSourceId: starter.id,
      stickerAnimationPath: `bundled://${starter.id}.json`,
    } as any;

    const scene: EvaluatedScene = {
      visualLayers: [stickerLayer],
      audioLayers: [],
      transitions: [],
      metadata: {
        time: 0,
        frameRate: 30,
        isGap: false,
        canvasWidth: 1920,
        canvasHeight: 1080,
      },
    };

    // First paint call on a cold sticker asset
    await paintTextLayersToCanvas(mockCanvas, scene, "interactive-preview");

    // In current buggy code: drawImage was NOT called because Image() was just created and not complete!
    console.log("mockCtx.drawImage called times:", mockCtx.drawImage.mock.calls.length);
    expect(mockCtx.drawImage).toHaveBeenCalled();
  });

  it("renders animated Lottie sticker whose animation path is a json file", async () => {
    const starterHeart = STARTER_STICKERS[1];
    const lottieLayer: EvaluatedMediaLayer = {
      layerId: "clip-lottie-1",
      clipId: "clip-lottie-1",
      role: "main",
      clipKind: "sticker",
      zIndex: 0,
      layerType: "media",
      mediaId: `sticker-${starterHeart.id}`,
      mediaType: "image",
      sourcePath: `bundled://${starterHeart.id}.json`,
      sourceWidth: 400,
      sourceHeight: 400,
      sourceTime: 0,
      x: 760,
      y: 340,
      width: 400,
      height: 400,
      rotation: 0,
      opacity: 1,
      blendMode: "normal",
      stickerFormat: "lottie",
      stickerSourceId: starterHeart.id,
      stickerAnimationPath: `bundled://${starterHeart.id}.json`,
      lottieData: starterHeart.lottieData,
    } as any;

    const scene: EvaluatedScene = {
      visualLayers: [lottieLayer],
      audioLayers: [],
      transitions: [],
      metadata: {
        time: 0,
        frameRate: 30,
        isGap: false,
        canvasWidth: 1920,
        canvasHeight: 1080,
      },
    };

    await paintTextLayersToCanvas(mockCanvas, scene, "interactive-preview");
    console.log("Lottie mockCtx.drawImage called times:", mockCtx.drawImage.mock.calls.length);
    expect(mockCtx.drawImage).toHaveBeenCalled();
  });
});

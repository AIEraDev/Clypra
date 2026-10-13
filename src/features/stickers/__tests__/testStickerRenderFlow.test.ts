import { describe, it, expect, vi } from "vitest";
import { StickerRasterizerWorkerClient } from "@/core/render/stickerRasterizerWorkerClient";
import { STARTER_STICKERS } from "@/features/stickers/starterStickers";
import type { EvaluatedMediaLayer } from "@/core/evaluation/types";

describe("StickerRasterizerWorkerClient Render Flow", () => {
  it("renders starter sticker on main-thread fallback when worker is unavailable", async () => {
    const client = new StickerRasterizerWorkerClient();
    const starter = STARTER_STICKERS[0];

    const layer: EvaluatedMediaLayer = {
      layerId: "clip-sticker-1",
      clipId: "clip-sticker-1",
      role: "main",
      clipKind: "sticker",
      zIndex: 0,
      layerType: "media",
      mediaId: `sticker-${starter.id}`,
      mediaType: "image",
      sourcePath: starter.svgThumbnail,
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

    const result = await client.render(layer, "interactive-preview", true);
    console.log("StickerRasterizerWorkerClient Render Result:", result ? { assetId: result.assetId, w: result.width, h: result.height, rgbaLen: result.rgba.length } : null);
    expect(result).not.toBeNull();
  });
});

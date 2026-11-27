import { describe, expect, it } from "vitest";
import {
  isStickerFormat,
  isStickerProviderId,
  isStickerRef,
  migrateLegacyStickerRef,
  type StickerRef,
} from "@/features/stickers/types";

describe("sticker provenance contracts", () => {
  it("accepts every explicitly supported format", () => {
    expect(["static", "gif", "lottie", "animated-webp", "apng"].every(isStickerFormat)).toBe(true);
  });

  it("rejects malformed provider identifiers", () => {
    expect(isStickerProviderId("catalog")).toBe(true);
    expect(isStickerProviderId("catalog-v2")).toBe(true);
    expect(isStickerProviderId("../catalog")).toBe(false);
    expect(isStickerProviderId("Catalog")).toBe(false);
    expect(isStickerProviderId("" )).toBe(false);
  });

  it("validates the minimum persisted reference and tolerates optional provenance", () => {
    const reference: StickerRef = {
      providerId: "catalog",
      itemId: "sparkle",
      format: "lottie",
      contentHash: "sha256:abc",
      revisionId: "2026-11-25",
      license: {
        spdx: "Apache-2.0",
        author: "Clypra",
        attributionRequired: false,
        sourceUrl: "https://example.com/sparkle",
      },
    };

    expect(isStickerRef(reference)).toBe(true);
    expect(isStickerRef({ ...reference, itemId: "" })).toBe(false);
    expect(isStickerRef({ ...reference, format: "unsupported" })).toBe(false);
  });

  it("maps legacy source ids without requiring catalog or cache access", () => {
    expect(migrateLegacyStickerRef("starter-golden-star", "lottie")).toEqual({
      providerId: "bundled",
      itemId: "starter-golden-star",
      format: "lottie",
    });
    expect(migrateLegacyStickerRef("remote-star", "static")).toEqual({
      providerId: "catalog",
      itemId: "remote-star",
      format: "static",
    });
    expect(migrateLegacyStickerRef(undefined, undefined)).toBeUndefined();
  });
});

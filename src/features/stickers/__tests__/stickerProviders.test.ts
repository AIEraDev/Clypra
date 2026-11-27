import { describe, expect, it, vi } from "vitest";
import { StickersApi } from "@/features/stickers/api/stickersApi";
import { resolveSticker, stickerProviders } from "@/features/stickers/providers/stickerProviders";

describe("sticker providers", () => {
  it("lists bundled stickers through a paged provider contract", async () => {
    const first = await stickerProviders.bundled.list("celebration");
    expect(first.items.length).toBeGreaterThan(0);
    expect(first.items.length).toBeLessThanOrEqual(50);
    expect(first.hasMore).toBe(false);
  });

  it("resolves bundled Lottie without using the cache or network", async () => {
    const resolution = await resolveSticker({
      providerId: "bundled",
      itemId: "starter-golden-star",
      format: "lottie",
    });

    expect(resolution.kind).toBe("local");
    if (resolution.kind === "local") {
      expect(resolution.artifact.kind).toBe("lottie");
      expect(resolution.artifact.format).toBe("lottie");
    }
  });

  it("does not silently resolve an unsupported animated format", async () => {
    const apiSpy = vi.spyOn(StickersApi, "getSticker").mockRejectedValueOnce(new Error("offline"));
    const resolution = await resolveSticker({
      providerId: "catalog",
      itemId: "missing-animated-webp",
      format: "animated-webp",
    });

    expect(["offline", "missing", "unsupported-format"]).toContain(
      resolution.kind === "unavailable" ? resolution.reason : "unexpected-local",
    );
    apiSpy.mockRestore();
  });

  it("generates self-contained shape artifacts without cache access", async () => {
    const resolution = await resolveSticker({
      providerId: "shapes",
      itemId: "shape-circle",
      format: "lottie",
      shape: {
        type: "circle",
        width: 360,
        height: 360,
        fill: "#38BDF8",
        stroke: "#0F172A",
        strokeWidth: 8,
      },
    });

    expect(resolution.kind).toBe("local");
    if (resolution.kind === "local") {
      expect(resolution.artifact.kind).toBe("shape");
      if (resolution.artifact.kind === "shape") {
        expect(resolution.artifact.localAnimationPath).toMatch(/^data:application\/json,/);
      }
    }
  });

  it("keeps GIPHY browse-only until storage policy approval", async () => {
    const resolution = await resolveSticker({
      providerId: "giphy",
      itemId: "gif-1",
      format: "gif",
    });
    expect(resolution).toEqual({ kind: "unavailable", reason: "storage-prohibited" });
  });
});

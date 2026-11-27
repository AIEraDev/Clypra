import { describe, it, expect } from "vitest";
import {
  CLIP_CATEGORIES,
  isClipCategory,
  isClipItem,
  HashMismatchError,
  DownloadAbortedError,
  DiskFullError,
  type ClipItem,
} from "../types";

function makeClipItem(overrides: Partial<ClipItem> = {}): ClipItem {
  return {
    id: "laughing-kid-001",
    title: "Laughing Kid",
    category: "laughing",
    tags: ["laughing", "reaction"],
    durationSec: 5.2,
    width: 1920,
    height: 1080,
    posterUrl: "https://cdn.clypra.com/clips/laughing-kid-001/poster.webp",
    previewUrl: "https://cdn.clypra.com/clips/laughing-kid-001/preview.mp4",
    fileUrl: "https://cdn.clypra.com/clips/laughing-kid-001/file.mp4",
    sha256: "a".repeat(64),
    bytes: 5_000_000,
    hasAudio: true,
    hasAlpha: false,
    license: {
      spdx: "CC0-1.0",
      author: "Test Contributor",
      releaseOnFile: true,
    },
    published: true,
    ...overrides,
  };
}

describe("CLIP_CATEGORIES", () => {
  it("contains all expected MVP categories", () => {
    expect(CLIP_CATEGORIES).toContain("reaction");
    expect(CLIP_CATEGORIES).toContain("applause");
    expect(CLIP_CATEGORIES).toContain("shocked");
    expect(CLIP_CATEGORIES).toContain("laughing");
    expect(CLIP_CATEGORIES).toContain("football");
    expect(CLIP_CATEGORIES).toContain("featured");
    expect(CLIP_CATEGORIES).toHaveLength(6);
  });
});

describe("isClipCategory", () => {
  it("returns true for valid categories", () => {
    for (const cat of CLIP_CATEGORIES) {
      expect(isClipCategory(cat)).toBe(true);
    }
  });

  it("returns false for unknown strings", () => {
    expect(isClipCategory("trending")).toBe(false);
    expect(isClipCategory("giphy")).toBe(false);
    expect(isClipCategory("")).toBe(false);
  });

  it("returns false for non-strings", () => {
    expect(isClipCategory(null)).toBe(false);
    expect(isClipCategory(undefined)).toBe(false);
    expect(isClipCategory(42)).toBe(false);
  });
});

describe("isClipItem", () => {
  it("returns true for a valid ClipItem", () => {
    expect(isClipItem(makeClipItem())).toBe(true);
  });

  it("returns false when license is missing", () => {
    const { license: _removed, ...item } = makeClipItem() as any;
    expect(isClipItem(item)).toBe(false);
  });

  it("returns false when license.releaseOnFile is false", () => {
    expect(
      isClipItem(
        makeClipItem({
          license: { spdx: "CC0-1.0", author: "X", releaseOnFile: false as any },
        }),
      ),
    ).toBe(false);
  });

  it("returns false for null, undefined, primitive", () => {
    expect(isClipItem(null)).toBe(false);
    expect(isClipItem(undefined)).toBe(false);
    expect(isClipItem("string")).toBe(false);
  });

  it("returns false when id is missing", () => {
    const { id: _removed, ...item } = makeClipItem() as any;
    expect(isClipItem(item)).toBe(false);
  });
});

describe("Error classes", () => {
  it("HashMismatchError carries clipId and correct name", () => {
    const err = new HashMismatchError("clip-123");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(HashMismatchError);
    expect(err.name).toBe("HashMismatchError");
    expect(err.clipId).toBe("clip-123");
    expect(err.message).toContain("clip-123");
  });

  it("DownloadAbortedError carries clipId", () => {
    const err = new DownloadAbortedError("clip-456");
    expect(err.name).toBe("DownloadAbortedError");
    expect(err.clipId).toBe("clip-456");
  });

  it("DiskFullError carries clipId and optional cause", () => {
    const cause = new Error("ENOSPC");
    const err = new DiskFullError("clip-789", cause);
    expect(err.name).toBe("DiskFullError");
    expect(err.clipId).toBe("clip-789");
    expect(err.underlyingCause).toBe(cause);
    expect(err.message).toContain("disk space");
  });
});

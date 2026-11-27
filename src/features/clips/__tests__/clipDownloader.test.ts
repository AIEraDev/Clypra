import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  HashMismatchError,
  DownloadAbortedError,
  DiskFullError,
  type ClipItem,
} from "../types";

const mockFs = vi.hoisted(() => ({
  exists: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
}));

const mockPath = vi.hoisted(() => ({
  appCacheDir: vi.fn(),
  join: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppCache: 1 },
  exists: mockFs.exists,
  mkdir: mockFs.mkdir,
  writeFile: mockFs.writeFile,
  rename: mockFs.rename,
  remove: mockFs.remove,
}));

vi.mock("@tauri-apps/api/path", () => ({
  appCacheDir: mockPath.appCacheDir,
  join: mockPath.join,
}));

import { downloadClip } from "../download/clipDownloader";

function makeClip(overrides: Partial<ClipItem> = {}): ClipItem {
  return {
    id: "clip-test-1",
    title: "Test Laugh",
    category: "laughing",
    tags: ["laugh"],
    durationSec: 4,
    width: 640,
    height: 360,
    posterUrl: "https://cdn.example.com/poster.webp",
    previewUrl: "https://cdn.example.com/preview.mp4",
    fileUrl: "https://cdn.example.com/full.mp4",
    sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    bytes: 4,
    hasAudio: true,
    hasAlpha: false,
    license: {
      spdx: "CC0-1.0",
      author: "Test Author",
      sourceUrl: "https://example.com/src",
      releaseOnFile: true,
    },
    ...overrides,
  };
}

function makeStreamResponse(bytes: Uint8Array, status = 200) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { "Content-Length": String(bytes.length) },
  });
}

describe("downloadClip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPath.appCacheDir.mockResolvedValue("/tmp/appcache");
    mockPath.join.mockImplementation(async (...parts: string[]) =>
      parts.join("/"),
    );
    mockFs.exists.mockResolvedValue(false);
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.writeFile.mockResolvedValue(undefined);
    mockFs.rename.mockResolvedValue(undefined);
    mockFs.remove.mockResolvedValue(undefined);
  });

  it("returns cached path without fetching if already cached", async () => {
    mockFs.exists.mockResolvedValue(true);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const onProgress = vi.fn();
    const item = makeClip();

    const result = await downloadClip(
      item,
      new AbortController().signal,
      onProgress,
    );

    expect(result).toBe(`/tmp/appcache/clips/${item.sha256}.mp4`);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onProgress).toHaveBeenCalledWith(100);
    fetchSpy.mockRestore();
  });

  it("downloads, verifies sha256, writes atomically, and returns path", async () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const digestBytes = await crypto.subtle.digest("SHA-256", payload);
    const expectedHash = Array.from(new Uint8Array(digestBytes))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const item = makeClip({ sha256: expectedHash });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(makeStreamResponse(payload));
    const onProgress = vi.fn();

    const result = await downloadClip(
      item,
      new AbortController().signal,
      onProgress,
    );

    expect(result).toBe(`/tmp/appcache/clips/${expectedHash}.mp4`);
    expect(mockFs.writeFile).toHaveBeenCalledTimes(1);
    expect(mockFs.rename).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenLastCalledWith(100);
    fetchSpy.mockRestore();
  });

  it("throws HashMismatchError and does not write on bad sha256", async () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const item = makeClip({ sha256: "0".repeat(64) });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(makeStreamResponse(payload));

    await expect(
      downloadClip(item, new AbortController().signal, vi.fn()),
    ).rejects.toThrow(HashMismatchError);
    expect(mockFs.writeFile).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("throws DownloadAbortedError when signal is aborted", async () => {
    const controller = new AbortController();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => {
        controller.abort();
        throw new DOMException("Aborted", "AbortError");
      });

    await expect(
      downloadClip(makeClip(), controller.signal, vi.fn()),
    ).rejects.toThrow(DownloadAbortedError);
    fetchSpy.mockRestore();
  });

  it("throws DiskFullError and cleans up temp file on ENOSPC", async () => {
    const payload = new Uint8Array([5, 6, 7, 8]);
    const digestBytes = await crypto.subtle.digest("SHA-256", payload);
    const expectedHash = Array.from(new Uint8Array(digestBytes))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const item = makeClip({ sha256: expectedHash });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(makeStreamResponse(payload));
    mockFs.writeFile.mockRejectedValue(new Error("ENOSPC: no space left"));

    await expect(
      downloadClip(item, new AbortController().signal, vi.fn()),
    ).rejects.toThrow(DiskFullError);
    expect(mockFs.remove).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });
});

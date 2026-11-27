import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  HashMismatchError,
  DownloadAbortedError,
  DiskFullError,
  type ClipItem,
} from "../types";

const mockDownloadClip = vi.hoisted(() => vi.fn());

vi.mock("../download/clipDownloader", () => ({
  downloadClip: mockDownloadClip,
}));

import { useClipDownloadStore } from "../store/clipDownloadStore";

function makeClip(id = "clip-1"): ClipItem {
  return {
    id,
    title: "Laughing",
    category: "laughing",
    tags: ["funny"],
    durationSec: 3,
    width: 640,
    height: 360,
    posterUrl: "https://cdn.example.com/poster.webp",
    previewUrl: "https://cdn.example.com/preview.mp4",
    fileUrl: "https://cdn.example.com/full.mp4",
    sha256: "a".repeat(64),
    bytes: 1024,
    hasAudio: true,
    hasAlpha: false,
    license: {
      spdx: "CC0-1.0",
      author: "Tester",
      sourceUrl: "https://example.com",
      releaseOnFile: true,
    },
  };
}

describe("useClipDownloadStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useClipDownloadStore.setState({ downloads: {} });
  });

  it("sets status to ready and stores localPath on success", async () => {
    mockDownloadClip.mockImplementation(async (_item, _sig, onProgress) => {
      onProgress(50);
      return "/cache/clips/clip-1.mp4";
    });

    const item = makeClip();
    const path = await useClipDownloadStore.getState().startDownload(item);

    expect(path).toBe("/cache/clips/clip-1.mp4");
    expect(useClipDownloadStore.getState().isReady(item.id)).toBe(true);
    expect(useClipDownloadStore.getState().getDownloadState(item.id)).toEqual({
      clipId: item.id,
      status: "ready",
      progress: 100,
      localPath: "/cache/clips/clip-1.mp4",
    });
  });

  it("returns cached path immediately if already ready", async () => {
    useClipDownloadStore.getState()._setReady("clip-1", "/cache/clip-1.mp4");
    const path = await useClipDownloadStore
      .getState()
      .startDownload(makeClip("clip-1"));
    expect(path).toBe("/cache/clip-1.mp4");
    expect(mockDownloadClip).not.toHaveBeenCalled();
  });

  it("sets error state on HashMismatchError and DiskFullError", async () => {
    mockDownloadClip.mockRejectedValueOnce(new HashMismatchError("clip-1"));
    await expect(
      useClipDownloadStore.getState().startDownload(makeClip("clip-1")),
    ).rejects.toThrow(HashMismatchError);
    expect(
      useClipDownloadStore.getState().getDownloadState("clip-1")?.status,
    ).toBe("error");

    mockDownloadClip.mockRejectedValueOnce(new DiskFullError("clip-2"));
    await expect(
      useClipDownloadStore.getState().startDownload(makeClip("clip-2")),
    ).rejects.toThrow(DiskFullError);
    expect(
      useClipDownloadStore.getState().getDownloadState("clip-2")?.status,
    ).toBe("error");
  });

  it("cancels in-flight download and removes entry", async () => {
    let rejectDownload!: (err: unknown) => void;
    mockDownloadClip.mockImplementation(
      (_item, signal: AbortSignal) =>
        new Promise<string>((_resolve, reject) => {
          rejectDownload = reject;
          signal.addEventListener("abort", () => {
            reject(new DownloadAbortedError("clip-1"));
          });
        }),
    );

    const promise = useClipDownloadStore
      .getState()
      .startDownload(makeClip("clip-1"));
    expect(
      useClipDownloadStore.getState().getDownloadState("clip-1")?.status,
    ).toBe("downloading");

    useClipDownloadStore.getState().cancelDownload("clip-1");
    await expect(promise).rejects.toThrow(DownloadAbortedError);
    expect(
      useClipDownloadStore.getState().getDownloadState("clip-1"),
    ).toBeUndefined();
    void rejectDownload;
  });

  it("deduplicates concurrent startDownload calls for the same clip", async () => {
    let resolveDownload!: (path: string) => void;
    mockDownloadClip.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveDownload = resolve;
        }),
    );

    const item = makeClip("clip-1");
    const p1 = useClipDownloadStore.getState().startDownload(item);
    const p2 = useClipDownloadStore.getState().startDownload(item);

    expect(mockDownloadClip).toHaveBeenCalledTimes(1);
    resolveDownload("/cache/clip-1.mp4");

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe("/cache/clip-1.mp4");
    expect(r2).toBe("/cache/clip-1.mp4");
  });
});

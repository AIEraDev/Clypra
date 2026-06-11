/**
 * Tauri IPC Bridge Tests
 *
 * Tests the communication layer between frontend and Rust backend.
 * Covers: normalizePathForTauriInvoke, decodeFrame, decodeFramesStreaming,
 *         releaseVideoDecoder — the current tauri.ts API.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke, Channel } from "@tauri-apps/api/core";
import { normalizePathForTauriInvoke, decodeFrame, decodeFramesStreaming, releaseVideoDecoder } from "../tauri";
import { DensityLevel } from "@/types";

// Stub Tauri internals globally for this test suite
Object.defineProperty(window, "__TAURI_INTERNALS__", {
  value: {},
  writable: true,
  configurable: true,
});

// ─── Mocks ────────────────────────────────────────────────────────────────────

// vi.mock factories are hoisted — define the Channel class via vi.hoisted() so
// it is available inside the factory.
const { MockChannelClass } = vi.hoisted(() => {
  class MockChannelClass {
    onmessage: ((msg: unknown) => void) | null = null;
  }
  return { MockChannelClass };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: MockChannelClass,
}));

// ─── normalizePathForTauriInvoke ──────────────────────────────────────────────

describe("normalizePathForTauriInvoke", () => {
  it("returns non-file:// paths unchanged", () => {
    expect(normalizePathForTauriInvoke("/home/user/video.mp4")).toBe("/home/user/video.mp4");
    expect(normalizePathForTauriInvoke("C:\\Users\\video.mp4")).toBe("C:\\Users\\video.mp4");
    expect(normalizePathForTauriInvoke("")).toBe("");
  });

  it("strips file:// prefix on Unix paths", () => {
    expect(normalizePathForTauriInvoke("file:///home/user/video.mp4")).toBe("/home/user/video.mp4");
  });

  it("strips file:// prefix on Windows paths", () => {
    expect(normalizePathForTauriInvoke("file:///C:/Users/user/video.mp4")).toBe("C:/Users/user/video.mp4");
  });

  it("decodes percent-encoded characters", () => {
    expect(normalizePathForTauriInvoke("file:///home/user/my%20video.mp4")).toBe("/home/user/my video.mp4");
    expect(normalizePathForTauriInvoke("file:///home/user/caf%C3%A9.mp4")).toBe("/home/user/café.mp4");
  });

  it("trims leading/trailing whitespace before processing", () => {
    expect(normalizePathForTauriInvoke("  /home/user/video.mp4  ")).toBe("/home/user/video.mp4");
    expect(normalizePathForTauriInvoke("  file:///home/video.mp4  ")).toBe("/home/video.mp4");
  });

  it("handles asset:// URLs (normalizes to native path)", () => {
    const url = "asset://localhost/test/video.mp4";
    expect(normalizePathForTauriInvoke(url)).toBe("/test/video.mp4");
  });

  it("handles asset:// URLs with encoded slashes on macOS/Linux", () => {
    const url = "asset://localhost/%2Ftest%2Fvideo.mp4";
    expect(normalizePathForTauriInvoke(url)).toBe("/test/video.mp4");
  });

  it("handles http://asset.localhost/ and https://asset.localhost/ URLs under Tauri v2", () => {
    const macUrl = "http://asset.localhost/%2Ftest%2Fvideo.mp4";
    expect(normalizePathForTauriInvoke(macUrl)).toBe("/test/video.mp4");

    const winUrl = "https://asset.localhost/C%3A%5CUsers%5Ctest%5Cvideo.mp4";
    expect(normalizePathForTauriInvoke(winUrl)).toBe("C:\\Users\\test\\video.mp4");

    const winUrlForward = "https://asset.localhost/C%3A/Users/test/video.mp4";
    expect(normalizePathForTauriInvoke(winUrlForward)).toBe("C:/Users/test/video.mp4");
  });
});

// ─── decodeFrame ─────────────────────────────────────────────────────────────

describe("decodeFrame", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("calls decode_frame with normalized path", async () => {
    const mockDataUrl = "data:image/webp;base64,abc=";
    vi.mocked(invoke).mockResolvedValueOnce(mockDataUrl);

    const result = await decodeFrame("/test/video.mp4", 5.0, 1920, 1080);

    expect(invoke).toHaveBeenCalledWith("decode_frame", {
      videoPath: "/test/video.mp4",
      timeSecs: 5.0,
      width: 1920,
      height: 1080,
    });
    expect(result).toBe(mockDataUrl);
  });

  it("normalizes file:// URLs before invoking", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("data:image/webp;base64,x=");
    await decodeFrame("file:///Users/test/clip.mov", 1.0, 320, 180);

    expect(invoke).toHaveBeenCalledWith(
      "decode_frame",
      expect.objectContaining({
        videoPath: "/Users/test/clip.mov",
      }),
    );
  });

  it("propagates Rust errors as thrown exceptions", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("FFmpeg not found"));
    await expect(decodeFrame("/test/video.mp4", 1.0, 1920, 1080)).rejects.toThrow("FFmpeg not found");
  });

  it("propagates file not found errors", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("No such file or directory"));
    await expect(decodeFrame("/nonexistent.mp4", 1.0, 1920, 1080)).rejects.toThrow("No such file");
  });

  it("propagates codec errors", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Unknown decoder 'hevc'"));
    await expect(decodeFrame("/test/hevc.mp4", 1.0, 1920, 1080)).rejects.toThrow("Unknown decoder");
  });

  it("handles concurrent decode calls independently", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("data:image/webp;base64,first=").mockResolvedValueOnce("data:image/webp;base64,second=");

    const [r1, r2] = await Promise.all([decodeFrame("/test/v1.mp4", 1.0, 1920, 1080), decodeFrame("/test/v2.mp4", 2.0, 1920, 1080)]);

    expect(r1).toBe("data:image/webp;base64,first=");
    expect(r2).toBe("data:image/webp;base64,second=");
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("handles boundary time values", async () => {
    const times = [0, 0.033, 1, 59.94, 3600];
    for (const t of times) {
      vi.mocked(invoke).mockResolvedValueOnce("data:image/webp;base64,x=");
      await decodeFrame("/test/video.mp4", t, 1920, 1080);
      expect(invoke).toHaveBeenCalledWith("decode_frame", expect.objectContaining({ timeSecs: t }));
      vi.clearAllMocks();
    }
  });

  it("handles never-resolving invoke (custom timeout)", async () => {
    vi.mocked(invoke).mockImplementationOnce(() => new Promise(() => {}));
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Custom timeout")), 100));
    await expect(Promise.race([decodeFrame("/test/video.mp4", 1.0, 1920, 1080), timeout])).rejects.toThrow("Custom timeout");
  });

  it("handles slow invoke response", async () => {
    vi.mocked(invoke).mockImplementationOnce(() => new Promise((r) => setTimeout(() => r("data:image/webp;base64,slow="), 50)));
    const result = await decodeFrame("/test/video.mp4", 1.0, 1920, 1080);
    expect(result).toBe("data:image/webp;base64,slow=");
  });

  // Parameter type tests — test runtime pass-through
  it("handles string where number expected for timeSecs", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Invalid type"));
    await expect(decodeFrame("/test/video.mp4", "not-a-number" as unknown as number, 1920, 1080)).rejects.toThrow();
  });

  it("handles number where string expected for path", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Invalid type"));
    await expect(decodeFrame(12345 as unknown as string, 1.0, 1920, 1080)).rejects.toThrow();
  });

  it("handles boolean where number expected for timeSecs", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Invalid type"));
    await expect(decodeFrame("/test/video.mp4", true as unknown as number, 1920, 1080)).rejects.toThrow();
  });
});

// ─── decodeFramesStreaming ────────────────────────────────────────────────────

describe("decodeFramesStreaming", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockReset(); // clear queued once-values from previous tests
  });
  afterEach(() => vi.restoreAllMocks());

  it("calls decode_frames_streaming with a Channel", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    const onTile = vi.fn();

    await decodeFramesStreaming("/test/video.mp4", [1.0, 2.0], DensityLevel.Medium, 120, 68, 10, onTile);

    expect(invoke).toHaveBeenCalledWith(
      "decode_frames_streaming",
      expect.objectContaining({
        videoPath: "/test/video.mp4",
        timestamps: [1.0, 2.0],
        density: "medium",
        width: 120,
        height: 68,
        duration: 10,
      }),
    );
    // Channel is passed as onTile argument
    expect(invoke).toHaveBeenCalledWith(
      "decode_frames_streaming",
      expect.objectContaining({
        onTile: expect.any(Object),
      }),
    );
  });

  it("normalizes file:// URLs before invoking", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await decodeFramesStreaming("file:///Users/test/clip.mov", [1.0], DensityLevel.Low, 80, 45, 5, vi.fn());
    expect(invoke).toHaveBeenCalledWith(
      "decode_frames_streaming",
      expect.objectContaining({
        videoPath: "/Users/test/clip.mov",
      }),
    );
  });

  it("propagates errors from invoke", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Decoder error"));
    await expect(decodeFramesStreaming("/test/video.mp4", [1.0], DensityLevel.Low, 80, 45, 5, vi.fn())).rejects.toThrow("Decoder error");
  });

  it("resolves on successful streaming completion", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await expect(decodeFramesStreaming("/test/video.mp4", [], DensityLevel.Low, 80, 45, 5, vi.fn())).resolves.toBeUndefined();
  });
});

// ─── releaseVideoDecoder ──────────────────────────────────────────────────────

describe("releaseVideoDecoder", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("calls release_video_decoder with normalized path", () => {
    releaseVideoDecoder("/test/video.mp4");
    expect(invoke).toHaveBeenCalledWith("release_video_decoder", {
      videoPath: "/test/video.mp4",
    });
  });

  it("normalizes file:// URLs before invoking", () => {
    releaseVideoDecoder("file:///Users/test/clip.mov");
    expect(invoke).toHaveBeenCalledWith("release_video_decoder", {
      videoPath: "/Users/test/clip.mov",
    });
  });

  it("is fire-and-forget — does not return a promise", () => {
    const result = releaseVideoDecoder("/test/video.mp4");
    expect(result).toBeUndefined();
  });
});

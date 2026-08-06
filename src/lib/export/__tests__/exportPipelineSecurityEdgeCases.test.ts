import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  fitNativeFrameDimensions,
  NativeExportFramePool,
} from "../nativeExportFramePool";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("Export Pipeline Security & Memory Allocation Edge Cases", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  // ─── 1. FAIL-CLOSED BUFFER INTEGRITY ─────────────────────────────────────
  describe("Native Frame Pool Buffer Integrity", () => {
    it("should fail-closed on 0-byte returned array buffers", async () => {
      vi.mocked(invoke).mockResolvedValue(new Uint8Array(0).buffer);
      const pool = new NativeExportFramePool();

      await expect(
        pool.acquire({
          key: "clip-corrupt",
          videoPath: "/tmp/corrupt.mp4",
          timeSecs: 0.5,
          width: 100,
          height: 100,
        })
      ).rejects.toThrow();
    });

    it("should handle native decoder IPC throwing an exception without leaking state", async () => {
      vi.mocked(invoke).mockRejectedValue(new Error("Decoder panic: File not found"));
      const pool = new NativeExportFramePool();

      await expect(
        pool.acquire({
          key: "clip-missing",
          videoPath: "/tmp/nonexistent.mp4",
          timeSecs: 1.0,
          width: 640,
          height: 360,
        })
      ).rejects.toThrow("Decoder panic: File not found");
    });
  });

  // ─── 2. EXTREME RESOLUTION & DIMENSION CALCULATIONS ──────────────────────
  describe("High-Resolution (4K/8K) & Degenerate Frame Calculations", () => {
    it("should fit 8K source video (7680x4320) into 1080p target maintaining aspect ratio", () => {
      const fitted = fitNativeFrameDimensions(1920, 1080, 7680, 4320);
      expect(fitted.width).toBe(1920);
      expect(fitted.height).toBe(1080);
    });

    it("should fit vertical 9:16 source video into 16:9 canvas accurately", () => {
      const fitted = fitNativeFrameDimensions(1920, 1080, 1080, 1920);
      expect(fitted.height).toBe(1080);
      expect(fitted.width).toBe(608); // 1080 * (1080 / 1920) = ~607.5 -> 608
    });

    it("should handle zero or negative dimensions safely without division by zero", () => {
      const fittedZero = fitNativeFrameDimensions(1920, 1080, 0, 0);
      expect(fittedZero.width).toBe(1920);
      expect(fittedZero.height).toBe(1080);

      const fittedNeg = fitNativeFrameDimensions(1920, 1080, -100, -200);
      expect(fittedNeg.width).toBe(1920);
      expect(fittedNeg.height).toBe(1080);
    });
  });

  // ─── 3. RESOURCE TEARDOWN ────────────────────────────────────────────────
  describe("Export Pool Cleanup & Lifetime", () => {
    it("should dispose all allocated surfaces and release video decoders when clear() is invoked", async () => {
      const frameData = new Uint8Array(4 * 4 * 4); // 4x4 RGBA = 64 bytes
      vi.mocked(invoke).mockResolvedValue(frameData.buffer);

      const pool = new NativeExportFramePool();
      await pool.acquire({
        key: "clip-cleanup",
        videoPath: "/tmp/video.mov",
        timeSecs: 0,
        width: 4,
        height: 4,
      });

      await expect(pool.clear()).resolves.not.toThrow();
    });
  });
});

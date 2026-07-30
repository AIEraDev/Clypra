import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  fitNativeFrameDimensions,
  NativeExportFramePool,
} from "../nativeExportFramePool";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("NativeExportFramePool", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("decodes through binary native IPC and reuses the clip canvas", async () => {
    const frame = new Uint8Array(2 * 2 * 4);
    vi.mocked(invoke).mockResolvedValue(frame.buffer);

    const pool = new NativeExportFramePool();
    const request = {
      key: "clip-1-asset-1",
      videoPath: "/tmp/video.mov",
      timeSecs: 1.25,
      width: 2,
      height: 2,
    };

    const first = await pool.acquire(request);
    const second = await pool.acquire({ ...request, timeSecs: 1.5 });

    expect(second).toBe(first);
    expect(invoke).toHaveBeenNthCalledWith(1, "decode_export_frame", {
      videoPath: "/tmp/video.mov",
      timeSecs: 1.25,
      width: 2,
      height: 2,
    });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("fails closed if the native decoder returns the wrong frame size", async () => {
    vi.mocked(invoke).mockResolvedValue(new Uint8Array(3).buffer);
    const pool = new NativeExportFramePool();

    await expect(
      pool.acquire({
        key: "clip-1-asset-1",
        videoPath: "/tmp/video.mov",
        timeSecs: 1,
        width: 2,
        height: 2,
      }),
    ).rejects.toThrow("expected 16 bytes, got 3");
  });
});

describe("fitNativeFrameDimensions", () => {
  it("fits a source into the render bounds without changing its aspect ratio", () => {
    expect(fitNativeFrameDimensions(1280, 720, 3024, 1964)).toEqual({
      width: 1109,
      height: 720,
    });
  });

  it("uses the render bounds when source dimensions are unavailable", () => {
    expect(fitNativeFrameDimensions(1280.4, 719.6)).toEqual({
      width: 1280,
      height: 720,
    });
  });
});

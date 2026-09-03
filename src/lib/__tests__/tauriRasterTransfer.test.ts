import { describe, expect, it, vi } from "vitest";
import { registerNativeRasterAsset } from "../platform/tauri";

describe("registerNativeRasterAsset high-performance transfer", () => {
  it("encodes Uint8ClampedArray to base64 instead of allocating number array", async () => {
    let capturedPayload: any = null;
    (window as any).__TAURI_INTERNALS__ = {
      invoke: vi.fn().mockImplementation((cmd, args) => {
        if (cmd === "register_native_raster_asset") {
          capturedPayload = args.asset;
        }
        return Promise.resolve();
      }),
    };

    const width = 100;
    const height = 100;
    const buffer = new Uint8ClampedArray(width * height * 4);
    // Fill with known pattern
    for (let i = 0; i < buffer.length; i++) {
      buffer[i] = i % 256;
    }

    await registerNativeRasterAsset({
      assetId: "test-raster-1",
      width,
      height,
      rgba: buffer,
      x: 0,
      y: 0,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      blendMode: "normal",
      isText: false,
    });

    expect(capturedPayload).not.toBeNull();
    expect(capturedPayload.assetId).toBe("test-raster-1");
    expect(capturedPayload.width).toBe(100);
    expect(capturedPayload.height).toBe(100);
    expect(capturedPayload.rgbaBase64).toBeDefined();
    expect(typeof capturedPayload.rgbaBase64).toBe("string");
    expect(capturedPayload.rgba).toBeUndefined();

    // Verify round-trip decoding
    const decodedBinary = atob(capturedPayload.rgbaBase64);
    expect(decodedBinary.length).toBe(buffer.length);
    for (let i = 0; i < 1000; i++) {
      expect(decodedBinary.charCodeAt(i)).toBe(buffer[i]);
    }
  });

  it("preserves number[] fallback for legacy callers", async () => {
    let capturedPayload: any = null;
    (window as any).__TAURI_INTERNALS__ = {
      invoke: vi.fn().mockImplementation((cmd, args) => {
        if (cmd === "register_native_raster_asset") {
          capturedPayload = args.asset;
        }
        return Promise.resolve();
      }),
    };

    await registerNativeRasterAsset({
      assetId: "test-legacy",
      width: 2,
      height: 2,
      rgba: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
      x: 0,
      y: 0,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      blendMode: "normal",
      isText: false,
    });

    expect(capturedPayload.rgba).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    expect(capturedPayload.rgbaBase64).toBeUndefined();
  });
});

import { describe, expect, it, vi } from "vitest";
import { registerNativeRasterAsset } from "../platform/tauri";

describe("registerNativeRasterAsset high-performance transfer", () => {
  it("sends raw binary buffer directly to register_native_raster_asset_raw with headers", async () => {
    let capturedCmd: string | null = null;
    let capturedBuffer: any = null;
    let capturedOptions: any = null;

    (window as any).__TAURI_INTERNALS__ = {
      invoke: vi.fn().mockImplementation((cmd, buffer, options) => {
        capturedCmd = cmd;
        capturedBuffer = buffer;
        capturedOptions = options;
        return Promise.resolve();
      }),
    };

    const width = 100;
    const height = 100;
    const buffer = new Uint8ClampedArray(width * height * 4);
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

    expect(capturedCmd).toBe("register_native_raster_asset_raw");
    expect(capturedBuffer).toBeInstanceOf(ArrayBuffer);
    expect(capturedBuffer.byteLength).toBe(width * height * 4);
    expect(capturedOptions?.headers).toEqual({
      "asset-id": "test-raster-1",
      width: "100",
      height: "100",
    });
  });

  it("falls back to base64 encoding if register_native_raster_asset_raw fails", async () => {
    let capturedBase64Payload: any = null;

    (window as any).__TAURI_INTERNALS__ = {
      invoke: vi.fn().mockImplementation((cmd, args) => {
        if (cmd === "register_native_raster_asset_raw") {
          return Promise.reject(new Error("Command not found"));
        }
        if (cmd === "register_native_raster_asset") {
          capturedBase64Payload = args.asset;
          return Promise.resolve();
        }
        return Promise.resolve();
      }),
    };

    const width = 10;
    const height = 10;
    const buffer = new Uint8ClampedArray(width * height * 4);

    await registerNativeRasterAsset({
      assetId: "test-fallback",
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

    expect(capturedBase64Payload).not.toBeNull();
    expect(capturedBase64Payload.assetId).toBe("test-fallback");
    expect(capturedBase64Payload.rgbaBase64).toBeDefined();
    expect(typeof capturedBase64Payload.rgbaBase64).toBe("string");
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


import { describe, expect, it, vi } from "vitest";
import {
  rasterizeNativeEditorOverlay,
  NativeEditorOverlayManager,
} from "../nativeEditorOverlay";
import type { Clip } from "@/types";

describe("nativeEditorOverlay", () => {
  const mockClip: Clip = {
    id: "clip-1",
    trackId: "track-1",
    mediaId: "media-1",
    startTime: 0,
    duration: 5,
    trimIn: 0,
    trimOut: 5,
    x: 100,
    y: 150,
    width: 640,
    height: 360,
    rotation: 15,
    opacity: 1,
  };

  it("returns null when no overlay elements need rendering", () => {
    const result = rasterizeNativeEditorOverlay({
      canvasWidth: 1920,
      canvasHeight: 1080,
      selectedClips: [],
      safeOverlayVisible: false,
    });
    expect(result).toBeNull();
  });

  it("returns null for non-positive canvas dimensions", () => {
    const result = rasterizeNativeEditorOverlay({
      canvasWidth: 0,
      canvasHeight: 0,
      selectedClips: [mockClip],
      safeOverlayVisible: true,
    });
    expect(result).toBeNull();
  });

  it("rasterizes safe margins into a topmost native layer snapshot", () => {
    const result = rasterizeNativeEditorOverlay({
      canvasWidth: 1920,
      canvasHeight: 1080,
      selectedClips: [],
      safeOverlayVisible: true,
    });
    expect(result).not.toBeNull();
    expect(result?.layerId).toBe("native-editor-overlay");
    expect(result?.width).toBe(1920);
    expect(result?.height).toBe(1080);
    expect(result?.zIndex).toBe(10000);
    expect(result?.rgba).toBeDefined();
    expect(result?.rgba?.length).toBe(1920 * 1080 * 4);
  });

  it("rasterizes transform controls for selected clips", () => {
    const result = rasterizeNativeEditorOverlay({
      canvasWidth: 1920,
      canvasHeight: 1080,
      selectedClips: [mockClip],
      safeOverlayVisible: false,
      currentTime: 2,
    });
    expect(result).not.toBeNull();
    expect(result?.assetId).toContain("clip-1");
    expect(result?.assetId).toContain("100:150:640:360:15");
    expect(result?.zIndex).toBe(10000);
    expect(result?.rgba?.length).toBe(1920 * 1080 * 4);
  });

  it("excludes selected clips that are not active at currentTime to prevent cross-generation bleed", () => {
    // mockClip has startTime: 0, duration: 5 (active in [0, 5))
    // When currentTime is 6 (outside active range), rasterizeNativeEditorOverlay should return null
    const result = rasterizeNativeEditorOverlay({
      canvasWidth: 1920,
      canvasHeight: 1080,
      selectedClips: [mockClip],
      safeOverlayVisible: false,
      currentTime: 6,
    });
    expect(result).toBeNull();
  });

  it("combines selected clips and safe margins into a single unified overlay", () => {
    const result = rasterizeNativeEditorOverlay({
      canvasWidth: 1280,
      canvasHeight: 720,
      selectedClips: [mockClip],
      safeOverlayVisible: true,
    });
    expect(result).not.toBeNull();
    expect(result?.width).toBe(1280);
    expect(result?.height).toBe(720);
    expect(result?.assetId).toContain("1280x720:true");
  });

  it("rasterizes horizontal and vertical alignment guides and rotation badge", () => {
    const result = rasterizeNativeEditorOverlay({
      canvasWidth: 1920,
      canvasHeight: 1080,
      selectedClips: [mockClip],
      safeOverlayVisible: false,
      activeGuides: {
        snappedX: true,
        snappedY: true,
        snappedLeft: false,
        snappedRight: false,
        snappedTop: false,
        snappedBottom: false,
        snapGuideX: 960,
        snapGuideY: 540,
        rotationDegrees: 45,
      },
    });
    expect(result).not.toBeNull();
    expect(result?.assetId).toContain("true:true");
    expect(result?.assetId).toContain("960:540:45");
    expect(result?.rgba?.length).toBe(1920 * 1080 * 4);
  });

  describe("NativeEditorOverlayManager", () => {
    it("registers overlay asset with Rust and caches subsequent frames with same geometry", async () => {
      const mockRegister = vi.fn().mockResolvedValue(undefined);
      const mockUnregister = vi.fn().mockResolvedValue(undefined);
      const manager = new NativeEditorOverlayManager({
        registerRasterAsset: mockRegister,
        unregisterRasterAsset: mockUnregister,
        isTauriRuntime: () => true,
      });

      const params = {
        canvasWidth: 1920,
        canvasHeight: 1080,
        selectedClips: [mockClip],
        safeOverlayVisible: false,
      };

      const firstSnapshot = await manager.getOrRegisterOverlay(params);
      expect(firstSnapshot).not.toBeNull();
      expect(mockRegister).toHaveBeenCalledTimes(1);
      expect(firstSnapshot?.rgba).toBeUndefined(); // raw rgba discarded in JS memory
      expect(firstSnapshot?.layerId).toBe("native-editor-overlay");

      // Second call with same geometry must NOT re-upload over IPC
      const secondSnapshot = await manager.getOrRegisterOverlay(params);
      expect(secondSnapshot).toBe(firstSnapshot);
      expect(mockRegister).toHaveBeenCalledTimes(1);
    });

    it("uploads new asset and queues eviction of previous asset when geometry changes", async () => {
      const mockRegister = vi.fn().mockResolvedValue(undefined);
      const mockUnregister = vi.fn().mockResolvedValue(undefined);
      const manager = new NativeEditorOverlayManager({
        registerRasterAsset: mockRegister,
        unregisterRasterAsset: mockUnregister,
        isTauriRuntime: () => true,
      });

      const snapshot1 = await manager.getOrRegisterOverlay({
        canvasWidth: 1920,
        canvasHeight: 1080,
        selectedClips: [mockClip],
        safeOverlayVisible: false,
      });

      const snapshot2 = await manager.getOrRegisterOverlay({
        canvasWidth: 1920,
        canvasHeight: 1080,
        selectedClips: [{ ...mockClip, x: 250 }], // moved clip
        safeOverlayVisible: false,
      });

      expect(mockRegister).toHaveBeenCalledTimes(2);
      expect(mockUnregister).toHaveBeenCalledWith(snapshot1?.assetId);
      expect(snapshot2?.assetId).not.toBe(snapshot1?.assetId);
    });

    it("evicts asset when selection is cleared", async () => {
      const mockRegister = vi.fn().mockResolvedValue(undefined);
      const mockUnregister = vi.fn().mockResolvedValue(undefined);
      const manager = new NativeEditorOverlayManager({
        registerRasterAsset: mockRegister,
        unregisterRasterAsset: mockUnregister,
        isTauriRuntime: () => true,
      });

      const snapshot = await manager.getOrRegisterOverlay({
        canvasWidth: 1920,
        canvasHeight: 1080,
        selectedClips: [mockClip],
        safeOverlayVisible: false,
      });

      expect(mockRegister).toHaveBeenCalledTimes(1);

      const cleared = await manager.getOrRegisterOverlay({
        canvasWidth: 1920,
        canvasHeight: 1080,
        selectedClips: [],
        safeOverlayVisible: false,
      });

      expect(cleared).toBeNull();
      expect(mockUnregister).toHaveBeenCalledWith(snapshot?.assetId);
    });

    it("preserves full project canvas dimensions in displayWidth/displayHeight to prevent double-downscaling", async () => {
      const mockRegister = vi.fn().mockResolvedValue(undefined);
      const manager = new NativeEditorOverlayManager({
        registerRasterAsset: mockRegister,
        unregisterRasterAsset: vi.fn().mockResolvedValue(undefined),
        isTauriRuntime: () => true,
      });

      const snapshot = await manager.getOrRegisterOverlay({
        canvasWidth: 1920,
        canvasHeight: 1080,
        previewScale: 0.5,
        selectedClips: [mockClip],
        safeOverlayVisible: false,
      });

      expect(snapshot).not.toBeNull();
      expect(snapshot?.width).toBe(1920);
      expect(snapshot?.height).toBe(1080);
      expect(snapshot?.displayWidth).toBe(1920);
      expect(snapshot?.displayHeight).toBe(1080);
    });
  });
});

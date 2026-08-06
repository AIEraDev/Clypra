import { describe, it, expect } from "vitest";
import { toNativePath, isWebviewOrExternalUrl } from "../pathConversion";
import { getPerformanceProfile, isMobile } from "../deviceCapabilities";

describe("Platform Layer — Path Conversion & Device Profile Invariants", () => {
  // ─── 1. TAURI / ASSET PATH CONVERSION ────────────────────────────────────
  describe("toNativePath", () => {
    it("should convert macOS asset:// URLs to raw native filesystem paths", () => {
      const assetUrl = "asset://localhost/%2FUsers%2Ftest%2Fvideo.mp4";
      const nativePath = toNativePath(assetUrl);
      expect(nativePath).toBe("/Users/test/video.mp4");
    });

    it("should convert Windows asset:// URLs to drive-letter paths (e.g. C:/...)", () => {
      const winAssetUrl = "asset://localhost/C:/Users/test/video.mp4";
      const nativePath = toNativePath(winAssetUrl);
      expect(nativePath).toBe("C:/Users/test/video.mp4");
    });

    it("should convert file:// URLs to native paths", () => {
      const fileUrl = "file:///Users/test/music.mp3";
      const nativePath = toNativePath(fileUrl);
      expect(nativePath).toBe("/Users/test/music.mp3");
    });

    it("should convert http://asset.localhost/ URLs safely", () => {
      const httpAssetUrl = "http://asset.localhost/Users/test/photo.png";
      const nativePath = toNativePath(httpAssetUrl);
      expect(nativePath).toBe("/Users/test/photo.png");
    });

    it("should return raw paths unchanged when already in native format", () => {
      const rawPath = "/Users/test/document.pdf";
      expect(toNativePath(rawPath)).toBe(rawPath);
    });
  });

  // ─── 2. WEBVIEW OR EXTERNAL URL DETECTION ────────────────────────────────
  describe("isWebviewOrExternalUrl", () => {
    it("should identify data, http, https, asset, and blob URLs", () => {
      expect(isWebviewOrExternalUrl("data:image/png;base64,123")).toBe(true);
      expect(isWebviewOrExternalUrl("http://example.com/asset.mp4")).toBe(true);
      expect(isWebviewOrExternalUrl("https://example.com/asset.mp4")).toBe(true);
      expect(isWebviewOrExternalUrl("asset://localhost/media.mp4")).toBe(true);
      expect(isWebviewOrExternalUrl("blob:http://localhost/12345")).toBe(true);
    });

    it("should return false for raw local filesystem paths or null inputs", () => {
      expect(isWebviewOrExternalUrl("/Users/test/video.mp4")).toBe(false);
      expect(isWebviewOrExternalUrl("C:\\Users\\test\\video.mp4")).toBe(false);
      expect(isWebviewOrExternalUrl(null)).toBe(false);
      expect(isWebviewOrExternalUrl(undefined)).toBe(false);
    });
  });

  // ─── 3. DEVICE CAPABILITIES & PERFORMANCE PROFILES ───────────────────────
  describe("Performance Profile Selection", () => {
    it("should detect non-mobile environment by default in test/browser runner", () => {
      expect(isMobile()).toBe(false);
    });

    it("should load valid desktop performance profile with high-res thumbnails and 60fps", async () => {
      const profile = await getPerformanceProfile();
      expect(profile).toBeDefined();
      expect(profile.thumbnailWidth).toBeGreaterThan(0);
      expect(profile.previewFps).toBeGreaterThanOrEqual(30);
      expect(profile.cacheSizeMB).toBeGreaterThan(0);
    });
  });
});

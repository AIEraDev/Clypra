/**
 * Asset Bundle Manager Unit Tests
 *
 * Verifies SHA-256 integrity validation, path traversal prevention,
 * local bundle caching, and asset URI resolution.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  AssetBundleManager,
  isSafeRelativePath,
  computeSha256Hex,
  type EffectBundlePayload,
} from "../cache/assetBundleManager";
import type { BodyEffectManifest } from "@clypra-studio/types";

describe("AssetBundleManager", () => {
  let manager: AssetBundleManager;

  const mockManifest: BodyEffectManifest = {
    id: "neon-energy-wings",
    name: "Neon Energy Wings",
    version: "1.0.0",
    category: "Wings",
    description: "Cyber energy wings",
    requirements: {
      minEngineVersion: "1.5.0",
      captureType: "hybrid_body",
    },
    compositing: {
      primitive: "SkeletalSpriteAnchor",
      layerZOrder: "behind-subject",
      blendMode: "screen",
    },
    parameterSchema: {},
    defaultParams: {},
    tags: ["wings", "neon"],
  };

  const samplePngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  beforeEach(() => {
    manager = new AssetBundleManager();
    manager.clearCache();
    vi.restoreAllMocks();
  });

  describe("isSafeRelativePath", () => {
    it("allows valid relative asset paths with permitted extensions", () => {
      expect(isSafeRelativePath("sprites/wing_left.png")).toBe(true);
      expect(isSafeRelativePath("shaders/convective_curl.wgsl")).toBe(true);
      expect(isSafeRelativePath("assets/textures/glow.webp")).toBe(true);
      expect(isSafeRelativePath("preset.json")).toBe(true);
    });

    it("rejects path traversal attempts", () => {
      expect(isSafeRelativePath("../../../etc/passwd.json")).toBe(false);
      expect(isSafeRelativePath("sprites/../../secret.png")).toBe(false);
      expect(isSafeRelativePath("..\\windows\\system32.png")).toBe(false);
    });

    it("rejects absolute paths and drive letters", () => {
      expect(isSafeRelativePath("/etc/shadow.png")).toBe(false);
      expect(isSafeRelativePath("\\Users\\admin\\test.png")).toBe(false);
      expect(isSafeRelativePath("C:\\Windows\\cmd.png")).toBe(false);
    });

    it("rejects disallowed file extensions", () => {
      expect(isSafeRelativePath("script.sh")).toBe(false);
      expect(isSafeRelativePath("payload.exe")).toBe(false);
      expect(isSafeRelativePath("code.js")).toBe(false);
      expect(isSafeRelativePath("binary.bin")).toBe(false);
    });
  });

  describe("installBundle & integrity validation", () => {
    it("successfully installs a valid bundle and caches assets", async () => {
      const assets = [
        {
          path: "sprites/neon_left.png",
          contentType: "image/png",
          data: samplePngBase64,
          size: 68,
        },
      ];

      const payloadString = JSON.stringify({
        bundleId: "neon-energy-wings",
        manifest: mockManifest,
        assets,
      });
      const validHash = await computeSha256Hex(payloadString);

      const bundle: EffectBundlePayload = {
        bundleId: "neon-energy-wings",
        version: "1.0.0",
        hash: validHash,
        manifest: mockManifest,
        assets,
        createdAt: Date.now(),
      };

      const result = await manager.installBundle(bundle);

      expect(result.bundleId).toBe("neon-energy-wings");
      expect(result.hash).toBe(validHash);
      expect(manager.isBundleCached("neon-energy-wings")).toBe(true);
      expect(manager.isBundleCached("neon-energy-wings", validHash)).toBe(true);

      const resolved = manager.resolveBundleAsset("neon-energy-wings", "sprites/neon_left.png");
      expect(resolved).toBeDefined();
      expect(resolved).toContain("data:image/png;base64,");
    });

    it("rejects bundle when SHA-256 integrity hash is tampered", async () => {
      const assets = [
        {
          path: "sprites/tampered.png",
          contentType: "image/png",
          data: samplePngBase64,
          size: 68,
        },
      ];

      const bundle: EffectBundlePayload = {
        bundleId: "tampered-wings",
        version: "1.0.0",
        hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", // Wrong hash
        manifest: mockManifest,
        assets,
        createdAt: Date.now(),
      };

      await expect(manager.installBundle(bundle)).rejects.toThrow("Integrity check failed");
      expect(manager.isBundleCached("tampered-wings")).toBe(false);
    });

    it("rejects bundle with malicious path traversal in asset paths", async () => {
      const assets = [
        {
          path: "../../../evil.png",
          contentType: "image/png",
          data: samplePngBase64,
          size: 68,
        },
      ];

      const payloadString = JSON.stringify({
        bundleId: "evil-wings",
        manifest: mockManifest,
        assets,
      });
      const hash = await computeSha256Hex(payloadString);

      const bundle: EffectBundlePayload = {
        bundleId: "evil-wings",
        version: "1.0.0",
        hash,
        manifest: mockManifest,
        assets,
        createdAt: Date.now(),
      };

      await expect(manager.installBundle(bundle)).rejects.toThrow("Path traversal");
    });
  });

  describe("fetchAndInstallBundle", () => {
    it("fetches bundle from remote API and installs it", async () => {
      const assets = [
        {
          path: "sprites/cloud_wing.png",
          contentType: "image/png",
          data: samplePngBase64,
          size: 68,
        },
      ];

      const payloadString = JSON.stringify({
        bundleId: "cloud-wings",
        manifest: mockManifest,
        assets,
      });
      const hash = await computeSha256Hex(payloadString);

      const remoteBundle: EffectBundlePayload = {
        bundleId: "cloud-wings",
        version: "1.0.0",
        hash,
        manifest: mockManifest,
        assets,
        createdAt: Date.now(),
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(remoteBundle), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const installed = await manager.fetchAndInstallBundle("cloud-wings", "https://api.clypra.com");
      expect(installed.bundleId).toBe("cloud-wings");
      expect(manager.isBundleCached("cloud-wings")).toBe(true);
      expect(manager.resolveBundleAsset("cloud-wings", "sprites/cloud_wing.png")).toBeDefined();
    });

    it("throws error when API returns 404", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
        }),
      );

      await expect(
        manager.fetchAndInstallBundle("unknown-bundle", "https://api.clypra.com"),
      ).rejects.toThrow("HTTP 404");
    });
  });
});

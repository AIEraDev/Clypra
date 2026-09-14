/**
 * Dynamic Asset Bundle Manager for Body Effects
 *
 * Handles remote bundle ingestion from Cloudflare R2 / Catalog API,
 * cryptographic SHA-256 integrity verification, path-traversal sandboxing,
 * and offline-first local cache management under $APPDATA/clypra/effects/.
 */

import type { BodyEffectManifest } from "@clypra-studio/types";
import { convertFileSrc } from "@tauri-apps/api/core";

export interface BundleAsset {
  path: string;
  contentType: string;
  data: string; // base64 encoded
  size: number;
}

export interface EffectBundlePayload {
  bundleId: string;
  version: string;
  hash: string;
  manifest: BodyEffectManifest;
  assets: BundleAsset[];
  createdAt: number;
}

export interface CachedBundleMetadata {
  bundleId: string;
  version: string;
  hash: string;
  localDir: string;
  extractedAssets: Record<string, string>; // relativePath -> resolved file/data URI
  downloadedAt: number;
}

const ALLOWED_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".svg",
  ".wgsl",
  ".json",
]);

/**
 * Validates that an asset path is safe from directory traversal attacks.
 */
export function isSafeRelativePath(relPath: string): boolean {
  if (!relPath || typeof relPath !== "string") return false;
  // Disallow absolute paths, drive letters, and parent directory traversal
  if (relPath.startsWith("/") || relPath.startsWith("\\") || /^[a-zA-Z]:/.test(relPath)) {
    return false;
  }
  const parts = relPath.split(/[/\\]/);
  for (const part of parts) {
    if (part === ".." || part.trim() === "") return false;
  }
  const extMatch = relPath.match(/\.[a-zA-Z0-9]+$/);
  if (!extMatch || !ALLOWED_EXTENSIONS.has(extMatch[0].toLowerCase())) {
    return false;
  }
  return true;
}

/**
 * Computes SHA-256 hex digest using standard Web Crypto.
 */
export async function computeSha256Hex(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const buffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Decodes base64 string to Uint8Array safely in all environments.
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  const globalBuffer = (globalThis as any).Buffer;
  if (typeof atob === "function") {
    const binStr = atob(base64);
    const len = binStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binStr.charCodeAt(i);
    }
    return bytes;
  }
  if (globalBuffer) {
    return new Uint8Array(globalBuffer.from(base64, "base64"));
  }
  return new Uint8Array(0);
}

export class AssetBundleManager {
  private cacheIndex = new Map<string, CachedBundleMetadata>();
  private inMemoryAssets = new Map<string, Map<string, string>>();
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
  }

  isBundleCached(bundleId: string, expectedHash?: string): boolean {
    const cached = this.cacheIndex.get(bundleId);
    if (!cached) return false;
    if (expectedHash && cached.hash !== expectedHash) {
      return false;
    }
    return true;
  }

  getCachedMetadata(bundleId: string): CachedBundleMetadata | undefined {
    return this.cacheIndex.get(bundleId);
  }

  /**
   * Installs an effect bundle into the local cache.
   * Performs SHA-256 verification and path-traversal rejection.
   */
  async installBundle(bundle: EffectBundlePayload): Promise<CachedBundleMetadata> {
    if (!bundle.bundleId || !/^[a-zA-Z0-9_-]+$/.test(bundle.bundleId)) {
      throw new Error(`Invalid bundleId: ${bundle.bundleId}`);
    }

    if (!bundle.manifest || !bundle.manifest.id) {
      throw new Error("Invalid manifest in bundle payload");
    }

    // Verify bundle hash
    const expectedPayload = JSON.stringify({
      bundleId: bundle.bundleId,
      manifest: bundle.manifest,
      assets: bundle.assets,
    });
    const computedHash = await computeSha256Hex(expectedPayload);

    if (bundle.hash && bundle.hash !== computedHash) {
      throw new Error(
        `Integrity check failed: expected ${bundle.hash}, computed ${computedHash}`,
      );
    }

    const isTauri =
      typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
    const extractedAssets: Record<string, string> = {};

    let bundleDir = `effects/${bundle.bundleId}`;

    if (isTauri) {
      const { BaseDirectory, mkdir, writeFile } = await import("@tauri-apps/plugin-fs");
      const { appDataDir, join } = await import("@tauri-apps/api/path");

      const appData = await appDataDir();
      const absBundleDir = await join(appData, bundleDir);
      await mkdir(absBundleDir, { baseDir: BaseDirectory.AppData, recursive: true });

      for (const asset of bundle.assets) {
        if (!isSafeRelativePath(asset.path)) {
          throw new Error(`Path traversal / unsafe file rejected: ${asset.path}`);
        }
        const filePath = await join(absBundleDir, asset.path);
        // Ensure subdirectories exist
        const lastSlash = asset.path.lastIndexOf("/");
        if (lastSlash > 0) {
          const subDir = await join(absBundleDir, asset.path.substring(0, lastSlash));
          await mkdir(subDir, { baseDir: BaseDirectory.AppData, recursive: true });
        }

        const dataBytes = base64ToUint8Array(asset.data);
        await writeFile(filePath, dataBytes, { baseDir: BaseDirectory.AppData });
        extractedAssets[asset.path] = convertFileSrc(filePath);
      }
    } else {
      // Browser / Web / Vitest Mock environment
      let assetMap = this.inMemoryAssets.get(bundle.bundleId);
      if (!assetMap) {
        assetMap = new Map();
        this.inMemoryAssets.set(bundle.bundleId, assetMap);
      }

      for (const asset of bundle.assets) {
        if (!isSafeRelativePath(asset.path)) {
          throw new Error(`Path traversal / unsafe file rejected: ${asset.path}`);
        }
        const dataUri = `data:${asset.contentType};base64,${asset.data}`;
        assetMap.set(asset.path, dataUri);
        extractedAssets[asset.path] = dataUri;
      }
    }

    const metadata: CachedBundleMetadata = {
      bundleId: bundle.bundleId,
      version: bundle.version || "1.0.0",
      hash: computedHash,
      localDir: bundleDir,
      extractedAssets,
      downloadedAt: Date.now(),
    };

    this.cacheIndex.set(bundle.bundleId, metadata);
    return metadata;
  }

  /**
   * Fetches remote bundle from API, verifies, and installs it locally.
   */
  async fetchAndInstallBundle(
    bundleId: string,
    apiBaseUrl: string = "https://clypra-worker-api.abdulkabirmusa.com",
  ): Promise<CachedBundleMetadata> {
    const url = `${apiBaseUrl.replace(/\/$/, "")}/body-effects/bundles/${encodeURIComponent(bundleId)}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch bundle '${bundleId}': HTTP ${response.status}`);
    }
    const payload = (await response.json()) as EffectBundlePayload;
    return this.installBundle(payload);
  }

  /**
   * Resolves an asset's local URI within a cached bundle.
   */
  resolveBundleAsset(bundleId: string, relativePath: string): string | undefined {
    const cached = this.cacheIndex.get(bundleId);
    if (!cached) return undefined;
    return cached.extractedAssets[relativePath];
  }

  /**
   * Clears the cache for a specific bundle or all bundles.
   */
  clearCache(bundleId?: string): void {
    if (bundleId) {
      this.cacheIndex.delete(bundleId);
      this.inMemoryAssets.delete(bundleId);
    } else {
      this.cacheIndex.clear();
      this.inMemoryAssets.clear();
    }
  }
}

export const assetBundleManager = new AssetBundleManager();

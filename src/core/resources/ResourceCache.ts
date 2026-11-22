/**
 * Media Resource Cache
 *
 * Manages lifecycle of decoded media resources.
 * Separates asset acquisition from rasterization.
 *
 * Architecture:
 *   - Decode media BEFORE rasterization
 *   - Cache decoded resources (LRU)
 *   - Reference counting for lifecycle
 *   - Async resource loading
 *
 * Key principle:
 *   Rasterizer should NEVER fetch/decode.
 *   It only draws pre-resolved resources.
 */

import type { RenderResource, RenderResourceHandle, RenderResourceType } from "./types";
import { getCacheCoordinator } from "@/core/cache/cacheCoordinator";

/**
 * Resource manager configuration.
 */
export interface ResourceManagerConfig {
  /** Maximum cache size in MB */
  maxCacheSizeMB?: number;

  /** Maximum number of resources */
  maxResources?: number;

  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Media resource cache.
 * Handles decode, caching, and lifecycle of media resources.
 */
export class ResourceCache {
  private resources = new Map<RenderResourceHandle, RenderResource>();
  private config: Required<ResourceManagerConfig>;
  private currentCacheSizeBytes = 0;

  constructor(config: ResourceManagerConfig = {}) {
    this.config = {
      maxCacheSizeMB: config.maxCacheSizeMB ?? 500,
      maxResources: config.maxResources ?? 100,
      debug: config.debug ?? false,
    };
  }

  /**
   * Acquire a render resource.
   * Loads and decodes if not cached.
   *
   * @param sourceUrl - Source URL to load
   * @param type - Expected resource type
   * @returns Render resource handle
   */
  async acquire(sourceUrl: string, type: RenderResourceType = "image-bitmap"): Promise<RenderResourceHandle> {
    // Check if already cached
    const handle = this.getHandleForUrl(sourceUrl);
    if (handle) {
      const resource = this.resources.get(handle);
      if (resource) {
        resource.refCount++;
        resource.lastAccessTime = Date.now();
        return handle;
      }
    }

    // Load and decode resource
    const resource = await this.loadResource(sourceUrl, type);

    // Evict if necessary
    this.evictIfNecessary();

    // Store resource
    this.resources.set(resource.handle, resource);
    this.updateCacheSize();

    return resource.handle;
  }

  /**
   * Get a resource by handle.
   *
   * @param handle - Resource handle
   * @returns Render resource or null
   */
  get(handle: RenderResourceHandle): RenderResource | null {
    const resource = this.resources.get(handle);
    if (resource) {
      resource.lastAccessTime = Date.now();
      return resource;
    }
    return null;
  }

  /**
   * Increment reference count for an existing resource.
   * Used when handle is already known (from persistent cache).
   * O(1) operation - avoids O(n) search in getHandleForUrl().
   *
   * @param handle - Resource handle
   * @returns true if handle is valid, false if evicted
   */
  incrementRef(handle: RenderResourceHandle): boolean {
    const resource = this.resources.get(handle);
    if (resource) {
      resource.refCount++;
      resource.lastAccessTime = Date.now();
      return true;
    }
    return false;
  }

  /**
   * Release a resource (decrement ref count).
   *
   * @param handle - Resource handle
   */
  release(handle: RenderResourceHandle): void {
    const resource = this.resources.get(handle);
    if (resource) {
      resource.refCount = Math.max(0, resource.refCount - 1);
    }
  }

  /**
   * Clear all resources.
   */
  clear(): void {
    // Close all ImageBitmaps
    for (const resource of this.resources.values()) {
      if (resource.data instanceof ImageBitmap) {
        resource.data.close();
      }
    }

    this.resources.clear();
    this.currentCacheSizeBytes = 0;
  }

  /**
   * Get cache statistics.
   */
  getStats() {
    return {
      resourceCount: this.resources.size,
      cacheSizeMB: (this.currentCacheSizeBytes / (1024 * 1024)).toFixed(2),
      maxCacheSizeMB: this.config.maxCacheSizeMB,
      maxResources: this.config.maxResources,
    };
  }

  /**
   * Load and decode a resource.
   */
  private async loadResource(sourceUrl: string, type: RenderResourceType): Promise<RenderResource> {
    const handle = this.generateHandle(sourceUrl);

    try {
      if (type === "image-bitmap") {
        // Load image
        const response = await fetch(sourceUrl);
        const blob = await response.blob();
        const imageBitmap = await createImageBitmap(blob);

        return {
          handle,
          type: "image-bitmap",
          data: imageBitmap,
          sourceUrl,
          width: imageBitmap.width,
          height: imageBitmap.height,
          refCount: 1,
          lastAccessTime: Date.now(),
        };
      } else if (type === "video-element") {
        // For video, we'd need a video element pool
        // For now, return placeholder
        return this.createPlaceholder(handle, sourceUrl);
      } else {
        return this.createPlaceholder(handle, sourceUrl);
      }
    } catch (error) {
      if (this.config.debug) {
        console.error(`Failed to load resource: ${sourceUrl}`, error);
      }
      return this.createPlaceholder(handle, sourceUrl);
    }
  }

  /**
   * Create a placeholder resource.
   */
  private createPlaceholder(handle: RenderResourceHandle, sourceUrl: string): RenderResource {
    return {
      handle,
      type: "placeholder",
      data: null,
      sourceUrl,
      width: 1920,
      height: 1080,
      refCount: 1,
      lastAccessTime: Date.now(),
    };
  }

  /**
   * Generate a handle for a URL.
   */
  private generateHandle(sourceUrl: string): RenderResourceHandle {
    // Simple hash of URL
    let hash = 0;
    for (let i = 0; i < sourceUrl.length; i++) {
      hash = (hash << 5) - hash + sourceUrl.charCodeAt(i);
      hash = hash & hash;
    }
    return `res-${Math.abs(hash).toString(36)}`;
  }

  /**
   * Get handle for a URL if already cached.
   */
  private getHandleForUrl(sourceUrl: string): RenderResourceHandle | null {
    for (const [handle, resource] of this.resources.entries()) {
      if (resource.sourceUrl === sourceUrl) {
        return handle;
      }
    }
    return null;
  }

  /**
   * Evict resources if cache is full.
   * Uses LRU strategy.
   */
  private evictIfNecessary(): void {
    const maxBytes = this.config.maxCacheSizeMB * 1024 * 1024;

    // Evict by resource count
    while (this.resources.size >= this.config.maxResources) {
      this.evictLRU();
    }

    // Evict by cache size
    while (this.currentCacheSizeBytes > maxBytes) {
      this.evictLRU();
    }
  }

  /**
   * Evict least recently used resource.
   */
  private evictLRU(): void {
    let oldestHandle: RenderResourceHandle | null = null;
    let oldestTime = Infinity;
    let fallbackHandle: RenderResourceHandle | null = null;
    let fallbackTime = Infinity;

    // Find LRU resource with refCount = 0 (preferred)
    // Also track oldest resource regardless of refCount (fallback)
    for (const [handle, resource] of this.resources.entries()) {
      if (resource.lastAccessTime < fallbackTime) {
        fallbackTime = resource.lastAccessTime;
        fallbackHandle = handle;
      }
      if (resource.refCount === 0 && resource.lastAccessTime < oldestTime) {
        oldestTime = resource.lastAccessTime;
        oldestHandle = handle;
      }
    }

    // Prefer zero-ref eviction; fall back to oldest if all are referenced
    const evictTarget = oldestHandle ?? fallbackHandle;

    if (evictTarget) {
      const resource = this.resources.get(evictTarget);
      if (resource) {
        // Close ImageBitmap
        if (resource.data instanceof ImageBitmap) {
          resource.data.close();
        }
        this.resources.delete(evictTarget);
      }
    }
  }

  /**
   * Update cache size estimate.
   */
  private updateCacheSize(): void {
    let totalBytes = 0;

    for (const resource of this.resources.values()) {
      if (resource.data instanceof ImageBitmap) {
        // Estimate: width * height * 4 bytes (RGBA)
        totalBytes += resource.width * resource.height * 4;
      }
    }

    this.currentCacheSizeBytes = totalBytes;
  }

  /**
   * Get total estimated bytes used by cached resources.
   */
  getBytesUsed(): number {
    return this.currentCacheSizeBytes;
  }

  /**
   * Trim cache until it is under `targetBytes`.
   */
  trimTo(targetBytes: number): number {
    const initial = this.currentCacheSizeBytes;
    while (this.currentCacheSizeBytes > targetBytes && this.resources.size > 0) {
      this.evictLRU();
      this.updateCacheSize();
    }
    return Math.max(0, initial - this.currentCacheSizeBytes);
  }
}

/**
 * Global resource cache instance.
 */
let globalResourceCache: ResourceCache | null = null;

/**
 * Get or create global resource cache.
 */
export function getResourceCache(): ResourceCache {
  if (!globalResourceCache) {
    globalResourceCache = new ResourceCache();
    getCacheCoordinator().register({
      name: "media-resource-cache",
      tier: "memory",
      lifespan: "session",
      getBytesUsed: () => globalResourceCache?.getBytesUsed() ?? 0,
      trimTo: (t) => globalResourceCache?.trimTo(t) ?? 0,
      clear: () => globalResourceCache?.clear(),
    });
  }
  return globalResourceCache;
}

/**
 * Reset global resource cache (for testing).
 */
export function resetResourceCache(): void {
  if (globalResourceCache) {
    globalResourceCache.clear();
  }
  globalResourceCache = null;
}

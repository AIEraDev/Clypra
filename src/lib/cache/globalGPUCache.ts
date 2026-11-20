/**
 * Global GPU Cache Manager
 *
 * Singleton that manages a shared GPU texture cache across all components.
 * This enables:
 * - Texture sharing between ClipFilmstrip instances
 * - Viewport-aware eviction (visible frames protected)
 * - Lower memory usage (no duplicate textures)
 * - Better texture reuse rate
 *
 * Usage:
 * ```typescript
 * import { globalGPUCache } from '@/lib/cache/globalGPUCache';
 *
 * // Initialize once in root component
 * globalGPUCache.initialize(canvas);
 *
 * // Use in any component
 * const cache = globalGPUCache.getCache();
 * if (cache) {
 *   cache.uploadTexture(key, rgbaBytes, width, height);
 *   cache.renderTexture(key, x, y, width, height);
 * }
 * ```
 */

import { GPUTextureCache } from "./gpuTextureCache";
import { getCacheCoordinator } from "@/core/cache/cacheCoordinator";

interface ViewportInfo {
  componentId: string;
  textureKeys: Set<string>;
  priority: number; // Higher = more important
  lastUpdate: number;
}

export class GlobalGPUCacheManager {
  private static instance: GlobalGPUCacheManager;
  private cache: GPUTextureCache | null = null;
  private viewports: Map<string, ViewportInfo> = new Map();
  private memoryLimitMB: number = 200; // Default 200MB limit
  private autoEvictionEnabled: boolean = true;
  private evictionCheckInterval: number | null = null;

  private constructor() {
    // Private constructor for singleton
  }

  static getInstance(): GlobalGPUCacheManager {
    if (!GlobalGPUCacheManager.instance) {
      GlobalGPUCacheManager.instance = new GlobalGPUCacheManager();
    }
    return GlobalGPUCacheManager.instance;
  }

  /**
   * Initialize the global GPU cache with a canvas element
   * Should be called once in the root component
   */
  initialize(canvas: HTMLCanvasElement, memoryLimitMB: number = 200): boolean {
    if (this.cache) {
      return true;
    }

    try {
      this.cache = new GPUTextureCache(canvas, memoryLimitMB);
      this.memoryLimitMB = memoryLimitMB;

      getCacheCoordinator().register({
        name: "global-gpu-texture-cache",
        tier: "gpu",
        lifespan: "session",
        getBytesUsed: () => {
          const stats = this.cache?.getStats();
          return stats ? parseFloat(stats.memoryMB || "0") * 1024 * 1024 : 0;
        },
        trimTo: (targetBytes) => {
          if (!this.cache) return 0;
          const initialBytes = parseFloat(this.cache.getStats().memoryMB || "0") * 1024 * 1024;
          this.cache.evictLRU(targetBytes / (1024 * 1024));
          const finalBytes = parseFloat(this.cache.getStats().memoryMB || "0") * 1024 * 1024;
          return Math.max(0, initialBytes - finalBytes);
        },
        clear: () => {
          this.clearAllTextures();
        },
      });

      // Start auto-eviction check (every 10 seconds)
      if (this.autoEvictionEnabled) {
        this.startAutoEviction();
      }

      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   * Get the GPU texture cache instance
   * Returns null if not initialized
   */
  getCache(): GPUTextureCache | null {
    return this.cache;
  }

  /**
   * Check if GPU cache is initialized
   */
  isInitialized(): boolean {
    return this.cache !== null;
  }

  /**
   * Register a viewport (component) with its visible texture keys
   * This helps protect viewport textures from eviction
   */
  registerViewport(componentId: string, textureKeys: Set<string>, priority: number = 1): void {
    this.viewports.set(componentId, {
      componentId,
      textureKeys,
      priority,
      lastUpdate: Date.now(),
    });
  }

  /**
   * Unregister a viewport when component unmounts
   */
  unregisterViewport(componentId: string): void {
    this.viewports.delete(componentId);
  }

  /**
   * Get all texture keys currently in any viewport
   */
  private getViewportTextureKeys(): Set<string> {
    const allKeys = new Set<string>();
    for (const viewport of this.viewports.values()) {
      for (const key of viewport.textureKeys) {
        allKeys.add(key);
      }
    }
    return allKeys;
  }

  /**
   * Evict textures not in any viewport
   * Viewport textures are protected from eviction
   */
  evictNonViewport(): number {
    if (!this.cache) return 0;

    const viewportKeys = this.getViewportTextureKeys();
    const stats = this.cache.getStats();
    const currentMemoryMB = parseFloat(stats.memoryMB);

    if (currentMemoryMB <= this.memoryLimitMB) {
      return 0; // No eviction needed
    }

    // Get all texture metadata
    const allTextures = Array.from((this.cache as any).textureMetadata.entries()) as Array<[string, any]>;

    // Sort by priority:
    // 1. Viewport textures (never evict)
    // 2. Recently used textures
    // 3. Frequently used textures
    const sortedTextures = allTextures.sort(([keyA, metaA], [keyB, metaB]) => {
      const inViewportA = viewportKeys.has(keyA);
      const inViewportB = viewportKeys.has(keyB);

      // Viewport textures always win
      if (inViewportA && !inViewportB) return 1;
      if (!inViewportA && inViewportB) return -1;

      // Both in viewport or both not in viewport - sort by recency and use count
      const scoreA = metaA.lastUsed + metaA.useCount * 1000;
      const scoreB = metaB.lastUsed + metaB.useCount * 1000;
      return scoreA - scoreB; // Lower score = evict first
    });

    let evicted = 0;
    for (const [key] of sortedTextures) {
      // Never evict viewport textures
      if (viewportKeys.has(key)) {
        continue;
      }

      // Delete texture
      const texture = (this.cache as any).textures.get(key);
      if (texture) {
        (this.cache as any).gl.deleteTexture(texture);
        (this.cache as any).textures.delete(key);
        (this.cache as any).textureMetadata.delete(key);
        evicted++;
      }

      // Check if we're under the limit
      const newStats = this.cache.getStats();
      const newMemoryMB = parseFloat(newStats.memoryMB);
      if (newMemoryMB <= this.memoryLimitMB) {
        break;
      }
    }

    const finalStats = this.cache.getStats();
    return evicted;
  }

  /**
   * Start automatic eviction check
   * Runs every 10 seconds to keep memory under limit
   */
  private startAutoEviction(): void {
    if (this.evictionCheckInterval !== null) {
      return; // Already running
    }

    this.evictionCheckInterval = window.setInterval(() => {
      if (!this.cache) return;

      const stats = this.cache.getStats();
      const currentMemoryMB = parseFloat(stats.memoryMB);

      if (currentMemoryMB > this.memoryLimitMB) {
        this.evictNonViewport();
      }
    }, 10000); // Check every 10 seconds
  }

  /**
   * Stop automatic eviction check
   */
  private stopAutoEviction(): void {
    if (this.evictionCheckInterval !== null) {
      window.clearInterval(this.evictionCheckInterval);
      this.evictionCheckInterval = null;
    }
  }

  /**
   * Set memory limit in MB
   */
  setMemoryLimit(limitMB: number): void {
    this.memoryLimitMB = limitMB;

    // Trigger eviction if over limit
    if (this.cache) {
      const stats = this.cache.getStats();
      const currentMemoryMB = parseFloat(stats.memoryMB);
      if (currentMemoryMB > limitMB) {
        this.evictNonViewport();
      }
    }
  }

  /**
   * Get global cache statistics
   */
  getStats() {
    if (!this.cache) {
      return {
        initialized: false,
        textures: 0,
        memoryMB: "0",
        viewports: 0,
        viewportTextures: 0,
      };
    }

    const cacheStats = this.cache.getStats();
    const viewportKeys = this.getViewportTextureKeys();

    return {
      initialized: true,
      ...cacheStats,
      viewports: this.viewports.size,
      viewportTextures: viewportKeys.size,
      memoryLimitMB: this.memoryLimitMB,
    };
  }

  /**
   * Evict ALL textures from the GPU cache and clear viewport registrations.
   *
   * Called on project switch/close to ensure
   * textures from the previous project are not accessible to the incoming one.
   * This is safe because the filmstrip and preview will re-upload needed textures
   * on the next render cycle.
   *
   * @returns Number of textures evicted
   */
  clearAllTextures(): number {
    if (!this.cache) return 0;

    const textures: Map<string, WebGLTexture> = (this.cache as any).textures;
    const textureMetadata: Map<string, unknown> = (this.cache as any).textureMetadata;
    const gl: WebGLRenderingContext | WebGL2RenderingContext = (this.cache as any).gl;

    if (!textures || !gl) return 0;

    let evicted = 0;
    for (const texture of textures.values()) {
      try {
        gl.deleteTexture(texture);
        evicted++;
      } catch {
        // Ignore errors from already-lost WebGL context
      }
    }

    textures.clear();
    if (textureMetadata) textureMetadata.clear();

    // Clear viewport registrations — they reference clip keys from the old project
    this.viewports.clear();

    if (evicted > 0) {
      console.log(`[GlobalGPUCache] Cleared ${evicted} textures on project switch`);
    }
    return evicted;
  }

  /**
   * Dispose of GPU resources
   * Should be called when app is shutting down
   */
  dispose(): void {
    this.stopAutoEviction();

    if (this.cache) {
      this.cache.dispose();
      this.cache = null;
    }

    this.viewports.clear();
  }
}

// Export singleton instance
export const globalGPUCache = GlobalGPUCacheManager.getInstance();

import { extractFrameAtTime } from "../../../lib/tauri";

/**
 * Thumbnail sampling density levels
 */
export type DensityLevel = "low" | "medium" | "high" | "ultra";

interface DensityConfig {
  timePerFrame: number; // seconds between frames
  label: DensityLevel;
}

/**
 * Maps zoom level to appropriate sampling density
 */
const ZOOM_DENSITY_MAP: Record<number, DensityConfig> = {
  0.25: { timePerFrame: 10, label: "low" },     // 0.25x zoom: frame every 10s
  0.5: { timePerFrame: 5, label: "low" },        // 0.5x zoom: frame every 5s
  1: { timePerFrame: 2, label: "medium" },       // 1x zoom: frame every 2s
  2: { timePerFrame: 1, label: "medium" },       // 2x zoom: frame every 1s
  4: { timePerFrame: 0.5, label: "high" },      // 4x zoom: frame every 0.5s
  8: { timePerFrame: 0.25, label: "high" },      // 8x zoom: frame every 0.25s
  16: { timePerFrame: 0.1, label: "ultra" },    // 16x zoom: frame every 0.1s
};

/**
 * Fixed thumbnail dimensions (CapCut-style)
 */
export const THUMBNAIL_WIDTH = 80;
export const THUMBNAIL_HEIGHT = 60;

/**
 * Cached frame data
 */
interface CachedFrame {
  time: number;
  dataUrl: string;
  timestamp: number; // cache timestamp
}

/**
 * Cache for a specific video and density level
 */
interface VideoCache {
  [density: string]: {
    frames: Map<number, CachedFrame>; // time -> frame
    lastAccessed: number;
  };
}

/**
 * ThumbnailEngine - Manages time-sampled frame extraction with multi-resolution caching
 * 
 * Core principle: Zoom changes time density, not thumbnail width
 * - Thumbnail width is CONSTANT (80px)
 * - Time per thumbnail varies with zoom
 */
export class ThumbnailEngine {
  private cache = new Map<string, VideoCache>(); // videoPath -> VideoCache
  private maxCacheSize = 100; // max frames per density level
  private abortControllers = new Map<string, AbortController>();

  /**
   * Get density config for current zoom level
   */
  private getDensityForZoom(zoom: number): DensityConfig {
    const sortedZooms = Object.keys(ZOOM_DENSITY_MAP)
      .map(Number)
      .sort((a, b) => a - b);
    
    // Find closest zoom level
    let closest = sortedZooms[0];
    for (const z of sortedZooms) {
      if (zoom >= z) {
        closest = z;
      } else {
        break;
      }
    }
    
    return ZOOM_DENSITY_MAP[closest];
  }

  /**
   * Generate cache key for a video
   */
  private getCacheKey(videoPath: string, startTime: number, endTime: number): string {
    return `${videoPath}:${startTime}:${endTime}`;
  }

  /**
   * Get or create cache entry for video
   */
  private getVideoCache(videoPath: string): VideoCache {
    if (!this.cache.has(videoPath)) {
      this.cache.set(videoPath, {});
    }
    return this.cache.get(videoPath)!;
  }

  /**
   * Generate thumbnails for a time range
   * Returns array of { time, dataUrl } for rendering
   */
  async generateThumbnails(
    videoPath: string,
    clipStartTime: number,
    clipEndTime: number,
    zoom: number,
    visibleStart: number,
    visibleEnd: number
  ): Promise<Array<{ time: number; dataUrl: string }>> {
    const density = this.getDensityForZoom(zoom);
    const videoCache = this.getVideoCache(videoPath);
    
    // Ensure density cache exists
    if (!videoCache[density.label]) {
      videoCache[density.label] = {
        frames: new Map(),
        lastAccessed: Date.now(),
      };
    }
    
    const densityCache = videoCache[density.label];
    densityCache.lastAccessed = Date.now();

    // Calculate visible time range (with buffer for smooth scrolling)
    const bufferSeconds = density.timePerFrame * 2;
    const renderStart = Math.max(clipStartTime, visibleStart - bufferSeconds);
    const renderEnd = Math.min(clipEndTime, visibleEnd + bufferSeconds);

    // Generate time points for this density
    const timePoints: number[] = [];
    for (let t = renderStart; t <= renderEnd; t += density.timePerFrame) {
      // Align to nearest frame boundary for consistency
      const alignedTime = Math.floor(t / density.timePerFrame) * density.timePerFrame;
      timePoints.push(alignedTime);
    }

    // Abort any previous extraction for this video
    const cacheKey = this.getCacheKey(videoPath, clipStartTime, clipEndTime);
    this.abortControllers.get(cacheKey)?.abort();
    const controller = new AbortController();
    this.abortControllers.set(cacheKey, controller);

    // Check cache and extract missing frames
    const results: Array<{ time: number; dataUrl: string }> = [];
    const missingTimes: number[] = [];

    for (const time of timePoints) {
      const cached = densityCache.frames.get(time);
      if (cached && Date.now() - cached.timestamp < 300000) { // 5min cache validity
        results.push({ time, dataUrl: cached.dataUrl });
      } else {
        missingTimes.push(time);
      }
    }

    // Extract missing frames (batch them)
    if (missingTimes.length > 0 && !controller.signal.aborted) {
      // Extract frames sequentially to avoid overwhelming FFmpeg
      for (const time of missingTimes) {
        if (controller.signal.aborted) break;
        
        try {
          const frameData = await extractFrameAtTime(videoPath, time, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
          
          if (!controller.signal.aborted) {
            // Cache the frame
            densityCache.frames.set(time, {
              time,
              dataUrl: frameData,
              timestamp: Date.now(),
            });
            
            results.push({ time, dataUrl: frameData });
            
            // Evict old frames if cache too large
            this.evictIfNeeded(densityCache);
          }
        } catch (error) {
          console.error(`[ThumbnailEngine] Failed to extract frame at ${time}:`, error);
        }
      }
    }

    // Sort by time
    results.sort((a, b) => a.time - b.time);
    return results;
  }

  /**
   * Evict oldest frames if cache exceeds max size
   */
  private evictIfNeeded(cache: { frames: Map<number, CachedFrame>; lastAccessed: number }) {
    if (cache.frames.size > this.maxCacheSize) {
      const entries = Array.from(cache.frames.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      
      // Remove oldest 20%
      const toRemove = Math.floor(this.maxCacheSize * 0.2);
      for (let i = 0; i < toRemove; i++) {
        cache.frames.delete(entries[i][0]);
      }
    }
  }

  /**
   * Get time per thumbnail for current zoom (for positioning)
   */
  getTimePerThumbnail(zoom: number): number {
    return this.getDensityForZoom(zoom).timePerFrame;
  }

  /**
   * Clear cache for a video (e.g., when video is removed)
   */
  clearVideoCache(videoPath: string) {
    this.cache.delete(videoPath);
    const cacheKey = this.getCacheKey(videoPath, 0, Infinity);
    this.abortControllers.get(cacheKey)?.abort();
    this.abortControllers.delete(cacheKey);
  }

  /**
   * Clear all caches
   */
  dispose() {
    this.abortControllers.forEach((controller) => controller.abort());
    this.abortControllers.clear();
    this.cache.clear();
  }
}

// Singleton instance
let globalThumbnailEngine: ThumbnailEngine | null = null;

export function getThumbnailEngine(): ThumbnailEngine {
  if (!globalThumbnailEngine) {
    globalThumbnailEngine = new ThumbnailEngine();
  }
  return globalThumbnailEngine;
}

export function disposeThumbnailEngine() {
  globalThumbnailEngine?.dispose();
  globalThumbnailEngine = null;
}

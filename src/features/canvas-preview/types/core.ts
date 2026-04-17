/**
 * Core type definitions for Canvas Preview System v2
 */

import type { Clip } from "../../timeline/types/core";

/**
 * ActiveClip extends the base Clip interface with rendering metadata
 * Used during frame rendering to track which clips are visible and their state
 */
export interface ActiveClip extends Clip {
  trackIndex: number; // Track order for layering (higher = on top)
  clipTime: number; // Position within source media in seconds
  videoElement: HTMLVideoElement; // Reference to pooled video element
}

/**
 * VideoPoolEntry manages the lifecycle of a single video element
 * Implements reference counting and LRU eviction for efficient memory usage
 */
export interface VideoPoolEntry {
  video: HTMLVideoElement; // The actual video element
  sourcePath: string; // Path to source media file
  refCount: number; // Number of clips using this video
  lastUsed: number; // Timestamp for LRU eviction
  isLoaded: boolean; // Metadata loaded successfully
  isReady: boolean; // Can seek and play
  evictionTimer: number | null; // Delayed eviction timer ID
}

/**
 * FrameCacheEntry stores a rendered frame for scrubbing optimization
 * Uses ImageBitmap for efficient GPU-backed storage
 */
export interface FrameCacheEntry {
  bitmap: ImageBitmap; // Rendered frame as ImageBitmap
  timestamp: number; // Timeline time in seconds
  lastAccessed: number; // Timestamp for LRU eviction
  stateHash: string; // Hash of clips/tracks state for invalidation
}

/**
 * RenderState tracks the current rendering state and performance metrics
 * Used for debugging, optimization, and frame skipping logic
 */
export interface RenderState {
  isRendering: boolean; // Currently rendering a frame
  currentFrame: number; // Current frame number
  pendingSeeks: Map<string, number>; // clipId → target time
  rafId: number | null; // RequestAnimationFrame ID
  lastRenderTime: number; // Timestamp of last render
  frameCount: number; // Total frames rendered
  droppedFrames: number; // Frames skipped due to performance
}

/**
 * CanvasPreviewConfig defines configuration options for the canvas renderer
 * Allows customization of performance and quality settings
 */
export interface CanvasPreviewConfig {
  width: number; // Canvas width in CSS pixels
  height: number; // Canvas height in CSS pixels
  maxVideoPoolSize?: number; // Maximum simultaneous videos (default: 10)
  maxFrameCacheSize?: number; // Maximum cached frames (default: 100)
  seekThreshold?: number; // Minimum time difference to trigger seek (default: 0.03s)
  debounceWindow?: number; // Seek debounce window in ms (default: 100ms)
  seekTimeout?: number; // Seek operation timeout in ms (default: 500ms)
  evictionDelay?: number; // Video eviction delay in ms (default: 5000ms)
}

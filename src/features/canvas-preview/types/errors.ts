/**
 * Error types and codes for Canvas Preview System v2
 */

/**
 * Error codes for Canvas Preview System
 * Each code represents a specific failure mode with appropriate recovery strategy
 */
export const CanvasPreviewErrorCode = {
  VIDEO_LOAD_FAILED: "VIDEO_LOAD_FAILED", // Failed to load video metadata
  VIDEO_SEEK_FAILED: "VIDEO_SEEK_FAILED", // Failed to seek to target time
  RENDER_FAILED: "RENDER_FAILED", // Failed to render frame to canvas
  INVALID_CLIP_DATA: "INVALID_CLIP_DATA", // Clip data validation failed
  CANVAS_CONTEXT_LOST: "CANVAS_CONTEXT_LOST", // Canvas context was lost
  FRAME_CACHE_ERROR: "FRAME_CACHE_ERROR", // Frame cache operation failed
  VIDEO_DECODE_ERROR: "VIDEO_DECODE_ERROR", // Video decode error
  INVALID_DIMENSIONS: "INVALID_DIMENSIONS", // Invalid canvas dimensions
  POOL_CAPACITY_EXCEEDED: "POOL_CAPACITY_EXCEEDED", // Video pool at capacity
} as const;

export type CanvasPreviewErrorCodeType = (typeof CanvasPreviewErrorCode)[keyof typeof CanvasPreviewErrorCode];

/**
 * CanvasPreviewError extends Error with additional context for debugging
 * Includes error code, clip ID, source path, and recoverability flag
 */
export class CanvasPreviewError extends Error {
  public readonly code: CanvasPreviewErrorCodeType;
  public readonly clipId?: string;
  public readonly sourcePath?: string;
  public readonly recoverable: boolean;
  public readonly timestamp: number;

  constructor(
    message: string,
    code: CanvasPreviewErrorCodeType,
    options?: {
      clipId?: string;
      sourcePath?: string;
      recoverable?: boolean;
    },
  ) {
    super(message);
    this.name = "CanvasPreviewError";
    this.code = code;
    this.clipId = options?.clipId;
    this.sourcePath = options?.sourcePath;
    this.recoverable = options?.recoverable ?? true;
    this.timestamp = Date.now();

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (typeof (Error as any).captureStackTrace === "function") {
      (Error as any).captureStackTrace(this, CanvasPreviewError);
    }
  }

  /**
   * Convert error to a plain object for logging/serialization
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      clipId: this.clipId,
      sourcePath: this.sourcePath,
      recoverable: this.recoverable,
      timestamp: this.timestamp,
      stack: this.stack,
    };
  }
}

/**
 * CanvasPreviewErrorEvent is emitted for monitoring and debugging
 * Provides structured error information for error tracking systems
 */
export interface CanvasPreviewErrorEvent {
  code: CanvasPreviewErrorCodeType;
  message: string;
  clipId?: string;
  sourcePath?: string;
  timestamp: number;
  recoverable: boolean;
}

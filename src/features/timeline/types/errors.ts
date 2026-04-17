/**
 * Error types and codes for Timeline Engine v1
 */

export const ErrorCodes = {
  MEDIA_LOAD_FAILED: "MEDIA_LOAD_FAILED",
  INVALID_TRIM: "INVALID_TRIM",
  INVALID_TRACK_TYPE: "INVALID_TRACK_TYPE",
  EXPORT_FAILED: "EXPORT_FAILED",
  PARSE_FAILED: "PARSE_FAILED",
  WAVEFORM_GENERATION_FAILED: "WAVEFORM_GENERATION_FAILED",
  FILMSTRIP_GENERATION_FAILED: "FILMSTRIP_GENERATION_FAILED",
  CLIP_NOT_FOUND: "CLIP_NOT_FOUND",
  TRACK_NOT_FOUND: "TRACK_NOT_FOUND",
  INVALID_OPERATION: "INVALID_OPERATION",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export class TimelineError extends Error {
  public readonly code: ErrorCode;
  public readonly recoverable: boolean;

  constructor(message: string, code: ErrorCode, recoverable: boolean = true) {
    super(message);
    this.name = "TimelineError";
    this.code = code;
    this.recoverable = recoverable;

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (typeof (Error as any).captureStackTrace === "function") {
      (Error as any).captureStackTrace(this, TimelineError);
    }
  }
}

/**
 * CanvasCompositorParser - Serialization and parsing for Canvas Compositor state
 */

import { CanvasPreviewError, CanvasPreviewErrorCode } from "../types/errors";

/**
 * Serializable VideoPool state (excludes non-serializable HTMLVideoElement)
 */
export interface SerializableVideoPoolEntry {
  sourcePath: string;
  refCount: number;
  lastUsed: number;
  isLoaded: boolean;
  isReady: boolean;
}

/**
 * VideoPool state for serialization
 */
export interface VideoPoolState {
  entries: SerializableVideoPoolEntry[];
  maxSize: number;
}

/**
 * JSON schema for validation
 */
const VIDEO_POOL_STATE_SCHEMA = {
  type: "object",
  required: ["entries", "maxSize"],
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        required: ["sourcePath", "refCount", "lastUsed", "isLoaded", "isReady"],
        properties: {
          sourcePath: { type: "string" },
          refCount: { type: "number" },
          lastUsed: { type: "number" },
          isLoaded: { type: "boolean" },
          isReady: { type: "boolean" },
        },
      },
    },
    maxSize: { type: "number" },
  },
};

/**
 * CanvasCompositorParser handles serialization and parsing of VideoPool state
 */
export class CanvasCompositorParser {
  /**
   * Serialize VideoPool state to JSON format
   */
  serialize(state: VideoPoolState): string {
    try {
      return JSON.stringify(state, null, 2);
    } catch (error) {
      throw new CanvasPreviewError(`Failed to serialize VideoPool state: ${error instanceof Error ? error.message : "Unknown error"}`, CanvasPreviewErrorCode.INVALID_CLIP_DATA, { recoverable: false });
    }
  }

  /**
   * Parse JSON and reconstruct VideoPool state
   */
  parse(json: string): VideoPoolState {
    // Parse JSON
    let parsed: any;
    try {
      parsed = JSON.parse(json);
    } catch (error) {
      throw new CanvasPreviewError(`Invalid JSON: ${error instanceof Error ? error.message : "Failed to parse JSON"}`, CanvasPreviewErrorCode.INVALID_CLIP_DATA, { recoverable: false });
    }

    const validationError = this.validateSchema(parsed);
    if (validationError) {
      throw new CanvasPreviewError(`JSON validation failed: ${validationError}`, CanvasPreviewErrorCode.INVALID_CLIP_DATA, { recoverable: false });
    }

    const state: VideoPoolState = {
      entries: parsed.entries.map((entry: any) => ({
        sourcePath: entry.sourcePath,
        refCount: entry.refCount ?? 0, // Default to 0 if missing
        lastUsed: entry.lastUsed ?? Date.now(), // Default to current time if missing
        isLoaded: entry.isLoaded ?? false, // Default to false if missing
        isReady: entry.isReady ?? false, // Default to false if missing
      })),
      maxSize: parsed.maxSize ?? 10, // Default to 10 if missing
    };

    return state;
  }

  /**
   * Validate JSON structure against schema
   */
  private validateSchema(data: any): string | null {
    // Check if data is an object
    if (typeof data !== "object" || data === null) {
      return "Root must be an object";
    }

    // Check required fields (allow missing for optional fields with defaults)
    if (!("entries" in data)) {
      return "Missing required field: entries";
    }

    // No validation error if missing

    // Validate entries is an array
    if (!Array.isArray(data.entries)) {
      return "Field 'entries' must be an array";
    }

    // Validate maxSize if present (optional field with default)
    if ("maxSize" in data) {
      if (typeof data.maxSize !== "number") {
        return "Field 'maxSize' must be a number";
      }

      if (data.maxSize <= 0) {
        return "Field 'maxSize' must be positive";
      }
    }

    // Validate each entry
    for (let i = 0; i < data.entries.length; i++) {
      const entry = data.entries[i];

      if (typeof entry !== "object" || entry === null) {
        return `Entry at index ${i} must be an object`;
      }

      // Check required fields (sourcePath is required, others have defaults)
      if (!("sourcePath" in entry)) {
        return `Entry at index ${i} missing required field: sourcePath`;
      }

      // Validate field types
      if (typeof entry.sourcePath !== "string") {
        return `Entry at index ${i} field 'sourcePath' must be a string`;
      }

      // Validate optional fields if present
      if ("refCount" in entry) {
        if (typeof entry.refCount !== "number") {
          return `Entry at index ${i} field 'refCount' must be a number`;
        }

        if (entry.refCount < 0) {
          return `Entry at index ${i} field 'refCount' must be non-negative`;
        }
      }

      if ("lastUsed" in entry) {
        if (typeof entry.lastUsed !== "number") {
          return `Entry at index ${i} field 'lastUsed' must be a number`;
        }

        if (entry.lastUsed < 0) {
          return `Entry at index ${i} field 'lastUsed' must be non-negative`;
        }
      }

      if ("isLoaded" in entry && typeof entry.isLoaded !== "boolean") {
        return `Entry at index ${i} field 'isLoaded' must be a boolean`;
      }

      if ("isReady" in entry && typeof entry.isReady !== "boolean") {
        return `Entry at index ${i} field 'isReady' must be a boolean`;
      }
    }

    return null; // Validation passed
  }
}

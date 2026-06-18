/**
 * Serialization Layer for Rust ↔ Frontend Communication
 *
 * This module provides centralized type-safe conversion between:
 * - Rust backend (snake_case)
 * - TypeScript frontend (camelCase)
 *
 * Architecture principle:
 * "Never manually convert between Rust and TypeScript types. Use centralized serialization layer."
 *
 * Benefits:
 * - Single source of truth for field mappings
 * - Type safety for all conversions
 * - Consistent default handling
 * - Easy to maintain when schema changes
 */

import type { Project, MediaAsset, Track, Clip, AspectRatio, TransitionTimelineItem } from "./index";
import type { Gap } from "./gap";

// ============================================================================
// RUST TYPES (snake_case)
// ============================================================================

/**
 * Rust representation of a Project (snake_case fields)
 *
 * Note: This matches the actual Rust serde schema in src-tauri/src/models/mod.rs
 * - modified_at is REQUIRED (not optional)
 * - aspect_ratio, canvas_width, canvas_height, frame_rate, duration are OPTIONAL
 */
export interface RustProject {
  id: string;
  name: string;
  created_at: number;
  modified_at: number; // Required in Rust
  aspect_ratio?: string | null; // Optional in Rust
  canvas_width?: number | null; // Optional in Rust
  canvas_height?: number | null; // Optional in Rust
  frame_rate?: number | null; // Optional in Rust
  duration?: number | null; // Optional in Rust
  media_assets?: RustMediaAsset[];
  tracks?: RustTrack[];
  clips?: RustClip[];
  transitions?: TransitionTimelineItem[];
  gaps?: RustGap[];
  timeline_schema_version?: number | null;
}

/**
 * Rust representation of a MediaAsset (snake_case fields)
 */
export interface RustMediaAsset {
  id: string;
  name: string;
  path: string;
  type: "video" | "audio" | "image";
  duration: number;
  width?: number;
  height?: number;
  posterFrame?: string;
  coverArt?: string;
  size: number;
  rotation?: number;
  has_alpha?: boolean;
  stickerFormat?: "static" | "gif" | "lottie";
  stickerAnimationPath?: string;
  stickerSourceId?: string;
  contentBounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/**
 * Rust representation of a Track (snake_case fields)
 */
export interface RustTrack {
  id: string;
  type: "video" | "audio" | "text" | "sticker" | "filter";
  name: string;
  muted: boolean;
  locked: boolean;
  visible: boolean;
  height: number;
}

/**
 * Rust representation of a Clip (snake_case fields)
 */
export interface RustClip {
  id: string;
  trackId: string;
  mediaId: string;
  startTime: number;
  duration: number;
  trimIn: number;
  trimOut: number;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  rotation: number;
  aspectRatioLocked?: boolean;
  sourceAspectRatio?: number;
  style_definition?: any;
  fitMode?: "contain" | "cover" | "fill" | "stretch" | "original";
  volume?: number;
  kind?: string;
}

/**
 * Rust representation of a Gap (snake_case fields)
 */
export interface RustGap {
  id: string;
  track_id: string;
  start_time: number;
  duration: number;
  type: "manual" | "auto" | "protected";
  source: "user-insert" | "clip-drag" | "clip-delete" | "imported" | "unknown";
  protected: boolean;
  metadata?: {
    created_at?: number;
    note?: string;
    replaced_clip_id?: string;
    user_created?: boolean;
  };
}

// ============================================================================
// RUST → FRONTEND CONVERTERS
// ============================================================================

/**
 * Convert Rust Project to Frontend Project
 *
 * Handles optional fields from Rust with proper defaults:
 * - modified_at is required in Rust, so no fallback needed
 * - aspect_ratio, canvas_width, etc. are optional in Rust, provide sensible defaults
 *
 * @param rust - Project data from Rust backend (snake_case)
 * @returns Frontend Project (camelCase)
 */
export function fromRustProject(rust: RustProject): Project {
  return {
    id: rust.id,
    name: rust.name,
    createdAt: rust.created_at,
    updatedAt: rust.modified_at, // Required in Rust, no fallback needed
    aspectRatio: (rust.aspect_ratio ?? "16:9") as AspectRatio,
    canvasWidth: rust.canvas_width ?? 1920,
    canvasHeight: rust.canvas_height ?? 1080,
    frameRate: (rust.frame_rate ?? 30) as 24 | 30 | 60,
    duration: rust.duration ?? 0,
    mediaAssets: rust.media_assets?.map(fromRustMediaAsset),
    timelineSchemaVersion: rust.timeline_schema_version ?? 1,
  };
}

/**
 * Convert Rust MediaAsset to Frontend MediaAsset
 *
 * @param rust - MediaAsset data from Rust backend (snake_case)
 * @returns Frontend MediaAsset (camelCase)
 */
export function fromRustMediaAsset(rust: RustMediaAsset): MediaAsset {
  return {
    id: rust.id,
    name: rust.name,
    path: rust.path,
    type: rust.type,
    duration: rust.duration,
    width: rust.width,
    height: rust.height,
    posterFrame: rust.posterFrame,
    coverArt: rust.coverArt,
    size: rust.size,
    rotation: rust.rotation,
    has_alpha: rust.has_alpha,
    contentBounds: rust.contentBounds,
    stickerFormat: rust.stickerFormat,
    stickerAnimationPath: rust.stickerAnimationPath,
    stickerSourceId: rust.stickerSourceId,
  };
}

/**
 * Convert Rust Track to Frontend Track
 *
 * @param rust - Track data from Rust backend (snake_case)
 * @returns Frontend Track (camelCase)
 */
export function fromRustTrack(rust: RustTrack): Track {
  return {
    id: rust.id,
    type: rust.type,
    name: rust.name,
    muted: rust.muted,
    locked: rust.locked,
    visible: rust.visible,
    height: rust.height,
  };
}

/**
 * Convert Rust Clip to Frontend Clip
 *
 * MIGRATION STRATEGY:
 * - For old projects without 'kind' field, infer from ID patterns and mediaId
 * - For new projects, 'kind' is always present from Rust
 * - This ensures backward compatibility while working toward required 'kind'
 *
 * @param rust - Clip data from Rust backend (snake_case)
 * @returns Frontend Clip (camelCase)
 */
export function fromRustClip(rust: RustClip): Clip {
  // Migrate old clips: infer kind from ID patterns if missing
  let kind: Clip["kind"] = rust.kind as any;
  if (!kind) {
    // Legacy migration: infer kind from patterns
    if ("text" in rust || rust.id.startsWith("text-clip-")) {
      kind = "text";
    } else if (rust.mediaId.startsWith("sticker-")) {
      kind = "sticker";
    } else if (rust.id.startsWith("filter-clip-") || rust.kind === "filter") {
      kind = "filter";
    } else {
      // Default to video for unknown legacy clips
      kind = "video";
    }
  }

  // Base clip properties
  const baseClip: Clip = {
    id: rust.id,
    kind, // Now always present after migration
    trackId: rust.trackId,
    mediaId: rust.mediaId,
    startTime: rust.startTime,
    duration: rust.duration,
    trimIn: rust.trimIn,
    trimOut: rust.trimOut,
    x: rust.x,
    y: rust.y,
    width: rust.width,
    height: rust.height,
    opacity: rust.opacity,
    rotation: rust.rotation,
    aspectRatioLocked: rust.aspectRatioLocked,
    sourceAspectRatio: rust.sourceAspectRatio,
    fitMode: rust.fitMode,
    volume: rust.volume,
  };

  // Preserve all additional properties (e.g., TextClip properties)
  // This ensures text, fontFamily, fontSize, color, etc. are restored
  const clip = { ...baseClip, ...rust } as any;
  if (rust.style_definition) {
    clip.styleDefinition = rust.style_definition;
    delete clip.style_definition;
  }
  return clip as Clip;
}

/**
 * Convert Rust Gap to Frontend Gap
 *
 * @param rust - Gap data from Rust backend (snake_case)
 * @returns Frontend Gap (camelCase)
 */
export function fromRustGap(rust: RustGap): Gap {
  return {
    id: rust.id,
    trackId: rust.track_id,
    startTime: rust.start_time,
    duration: rust.duration,
    type: rust.type,
    source: rust.source,
    protected: rust.protected,
    metadata: rust.metadata
      ? {
          createdAt: rust.metadata.created_at,
          note: rust.metadata.note,
          replacedClipId: rust.metadata.replaced_clip_id,
          userCreated: rust.metadata.user_created,
        }
      : undefined,
  };
}

// ============================================================================
// FRONTEND → RUST CONVERTERS
// ============================================================================

/**
 * Convert Frontend Project to Rust Project
 *
 * @param frontend - Frontend Project (camelCase)
 * @param options - Additional data to include (tracks, clips, mediaAssets)
 * @returns Rust Project (snake_case)
 */
export function toRustProject(
  frontend: Project,
  options?: {
    tracks?: Track[];
    clips?: Clip[];
    mediaAssets?: MediaAsset[];
    transitions?: TransitionTimelineItem[];
    gaps?: Gap[];
    /** Update modification timestamp to current time (default: true, set false for round-trip serialization) */
    updateModifiedTime?: boolean;
  },
): RustProject {
  return {
    id: frontend.id,
    name: frontend.name,
    created_at: frontend.createdAt,
    // Only update modified_at when actually saving, not during round-trip serialization
    modified_at: options?.updateModifiedTime !== false ? Date.now() : frontend.updatedAt,
    aspect_ratio: frontend.aspectRatio,
    canvas_width: frontend.canvasWidth,
    canvas_height: frontend.canvasHeight,
    frame_rate: frontend.frameRate,
    duration: frontend.duration,
    media_assets: options?.mediaAssets?.map(toRustMediaAsset) ?? [],
    tracks: options?.tracks?.map(toRustTrack) ?? [],
    clips: options?.clips?.map(toRustClip) ?? [],
    transitions: options?.transitions ?? [],
    gaps: options?.gaps?.map(toRustGap) ?? [],
    timeline_schema_version: frontend.timelineSchemaVersion ?? 1,
  };
}

/**
 * Convert Frontend MediaAsset to Rust MediaAsset
 *
 * @param frontend - Frontend MediaAsset (camelCase)
 * @returns Rust MediaAsset (snake_case)
 */
export function toRustMediaAsset(frontend: MediaAsset): RustMediaAsset {
  return {
    id: frontend.id,
    name: frontend.name,
    path: frontend.path,
    type: frontend.type,
    duration: frontend.duration,
    width: frontend.width,
    height: frontend.height,
    posterFrame: frontend.posterFrame,
    coverArt: frontend.coverArt,
    size: frontend.size,
    rotation: frontend.rotation,
    has_alpha: frontend.has_alpha,
    contentBounds: frontend.contentBounds,
    stickerFormat: frontend.stickerFormat,
    stickerAnimationPath: frontend.stickerAnimationPath,
    stickerSourceId: frontend.stickerSourceId,
  };
}

/**
 * Convert Frontend Track to Rust Track
 *
 * @param frontend - Frontend Track (camelCase)
 * @returns Rust Track (snake_case)
 */
export function toRustTrack(frontend: Track): RustTrack {
  // Map new track types to existing Rust types
  let rustType: RustTrack["type"];

  if (frontend.type === "video-effect" || frontend.type === "body-effect" || frontend.type === "animated-overlay") {
    rustType = "video"; // Map effect/overlay tracks to video type for Rust
  } else {
    rustType = frontend.type as RustTrack["type"];
  }

  return {
    id: frontend.id,
    type: rustType,
    name: frontend.name,
    muted: frontend.muted,
    locked: frontend.locked,
    visible: frontend.visible,
    height: frontend.height,
  };
}

/**
 * Convert Frontend Clip to Rust Clip
 *
 * @param frontend - Frontend Clip (camelCase)
 * @returns Rust Clip (snake_case)
 */
export function toRustClip(frontend: Clip): RustClip {
  // Base clip properties
  const baseClip: RustClip = {
    id: frontend.id,
    kind: frontend.kind,
    trackId: frontend.trackId,
    mediaId: frontend.mediaId,
    startTime: frontend.startTime,
    duration: frontend.duration,
    trimIn: frontend.trimIn,
    trimOut: frontend.trimOut,
    x: frontend.x,
    y: frontend.y,
    width: frontend.width,
    height: frontend.height,
    opacity: frontend.opacity,
    rotation: frontend.rotation,
    aspectRatioLocked: frontend.aspectRatioLocked,
    sourceAspectRatio: frontend.sourceAspectRatio,
    fitMode: frontend.fitMode,
    volume: frontend.volume,
  };

  // Preserve all additional properties (e.g., TextClip properties)
  // Rust stores clips as Vec<serde_json::Value>, so it can handle any extra fields
  const rust = { ...baseClip, ...frontend } as any;
  const fAny = frontend as any;
  if (fAny.styleDefinition) {
    rust.style_definition = fAny.styleDefinition;
    delete rust.styleDefinition;
  }
  return rust as RustClip;
}

/**
 * Convert Frontend Gap to Rust Gap
 *
 * @param frontend - Frontend Gap (camelCase)
 * @returns Rust Gap (snake_case)
 */
export function toRustGap(frontend: Gap): RustGap {
  return {
    id: frontend.id,
    track_id: frontend.trackId,
    start_time: frontend.startTime,
    duration: frontend.duration,
    type: frontend.type,
    source: frontend.source,
    protected: frontend.protected,
    metadata: frontend.metadata
      ? {
          created_at: frontend.metadata.createdAt,
          note: frontend.metadata.note,
          replaced_clip_id: frontend.metadata.replacedClipId,
          user_created: frontend.metadata.userCreated,
        }
      : undefined,
  };
}

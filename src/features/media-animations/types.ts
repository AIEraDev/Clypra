/**
 * types.ts — Domain types for the Media Animation feature (Studio/Editor side)
 *
 * These types mirror the authoritative definitions in
 * clypra-api/src/features/media-animations/types.ts and
 * clypra-api/src/features/media-animations/mediaAnimationConstants.ts.
 *
 * The manifest compiler always runs server-side. These types are used for:
 * - Studio draft authoring
 * - Client-side geometry and timing evaluation
 * - Publishing client request/response shapes
 * - Editor preset consumption (read-only)
 */

// ── Constants (mirrors mediaAnimationConstants.ts) ─────────────────────────

export const MEDIA_ANIMATION_CATEGORIES = ["in", "out", "combo"] as const;
export type MediaAnimationCategory =
  (typeof MEDIA_ANIMATION_CATEGORIES)[number];

export const MEDIA_ANIMATION_TARGET_TYPES = ["image", "video"] as const;
export type MediaAnimationTargetType =
  (typeof MEDIA_ANIMATION_TARGET_TYPES)[number];

export const MEDIA_ANIMATION_RENDER_MODES = [
  "procedural",
  "asset_backed",
  "hybrid",
] as const;
export type MediaAnimationRenderMode =
  (typeof MEDIA_ANIMATION_RENDER_MODES)[number];

export const MEDIA_ANIMATION_DRAFT_STATUSES = [
  "draft",
  "validating",
  "pending_review",
  "approved",
  "rejected",
  "publishing",
  "published",
] as const;
export type MediaAnimationDraftStatus =
  (typeof MEDIA_ANIMATION_DRAFT_STATUSES)[number];

// ── 1. Rational Frame Timing & Half-Open Intervals ─────────────────────────

export interface RationalFrameRate {
  numerator: number;
  denominator: number;
}

/**
 * A half-open frame interval: [startFrame, endFrame).
 * Contains startFrame, excludes endFrame.
 * Duration in frames is strictly: endFrame - startFrame.
 */
export interface HalfOpenFrameInterval {
  startFrame: number;
  endFrame: number;
}

// ── 2. Keyframes and Property Tracks ───────────────────────────────────────

export type AnimatableProperty =
  | "positionX"
  | "positionY"
  | "scaleX"
  | "scaleY"
  | "rotation"
  | "opacity";

export type KeyframeInterpolation = "linear" | "step" | "bezier";

export interface Keyframe {
  /**
   * Layer-local integer frame offset within the half-open interval.
   * Must be a non-negative integer.
   */
  frame: number;
  /**
   * For positionX/positionY: normalized fractional offscreen offset in [-1, 1].
   * At runtime: pixelOffsetX = value * Math.abs(offscreenDistances.offLeft)
   *                         or value * offscreenDistances.offRight
   * For other properties: natural range (scale > 0, opacity [0,1], rotation degrees).
   */
  value: number;
  interpolation: KeyframeInterpolation;
  /** Cubic bezier control points [x1, y1, x2, y2] — only used when interpolation === "bezier" */
  easing?: [number, number, number, number];
}

export interface PropertyTrack {
  property: AnimatableProperty;
  keyframes: Keyframe[];
}

export interface PropertyCompositionRules {
  position: "additive";
  scale: "multiplicative";
  rotation: "additive";
  opacity: "multiplicative";
}

export const DEFAULT_COMPOSITION_RULES: PropertyCompositionRules = {
  position: "additive",
  scale: "multiplicative",
  rotation: "additive",
  opacity: "multiplicative",
};

// ── 3. Geometry: Offscreen Distance Computation ────────────────────────────

/**
 * Minimum pixel translations required to move a media element completely
 * off each edge of the composition canvas.
 *
 * offLeft:  always < 0          (translate by this amount to clear the left edge)
 * offRight: always > canvasWidth  (translate by this to clear the right edge)
 * offUp:    always < 0            (translate by this to clear the top edge)
 * offDown:  always > canvasHeight (translate by this to clear the bottom edge)
 */
export interface OffscreenDistances {
  offLeft: number;
  offRight: number;
  offUp: number;
  offDown: number;
}

// ── 4. Published Immutable Manifest ────────────────────────────────────────

export type DurationMode = "fixed" | "adjustable" | "clip_relative";

/**
 * ImmutableMediaAnimationManifest — the published, frozen preset definition.
 *
 * Exactly what is written to R2 and returned by the API.
 * Consumers MAY read all fields. They MUST NOT modify animation properties.
 *
 * Key constraints:
 * - renderMode is always "procedural" for the initial four presets
 * - assets is undefined (no binary files needed)
 * - No parameterSchema — direction/easing/duration are NOT user-modifiable
 * - direction is baked into positionX/positionY keyframe values
 * - contentHash is deterministic: stableStringify → SHA-256 → "sha256-<hex>"
 */
export interface ImmutableMediaAnimationManifest {
  // ── Identity ───────────────────────────────────────────────────────────────
  schemaVersion: 2;
  id: string;
  slug: string;
  name: string;
  description: string;

  // ── Classification ─────────────────────────────────────────────────────────
  family: "media_animation";
  category: MediaAnimationCategory;
  supportedMediaTypes: MediaAnimationTargetType[];

  // ── Rendering ─────────────────────────────────────────────────────────────
  renderMode: "procedural";

  // ── Timing ────────────────────────────────────────────────────────────────
  duration: {
    mode: "clip_relative";
    defaultFrames: number;
  };

  // ── Animation Tracks (direction baked in, not a runtime param) ─────────────
  tracks: PropertyTrack[];

  // ── Composition Rules ─────────────────────────────────────────────────────
  compositionRules: PropertyCompositionRules;

  // ── Assets: absent for procedural presets ─────────────────────────────────
  assets?: undefined;

  // ── Runtime Requirements ──────────────────────────────────────────────────
  runtimeRequirements: {
    minSchemaVersion: number;
  };

  // ── Versioning & Integrity ─────────────────────────────────────────────────
  version: string;
  /** "sha256-<64 hex chars>" — computed by contentHash() on the server */
  contentHash: string;
  publishedAt: string;
}

// ── 5. Studio Draft Document ───────────────────────────────────────────────

/**
 * MediaAnimationDraftDocument — editable Studio draft.
 *
 * This is what the Studio authors before submitting for review.
 * The manifest compiler (server-side compileCandidateManifest()) strips all
 * draft-only fields (previewContext, lockVersion, ownerId, status, etc.)
 * when producing the ImmutableMediaAnimationManifest.
 */
export interface MediaAnimationDraftDocument {
  schemaVersion: number;
  id: string;
  ownerId: number;
  name: string;
  description: string;
  family: "media_animation";
  category: MediaAnimationCategory;
  supportedMediaTypes: MediaAnimationTargetType[];
  renderMode: MediaAnimationRenderMode;
  resolution: {
    width: number;
    height: number;
  };
  frameRate: RationalFrameRate;
  durationFrames: number;
  lockVersion: number;
  tracks: PropertyTrack[];
  layers?: unknown[];
  previewContext?: PreviewContextConfig;
  status: MediaAnimationDraftStatus;
  submissionIdempotencyKey?: string;
  submissionNotes?: string;
  submittedAt?: string;
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PreviewContextConfig {
  kind: "checkerboard" | "solid" | "sample_clip";
  color?: string;
  sampleUrl?: string;
  targetMediaType: MediaAnimationTargetType;
  width: number;
  height: number;
}

// ── 6. Applied Animation (Editor consumption) ──────────────────────────────

/**
 * AppliedAnimation — an animation applied to a media clip in the Editor.
 *
 * The Editor applies the preset exactly as published.
 * These fields are read-only at runtime — the consumer cannot modify
 * internal animation properties (tracks, interval, category).
 */
export interface AppliedAnimation {
  /** Stable preset ID from the published manifest */
  animationId: string;
  /** Pinned version string (e.g. "1.0.0") */
  version: string;
  /** Content hash for integrity verification */
  contentHash: string;
  category: MediaAnimationCategory;
  /** Evaluated half-open interval on the clip's local timeline */
  interval: HalfOpenFrameInterval;
  /** Resolved tracks (position values converted to pixels at apply-time) */
  tracks: PropertyTrack[];
}

// ── 7. Catalog Summary (for discovery) ─────────────────────────────────────

export interface MediaAnimationCatalogSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: MediaAnimationCategory;
  supportedMediaTypes: MediaAnimationTargetType[];
  renderMode: MediaAnimationRenderMode;
  activeVersion: string;
  thumbnailUrl?: string;
  previewUrl?: string;
  isProcedural: boolean;
  published: boolean;
  updatedAt: string;
}

// ── 8. API Response Types ──────────────────────────────────────────────────

export interface ValidateDraftResponse {
  valid: boolean;
  errors: string[];
  warnings: string[];
  candidateManifest?: ImmutableMediaAnimationManifest;
}

export interface CreateDraftRequest {
  name: string;
  description?: string;
  category: MediaAnimationCategory;
  supportedMediaTypes?: MediaAnimationTargetType[];
  renderMode?: MediaAnimationRenderMode;
  durationFrames?: number;
  frameRate?: RationalFrameRate;
  tracks?: PropertyTrack[];
}

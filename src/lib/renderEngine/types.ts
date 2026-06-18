/**
 * Deterministic Media Render Engine — Core Types
 *
 * Glossary aligned with architecture spec:
 *   SpatialTier    — resolution level (L0–L3)
 *   TemporalTier   — frame sampling density (L0–L3)
 *   RenderTier     — { spatialTier, temporalTier }
 *   VelocityState  — bucketed scroll/zoom velocity (prevents epoch churn)
 *   RenderEpochId  — opaque hash of 9 visual-determinism dimensions
 *   FrameContentHash — content-addressed frame identity
 *   RenderArtifact — canonical backend→frontend transfer object
 */

// ─── Spatial Tier ─────────────────────────────────────────────────────────────

/**
 * Spatial resolution tiers. Widths are multiples of 4 (GPU compat).
 * Heights target 16:9; the "align to mult of 4" constraint applies to
 * textureSize after DPR multiplication, not to the base tier dims.
 *
 * CRITICAL: These dimensions MUST match src-tauri/src/thumbnail_engine/pyramid.rs SpatialTier::dims()
 * Any mismatch will cause thumbnail blur/stretching bugs.
 *
 * SRP zoom → tier mapping (default, configurable via SRP_CONFIG):
 *   L0: 0.25–0.5×  |  L1: 0.5–1×  |  L2: 1–2×  |  L3: 2–4×
 */
export enum SpatialTier {
  L0 = 0, // 160×90   — lowest resolution, widest zoom-out
  L1 = 1, // 240×135
  L2 = 2, // 320×180
  L3 = 3, // 480×270  — highest resolution, closest zoom-in
}

/** Base pixel dimensions [width, height] for each spatial tier. */
export const SPATIAL_TIER_DIMS: Record<SpatialTier, readonly [number, number]> = {
  [SpatialTier.L0]: [160, 90],
  [SpatialTier.L1]: [240, 135],
  [SpatialTier.L2]: [320, 180],
  [SpatialTier.L3]: [480, 270],
} as const;

// ─── Temporal Tier ────────────────────────────────────────────────────────────

/**
 * Temporal sampling density tiers.
 * Intervals are [base, near-edit] seconds.
 *
 * TSP viewport-density → tier mapping mirrors SpatialTier levels.
 *
 * CRITICAL: These values MUST match Rust DensityLevel::time_interval()
 * See: src-tauri/src/thumbnail_engine/types.rs:187-196
 */
export enum TemporalTier {
  L0 = 0, // 5.0s base (2.5s near edits) - matches Rust DensityLevel::Low
  L1 = 1, // 1.0s (0.5s near edits) - matches Rust DensityLevel::Medium
  L2 = 2, // 0.2s (0.1s near edits) - matches Rust DensityLevel::High
  L3 = 3, // 0.02s (0.01s near edits) - matches Rust DensityLevel::Ultra
}

/**
 * [baseInterval, nearEditInterval] in seconds per temporal tier.
 * MUST stay in sync with Rust DensityLevel::time_interval()
 */
export const TEMPORAL_TIER_INTERVALS: Record<TemporalTier, readonly [number, number]> = {
  [TemporalTier.L0]: [5.0, 2.5], // Matches Rust Low: 5.0
  [TemporalTier.L1]: [1.0, 0.5], // Matches Rust Medium: 1.0
  [TemporalTier.L2]: [0.2, 0.1], // Matches Rust High: 0.2
  [TemporalTier.L3]: [0.02, 0.01], // Matches Rust Ultra: 0.02
} as const;

/** High-motion region density multiplier (R1). */
export const HIGH_MOTION_DENSITY_MULTIPLIER = 1.5;

/** Edit-boundary forced precision: sample at this interval within EDIT_BOUNDARY_WINDOW. */
export const EDIT_BOUNDARY_SAMPLE_INTERVAL = 0.12; // seconds
export const EDIT_BOUNDARY_WINDOW = 0.5; // seconds around a cut

// ─── Render Tier ──────────────────────────────────────────────────────────────

/** Coupled by default (L0+L0); decoupled on demand. */
export interface RenderTier {
  readonly spatialTier: SpatialTier;
  readonly temporalTier: TemporalTier;
}

// ─── Velocity State ───────────────────────────────────────────────────────────

/**
 * Bucketed scroll/zoom velocity. Prevents epoch churn from raw px/s values.
 *
 * Thresholds are SPEC-DERIVED:
 *   R3:  epoch rejected when scrollVelocity changes >100 px/s → Slow/Fast boundary at 100
 *   R13: skip intermediate tiers when zoom velocity >200 px/s → Fast/Ballistic boundary at 200
 *   50 px/s as Stable/Slow provides one hysteresis bucket before R3 triggers.
 */
export enum VelocityState {
  Stable = 0, // < 50 px/s    — normal rendering, all tiers eligible
  Slow = 1, // 50–100 px/s  — approaching R3 epoch rejection threshold
  Fast = 2, // 100–200 px/s — epoch rejection active (R3)
  Ballistic = 3, // > 200 px/s   — skip intermediate tiers (R13)
}

/** Velocity thresholds in px/s (derived from R3 and R13). */
export const VELOCITY_THRESHOLDS = {
  STABLE_MAX: 50,
  SLOW_MAX: 100, // R3: epoch rejection above this
  FAST_MAX: 200, // R13: tier-skipping above this
} as const;

/** Classify raw scroll velocity into a VelocityState bucket. */
export function classifyVelocity(pxPerSec: number): VelocityState {
  const abs = Math.abs(pxPerSec);
  if (abs < VELOCITY_THRESHOLDS.STABLE_MAX) return VelocityState.Stable;
  if (abs < VELOCITY_THRESHOLDS.SLOW_MAX) return VelocityState.Slow;
  if (abs < VELOCITY_THRESHOLDS.FAST_MAX) return VelocityState.Fast;
  return VelocityState.Ballistic;
}

// ─── Interaction State ────────────────────────────────────────────────────────

export enum InteractionState {
  Idle = "idle",
  Zooming = "zooming",
  Scrubbing = "scrubbing",
  Scrolling = "scrolling",
  Converging = "converging",
}

// ─── Renderer Mode ────────────────────────────────────────────────────────────

/**
 * Part of epoch identity because Canvas2D and WebGL can differ in:
 * filtering, alpha handling, coordinate rounding, atlas bleed, color conversion.
 */
export enum RendererMode {
  Canvas2D = "canvas2d",
  WebGL = "webgl",
}

// ─── Quality Preset ───────────────────────────────────────────────────────────

/** Quality preset determines which spatial tiers are eligible (R14). */
export enum QualityPreset {
  Low = "low", // L0, L1
  Medium = "medium", // L0, L1, L2  (default)
  High = "high", // L0–L3
  Ultra = "ultra", // L0–L3 at 2× DPR
}

/** Eligible spatial tiers per quality preset. */
export const QUALITY_PRESET_TIERS: Record<QualityPreset, readonly SpatialTier[]> = {
  [QualityPreset.Low]: [SpatialTier.L0, SpatialTier.L1],
  [QualityPreset.Medium]: [SpatialTier.L0, SpatialTier.L1, SpatialTier.L2],
  [QualityPreset.High]: [SpatialTier.L0, SpatialTier.L1, SpatialTier.L2, SpatialTier.L3],
  [QualityPreset.Ultra]: [SpatialTier.L0, SpatialTier.L1, SpatialTier.L2, SpatialTier.L3],
} as const;

// ─── Responsiveness Mode ──────────────────────────────────────────────────────

export enum ResponsivenessMode {
  Strict = "strict", // No approximation during interaction
  Balanced = "balanced", // 500ms max approximation (default)
  Fluid = "fluid", // 1000ms, prioritise 60 FPS
}

// ─── Epoch ────────────────────────────────────────────────────────────────────

/** Opaque SHA-256-like hash of 9 visual-determinism dimensions. */
export type RenderEpochId = string & { readonly __brand: "RenderEpochId" };

/**
 * The 9 dimensions that form epoch identity.
 * These are the ONLY things that affect the safety of committing a render result.
 *
 * NOT in epoch (scheduler/runtime only):
 *   memoryPressureState → RenderScheduler.suspend()
 *   preloadInterferenceFlag → RenderScheduler priority queue
 */
export interface EpochDimensions {
  clipId: string;
  clipVersion: number;
  transformGraphVersion: number;
  viewportBounds: ViewportBounds;
  velocityState: VelocityState;
  zoomLevel: number;
  spatialTier: SpatialTier;
  temporalTier: TemporalTier;
  rendererMode: RendererMode;
}

// ─── Frame Content Hash ───────────────────────────────────────────────────────

/**
 * Content-addressed frame identity.
 * SHA-256 of: videoSourceId, decodeParams, effectGraphVersion, speed, trimRange, fpsNormalization.
 * Changing any of these produces a new hash and new cache entries — no invalidation of other clips.
 */
export type FrameContentHash = string & { readonly __brand: "FrameContentHash" };

/** Canonical timestamp: deterministic from adaptive sampling grid, ms-precision. */
export type CanonicalFrameTimestamp = number;

// ─── Render Artifact ─────────────────────────────────────────────────────────

export type ArtifactSource = "backend-frame-cache" | "backend-tier-cache" | "frontend-tier-cache";
export type ArtifactResidency = "gpu" | "cpu" | "disk";

/**
 * Frontend RenderArtifact - contains ImageBitmap ready for rendering.
 *
 * This is the FRONTEND representation after conversion from BackendRenderArtifact.
 * The conversion layer (transport.ts) handles RGBA bytes → ImageBitmap conversion.
 *
 * See: src/lib/renderEngine/transport.ts BackendRenderArtifact for the backend shape
 */
export interface RenderArtifact {
  readonly frameId: string;
  readonly contentHash: FrameContentHash;
  readonly spatialTier: SpatialTier;
  readonly buffer: ImageBitmap;
  readonly source: ArtifactSource;
  readonly residency: ArtifactResidency;
  readonly timestamp: CanonicalFrameTimestamp;
}

// ─── Render Job ───────────────────────────────────────────────────────────────

export enum Priority {
  Critical = 0,
  High = 1,
  Normal = 2,
}

export interface RenderJob {
  readonly jobId: string;
  readonly clipId: string;
  readonly contentHash: FrameContentHash;
  readonly spatialTier: SpatialTier;
  readonly timestamp: CanonicalFrameTimestamp;
  readonly priority: Priority;
  readonly epochId: RenderEpochId;
  readonly enqueuedAt: number; // performance.now()
}

// ─── Render State ─────────────────────────────────────────────────────────────

/** Reactive state exposed to React via hooks. */
export interface RenderState {
  readonly clipId: string;
  readonly currentTier: RenderTier;
  readonly targetTier: RenderTier;
  readonly epochId: RenderEpochId;
  readonly interactionState: InteractionState;
  readonly visibleArtifacts: readonly any[]; // TransportArtifact[] - using any to avoid circular dependency
  readonly isFallback: boolean;
}

// ─── Viewport ─────────────────────────────────────────────────────────────────

export interface ViewportBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Viewport_Window = visible ± 2 screen widths (R7). */
export const VIEWPORT_WINDOW_FACTOR = 2;
/** Cancel generation for regions scrolled >3 screen widths out (R7). */
export const VIEWPORT_CANCEL_FACTOR = 3;

// ─── Invalidation ─────────────────────────────────────────────────────────────

export type InvalidationReason =
  | "tier-change-spatial"
  | "tier-change-temporal"
  | "clip-trim-modified"
  | "viewport-shift-major" // >50% visible width
  | "cache-key-mismatch"
  | "clip-moved"
  | "clip-deleted"
  | "clip-modified"
  | "dpr-change";

// ─── SRP Config ───────────────────────────────────────────────────────────────

export interface TierBoundary {
  readonly min: number; // zoom level (inclusive)
  readonly max: number; // zoom level (exclusive)
}

export type SrpConfig = Record<SpatialTier, TierBoundary>;

/** Default SRP tier boundaries per spec R1.
 *
 * Extended L0 minimum to 0.1× to handle deep zoom-out without blurriness.
 * L0 (160×90) thumbnails are now used from 0.1× to 0.5× zoom levels.
 */
export const DEFAULT_SRP_CONFIG: SrpConfig = {
  [SpatialTier.L0]: { min: 0.1, max: 0.5 }, // Extended from 0.25 to 0.1 for deep zoom-out
  [SpatialTier.L1]: { min: 0.5, max: 1.0 },
  [SpatialTier.L2]: { min: 1.0, max: 2.0 },
  [SpatialTier.L3]: { min: 2.0, max: 4.0 },
} as const;

// ─── ISM Output ───────────────────────────────────────────────────────────────

/** ISM emits constraints — never selects tiers directly (R1). */
export interface IsmUpdate {
  readonly zoomLevel: number;
  readonly viewportDensityHint: number;
  readonly velocityState: VelocityState;
  readonly interactionState: InteractionState;
  readonly epochTrigger: boolean; // true = validate epoch now
}

// ─── Idle Task ────────────────────────────────────────────────────────────────

export interface IdleTask {
  readonly id: string;
  readonly priority: Priority;
  readonly execute: () => Promise<void>;
}

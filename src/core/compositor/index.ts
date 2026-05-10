/**
 * Core compositor module - time-based frame resolution engine.
 *
 * This is the heart of the NLE. It provides:
 * - Time-centric (not track-centric) frame resolution
 * - Compositing stack evaluation (not single-layer)
 * - Deterministic rendering order
 * - Pure functions (no side effects)
 * - Validation (diagnostic, not blocking)
 *
 * Philosophy:
 * - Timeline is a time-sliced function
 * - At every frame, resolve the render stack
 * - Clips have roles, not tracks
 * - Validation informs, never blocks
 * - One source of truth for all rendering
 */

// Types
export type { CompositorClip, RenderLayer, RenderStack, EvaluatedClip, ClipRole, TimeRange, TimelineValidation } from "./types";

// Resolver (core engine)
export { resolveRenderStack, evaluateClipAtTime, evaluateClip, getClipsInRange, hasContentAtTime } from "./resolver";

// Validator (diagnostics)
export { validateTimeline, validateForExport } from "./validator";

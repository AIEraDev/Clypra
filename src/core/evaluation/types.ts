/**
 * Canonical Evaluated Scene Types
 *
 * This is the UNIVERSAL ENGINE CURRENCY.
 * Everything consumes this structure:
 * - Preview rendering
 * - Export rendering
 * - Thumbnail generation
 * - Proxy rendering
 * - Timeline validation
 *
 * The renderer should ONLY know about EvaluatedScene, not clips/tracks/timeline.
 */

import type { ClipRole } from "../compositor/types";
import type { RenderResourceHandle } from "../resources/types";
import type { ClipKind } from "@/types";

/**
 * Base properties shared by all visual layers.
 */
interface BaseVisualLayer {
  /** Unique layer ID (for React keys, caching) */
  readonly layerId: string;

  /** Source clip ID (for debugging, cache invalidation) */
  readonly clipId: string;

  /** Semantic role (for compositing logic) */
  readonly role: ClipRole;

  /** Semantic kind of the clip */
  readonly clipKind?: ClipKind;

  /** Z-order (0 = background, higher = foreground) */
  readonly zIndex: number;

  /** Track index of the clip */
  readonly trackIndex?: number;

  /** Layer type discriminator */
  readonly layerType: "media" | "text";

  // ─── Transform ────────────────────────────────────────────────────────────

  /** Canvas position X */
  readonly x: number;

  /** Canvas position Y */
  readonly y: number;

  /** Render width */
  readonly width: number;

  /** Render height */
  readonly height: number;

  /** Rotation in degrees (clockwise) */
  readonly rotation: number;

  /** Opacity (0.0 - 1.0, includes transition fade) */
  readonly opacity: number;

  // ─── Transition State ─────────────────────────────────────────────────────

  /** Whether this layer is currently in a transition */
  readonly inTransition: boolean;

  /** Transition type (if in transition) - supports all TransitionRenderer types */
  readonly transitionType?: EvaluatedTransition["type"];

  /** Transition progress (0.0 - 1.0, if in transition) */
  readonly transitionProgress?: number;

  /** Blend mode for compositing */
  readonly blendMode: BlendMode;

  // ─── Effects (Phase 2) ────────────────────────────────────────────────────

  /** Active effects at this time (future) */
  readonly effects?: EvaluatedEffect[];

  // ─── Masks (Phase 3) ──────────────────────────────────────────────────────

  /** Active masks at this time (future) */
  readonly masks?: EvaluatedMask[];
}

/**
 * Evaluated media layer (video/image) at a specific time.
 * All time-dependent properties are resolved (transitions, keyframes, etc.)
 */
export interface EvaluatedMediaLayer extends BaseVisualLayer {
  readonly layerType: "media";

  // ─── Source Media ─────────────────────────────────────────────────────────

  /** Media asset ID */
  readonly mediaId: string;

  /** Media type */
  readonly mediaType: "video" | "image";

  /** Source file path (Tauri-converted URL) */
  readonly sourcePath: string;

  /** Track index (for compositor debugging and z-order verification) */
  readonly trackIndex?: number;

  /** Render resource handle (for pre-resolved resources) */
  readonly resourceHandle?: RenderResourceHandle;

  /** Poster frame for video (optional) */
  readonly posterFrame?: string;

  /** Time within source media (accounting for trim + playback position) */
  readonly sourceTime: number;

  /** Source media rotation from container metadata (0, 90, 180, 270) */
  readonly sourceRotation?: number;

  /** Sticker-specific settings */
  readonly stickerSettings?: { speed: number; loop: boolean };
  readonly stickerFormat?: "static" | "gif" | "lottie";
  readonly stickerAnimationPath?: string;
  readonly stickerSourceId?: string;

  /** Active color filter on this layer */
  readonly filter?: { id: string; name: string; intensity: number };

  /** Layout parameters for the clip fitting/cropping/transforming */
  readonly layout?: any;

  /** Professional conform settings */
  readonly conform?: import("@clypra-studio/engine").ClipConform;
  readonly adjustments?: import("@clypra-studio/engine").ColorAdjustments;

  /** Dimensions of the original source media file */
  readonly sourceWidth?: number;
  readonly sourceHeight?: number;

  /** Combined transition-driven opacity fade contribution */
  readonly transitionOpacity?: number;
}

/**
 * Evaluated text layer at a specific time.
 * This is a SYNTHETIC layer - content generated at render time.
 */
export interface EvaluatedTextLayer extends BaseVisualLayer {
  readonly layerType: "text";

  /** The current playhead time in seconds */
  readonly time?: number;

  /** The clip start time on timeline */
  readonly clipStartTime?: number;

  /** The clip duration */
  readonly clipDuration?: number;

  // ─── Text Content ─────────────────────────────────────────────────────────

  /** Text content to render */
  readonly text: string;

  /** Font family */
  readonly fontFamily: string;

  /** Font size in pixels (at canvas resolution) */
  readonly fontSize: number;

  /** Text color (CSS color string) */
  readonly color: string;

  /** Font weight (normal, bold, or numeric 100-900) */
  readonly fontWeight: "normal" | "bold" | number;

  /** Font style */
  readonly fontStyle: "normal" | "italic";

  /** Text alignment */
  readonly textAlign: "left" | "center" | "right";

  /** Vertical alignment */
  readonly verticalAlign: "top" | "middle" | "bottom";

  /** Line height multiplier */
  readonly lineHeight: number;

  /** Letter spacing in pixels */
  readonly letterSpacing: number;

  // ─── Text Styling (Phase 2) ───────────────────────────────────────────────

  /** Text stroke/outline */
  readonly stroke?: {
    color: string;
    width: number;
  };

  /** Text shadow */
  readonly shadow?: {
    color: string;
    blur: number;
    offsetX: number;
    offsetY: number;
  };

  /** Background box */
  readonly background?: {
    color: string;
    padding: number;
    borderRadius: number;
  };

  /** Style preset ID for text effects */
  readonly styleId?: string;
  readonly styleDefinition?: import("@clypra-studio/engine").TextEffectDefinition;

  /** Template-specific settings */
  readonly templateId?: string;
  readonly customization?: any;
}

/**
 * Union type for all visual layers.
 * Renderer uses this to handle both media and text uniformly.
 */
export type EvaluatedVisualLayer = EvaluatedMediaLayer | EvaluatedTextLayer;

/**
 * Evaluated audio layer at a specific time.
 */
export interface EvaluatedAudioLayer {
  /** Unique layer ID */
  readonly layerId: string;

  /** Source clip ID */
  readonly clipId: string;

  /** Media asset ID */
  readonly mediaId: string;

  /** Source file path */
  readonly sourcePath: string;

  /** Time within source media */
  readonly sourceTime: number;

  /** Volume (0.0 - 1.0) */
  readonly volume: number;

  /** Pan (-1.0 left, 0.0 center, 1.0 right) */
  readonly pan: number;

  /** Audio priority (higher = more important for mixing) */
  readonly priority: number;

  /** Whether this audio is muted */
  readonly muted: boolean;
}

/**
 * Evaluated transition between two layers.
 */
export interface EvaluatedTransition {
  /** Transition ID */
  readonly transitionId: string;

  /** Transition type - uses TransitionRenderer from @clypra-studio/engine for single source of truth */
  readonly type: import("@clypra-studio/engine").TransitionRendererType;

  /** GPU transition renderer ID (from API or engine) - used to resolve actual GPU implementation */
  readonly renderer?: string;

  /** Progress (0.0 - 1.0) */
  readonly progress: number;

  /** Duration in seconds */
  readonly duration: number;

  /** Outgoing layer (fading out) */
  readonly outgoingLayer: string; // layerId

  /** Incoming layer (fading in) */
  readonly incomingLayer: string; // layerId

  /** Blend mode */
  readonly blendMode: BlendMode;

  /** Optional transition parameters from @clypra-studio/engine */
  readonly params?: import("@clypra-studio/engine").TransitionParameters;
}

/**
 * Blend modes for compositing.
 */
export type BlendMode = "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten" | "add" | "subtract";

/**
 * Evaluated effect (future).
 */
export interface EvaluatedEffect {
  readonly effectId: string;
  readonly type: "video_effect" | "body_effect";
  readonly renderer: string;
  readonly parameters: Record<string, any>;
  readonly intensity: number;
  readonly localTime: number;
}

/**
 * Evaluated mask (future).
 */
export interface EvaluatedMask {
  readonly maskId: string;
  readonly type: "rectangle" | "circle" | "polygon";
  readonly geometry: any; // TBD
  readonly feather: number;
  readonly inverted: boolean;
}

/**
 * Scene metadata.
 */
export interface SceneMetadata {
  /** Timeline time this scene represents */
  readonly time: number;

  /** Canvas dimensions */
  readonly canvasWidth: number;
  readonly canvasHeight: number;

  /** Frame rate */
  readonly frameRate: number;

  /** Whether this is a gap (no content) */
  readonly isGap: boolean;

  /** Fallback strategy if gap */
  readonly fallbackStrategy?: "black" | "freeze" | "transparent" | "placeholder";

  /** Timeline epoch (for cache invalidation) */
  readonly epochId?: string;

  /** Hash of currently active media clips (for sync effect triggering) */
  readonly activeMediaHash?: string;
}

/**
 * Complete evaluated scene at a specific time.
 *
 * This is the CANONICAL structure that all renderers consume.
 * The renderer should ONLY know about this, not clips/tracks/timeline.
 */
export interface EvaluatedScene {
  /** Visual layers (sorted bottom-to-top for compositing) */
  readonly visualLayers: readonly EvaluatedVisualLayer[];

  /** Audio layers (sorted by priority) */
  readonly audioLayers: readonly EvaluatedAudioLayer[];

  /** Active transitions */
  readonly transitions: readonly EvaluatedTransition[];

  /** Scene metadata */
  readonly metadata: SceneMetadata;

  /** Active track-level filter at this playhead time */
  readonly activeFilter?: {
    id: string;
    name: string;
    intensity: number;
    pipeline?: "v2";
    effectStack?: ReadonlyArray<{ type: string; params?: Record<string, unknown> }>;
  };
}

/**
 * Evaluation cache key.
 * Used to cache evaluated scenes and avoid re-evaluation.
 */
export interface EvaluationCacheKey {
  /** Timeline time (rounded to frame precision) */
  readonly time: number;

  /** Timeline epoch (invalidates cache when timeline changes) */
  readonly epochId: string;

  /** Clip version (invalidates cache when clips change) */
  readonly clipVersion: number;

  /** Transform version (invalidates cache when transforms change) */
  readonly transformVersion: number;
}

/**
 * Evaluation result with cache metadata.
 */
export interface EvaluationResult {
  /** The evaluated scene */
  readonly scene: EvaluatedScene;

  /** Cache key for this evaluation */
  readonly cacheKey: EvaluationCacheKey;

  /** Whether this came from cache */
  readonly fromCache: boolean;

  /** Evaluation time in ms */
  readonly evaluationTimeMs: number;
}

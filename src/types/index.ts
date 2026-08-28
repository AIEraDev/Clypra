import type { AudioFadeCurve, AudioFXConfig, AudioKeyframe, ClipAudioProperties } from "./audio";

export type AspectRatio = "original" | "16:9" | "9:16" | "1:1" | "4:5" | "21:9" | "4:3";

export type {
  AudioChannelConfig,
  AudioChannelMode,
  AudioClipOrigin,
  AudioDownmixMode,
  AudioFadeCurve,
  AudioFadeSettings,
  AudioFXConfig,
  AudioKeyframe,
  AudioLinkState,
  AudioSpeedConfig,
  ClipAudioProperties,
} from "./audio";
export { AUDIO_MODEL_VERSION, dbToLinearGain, getClipAudioProperties, linearGainToDb, normalizeClipAudioProperties, synchronizeClipAudioProperties } from "./audio";

/**
 * Maximum project name length.
 * CRITICAL: Must match src-tauri/src/commands/project.rs:83 MAX_PROJECT_NAME_LENGTH
 */
export const MAX_PROJECT_NAME_LENGTH = 64;

export const PREVIEW_ASPECT_LABEL: Record<AspectRatio, string> = {
  original: "Original",
  "16:9": "16:9 (YouTube)",
  "9:16": "9:16 (Reels/Shorts)",
  "1:1": "1:1 (Instagram)",
  "4:5": "4:5 (Instagram)",
  "21:9": "21:9 (Cinematic)",
  "4:3": "4:3 (Standard/Tablet)",
};

export enum DensityLevel {
  Low = "low",
  Medium = "medium",
  High = "high",
  Ultra = "ultra",
}

/**
 * CRITICAL: DensityLevel serialization format must match Rust.
 * See: src-tauri/src/thumbnail_engine/types.rs:178-184
 * Serialized as lowercase strings matching the enum values above.
 */

export interface DensityConfig {
  level: DensityLevel;
  interval: number;
  minZoom: number;
  maxZoom: number;
}

export interface ThumbnailRequest {
  videoPath: string;
  timestamps: number[];
  density: DensityLevel;
  width: number;
  height: number;
}

export interface ThumbnailTile {
  time: number;
  path: string;
  density: DensityLevel;
  atlas_coords?: {
    col: number;
    row: number;
    thumb_width: number;
    thumb_height: number;
  };
  actual_width?: number;
  actual_height?: number;
}

export interface FilmstripState {
  tiles: Map<number, ThumbnailTile>;
  loadingTimestamps: Set<number>;
  currentDensity: DensityLevel;
  posterFrame: string | null;
}

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  fps: number;
  size: number;
  /** Source media rotation from container metadata (0, 90, 180, 270) */
  rotation?: number;
  /** Image alpha channel detection */
  has_alpha?: boolean;
}

export interface CanvasBackgroundConfig {
  type: "solid" | "gradient" | "shader" | "media";
  color?: string; // HEX/RGBA color
  gradient?: {
    type: "linear" | "radial";
    stops: Array<{ color: string; offset: number }>;
    angle?: number;
  };
  shader?: {
    presetId: "liquid_aurora" | "neon_grid" | "particle_dust" | "gradient_wave";
    speed?: number;
    intensity?: number;
    colors?: string[];
  };
  mediaUrl?: string;
  opacity?: number;
  isTransparent?: boolean;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  aspectRatio: AspectRatio;
  canvasWidth: number;
  canvasHeight: number;
  frameRate: 24 | 30 | 60;
  duration: number;
  canvasBackground?: CanvasBackgroundConfig;
  mediaAssets?: MediaAsset[];
  markers?: TimelineMarker[];
  /** Optional live preview snapshot / cover image data URL */
  thumbnail?: string;
  /** Timeline schema version for forward-compatible project migrations. */
  timelineSchemaVersion?: number;
  /** Version of the first-class audio clip model. */
  audioModelVersion?: number;
  /** Version of the first-class caption model. */
  captionModelVersion?: number;
}

export type TrackType = "video" | "audio" | "text" | "sticker" | "filter" | "video-effect" | "body-effect" | "animated-overlay";

export interface Track {
  id: string;
  type: TrackType;
  name: string;
  muted: boolean;
  locked: boolean;
  visible: boolean;
  height: number;
  /** Optional track volume multiplier (0.0 to 2.0, default 1.0) */
  volume?: number;
  /** Solo silences all non-solo tracks without changing their mute state. */
  solo?: boolean;
}

/** Audio/video stream metadata cached from the native media probe. */
export interface MediaStreamInfo {
  index: number;
  type: "audio" | "video" | "data" | "subtitle" | "unknown";
  codec: string;
  codecLongName?: string;
  duration?: number;
  timeBaseNum?: number;
  timeBaseDen?: number;
  sampleRate?: number;
  channels?: number;
  channelLayout?: string;
  bitrate?: number;
  language?: string;
  label?: string;
}

export interface DerivedMediaProvenance {
  sourceAssetId: string;
  sourceStreamIndex: number;
  extractionMethod: "streamCopy" | "transcode";
  operationFingerprint: string;
}

/** Waveform bucket containing peak and RMS amplitude data */
export interface WaveformBucket {
  /** Peak amplitude (absolute max) - range [0.0, 1.0] */
  peak: number;
  /** RMS amplitude (perceived loudness) - range [0.0, 1.0] */
  rms: number;
}

/**
 * MediaAsset interface with optional fields for different media types.
 *
 * Type-specific fields:
 * - width/height: Present for video and image, undefined for audio
 * - posterFrame: Present for video and image
 * - coverArt: Present for audio
 *
 * Use type guards from this module to safely access type-specific properties.
 */
export interface MediaAsset {
  id: string;
  name: string;
  path: string;
  type: "video" | "audio" | "image";
  duration: number;
  width?: number;
  height?: number;
  posterFrame?: string;
  coverArt?: string;
  /** Optional non-destructive visual content bounds inside the raster source. */
  contentBounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  size: number;
  /** Source media rotation from container metadata (0, 90, 180, 270) */
  rotation?: number;
  /** Whether image has alpha channel */
  has_alpha?: boolean;
  /** Sticker source format when this media asset represents a sticker. */
  stickerFormat?: "static" | "gif" | "lottie";
  /** Local cached animation source path for animated stickers. */
  stickerAnimationPath?: string;
  /** Stable sticker library id used to recover cached metadata. */
  stickerSourceId?: string;
  streams?: MediaStreamInfo[];
  derivedFrom?: DerivedMediaProvenance;
  /** Whether the media asset file was detected as missing/offline on disk */
  isMissing?: boolean;
}

/** Type guard to check if asset has visual dimensions */
export function hasVisualDimensions(asset: MediaAsset): asset is MediaAsset & { width: number; height: number } {
  return (asset.type === "video" || asset.type === "image") && asset.width !== undefined && asset.height !== undefined;
}

export type ClipKind = "video" | "audio" | "image" | "sticker" | "text" | "filter" | "video-effect" | "body-effect" | "animated-overlay" | "smart-overlay" | "compound";
/** Semantic participation of a clip in the compositor. */
export type ClipRole = "primary" | "overlay" | "text" | "effect" | "background" | "audio";
export type { SmartOverlayClip, SmartOverlayType, SmartOverlayContentUnion, SmartOverlayStyle, SmartOverlayPreset } from "./smartOverlay";




export interface Clip {
  id: string;
  name?: string;
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
  // Transform constraints
  aspectRatioLocked?: boolean; // Default true for video/images
  sourceAspectRatio?: number; // Original aspect ratio (width/height)
  /** Placement fit mode used for deterministic reset/re-fit behavior. */
  fitMode?: "contain" | "cover" | "fill" | "stretch" | "original";
  /** Professional conform settings */
  conform?: import("@clypra-studio/engine").ClipConform;
  /** Audio volume (0.0 to 1.0, default 1.0) */
  volume?: number;
  /** Audio fade in duration in seconds */
  fadeIn?: number;
  /** Audio fade out duration in seconds */
  fadeOut?: number;
  /** Audio fade in curve profile */
  fadeInCurve?: AudioFadeCurve;
  /** Audio fade out curve profile */
  fadeOutCurve?: AudioFadeCurve;
  /** Audio volume automation keyframe points */
  volumeKeyframes?: AudioKeyframe[];
  /** Audio FX processing configuration (EQ, Noise, Compressor, Pan) */
  audioFX?: AudioFXConfig;
  /** Canonical first-class audio model. Legacy fields above remain during migration. */
  audio?: ClipAudioProperties;
  /** Semantic compositor role. Background/effect roles are structural; normal visual clips stack by track. */
  role?: ClipRole;
  /** Persisted ordering within a track. Lower values draw first. */
  zIndex?: number;
  /** Stable final tie-breaker for otherwise identical clip placement. */
  evaluationPriority?: number;
  kind?: ClipKind; // Optional for backward compatibility
  /** Video overlays (actual video files like smoke, fire, light leaks) */
  overlays?: ClipOverlay[];
  /** Video effects (behavior-driven like shake, blur, glitch) */
  effects?: ClipEffect[];
  /** Legacy filter support (deprecated, use effects instead) */
  filter?: {
    id: string;
    name: string;
    intensity: number; // 0.0 to 1.0
  };
  stickerFormat?: "static" | "gif" | "lottie";
  stickerAnimationPath?: string;
  stickerSourceId?: string;
  stickerImagePath?: string;
  /** Text template ID for text clips */
  templateId?: string;
  /** Template catalog version captured when this clip was created. */
  templateVersion?: number;
  /** Immutable template revision captured when this clip was created. */
  templateRevisionId?: string;
  templateContentHash?: string;
  templateSnapshot?: import("@clypra-studio/engine").TextTemplate;
  templateDependencies?: Array<{
    effectId: string;
    revisionId: string;
    contentHash: string;
    snapshot?: import("@clypra-studio/engine").SceneDocument;
  }>;
  /** Direct visual URL retained by template image children when no media asset exists. */
  mediaUrl?: string;
  adjustments?: import("@clypra-studio/engine").ColorAdjustments;
  /** GPU UltraKey Chroma Key configuration */
  chromaKey?: import("./compositor").ChromaKeyConfig;
  /** GPU Color grading and 3D LUT uniforms */
  colorGrade?: import("./compositor").ColorGradeUniforms;
  /** Clip-level markers pinned to local clip time */
  markers?: ClipMarker[];
  /** Visual property animation keyframes */
  visualKeyframes?: Partial<Record<VisualPropertyKey, VisualPropertyKeyframe[]>>;
  audioPath?: string;
  /** Source clip identity for generated detach-audio clips. */
  detachedFromClipId?: string;
  /** Nested children for a persisted compound/group clip. Child times are relative to the parent. */
  compoundChildren?: Clip[];
  /** Optional preview image used by the compact parent timeline block. */
  compoundPreview?: string;
}

import type { Keyframe, KeyframeEasing } from "./keyframes";

export type EasingType = KeyframeEasing;

export interface VisualPropertyKeyframe extends Keyframe<number> {
  easing?: EasingType;
}

export type VisualPropertyKey = "x" | "y" | "width" | "height" | "rotation" | "opacity";

/** Video overlay applied to a clip (actual video file) */
export interface ClipOverlay {
  id: string;
  effectId: string; // Reference to OverlayAsset
  type: "overlay";
  url: string; // Object URL of downloaded overlay

  // Transform
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;

  // Appearance
  opacity: number;
  blendMode: BlendMode;

  // Timing (relative to clip)
  startTime: number;
  duration: number;
  loop: boolean;
}

/** Video effect applied to a clip (behavior-driven) */
export interface ClipEffect {
  id: string;
  effectId: string; // Reference to EffectPreset
  type: "effect";
  renderer: string; // "shake", "blur", "glitch", etc.
  params: Record<string, any>; // Effect-specific parameters
  name?: string;

  // Timing (relative to clip)
  startTime: number;
  duration: number;

  // Intensity control
  intensity: number; // 0-1
  keyframes?: Array<{
    time: number;
    intensity: number;
    easing: string;
  }>;
}

/** Blend modes for overlays */
export type BlendMode = "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten" | "color-dodge" | "color-burn" | "hard-light" | "soft-light" | "difference" | "exclusion" | "add" | "subtract";

export interface VideoClip extends Clip {
  kind: "video";
}

export interface AudioClip extends Clip {
  kind: "audio";
  /** Direct audio file path (used for audio library items that bypass mediaAssets) */
  audioPath?: string;
}

export interface ImageClip extends Clip {
  kind: "image";
}

export interface StickerClip extends Clip {
  kind: "sticker";
}

export interface FilterClip extends Clip {
  kind: "filter";
  name: string;
  intensity: number; // 0.0 to 1.0
  /** V2 MPG stack from Filter Lab — rendered via MPG pipeline when present */
  pipeline?: "v2";
  effectStack?: Array<{ type: string; params?: Record<string, unknown> }>;
}

export interface VideoEffectClip extends Clip {
  kind: "video-effect";
  name: string;
  intensity: number; // 0.0 to 1.0
  renderer: string; // "shake", "blur", "glitch", etc.
  params: Record<string, any>; // Effect-specific parameters
}

export interface BodyEffectClip extends Clip {
  kind: "body-effect";
  name: string;
  intensity: number; // 0.0 to 1.0
  renderer: string; // "body_glow", "body_outline", etc.
  params: Record<string, any>; // Effect-specific parameters
  requirements?: {
    bodySegmentation?: boolean;
    minConfidence?: number;
  };
}

export interface AnimatedOverlayClip extends Clip {
  kind: "animated-overlay";
  name: string;
  sourceUrl: string; // Local cached video path (via convertFileSrc)
  opacity: number; // 0.0 to 1.0
  blendMode: BlendMode;
  loop: boolean;
}

/** Word-level timestamp for karaoke-style caption highlighting */
export interface CaptionWord {
  word: string; // "Welcome"
  start: number; // 0.0 (relative to segment start)
  end: number; // 0.5
  probability?: number; // 0.98 (Whisper confidence score)
}

export type TextAnimationType = "none" | "fade" | "slide-up" | "slide-down" | "slide-left" | "slide-right" | "scale" | "zoom-in" | "zoom-out";

export interface TextAnimation {
  type: TextAnimationType;
  duration: number; // in seconds
  easing: "linear" | "ease-in" | "ease-out" | "ease-in-out";
}

export interface TextClip extends Clip {
  kind: "text";
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight?: string | number;
  fontStyle?: "normal" | "italic";
  color: string;
  backgroundColor?: string;
  align: "left" | "center" | "right";
  valign: "top" | "middle" | "bottom";
  lineHeight: number;
  letterSpacing?: number;
  maxWidth?: number;
  paddingX: number;
  paddingY: number;
  styleId?: string;
  /** Effect catalog version captured when this clip was created. */
  styleVersion?: number;
  /** Immutable effect revision captured when this clip was created. */
  styleRevisionId?: string;
  styleContentHash?: string;
  styleSnapshot?: import("@clypra-studio/engine").SceneDocument;
  /** Effect parameters captured when this clip was created. */
  parameterOverrides?: Record<string, any>;
  templateId?: string;
  customization?: any;
  /** Role of the text clip: caption for subtitles, title for decorative text/graphics */
  textRole?: "caption" | "title";
  /** Word-level timestamps for karaoke-style caption highlighting (optional) */
  words?: CaptionWord[];
  stroke?: {
    color: string;
    width: number;
  };
  shadow?: {
    color: string;
    blur: number;
    offsetX: number;
    offsetY: number;
  };
  background?: {
    color: string;
    padding: number;
    borderRadius: number;
  };
  styleDefinition?: import("@clypra-studio/engine").TextEffectDefinition;
  /** Entrance animation */
  entranceAnimation?: TextAnimation;
  /** Exit animation */
  exitAnimation?: TextAnimation;
}

export type TimelineItemKind = "video" | "audio" | "image" | "text" | "transition";
export type TimelineItemRole = "primary" | "overlay" | "text" | "effect" | "background" | "audio";

export interface TimelinePlacement {
  trackId: string;
  startTime: number;
  duration: number;
  role: TimelineItemRole;
  zIndex: number;
}

export interface TimelineSourceRange {
  mediaId: string;
  trimIn: number;
  trimOut: number;
  playbackRate: number;
  reverse: boolean;
}

export interface TimelineTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  rotation: number;
  aspectRatioLocked?: boolean;
  sourceAspectRatio?: number;
  fitMode?: Clip["fitMode"];
}

export interface TimelineAudioProperties {
  volume: number;
  pan: number;
  muted: boolean;
}

export interface TimelineEffectStack {
  effects: unknown[];
  version: number;
}

export interface BaseTimelineItem {
  id: string;
  kind: TimelineItemKind;
  placement: TimelinePlacement;
  effects: TimelineEffectStack;
  metadata?: Record<string, unknown>;
}

export interface MediaTimelineItem extends BaseTimelineItem {
  kind: "video" | "audio" | "image";
  source: TimelineSourceRange;
  transform: TimelineTransform;
  audio?: TimelineAudioProperties;
}

export interface TextTimelineItem extends BaseTimelineItem {
  kind: "text";
  transform: TimelineTransform;
  text: Omit<TextClip, keyof Clip>;
}

// Legacy transition type for timeline compatibility - maps to TransitionRenderer
export type TransitionType = "fade" | "dissolve" | "canvas";
export type TransitionAlignment = "center" | "start" | "end";

// Extended easing functions matching TransitionRenderer
export type TransitionEasing = import("@clypra-studio/engine").EasingFunction;

export interface TransitionTimelineItem extends BaseTimelineItem {
  kind: "transition";
  type: TransitionType;
  /** Renderer ID for GPU transition (e.g., "cross-dissolve", "push", "glitch") - used to resolve GPU implementation */
  renderer?: string;
  fromItemId: string;
  toItemId: string;
  alignment: TransitionAlignment;
  easing: TransitionEasing;
}

export type TimelineItem = MediaTimelineItem | TextTimelineItem | TransitionTimelineItem;

export type DragItem = { type: "MEDIA_ASSET"; asset: MediaAsset } | { type: "CLIP"; clip: Clip };

// Transform system types
export type TransformHandle = "move" | "nw" | "n" | "ne" | "w" | "e" | "sw" | "s" | "se" | "rotate";

export interface TransformState {
  clipId: string;
  handle: TransformHandle;
  startTransform: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    conform?: any;
  };
  startMousePos: {
    x: number;
    y: number;
  };
  aspectRatioLocked: boolean;
  sourceAspectRatio: number;
}

export interface TransformConstraints {
  aspectRatioLocked: boolean;
  minWidth: number;
  minHeight: number;
  maxWidth?: number;
  maxHeight?: number;
  canvasWidth: number;
  canvasHeight: number;
  snapToGrid?: boolean;
  snapThreshold?: number;
}

export interface TimelineMarker {
  id: string;
  time: number;
  name: string;
  color: string;
}

export interface ClipMarker {
  id: string;
  localTime: number; // Time relative to clip start
  name: string;
  color: string;
}

export * from "./export";
export * from "./gap";
export * from "./serialization";
export * from "./compositor";
export * from "./captions";
export * from "./keyframes";

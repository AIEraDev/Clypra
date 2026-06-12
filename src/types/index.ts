export type AspectRatio = "original" | "16:9" | "9:16" | "1:1" | "4:5";

export const MAX_PROJECT_NAME_LENGTH = 64;

export const PREVIEW_ASPECT_LABEL: Record<AspectRatio, string> = {
  original: "Original",
  "16:9": "16:9 (YouTube)",
  "9:16": "9:16 (Reels/Shorts)",
  "1:1": "1:1 (Instagram)",
  "4:5": "4:5 (Instagram)",
};

export enum DensityLevel {
  Low = "low",
  Medium = "medium",
  High = "high",
  Ultra = "ultra",
}

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
  mediaAssets?: MediaAsset[];
  /** Timeline schema version for forward-compatible project migrations. */
  timelineSchemaVersion?: number;
}

export type TrackType = "video" | "audio" | "text" | "sticker";

export interface Track {
  id: string;
  type: TrackType;
  name: string;
  muted: boolean;
  locked: boolean;
  visible: boolean;
  height: number;
}

/** Waveform bucket containing peak and RMS amplitude data */
export interface WaveformBucket {
  /** Peak amplitude (absolute max) - range [0.0, 1.0] */
  peak: number;
  /** RMS amplitude (perceived loudness) - range [0.0, 1.0] */
  rms: number;
}

export interface MediaAsset {
  id: string;
  name: string;
  path: string;
  type: "video" | "audio" | "image";
  duration: number;
  width?: number;
  height?: number;
  posterFrame?: string;
  coverArt?: string; // Album artwork for audio files
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
}

export type ClipKind = "video" | "audio" | "image" | "sticker" | "text";

export interface Clip {
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
  // Transform constraints
  aspectRatioLocked?: boolean; // Default true for video/images
  sourceAspectRatio?: number; // Original aspect ratio (width/height)
  /** Placement fit mode used for deterministic reset/re-fit behavior. */
  fitMode?: "contain" | "cover" | "fill" | "stretch" | "original";
  /** Audio volume (0.0 to 1.0, default 1.0) */
  volume?: number;
  kind?: ClipKind; // Optional for backward compatibility
}

export interface VideoClip extends Clip {
  kind: "video";
}

export interface AudioClip extends Clip {
  kind: "audio";
}

export interface ImageClip extends Clip {
  kind: "image";
}

export interface StickerClip extends Clip {
  kind: "sticker";
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
  templateId?: string;
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
  styleDefinition?: import("@clypra/engine").TextEffectDefinition;
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

export type TransitionType = "fade" | "dissolve";
export type TransitionAlignment = "center" | "start" | "end";
export type TransitionEasing = "linear" | "easeInOut";

export interface TransitionTimelineItem extends BaseTimelineItem {
  kind: "transition";
  type: TransitionType;
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

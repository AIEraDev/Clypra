export type AspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "21:9";

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
}

export type TrackType = "video" | "audio" | "text";

export interface Track {
  id: string;
  type: TrackType;
  name: string;
  muted: boolean;
  locked: boolean;
  visible: boolean;
  height: number;
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
  size: number;
}

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
}

export interface TextClip extends Clip {
  text: string;
  fontSize: number;
  fontFamily: string;
  color: string;
  bold: boolean;
  italic: boolean;
}

export type DragItem = { type: "MEDIA_ASSET"; asset: MediaAsset } | { type: "CLIP"; clip: Clip };

import type { TemplateTextProperties } from "@/features/text-templates/types";

export const CAPTION_MODEL_VERSION = 1;
export const TICKS_PER_SECOND = 1_000_000;

export interface CaptionCue {
  id: string;
  startTicks: number; // 1,000,000 ticks/sec (1MHz)
  endTicks: number;
  text: string;
  speaker?: string; // Reserved for v2 diarization
  styleOverride?: Partial<TemplateTextProperties>;
  styleVersion: number;
  effectVersion?: number;
}

export interface CaptionTrack {
  id: string;
  captionModelVersion: number;
  name: string;
  visible: boolean;
  locked: boolean;
  defaultStyle: TemplateTextProperties;
  cues: CaptionCue[];
}

export const DEFAULT_CAPTION_STYLE: TemplateTextProperties = {
  text: "",
  fontFamily: "Inter Variable",
  fontSize: 36,
  color: "#ffffff",
  align: "center",
  verticalAlign: "middle",
  fontWeight: 700,
  fontStyle: "normal",
  lineHeight: 1.25,
  letterSpacing: 0,
};

export function secondsToTicks(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) return 0;
  return Math.round(seconds * TICKS_PER_SECOND);
}

export function ticksToSeconds(ticks: number): number {
  if (!Number.isFinite(ticks) || ticks <= 0) return 0;
  return ticks / TICKS_PER_SECOND;
}

export function ticksToFrameIndex(ticks: number, fps: number): number {
  if (!Number.isFinite(ticks) || ticks <= 0) return 0;
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
  return Math.round((ticks / TICKS_PER_SECOND) * safeFps);
}

export function frameIndexToTicks(frameIndex: number, fps: number): number {
  if (!Number.isFinite(frameIndex) || frameIndex <= 0) return 0;
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
  return Math.round((frameIndex / safeFps) * TICKS_PER_SECOND);
}

// ---------------------------------------------------------------------------
// Legacy / Whisper Bridge types
// ---------------------------------------------------------------------------

export interface WordTimestamp {
  word: string;
  startMs: number;
  endMs: number;
  startTicks?: number;
  endTicks?: number;
}

export interface SubtitleSegment {
  id: number;
  text: string;
  startMs: number;
  endMs: number;
  startTicks?: number;
  endTicks?: number;
  words: WordTimestamp[];
}

export interface KaraokeStyleConfig {
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  textTransform?: "uppercase" | "none" | "capitalize";
  activeColor: string;
  spokenColor: string;
  upcomingColor: string;
  backgroundColor: string;
  glowColor: string;
  enableGlow: boolean;
  enableScalePop: boolean;
  position: "bottom" | "middle" | "top";
  maxLines: number;
}

export const DEFAULT_KARAOKE_STYLE: KaraokeStyleConfig = {
  fontFamily: "Outfit Variable, sans-serif",
  fontSize: 36,
  fontWeight: "800",
  textTransform: "uppercase",
  activeColor: "#facc15", // Vibrant Yellow
  spokenColor: "#ffffff", // Crisp White
  upcomingColor: "rgba(255, 255, 255, 0.5)", // Dimmed White
  backgroundColor: "rgba(0, 0, 0, 0.65)",
  glowColor: "rgba(250, 204, 21, 0.8)",
  enableGlow: true,
  enableScalePop: true,
  position: "bottom",
  maxLines: 2,
};

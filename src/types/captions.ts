export interface WordTimestamp {
  word: string;
  startMs: number;
  endMs: number;
}

export interface SubtitleSegment {
  id: number;
  text: string;
  startMs: number;
  endMs: number;
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

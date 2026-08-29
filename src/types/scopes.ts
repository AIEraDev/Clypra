/**
 * Video Analysis Scopes Types
 */

export type ScopeType = "histogram" | "waveform" | "rgb_parade" | "vectorscope" | "all";

export interface HistogramData {
  luma: number[];
  red: number[];
  green: number[];
  blue: number[];
  maxBinCount: number;
}

export interface ScopeGridData {
  width: number;
  height: number;
  data: number[]; // 8-bit density values [0..255]
}

export interface RgbParadeData {
  width: number;
  height: number;
  red: number[];
  green: number[];
  blue: number[];
}

export interface VideoScopePayload {
  histogram?: HistogramData;
  waveform?: ScopeGridData;
  rgbParade?: RgbParadeData;
  vectorscope?: ScopeGridData;
}

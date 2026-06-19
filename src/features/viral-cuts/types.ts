import type { MediaAsset } from "@/types";

export interface ViralCutAsset {
  id: string;
  name: string;
  path: string;
  duration: number;
  width?: number;
  height?: number;
  size?: number;
}

export interface ViralCutAnalysisRequest {
  assets: ViralCutAsset[];
  targetDuration?: number;
  maxSuggestions?: number;
}

export type ViralCutConfidence = "high" | "medium" | "low";
export type ViralCutSource = "native" | "heuristic";

export interface ViralCutSuggestion {
  id: string;
  assetId: string;
  assetName: string;
  start: number;
  end: number;
  duration: number;
  score: number;
  confidence: ViralCutConfidence;
  title: string;
  reasons: string[];
  source: ViralCutSource;
  metrics: {
    positionScore: number;
    durationScore: number;
    bitrateScore: number;
    structureScore: number;
  };
}

export interface ViralCutAnalysisResult {
  suggestions: ViralCutSuggestion[];
  analyzedAssetIds: string[];
  skippedAssetIds: string[];
  generatedAt: number;
}

export const mediaAssetToViralCutAsset = (asset: MediaAsset): ViralCutAsset => ({
  id: asset.id,
  name: asset.name,
  path: asset.path,
  duration: asset.duration,
  width: asset.width,
  height: asset.height,
  size: asset.size,
});

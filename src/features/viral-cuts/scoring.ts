import type { ViralCutAnalysisRequest, ViralCutAnalysisResult, ViralCutAsset, ViralCutSuggestion } from "./types";

const DEFAULT_TARGET_DURATION_SECONDS = 24;
const DEFAULT_MAX_SUGGESTIONS = 12;
const MIN_CUT_DURATION_SECONDS = 6;
const MAX_CUT_DURATION_SECONDS = 60;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const round = (value: number, precision = 3) => {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
};

const stableNoise = (seed: string) => {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 1000) / 1000;
};

const scorePosition = (start: number, duration: number) => {
  if (duration <= 0) return 0;
  const progress = start / duration;
  const opening = Math.max(0, 1 - progress / 0.18);
  const payoff = Math.max(0, 1 - Math.abs(progress - 0.68) / 0.22);
  const middle = Math.max(0, 1 - Math.abs(progress - 0.36) / 0.24);
  return clamp(Math.max(opening, payoff * 0.92, middle * 0.72), 0, 1);
};

const scoreDuration = (duration: number, targetDuration: number) => {
  const delta = Math.abs(duration - targetDuration);
  return clamp(1 - delta / targetDuration, 0, 1);
};

const scoreBitrate = (asset: ViralCutAsset) => {
  if (!asset.size || !asset.duration) return 0.45;
  const bytesPerSecond = asset.size / Math.max(asset.duration, 1);
  const tenMbpsBytesPerSecond = 10_000_000 / 8;
  return clamp(bytesPerSecond / tenMbpsBytesPerSecond, 0, 1);
};

const scoreStructure = (asset: ViralCutAsset, start: number) => {
  const isFourK = (asset.width ?? 0) >= 3000 && (asset.height ?? 0) >= 1600;
  const namePulse = stableNoise(`${asset.name}:${Math.round(start * 10)}`);
  return clamp((isFourK ? 0.58 : 0.38) + namePulse * 0.34, 0, 1);
};

const getTargetDuration = (requested?: number) => clamp(requested ?? DEFAULT_TARGET_DURATION_SECONDS, MIN_CUT_DURATION_SECONDS, MAX_CUT_DURATION_SECONDS);

const getCandidateDuration = (assetDuration: number, targetDuration: number) => {
  if (assetDuration <= MIN_CUT_DURATION_SECONDS) return Math.max(0, assetDuration);
  if (assetDuration < targetDuration) return clamp(assetDuration, MIN_CUT_DURATION_SECONDS, targetDuration);
  if (assetDuration >= 600) return clamp(targetDuration + 6, MIN_CUT_DURATION_SECONDS, MAX_CUT_DURATION_SECONDS);
  return targetDuration;
};

const candidateStartsForAsset = (asset: ViralCutAsset, candidateDuration: number) => {
  const maxStart = Math.max(0, asset.duration - candidateDuration);
  if (maxStart <= 0) return [0];

  const anchors = [0, 0.05, 0.12, 0.22, 0.36, 0.52, 0.68, 0.82, 0.93].map((ratio) => maxStart * ratio);

  if (asset.duration > 180) {
    for (let t = 60; t < maxStart; t += asset.duration > 720 ? 150 : 90) {
      anchors.push(t);
    }
  }

  const unique = Array.from(new Set(anchors.map((start) => Math.round(clamp(start, 0, maxStart)))));
  return unique.slice(0, 16);
};

const titleForSuggestion = (start: number, assetDuration: number, score: number) => {
  const progress = assetDuration > 0 ? start / assetDuration : 0;
  if (progress < 0.18) return "Opening hook candidate";
  if (progress > 0.58) return score >= 0.78 ? "Payoff moment candidate" : "Late highlight candidate";
  return "Mid-video lift candidate";
};

const confidenceForScore = (score: number): ViralCutSuggestion["confidence"] => {
  if (score >= 0.78) return "high";
  if (score >= 0.62) return "medium";
  return "low";
};

const reasonsFor = (params: {
  start: number;
  asset: ViralCutAsset;
  durationScore: number;
  bitrateScore: number;
  structureScore: number;
}) => {
  const { start, asset, durationScore, bitrateScore, structureScore } = params;
  const progress = asset.duration > 0 ? start / asset.duration : 0;
  const reasons: string[] = [];

  if (progress < 0.18) reasons.push("early hook");
  if (progress > 0.58) reasons.push("late payoff");
  if (durationScore > 0.82) reasons.push("short-form length");
  if (bitrateScore > 0.66) reasons.push("high-detail source");
  if (structureScore > 0.68) reasons.push("strong visual candidate");

  return reasons.slice(0, 3);
};

export function analyzeViralCutsHeuristic(request: ViralCutAnalysisRequest): ViralCutAnalysisResult {
  const targetDuration = getTargetDuration(request.targetDuration);
  const maxSuggestions = clamp(request.maxSuggestions ?? DEFAULT_MAX_SUGGESTIONS, 1, 50);
  const suggestions: ViralCutSuggestion[] = [];
  const analyzedAssetIds: string[] = [];
  const skippedAssetIds: string[] = [];

  for (const asset of request.assets) {
    if (!Number.isFinite(asset.duration) || asset.duration < 1) {
      skippedAssetIds.push(asset.id);
      continue;
    }

    analyzedAssetIds.push(asset.id);
    const candidateDuration = getCandidateDuration(asset.duration, targetDuration);
    if (candidateDuration <= 0) {
      skippedAssetIds.push(asset.id);
      continue;
    }

    for (const start of candidateStartsForAsset(asset, candidateDuration)) {
      const end = clamp(start + candidateDuration, start, asset.duration);
      const duration = end - start;
      if (duration < Math.min(MIN_CUT_DURATION_SECONDS, asset.duration)) continue;

      const positionScore = scorePosition(start, asset.duration);
      const durationScore = scoreDuration(duration, targetDuration);
      const bitrateScore = scoreBitrate(asset);
      const structureScore = scoreStructure(asset, start);
      const score = clamp(positionScore * 0.36 + durationScore * 0.26 + bitrateScore * 0.18 + structureScore * 0.2, 0, 1);

      suggestions.push({
        id: `viral-${asset.id}-${Math.round(start * 100)}-${Math.round(end * 100)}`,
        assetId: asset.id,
        assetName: asset.name,
        start: round(start),
        end: round(end),
        duration: round(duration),
        score: round(score, 4),
        confidence: confidenceForScore(score),
        title: titleForSuggestion(start, asset.duration, score),
        reasons: reasonsFor({ start, asset, durationScore, bitrateScore, structureScore }),
        source: "heuristic",
        metrics: {
          positionScore: round(positionScore, 4),
          durationScore: round(durationScore, 4),
          bitrateScore: round(bitrateScore, 4),
          structureScore: round(structureScore, 4),
        },
      });
    }
  }

  const ranked = suggestions
    .sort((a, b) => b.score - a.score || b.duration - a.duration)
    .filter((suggestion, index, all) => {
      const earlierForAsset = all.slice(0, index).filter((candidate) => candidate.assetId === suggestion.assetId);
      return earlierForAsset.length < 3;
    })
    .slice(0, maxSuggestions);

  return {
    suggestions: ranked,
    analyzedAssetIds,
    skippedAssetIds,
    generatedAt: Date.now(),
  };
}

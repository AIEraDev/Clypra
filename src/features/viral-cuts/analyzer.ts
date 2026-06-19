import { invoke } from "@tauri-apps/api/core";
import { platform } from "@/core/platform";
import { analyzeViralCutsHeuristic } from "./scoring";
import type { ViralCutAnalysisRequest, ViralCutAnalysisResult, ViralCutSuggestion } from "./types";

const normalizeSuggestion = (suggestion: ViralCutSuggestion): ViralCutSuggestion => ({
  ...suggestion,
  start: Math.max(0, Number(suggestion.start) || 0),
  end: Math.max(Number(suggestion.start) || 0, Number(suggestion.end) || 0),
  duration: Math.max(0, Number(suggestion.duration) || Number(suggestion.end) - Number(suggestion.start) || 0),
  score: Math.max(0, Math.min(1, Number(suggestion.score) || 0)),
  confidence: suggestion.confidence ?? "medium",
  reasons: Array.isArray(suggestion.reasons) ? suggestion.reasons.slice(0, 4) : [],
  source: suggestion.source ?? "native",
  metrics: suggestion.metrics ?? {
    positionScore: 0,
    durationScore: 0,
    bitrateScore: 0,
    structureScore: 0,
  },
});

export async function analyzeViralCuts(request: ViralCutAnalysisRequest): Promise<ViralCutAnalysisResult> {
  if (platform.isTauri()) {
    try {
      const native = await invoke<ViralCutAnalysisResult>("analyze_viral_cuts", { request });
      if (native?.suggestions?.length) {
        return {
          ...native,
          suggestions: native.suggestions.map(normalizeSuggestion),
          generatedAt: native.generatedAt ?? Date.now(),
        };
      }
    } catch (error) {
      console.warn("[viral-cuts] Native analysis failed, using heuristic fallback:", error);
    }
  }

  return analyzeViralCutsHeuristic(request);
}

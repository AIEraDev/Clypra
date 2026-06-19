import { describe, expect, it } from "vitest";
import { createViralCutClip } from "../applySuggestion";
import type { MediaAsset } from "@/types";
import type { ViralCutSuggestion } from "../types";

describe("createViralCutClip", () => {
  it("creates a trimmed timeline clip from a suggestion", () => {
    const asset: MediaAsset = {
      id: "asset-1",
      name: "source.mp4",
      path: "/source.mp4",
      type: "video",
      duration: 120,
      width: 3840,
      height: 2160,
      size: 1000,
    };
    const suggestion: ViralCutSuggestion = {
      id: "viral-1",
      assetId: asset.id,
      assetName: asset.name,
      start: 12,
      end: 36,
      duration: 24,
      score: 0.8,
      confidence: "high",
      title: "Opening hook candidate",
      reasons: ["early hook"],
      source: "heuristic",
      metrics: { positionScore: 1, durationScore: 1, bitrateScore: 0.4, structureScore: 0.7 },
    };

    const clip = createViralCutClip({
      suggestion,
      asset,
      trackId: "track-1",
      startTime: 5,
      project: { canvasWidth: 1080, canvasHeight: 1920 },
    });

    expect(clip.mediaId).toBe(asset.id);
    expect(clip.trackId).toBe("track-1");
    expect(clip.startTime).toBe(5);
    expect(clip.trimIn).toBe(12);
    expect(clip.trimOut).toBe(36);
    expect(clip.duration).toBe(24);
  });
});

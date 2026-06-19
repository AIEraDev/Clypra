import { describe, expect, it, vi } from "vitest";
import { analyzeViralCutsHeuristic } from "../scoring";

describe("analyzeViralCutsHeuristic", () => {
  it("ranks bounded suggestions for long video assets", () => {
    vi.setSystemTime(new Date("2026-06-12T00:00:00Z"));

    const result = analyzeViralCutsHeuristic({
      maxSuggestions: 4,
      targetDuration: 24,
      assets: [
        {
          id: "asset-long",
          name: "20260523150028_000015.MP4",
          path: "/Volumes/NO NAME/DCIM/MOVIE/20260523150028_000015.MP4",
          duration: 900,
          width: 3840,
          height: 2160,
          size: 2_413_761_911,
        },
      ],
    });

    expect(result.analyzedAssetIds).toEqual(["asset-long"]);
    expect(result.suggestions).toHaveLength(3);
    expect(result.suggestions[0].start).toBeGreaterThanOrEqual(0);
    expect(result.suggestions[0].end).toBeLessThanOrEqual(900);
    expect(result.suggestions[0].duration).toBeGreaterThanOrEqual(6);
    expect(result.suggestions[0].score).toBeGreaterThan(0.5);
  });

  it("skips assets without usable duration", () => {
    const result = analyzeViralCutsHeuristic({
      assets: [{ id: "broken", name: "broken.mp4", path: "/broken.mp4", duration: 0 }],
    });

    expect(result.suggestions).toEqual([]);
    expect(result.skippedAssetIds).toEqual(["broken"]);
  });
});

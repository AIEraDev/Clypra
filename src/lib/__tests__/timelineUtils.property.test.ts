import { describe, it } from "vitest";
import fc from "fast-check";
import { DensityLevel } from "../../types";
import { DENSITY_CONFIGS, generateTimestampGrid, getDensityForZoom } from "../timelineUtils";

type ResolutionTier = "1x" | "2x";
type FrontendCacheKey = {
  videoId: string;
  timestampMs: number;
  density: DensityLevel;
  resolutionTier: ResolutionTier;
};

const hex32Arbitrary = fc
  .array(fc.constantFrom("0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b", "c", "d", "e", "f"), { minLength: 32, maxLength: 32 })
  .map((chars) => chars.join(""));

function densityLabel(density: DensityLevel): "low" | "medium" | "high" | "ultra" {
  switch (density) {
    case DensityLevel.Low:
      return "low";
    case DensityLevel.Medium:
      return "medium";
    case DensityLevel.High:
      return "high";
    case DensityLevel.Ultra:
      return "ultra";
  }
}

function parseDensityLabel(label: string): DensityLevel {
  switch (label) {
    case "low":
      return DensityLevel.Low;
    case "medium":
      return DensityLevel.Medium;
    case "high":
      return DensityLevel.High;
    case "ultra":
      return DensityLevel.Ultra;
    default:
      throw new Error(`Invalid density label: ${label}`);
  }
}

function serializeCacheKey(key: FrontendCacheKey): string {
  return `${key.videoId}:${key.timestampMs}:${densityLabel(key.density)}:${key.resolutionTier}`;
}

function parseCacheKey(value: string): FrontendCacheKey {
  const parts = value.split(":");
  if (parts.length !== 4) {
    throw new Error(`Invalid cache key format: expected 4 parts, got ${parts.length}`);
  }
  const timestampMs = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(timestampMs) || timestampMs < 0) {
    throw new Error(`Invalid timestamp: ${parts[1]}`);
  }
  if (parts[3] !== "1x" && parts[3] !== "2x") {
    throw new Error(`Invalid resolution tier: ${parts[3]}`);
  }

  return {
    videoId: parts[0],
    timestampMs,
    density: parseDensityLabel(parts[2]),
    resolutionTier: parts[3],
  };
}

function createCacheKey(videoId: string, timeSeconds: number, density: DensityLevel, resolutionTier: ResolutionTier): FrontendCacheKey {
  return {
    videoId,
    timestampMs: Math.round(timeSeconds * 1000),
    density,
    resolutionTier,
  };
}

function nearestTimestamp(targetTime: number, cachedTimestamps: number[]): number {
  let nearest = cachedTimestamps[0];
  let minDistance = Math.abs(nearest - targetTime);
  for (let i = 1; i < cachedTimestamps.length; i++) {
    const distance = Math.abs(cachedTimestamps[i] - targetTime);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = cachedTimestamps[i];
    }
  }
  return nearest;
}

describe("timelineUtils Property-Based Tests", () => {
  // Feature: video-zoom-performance-optimization, Property 1: Cache key round-trip
  it("Property 1: Cache key round-trip preservation", () => {
    fc.assert(
      fc.property(
        fc
          .tuple(
            hex32Arbitrary,
            fc.float({ min: 0, max: 24 * 60 * 60, noNaN: true }),
            fc.constantFrom(DensityLevel.Low, DensityLevel.Medium, DensityLevel.High, DensityLevel.Ultra),
            fc.constantFrom("1x" as const, "2x" as const),
          )
          .filter(([, timeSeconds]) => Number.isFinite(timeSeconds)),
        ([videoId, timeSeconds, density, resolutionTier]) => {
          const original = createCacheKey(videoId, timeSeconds, density, resolutionTier);
          const parsed = parseCacheKey(serializeCacheKey(original));
          return (
            parsed.videoId === original.videoId &&
            parsed.timestampMs === original.timestampMs &&
            parsed.density === original.density &&
            parsed.resolutionTier === original.resolutionTier
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: video-zoom-performance-optimization, Property 3: Cache key stability within density buckets
  it("Property 3: cache key stability within density buckets", () => {
    fc.assert(
      fc.property(
        fc
          .tuple(
            fc.constantFrom(...DENSITY_CONFIGS),
            hex32Arbitrary,
            fc.float({ min: 0, max: 10_000, noNaN: true }),
            fc.constantFrom("1x" as const, "2x" as const),
          )
          .filter(([config]) => Number.isFinite(config.maxZoom)),
        ([config, videoId, timeSeconds, resolutionTier]) => {
          const zoomA = config.minZoom + (config.maxZoom - config.minZoom) * 0.25;
          const zoomB = config.minZoom + (config.maxZoom - config.minZoom) * 0.75;

          const densityA = getDensityForZoom(zoomA);
          const densityB = getDensityForZoom(zoomB);

          const keyA = serializeCacheKey(createCacheKey(videoId, timeSeconds, densityA, resolutionTier));
          const keyB = serializeCacheKey(createCacheKey(videoId, timeSeconds, densityB, resolutionTier));

          return densityA === densityB && keyA === keyB;
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: video-zoom-performance-optimization, Property 4: Zoom level to density mapping
  it("Property 4: zoom level to density mapping", () => {
    fc.assert(
      fc.property(fc.float({ min: 0, max: 10000, noNaN: true }), (zoom) => {
        const density = getDensityForZoom(zoom);
        const config = DENSITY_CONFIGS.find((entry) => entry.level === density);
        if (!config) return false;
        return zoom >= config.minZoom && zoom < config.maxZoom;
      }),
      { numRuns: 100 },
    );
  });

  // Feature: video-zoom-performance-optimization, Property 5: Timestamp grid uniform spacing
  it("Property 5: timestamp grid uniform spacing", () => {
    fc.assert(
      fc.property(
        fc
          .tuple(fc.float({ min: 0, max: 1000, noNaN: true }), fc.float({ min: 0, max: 1000, noNaN: true }), fc.constantFrom(5.0, 1.0, 0.2, 0.05), fc.float({ min: 1, max: 1000, noNaN: true }))
          .filter(([trimIn, trimOut, _interval, videoDuration]) => trimIn < trimOut && trimOut <= videoDuration),
        ([trimIn, trimOut, interval, videoDuration]) => {
          const timestamps = generateTimestampGrid(trimIn, trimOut, interval, videoDuration);
          if (timestamps.length < 2) return true;
          for (let i = 1; i < timestamps.length; i++) {
            if (Math.abs((timestamps[i] ?? 0) - (timestamps[i - 1] ?? 0) - interval) > 0.001) {
              return false;
            }
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: video-zoom-performance-optimization, Property 6: Nearest timestamp selection
  it("Property 6: nearest timestamp selection", () => {
    fc.assert(
      fc.property(
        fc.tuple(fc.float({ min: 0, max: 1000, noNaN: true }), fc.array(fc.float({ min: 0, max: 1000, noNaN: true }), { minLength: 1, maxLength: 30 })),
        ([targetTime, samples]) => {
          const cached = [...new Set(samples.map((v) => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
          if (cached.length === 0) return true;
          const selected = nearestTimestamp(targetTime, cached);
          const selectedDistance = Math.abs(selected - targetTime);
          return cached.every((candidate) => selectedDistance <= Math.abs(candidate - targetTime));
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: video-zoom-performance-optimization, Property 16: Global grid alignment
  it("Property 16: global grid alignment for overlapping clips", () => {
    fc.assert(
      fc.property(
        fc
          .tuple(
            fc.float({ min: 0, max: 50, noNaN: true }),
            fc.float({ min: 0, max: 50, noNaN: true }),
            fc.float({ min: 0, max: 50, noNaN: true }),
            fc.float({ min: 0, max: 50, noNaN: true }),
            fc.constantFrom(5.0, 1.0, 0.2, 0.05),
            fc.float({ min: 50, max: 100, noNaN: true }),
          )
          .filter(([trimIn1, trimOut1, trimIn2, trimOut2, _interval, videoDuration]) => trimIn1 < trimOut1 && trimIn2 < trimOut2 && trimOut1 <= videoDuration && trimOut2 <= videoDuration && trimOut1 > trimIn2 && trimOut2 > trimIn1),
        ([trimIn1, trimOut1, trimIn2, trimOut2, interval, videoDuration]) => {
          const gridA = generateTimestampGrid(trimIn1, trimOut1, interval, videoDuration);
          const gridB = generateTimestampGrid(trimIn2, trimOut2, interval, videoDuration);
          const overlapStart = Math.max(trimIn1, trimIn2);
          const overlapEnd = Math.min(trimOut1, trimOut2);
          const overlapA = gridA.filter((t) => t >= overlapStart && t <= overlapEnd);
          const overlapB = gridB.filter((t) => t >= overlapStart && t <= overlapEnd);
          if (overlapA.length !== overlapB.length) return false;
          for (let i = 0; i < overlapA.length; i++) {
            if (Math.abs((overlapA[i] ?? 0) - (overlapB[i] ?? 0)) > 0.001) return false;
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});

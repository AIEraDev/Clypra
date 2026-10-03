import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getTextMetricsSnapshot,
  recordAnimationAchievedFrame,
  recordBrowserTextRasterCacheHit,
  recordBrowserTextRasterCacheMiss,
  recordDynamicImport,
  recordFontLoad,
  recordRasterUpload,
  recordRendererByClipKind,
  resetTextMetricsForTests,
} from "../textMetrics";

describe("TextMetrics (v3 Telemetry)", () => {
  beforeEach(() => {
    resetTextMetricsForTests();
  });

  afterEach(() => {
    resetTextMetricsForTests();
  });

  it("records renderer invocations by clip kind", () => {
    recordRendererByClipKind("plain", "canvas-2d");
    recordRendererByClipKind("plain", "canvas-2d");
    recordRendererByClipKind("template", "worker-template");
    recordRendererByClipKind("effect", "worker-effect");
    recordRendererByClipKind("effect", "canvas-2d-fallback");

    const snapshot = getTextMetricsSnapshot();
    expect(snapshot.rendererByKind).toEqual({
      plain: { "canvas-2d": 2 },
      template: { "worker-template": 1 },
      effect: { "worker-effect": 1, "canvas-2d-fallback": 1 },
    });
  });

  it("accumulates raster upload metrics and throughput", () => {
    recordRasterUpload(1920 * 1080, 1920 * 1080 * 4, 15.5);
    recordRasterUpload(800 * 200, 800 * 200 * 4, 4.2);

    const snapshot = getTextMetricsSnapshot();
    expect(snapshot.uploads.totalRegistrations).toBe(2);
    expect(snapshot.uploads.totalOutputPixels).toBe(1920 * 1080 + 800 * 200);
    expect(snapshot.uploads.totalBytes).toBe((1920 * 1080 + 800 * 200) * 4);
    expect(snapshot.uploads.outputPixelsAvg).toBe(
      Math.round((1920 * 1080 + 800 * 200) / 2),
    );
    expect(snapshot.uploads.durationMsMax).toBe(15.5);
    expect(snapshot.uploads.durationMsAvg).toBe(9.85);
  });

  it("computes frontend raster cache hit rate accurately", () => {
    recordBrowserTextRasterCacheHit();
    recordBrowserTextRasterCacheHit();
    recordBrowserTextRasterCacheHit();
    recordBrowserTextRasterCacheMiss();

    const snapshot = getTextMetricsSnapshot();
    expect(snapshot.cache.hits).toBe(3);
    expect(snapshot.cache.misses).toBe(1);
    expect(snapshot.cache.hitRate).toBe(0.75);
  });

  it("computes animation achieved Hz from inter-frame dt", () => {
    const t0 = 1000;
    // Layer 1 receives frames at 100ms intervals (10 Hz)
    recordAnimationAchievedFrame("layer-1", t0);
    recordAnimationAchievedFrame("layer-1", t0 + 100);
    recordAnimationAchievedFrame("layer-1", t0 + 200);

    const snapshot = getTextMetricsSnapshot();
    expect(snapshot.animation.samples).toBe(2);
    expect(snapshot.animation.achievedHzAvg).toBe(10);
    expect(snapshot.animation.achievedHzMin).toBe(10);
    expect(snapshot.animation.achievedHzMax).toBe(10);
  });

  it("records dynamic import and first font-load timings", () => {
    recordDynamicImport("templateRasterizerWorkerClient", 4.8);
    // Duplicate call should not overwrite first-use measurement
    recordDynamicImport("templateRasterizerWorkerClient", 1.2);

    recordFontLoad(12.3);
    recordFontLoad(5.1);

    const snapshot = getTextMetricsSnapshot();
    expect(snapshot.firstUseTimings.dynamicImports).toEqual({
      templateRasterizerWorkerClient: 4.8,
    });
    expect(snapshot.firstUseTimings.fontLoadMs).toBe(12.3);
  });

  it("guarantees zero-PII and adheres to the strict telemetry allowlist schema", () => {
    recordRendererByClipKind("plain", "canvas-2d");
    recordRasterUpload(1000, 4000, 2);
    recordBrowserTextRasterCacheHit();
    recordAnimationAchievedFrame("l1", 100);
    recordAnimationAchievedFrame("l1", 150);
    recordDynamicImport("testModule", 3);
    recordFontLoad(10);

    const snapshot = getTextMetricsSnapshot();
    const serialized = JSON.stringify(snapshot);

    // 1. Assert that the serialized JSON only contains known metric keys and numbers/known enums
    expect(serialized).not.toContain("fontFamily");
    expect(serialized).not.toContain("content");
    expect(serialized).not.toContain("text");
    expect(serialized).not.toContain("userId");
    expect(serialized).not.toContain("projectId");

    // 2. Strict schema allowlist validation: ensure no unexpected keys leak into telemetry
    const allowedTopLevelKeys = new Set([
      "rendererByKind",
      "uploads",
      "cache",
      "animation",
      "firstUseTimings",
    ]);
    expect(Object.keys(snapshot).every((k) => allowedTopLevelKeys.has(k))).toBe(true);

    const allowedUploadKeys = new Set([
      "totalRegistrations",
      "totalBytes",
      "totalOutputPixels",
      "registrationsPerSec",
      "bytesPerSec",
      "outputPixelsAvg",
      "outputPixelsP95",
      "durationMsAvg",
      "durationMsMax",
    ]);
    expect(Object.keys(snapshot.uploads).every((k) => allowedUploadKeys.has(k))).toBe(true);

    const allowedCacheKeys = new Set(["hits", "misses", "hitRate"]);
    expect(Object.keys(snapshot.cache).every((k) => allowedCacheKeys.has(k))).toBe(true);

    const allowedAnimationKeys = new Set([
      "samples",
      "achievedHzAvg",
      "achievedHzMin",
      "achievedHzMax",
    ]);
    expect(Object.keys(snapshot.animation).every((k) => allowedAnimationKeys.has(k))).toBe(true);

    const allowedFirstUseKeys = new Set(["dynamicImports", "fontLoadMs"]);
    expect(Object.keys(snapshot.firstUseTimings).every((k) => allowedFirstUseKeys.has(k))).toBe(true);
  });
});

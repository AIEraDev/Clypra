import { describe, it, expect, beforeEach } from "vitest";
import { FilmstripTelemetryRecorder, filmstripTelemetry } from "../filmstripTelemetry";

describe("FilmstripTelemetryRecorder", () => {
  let recorder: FilmstripTelemetryRecorder;

  beforeEach(() => {
    recorder = new FilmstripTelemetryRecorder(10);
  });

  it("initializes with empty summary", () => {
    const summary = recorder.getSummary();
    expect(summary.totalTilesRequested).toBe(0);
    expect(summary.hitRatePercentage).toBe(0);
    expect(summary.avgTimeToVisibleMs).toBe(0);
  });

  it("records tile lifecycle timings and aggregates stats", () => {
    recorder.record({
      tileKey: "tile-1",
      source: "memory_tier",
      cacheLookupMs: 0.5,
      ipcTransferMs: 0.2,
      decodeMs: 0,
      bitmapCreationMs: 1.2,
      rasterPaintMs: 0.8,
      totalTimeToVisibleMs: 2.7,
    });

    recorder.record({
      tileKey: "tile-2",
      source: "disk_atlas",
      cacheLookupMs: 1.5,
      ipcTransferMs: 2.0,
      decodeMs: 3.5,
      bitmapCreationMs: 1.5,
      rasterPaintMs: 0.9,
      totalTimeToVisibleMs: 8.9,
    });

    recorder.record({
      tileKey: "tile-3",
      source: "fresh_decode",
      cacheLookupMs: 2.0,
      ipcTransferMs: 5.0,
      decodeMs: 45.0,
      bitmapCreationMs: 2.0,
      rasterPaintMs: 1.0,
      totalTimeToVisibleMs: 55.0,
    });

    const summary = recorder.getSummary();
    expect(summary.totalTilesRequested).toBe(3);
    expect(summary.memoryHits).toBe(1);
    expect(summary.diskAtlasHits).toBe(1);
    expect(summary.freshDecodes).toBe(1);
    expect(summary.hitRatePercentage).toBe(66.7);
    expect(summary.avgTimeToVisibleMs).toBeGreaterThan(0);
  });

  it("evicts oldest records when capacity is exceeded", () => {
    for (let i = 0; i < 15; i++) {
      recorder.record({
        tileKey: `tile-${i}`,
        source: "memory_tier",
        cacheLookupMs: 1,
        ipcTransferMs: 1,
        decodeMs: 0,
        bitmapCreationMs: 1,
        rasterPaintMs: 1,
        totalTimeToVisibleMs: 4,
      });
    }

    expect(recorder.getRecordCount()).toBe(10);
  });

  it("clears records on clear()", () => {
    recorder.record({
      tileKey: "tile-1",
      source: "memory_tier",
      cacheLookupMs: 1,
      ipcTransferMs: 1,
      decodeMs: 0,
      bitmapCreationMs: 1,
      rasterPaintMs: 1,
      totalTimeToVisibleMs: 4,
    });

    expect(recorder.getRecordCount()).toBe(1);
    recorder.clear();
    expect(recorder.getRecordCount()).toBe(0);
  });
});

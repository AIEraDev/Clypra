/**
 * Unit tests for MediaAnimationRollupCollector.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MediaAnimationRollupCollector } from "../mediaAnimationRollup";

describe("MediaAnimationRollupCollector", () => {
  let collector: MediaAnimationRollupCollector;

  beforeEach(() => {
    collector = new MediaAnimationRollupCollector();
  });

  describe("hasRecordedData", () => {
    it("returns false on a fresh collector", () => {
      expect(collector.hasRecordedData()).toBe(false);
    });

    it("returns true after recording a catalog fetch", () => {
      collector.recordCatalogFetch("in", 100, false);
      expect(collector.hasRecordedData()).toBe(true);
    });

    it("returns true after recording a download", () => {
      collector.recordDownload(true, 5, 2048, false);
      expect(collector.hasRecordedData()).toBe(true);
    });

    it("returns true after recording an animation eval", () => {
      collector.recordAnimationEval(3, 2);
      expect(collector.hasRecordedData()).toBe(true);
    });

    it("returns true after recording a hydration", () => {
      collector.recordHydration(5, 50);
      expect(collector.hasRecordedData()).toBe(true);
    });
  });

  describe("flush", () => {
    it("returns zero counts when nothing was recorded", () => {
      const summary = collector.flush();
      expect(summary.catalogFetches.count).toBe(0);
      expect(summary.downloads.count).toBe(0);
      expect(summary.animationEvals.count).toBe(0);
      expect(summary.hydrations.count).toBe(0);
    });

    it("resets hasRecordedData to false after flush", () => {
      collector.recordCatalogFetch("in", 100, false);
      expect(collector.hasRecordedData()).toBe(true);
      collector.flush();
      expect(collector.hasRecordedData()).toBe(false);
    });

    it("returns zero counts on a second flush after clear", () => {
      collector.recordCatalogFetch("in", 100, false);
      collector.flush();
      const second = collector.flush();
      expect(second.catalogFetches.count).toBe(0);
      expect(second.downloads.count).toBe(0);
    });

    describe("catalogFetches", () => {
      it("counts 3 fetches including 1 error", () => {
        collector.recordCatalogFetch("in", 100, false);
        collector.recordCatalogFetch("out", 200, false);
        collector.recordCatalogFetch("combo", 300, true);

        const summary = collector.flush();
        expect(summary.catalogFetches.count).toBe(3);
        expect(summary.catalogFetches.errorRate).toBeCloseTo(1 / 3, 3);
      });

      it("tracks byCategory counts correctly", () => {
        collector.recordCatalogFetch("in", 100, false);
        collector.recordCatalogFetch("in", 120, false);
        collector.recordCatalogFetch("out", 150, false);
        collector.recordCatalogFetch("combo", 80, true);

        const summary = collector.flush();
        expect(summary.catalogFetches.byCategory.in).toBe(2);
        expect(summary.catalogFetches.byCategory.out).toBe(1);
        expect(summary.catalogFetches.byCategory.combo).toBe(1);
      });

      it("computes average duration correctly", () => {
        collector.recordCatalogFetch("in", 100, false);
        collector.recordCatalogFetch("out", 200, false);

        const summary = collector.flush();
        expect(summary.catalogFetches.avgDurationMs).toBeCloseTo(150, 1);
      });
    });

    describe("downloads", () => {
      it("computes cache hit rate excluding errors", () => {
        collector.recordDownload(true, 5, 2048, false); // cache hit
        collector.recordDownload(false, 200, 4096, false); // cache miss
        collector.recordDownload(false, 0, 0, true); // error

        const summary = collector.flush();
        expect(summary.downloads.count).toBe(3);
        // Cache hit rate = 1 hit / (1 hit + 1 miss) = 0.5
        expect(summary.downloads.cacheHitRate).toBeCloseTo(0.5, 3);
        // Error rate = 1 error / 3 total = 0.333
        expect(summary.downloads.errorRate).toBeCloseTo(1 / 3, 3);
      });

      it("accumulates total size bytes", () => {
        collector.recordDownload(false, 100, 1000, false);
        collector.recordDownload(false, 200, 2000, false);

        const summary = collector.flush();
        expect(summary.downloads.totalSizeBytes).toBe(3000);
      });
    });

    describe("animationEvals", () => {
      it("counts 3 evals and computes p95", () => {
        collector.recordAnimationEval(10, 2);
        collector.recordAnimationEval(20, 2);
        collector.recordAnimationEval(30, 2);

        const summary = collector.flush();
        expect(summary.animationEvals.count).toBe(3);
        expect(summary.animationEvals.avgDurationMs).toBeCloseTo(20, 1);
        // p95 of [10, 20, 30]: ceil(3 * 0.95) - 1 = ceil(2.85) - 1 = 3 - 1 = 2 → sorted[2] = 30
        expect(summary.animationEvals.p95DurationMs).toBe(30);
        expect(typeof summary.animationEvals.p95DurationMs).toBe("number");
      });

      it("p95 is 0 when no evals recorded", () => {
        const summary = collector.flush();
        expect(summary.animationEvals.p95DurationMs).toBe(0);
      });
    });

    describe("hydrations", () => {
      it("averages manifest counts and durations", () => {
        collector.recordHydration(5, 50);
        collector.recordHydration(3, 30);

        const summary = collector.flush();
        expect(summary.hydrations.count).toBe(2);
        expect(summary.hydrations.avgManifests).toBeCloseTo(4, 1);
        expect(summary.hydrations.avgDurationMs).toBeCloseTo(40, 1);
      });
    });

    describe("full lifecycle", () => {
      it("records mix of all operations and produces correct summary", () => {
        // 2 success catalog fetches, 1 error
        collector.recordCatalogFetch("in", 100, false);
        collector.recordCatalogFetch("out", 150, false);
        collector.recordCatalogFetch("combo", 200, true);

        // 1 cache hit, 1 miss, 1 error
        collector.recordDownload(true, 5, 1024, false);
        collector.recordDownload(false, 300, 4096, false);
        collector.recordDownload(false, 0, 0, true);

        // 3 animation evals
        collector.recordAnimationEval(5, 3);
        collector.recordAnimationEval(10, 2);
        collector.recordAnimationEval(15, 1);

        // 1 hydration
        collector.recordHydration(5, 50);

        expect(collector.hasRecordedData()).toBe(true);

        const summary = collector.flush();

        expect(summary.catalogFetches.count).toBe(3);
        expect(summary.catalogFetches.errorRate).toBeCloseTo(1 / 3, 3);
        expect(summary.catalogFetches.byCategory.in).toBe(1);
        expect(summary.catalogFetches.byCategory.out).toBe(1);
        expect(summary.catalogFetches.byCategory.combo).toBe(1);

        expect(summary.downloads.count).toBe(3);
        expect(summary.downloads.cacheHitRate).toBeCloseTo(0.5, 3);

        expect(summary.animationEvals.count).toBe(3);
        expect(typeof summary.animationEvals.p95DurationMs).toBe("number");

        expect(summary.hydrations.count).toBe(1);
        expect(summary.hydrations.avgManifests).toBe(5);

        // After flush, hasRecordedData is false
        expect(collector.hasRecordedData()).toBe(false);
      });
    });
  });

  describe("clear", () => {
    it("resets all counters without returning a summary", () => {
      collector.recordCatalogFetch("in", 100, false);
      collector.recordDownload(true, 5, 2048, false);
      collector.clear();
      expect(collector.hasRecordedData()).toBe(false);
    });
  });
});

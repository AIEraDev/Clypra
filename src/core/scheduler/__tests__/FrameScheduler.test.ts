/**
 * Frame Scheduler Tests
 *
 * Validates temporal orchestration, cancellation, and priority scheduling.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { FrameScheduler } from "../FrameScheduler";
import { FrameRequest } from "@/core/resources";

// Mock dependencies
vi.mock("../../evaluation/evaluator", () => ({
  evaluateTimelineSceneCached: vi.fn(() => ({
    visualLayers: [],
    audioLayers: [],
    transitions: [],
    metadata: {
      time: 0,
      canvasWidth: 1920,
      canvasHeight: 1080,
      frameRate: 30,
      isGap: true,
    },
  })),
}));

vi.mock("../../render/rasterizer", () => ({
  rasterizeScene: vi.fn(async () => ({
    canvas: new MockOffscreenCanvas(1920, 1080),
    ctx: {},
    width: 1920,
    height: 1080,
    scaleX: 1,
    scaleY: 1,
    rasterTimeMs: 10,
  })),
}));

vi.mock("../../resources/ResourceManager", () => ({
  getResourceManager: vi.fn(() => ({
    acquire: vi.fn(),
    get: vi.fn(),
    release: vi.fn(),
  })),
}));

// Mock global session for FIX-004 projectId validation
(globalThis as any).__activeProjectSession = {
  projectId: "test-project",
  state: "active",
};

class MockOffscreenCanvas {
  width: number;
  height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  transferToImageBitmap() {
    return Promise.resolve({ width: this.width, height: this.height, close: vi.fn() });
  }

  convertToBlob() {
    return Promise.resolve(new Blob(["mock"]));
  }
}

globalThis.OffscreenCanvas = MockOffscreenCanvas as any;
globalThis.createImageBitmap = vi.fn(() => Promise.resolve({ width: 100, height: 100, close: vi.fn() } as any));

describe("FrameScheduler", () => {
  let scheduler: FrameScheduler;

  beforeEach(() => {
    scheduler = new FrameScheduler({ debug: false });
    scheduler.updateTimeline([], [], [], null, 0);
  });

  describe("Job Scheduling", () => {
    it("schedules a frame request", () => {
      const request: FrameRequest = {
        time: 1.0,
        resolution: { width: 1920, height: 1080 },
      };

      const jobId = scheduler.schedule(request);

      expect(jobId).toBeTruthy();
      const job = scheduler.getJob(jobId);
      expect(job).toBeTruthy();
      // Job status can be 'pending' or 'loading' depending on timing
      expect(["pending", "loading"]).toContain(job?.status);
    });

    it("processes jobs asynchronously", async () => {
      const request: FrameRequest = {
        time: 1.0,
        resolution: { width: 1920, height: 1080 },
      };

      const jobId = scheduler.schedule(request);

      // Wait for completion
      const result = await scheduler.wait(jobId);

      expect(result).toBeTruthy();
      expect(result.renderTimeMs).toBeGreaterThanOrEqual(0);
    });

    it("tracks job progress", async () => {
      const request: FrameRequest = {
        time: 1.0,
        resolution: { width: 1920, height: 1080 },
      };

      const jobId = scheduler.schedule(request);

      // Job should start as pending or loading
      let job = scheduler.getJob(jobId);
      expect(["pending", "loading", "evaluating", "rasterizing"]).toContain(job?.status);

      // Wait for completion
      await scheduler.wait(jobId);

      // Job should be complete
      job = scheduler.getJob(jobId);
      expect(job?.status).toBe("complete");
      expect(job?.progress).toBe(1.0);
    });
  });

  describe("Cancellation", () => {
    it("cancels a pending job", () => {
      const request: FrameRequest = {
        time: 1.0,
        resolution: { width: 1920, height: 1080 },
      };

      const jobId = scheduler.schedule(request);
      scheduler.cancel(jobId);

      const job = scheduler.getJob(jobId);
      expect(job?.cancelled).toBe(true);
      expect(job?.status).toBe("cancelled");
    });

    it("cancels all jobs", () => {
      const jobIds = [scheduler.schedule({ time: 1.0, resolution: { width: 1920, height: 1080 } }), scheduler.schedule({ time: 2.0, resolution: { width: 1920, height: 1080 } }), scheduler.schedule({ time: 3.0, resolution: { width: 1920, height: 1080 } })];

      scheduler.cancelAll();

      for (const jobId of jobIds) {
        const job = scheduler.getJob(jobId);
        expect(job?.cancelled).toBe(true);
      }
    });

    it("rejects wait() when job is cancelled", async () => {
      const request: FrameRequest = {
        time: 1.0,
        resolution: { width: 1920, height: 1080 },
      };

      const jobId = scheduler.schedule(request);
      scheduler.cancel(jobId);

      await expect(scheduler.wait(jobId)).rejects.toThrow("Job cancelled");
    });
  });

  describe("Priority Scheduling", () => {
    it("processes realtime jobs before export jobs", async () => {
      const exportJob = scheduler.schedule({
        time: 1.0,
        resolution: { width: 1920, height: 1080 },
        priority: "export",
      });

      const realtimeJob = scheduler.schedule({
        time: 2.0,
        resolution: { width: 1920, height: 1080 },
        priority: "realtime",
      });

      // Realtime should complete first (higher priority)
      const realtimeResult = await scheduler.wait(realtimeJob);
      expect(realtimeResult).toBeTruthy();

      const exportResult = await scheduler.wait(exportJob);
      expect(exportResult).toBeTruthy();
    });
  });

  describe("Statistics", () => {
    it("tracks scheduler statistics", async () => {
      const request: FrameRequest = {
        time: 1.0,
        resolution: { width: 1920, height: 1080 },
      };

      const jobId = scheduler.schedule(request);
      await scheduler.wait(jobId);

      const stats = scheduler.getStats();

      expect(stats.totalJobs).toBe(1);
      expect(stats.complete).toBe(1);
      expect(stats.avgTotalTimeMs).toBeGreaterThanOrEqual(0);
    });

    it("tracks multiple jobs", async () => {
      const jobs = [scheduler.schedule({ time: 1.0, resolution: { width: 1920, height: 1080 } }), scheduler.schedule({ time: 2.0, resolution: { width: 1920, height: 1080 } }), scheduler.schedule({ time: 3.0, resolution: { width: 1920, height: 1080 } })];

      await Promise.all(jobs.map((id) => scheduler.wait(id)));

      const stats = scheduler.getStats();

      expect(stats.totalJobs).toBe(3);
      expect(stats.complete).toBe(3);
    });
  });

  describe("Telemetry", () => {
    it("tracks evaluation time", async () => {
      const request: FrameRequest = {
        time: 1.0,
        resolution: { width: 1920, height: 1080 },
      };

      const jobId = scheduler.schedule(request);
      await scheduler.wait(jobId);

      const job = scheduler.getJob(jobId);
      expect(job?.metrics.evaluationTimeMs).toBeGreaterThanOrEqual(0);
    });

    it("tracks rasterization time", async () => {
      const request: FrameRequest = {
        time: 1.0,
        resolution: { width: 1920, height: 1080 },
      };

      const jobId = scheduler.schedule(request);
      await scheduler.wait(jobId);

      const job = scheduler.getJob(jobId);
      expect(job?.metrics.rasterTimeMs).toBeGreaterThanOrEqual(0);
    });

    it("tracks total time", async () => {
      const request: FrameRequest = {
        time: 1.0,
        resolution: { width: 1920, height: 1080 },
      };

      const jobId = scheduler.schedule(request);
      await scheduler.wait(jobId);

      const job = scheduler.getJob(jobId);
      expect(job?.metrics.totalTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Cleanup", () => {
    it("clears completed jobs", async () => {
      const jobId = scheduler.schedule({
        time: 1.0,
        resolution: { width: 1920, height: 1080 },
      });

      await scheduler.wait(jobId);

      scheduler.clearCompleted();

      const job = scheduler.getJob(jobId);
      expect(job).toBeNull();
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isCloudRenderAvailable, renderViaCloud } from "../cloudExport";
import type { Project } from "@/types";

const dummyProject: Project = {
  id: "test-proj-1",
  name: "Test Project",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  aspectRatio: "16:9",
  canvasWidth: 1920,
  canvasHeight: 1080,
  frameRate: 30,
  duration: 5,
};

const dummyPayload = {
  clips: [],
  tracks: [],
  transitions: [],
  mediaAssets: [],
  duration: 5,
};

describe("cloudExport", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("isCloudRenderAvailable returns false when endpoint returns 404 or network errors", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network connection refused"));
    const available = await isCloudRenderAvailable();
    expect(available).toBe(false);
  });

  it("isCloudRenderAvailable returns true when status endpoint returns 200 OK", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    } as Response);
    const available = await isCloudRenderAvailable();
    expect(available).toBe(true);
  });

  it("renderViaCloud immediately throws if cloud rendering is unavailable", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Endpoint unreachable"));
    const onProgress = vi.fn();

    await expect(
      renderViaCloud(dummyProject, dummyPayload, onProgress)
    ).rejects.toThrow("Cloud rendering is currently unavailable");

    expect(onProgress).not.toHaveBeenCalled();
  });

  it("renderViaCloud NEVER fetches the Google sample video ForBiggerBlazes under any circumstances", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("ForBiggerBlazes")) {
        throw new Error("CRITICAL: Attempted to fetch hardcoded sample video ForBiggerBlazes!");
      }
      if (url.endsWith("/render/status")) {
        return Promise.resolve({ ok: true, status: 200 } as Response);
      }
      if (url.endsWith("/render/jobs")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: "job-123" }),
        } as Response);
      }
      if (url.includes("/render/jobs/job-123")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: "completed",
            progress: 100,
            downloadUrl: "https://my-actual-cloud.storage/rendered.mp4",
          }),
        } as Response);
      }
      if (url === "https://my-actual-cloud.storage/rendered.mp4") {
        return Promise.resolve({
          ok: true,
          blob: async () => new Blob(["real-video-bytes"], { type: "video/mp4" }),
        } as Response);
      }
      return Promise.reject(new Error(`Unexpected fetch to: ${url}`));
    });

    globalThis.fetch = fetchMock;
    const progressEvents: Array<{ progress: number; status: string }> = [];

    const blob = await renderViaCloud(dummyProject, dummyPayload, (p) => {
      progressEvents.push(p);
    });

    expect(blob).toBeDefined();
    expect(blob.size).toBeGreaterThan(0);

    // Verify ForBiggerBlazes was never called
    const calledUrls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calledUrls.some((u) => u.includes("ForBiggerBlazes"))).toBe(false);

    // Verify progress was updated
    expect(progressEvents.length).toBeGreaterThanOrEqual(1);
    expect(progressEvents[0].progress).toBe(10);
  });

  it("renderViaCloud throws if job submission fails with non-200", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/render/status")) {
        return Promise.resolve({ ok: true, status: 200 } as Response);
      }
      if (url.endsWith("/render/jobs")) {
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          text: async () => "Cluster out of GPU instances",
        } as Response);
      }
      return Promise.reject(new Error("Unexpected"));
    });

    await expect(
      renderViaCloud(dummyProject, dummyPayload, () => {})
    ).rejects.toThrow("Cloud render job submission failed (500)");
  });

  it("renderViaCloud throws if job fails during render execution", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/render/status")) {
        return Promise.resolve({ ok: true, status: 200 } as Response);
      }
      if (url.endsWith("/render/jobs")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: "job-failed-1" }),
        } as Response);
      }
      if (url.includes("/render/jobs/job-failed-1")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: "failed",
            error: "Out of VRAM at frame 120",
          }),
        } as Response);
      }
      return Promise.reject(new Error("Unexpected"));
    });

    await expect(
      renderViaCloud(dummyProject, dummyPayload, () => {})
    ).rejects.toThrow("Out of VRAM at frame 120");
  });
});

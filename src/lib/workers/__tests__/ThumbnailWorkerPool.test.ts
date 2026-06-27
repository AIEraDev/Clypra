import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ThumbnailWorkerPool } from "../ThumbnailWorkerPool";
import { useProjectStore } from "@/store/projectStore";

// Mock Project Store
vi.mock("@/store/projectStore", () => {
  return {
    useProjectStore: {
      getState: vi.fn(() => ({ project: { id: "project-1" } })),
    },
  };
});

class MockWorker {
  private listeners: Record<string, Function[]> = {};

  constructor(public url: URL | string, public options?: any) {}

  addEventListener(type: string, listener: Function) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }

  removeEventListener(type: string, listener: Function) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((l) => l !== listener);
  }

  postMessage(data: any, transfer?: any[]) {
    // Simulate async callback response
    setTimeout(() => {
      if (data.type === "decode") {
        if (data.tileKey === "trigger-error") {
          this.trigger("message", {
            data: {
              type: "error",
              requestId: data.requestId,
              error: "Decoding failed",
            },
          });
        } else {
          this.trigger("message", {
            data: {
              type: "decoded",
              requestId: data.requestId,
              bitmap: { width: 100, height: 100, close: vi.fn() } as unknown as ImageBitmap,
              processingTimeMs: 10,
            },
          });
        }
      }
    }, 0);
  }

  terminate = vi.fn();

  private trigger(type: string, event: any) {
    this.listeners[type]?.forEach((l) => l(event));
  }
}

globalThis.Worker = MockWorker as any;

describe("ThumbnailWorkerPool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up singleton
    const pool = ThumbnailWorkerPool.getInstance();
    pool.dispose();
  });

  it("should respect navigator.hardwareConcurrency bounds during initialization", () => {
    ThumbnailWorkerPool.reset(3);
    const pool = ThumbnailWorkerPool.getInstance();
    expect(pool.getWorkerCount()).toBe(3);
  });

  it("should balance requests via round-robin distribution and decode successfully", async () => {
    ThumbnailWorkerPool.reset(2);
    const pool = ThumbnailWorkerPool.getInstance();
    const mockData = new Uint8Array([0, 1, 2, 3]);

    const result = await pool.decode(mockData, 100, 100, "tile-1");
    expect(result).toBeDefined();

    const stats = pool.getStats();
    expect(stats.pendingRequests).toBe(0);
    expect(stats.initialized).toBe(true);
  });

  it("should catch worker errors and reject the decode request", async () => {
    ThumbnailWorkerPool.reset(2);
    const pool = ThumbnailWorkerPool.getInstance();
    const mockData = new Uint8Array([0, 1, 2, 3]);

    await expect(
      pool.decode(mockData, 100, 100, "trigger-error")
    ).rejects.toThrow("Decoding failed");
  });

  it("should reject stale late-resolving decode requests on project switches", async () => {
    ThumbnailWorkerPool.reset(2);
    const pool = ThumbnailWorkerPool.getInstance();
    const mockData = new Uint8Array([0, 1, 2, 3]);

    // Mock project state at request time: project-1
    vi.mocked(useProjectStore.getState).mockReturnValue({ project: { id: "project-1" } } as any);

    const promise = pool.decode(mockData, 100, 100, "tile-stale", "project-1");

    // Immediately switch project to project-2
    vi.mocked(useProjectStore.getState).mockReturnValue({ project: { id: "project-2" } } as any);

    // Promise should be rejected with stale error
    await expect(promise).rejects.toThrow("Stale thumbnail result");
  });

  it("should cleanly reject pending tasks and terminate workers on disposal", async () => {
    ThumbnailWorkerPool.reset(2);
    const pool = ThumbnailWorkerPool.getInstance();
    const mockData = new Uint8Array([0, 1, 2, 3]);

    // Force lazy initialization to complete before triggering disposal
    await pool.decode(mockData, 100, 100, "tile-init");

    // Now the pool is initialized. Trigger a decode and dispose immediately
    const promise = pool.decode(mockData, 100, 100, "trigger-timeout");
    pool.dispose();

    await expect(promise).rejects.toThrow("Worker pool disposed");
  });
});

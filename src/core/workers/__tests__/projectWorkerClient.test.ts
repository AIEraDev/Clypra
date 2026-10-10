import { describe, it, expect, beforeEach } from "vitest";
import {
  ProjectWorkerClient,
  getProjectWorkerClient,
} from "../projectWorkerClient";
import type { SerializableProjectState } from "@/workers/types";

describe("ProjectWorkerClient", () => {
  let client: ProjectWorkerClient;

  beforeEach(() => {
    client = new ProjectWorkerClient();
  });

  it("provides a singleton instance", () => {
    const s1 = getProjectWorkerClient();
    const s2 = getProjectWorkerClient();
    expect(s1).toBe(s2);
  });

  it("serializes project state to JSON string in fallback mode", async () => {
    const state: SerializableProjectState = {
      version: 1,
      project: { id: "p1", name: "My Project" },
      tracks: [{ id: "t1", type: "video" }],
      clips: [{ id: "c1", startTime: 0, duration: 5 }],
      gaps: [],
      transitions: [],
      markers: [],
      captionTracks: [],
      mediaAssets: [],
    };

    const res = await client.serialize(state);
    expect(res.type).toBe("SERIALIZED");
    expect(res.json).toContain('"My Project"');
    expect(res.serializeMs).toBeGreaterThanOrEqual(0);
  });

  it("computes structural diffs between project states", async () => {
    const prev: SerializableProjectState = {
      version: 1,
      project: { id: "p1", name: "Initial" },
      tracks: [{ id: "t1", type: "video" }],
      clips: [{ id: "c1", startTime: 0, duration: 5 }],
      gaps: [],
      transitions: [],
      markers: [],
      captionTracks: [],
      mediaAssets: [],
    };

    const next: SerializableProjectState = {
      ...prev,
      version: 2,
      project: { id: "p1", name: "Updated Name" },
      clips: [
        { id: "c1", startTime: 0, duration: 5 },
        { id: "c2", startTime: 5, duration: 4 },
      ],
    };

    const res = await client.diff(prev, next);
    expect(res.type).toBe("PATCH_READY");
    expect(res.patch.length).toBeGreaterThan(0);
  });

  it("clearOpfs dispatches with teardown budget", async () => {
    const originalWorker = (globalThis as any).Worker;
    (globalThis as any).Worker = class {} as any;
    Object.defineProperty((client as any).bus, "status", {
      value: "idle",
      configurable: true,
    });

    try {
      const sendSpy = vi.spyOn((client as any).bus, "send").mockResolvedValueOnce({
        type: "OPFS_CLEARED",
        id: "1",
        filename: "test.json",
        clearMs: 1,
      });

      await client.clearOpfs("test.json");
      expect(sendSpy).toHaveBeenCalledWith(
        { type: "CLEAR_OPFS", filename: "test.json" },
        [],
        { budgetMs: 1500 },
      );
    } finally {
      (globalThis as any).Worker = originalWorker;
    }
  });
});

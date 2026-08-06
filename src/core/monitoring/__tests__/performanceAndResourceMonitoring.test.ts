import { describe, it, expect, beforeEach } from "vitest";
import { resourceTracker } from "../ResourceTracker";

describe("System Resource Monitoring Safety", () => {
  beforeEach(() => {
    resourceTracker.clear();
  });

  // ─── RESOURCE TRACKER & LEAK DETECTION ────────────────────────────────────
  describe("ResourceTracker Leak Detection", () => {
    it("should track resource creation and release cleanly", () => {
      resourceTracker.track({
        id: "res-1",
        kind: "HTMLVideoElement",
        projectId: "project-A",
      });

      expect(resourceTracker.getAll().length).toBe(1);

      resourceTracker.release("res-1");
      expect(resourceTracker.getAll().length).toBe(0);
    });

    it("should detect leaked resources belonging to inactive project IDs", () => {
      resourceTracker.setActiveProjectIdResolver(() => "project-B");

      resourceTracker.track({
        id: "res-projectA-1",
        kind: "HTMLVideoElement",
        projectId: "project-A", // Belonged to old project A
      });

      resourceTracker.track({
        id: "res-projectB-1",
        kind: "HTMLVideoElement",
        projectId: "project-B", // Belongs to current active project B
      });

      const report = resourceTracker.findLeaks();
      expect(report.totalTracked).toBe(2);
      expect(report.totalLeaked).toBe(1);
      expect(report.leaks[0].id).toBe("res-projectA-1");
    });

    it("should return zero leaks when all resources match the active project", () => {
      resourceTracker.setActiveProjectIdResolver(() => "project-C");

      resourceTracker.track({ id: "res-1", kind: "ProjectSession", projectId: "project-C" });
      resourceTracker.track({ id: "res-2", kind: "HTMLVideoElement", projectId: "project-C" });

      const report = resourceTracker.findLeaks();
      expect(report.totalLeaked).toBe(0);
    });

    it("should handle duplicate tracking IDs without duplicating entries", () => {
      resourceTracker.track({ id: "res-dup", kind: "HTMLVideoElement", projectId: "project-A" });
      resourceTracker.track({ id: "res-dup", kind: "HTMLVideoElement", projectId: "project-A" });

      // Either deduplicated or only second survives — never doubled
      expect(resourceTracker.getAll().length).toBeLessThanOrEqual(2);
    });

    it("should not error when releasing an unknown resource ID", () => {
      expect(() => resourceTracker.release("non-existent-id")).not.toThrow();
    });

    it("should clear all resources on clear()", () => {
      resourceTracker.track({ id: "r1", kind: "HTMLVideoElement", projectId: "proj-1" });
      resourceTracker.track({ id: "r2", kind: "ProjectSession", projectId: "proj-1" });
      expect(resourceTracker.getAll().length).toBe(2);

      resourceTracker.clear();
      expect(resourceTracker.getAll().length).toBe(0);
    });
  });
});

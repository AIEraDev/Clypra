import { describe, it, expect, beforeEach } from "vitest";
import {
  TimelineSnapWorkerClient,
  getTimelineSnapWorkerClient,
} from "../timelineSnapWorkerClient";

describe("TimelineSnapWorkerClient", () => {
  let client: TimelineSnapWorkerClient;

  beforeEach(() => {
    client = new TimelineSnapWorkerClient();
    client.syncState(
      [
        { clipId: "c1", trackId: "t1", startTime: 0.0, duration: 4.0, locked: false },
        { clipId: "c2", trackId: "t1", startTime: 5.0, duration: 3.0, locked: false },
        { clipId: "c3", trackId: "t2", startTime: 2.0, duration: 6.0, locked: false },
      ],
      [{ markerId: "m1", time: 10.0 }],
    );
  });

  it("provides a singleton instance", () => {
    const s1 = getTimelineSnapWorkerClient();
    const s2 = getTimelineSnapWorkerClient();
    expect(s1).toBe(s2);
  });

  it("snaps to nearest clip boundary when within threshold", async () => {
    // Proposing start time at 3.95s when c1 ends at 4.0s (threshold: 0.1s)
    const res = await client.querySnap("c-dragged", 3.95, "t1", {
      snapEnabled: true,
      snapRadiusSeconds: 0.1,
      playheadTime: 12.0,
    });

    expect(res.snappedTime).toBe(4.0);
    expect(res.snapGuides.length).toBe(1);
    expect(res.snapGuides[0].guideType).toBe("clip-end");
  });

  it("snaps to timeline start at t = 0", async () => {
    const res = await client.querySnap("c-dragged", 0.04, "t1", {
      snapEnabled: true,
      snapRadiusSeconds: 0.1,
    });

    expect(res.snappedTime).toBe(0);
    expect(res.snapGuides[0].guideType).toBe("clip-start");
  });

  it("snaps to playhead when near playheadTime", async () => {
    const res = await client.querySnap("c-dragged", 7.98, "t1", {
      snapEnabled: true,
      snapRadiusSeconds: 0.1,
      playheadTime: 8.0,
    });

    expect(res.snappedTime).toBe(8.0);
    expect(res.snapGuides[0].guideType).toBe("playhead");
  });

  it("detects colliding clips on the target track", async () => {
    // Overlapping c1 (0..4s) on track t1
    const res = await client.querySnap("c-dragged", 2.0, "t1", {
      snapEnabled: false,
    });

    expect(res.snappedTime).toBe(2.0);
    expect(res.collidingClipIds).toContain("c1");
  });

  it("computes multi-track ripple displacements correctly", async () => {
    const res = await client.computeRipple("c1", "right", 2.5, []);
    expect(res.clipDeltas.length).toBeGreaterThan(0);
    // c2 starts at 5.0 (>= c1 end 4.0), should ripple
    const c2Delta = res.clipDeltas.find((d) => d.clipId === "c2");
    expect(c2Delta).toBeDefined();
    expect(c2Delta?.deltaSeconds).toBe(2.5);
  });
});

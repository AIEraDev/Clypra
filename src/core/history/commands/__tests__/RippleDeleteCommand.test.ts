/**
 * RippleDeleteCommand Tests
 *
 * Tests professional ripple delete behavior: deleting clips
 * and auto-closing gaps on the same track.
 */

import { describe, it, expect } from "vitest";
import { RippleDeleteCommand } from "../RippleDeleteCommand";
import type { Clip } from "@/types";

describe("RippleDeleteCommand", () => {
  const createTestClip = (overrides?: Partial<Clip>): Clip => ({
    id: `clip-${Math.random()}`,
    trackId: "track-1",
    mediaId: "media-1",
    startTime: 0,
    duration: 5,
    trimIn: 0,
    trimOut: 5,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    opacity: 1,
    rotation: 0,
    ...overrides,
  });

  describe("basic ripple delete", () => {
    it("deletes clip and shifts subsequent clips left", () => {
      const clipA = createTestClip({ id: "A", startTime: 0, duration: 5 });
      const clipB = createTestClip({ id: "B", startTime: 5, duration: 3 });
      const clipC = createTestClip({ id: "C", startTime: 8, duration: 4 });

      const command = new RippleDeleteCommand("B");
      const state = { clips: [clipA, clipB, clipC], epoch: 0 };
      const newState = command.apply(state);

      expect(newState.clips).toHaveLength(2);

      const clipCAfter = newState.clips.find((c) => c.id === "C");
      expect(clipCAfter?.startTime).toBe(5); // Shifted left by clipB.duration (3)
    });

    it("does not shift clips on different tracks", () => {
      const clip1Track1 = createTestClip({ id: "1-1", trackId: "track-1", startTime: 0, duration: 5 });
      const clip2Track1 = createTestClip({ id: "2-1", trackId: "track-1", startTime: 5, duration: 3 });
      const clip1Track2 = createTestClip({ id: "1-2", trackId: "track-2", startTime: 5, duration: 3 });

      const command = new RippleDeleteCommand("2-1");
      const state = { clips: [clip1Track1, clip2Track1, clip1Track2], epoch: 0 };
      const newState = command.apply(state);

      // Track 2 clip should NOT shift
      const track2Clip = newState.clips.find((c) => c.id === "1-2");
      expect(track2Clip?.startTime).toBe(5); // Unchanged
    });
  });

  describe("gap closing", () => {
    it("closes gap when deleting middle clip", () => {
      const clipA = createTestClip({ id: "A", startTime: 0, duration: 10 });
      const clipB = createTestClip({ id: "B", startTime: 10, duration: 5 });
      const clipC = createTestClip({ id: "C", startTime: 15, duration: 10 });

      const command = new RippleDeleteCommand("B");
      const newState = command.apply({ clips: [clipA, clipB, clipC], epoch: 0 });

      // No gap between A and C
      const clipCAfter = newState.clips.find((c) => c.id === "C");
      expect(clipCAfter?.startTime).toBe(10); // Touches clipA end
    });

    it("handles multiple clips after deleted clip", () => {
      const clips = [createTestClip({ id: "A", startTime: 0, duration: 5 }), createTestClip({ id: "B", startTime: 5, duration: 3 }), createTestClip({ id: "C", startTime: 8, duration: 2 }), createTestClip({ id: "D", startTime: 10, duration: 4 })];

      const command = new RippleDeleteCommand("B");
      const newState = command.apply({ clips, epoch: 0 });

      // All clips after B should shift left by 3
      const clipC = newState.clips.find((c) => c.id === "C");
      const clipD = newState.clips.find((c) => c.id === "D");

      expect(clipC?.startTime).toBe(5); // Was 8, shifted by -3
      expect(clipD?.startTime).toBe(7); // Was 10, shifted by -3
    });
  });

  describe("undo/redo", () => {
    it("restores deleted clip and original positions", () => {
      const clipA = createTestClip({ id: "A", startTime: 0, duration: 5 });
      const clipB = createTestClip({ id: "B", startTime: 5, duration: 3 });
      const clipC = createTestClip({ id: "C", startTime: 8, duration: 4 });

      const command = new RippleDeleteCommand("B");
      const state = { clips: [clipA, clipB, clipC], epoch: 0 };
      const afterDelete = command.apply(state);

      const undoCommand = command.invert();
      const afterUndo = undoCommand.apply(afterDelete) as { clips: Clip[] };

      expect(afterUndo.clips).toHaveLength(3);

      const restoredB = afterUndo.clips.find((c) => c.id === "B");
      const restoredC = afterUndo.clips.find((c) => c.id === "C");

      expect(restoredB).toBeDefined();
      expect(restoredC?.startTime).toBe(8); // Back to original position
    });

    it("restores deleted track when deleting the last clip on a track is undone", () => {
      const track = { id: "track-1", type: "video" as const, name: "Video 1", muted: false, locked: false, visible: true, height: 68 };
      const clip = createTestClip({ id: "A", trackId: "track-1" });
      const command = new RippleDeleteCommand("A");
      const state = { tracks: [track], clips: [clip], epoch: 0 };

      const newState = command.apply(state);
      expect(newState.tracks).toHaveLength(0); // Track should be auto-deleted because it is empty

      const undoCommand = command.invert();
      const restoredState = undoCommand.apply(newState);
      expect(restoredState.tracks).toHaveLength(1); // Track should be restored
      expect(restoredState.tracks![0].id).toBe("track-1");
    });
  });

  describe("edge cases", () => {
    it("handles deleting first clip", () => {
      const clipA = createTestClip({ id: "A", startTime: 0, duration: 5 });
      const clipB = createTestClip({ id: "B", startTime: 5, duration: 3 });

      const command = new RippleDeleteCommand("A");
      const newState = command.apply({ clips: [clipA, clipB], epoch: 0 });

      const clipBAfter = newState.clips.find((c) => c.id === "B");
      expect(clipBAfter?.startTime).toBe(0); // Shifted to timeline start
    });

    it("handles deleting last clip", () => {
      const clipA = createTestClip({ id: "A", startTime: 0, duration: 5 });
      const clipB = createTestClip({ id: "B", startTime: 5, duration: 3 });

      const command = new RippleDeleteCommand("B");
      const newState = command.apply({ clips: [clipA, clipB], epoch: 0 });

      expect(newState.clips).toHaveLength(1);
      const clipAAfter = newState.clips.find((c) => c.id === "A");
      expect(clipAAfter?.startTime).toBe(0); // Unchanged
    });

    it("handles single clip on track", () => {
      const clip = createTestClip({ id: "A" });
      const command = new RippleDeleteCommand("A");
      const newState = command.apply({ clips: [clip], epoch: 0 });

      expect(newState.clips).toHaveLength(0);
    });

    it("handles missing clip gracefully", () => {
      const clip = createTestClip({ id: "A" });
      const command = new RippleDeleteCommand("nonexistent");
      const state = { clips: [clip], epoch: 0 };

      const newState = command.apply(state);
      expect(newState.clips).toHaveLength(1);
    });
  });
});

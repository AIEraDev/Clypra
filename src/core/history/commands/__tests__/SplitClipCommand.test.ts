/**
 * SplitClipCommand Tests
 *
 * Tests clip splitting with frame snapping to ensure smooth cuts
 * and proper trimOut setting.
 */

import { describe, it, expect } from "vitest";
import { SplitClipCommand } from "../SplitClipCommand";
import type { Clip } from "@/types";

describe("SplitClipCommand", () => {
  const createTestClip = (overrides?: Partial<Clip>): Clip => ({
    id: "clip-1",
    trackId: "track-1",
    mediaId: "media-1",
    startTime: 0,
    duration: 10,
    trimIn: 0,
    trimOut: 10,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    opacity: 1,
    rotation: 0,
    ...overrides,
  });

  describe("basic splitting", () => {
    it("splits clip into two pieces", () => {
      const clip = createTestClip();
      const command = new SplitClipCommand("clip-1", 5.0, 30, clip);

      const state = {
        clips: [clip],
        epoch: 0,
      };

      const newState = command.apply(state);

      expect(newState.clips).toHaveLength(2);
      expect(newState.epoch).toBe(1);

      // Both splits should have NEW IDs (not original)
      const leftClipId = command.getLeftClipId();
      const rightClipId = command.getRightClipId();
      expect(leftClipId).not.toBeNull();
      expect(rightClipId).not.toBeNull();
      expect(leftClipId).not.toBe("clip-1"); // Left gets new ID
      expect(rightClipId).not.toBe("clip-1"); // Right gets new ID
      expect(leftClipId).not.toBe(rightClipId); // Different IDs

      // Original clip should be removed
      expect(newState.clips.find((c) => c.id === "clip-1")).toBeUndefined();
    });

    it("restores a middle clip to its original array position on undo", () => {
      const before = createTestClip({ id: "before", startTime: 0, duration: 2, trimOut: 2 });
      const middle = createTestClip({ id: "middle", startTime: 2, duration: 6, trimOut: 6 });
      const after = createTestClip({ id: "after", startTime: 8, duration: 2, trimIn: 6, trimOut: 8 });
      const command = new SplitClipCommand("middle", 5, 30, middle);

      const split = command.apply({ clips: [before, middle, after], epoch: 0 });
      const restored = command.invert().apply(split);

      expect(restored.clips.map((clip: Clip) => clip.id)).toEqual(["before", "middle", "after"]);
    });

    it("sets trimOut correctly on left clip", () => {
      const clip = createTestClip({
        startTime: 0,
        duration: 10,
        trimIn: 0,
        trimOut: 10,
      });

      const command = new SplitClipCommand("clip-1", 5.0, 30, clip);
      const newState = command.apply({ clips: [clip], epoch: 0 });

      // Left clip has new ID
      const leftClipId = command.getLeftClipId();
      const leftClip = newState.clips.find((c) => c.id === leftClipId);

      expect(leftClip).toBeDefined();
      expect(leftClip?.trimOut).toBe(5.0);
      expect(leftClip?.duration).toBe(5.0);
    });

    it("sets trimIn and trimOut correctly on right clip", () => {
      const clip = createTestClip({
        startTime: 0,
        duration: 10,
        trimIn: 0,
        trimOut: 10,
      });

      const command = new SplitClipCommand("clip-1", 5.0, 30, clip);
      const newState = command.apply({ clips: [clip], epoch: 0 });

      // Right clip has new ID
      const rightClipId = command.getRightClipId();
      const rightClip = newState.clips.find((c) => c.id === rightClipId);

      expect(rightClip).toBeDefined();
      expect(rightClip?.trimIn).toBe(5.0);
      expect(rightClip?.trimOut).toBe(10.0);
      expect(rightClip?.startTime).toBe(5.0);
      expect(rightClip?.duration).toBe(5.0);
    });

    it("isolates nested text and audio metadata between split halves and undo", () => {
      const clip = createTestClip({
        kind: "compound",
        compoundChildren: [
          {
            ...createTestClip({ id: "text-child", kind: "text" }),
            styleDefinition: { id: "pinned-title", version: "3" },
            parameterOverrides: { glowRadius: 0.4 },
          } as any,
          {
            ...createTestClip({ id: "audio-child", kind: "audio" }),
            audio: { gainDb: -6, volumeKeyframes: [] },
          } as any,
        ],
      });
      const command = new SplitClipCommand("clip-1", 5, 30, clip);

      const split = command.apply({ clips: [clip], epoch: 0 });
      const left = split.clips.find((candidate) => candidate.id === command.getLeftClipId())!;
      const right = split.clips.find((candidate) => candidate.id === command.getRightClipId())!;

      (left.compoundChildren![0] as any).styleDefinition.version = "mutated";
      (left.compoundChildren![1] as any).audio.gainDb = 12;

      expect((right.compoundChildren![0] as any).styleDefinition).toEqual({ id: "pinned-title", version: "3" });
      expect((right.compoundChildren![1] as any).audio.gainDb).toBe(-6);

      const restored = command.invert().apply(split);
      const restoredChildren = restored.clips[0].compoundChildren!;
      expect((restoredChildren[0] as any).styleDefinition).toEqual({ id: "pinned-title", version: "3" });
      expect((restoredChildren[1] as any).audio.gainDb).toBe(-6);
    });
  });

  describe("frame snapping", () => {
    it("snaps split time to nearest frame boundary", () => {
      const clip = createTestClip({
        startTime: 0,
        duration: 10,
        trimIn: 0,
        trimOut: 10,
      });

      // Split at non-frame boundary: 5.467s at 30fps
      const command = new SplitClipCommand("clip-1", 5.467, 30, clip);
      const newState = command.apply({ clips: [clip], epoch: 0 });

      // Use getRightClipId() to find right clip
      const rightClipId = command.getRightClipId();
      const rightClip = newState.clips.find((c) => c.id === rightClipId);

      // Should snap to nearest frame: 5.467 * 30 = 164.01 → 164 frames → 5.4667s
      const expectedSnap = Math.round(5.467 * 30) / 30;
      expect(rightClip?.startTime).toBeCloseTo(expectedSnap, 4);
    });

    it("maintains coherence: left.trimOut === right.trimIn", () => {
      const clip = createTestClip({
        startTime: 0,
        duration: 10,
        trimIn: 0,
        trimOut: 10,
      });

      const command = new SplitClipCommand("clip-1", 5.467, 30, clip);
      const newState = command.apply({ clips: [clip], epoch: 0 });

      // Use getLeftClipId() and getRightClipId()
      const leftClipId = command.getLeftClipId();
      const rightClipId = command.getRightClipId();
      const leftClip = newState.clips.find((c) => c.id === leftClipId);
      const rightClip = newState.clips.find((c) => c.id === rightClipId);

      // Critical: must be identical for smooth cuts
      expect(leftClip?.trimOut).toBe(rightClip?.trimIn);
    });
  });

  describe("split with existing trim", () => {
    it("handles clips with non-zero trimIn", () => {
      const clip = createTestClip({
        startTime: 10,
        duration: 6,
        trimIn: 2, // Clip starts 2s into media
        trimOut: 8,
      });

      const command = new SplitClipCommand("clip-1", 13.0, 30, clip);
      const newState = command.apply({ clips: [clip], epoch: 0 });

      // Use getLeftClipId() and getRightClipId()
      const leftClipId = command.getLeftClipId();
      const rightClipId = command.getRightClipId();
      const leftClip = newState.clips.find((c) => c.id === leftClipId);
      const rightClip = newState.clips.find((c) => c.id === rightClipId);

      // Left: trimIn 2 → trimOut 5 (3s into the timeline clip)
      expect(leftClip?.trimIn).toBe(2);
      expect(leftClip?.trimOut).toBe(5);
      expect(leftClip?.duration).toBe(3);

      // Right: starts at the split and continues from the matching source
      // position, rather than restarting at source time zero.
      expect(rightClip?.trimIn).toBe(5);
      expect(rightClip?.trimOut).toBe(8);
      expect(rightClip?.startTime).toBe(13);
      expect(rightClip?.duration).toBe(3);
    });

    it("handles already-split clips (middle piece)", () => {
      // Simulates the bug case from the issue
      const middleClip = createTestClip({
        startTime: 36.94,
        duration: 2.0,
        trimIn: 36.94,
        trimOut: 38.94,
      });

      const command = new SplitClipCommand("clip-1", 37.5, 30, middleClip);
      const newState = command.apply({ clips: [middleClip], epoch: 0 });

      // Use getLeftClipId() and getRightClipId()
      const leftClipId = command.getLeftClipId();
      const rightClipId = command.getRightClipId();
      const leftClip = newState.clips.find((c) => c.id === leftClipId);
      const rightClip = newState.clips.find((c) => c.id === rightClipId);

      // Both pieces should have valid trimOut
      expect(leftClip?.trimOut).toBeDefined();
      expect(rightClip?.trimOut).toBeDefined();
      expect(leftClip?.trimOut).toBeLessThanOrEqual(middleClip.trimOut);
      expect(rightClip?.trimOut).toBe(middleClip.trimOut);
    });
  });

  describe("validation", () => {
    it("rejects split outside clip bounds", () => {
      const clip = createTestClip({
        startTime: 10,
        duration: 5,
      });

      const beforeClip = new SplitClipCommand("clip-1", 9, 30, clip);
      const afterClip = new SplitClipCommand("clip-1", 16, 30, clip);

      const state = { clips: [clip], epoch: 0 };

      // Should return state unchanged
      expect(beforeClip.apply(state)).toEqual(state);
      expect(afterClip.apply(state)).toEqual(state);
    });

    it("rejects split at exact clip boundaries", () => {
      const clip = createTestClip({
        startTime: 10,
        duration: 5,
      });

      const atStart = new SplitClipCommand("clip-1", 10, 30, clip);
      const atEnd = new SplitClipCommand("clip-1", 15, 30, clip);

      const state = { clips: [clip], epoch: 0 };

      expect(atStart.apply(state)).toEqual(state);
      expect(atEnd.apply(state)).toEqual(state);
    });

    it("rejects split when frame snapping lands on the clip start", () => {
      const clip = createTestClip({
        startTime: 10,
        duration: 5,
        trimIn: 0,
        trimOut: 5,
      });

      const command = new SplitClipCommand("clip-1", 10.001, 30, clip);
      const state = { clips: [clip], epoch: 0 };

      expect(command.apply(state)).toEqual(state);
      expect(command.getCreatedClipId()).toBeNull();
    });

    it("rejects split when frame snapping lands on the clip end", () => {
      const clip = createTestClip({
        startTime: 10,
        duration: 5,
        trimIn: 0,
        trimOut: 5,
      });

      const command = new SplitClipCommand("clip-1", 14.999, 30, clip);
      const state = { clips: [clip], epoch: 0 };

      expect(command.apply(state)).toEqual(state);
      expect(command.getCreatedClipId()).toBeNull();
    });

    it("handles missing clip gracefully", () => {
      const clip = createTestClip();
      const command = new SplitClipCommand("nonexistent", 5, 30, clip);

      const state = { clips: [clip], epoch: 0 };
      expect(command.apply(state)).toEqual(state);
    });
  });

  describe("serialization", () => {
    it("serializes and deserializes correctly", () => {
      const clip = createTestClip();
      const command = new SplitClipCommand("clip-1", 5.0, 30, clip);

      const json = command.toJSON();
      expect(json).toHaveProperty("type", "SplitClip");
      expect(json).toHaveProperty("frameRate", 30);

      const restored = SplitClipCommand.fromJSON(json);
      expect(restored).toBeInstanceOf(SplitClipCommand);
    });
  });

  describe("undo/redo", () => {
    it("creates invertible command", () => {
      const clip = createTestClip();
      const command = new SplitClipCommand("clip-1", 5.0, 30, clip);

      const state = { clips: [clip], epoch: 0 };
      const afterSplit = command.apply(state);

      const undoCommand = command.invert();
      const afterUndo = undoCommand.apply(afterSplit);

      // Should restore original clip (though IDs may differ)
      expect(afterUndo.clips).toHaveLength(1);
      expect(afterUndo.clips[0].duration).toBe(clip.duration);
    });
  });

  describe("edge cases", () => {
    it("handles split at 1 frame duration", () => {
      const clip = createTestClip({
        startTime: 0,
        duration: 0.066, // 2 frames at 30fps
      });

      const command = new SplitClipCommand("clip-1", 0.033, 30, clip);
      const newState = command.apply({ clips: [clip], epoch: 0 });

      expect(newState.clips).toHaveLength(2);
    });

    it("handles very large timecodes", () => {
      const clip = createTestClip({
        startTime: 3600, // 1 hour
        duration: 600, // 10 minutes
      });

      const command = new SplitClipCommand("clip-1", 3900, 30, clip);
      const newState = command.apply({ clips: [clip], epoch: 0 });

      expect(newState.clips).toHaveLength(2);
    });
  });

  describe("Both splits get new IDs", () => {
    it("generates new IDs for both left and right splits", () => {
      const clip = createTestClip({
        id: "original-clip",
        startTime: 0,
        duration: 10,
      });

      const command = new SplitClipCommand("original-clip", 5.0, 30, clip);
      const newState = command.apply({ clips: [clip], epoch: 0 });

      const leftClipId = command.getLeftClipId();
      const rightClipId = command.getRightClipId();

      // Both should have new IDs
      expect(leftClipId).not.toBe("original-clip");
      expect(rightClipId).not.toBe("original-clip");
      expect(leftClipId).not.toBe(rightClipId);

      // Original clip should be removed from timeline
      expect(newState.clips.find((c) => c.id === "original-clip")).toBeUndefined();

      // Both new clips should exist
      expect(newState.clips.find((c) => c.id === leftClipId)).toBeDefined();
      expect(newState.clips.find((c) => c.id === rightClipId)).toBeDefined();
    });

    it("prevents property confusion after split", () => {
      // This is the core issue: volume/effects should NOT bind to wrong clip
      const clip = createTestClip({
        id: "clip-with-volume",
        startTime: 0,
        duration: 10,
        volume: 0.5,
      });

      const command = new SplitClipCommand("clip-with-volume", 5.0, 30, clip);
      const newState = command.apply({ clips: [clip], epoch: 0 });

      const leftClipId = command.getLeftClipId();
      const rightClipId = command.getRightClipId();
      const leftClip = newState.clips.find((c) => c.id === leftClipId);
      const rightClip = newState.clips.find((c) => c.id === rightClipId);

      // Both clips inherit volume from original
      expect(leftClip?.volume).toBe(0.5);
      expect(rightClip?.volume).toBe(0.5);

      // But they have different IDs, so modifying one won't affect the other
      expect(leftClipId).not.toBe(rightClipId);
    });

    it("provides backward compatibility with getCreatedClipId()", () => {
      const clip = createTestClip();
      const command = new SplitClipCommand("clip-1", 5.0, 30, clip);
      command.apply({ clips: [clip], epoch: 0 });

      // Old code using getCreatedClipId() should still work (returns right clip)
      const createdId = command.getCreatedClipId();
      const rightId = command.getRightClipId();

      expect(createdId).toBe(rightId);
    });

    it("serializes both new clip IDs", () => {
      const clip = createTestClip();
      const command = new SplitClipCommand("clip-1", 5.0, 30, clip);
      command.apply({ clips: [clip], epoch: 0 });

      const json = command.toJSON();

      expect(json.leftClipId).toBeDefined();
      expect(json.rightClipId).toBeDefined();
      expect(json.leftClipId).not.toBe(json.rightClipId);

      // Backward compatibility: newClipId should equal rightClipId
      expect(json.newClipId).toBe(json.rightClipId);
    });

    it("deserializes old format (migration)", () => {
      // Old format: only newClipId, left kept original ID
      const oldJson = {
        type: "SplitClip",
        clipId: "original-clip",
        splitTime: 5.0,
        frameRate: 30,
        originalClip: createTestClip({ id: "original-clip" }),
        newClipId: "right-clip-id",
      };

      const command = SplitClipCommand.fromJSON(oldJson);

      // Should map old format to new fields
      expect(command.getLeftClipId()).toBe("original-clip"); // Old: left kept original
      expect(command.getRightClipId()).toBe("right-clip-id");
    });

    it("deserializes new format", () => {
      // New format: both leftClipId and rightClipId
      const newJson = {
        type: "SplitClip",
        clipId: "original-clip",
        splitTime: 5.0,
        frameRate: 30,
        originalClip: createTestClip({ id: "original-clip" }),
        leftClipId: "left-clip-id",
        rightClipId: "right-clip-id",
      };

      const command = SplitClipCommand.fromJSON(newJson);

      expect(command.getLeftClipId()).toBe("left-clip-id");
      expect(command.getRightClipId()).toBe("right-clip-id");
    });
  });
});

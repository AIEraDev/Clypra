/**
 * Gap Commands Tests
 *
 * Tests for undoable gap operations: Insert, Remove, Resize, ToggleProtection
 * Covers command execution, undo, redo, and serialization.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InsertGapCommand, RemoveGapCommand, ResizeGapCommand, ToggleGapProtectionCommand } from "./GapCommands";
import type { Clip } from "@/types";
import type { Gap } from "@/types/gap";

// Helper to create test state
const createTestState = () => {
  const clips: any[] = [
    {
      id: "clip1",
      trackId: "track1",
      startTime: 0,
      duration: 5,
      mediaId: "media1",
      trimIn: 0,
      trimOut: 5,
      transform: { x: 0, y: 0, scale: 1, rotation: 0 },
      effects: [],
      volume: 1,
      speed: 1,
      locked: false,
    },
    {
      id: "clip2",
      trackId: "track1",
      startTime: 10,
      duration: 5,
      mediaId: "media2",
      trimIn: 0,
      trimOut: 5,
      transform: { x: 0, y: 0, scale: 1, rotation: 0 },
      effects: [],
      volume: 1,
      speed: 1,
      locked: false,
    },
  ];

  const gaps: Gap[] = [];

  return { clips: clips as Clip[], gaps, epoch: 0 };
};

describe("InsertGapCommand", () => {
  it("should insert gap and shift clips", () => {
    const state = createTestState();
    const command = new InsertGapCommand("track1", 7, 3);

    const newState = command.apply(state);

    // Gap should be created
    expect(newState.gaps).toHaveLength(1);
    expect(newState.gaps[0].startTime).toBe(7);
    expect(newState.gaps[0].duration).toBe(3);

    // Clip2 should be shifted right by 3 seconds
    const clip2 = newState.clips.find((c) => c.id === "clip2");
    expect(clip2!.startTime).toBe(13);

    // Clip1 should be unchanged
    const clip1 = newState.clips.find((c) => c.id === "clip1");
    expect(clip1!.startTime).toBe(0);
  });

  it("should undo gap insertion", () => {
    const state = createTestState();
    const command = new InsertGapCommand("track1", 7, 3);

    const newState = command.apply(state);
    const undoCommand = command.invert();
    const restoredState = undoCommand.apply(newState);

    // Gap should be removed
    expect(restoredState.gaps).toHaveLength(0);

    // Clips should be back to original positions
    const clip2 = restoredState.clips.find((c: any) => c.id === "clip2");
    expect(clip2!.startTime).toBe(10);
  });

  it("should handle insertion at start", () => {
    const state = createTestState();
    const command = new InsertGapCommand("track1", 0, 2);

    const newState = command.apply(state);

    // All clips should be shifted
    const clip1 = newState.clips.find((c) => c.id === "clip1");
    const clip2 = newState.clips.find((c) => c.id === "clip2");
    expect(clip1!.startTime).toBe(2);
    expect(clip2!.startTime).toBe(12);
  });

  it("should handle insertion at end (no clips affected)", () => {
    const state = createTestState();
    const command = new InsertGapCommand("track1", 20, 3);

    const newState = command.apply(state);

    // Gap created but no clips affected
    expect(newState.gaps).toHaveLength(1);
    const clip1 = newState.clips.find((c) => c.id === "clip1");
    const clip2 = newState.clips.find((c) => c.id === "clip2");
    expect(clip1!.startTime).toBe(0);
    expect(clip2!.startTime).toBe(10);
  });

  it("should preserve other track clips", () => {
    const state = createTestState();
    state.clips.push({
      id: "clip3",
      trackId: "track2",
      startTime: 7,
      duration: 5,
      mediaId: "media3",
      trimIn: 0,
      trimOut: 5,
      transform: { x: 0, y: 0, scale: 1, rotation: 0 },
      effects: [],
      volume: 1,
      speed: 1,
      locked: false,
    } as any);

    const command = new InsertGapCommand("track1", 7, 3);
    const newState = command.apply(state);

    // Track2 clip should be unchanged
    const clip3 = newState.clips.find((c) => c.id === "clip3");
    expect(clip3!.startTime).toBe(7);
  });

  it("should serialize and deserialize correctly", () => {
    const command = new InsertGapCommand("track1", 5, 2);
    const json = command.toJSON();

    const deserialized = InsertGapCommand.fromJSON(json);

    expect((deserialized as any).trackId).toBe((command as any).trackId);
    expect((deserialized as any).startTime).toBe((command as any).startTime);
    expect((deserialized as any).duration).toBe((command as any).duration);
  });
});

describe("RemoveGapCommand", () => {
  let stateWithGap: ReturnType<typeof createTestState>;
  let gapId: string;

  beforeEach(() => {
    const state = createTestState();
    const insertCommand = new InsertGapCommand("track1", 7, 3);
    stateWithGap = insertCommand.apply(state);
    gapId = stateWithGap.gaps[0].id;
  });

  it("should remove gap and shift clips", () => {
    const command = new RemoveGapCommand(gapId);
    const newState = command.apply(stateWithGap);

    // Gap should be removed
    expect(newState.gaps).toHaveLength(0);

    // Clip2 should be shifted left by 3 seconds
    const clip2 = newState.clips.find((c) => c.id === "clip2");
    expect(clip2!.startTime).toBe(10);
  });

  it("should undo gap removal", () => {
    const command = new RemoveGapCommand(gapId);
    const removedState = command.apply(stateWithGap);

    const undoCommand = command.invert();
    const restoredState = undoCommand.apply(removedState);

    // Gap should be restored
    expect(restoredState.gaps).toHaveLength(1);
    expect(restoredState.gaps[0].startTime).toBe(7);
    expect(restoredState.gaps[0].duration).toBe(3);

    // Clips should be back to shifted positions
    const clip2 = restoredState.clips.find((c: any) => c.id === "clip2");
    expect(clip2!.startTime).toBe(13);
  });

  it("should handle removing non-existent gap", () => {
    const command = new RemoveGapCommand("non-existent-gap");
    const newState = command.apply(stateWithGap);

    // Should not crash, state unchanged
    expect(newState.gaps).toHaveLength(1);
  });

  it("should serialize and deserialize correctly", () => {
    const command = new RemoveGapCommand(gapId);
    const json = command.toJSON();

    const deserialized = RemoveGapCommand.fromJSON(json);

    expect((deserialized as any).gapId).toBe((command as any).gapId);
  });
});

describe("ResizeGapCommand", () => {
  let stateWithGap: ReturnType<typeof createTestState>;
  let gapId: string;

  beforeEach(() => {
    const state = createTestState();
    const insertCommand = new InsertGapCommand("track1", 7, 3);
    stateWithGap = insertCommand.apply(state);
    gapId = stateWithGap.gaps[0].id;
  });

  it("should increase gap duration and shift clips", () => {
    const command = new ResizeGapCommand(gapId, 5); // Increase to 5s
    const newState = command.apply(stateWithGap);

    // Gap should be resized
    const gap = newState.gaps.find((g) => g.id === gapId);
    expect(gap!.duration).toBe(5);

    // Clip2 should be shifted further right (+2 seconds more)
    const clip2 = newState.clips.find((c) => c.id === "clip2");
    expect(clip2!.startTime).toBe(15); // Was 13, now 13 + 2 = 15
  });

  it("should decrease gap duration and shift clips left", () => {
    const command = new ResizeGapCommand(gapId, 1); // Decrease to 1s
    const newState = command.apply(stateWithGap);

    // Gap should be resized
    const gap = newState.gaps.find((g) => g.id === gapId);
    expect(gap!.duration).toBe(1);

    // Clip2 should be shifted left (-2 seconds)
    const clip2 = newState.clips.find((c) => c.id === "clip2");
    expect(clip2!.startTime).toBe(11); // Was 13, now 13 - 2 = 11
  });

  it("should undo gap resize", () => {
    const command = new ResizeGapCommand(gapId, 5);
    const resizedState = command.apply(stateWithGap);
    const undoCommand = command.invert();
    const restoredState = undoCommand.apply(resizedState);

    // Gap should be back to original duration
    const gap = restoredState.gaps.find((g: any) => g.id === gapId);
    expect(gap!.duration).toBe(3);

    // Clips should be back to original positions
    const clip2 = restoredState.clips.find((c: any) => c.id === "clip2");
    expect(clip2!.startTime).toBe(13);
  });

  it("should handle resizing non-existent gap", () => {
    const command = new ResizeGapCommand("non-existent-gap", 5);
    const newState = command.apply(stateWithGap);

    // Should not crash, state unchanged
    const gap = newState.gaps.find((g) => g.id === gapId);
    expect(gap!.duration).toBe(3);
  });

  it("should serialize and deserialize correctly", () => {
    const command = new ResizeGapCommand(gapId, 5);
    const json = command.toJSON();

    const deserialized = ResizeGapCommand.fromJSON(json);

    expect((deserialized as any).gapId).toBe((command as any).gapId);
    expect((deserialized as any).newDuration).toBe((command as any).newDuration);
  });
});

describe("ToggleGapProtectionCommand", () => {
  let stateWithGap: ReturnType<typeof createTestState>;
  let gapId: string;

  beforeEach(() => {
    const state = createTestState();
    const insertCommand = new InsertGapCommand("track1", 7, 3);
    stateWithGap = insertCommand.apply(state);
    gapId = stateWithGap.gaps[0].id;
  });

  it("should protect unprotected gap", () => {
    // Gaps created via InsertGapCommand are manual (protected by default)
    // Let's manually set it to unprotected for testing
    stateWithGap.gaps[0].protected = false;

    const command = new ToggleGapProtectionCommand(gapId);
    const newState = command.apply(stateWithGap);

    const gap = newState.gaps.find((g) => g.id === gapId);
    expect(gap!.protected).toBe(true);
  });

  it("should unprotect protected gap", () => {
    const command = new ToggleGapProtectionCommand(gapId);
    const newState = command.apply(stateWithGap);

    const gap = newState.gaps.find((g) => g.id === gapId);
    expect(gap!.protected).toBe(false);
  });

  it("should undo protection toggle", () => {
    const command = new ToggleGapProtectionCommand(gapId);
    const toggledState = command.apply(stateWithGap);

    const undoCommand = command.invert();
    const restoredState = undoCommand.apply(toggledState);

    // Should be back to original protected state
    const gap = restoredState.gaps.find((g: any) => g.id === gapId);
    expect(gap!.protected).toBe(true); // Original was protected
  });

  it("should handle toggling non-existent gap", () => {
    const command = new ToggleGapProtectionCommand("non-existent-gap");
    const newState = command.apply(stateWithGap);

    // Should not crash, state unchanged
    const gap = newState.gaps.find((g) => g.id === gapId);
    expect(gap!.protected).toBe(true);
  });

  it("should toggle multiple times correctly", () => {
    const command = new ToggleGapProtectionCommand(gapId);

    // Toggle 1: protected -> unprotected
    let state = command.apply(stateWithGap);
    let gap = state.gaps.find((g) => g.id === gapId);
    expect(gap!.protected).toBe(false);

    // Toggle 2: unprotected -> protected
    state = command.apply(state);
    gap = state.gaps.find((g) => g.id === gapId);
    expect(gap!.protected).toBe(true);

    // Toggle 3: protected -> unprotected
    state = command.apply(state);
    gap = state.gaps.find((g) => g.id === gapId);
    expect(gap!.protected).toBe(false);
  });

  it("should serialize and deserialize correctly", () => {
    const command = new ToggleGapProtectionCommand(gapId);
    const json = command.toJSON();

    const deserialized = ToggleGapProtectionCommand.fromJSON(json);

    expect((deserialized as any).gapId).toBe((command as any).gapId);
  });
});

describe("Command Integration Tests", () => {
  it("should support complex undo/redo sequences", () => {
    const state = createTestState();

    // 1. Insert gap
    const insert = new InsertGapCommand("track1", 7, 3);
    let current = insert.apply(state);
    const gapId = current.gaps[0].id;

    // 2. Resize gap
    const resize = new ResizeGapCommand(gapId, 5);
    current = resize.apply(current);

    // 3. Protect gap
    const protect = new ToggleGapProtectionCommand(gapId);
    current = protect.apply(current);

    // Verify final state
    expect(current.gaps[0].duration).toBe(5);
    expect(current.gaps[0].protected).toBe(false); // Toggled from true

    // Undo protect
    current = protect.invert().apply(current);
    expect(current.gaps[0].protected).toBe(true);

    // Undo resize
    current = resize.invert().apply(current);
    expect(current.gaps[0].duration).toBe(3);

    // Undo insert
    current = insert.invert().apply(current);
    expect(current.gaps).toHaveLength(0);
  });

  it("should handle concurrent gap operations on different tracks", () => {
    const state = createTestState();
    state.clips.push({
      id: "clip3",
      trackId: "track2",
      startTime: 5,
      duration: 5,
      mediaId: "media3",
      trimIn: 0,
      trimOut: 5,
      transform: { x: 0, y: 0, scale: 1, rotation: 0 },
      effects: [],
      volume: 1,
      speed: 1,
      locked: false,
    } as any);

    // Insert gap on track1
    const insert1 = new InsertGapCommand("track1", 7, 3);
    let current = insert1.apply(state);

    // Insert gap on track2
    const insert2 = new InsertGapCommand("track2", 7, 2);
    current = insert2.apply(current);

    // Should have 2 gaps
    expect(current.gaps).toHaveLength(2);

    // Track1 gap should affect track1 clips only
    const clip2 = current.clips.find((c) => c.id === "clip2");
    expect(clip2!.startTime).toBe(13);

    // Track2 gap should not affect track1 clips
    const clip1 = current.clips.find((c) => c.id === "clip1");
    expect(clip1!.startTime).toBe(0);

    // Track2 gap should affect track2 clips that start at/after the gap
    const clip3 = current.clips.find((c) => c.id === "clip3");
    expect(clip3!.startTime).toBe(5); // Started at 5, gap is at 7, so clip3 not affected
  });

  it("should handle rapid insert/remove cycles", () => {
    const state = createTestState();

    // Insert
    const insert1 = new InsertGapCommand("track1", 7, 3);
    let current = insert1.apply(state);
    const gapId1 = current.gaps[0].id;

    // Remove
    const remove1 = new RemoveGapCommand(gapId1);
    current = remove1.apply(current);

    // Insert again (new command instance)
    const insert2 = new InsertGapCommand("track1", 7, 3);
    current = insert2.apply(current);
    const gapId2 = current.gaps[0].id;

    // Remove again
    const remove2 = new RemoveGapCommand(gapId2);
    current = remove2.apply(current);

    // Final state should have no gaps
    expect(current.gaps).toHaveLength(0);

    // Clips should be back to original positions
    const clip2 = current.clips.find((c) => c.id === "clip2");
    expect(clip2!.startTime).toBe(10);
  });
});

describe("Edge Cases", () => {
  it("should handle inserting gap with zero clips", () => {
    const state = { clips: [], gaps: [], epoch: 0 };
    const command = new InsertGapCommand("track1", 0, 2);

    const newState = command.apply(state);

    expect(newState.gaps).toHaveLength(1);
    expect(newState.clips).toHaveLength(0);
  });

  it("should handle removing last gap", () => {
    const state = createTestState();
    const insert = new InsertGapCommand("track1", 7, 3);
    const withGap = insert.apply(state);
    const gapId = withGap.gaps[0].id;

    const remove = new RemoveGapCommand(gapId);
    const final = remove.apply(withGap);

    expect(final.gaps).toHaveLength(0);
  });

  it("should handle resizing gap to very small duration", () => {
    const state = createTestState();
    const insert = new InsertGapCommand("track1", 7, 3);
    const withGap = insert.apply(state);
    const gapId = withGap.gaps[0].id;

    const resize = new ResizeGapCommand(gapId, 0.001);
    const resized = resize.apply(withGap);

    const gap = resized.gaps.find((g) => g.id === gapId);
    expect(gap!.duration).toBe(0.001);
  });

  it("should handle resizing gap to very large duration", () => {
    const state = createTestState();
    const insert = new InsertGapCommand("track1", 7, 3);
    const withGap = insert.apply(state);
    const gapId = withGap.gaps[0].id;

    const resize = new ResizeGapCommand(gapId, 3600); // 1 hour
    const resized = resize.apply(withGap);

    const gap = resized.gaps.find((g) => g.id === gapId);
    expect(gap!.duration).toBe(3600);

    // Clip2 should be shifted way out
    const clip2 = resized.clips.find((c) => c.id === "clip2");
    expect(clip2!.startTime).toBeGreaterThan(3600);
  });

  it("should preserve clip properties during gap operations", () => {
    const state = createTestState();
    state.clips[0].volume = 0.5;
    (state.clips[0] as any).speed = 1.5;
    (state.clips[0] as any).transform.scale = 2;

    const command = new InsertGapCommand("track1", 0, 2);
    const newState = command.apply(state);

    const clip1 = newState.clips.find((c) => c.id === "clip1");
    expect(clip1!.volume).toBe(0.5);
    expect((clip1 as any).speed).toBe(1.5);
    expect((clip1 as any).transform.scale).toBe(2);
  });
});

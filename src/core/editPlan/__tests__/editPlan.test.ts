import { describe, it, expect, beforeEach } from "vitest";
import { CommandJournal } from "@/core/history/CommandJournal";
import { SplitClipCommand } from "@/core/history/commands/SplitClipCommand";
import type { Clip, Track } from "@/types";
import type { TimelineState } from "../compile";
import { validateEditPlan } from "../validate";
import { compileEditPlan, applyEditPlan } from "../compile";
import type { EditPlan } from "../types";

function makeTrack(id = "v1", type: Track["type"] = "video"): Track {
  return {
    id,
    name: id,
    type,
    order: 0,
    muted: false,
    solo: false,
    locked: false,
    visible: true,
    volume: 1,
    height: 60,
  } as Track;
}

function makeClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: "clip-1",
    trackId: "v1",
    type: "video",
    name: "Clip 1",
    startTime: 0,
    duration: 10, // 10 seconds
    trimIn: 0,
    trimOut: 10,
    sourceDuration: 10,
    ...overrides,
  } as Clip;
}

function makeState(clips: Clip[] = [makeClip()], tracks: Track[] = [makeTrack()]): TimelineState {
  return {
    tracks,
    clips,
    transitions: [],
    gaps: [],
    selectedClipIds: [],
    epoch: 1,
    frameRate: 30,
  } as unknown as TimelineState;
}

describe("EditPlan core (Phase 1)", () => {
  let journal: CommandJournal;

  beforeEach(() => {
    journal = new CommandJournal();
  });

  it("reports a no-op command as a plan error instead of succeeding silently", () => {
    const state = makeState([makeClip({ id: "clip-1", startTime: 0, duration: 5 })]);
    const plan: EditPlan = {
      schemaVersion: 1,
      planId: "plan-noop",
      baseEpoch: state.epoch,
      intent: "Split outside clip bounds",
      ops: [
        // 10_000 ms is outside [0, 5000 ms], so SplitClipCommand returns state unchanged
        { op: "split", target: { clipId: "clip-1" }, atMs: 10_000 },
      ],
    };

    const compiled = compileEditPlan(plan, state);
    expect(compiled.ok).toBe(false);
    if (!compiled.ok) {
      expect(compiled.error.code).toBe("NO_OP_EFFECT");
      expect(compiled.error.opIndex).toBe(0);
    }
  });

  it("applies a multi-op plan as a single undo step", () => {
    let state = makeState([makeClip({ id: "clip-1", startTime: 0, duration: 10 })]);
    const plan: EditPlan = {
      schemaVersion: 1,
      planId: "plan-single-undo",
      baseEpoch: state.epoch,
      intent: "Split clip and add text",
      ops: [
        { op: "split", target: { clipId: "clip-1" }, atMs: 4000, as: ["left", "right"] },
        { op: "addText", track: "v1", atMs: 1000, durationMs: 2000, text: "Hello" },
      ],
    };

    const result = applyEditPlan(plan, () => state, (next) => {
      state = next;
    }, journal);

    expect(result.ok).toBe(true);
    // 2 split halves + 1 text clip = 3 clips
    expect(state.clips.length).toBe(3);

    // One undo reverts the entire plan
    expect(journal.canUndo()).toBe(true);
    state = journal.undo(state)!;
    expect(state.clips.length).toBe(1);
    expect(state.clips[0].id).toBe("clip-1");
    expect(journal.canUndo()).toBe(false);
  });

  it("resolves symbolic refs from an earlier split in subsequent ops", () => {
    let state = makeState([makeClip({ id: "clip-1", startTime: 0, duration: 10 })]);
    const plan: EditPlan = {
      schemaVersion: 1,
      planId: "plan-ref",
      baseEpoch: state.epoch,
      intent: "Split then trim right half",
      ops: [
        { op: "split", target: { clipId: "clip-1" }, atMs: 4000, as: ["left", "right"] },
        { op: "trim", target: { ref: "right" }, startMs: 5000 },
      ],
    };

    const result = applyEditPlan(plan, () => state, (next) => {
      state = next;
    }, journal);

    expect(result.ok).toBe(true);
    expect(state.clips.length).toBe(2);
    const right = state.clips.find((c) => c.id !== state.clips[0].id) ?? state.clips[1];
    expect(right.duration).toBeCloseTo(5, 2);
  });

  it("rejects a stale plan when live epoch differs from baseEpoch", () => {
    let state = makeState([makeClip({ id: "clip-1", startTime: 0, duration: 10 })]);
    const plan: EditPlan = {
      schemaVersion: 1,
      planId: "plan-stale",
      baseEpoch: 1,
      intent: "Split clip",
      ops: [{ op: "split", target: { clipId: "clip-1" }, atMs: 4000 }],
    };

    // Simulate live state advancing
    state = { ...state, epoch: 2 };

    const result = applyEditPlan(plan, () => state, (next) => {
      state = next;
    }, journal);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("STALE_EPOCH");
    }
    expect(state.clips.length).toBe(1);
  });

  it("rejects an over-cap plan during schema validation", () => {
    const ops = Array.from({ length: 201 }, () => ({
      op: "addText" as const,
      track: "v1",
      atMs: 0,
      durationMs: 1000,
      text: "x",
    }));
    const plan: EditPlan = {
      schemaVersion: 1,
      planId: "plan-over-cap",
      baseEpoch: 1,
      intent: "Too many ops",
      ops,
    };

    const validation = validateEditPlan(plan);
    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.error.code).toBe("OP_CAP_EXCEEDED");
    }
  });

  it("rolls back the transaction if a mid-plan op fails during apply", () => {
    let state = makeState([makeClip({ id: "clip-1", startTime: 0, duration: 10 })]);
    const plan: EditPlan = {
      schemaVersion: 1,
      planId: "plan-rollback",
      baseEpoch: state.epoch,
      intent: "Split then fail on missing clip",
      ops: [
        { op: "split", target: { clipId: "clip-1" }, atMs: 4000 },
        { op: "trim", target: { clipId: "does-not-exist" }, startMs: 1000 },
      ],
    };

    const result = applyEditPlan(plan, () => state, (next) => {
      state = next;
    }, journal);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.opIndex).toBe(1);
    }
    // State is completely unchanged
    expect(state.clips.length).toBe(1);
    expect(state.clips[0].id).toBe("clip-1");
    expect(journal.canUndo()).toBe(false);
  });

  it("refuses to apply a plan while a live property edit is in progress", () => {
    let state = makeState([makeClip({ id: "clip-1", startTime: 0, duration: 10 })]);
    const plan: EditPlan = {
      schemaVersion: 1,
      planId: "plan-live-edit",
      baseEpoch: state.epoch,
      intent: "Split while dragging",
      ops: [{ op: "split", target: { clipId: "clip-1" }, atMs: 4000 }],
    };

    const result = applyEditPlan(
      plan,
      () => state,
      (next) => {
        state = next;
      },
      journal,
      { isLiveEditActive: () => true },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("LIVE_EDIT_IN_PROGRESS");
    }
    expect(state.clips.length).toBe(1);
    expect(journal.canUndo()).toBe(false);
  });
});

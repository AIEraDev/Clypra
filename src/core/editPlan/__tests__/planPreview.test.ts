import { describe, it, expect } from "vitest";
import { CommandJournal } from "@/core/history/CommandJournal";
import type { Clip, Track } from "@/types";
import { applyEditPlan, type TimelineState } from "../compile";
import { buildPlanPreview, togglePlanOp, getPreviewMarkerRanges } from "../preview";
import type { EditPlan } from "../types";

function makeTrack(id = "v1"): Track {
  return {
    id,
    name: id,
    type: "video",
    order: 0,
    muted: false,
    solo: false,
    locked: false,
    visible: true,
    volume: 1,
    height: 60,
  } as Track;
}

function makeClip(id = "clip-1", startTime = 0, duration = 10): Clip {
  return {
    id,
    mediaId: "m1",
    trackId: "v1",
    name: id,
    startTime,
    duration,
    trimIn: 0,
    trimOut: duration,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    rotation: 0,
    opacity: 1,
  } as Clip;
}

describe("PlanPreview (Phase 3)", () => {
  it("computes diff totals that match the applied result", () => {
    let state: TimelineState = {
      tracks: [makeTrack("v1")],
      clips: [makeClip("clip-1", 0, 10)],
      transitions: [],
      gaps: [],
      selectedClipIds: [],
      epoch: 1,
      frameRate: 30,
    };

    const plan: EditPlan = {
      schemaVersion: 1,
      planId: "preview-diff-1",
      baseEpoch: state.epoch,
      intent: "Remove two silences",
      ops: [
        { op: "deleteRange", track: "v1", startMs: 7000, endMs: 9000, ripple: true },
        { op: "deleteRange", track: "v1", startMs: 2000, endMs: 3000, ripple: true },
      ],
    };

    const preview = buildPlanPreview(plan, state);
    expect(preview.isValid).toBe(true);
    expect(preview.totals.cutCount).toBe(2);
    expect(preview.totals.durationBeforeMs).toBe(10000);
    expect(preview.totals.durationAfterMs).toBe(7000);
    expect(preview.totals.durationDeltaMs).toBe(-3000);
    expect(getPreviewMarkerRanges(preview)).toHaveLength(2);

    const journal = new CommandJournal();
    const applied = applyEditPlan(preview.filteredPlan, () => state, (next) => {
      state = next;
    }, journal);
    expect(applied.ok).toBe(true);

    const actualDurationMs = Math.round(
      Math.max(...state.clips.map((c) => c.startTime + c.duration)) * 1000,
    );
    expect(actualDurationMs).toBe(preview.totals.durationAfterMs);
  });

  it("toggles an independent op off, recompiles, and updates totals", () => {
    const state: TimelineState = {
      tracks: [makeTrack("v1")],
      clips: [makeClip("clip-1", 0, 10)],
      transitions: [],
      gaps: [],
      selectedClipIds: [],
      epoch: 1,
      frameRate: 30,
    };

    const plan: EditPlan = {
      schemaVersion: 1,
      planId: "preview-toggle-1",
      baseEpoch: state.epoch,
      intent: "Remove two silences",
      ops: [
        { op: "deleteRange", track: "v1", startMs: 7000, endMs: 9000, ripple: true },
        { op: "deleteRange", track: "v1", startMs: 2000, endMs: 3000, ripple: true },
      ],
    };

    const toggled = togglePlanOp(plan, state, new Set(), 0);
    expect(toggled.preview.isValid).toBe(true);
    expect(toggled.preview.rows[0].enabled).toBe(false);
    expect(toggled.preview.rows[1].enabled).toBe(true);
    expect(toggled.preview.totals.cutCount).toBe(1);
    expect(toggled.preview.totals.durationAfterMs).toBe(9000);
  });

  it("toggles ref-dependent ops together as a group", () => {
    const state: TimelineState = {
      tracks: [makeTrack("v1")],
      clips: [makeClip("clip-1", 0, 10)],
      transitions: [],
      gaps: [],
      selectedClipIds: [],
      epoch: 1,
      frameRate: 30,
    };

    const plan: EditPlan = {
      schemaVersion: 1,
      planId: "preview-ref-group",
      baseEpoch: state.epoch,
      intent: "Split and trim ref",
      ops: [
        { op: "split", target: { clipId: "clip-1" }, atMs: 4000, as: ["left", "right"] },
        { op: "trim", target: { ref: "right" }, startMs: 5000 },
      ],
    };

    const toggled = togglePlanOp(plan, state, new Set(), 0);
    expect(toggled.preview.rows[0].enabled).toBe(false);
    expect(toggled.preview.rows[1].enabled).toBe(false);
    expect(toggled.preview.totals.enabledOpCount).toBe(0);
  });
});

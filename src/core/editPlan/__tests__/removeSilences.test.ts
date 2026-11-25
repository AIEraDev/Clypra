import { describe, it, expect, beforeEach } from "vitest";
import { CommandJournal } from "@/core/history/CommandJournal";
import type { Clip, Track } from "@/types";
import type { TimelineState } from "../compile";
import { applyEditPlan, compileEditPlan } from "../compile";
import { buildRemoveSilencesPlan, REMOVE_SILENCES_MAX_OPS } from "../removeSilences";

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
    mediaId: "m1",
    trackId: "v1",
    name: "clip-1",
    startTime: 0,
    duration: 10,
    trimIn: 0,
    trimOut: 10,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    rotation: 0,
    opacity: 1,
    ...overrides,
  } as Clip;
}

describe("buildRemoveSilencesPlan (Phase 2)", () => {
  let journal: CommandJournal;

  beforeEach(() => {
    journal = new CommandJournal();
  });

  it("maps source-time silences to timeline time for a trimmed, offset, 2x-speed clip and drops out-of-bounds ranges", () => {
    // Source media: trimIn = 4s, speed = 2x, timeline startTime = 10s, duration = 6s (covers source 4s..16s -> timeline 10s..16s)
    const clip = makeClip({
      id: "v-clip",
      trackId: "v1",
      startTime: 10,
      duration: 6,
      trimIn: 4,
      trimOut: 16,
      speed: 2,
    });
    let state: TimelineState = {
      tracks: [makeTrack("v1", "video")],
      clips: [clip],
      transitions: [],
      gaps: [],
      selectedClipIds: [],
      epoch: 1,
      frameRate: 30,
    };

    const plan = buildRemoveSilencesPlan({
      planId: "silence-mapped",
      baseEpoch: state.epoch,
      clip,
      jumpCutPlan: {
        silence_ranges: [
          { start_time: 1.0, end_time: 2.0 },   // before trimIn (dropped)
          { start_time: 6.0, end_time: 8.0 },   // timeline: 10 + (6-4)/2 = 11s .. 10 + (8-4)/2 = 12s
          { start_time: 14.0, end_time: 18.0 }, // timeline: 10 + (14-4)/2 = 15s .. clamped to 16s
        ],
      },
    });

    // Reverse order: 15s-16s first, then 11s-12s
    expect(plan.ops).toEqual([
      { op: "deleteRange", track: "v1", startMs: 15000, endMs: 16000, ripple: true },
      { op: "deleteRange", track: "v1", startMs: 11000, endMs: 12000, ripple: true },
    ]);

    const res = applyEditPlan(plan, () => state, (next) => {
      state = next;
    }, journal);
    expect(res.ok).toBe(true);
    // Original 6s clip minus 1s at [15,16] and 1s at [11,12] = 4s total remaining across 2 segments
    const totalRemaining = state.clips.reduce((sum, c) => sum + c.duration, 0);
    expect(totalRemaining).toBeCloseTo(4, 2);

    // Single undo restores the original clip
    state = journal.undo(state)!;
    expect(state.clips).toHaveLength(1);
    expect(state.clips[0].duration).toBeCloseTo(6, 2);
  });

  it("returns an empty plan (not an error) when no silences are found", () => {
    const clip = makeClip();
    let state: TimelineState = {
      tracks: [makeTrack("v1")],
      clips: [clip],
      transitions: [],
      gaps: [],
      selectedClipIds: [],
      epoch: 1,
      frameRate: 30,
    };

    const plan = buildRemoveSilencesPlan({
      planId: "no-silences",
      baseEpoch: state.epoch,
      clip,
      jumpCutPlan: { silence_ranges: [] },
    });

    expect(plan.ops).toEqual([]);
    const res = applyEditPlan(plan, () => state, (next) => {
      state = next;
    }, journal);
    expect(res.ok).toBe(true);
    expect(journal.canUndo()).toBe(false);
  });

  it("merges adjacent and overlapping silence ranges", () => {
    const clip = makeClip({ duration: 10 });
    const plan = buildRemoveSilencesPlan({
      planId: "merge-ranges",
      baseEpoch: 1,
      clip,
      jumpCutPlan: {
        silence_ranges: [
          { start_time: 1.0, end_time: 2.0 },
          { start_time: 2.0, end_time: 3.0 }, // adjacent
          { start_time: 2.5, end_time: 4.0 }, // overlapping
        ],
      },
    });

    expect(plan.ops).toEqual([
      { op: "deleteRange", track: "v1", startMs: 1000, endMs: 4000, ripple: true },
    ]);
  });

  it("applies paddingSec and minSilenceDurationSec filters", () => {
    const clip = makeClip({ duration: 10 });
    const plan = buildRemoveSilencesPlan({
      planId: "padding-min",
      baseEpoch: 1,
      clip,
      paddingSec: 0.1,
      minSilenceDurationSec: 0.5,
      jumpCutPlan: {
        silence_ranges: [
          { start_time: 1.0, end_time: 1.6 }, // after 0.1s padding each side -> 0.4s < 0.5s (dropped)
          { start_time: 4.0, end_time: 5.0 }, // after 0.1s padding each side -> [4.1, 4.9] = 0.8s (kept)
        ],
      },
    });

    expect(plan.ops).toEqual([
      { op: "deleteRange", track: "v1", startMs: 4100, endMs: 4900, ripple: true },
    ]);
  });

  it("fails clearly when merged silences exceed REMOVE_SILENCES_MAX_OPS instead of truncating", () => {
    const clip = makeClip({ duration: 5000 });
    const silence_ranges = Array.from({ length: REMOVE_SILENCES_MAX_OPS + 1 }, (_, i) => ({
      start_time: i * 3,
      end_time: i * 3 + 1,
    }));

    expect(() =>
      buildRemoveSilencesPlan({
        planId: "over-cap",
        baseEpoch: 1,
        clip,
        jumpCutPlan: { silence_ranges },
      }),
    ).toThrow(/REMOVE_SILENCES_MAX_OPS/);
  });

  it("validates and dry-run compiles 1,000 silence deleteRange ops within budget", () => {
    const clip = makeClip({ duration: 4000 });
    const state: TimelineState = {
      tracks: [makeTrack("v1")],
      clips: [clip],
      transitions: [],
      gaps: [],
      selectedClipIds: [],
      epoch: 1,
      frameRate: 30,
    };
    const silence_ranges = Array.from({ length: 1000 }, (_, i) => ({
      start_time: i * 3 + 1,
      end_time: i * 3 + 2,
    }));

    const t0 = performance.now();
    const plan = buildRemoveSilencesPlan({
      planId: "bench-1000",
      baseEpoch: state.epoch,
      clip,
      jumpCutPlan: { silence_ranges },
    });
    const compiled = compileEditPlan(plan, state, { maxOps: REMOVE_SILENCES_MAX_OPS });
    const elapsedMs = performance.now() - t0;

    expect(compiled.ok).toBe(true);
    expect(plan.ops).toHaveLength(1000);
    expect(elapsedMs).toBeLessThan(5000);
  });

  it("keeps linked video and audio clips in sync during ripple deleteRange", () => {
    const videoClip = { ...makeClip({ id: "v-1", trackId: "v1", startTime: 0, duration: 10 }), linkedClipId: "a-1" } as Clip;
    const audioClip = { ...makeClip({ id: "a-1", trackId: "a1", startTime: 0, duration: 10 }), linkedClipId: "v-1" } as Clip;
    let state: TimelineState = {
      tracks: [makeTrack("v1", "video"), makeTrack("a1", "audio")],
      clips: [videoClip, audioClip],
      transitions: [],
      gaps: [],
      selectedClipIds: [],
      epoch: 1,
      frameRate: 30,
    };

    const plan = buildRemoveSilencesPlan({
      planId: "linked-sync",
      baseEpoch: state.epoch,
      clip: videoClip,
      jumpCutPlan: {
        silence_ranges: [{ start_time: 2.0, end_time: 4.0 }],
      },
    });

    const res = applyEditPlan(plan, () => state, (next) => {
      state = next;
    }, journal);
    expect(res.ok).toBe(true);

    const vClips = state.clips.filter((c) => c.trackId === "v1").sort((a, b) => a.startTime - b.startTime);
    const aClips = state.clips.filter((c) => c.trackId === "a1").sort((a, b) => a.startTime - b.startTime);
    expect(vClips).toHaveLength(2);
    expect(aClips).toHaveLength(2);
    expect(vClips[0].startTime).toBeCloseTo(0, 3);
    expect(vClips[0].duration).toBeCloseTo(2, 3);
    expect(vClips[1].startTime).toBeCloseTo(2, 3);
    expect(vClips[1].duration).toBeCloseTo(6, 3);
    expect(aClips[0].startTime).toBeCloseTo(0, 3);
    expect(aClips[0].duration).toBeCloseTo(2, 3);
    expect(aClips[1].startTime).toBeCloseTo(2, 3);
    expect(aClips[1].duration).toBeCloseTo(6, 3);
  });
});

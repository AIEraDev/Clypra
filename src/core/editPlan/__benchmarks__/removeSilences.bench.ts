import { bench, describe } from "vitest";
import type { Clip, Track } from "@/types";
import type { TimelineState } from "../compile";
import { compileEditPlan } from "../compile";
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
    duration: 4000,
    trimIn: 0,
    trimOut: 4000,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    rotation: 0,
    opacity: 1,
    ...overrides,
  } as Clip;
}

const clip = makeClip();
const state: TimelineState = {
  tracks: [makeTrack("v1")],
  clips: [clip],
  transitions: [],
  gaps: [],
  selectedClipIds: [],
  epoch: 1,
  frameRate: 30,
};
const silenceRanges = Array.from({ length: 1000 }, (_, i) => ({
  start_time: i * 3 + 1,
  end_time: i * 3 + 2,
}));

describe("removeSilences performance", () => {
  bench("builds and dry-run compiles 1,000 deleteRange operations", () => {
    const plan = buildRemoveSilencesPlan({
      planId: "bench-1000",
      baseEpoch: state.epoch,
      clip,
      jumpCutPlan: { silence_ranges: silenceRanges },
    });
    const compiled = compileEditPlan(plan, state, { maxOps: REMOVE_SILENCES_MAX_OPS });

    if (!compiled.ok || plan.ops.length !== 1000) {
      throw new Error("removeSilences benchmark fixture no longer compiles to 1,000 operations");
    }
  });
});

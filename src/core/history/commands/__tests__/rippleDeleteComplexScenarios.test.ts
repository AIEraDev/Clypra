import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { RippleDeleteCommand } from "../RippleDeleteCommand";
import { RippleDeleteRangeCommand } from "../RippleDeleteRangeCommand";
import type { Clip, Track } from "@/types";

describe("Ripple Delete Complex Scenarios & Invert Symmetry", () => {
  const createMockState = () => {
    const tracks: Track[] = [
      { id: "v1", name: "Video 1", type: "video", muted: false, locked: false, visible: true, height: 68 },
      { id: "a1", name: "Audio 1", type: "audio", muted: false, locked: false, visible: true, height: 52 },
    ];
    const clips: Clip[] = [
      { id: "c1", trackId: "v1", name: "Clip 1", type: "video", startTime: 0, duration: 5, sourceStartTime: 0 },
      { id: "c2", trackId: "v1", name: "Clip 2", type: "video", startTime: 5, duration: 10, sourceStartTime: 0 },
      { id: "c3", trackId: "v1", name: "Clip 3", type: "video", startTime: 15, duration: 5, sourceStartTime: 0 },
      { id: "a_c1", trackId: "a1", name: "Audio Clip 1", type: "audio", startTime: 0, duration: 20, sourceStartTime: 0 },
    ];
    return { tracks, clips, epoch: 1 };
  };

  it("shifts subsequent clips on the same track leftward while leaving other tracks untouched", () => {
    const state = createMockState();
    const command = new RippleDeleteCommand("c2");
    const nextState = command.apply(state);

    // c2 should be removed
    expect(nextState.clips.find((c) => c.id === "c2")).toBeUndefined();

    // c1 (before deleted clip) should stay at startTime 0
    const c1 = nextState.clips.find((c) => c.id === "c1");
    expect(c1?.startTime).toBe(0);

    // c3 (after deleted clip, duration 10) should shift left from 15 to 5
    const c3 = nextState.clips.find((c) => c.id === "c3");
    expect(c3?.startTime).toBe(5);

    // Audio clip on a1 should remain unchanged at startTime 0
    const a_c1 = nextState.clips.find((c) => c.id === "a_c1");
    expect(a_c1?.startTime).toBe(0);

    // Epoch should increment
    expect(nextState.epoch).toBe(state.epoch + 1);
  });

  it("restores exact initial state upon applying invert command (Undo)", () => {
    const state = createMockState();
    const command = new RippleDeleteCommand("c2");
    const nextState = command.apply(state);

    const invertedCommand = command.invert();
    const restoredState = invertedCommand.apply(nextState);

    expect(restoredState.clips.length).toBe(state.clips.length);
    expect(restoredState.clips.find((c) => c.id === "c2")).toBeDefined();
    expect(restoredState.clips.find((c) => c.id === "c3")?.startTime).toBe(15);
  });

  it("handles non-existent clip deletion safely without crashing", () => {
    const state = createMockState();
    const command = new RippleDeleteCommand("non-existent-id");
    const nextState = command.apply(state);

    expect(nextState).toBe(state);
  });

  it("property tests ripple delete range shift consistency", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 10, noNaN: true }),
        fc.double({ min: 1, max: 5, noNaN: true }),
        (gapStart, gapDuration) => {
          const trackId = "v1";
          const track: Track = { id: trackId, name: "Video 1", type: "video", muted: false, locked: false, visible: true, height: 68 };
          const c1: Clip = { id: "c1", trackId, name: "C1", type: "video", startTime: 0, duration: gapStart, sourceStartTime: 0 };
          const deletedClip: Clip = { id: "c_del", trackId, name: "Del", type: "video", startTime: gapStart, duration: gapDuration, sourceStartTime: 0 };
          const c2: Clip = { id: "c2", trackId, name: "C2", type: "video", startTime: gapStart + gapDuration, duration: 5, sourceStartTime: 0 };

          const state = { tracks: [track], clips: [c1, deletedClip, c2], gaps: [], epoch: 0 };
          const command = new RippleDeleteRangeCommand(["c_del"]);
          const nextState = command.apply(state);

          const c2After = nextState.clips.find((c) => c.id === "c2");
          expect(c2After?.startTime).toBeCloseTo(gapStart, 5);
        }
      )
    );
  });
});

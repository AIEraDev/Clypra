import { describe, expect, it } from "vitest";
import { SplitClipCommand } from "../SplitClipCommand";
import { DeleteClipCommand } from "../DeleteClipCommand";
import { computeClipVersion } from "../../../evaluation/cache";
import type { Clip, TransitionTimelineItem } from "@/types";

const makeClip = (id: string, startTime: number, duration: number): Clip => ({
  id,
  kind: "video",
  trackId: "t1",
  mediaId: "m1",
  startTime,
  duration,
  trimIn: 0,
  trimOut: duration,
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  opacity: 1,
  rotation: 0,
});

describe("SplitClipCommand transition re-linking", () => {
  it("re-links incoming and outgoing transitions when clip is split", () => {
    const originalClip = makeClip("c1", 0, 10);
    const transitionIn: TransitionTimelineItem = {
      id: "tr-in",
      kind: "transition",
      type: "dissolve",
      fromItemId: "c0",
      toItemId: "c1",
      alignment: "center",
      easing: "linear",
      placement: { trackId: "t1", startTime: -0.5, duration: 1, role: "effect", zIndex: 1 },
      effects: { effects: [], version: 0 },
    };
    const transitionOut: TransitionTimelineItem = {
      id: "tr-out",
      kind: "transition",
      type: "dissolve",
      fromItemId: "c1",
      toItemId: "c2",
      alignment: "center",
      easing: "linear",
      placement: { trackId: "t1", startTime: 9.5, duration: 1, role: "effect", zIndex: 1 },
      effects: { effects: [], version: 0 },
    };

    const state = {
      clips: [originalClip],
      transitions: [transitionIn, transitionOut],
      epoch: 1,
    };

    const command = new SplitClipCommand("c1", 5.0, 30, originalClip);
    const newState = command.apply(state);

    const leftId = command.getLeftClipId();
    const rightId = command.getRightClipId();

    expect(leftId).toBeDefined();
    expect(rightId).toBeDefined();

    // transitionIn (entering originalClip) should now target leftClip
    const updatedIn = newState.transitions?.find((t) => t.id === "tr-in");
    expect(updatedIn?.toItemId).toBe(leftId);

    // transitionOut (exiting originalClip) should now originate from rightClip
    const updatedOut = newState.transitions?.find((t) => t.id === "tr-out");
    expect(updatedOut?.fromItemId).toBe(rightId);
  });
});

describe("DeleteClipCommand transition cleanup and restoration", () => {
  it("removes transitions referencing deleted clip and restores them on undo", () => {
    const clip = makeClip("c1", 0, 5);
    const transition: TransitionTimelineItem = {
      id: "tr1",
      kind: "transition",
      type: "dissolve",
      fromItemId: "c1",
      toItemId: "c2",
      alignment: "center",
      easing: "linear",
      placement: { trackId: "t1", startTime: 4.5, duration: 1, role: "effect", zIndex: 1 },
      effects: { effects: [], version: 0 },
    };

    const state = {
      clips: [clip],
      transitions: [transition],
      epoch: 1,
    };

    const command = new DeleteClipCommand("c1");
    const newState = command.apply(state);

    expect(newState.clips).toHaveLength(0);
    expect(newState.transitions).toHaveLength(0);

    const undoCommand = command.invert();
    const restoredState = undoCommand.apply(newState);

    expect(restoredState.clips).toHaveLength(1);
    expect(restoredState.transitions).toHaveLength(1);
    expect(restoredState.transitions![0].id).toBe("tr1");
  });
});

describe("computeClipVersion with transition parameters", () => {
  it("invalidates cache signature when transition metadata/params or renderer change", () => {
    const clip = makeClip("c1", 0, 5);
    const transitionV1: TransitionTimelineItem = {
      id: "tr1",
      kind: "transition",
      type: "dissolve",
      fromItemId: "c1",
      toItemId: "c2",
      alignment: "center",
      easing: "linear",
      placement: { trackId: "t1", startTime: 4.5, duration: 1, role: "effect", zIndex: 1 },
      metadata: { params: { smoothness: 0.5 } },
      effects: { effects: [], version: 0 },
    };

    const transitionV2: TransitionTimelineItem = {
      ...transitionV1,
      metadata: { params: { smoothness: 0.9 } },
    };

    const hash1 = computeClipVersion([clip], [transitionV1]);
    const hash2 = computeClipVersion([clip], [transitionV2]);

    expect(hash1).not.toBe(hash2);
  });
});

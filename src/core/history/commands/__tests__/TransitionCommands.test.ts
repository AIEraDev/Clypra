import { describe, it, expect, beforeEach } from "vitest";
import { CommandJournal } from "../../CommandJournal";
import {
  AddTransitionCommand,
  DeleteTransitionCommand,
  UpdateTransitionCommand,
} from "../TransitionCommands";
import type { TransitionTimelineItem } from "@/types";

describe("Transition Commands — Full-Snapshot Undo/Redo", () => {
  let journal: CommandJournal;
  let sampleTransition: TransitionTimelineItem;
  let initialState: {
    transitions: TransitionTimelineItem[];
    epoch: number;
  };

  beforeEach(() => {
    journal = new CommandJournal({
      maxSize: 50,
      enableCoalescing: false,
      coalescingWindowMs: 0,
    });

    sampleTransition = {
      id: "tr-1",
      kind: "transition",
      type: "dissolve",
      renderer: "cross-dissolve",
      fromItemId: "clip-a",
      toItemId: "clip-b",
      alignment: "center",
      easing: "ease-in-out",
      placement: {
        trackId: "track-video-1",
        startTime: 2.5,
        duration: 1.0,
        role: "effect",
        zIndex: 0,
      },
      effects: { effects: [], version: 1 },
    };

    initialState = {
      transitions: [],
      epoch: 0,
    };
  });

  it("AddTransitionCommand adds transition and undoes cleanly", () => {
    const cmd = new AddTransitionCommand(sampleTransition);
    const applied = journal.execute(cmd, initialState);

    expect(applied.transitions).toHaveLength(1);
    expect(applied.transitions[0].id).toBe("tr-1");
    expect(applied.epoch).toBe(1);

    const undone = journal.undo(applied);
    expect(undone.transitions).toHaveLength(0);
    expect(undone.epoch).toBe(2);

    const redone = journal.redo(undone);
    expect(redone.transitions).toHaveLength(1);
    expect(redone.transitions[0].id).toBe("tr-1");
    expect(redone.epoch).toBe(3);
  });

  it("DeleteTransitionCommand removes transition and restores it on undo", () => {
    const stateWithTransition = {
      transitions: [sampleTransition],
      epoch: 1,
    };

    const cmd = new DeleteTransitionCommand("tr-1", sampleTransition);
    const applied = journal.execute(cmd, stateWithTransition);

    expect(applied.transitions).toHaveLength(0);
    expect(applied.epoch).toBe(2);

    const undone = journal.undo(applied);
    expect(undone.transitions).toHaveLength(1);
    expect(undone.transitions[0].id).toBe("tr-1");
    expect(undone.epoch).toBe(3);
  });

  it("UpdateTransitionCommand updates transition properties and reverts on undo", () => {
    const stateWithTransition = {
      transitions: [sampleTransition],
      epoch: 1,
    };

    const updatedTransition: TransitionTimelineItem = {
      ...sampleTransition,
      placement: {
        ...sampleTransition.placement,
        duration: 2.0,
      },
      renderer: "wipe-left",
    };

    const cmd = new UpdateTransitionCommand(sampleTransition, updatedTransition);
    const applied = journal.execute(cmd, stateWithTransition);

    expect(applied.transitions[0].placement.duration).toBe(2.0);
    expect(applied.transitions[0].renderer).toBe("wipe-left");
    expect(applied.epoch).toBe(2);

    const undone = journal.undo(applied);
    expect(undone.transitions[0].placement.duration).toBe(1.0);
    expect(undone.transitions[0].renderer).toBe("cross-dissolve");
    expect(undone.epoch).toBe(3);
  });
});

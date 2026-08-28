import { describe, it, expect, beforeEach } from "vitest";
import { CommandJournal } from "../../CommandJournal";
import {
  AddCaptionTrackCommand,
  RemoveCaptionTrackCommand,
  UpdateCaptionTrackCommand,
  AddCaptionCueCommand,
  RemoveCaptionCueCommand,
  UpdateCaptionCueCommand,
  BatchUpdateCaptionCuesCommand,
} from "../CaptionCommands";
import {
  type CaptionTrack,
  type CaptionCue,
  CAPTION_MODEL_VERSION,
  DEFAULT_CAPTION_STYLE,
} from "@/types/captions";

describe("Caption Commands — Full-Snapshot History & Undo/Redo", () => {
  let journal: CommandJournal;
  let initialTrack: CaptionTrack;
  let initialState: {
    captionTracks: CaptionTrack[];
    activeCaptionTrackId: string | null;
    epoch: number;
  };

  beforeEach(() => {
    journal = new CommandJournal({
      maxSize: 50,
      enableCoalescing: false,
      coalescingWindowMs: 0,
    });

    initialTrack = {
      id: "track-1",
      captionModelVersion: CAPTION_MODEL_VERSION,
      name: "Main Subtitles",
      visible: true,
      locked: false,
      defaultStyle: { ...DEFAULT_CAPTION_STYLE },
      cues: [
        {
          id: "cue-1",
          startTicks: 0,
          endTicks: 2_000_000,
          text: "First cue",
          styleVersion: 1,
        },
        {
          id: "cue-2",
          startTicks: 2_000_000,
          endTicks: 4_000_000,
          text: "Second cue",
          styleVersion: 1,
        },
      ],
    };

    initialState = {
      captionTracks: [initialTrack],
      activeCaptionTrackId: "track-1",
      epoch: 0,
    };
  });

  it("AddCaptionTrackCommand adds track and undoes cleanly with full snapshots", () => {
    const newTrack: CaptionTrack = {
      id: "track-2",
      captionModelVersion: CAPTION_MODEL_VERSION,
      name: "Spanish Subtitles",
      visible: true,
      locked: false,
      defaultStyle: { ...DEFAULT_CAPTION_STYLE },
      cues: [],
    };

    const cmd = new AddCaptionTrackCommand(newTrack, initialState.captionTracks);
    const appliedState = journal.execute(cmd, initialState);

    expect(appliedState.captionTracks).toHaveLength(2);
    expect(appliedState.captionTracks[1].id).toBe("track-2");
    expect(appliedState.activeCaptionTrackId).toBe("track-2");
    expect(appliedState.epoch).toBe(1);

    // Undo
    const undoneState = journal.undo(appliedState);
    expect(undoneState.captionTracks).toHaveLength(1);
    expect(undoneState.captionTracks[0].id).toBe("track-1");
    expect(undoneState.activeCaptionTrackId).toBe("track-1");
    expect(undoneState.epoch).toBe(2);

    // Redo
    const redoneState = journal.redo(undoneState);
    expect(redoneState.captionTracks).toHaveLength(2);
    expect(redoneState.captionTracks[1].id).toBe("track-2");
    expect(redoneState.epoch).toBe(3);
  });

  it("RemoveCaptionTrackCommand removes track and restores it completely on undo", () => {
    const cmd = new RemoveCaptionTrackCommand("track-1", initialState.captionTracks);
    const appliedState = journal.execute(cmd, initialState);

    expect(appliedState.captionTracks).toHaveLength(0);
    expect(appliedState.activeCaptionTrackId).toBeNull();
    expect(appliedState.epoch).toBe(1);

    // Undo
    const undoneState = journal.undo(appliedState);
    expect(undoneState.captionTracks).toHaveLength(1);
    expect(undoneState.captionTracks[0].id).toBe("track-1");
    expect(undoneState.captionTracks[0].cues).toHaveLength(2);
    expect(undoneState.activeCaptionTrackId).toBe("track-1");
    expect(undoneState.epoch).toBe(2);
  });

  it("UpdateCaptionTrackCommand updates properties and reverts cleanly", () => {
    const updatedTrack: CaptionTrack = {
      ...initialTrack,
      name: "Renamed Subtitles",
      visible: false,
    };

    const cmd = new UpdateCaptionTrackCommand(initialTrack, updatedTrack);
    const appliedState = journal.execute(cmd, initialState);

    expect(appliedState.captionTracks[0].name).toBe("Renamed Subtitles");
    expect(appliedState.captionTracks[0].visible).toBe(false);
    expect(appliedState.epoch).toBe(1);

    // Undo
    const undoneState = journal.undo(appliedState);
    expect(undoneState.captionTracks[0].name).toBe("Main Subtitles");
    expect(undoneState.captionTracks[0].visible).toBe(true);
    expect(undoneState.epoch).toBe(2);
  });

  it("AddCaptionCueCommand inserts cue in sorted tick order and undoes", () => {
    const newCue: CaptionCue = {
      id: "cue-middle",
      startTicks: 1_000_000,
      endTicks: 1_500_000,
      text: "Middle cue",
      styleVersion: 1,
    };

    const cmd = new AddCaptionCueCommand(initialTrack, newCue);
    const appliedState = journal.execute(cmd, initialState);

    const cues = appliedState.captionTracks[0].cues;
    expect(cues).toHaveLength(3);
    // Verifies monotonic sort
    expect(cues[0].id).toBe("cue-1");
    expect(cues[1].id).toBe("cue-middle");
    expect(cues[2].id).toBe("cue-2");
    expect(appliedState.epoch).toBe(1);

    // Undo
    const undoneState = journal.undo(appliedState);
    expect(undoneState.captionTracks[0].cues).toHaveLength(2);
    expect(undoneState.captionTracks[0].cues.map((c) => c.id)).toEqual(["cue-1", "cue-2"]);
    expect(undoneState.epoch).toBe(2);
  });

  it("RemoveCaptionCueCommand removes cue and restores it on undo", () => {
    const cmd = new RemoveCaptionCueCommand(initialTrack, "cue-1");
    const appliedState = journal.execute(cmd, initialState);

    expect(appliedState.captionTracks[0].cues).toHaveLength(1);
    expect(appliedState.captionTracks[0].cues[0].id).toBe("cue-2");
    expect(appliedState.epoch).toBe(1);

    // Undo
    const undoneState = journal.undo(appliedState);
    expect(undoneState.captionTracks[0].cues).toHaveLength(2);
    expect(undoneState.captionTracks[0].cues[0].id).toBe("cue-1");
    expect(undoneState.epoch).toBe(2);
  });

  it("UpdateCaptionCueCommand modifies cue text and undoes", () => {
    const updatedCue: CaptionCue = {
      ...initialTrack.cues[0],
      text: "Updated text for cue 1",
    };

    const cmd = new UpdateCaptionCueCommand(initialTrack, updatedCue);
    const appliedState = journal.execute(cmd, initialState);

    expect(appliedState.captionTracks[0].cues[0].text).toBe("Updated text for cue 1");
    expect(appliedState.epoch).toBe(1);

    // Undo
    const undoneState = journal.undo(appliedState);
    expect(undoneState.captionTracks[0].cues[0].text).toBe("First cue");
    expect(undoneState.epoch).toBe(2);
  });

  it("BatchUpdateCaptionCuesCommand updates all cues and reverts completely", () => {
    const bulkCues: CaptionCue[] = [
      { id: "b-1", startTicks: 500_000, endTicks: 1_500_000, text: "Bulk 1", styleVersion: 1 },
      { id: "b-2", startTicks: 1_800_000, endTicks: 2_500_000, text: "Bulk 2", styleVersion: 1 },
      { id: "b-3", startTicks: 3_000_000, endTicks: 4_500_000, text: "Bulk 3", styleVersion: 1 },
    ];

    const cmd = new BatchUpdateCaptionCuesCommand(initialTrack, bulkCues, "Auto Captions Generated");
    const appliedState = journal.execute(cmd, initialState);

    expect(appliedState.captionTracks[0].cues).toHaveLength(3);
    expect(appliedState.captionTracks[0].cues[0].text).toBe("Bulk 1");
    expect(appliedState.epoch).toBe(1);

    // Undo
    const undoneState = journal.undo(appliedState);
    expect(undoneState.captionTracks[0].cues).toHaveLength(2);
    expect(undoneState.captionTracks[0].cues[0].text).toBe("First cue");
    expect(undoneState.epoch).toBe(2);
  });
});

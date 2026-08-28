import { describe, expect, it } from "vitest";
import type { Clip, Track } from "@/types";
import type { Gap } from "@/types/gap";
import { CommandJournal } from "@/core/history/CommandJournal";
import type { Command } from "@/core/history/Command";
import { buildTimelineDragCommand, TimelineDragCommand } from "../TimelineDragCommand";

const track = (id: string, type: Track["type"] = "video"): Track => ({
  id,
  type,
  name: id,
  muted: false,
  locked: false,
  visible: true,
  height: 80,
});

const clip = (id: string, trackId: string, startTime: number, duration: number): Clip => ({
  id,
  trackId,
  startTime,
  duration,
  trimIn: 0,
  trimOut: duration,
  mediaId: "asset",
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  opacity: 1,
  rotation: 0,
  kind: "video",
});

const drag = (overrides: Record<string, unknown> = {}) => ({
  draggingClipId: "middle",
  draggedClipIds: ["middle"],
  originalPlacements: {
    middle: { trackId: "source", startTime: 2, index: 1 },
  },
  originalStartTime: 2,
  offsetX: 200,
  willCreateNewTrack: true,
  newTrackPosition: "above" as const,
  ...overrides,
});

describe("TimelineDragCommand", () => {
  it("moves a split half to a new track and restores the exact track on undo/redo", () => {
    const source = track("source");
    const unaffected = track("unaffected", "audio");
    const first = clip("first", "source", 0, 2);
    const middle = clip("middle", "source", 2, 2);
    const later = clip("later", "source", 7, 1);
    const state = {
      tracks: [source, unaffected],
      clips: [first, middle, later],
      gaps: [] as Gap[],
      mainVideoTrackId: "source",
      epoch: 10,
    };

    const command = buildTimelineDragCommand({
      state,
      drag: drag(),
      clip: middle,
      trackType: "video",
      snapEnabled: false,
      currentTime: 0,
      pixelsPerSecond: 100,
      newTrackInsertIndex: 0,
    });

    expect(command).toBeInstanceOf(TimelineDragCommand);
    const moved = command!.apply(state);
    const newTrack = moved.tracks.find((item) => item.id !== "source" && item.id !== "unaffected")!;
    expect(newTrack.id).toMatch(/^track-/);
    expect(moved.tracks.map((item) => item.id)).toEqual([newTrack.id, "source", "unaffected"]);
    expect(moved.clips.find((item) => item.id === "middle")).toMatchObject({ trackId: newTrack.id, startTime: 4 });
    expect(moved.clips.find((item) => item.id === "later")?.startTime).toBe(5);

    const restored = command!.invert().apply(moved);
    expect(restored.tracks).toEqual([source, unaffected]);
    expect(restored.clips).toEqual(state.clips);
    expect(restored.gaps).toEqual(state.gaps);
    expect(restored.mainVideoTrackId).toBe("source");

    const replayed = command!.apply(restored);
    expect(replayed.tracks.map((item) => item.id)).toEqual(moved.tracks.map((item) => item.id));
    expect(replayed.clips).toEqual(moved.clips);
  });

  it("deeply snapshots nested metadata across drag undo", () => {
    const source = track("source");
    const middle = {
      ...clip("middle", "source", 2, 2),
      kind: "compound",
      compoundChildren: [
        { ...clip("text-child", "source", 2, 2), kind: "text", styleDefinition: { id: "title", version: "2" } } as any,
        { ...clip("audio-child", "source", 2, 2), kind: "audio", audio: { gainDb: -5 } } as any,
      ],
    } as any as Clip;
    const state = {
      tracks: [source],
      clips: [middle],
      gaps: [] as Gap[],
      mainVideoTrackId: "source",
      epoch: 0,
    };
    const command = buildTimelineDragCommand({
      state,
      drag: drag(),
      clip: middle,
      trackType: "video",
      snapEnabled: false,
      currentTime: 0,
      pixelsPerSecond: 100,
      newTrackInsertIndex: 0,
    })!;
    const moved = command.apply(state);
    const movedClip = moved.clips.find((item) => item.id === "middle")!;
    (movedClip.compoundChildren![0] as any).styleDefinition.version = "mutated";
    (movedClip.compoundChildren![1] as any).audio.gainDb = 12;

    const restored = command.invert().apply(moved);
    const restoredChildren = restored.clips[0].compoundChildren!;
    expect((restoredChildren[0] as any).styleDefinition).toEqual({ id: "title", version: "2" });
    expect((restoredChildren[1] as any).audio.gainDb).toBe(-5);
  });

  it("serializes and deserializes the exact reversible patch", () => {
    const source = track("source");
    const middle = clip("middle", "source", 2, 2);
    const state = { tracks: [source], clips: [middle], gaps: [] as Gap[], mainVideoTrackId: "source", epoch: 0 };
    const command = buildTimelineDragCommand({
      state,
      drag: drag(),
      clip: middle,
      trackType: "video",
      snapEnabled: false,
      currentTime: 0,
      pixelsPerSecond: 100,
      newTrackInsertIndex: 0,
    })!;
    const restored = TimelineDragCommand.fromJSON(command.toJSON());
    expect(restored.apply(state).tracks.map((item) => item.id)).toEqual(command.apply(state).tracks.map((item) => item.id));
  });

  it("does not create a command for a canceled or missing drop target", () => {
    const source = track("source");
    const middle = clip("middle", "source", 2, 2);
    const state = { tracks: [source], clips: [middle], gaps: [] as Gap[], mainVideoTrackId: "source", epoch: 0 };
    expect(buildTimelineDragCommand({
      state,
      drag: drag({ willCreateNewTrack: false, newTrackPosition: null, targetTrackId: null, dropTarget: null, placementPreview: null }),
      clip: middle,
      snapEnabled: false,
      currentTime: 0,
      pixelsPerSecond: 100,
    })).toBeNull();
  });

  it("rejects a mixed selection when any source track is locked", () => {
    const source = track("source");
    const lockedSource = { ...track("locked-source"), locked: true };
    const movable = clip("movable", "source", 0, 2);
    const lockedClip = clip("locked", "locked-source", 0, 2);
    const state = {
      tracks: [source, lockedSource],
      clips: [movable, lockedClip],
      gaps: [] as Gap[],
      mainVideoTrackId: "source",
      epoch: 0,
    };

    expect(buildTimelineDragCommand({
      state,
      drag: drag({
        draggingClipId: "movable",
        draggedClipIds: ["movable", "locked"],
        originalPlacements: {
          movable: { trackId: "source", startTime: 0, index: 0 },
          locked: { trackId: "locked-source", startTime: 0, index: 0 },
        },
      }),
      clip: movable,
      snapEnabled: false,
      currentTime: 0,
      pixelsPerSecond: 100,
    })).toBeNull();
  });

  it("preserves unrelated empty tracks and supports existing-track moves", () => {
    const source = track("source");
    const target = track("target", "audio");
    const unrelatedEmpty = track("unrelated-empty", "text");
    const first = clip("first", "source", 0, 2);
    const middle = clip("middle", "source", 2, 2);
    const later = clip("later", "source", 7, 1);
    const state = {
      tracks: [source, target, unrelatedEmpty],
      clips: [first, middle, later],
      gaps: [] as Gap[],
      mainVideoTrackId: "source",
      epoch: 0,
    };
    const command = buildTimelineDragCommand({
      state,
      drag: drag({
        willCreateNewTrack: false,
        newTrackPosition: null,
        targetTrackId: "target",
        dropTarget: { type: "gap", startTime: 4 },
        placementPreview: { type: "position", startTime: 4 },
      }),
      clip: middle,
      snapEnabled: false,
      currentTime: 0,
      pixelsPerSecond: 100,
    });

    const moved = command!.apply(state);
    expect(moved.tracks.map((item) => item.id)).toEqual(["source", "target", "unrelated-empty"]);
    expect(moved.clips.find((item) => item.id === "middle")).toMatchObject({ trackId: "target", startTime: 4 });
    expect(moved.clips.find((item) => item.id === "later")?.startTime).toBe(5);
  });

  it("does not journal a same-track no-op", () => {
    const source = track("source");
    const first = clip("first", "source", 0, 2);
    const second = clip("second", "source", 2, 2);
    const state = { tracks: [source], clips: [first, second], gaps: [] as Gap[], mainVideoTrackId: "source", epoch: 0 };
    expect(buildTimelineDragCommand({
      state,
      drag: drag({
        draggingClipId: "first",
        draggedClipIds: ["first"],
        originalPlacements: { first: { trackId: "source", startTime: 0, index: 0 } },
        originalStartTime: 0,
        offsetX: 0,
        willCreateNewTrack: false,
        newTrackPosition: null,
        targetTrackId: "source",
        dropTarget: { type: "insert", target: { position: "start" } },
        placementPreview: { type: "insert", insertionIndex: 0, gapStartTime: 0, gapDuration: 2, affectedClipPositions: new Map([["second", 2]]) },
      }),
      clip: first,
      snapEnabled: false,
      currentTime: 0,
      pixelsPerSecond: 100,
    })).toBeNull();
  });

  it("is the command surfaced by the first undo after an earlier edit", () => {
    const source = track("source");
    const middle = clip("middle", "source", 2, 2);
    const state = { tracks: [source], clips: [middle], gaps: [] as Gap[], mainVideoTrackId: "source", epoch: 0 };
    const command = buildTimelineDragCommand({
      state,
      drag: drag(),
      clip: middle,
      trackType: "video",
      snapEnabled: false,
      currentTime: 0,
      pixelsPerSecond: 100,
      newTrackInsertIndex: 0,
    })!;
    const prior: Command = {
      id: "prior-edit",
      label: "Split Clip",
      timestamp: 0,
      undoable: true,
      apply: (value) => value,
      invert: () => prior,
    };
    const journal = new CommandJournal({ enableCoalescing: false });
    let current = journal.execute(prior, state);
    current = journal.execute(command, current);
    expect(current.tracks.length).toBe(2);
    expect(journal.getState().undoLabel).toBe("Move Clips");
    current = journal.undo(current);
    expect(current.tracks).toEqual([source]);
    expect(journal.getState().redoLabel).toBe("Move Clips");
  });
});

import { describe, expect, it } from "vitest";
import type { Clip, Track } from "@/types";
import { InsertEditCommand } from "../InsertEditCommand";
import { RippleDeleteRangeCommand } from "../RippleDeleteRangeCommand";

const track: Track = { id: "v1", type: "video", name: "Video", muted: false, locked: false, visible: true, height: 68 };
const clip = (id: string, startTime: number, duration: number, trimIn = 0): Clip =>
  ({
    id,
    trackId: "v1",
    mediaId: `media-${id}`,
    startTime,
    duration,
    trimIn,
    trimOut: trimIn + duration,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    opacity: 1,
    rotation: 0,
  }) as Clip;

describe("timeline flow commands", () => {
  it("ripple deletes an adjacent range without double-shifting and restores it", () => {
    const state = {
      tracks: [track],
      clips: [clip("a", 0, 2), clip("b", 2, 2), clip("c", 4, 2), clip("d", 6, 2)],
      gaps: [],
      epoch: 0,
    };
    const command = new RippleDeleteRangeCommand(["b", "c"]);
    const deleted = command.apply(state);
    expect(deleted.clips.map((item) => [item.id, item.startTime])).toEqual([
      ["a", 0],
      ["d", 2],
    ]);
    expect(command.invert().apply(deleted).clips).toEqual(state.clips);
  });

  it("does not ripple edits across a protected gap", () => {
    const state = {
      tracks: [track],
      clips: [clip("a", 0, 2), clip("delete", 2, 2), clip("later", 8, 2)],
      gaps: [{ id: "protected", trackId: "v1", startTime: 4, duration: 4, type: "protected" as const, source: "user-insert" as const, protected: true }],
      epoch: 0,
    };
    const deleted = new RippleDeleteRangeCommand(["delete"]).apply(state);
    expect(deleted.clips.find((item) => item.id === "later")?.startTime).toBe(8);
    expect(deleted.gaps).toEqual(state.gaps);
  });

  it("splits a clip, inserts media, shifts later clips, and restores exact state", () => {
    const original = clip("source", 0, 10, 5);
    const later = clip("later", 10, 2);
    const inserted = clip("inserted", 4, 3);
    const state = { tracks: [track], clips: [original, later], gaps: [], epoch: 0 };
    const command = new InsertEditCommand(inserted, 4, original.id);
    const result = command.apply(state);
    const pieces = result.clips.filter((item) => item.mediaId === original.mediaId).sort((a, b) => a.startTime - b.startTime);
    expect(pieces).toHaveLength(2);
    expect(pieces[0]).toMatchObject({ startTime: 0, duration: 4, trimIn: 5, trimOut: 9 });
    expect(pieces[1]).toMatchObject({ startTime: 7, duration: 6, trimIn: 9, trimOut: 15 });
    expect(result.clips.find((item) => item.id === "later")?.startTime).toBe(13);
    expect(command.invert().apply(result).clips).toEqual(state.clips);
  });

  it("inserts at an existing cut without creating a redundant split", () => {
    const state = { tracks: [track], clips: [clip("a", 0, 4), clip("b", 4, 4)], gaps: [], epoch: 0 };
    const result = new InsertEditCommand(clip("inserted", 4, 2), 4, null).apply(state);
    expect(result.clips).toHaveLength(3);
    expect(result.clips.find((item) => item.id === "b")?.startTime).toBe(6);
  });

  it("defensively rejects insert commands when the target becomes locked", () => {
    const state = { tracks: [{ ...track, locked: true }], clips: [clip("a", 0, 4)], gaps: [], epoch: 0 };
    const command = new InsertEditCommand(clip("inserted", 2, 2), 2, "a");
    expect(command.apply(state)).toBe(state);
    expect(command.getResult()).toBeNull();
  });
});

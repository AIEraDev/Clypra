import { describe, expect, it } from "vitest";
import type { Clip, Track } from "@/types";
import { GroupClipsCommand, UngroupClipsCommand, validateGroupSelection } from "../CompoundClipCommands";
import { expandCompoundClips } from "@/core/timeline/compoundClips";
import type { Gap } from "@/types/gap";

const track: Track = { id: "track-v", type: "video", name: "Video", muted: false, locked: false, visible: true, height: 80 };
const makeClip = (id: string, startTime: number, duration: number): Clip => ({
  id, trackId: track.id, mediaId: `asset-${id}`, kind: "video", startTime, duration,
  trimIn: 0, trimOut: duration, x: 0, y: 0, width: 1920, height: 1080, opacity: 1, rotation: 0,
});

describe("CompoundClipCommands", () => {
  it("preserves same-track timing gaps and expands recursively", () => {
    const clips = [makeClip("a", 2, 3), makeClip("b", 8, 2)];
    const internalGap: Gap = { id: "internal-gap", trackId: track.id, startTime: 5, duration: 3, type: "auto", source: "clip-delete", protected: false };
    const command = new GroupClipsCommand(["a", "b"], clips, [track]);
    const grouped = command.apply({ tracks: [track], clips, gaps: [internalGap], epoch: 0 });
    const parent = grouped.clips[0];

    expect(parent).toMatchObject({ kind: "compound", startTime: 2, duration: 8 });
    expect(parent.compoundChildren?.map((child) => child.startTime)).toEqual([0, 6]);
    expect(expandCompoundClips(grouped.clips).map((clip) => [clip.id, clip.startTime])).toEqual([["a", 2], ["b", 8]]);
    expect(grouped.gaps).toEqual([]);

    const restored = command.invert().apply(grouped);
    expect(restored.gaps).toEqual([internalGap]);
  });

  it("restores exact child and parent IDs through undo/redo", () => {
    const clips = [makeClip("a", 0, 2), makeClip("b", 2, 2)];
    const command = new GroupClipsCommand(["a", "b"], clips, [track]);
    const grouped = command.apply({ tracks: [track], clips, epoch: 0 });
    const parentId = grouped.clips[0].id;
    const ungroup = command.invert();
    const restored = ungroup.apply(grouped);
    const regrouped = command.apply(restored);
    expect(restored.clips.map((clip) => clip.id)).toEqual(["a", "b"]);
    expect(regrouped.clips[0].id).toBe(parentId);
  });

  it("groups cross-track clips while preserving each child's track through expansion and ungroup", () => {
    const otherTrack = { ...track, id: "track-other" };
    const a = makeClip("a", 0, 1);
    const b = { ...makeClip("b", 1, 1), trackId: otherTrack.id };
    expect(validateGroupSelection([a.id, b.id], [a, b], [track, otherTrack])).toEqual({ valid: true });
    const command = new GroupClipsCommand([a.id, b.id], [a, b], [track, otherTrack]);
    const grouped = command.apply({ tracks: [track, otherTrack], clips: [a, b], epoch: 0 });
    const parent = grouped.clips[0];

    expect(parent.trackId).toBe(track.id);
    expect(parent.compoundChildren?.map((child) => [child.id, child.trackId, child.startTime])).toEqual([
      ["a", track.id, 0],
      ["b", otherTrack.id, 1],
    ]);
    expect(expandCompoundClips([parent]).map((clip) => [clip.id, clip.trackId, clip.startTime])).toEqual([
      ["a", track.id, 0],
      ["b", otherTrack.id, 1],
    ]);
    expect(command.invert().apply(grouped).clips.map((clip) => [clip.id, clip.trackId, clip.startTime])).toEqual([
      ["a", track.id, 0],
      ["b", otherTrack.id, 1],
    ]);
  });

  it("rejects locked and transition-linked selections", () => {
    const a = makeClip("a", 0, 1);
    expect(validateGroupSelection([a.id, a.id], [a], [track]).valid).toBe(false);
    expect(validateGroupSelection([a.id, "b"], [a, makeClip("b", 1, 1)], [{ ...track, locked: true }]).valid).toBe(false);
    expect(validateGroupSelection([a.id, "b"], [a, makeClip("b", 1, 1)], [track], [{ id: "t", fromItemId: a.id, toItemId: "b" } as any]).valid).toBe(false);
  });

  it("ungroups a directly constructed compound with its original parent ID on undo", () => {
    const children = [makeClip("a", 0, 1), makeClip("b", 1, 1)];
    const group = new GroupClipsCommand(["a", "b"], children, [track]);
    const grouped = group.apply({ tracks: [track], clips: children, epoch: 0 });
    const parent = grouped.clips[0];
    const ungroup = new UngroupClipsCommand(parent, parent.compoundChildren, 0, undefined, [track]);
    const restored = ungroup.apply(grouped);
    const regrouped = ungroup.invert().apply(restored);
    expect(regrouped.clips[0].id).toBe(parent.id);
  });
});

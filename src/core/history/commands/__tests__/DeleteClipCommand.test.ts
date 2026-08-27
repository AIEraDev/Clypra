import { describe, it, expect } from "vitest";
import { DeleteClipCommand } from "../DeleteClipCommand";
import type { Clip, Track } from "@/types";

describe("DeleteClipCommand", () => {
  const createTestClip = (overrides?: Partial<Clip>): Clip => ({
    id: `clip-${Math.random()}`,
    trackId: "track-1",
    mediaId: "media-1",
    startTime: 0,
    duration: 5,
    trimIn: 0,
    trimOut: 5,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    opacity: 1,
    rotation: 0,
    ...overrides,
  });

  it("should delete a clip from clips array", () => {
    const clipA = createTestClip({ id: "A" });
    const clipB = createTestClip({ id: "B" });
    const command = new DeleteClipCommand("A");
    const state = { clips: [clipA, clipB], epoch: 0 };

    const newState = command.apply(state);
    expect(newState.clips).toHaveLength(1);
    expect(newState.clips[0].id).toBe("B");
  });

  it("should restore clip and track on undo", () => {
    const track = { id: "track-1", type: "text" as const, name: "Text 1", muted: false, locked: false, visible: true, height: 30 };
    const clip = createTestClip({ id: "A", trackId: "track-1" });
    const command = new DeleteClipCommand("A");
    const state = { tracks: [track], clips: [clip], epoch: 0 };

    const newState = command.apply(state);
    expect(newState.clips).toHaveLength(0);
    expect(newState.tracks).toHaveLength(0); // auto-deleted

    const undoCommand = command.invert();
    const restoredState = undoCommand.apply(newState);

    expect(restoredState.clips).toHaveLength(1);
    expect(restoredState.clips[0].id).toBe("A");
    expect(restoredState.tracks).toHaveLength(1);
    expect(restoredState.tracks![0].id).toBe("track-1");
  });

  it("keeps nested audio and text metadata isolated in the delete snapshot", () => {
    const clip = createTestClip({
      id: "nested",
      kind: "compound",
      compoundChildren: [
        {
          ...createTestClip({ id: "text-child", kind: "text" }),
          styleDefinition: { id: "pinned-title", version: "3" },
          parameterOverrides: { glowRadius: 0.4 },
        } as any,
        {
          ...createTestClip({ id: "audio-child", kind: "audio" }),
          audio: { gainDb: -6, volumeKeyframes: [] },
        } as any,
      ],
    });
    const command = new DeleteClipCommand("nested");
    const deleted = command.apply({ clips: [clip], epoch: 0 });

    (clip.compoundChildren![0] as any).styleDefinition.version = "changed";
    (clip.compoundChildren![1] as any).audio.gainDb = 12;

    const restored = command.invert().apply(deleted);
    const restoredChildren = restored.clips[0].compoundChildren!;
    expect((restoredChildren[0] as any).styleDefinition).toEqual({ id: "pinned-title", version: "3" });
    expect((restoredChildren[1] as any).audio.gainDb).toBe(-6);
  });
});

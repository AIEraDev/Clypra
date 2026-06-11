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
    const track = { id: "track-1", type: "video" as const, name: "Video 1", muted: false, locked: false, visible: true, height: 68 };
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
});

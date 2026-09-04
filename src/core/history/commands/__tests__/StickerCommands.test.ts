import { describe, it, expect, beforeEach } from "vitest";
import { CommandJournal } from "../../CommandJournal";
import {
  AddStickerCommand,
  DeleteStickerCommand,
  UpdateStickerSettingsCommand,
} from "../StickerCommands";
import type { Clip } from "@/types";

describe("Sticker Commands — Full-Snapshot Undo/Redo", () => {
  let journal: CommandJournal;
  let sampleStickerClip: Clip;
  let initialState: {
    clips: Clip[];
    epoch: number;
  };

  beforeEach(() => {
    journal = new CommandJournal({
      maxSize: 50,
      enableCoalescing: false,
      coalescingWindowMs: 0,
    });

    sampleStickerClip = {
      id: "clip-sticker-1",
      kind: "sticker",
      trackId: "track-sticker-1",
      mediaId: "sticker-happy-cat",
      startTime: 1.0,
      duration: 3.0,
      trimIn: 0,
      trimOut: 3.0,
      x: 0,
      y: 0,
      width: 400,
      height: 400,
      opacity: 1,
      rotation: 0,
      stickerFormat: "lottie",
      stickerSourceId: "happy-cat",
      stickerAnimationPath: "/cache/stickers/happy-cat.json",
      stickerSettings: {
        speed: 1.0,
        loop: true,
      },
    };

    initialState = {
      clips: [],
      epoch: 0,
    };
  });

  it("AddStickerCommand adds sticker clip and inverts cleanly on undo", () => {
    const cmd = new AddStickerCommand(sampleStickerClip);
    const applied = journal.execute(cmd, initialState);

    expect(applied.clips).toHaveLength(1);
    expect(applied.clips[0].id).toBe("clip-sticker-1");
    expect(applied.clips[0].stickerSettings?.speed).toBe(1.0);
    expect(applied.epoch).toBe(1);

    const undone = journal.undo(applied);
    expect(undone.clips).toHaveLength(0);
    expect(undone.epoch).toBe(2);

    const redone = journal.redo(undone);
    expect(redone.clips).toHaveLength(1);
    expect(redone.clips[0].id).toBe("clip-sticker-1");
    expect(redone.epoch).toBe(3);
  });

  it("DeleteStickerCommand removes sticker clip and restores snapshot on undo", () => {
    const stateWithSticker = {
      clips: [sampleStickerClip],
      epoch: 1,
    };

    const cmd = new DeleteStickerCommand("clip-sticker-1", sampleStickerClip);
    const applied = journal.execute(cmd, stateWithSticker);

    expect(applied.clips).toHaveLength(0);
    expect(applied.epoch).toBe(2);

    const undone = journal.undo(applied);
    expect(undone.clips).toHaveLength(1);
    expect(undone.clips[0].id).toBe("clip-sticker-1");
    expect(undone.clips[0].stickerFormat).toBe("lottie");
    expect(undone.epoch).toBe(3);
  });

  it("UpdateStickerSettingsCommand modifies animation speed/loop and reverts cleanly", () => {
    const stateWithSticker = {
      clips: [sampleStickerClip],
      epoch: 1,
    };

    const newSettings = {
      speed: 2.5,
      loop: false,
    };

    const cmd = new UpdateStickerSettingsCommand(
      "clip-sticker-1",
      sampleStickerClip.stickerSettings!,
      newSettings,
    );
    const applied = journal.execute(cmd, stateWithSticker);

    expect(applied.clips[0].stickerSettings?.speed).toBe(2.5);
    expect(applied.clips[0].stickerSettings?.loop).toBe(false);
    expect(applied.epoch).toBe(2);

    const undone = journal.undo(applied);
    expect(undone.clips[0].stickerSettings?.speed).toBe(1.0);
    expect(undone.clips[0].stickerSettings?.loop).toBe(true);
    expect(undone.epoch).toBe(3);
  });
});

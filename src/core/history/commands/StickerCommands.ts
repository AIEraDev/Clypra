import type { Command } from "../Command";
import { generateCommandId } from "../Command";
import type { Clip, StickerSettings } from "@/types";

function cloneClip(clip: Clip): Clip {
  return JSON.parse(JSON.stringify(clip));
}

function cloneSettings(settings: StickerSettings): StickerSettings {
  return JSON.parse(JSON.stringify(settings));
}

export class UpdateStickerSettingsCommand implements Command {
  readonly id: string;
  readonly label: string;
  readonly timestamp: number;
  readonly undoable = true;
  private readonly clipId: string;
  private readonly beforeSettings: StickerSettings;
  private readonly afterSettings: StickerSettings;

  constructor(
    clipId: string,
    beforeSettings: StickerSettings,
    afterSettings: StickerSettings,
    label = "Update Sticker Settings",
  ) {
    this.id = generateCommandId();
    this.label = label;
    this.timestamp = Date.now();
    this.clipId = clipId;
    this.beforeSettings = cloneSettings(beforeSettings);
    this.afterSettings = cloneSettings(afterSettings);
  }

  apply(state: any): any {
    const clips = (state.clips || []).map((c: Clip) => {
      if (c.id !== this.clipId) return c;
      return {
        ...cloneClip(c),
        stickerSettings: cloneSettings(this.afterSettings),
      };
    });

    return {
      ...state,
      clips,
      epoch: state.epoch + 1,
    };
  }

  invert(): Command {
    return new UpdateStickerSettingsCommand(
      this.clipId,
      this.afterSettings,
      this.beforeSettings,
      `Undo ${this.label}`,
    );
  }

  toJSON(): Record<string, any> {
    return {
      type: "UpdateStickerSettings",
      clipId: this.clipId,
      beforeSettings: this.beforeSettings,
      afterSettings: this.afterSettings,
      label: this.label,
    };
  }

  static fromJSON(data: Record<string, any>): UpdateStickerSettingsCommand {
    return new UpdateStickerSettingsCommand(
      data.clipId,
      data.beforeSettings,
      data.afterSettings,
      data.label,
    );
  }
}

export class AddStickerCommand implements Command {
  readonly id: string;
  readonly label: string;
  readonly timestamp: number;
  readonly undoable = true;
  private readonly clip: Clip;

  constructor(clip: Clip, label = "Add Sticker") {
    this.id = generateCommandId();
    this.label = label;
    this.timestamp = Date.now();
    this.clip = cloneClip(clip);
  }

  apply(state: any): any {
    return {
      ...state,
      clips: [...(state.clips || []), cloneClip(this.clip)],
      epoch: state.epoch + 1,
    };
  }

  invert(): Command {
    return new DeleteStickerCommand(this.clip.id, this.clip, `Undo ${this.label}`);
  }

  toJSON(): Record<string, any> {
    return {
      type: "AddSticker",
      clip: this.clip,
      label: this.label,
    };
  }

  static fromJSON(data: Record<string, any>): AddStickerCommand {
    return new AddStickerCommand(data.clip, data.label);
  }
}

export class DeleteStickerCommand implements Command {
  readonly id: string;
  readonly label: string;
  readonly timestamp: number;
  readonly undoable = true;
  private readonly clipId: string;
  private clip: Clip | null = null;

  constructor(clipId: string, clipSnapshot?: Clip, label = "Delete Sticker") {
    this.id = generateCommandId();
    this.label = label;
    this.timestamp = Date.now();
    this.clipId = clipId;
    if (clipSnapshot) {
      this.clip = cloneClip(clipSnapshot);
    }
  }

  apply(state: any): any {
    if (!this.clip) {
      const found = (state.clips || []).find((c: Clip) => c.id === this.clipId);
      if (found) {
        this.clip = cloneClip(found);
      }
    }

    return {
      ...state,
      clips: (state.clips || []).filter((c: Clip) => c.id !== this.clipId),
      epoch: state.epoch + 1,
    };
  }

  invert(): Command {
    if (!this.clip) {
      throw new Error("Cannot invert DeleteStickerCommand: clip not found");
    }
    return new AddStickerCommand(this.clip, `Undo ${this.label}`);
  }

  toJSON(): Record<string, any> {
    return {
      type: "DeleteSticker",
      clipId: this.clipId,
      clip: this.clip,
      label: this.label,
    };
  }

  static fromJSON(data: Record<string, any>): DeleteStickerCommand {
    return new DeleteStickerCommand(data.clipId, data.clip, data.label);
  }
}

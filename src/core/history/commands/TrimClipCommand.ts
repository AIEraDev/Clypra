/**
 * Trim Clip Command
 */

import type { Command } from "../Command";
import { generateCommandId } from "../Command";
import type { Clip } from "@/types";
import { t } from "@/i18n";

interface TimelineState {
  clips: Clip[];
  epoch: number;
}

export class TrimClipCommand implements Command {
  readonly id: string;
  readonly label: string;
  readonly timestamp: number;
  readonly undoable: boolean = true;

  constructor(
    private readonly clipId: string,
    private readonly oldTrimIn: number,
    private readonly oldTrimOut: number,
    private readonly oldDuration: number,
    private readonly newTrimIn: number,
    private readonly newTrimOut: number,
    private readonly newDuration: number,
  ) {
    this.id = generateCommandId();
    this.label = t("timeline.history.trimClip");
    this.timestamp = Date.now();
  }

  apply(state: TimelineState): TimelineState {
    return {
      ...state,
      clips: state.clips.map((clip) =>
        clip.id === this.clipId
          ? {
              ...clip,
              trimIn: this.newTrimIn,
              trimOut: this.newTrimOut,
              duration: this.newDuration,
            }
          : clip,
      ),
      epoch: state.epoch + 1, // ✅ Epoch increment inside command
    };
  }

  invert(): Command {
    return new TrimClipCommand(this.clipId, this.newTrimIn, this.newTrimOut, this.newDuration, this.oldTrimIn, this.oldTrimOut, this.oldDuration);
  }

  merge(next: Command): Command | null {
    // Merge with another trim on same clip
    if (next instanceof TrimClipCommand && next.clipId === this.clipId) {
      return new TrimClipCommand(this.clipId, this.oldTrimIn, this.oldTrimOut, this.oldDuration, next.newTrimIn, next.newTrimOut, next.newDuration);
    }
    return null;
  }

  toJSON(): Record<string, any> {
    return {
      type: "TrimClip",
      clipId: this.clipId,
      oldTrimIn: this.oldTrimIn,
      oldTrimOut: this.oldTrimOut,
      oldDuration: this.oldDuration,
      newTrimIn: this.newTrimIn,
      newTrimOut: this.newTrimOut,
      newDuration: this.newDuration,
    };
  }

  static fromJSON(data: Record<string, any>): TrimClipCommand {
    return new TrimClipCommand(data.clipId, data.oldTrimIn, data.oldTrimOut, data.oldDuration, data.newTrimIn, data.newTrimOut, data.newDuration);
  }
}

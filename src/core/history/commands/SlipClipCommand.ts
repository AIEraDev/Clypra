/**
 * Slip Clip Command
 *
 * Changes a clip's source media trim boundaries (trimIn and trimOut)
 * without altering its timeline position (startTime) or duration.
 */

import type { Command } from "../Command";
import { generateCommandId } from "../Command";
import type { Clip } from "@/types";

interface TimelineState {
  clips: Clip[];
  epoch: number;
}

export class SlipClipCommand implements Command {
  readonly id: string;
  readonly label: string = "Slip Clip";
  readonly timestamp: number;
  readonly undoable: boolean = true;

  constructor(
    public readonly clipId: string,
    public readonly oldTrimIn: number,
    public readonly oldTrimOut: number,
    public readonly newTrimIn: number,
    public readonly newTrimOut: number,
  ) {
    this.id = generateCommandId();
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
            }
          : clip,
      ),
      epoch: state.epoch + 1,
    };
  }

  invert(): Command {
    return new SlipClipCommand(
      this.clipId,
      this.newTrimIn,
      this.newTrimOut,
      this.oldTrimIn,
      this.oldTrimOut,
    );
  }

  merge(next: Command): Command | null {
    if (next instanceof SlipClipCommand && next.clipId === this.clipId) {
      return new SlipClipCommand(
        this.clipId,
        this.oldTrimIn,
        this.oldTrimOut,
        next.newTrimIn,
        next.newTrimOut,
      );
    }
    return null;
  }

  toJSON(): Record<string, any> {
    return {
      type: "SlipClip",
      clipId: this.clipId,
      oldTrimIn: this.oldTrimIn,
      oldTrimOut: this.oldTrimOut,
      newTrimIn: this.newTrimIn,
      newTrimOut: this.newTrimOut,
    };
  }

  static fromJSON(data: Record<string, any>): SlipClipCommand {
    return new SlipClipCommand(
      data.clipId,
      data.oldTrimIn,
      data.oldTrimOut,
      data.newTrimIn,
      data.newTrimOut,
    );
  }
}

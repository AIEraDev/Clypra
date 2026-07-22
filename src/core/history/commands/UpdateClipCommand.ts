/**
 * Update Clip Command
 *
 * Updates clip properties (e.g., effects, transforms, opacity).
 */

import type { Command } from "../Command";
import { generateCommandId } from "../Command";
import type { Clip } from "@/types";
import { t } from "@/i18n";

interface TimelineState {
  clips: Clip[];
  epoch: number;
}

export class UpdateClipCommand implements Command {
  readonly id: string;
  readonly label: string;
  readonly timestamp: number;
  readonly undoable: boolean = true;

  constructor(
    private readonly clipId: string,
    private readonly oldProperties: Partial<Clip>,
    private readonly newProperties: Partial<Clip>,
  ) {
    this.id = generateCommandId();
    this.label = t("timeline.history.updateClip");
    this.timestamp = Date.now();
  }

  apply(state: TimelineState): TimelineState {
    return {
      ...state,
      clips: state.clips.map((c) => (c.id === this.clipId ? { ...c, ...this.newProperties } : c)),
      epoch: state.epoch + 1, // ✅ Epoch increment inside command
    };
  }

  invert(): Command {
    return new UpdateClipCommand(this.clipId, this.newProperties, this.oldProperties);
  }

  merge(next: Command): Command | null {
    // Merge with another update on same clip
    if (next instanceof UpdateClipCommand && next.clipId === this.clipId) {
      return new UpdateClipCommand(
        this.clipId,
        this.oldProperties, // Keep original old
        next.newProperties, // Use new properties from next
      );
    }
    return null;
  }

  toJSON(): Record<string, any> {
    return {
      type: "UpdateClip",
      clipId: this.clipId,
      oldProperties: this.oldProperties,
      newProperties: this.newProperties,
    };
  }

  static fromJSON(data: Record<string, any>): UpdateClipCommand {
    return new UpdateClipCommand(data.clipId, data.oldProperties, data.newProperties);
  }
}

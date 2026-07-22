/**
 * Transform Command
 *
 * Handles undo/redo for clip transform operations (move, scale, rotate).
 */

import type { Command } from "../Command";
import { generateCommandId } from "../Command";
import type { Clip } from "@/types";
import { t } from "@/i18n";

/**
 * Timeline state interface (minimal - only what we need).
 */
interface TimelineState {
  clips: Clip[];
  epoch: number;
}

export class TransformClipCommand implements Command {
  readonly id: string;
  readonly label: string;
  readonly timestamp: number;
  readonly undoable: boolean = true;

  constructor(
    private readonly clipId: string,
    private readonly oldTransform: Partial<Clip>,
    private readonly newTransform: Partial<Clip>,
  ) {
    this.id = generateCommandId();
    this.label = t("timeline.history.transformClip");
    this.timestamp = Date.now();
  }

  apply(state: TimelineState): TimelineState {
    return {
      ...state,
      clips: state.clips.map((clip) => (clip.id === this.clipId ? { ...clip, ...this.newTransform } : clip)),
      epoch: state.epoch + 1,
    };
  }

  invert(): Command {
    return new TransformClipCommand(this.clipId, this.newTransform, this.oldTransform);
  }

  merge(next: Command): Command | null {
    // Allow merging consecutive transforms on the same clip
    if (next instanceof TransformClipCommand && next.clipId === this.clipId) {
      return new TransformClipCommand(this.clipId, this.oldTransform, next.newTransform);
    }
    return null;
  }
}

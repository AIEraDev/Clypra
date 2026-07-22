/**
 * Move Clip Command
 *
 * Semantic operation: Move a clip to a new position/track.
 *
 * This is MUCH better than storing entire state snapshots:
 * - Tiny memory footprint
 * - Deterministic
 * - Serializable
 * - Invertible
 */

import type { Command } from "../Command";
import { generateCommandId } from "../Command";
import { t } from "@/i18n";

/**
 * Timeline state interface (minimal - only what we need).
 */
interface TimelineState {
  clips: Array<{
    id: string;
    trackId: string;
    startTime: number;
    [key: string]: any;
  }>;
  epoch: number;
}

/**
 * Move clip command.
 */
export class MoveClipCommand implements Command {
  readonly id: string;
  readonly label: string;
  readonly timestamp: number;
  readonly undoable: boolean = true;

  constructor(
    private readonly clipId: string,
    private readonly fromTrackId: string,
    private readonly toTrackId: string,
    private readonly fromTime: number,
    private readonly toTime: number,
  ) {
    this.id = generateCommandId();
    this.label = t("timeline.history.moveClip");
    this.timestamp = Date.now();
  }

  apply(state: TimelineState): TimelineState {
    return {
      ...state,
      clips: state.clips.map((clip) => (clip.id === this.clipId ? { ...clip, trackId: this.toTrackId, startTime: this.toTime } : clip)),
      epoch: state.epoch + 1, // ✅ Epoch increment inside command
    };
  }

  invert(): Command {
    // Inverse: move back to original position
    return new MoveClipCommand(
      this.clipId,
      this.toTrackId, // Swap from/to
      this.fromTrackId,
      this.toTime,
      this.fromTime,
    );
  }

  merge(next: Command): Command | null {
    // Can merge with another MoveClipCommand for same clip
    if (next instanceof MoveClipCommand && next.clipId === this.clipId) {
      // Merge: keep original from, use new to
      return new MoveClipCommand(
        this.clipId,
        this.fromTrackId, // Original from
        next.toTrackId, // New to
        this.fromTime,
        next.toTime,
      );
    }
    return null;
  }

  /**
   * Serialize for collaboration/macros.
   */
  toJSON(): Record<string, any> {
    return {
      type: "MoveClip",
      clipId: this.clipId,
      fromTrackId: this.fromTrackId,
      toTrackId: this.toTrackId,
      fromTime: this.fromTime,
      toTime: this.toTime,
    };
  }

  /**
   * Deserialize from JSON.
   */
  static fromJSON(data: Record<string, any>): MoveClipCommand {
    return new MoveClipCommand(data.clipId, data.fromTrackId, data.toTrackId, data.fromTime, data.toTime);
  }
}

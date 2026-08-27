/**
 * Update Clip Command
 *
 * Updates clip properties (e.g., effects, transforms, opacity).
 */

import type { Command } from "../Command";
import { generateCommandId } from "../Command";
import type { Clip } from "@/types";
import { synchronizeClipAudioProperties } from "@/types/audio";

interface TimelineState {
  clips: Clip[];
  epoch: number;
}

interface UpdateClipSnapshots {
  before?: Clip;
  after?: Clip;
}

function cloneClipSnapshot(clip: Clip): Clip {
  if (typeof structuredClone === "function") return structuredClone(clip);
  return JSON.parse(JSON.stringify(clip)) as Clip;
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
    snapshots: UpdateClipSnapshots = {},
  ) {
    this.id = generateCommandId();
    this.label = "Update Clip";
    this.timestamp = Date.now();
    this.beforeSnapshot = snapshots.before
      ? cloneClipSnapshot(snapshots.before)
      : null;
    this.afterSnapshot = snapshots.after
      ? cloneClipSnapshot(snapshots.after)
      : null;
  }

  private beforeSnapshot: Clip | null;
  private afterSnapshot: Clip | null;

  apply(state: TimelineState): TimelineState {
    const currentClip = state.clips.find((clip) => clip.id === this.clipId);
    if (!currentClip) return state;

    // Keep the public constructor patch-based for existing callers, but make
    // undo/redo restore a complete clip so newly-added fields cannot drift.
    if (!this.afterSnapshot) {
      if (!this.beforeSnapshot) {
        this.beforeSnapshot = cloneClipSnapshot(currentClip);
      }
      const synchronized = synchronizeClipAudioProperties(currentClip, this.newProperties);
      const linkedSource = currentClip.audio?.linkState === "unlinked" && currentClip.audio.linkedClipId
        ? state.clips.find((candidate) => candidate.id === currentClip.audio?.linkedClipId)
        : undefined;
      const linkOffsetSeconds = this.newProperties.startTime !== undefined && linkedSource
        ? this.newProperties.startTime - linkedSource.startTime
        : synchronized.audio?.linkOffsetSeconds;
      this.afterSnapshot = cloneClipSnapshot({
        ...currentClip,
        ...synchronized,
        ...(synchronized.audio && linkOffsetSeconds !== undefined
          ? { audio: { ...synchronized.audio, linkOffsetSeconds } }
          : {}),
      });
    }

    return {
      ...state,
      clips: state.clips.map((clip) => {
        if (clip.id !== this.clipId) return clip;
        return cloneClipSnapshot(this.afterSnapshot!);
      }),
      epoch: state.epoch + 1, // ✅ Epoch increment inside command
    };
  }

  invert(): Command {
    return new UpdateClipCommand(
      this.clipId,
      this.newProperties,
      this.oldProperties,
      this.beforeSnapshot && this.afterSnapshot
        ? { before: this.afterSnapshot, after: this.beforeSnapshot }
        : {},
    );
  }

  merge(next: Command): Command | null {
    // Merge with another update on same clip
    if (next instanceof UpdateClipCommand && next.clipId === this.clipId) {
      return new UpdateClipCommand(
        this.clipId,
        this.oldProperties, // Keep original old
        next.newProperties, // Use new properties from next
        this.beforeSnapshot ? { before: this.beforeSnapshot } : {},
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

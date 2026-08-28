/**
 * Transform Command
 *
 * Handles undo/redo for clip transform operations (move, scale, rotate).
 */

import type { Command } from "../Command";
import { generateCommandId } from "../Command";
import type { Clip } from "@/types";
import { synchronizeClipAudioProperties } from "@/types/audio";

/**
 * Timeline state interface (minimal - only what we need).
 */
interface TimelineState {
  clips: Clip[];
  epoch: number;
}

interface TransformSnapshots {
  before?: Clip;
  after?: Clip;
}

function cloneClipSnapshot(clip: Clip): Clip {
  if (typeof structuredClone === "function") return structuredClone(clip);
  return JSON.parse(JSON.stringify(clip)) as Clip;
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
    snapshots: TransformSnapshots = {},
  ) {
    this.id = generateCommandId();
    this.label = "Transform Clip";
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

    // Capture complete snapshots on the first application. The constructor
    // remains patch-based for existing callers, but undo/redo no longer
    // reconstructs a clip from a partial property list.
    if (!this.afterSnapshot) {
      if (!this.beforeSnapshot) {
        this.beforeSnapshot = cloneClipSnapshot(currentClip);
      }
      const synchronized = synchronizeClipAudioProperties(currentClip, this.newTransform);
      const linkedSource = currentClip.audio?.linkState === "unlinked" && currentClip.audio.linkedClipId
        ? state.clips.find((candidate) => candidate.id === currentClip.audio?.linkedClipId)
        : undefined;
      const linkOffsetSeconds = this.newTransform.startTime !== undefined && linkedSource
        ? this.newTransform.startTime - linkedSource.startTime
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
      epoch: state.epoch + 1,
    };
  }

  invert(): Command {
    return new TransformClipCommand(
      this.clipId,
      this.newTransform,
      this.oldTransform,
      this.beforeSnapshot && this.afterSnapshot
        ? { before: this.afterSnapshot, after: this.beforeSnapshot }
        : {},
    );
  }

  merge(next: Command): Command | null {
    // Allow merging consecutive transforms on the same clip
    if (next instanceof TransformClipCommand && next.clipId === this.clipId) {
      return new TransformClipCommand(
        this.clipId,
        this.oldTransform,
        next.newTransform,
        this.beforeSnapshot ? { before: this.beforeSnapshot } : {},
      );
    }
    return null;
  }
}

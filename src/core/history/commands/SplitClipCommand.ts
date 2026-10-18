/**
 * Split Clip Command
 *
 * Splits a clip at a specific time, creating two clips.
 */

import type { Command } from "../Command";
import { generateCommandId } from "../Command";
import type { Clip, TransitionTimelineItem } from "@/types";
import { generateId } from "@/lib/utils/id";
import { snapToFrameBoundary } from "@/lib/utils/frameTime";
import { resolveClipSourceTime } from "@/core/timeline/sourceTime";

interface TimelineState {
  clips: Clip[];
  transitions?: TransitionTimelineItem[];
  epoch: number;
}

function cloneClipSnapshot(clip: Clip): Clip {
  if (typeof structuredClone === "function") return structuredClone(clip);
  return JSON.parse(JSON.stringify(clip)) as Clip;
}

export class SplitClipCommand implements Command {
  readonly id: string;
  readonly label: string;
  readonly timestamp: number;
  readonly undoable: boolean = true;

  // Generate new IDs for BOTH splits (not just right)
  private leftClipId: string | null = null;
  private rightClipId: string | null = null;
  private originalClipIndex: number = -1;
  private readonly originalClip: Clip;

  constructor(
    private readonly clipId: string,
    private readonly splitTime: number,
    private readonly frameRate: number,
    originalClip: Clip,
  ) {
    this.id = generateCommandId();
    this.label = "Split Clip";
    this.timestamp = Date.now();
    this.originalClip = cloneClipSnapshot(originalClip);
  }

  apply(state: TimelineState): TimelineState {
    const clip = state.clips.find((c) => c.id === this.clipId);
    if (!clip) return state;
    this.originalClipIndex = state.clips.findIndex((c) => c.id === this.clipId);

    const clipEndTime = clip.startTime + clip.duration;
    if (this.splitTime <= clip.startTime || this.splitTime >= clipEndTime) {
      return state;
    }

    // ✅ SNAP split time to frame boundary BEFORE calculations
    const snappedSplitTime = snapToFrameBoundary(
      this.splitTime,
      this.frameRate,
    );
    if (snappedSplitTime <= clip.startTime || snappedSplitTime >= clipEndTime) {
      return state;
    }

    const timeSinceStart = snappedSplitTime - clip.startTime;
    const leftDuration = timeSinceStart;
    const rightDuration = (clip.startTime + clip.duration) - snappedSplitTime;

    const isReversed = clip.playbackMapping?.kind === "reverse";
    const isFreeze = clip.playbackMapping?.kind === "freeze";

    let leftTrimIn = clip.trimIn;
    let leftTrimOut = clip.trimOut;
    let rightTrimIn = clip.trimIn;
    let rightTrimOut = clip.trimOut;

    if (isFreeze) {
      leftTrimIn = clip.trimIn;
      leftTrimOut = clip.trimOut;
      rightTrimIn = clip.trimIn;
      rightTrimOut = clip.trimOut;
    } else if (isReversed) {
      const splitSourceTime = resolveClipSourceTime(clip, snappedSplitTime).sourceTime;
      leftTrimIn = splitSourceTime;
      leftTrimOut = clip.trimOut;
      rightTrimIn = clip.trimIn;
      rightTrimOut = splitSourceTime;
    } else {
      const splitSourceTime = resolveClipSourceTime(clip, snappedSplitTime).sourceTime;
      leftTrimIn = clip.trimIn;
      leftTrimOut = splitSourceTime;
      rightTrimIn = splitSourceTime;
      rightTrimOut = clip.trimOut;
    }

    // Generate new IDs for BOTH splits
    // This prevents property confusion where effects/volume applied to wrong clip
    if (!this.leftClipId) {
      this.leftClipId = generateId("clip");
    }
    if (!this.rightClipId) {
      this.rightClipId = generateId("clip");
    }

    // Create LEFT split with new ID
    const leftClip: Clip = {
      ...cloneClipSnapshot(clip),
      id: this.leftClipId,
      duration: leftDuration,
      trimIn: leftTrimIn,
      trimOut: leftTrimOut,
    };

    // Create RIGHT split with new ID
    const rightClip: Clip = {
      ...cloneClipSnapshot(clip),
      id: this.rightClipId,
      startTime: snappedSplitTime, // ✅ Use snapped time
      duration: rightDuration,
      trimIn: rightTrimIn,
      trimOut: rightTrimOut,
    };

    const updatedTransitions = state.transitions?.map((t) => {
      let fromItemId = t.fromItemId;
      let toItemId = t.toItemId;
      if (toItemId === this.clipId) {
        toItemId = this.leftClipId!;
      }
      if (fromItemId === this.clipId) {
        fromItemId = this.rightClipId!;
      }
      if (fromItemId !== t.fromItemId || toItemId !== t.toItemId) {
        return { ...t, fromItemId, toItemId };
      }
      return t;
    });

    const nextState: TimelineState = {
      ...state,
      // Remove original clip, add both new splits
      clips: [
        ...state.clips.filter((c) => c.id !== this.clipId),
        leftClip,
        rightClip,
      ],
      epoch: state.epoch + 1, // ✅ Epoch increment inside command
    };

    if (updatedTransitions !== undefined) {
      nextState.transitions = updatedTransitions;
    }

    return nextState;
  }

  // Expose both new clip IDs
  getLeftClipId(): string | null {
    return this.leftClipId;
  }

  getRightClipId(): string | null {
    return this.rightClipId;
  }

  // Kept for backward compatibility
  // New code should use getLeftClipId() and getRightClipId()
  getCreatedClipId(): string | null {
    return this.rightClipId; // Return right clip for backward compat
  }

  invert(): Command {
    // Pass both clip IDs and the original splitTime to merge command
    return new MergeSplitClipsCommand(
      this.leftClipId!,
      this.rightClipId!,
      this.originalClip,
      this.frameRate,
      this.splitTime,
      this.originalClipIndex,
    );
  }

  toJSON(): Record<string, any> {
    return {
      type: "SplitClip",
      clipId: this.clipId,
      splitTime: this.splitTime,
      frameRate: this.frameRate,
      originalClip: this.originalClip,
      // Serialize both new IDs
      leftClipId: this.leftClipId,
      rightClipId: this.rightClipId,
      originalClipIndex: this.originalClipIndex,
      // Keep newClipId for backward compatibility with old saved projects
      newClipId: this.rightClipId,
    };
  }

  static fromJSON(data: Record<string, any>): SplitClipCommand {
    const cmd = new SplitClipCommand(
      data.clipId,
      data.splitTime,
      data.frameRate || 30,
      data.originalClip,
    );

    // Migration for old format
    // Old format: only newClipId exists (left kept original ID)
    // New format: both leftClipId and rightClipId exist
    if (data.leftClipId && data.rightClipId) {
      // New format
      cmd.leftClipId = data.leftClipId;
      cmd.rightClipId = data.rightClipId;
    } else if (data.newClipId) {
      // Old format: left kept original ID, right got new ID
      cmd.leftClipId = data.clipId; // Original ID for left (old behavior)
      cmd.rightClipId = data.newClipId;
    }
    cmd.originalClipIndex = data.originalClipIndex ?? -1;

    return cmd;
  }
}

/**
 * Merge Split Clips Command (inverse of split)
 *
 * Removes the right clip and restores the left clip to its original state.
 */
class MergeSplitClipsCommand implements Command {
  readonly id: string;
  readonly label: string;
  readonly timestamp: number;
  readonly undoable: boolean = true;
  private readonly originalClip: Clip;

  constructor(
    private readonly leftClipId: string,
    private readonly rightClipId: string,
    originalClip: Clip,
    private readonly frameRate: number = 30,
    // TL-BUG-002 fix: Store the exact split time for correct invert()
    private readonly splitTime?: number,
    private readonly originalClipIndex: number = -1,
  ) {
    this.id = generateCommandId();
    this.label = "Merge Split Clips";
    this.timestamp = Date.now();
    this.originalClip = cloneClipSnapshot(originalClip);
  }

  apply(state: TimelineState): TimelineState {
    // Remove BOTH split clips and restore original
    const clips = state.clips.filter(
      (c) => c.id !== this.leftClipId && c.id !== this.rightClipId,
    );
    const insertIndex =
      this.originalClipIndex >= 0
        ? Math.min(this.originalClipIndex, clips.length)
        : clips.length;
    clips.splice(insertIndex, 0, cloneClipSnapshot(this.originalClip));
    return {
      ...state,
      clips,
      epoch: state.epoch + 1, // ✅ Epoch increment inside command
    };
  }

  invert(): Command {
    // TL-BUG-002 fix: Use the stored splitTime (exact) instead of duration / 2 (approximate)
    const exactSplitTime =
      this.splitTime ??
      this.originalClip.startTime + this.originalClip.duration / 2;
    const cmd = new SplitClipCommand(
      this.originalClip.id,
      exactSplitTime,
      this.frameRate,
      this.originalClip,
    );
    // Preserve the same clip IDs so redo produces identical clips
    (cmd as any).leftClipId = this.leftClipId;
    (cmd as any).rightClipId = this.rightClipId;
    return cmd;
  }

  toJSON(): Record<string, any> {
    return {
      type: "MergeSplitClips",
      leftClipId: this.leftClipId,
      rightClipId: this.rightClipId,
      originalClip: this.originalClip,
      frameRate: this.frameRate,
      // TL-BUG-002 fix: Serialize splitTime for correct deserialized invert()
      splitTime: this.splitTime,
      originalClipIndex: this.originalClipIndex,
    };
  }

  static fromJSON(data: Record<string, any>): MergeSplitClipsCommand {
    return new MergeSplitClipsCommand(
      data.leftClipId,
      data.rightClipId,
      data.originalClip,
      data.frameRate || 30,
      data.splitTime,
      data.originalClipIndex ?? -1,
    );
  }
}

/**
 * Split Clip Command
 *
 * Splits a clip at a specific time, creating two clips.
 */

import type { Command } from "../Command";
import { generateCommandId } from "../Command";
import type { Clip } from "@/types";
import { generateId } from "@/lib/utils/id";
import { snapToFrameBoundary } from "@/lib/utils/frameTime";
import { t } from "@/i18n";

interface TimelineState {
  clips: Clip[];
  epoch: number;
}

export class SplitClipCommand implements Command {
  readonly id: string;
  readonly label: string;
  readonly timestamp: number;
  readonly undoable: boolean = true;

  // Generate new IDs for BOTH splits (not just right)
  private leftClipId: string | null = null;
  private rightClipId: string | null = null;

  constructor(
    private readonly clipId: string,
    private readonly splitTime: number,
    private readonly frameRate: number,
    private readonly originalClip: Clip,
  ) {
    this.id = generateCommandId();
    this.label = t("timeline.history.splitClip");
    this.timestamp = Date.now();
  }

  apply(state: TimelineState): TimelineState {
    const clip = state.clips.find((c) => c.id === this.clipId);
    if (!clip) return state;

    const clipEndTime = clip.startTime + clip.duration;
    if (this.splitTime <= clip.startTime || this.splitTime >= clipEndTime) {
      return state;
    }

    // ✅ SNAP split time to frame boundary BEFORE calculations
    const snappedSplitTime = snapToFrameBoundary(this.splitTime, this.frameRate);
    if (snappedSplitTime <= clip.startTime || snappedSplitTime >= clipEndTime) {
      return state;
    }

    const timeSinceStart = snappedSplitTime - clip.startTime;

    // Calculate new trim points and durations
    const leftTrimOut = clip.trimIn + timeSinceStart;
    const leftDuration = leftTrimOut - clip.trimIn;

    const rightTrimIn = leftTrimOut;
    const rightDuration = clip.trimOut - rightTrimIn;

    // ✅ ASSERT: verify coherence (can remove in production)
    console.assert(Math.abs(rightTrimIn - leftTrimOut) < 0.001, `Split coherence violated: leftTrimOut=${leftTrimOut} rightTrimIn=${rightTrimIn}`);

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
      ...clip,
      id: this.leftClipId,
      duration: leftDuration,
      trimOut: leftTrimOut,
    };

    // Create RIGHT split with new ID
    const rightClip: Clip = {
      ...clip,
      id: this.rightClipId,
      startTime: snappedSplitTime, // ✅ Use snapped time
      duration: rightDuration,
      trimIn: rightTrimIn,
      trimOut: clip.trimOut,
    };

    return {
      ...state,
      // Remove original clip, add both new splits
      clips: [...state.clips.filter((c) => c.id !== this.clipId), leftClip, rightClip],
      epoch: state.epoch + 1, // ✅ Epoch increment inside command
    };
  }

  // Expose both new clip IDs
  getLeftClipId(): string | null {
    return this.leftClipId;
  }

  getRightClipId(): string | null {
    return this.rightClipId;
  }

  // DEPRECATED: Kept for backward compatibility
  // New code should use getLeftClipId() and getRightClipId()
  getCreatedClipId(): string | null {
    return this.rightClipId; // Return right clip for backward compat
  }

  invert(): Command {
    // Pass both clip IDs and the original splitTime to merge command
    return new MergeSplitClipsCommand(this.leftClipId!, this.rightClipId!, this.originalClip, this.frameRate, this.splitTime);
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
      // Keep newClipId for backward compatibility with old saved projects
      newClipId: this.rightClipId,
    };
  }

  static fromJSON(data: Record<string, any>): SplitClipCommand {
    const cmd = new SplitClipCommand(data.clipId, data.splitTime, data.frameRate || 30, data.originalClip);

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

  constructor(
    private readonly leftClipId: string,
    private readonly rightClipId: string,
    private readonly originalClip: Clip,
    private readonly frameRate: number = 30,
    // TL-BUG-002 fix: Store the exact split time for correct invert()
    private readonly splitTime?: number,
  ) {
    this.id = generateCommandId();
    this.label = t("timeline.history.mergeSplitClips");
    this.timestamp = Date.now();
  }

  apply(state: TimelineState): TimelineState {
    // Remove BOTH split clips and restore original
    return {
      ...state,
      clips: [...state.clips.filter((c) => c.id !== this.leftClipId && c.id !== this.rightClipId), this.originalClip],
      epoch: state.epoch + 1, // ✅ Epoch increment inside command
    };
  }

  invert(): Command {
    // TL-BUG-002 fix: Use the stored splitTime (exact) instead of duration / 2 (approximate)
    const exactSplitTime = this.splitTime ?? this.originalClip.startTime + this.originalClip.duration / 2;
    const cmd = new SplitClipCommand(this.originalClip.id, exactSplitTime, this.frameRate, this.originalClip);
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
    };
  }

  static fromJSON(data: Record<string, any>): MergeSplitClipsCommand {
    return new MergeSplitClipsCommand(data.leftClipId, data.rightClipId, data.originalClip, data.frameRate || 30, data.splitTime);
  }
}

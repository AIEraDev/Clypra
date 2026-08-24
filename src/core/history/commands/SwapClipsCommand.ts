import type { Clip, Track, TransitionTimelineItem } from "@/types";
import type { Command } from "../Command";
import { generateCommandId } from "../Command";

interface TimelineState {
  clips: Clip[];
  tracks: Track[];
  transitions: TransitionTimelineItem[];
  epoch: number;
}

class RestoreSwapCommand implements Command {
  readonly id = generateCommandId();
  readonly label = "Restore Swapped Clips";
  readonly timestamp = Date.now();
  readonly undoable = true;

  constructor(
    private readonly clipA: Clip,
    private readonly clipB: Clip,
    private readonly transitions: TransitionTimelineItem[],
    private readonly forward: SwapClipsCommand,
  ) {}

  apply(state: TimelineState): TimelineState {
    return {
      ...state,
      clips: state.clips.map((clip) => (clip.id === this.clipA.id ? { ...this.clipA } : clip.id === this.clipB.id ? { ...this.clipB } : clip)),
      transitions: this.transitions.map((transition) => ({ ...transition })),
      epoch: state.epoch + 1,
    };
  }

  invert(): Command {
    return this.forward;
  }
}

export class SwapClipsCommand implements Command {
  readonly id = generateCommandId();
  readonly label = "Swap Clips";
  readonly timestamp = Date.now();
  readonly undoable = true;

  private beforeA: Clip | null = null;
  private beforeB: Clip | null = null;
  private beforeTransitions: TransitionTimelineItem[] = [];
  private error: string | null = null;

  constructor(private readonly clipAId: string, private readonly clipBId: string) {}

  static validate(state: TimelineState, clipAId: string, clipBId: string): string | null {
    const clipA = state.clips.find((clip) => clip.id === clipAId);
    const clipB = state.clips.find((clip) => clip.id === clipBId);
    if (!clipA || !clipB) return "Selected clips not found";
    if (state.tracks.find((track) => track.id === clipA.trackId)?.locked || state.tracks.find((track) => track.id === clipB.trackId)?.locked) {
      return "Cannot swap clips on a locked track";
    }

    if (clipA.trackId === clipB.trackId) {
      const [left, right] = clipA.startTime < clipB.startTime ? [clipA, clipB] : [clipB, clipA];
      const otherClips = state.clips.filter((clip) => clip.trackId === left.trackId && clip.id !== left.id && clip.id !== right.id);
      const collision = otherClips.some((clip) => {
        const end = clip.startTime + clip.duration;
        return (right.startTime < end && right.startTime + left.duration > clip.startTime) || (left.startTime < end && left.startTime + right.duration > clip.startTime);
      });
      if (collision) return "Not enough space to swap — clips would overlap";
    }
    return null;
  }

  getError(): string | null {
    return this.error;
  }

  apply(state: TimelineState): TimelineState {
    const clipA = state.clips.find((clip) => clip.id === this.clipAId);
    const clipB = state.clips.find((clip) => clip.id === this.clipBId);
    const validationError = SwapClipsCommand.validate(state, this.clipAId, this.clipBId);
    if (validationError) {
      this.error = validationError;
      return state;
    }

    if (!clipA || !clipB) return state;

    this.beforeA = { ...clipA };
    this.beforeB = { ...clipB };
    this.beforeTransitions = state.transitions.map((transition) => ({ ...transition }));
    this.error = null;

    const transitions = clipA.trackId === clipB.trackId
      ? state.transitions
      : state.transitions.filter((transition) => ![clipA.id, clipB.id].includes(transition.fromItemId) && ![clipA.id, clipB.id].includes(transition.toItemId));
    const clips = state.clips.map((clip) => {
      if (clip.id === clipA.id) return { ...clip, startTime: clipB.startTime, trackId: clipB.trackId };
      if (clip.id === clipB.id) return { ...clip, startTime: clipA.startTime, trackId: clipA.trackId };
      return clip;
    });
    return { ...state, clips, transitions, epoch: state.epoch + 1 };
  }

  invert(): Command {
    if (!this.beforeA || !this.beforeB) throw new Error("Cannot invert an unsuccessful swap");
    return new RestoreSwapCommand(this.beforeA, this.beforeB, this.beforeTransitions, this);
  }
}

import type { Clip } from "@/types";
import type { Gap } from "@/types/gap";
import type { Command } from "../Command";
import { generateCommandId } from "../Command";

interface TimelineState {
  clips: Clip[];
  gaps: Gap[];
  epoch: number;
}

function cloneClipSnapshot(clip: Clip): Clip {
  if (typeof structuredClone === "function") return structuredClone(clip);
  return JSON.parse(JSON.stringify(clip)) as Clip;
}

function cloneClips(clips: Clip[]): Clip[] {
  return clips.map(cloneClipSnapshot);
}

function cloneGaps(gaps: Gap[]): Gap[] {
  return gaps.map((gap) => ({
    ...gap,
    metadata: gap.metadata ? { ...gap.metadata } : gap.metadata,
  }));
}

/** Atomic history entry for a completed standard or ripple trim gesture. */
export class TimelineTrimCommand implements Command {
  readonly id = generateCommandId();
  readonly label = "Trim Clip";
  readonly timestamp = Date.now();
  readonly undoable = true;

  private readonly beforeClips: Clip[];
  private readonly afterClips: Clip[];
  private readonly beforeGaps: Gap[];
  private readonly afterGaps: Gap[];

  constructor(
    beforeClips: Clip[],
    afterClips: Clip[],
    beforeGaps: Gap[],
    afterGaps: Gap[],
  ) {
    this.beforeClips = cloneClips(beforeClips);
    this.afterClips = cloneClips(afterClips);
    this.beforeGaps = cloneGaps(beforeGaps);
    this.afterGaps = cloneGaps(afterGaps);
  }

  apply(state: TimelineState): TimelineState {
    return {
      ...state,
      clips: cloneClips(this.afterClips),
      gaps: cloneGaps(this.afterGaps),
      epoch: state.epoch + 1,
    };
  }

  invert(): TimelineTrimCommand {
    return new TimelineTrimCommand(
      this.afterClips,
      this.beforeClips,
      this.afterGaps,
      this.beforeGaps,
    );
  }

  toJSON(): Record<string, unknown> {
    return {
      type: "TimelineTrim",
      beforeClips: this.beforeClips,
      afterClips: this.afterClips,
      beforeGaps: this.beforeGaps,
      afterGaps: this.afterGaps,
    };
  }

  static fromJSON(data: Record<string, any>): TimelineTrimCommand {
    return new TimelineTrimCommand(
      data.beforeClips ?? [],
      data.afterClips ?? [],
      data.beforeGaps ?? [],
      data.afterGaps ?? [],
    );
  }
}

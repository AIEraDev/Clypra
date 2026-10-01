/**
 * Slide Clip Command
 *
 * Moves a clip along the timeline while adjusting neighboring clips'
 * boundaries so overall track duration and outer boundaries remain invariant.
 */

import type { Command } from "../Command";
import { generateCommandId } from "../Command";
import type { Clip } from "@/types";

interface TimelineState {
  clips: Clip[];
  epoch: number;
}

function cloneClipSnapshot(clip: Clip): Clip {
  if (typeof structuredClone === "function") return structuredClone(clip);
  return JSON.parse(JSON.stringify(clip)) as Clip;
}

export class SlideClipCommand implements Command {
  readonly id: string;
  readonly label: string = "Slide Clip";
  readonly timestamp: number;
  readonly undoable: boolean = true;

  public readonly beforeClips: Clip[];
  public readonly afterClips: Clip[];

  constructor(beforeClips: Clip[], afterClips: Clip[]) {
    this.id = generateCommandId();
    this.timestamp = Date.now();
    this.beforeClips = beforeClips.map(cloneClipSnapshot);
    this.afterClips = afterClips.map(cloneClipSnapshot);
  }

  apply(state: TimelineState): TimelineState {
    const afterMap = new Map(this.afterClips.map((c) => [c.id, c]));
    return {
      ...state,
      clips: state.clips.map((clip) => {
        const replacement = afterMap.get(clip.id);
        return replacement ? cloneClipSnapshot(replacement) : clip;
      }),
      epoch: state.epoch + 1,
    };
  }

  invert(): Command {
    return new SlideClipCommand(this.afterClips, this.beforeClips);
  }

  toJSON(): Record<string, any> {
    return {
      type: "SlideClip",
      beforeClips: this.beforeClips,
      afterClips: this.afterClips,
    };
  }

  static fromJSON(data: Record<string, any>): SlideClipCommand {
    return new SlideClipCommand(
      data.beforeClips ?? [],
      data.afterClips ?? [],
    );
  }
}

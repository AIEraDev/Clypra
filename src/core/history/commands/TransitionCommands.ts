import type { Command } from "../Command";
import { generateCommandId } from "../Command";
import type { TransitionTimelineItem } from "@/types";

function cloneTransition(t: TransitionTimelineItem): TransitionTimelineItem {
  return JSON.parse(JSON.stringify(t));
}

function cloneTransitions(transitions: TransitionTimelineItem[]): TransitionTimelineItem[] {
  return transitions.map(cloneTransition);
}

export class AddTransitionCommand implements Command {
  readonly id: string;
  readonly label: string;
  readonly timestamp: number;
  readonly undoable = true;
  private readonly transition: TransitionTimelineItem;

  constructor(transition: TransitionTimelineItem) {
    this.id = generateCommandId();
    this.label = "Add Transition";
    this.timestamp = Date.now();
    this.transition = cloneTransition(transition);
  }

  apply(state: any): any {
    return {
      ...state,
      transitions: [...(state.transitions || []), cloneTransition(this.transition)],
      epoch: state.epoch + 1,
    };
  }

  invert(): Command {
    return new DeleteTransitionCommand(this.transition.id, this.transition);
  }

  toJSON(): Record<string, any> {
    return {
      type: "AddTransition",
      transition: this.transition,
    };
  }

  static fromJSON(data: Record<string, any>): AddTransitionCommand {
    return new AddTransitionCommand(data.transition);
  }
}

export class DeleteTransitionCommand implements Command {
  readonly id: string;
  readonly label: string;
  readonly timestamp: number;
  readonly undoable = true;
  private transition: TransitionTimelineItem | null = null;

  constructor(
    private readonly transitionId: string,
    transitionSnapshot?: TransitionTimelineItem,
  ) {
    this.id = generateCommandId();
    this.label = "Delete Transition";
    this.timestamp = Date.now();
    if (transitionSnapshot) {
      this.transition = cloneTransition(transitionSnapshot);
    }
  }

  apply(state: any): any {
    if (!this.transition) {
      const found = state.transitions?.find((t: any) => t.id === this.transitionId);
      if (found) {
        this.transition = cloneTransition(found);
      }
    }

    return {
      ...state,
      transitions: (state.transitions || []).filter((t: any) => t.id !== this.transitionId),
      epoch: state.epoch + 1,
    };
  }

  invert(): Command {
    if (!this.transition) {
      throw new Error("Cannot invert DeleteTransitionCommand: transition not found");
    }
    return new AddTransitionCommand(this.transition);
  }

  toJSON(): Record<string, any> {
    return {
      type: "DeleteTransition",
      transitionId: this.transitionId,
      transition: this.transition,
    };
  }

  static fromJSON(data: Record<string, any>): DeleteTransitionCommand {
    return new DeleteTransitionCommand(data.transitionId, data.transition);
  }
}

export class UpdateTransitionCommand implements Command {
  readonly id: string;
  readonly timestamp: number;
  readonly undoable = true;
  private readonly beforeTransition: TransitionTimelineItem;
  private readonly afterTransition: TransitionTimelineItem;

  constructor(
    beforeTransition: TransitionTimelineItem,
    afterTransition: TransitionTimelineItem,
    readonly label = "Update Transition",
  ) {
    this.id = generateCommandId();
    this.timestamp = Date.now();
    this.beforeTransition = cloneTransition(beforeTransition);
    this.afterTransition = cloneTransition(afterTransition);
  }

  apply(state: any): any {
    const transitions = (state.transitions || []).map((t: any) =>
      t.id === this.afterTransition.id ? cloneTransition(this.afterTransition) : t,
    );

    return {
      ...state,
      transitions,
      epoch: state.epoch + 1,
    };
  }

  invert(): Command {
    return new UpdateTransitionCommand(
      this.afterTransition,
      this.beforeTransition,
      `Undo ${this.label}`,
    );
  }

  toJSON(): Record<string, any> {
    return {
      type: "UpdateTransition",
      beforeTransition: this.beforeTransition,
      afterTransition: this.afterTransition,
      label: this.label,
    };
  }

  static fromJSON(data: Record<string, any>): UpdateTransitionCommand {
    return new UpdateTransitionCommand(
      data.beforeTransition,
      data.afterTransition,
      data.label,
    );
  }
}

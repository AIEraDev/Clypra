import type { Command } from "../Command";
import { generateCommandId } from "../Command";
import type { TransitionTimelineItem } from "@/types";

export class AddTransitionCommand implements Command {
  readonly id: string;
  readonly label: string;
  readonly timestamp: number;
  readonly undoable: boolean = true;

  constructor(private readonly transition: TransitionTimelineItem) {
    this.id = generateCommandId();
    this.label = "Add Transition";
    this.timestamp = Date.now();
  }

  apply(state: any): any {
    return {
      ...state,
      transitions: [...(state.transitions || []), this.transition],
      epoch: state.epoch + 1,
    };
  }

  invert(): Command {
    return new DeleteTransitionCommand(this.transition.id);
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
  readonly undoable: boolean = true;
  private transition: TransitionTimelineItem | null = null;

  constructor(private readonly transitionId: string) {
    this.id = generateCommandId();
    this.label = "Delete Transition";
    this.timestamp = Date.now();
  }

  apply(state: any): any {
    this.transition = state.transitions.find((t: any) => t.id === this.transitionId) || null;
    if (!this.transition) return state;

    return {
      ...state,
      transitions: state.transitions.filter((t: any) => t.id !== this.transitionId),
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
    const cmd = new DeleteTransitionCommand(data.transitionId);
    cmd.transition = data.transition;
    return cmd;
  }
}

/**
 * Transaction System for Grouping Commands
 *
 * One user action (e.g., drag clip) may generate many commands.
 * Transactions group them into a single undo/redo unit.
 *
 * Example:
 *   beginTransaction("Move Clip")
 *   - updateClipPosition (100 times during drag)
 *   - updateClipTrack
 *   - normalizeTrack
 *   commitTransaction()
 *
 * Result: Single "Move Clip" entry in history
 */

import type { Command } from "./Command";
import { generateCommandId } from "./Command";

/**
 * Transaction state.
 */
export enum TransactionState {
  Idle = "idle",
  Active = "active",
  Committed = "committed",
  RolledBack = "rolled_back",
}

/**
 * Transaction groups multiple commands into one undo/redo unit.
 */
export class Transaction {
  readonly id: string;
  readonly label: string;
  readonly startTime: number;

  private _commands: Command[] = [];
  private _state: TransactionState = TransactionState.Active;

  constructor(label: string) {
    this.id = generateCommandId();
    this.label = label;
    this.startTime = Date.now();
  }

  /**
   * Add command to transaction.
   */
  addCommand(command: Command): void {
    if (this._state !== TransactionState.Active) {
      throw new Error(`Cannot add command to ${this._state} transaction`);
    }
    this._commands.push(command);
  }

  /**
   * Get all commands in transaction.
   */
  getCommands(): readonly Command[] {
    return this._commands;
  }

  /**
   * Get transaction state.
   */
  getState(): TransactionState {
    return this._state;
  }

  /**
   * Mark transaction as committed.
   */
  commit(): void {
    if (this._state !== TransactionState.Active) {
      throw new Error(`Cannot commit ${this._state} transaction`);
    }
    this._state = TransactionState.Committed;
  }

  /**
   * Mark transaction as rolled back.
   */
  rollback(): void {
    if (this._state !== TransactionState.Active) {
      throw new Error(`Cannot rollback ${this._state} transaction`);
    }
    this._state = TransactionState.RolledBack;
  }

  /**
   * Whether transaction is empty (no commands).
   */
  isEmpty(): boolean {
    return this._commands.length === 0;
  }

  /**
   * Create composite command from all commands in transaction.
   * This becomes a single history entry.
   */
  toCompositeCommand(): CompositeCommand {
    return new CompositeCommand(this.label, this._commands);
  }
}

/**
 * Composite command that wraps multiple commands.
 * Used to represent a transaction as a single command.
 */
export class CompositeCommand implements Command {
  readonly id: string;
  readonly label: string;
  readonly timestamp: number;
  readonly undoable: boolean = true;

  private readonly _commands: Command[];

  constructor(label: string, commands: Command[]) {
    this.id = generateCommandId();
    this.label = label;
    this.timestamp = Date.now();
    this._commands = [...commands];
  }

  apply(state: any): any {
    // Apply all commands in sequence
    let currentState = state;
    for (const command of this._commands) {
      currentState = command.apply(currentState);
    }
    return currentState;
  }

  invert(): Command {
    // Invert all commands in reverse order
    const invertedCommands = this._commands.map((cmd) => cmd.invert()).reverse();

    return new CompositeCommand(this.label, invertedCommands);
  }

  merge(next: Command): Command | null {
    // Composite commands don't merge
    return null;
  }

  getCommands(): readonly Command[] {
    return this._commands;
  }
}

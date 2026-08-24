/**
 * Command Journal - Central Undo/Redo System
 *
 * This is the deterministic timeline operation journal.
 * All timeline mutations flow through here.
 *
 * Architecture:
 *   User Action → Command → CommandJournal → Timeline State → Epoch++
 *
 * Features:
 * - Command-based (not snapshot-based)
 * - Transaction support (group commands)
 * - Coalescing (merge similar commands)
 * - Epoch integration (invalidates caches)
 */

import type { Command } from "./Command";
import { Transaction } from "./Transaction";

/**
 * Command journal configuration.
 */
export interface CommandJournalConfig {
  /** Maximum history size (number of commands) */
  maxSize: number;

  /** Whether to enable coalescing */
  enableCoalescing: boolean;

  /** Coalescing window in ms (commands within this window can merge) */
  coalescingWindowMs: number;
}

/**
 * Default history configuration.
 */
const DEFAULT_CONFIG: CommandJournalConfig = {
  maxSize: 100,
  enableCoalescing: true,
  coalescingWindowMs: 500,
};

/**
 * Command journal state.
 */
export interface CommandJournalState {
  /** Can undo */
  canUndo: boolean;

  /** Can redo */
  canRedo: boolean;

  /** Current position in history */
  position: number;

  /** Total history size */
  size: number;

  /** Active transaction (if any) */
  activeTransaction: Transaction | null;

  /** Label for undo action (e.g., "Undo Move Clip") */
  undoLabel: string | null;

  /** Label for redo action (e.g., "Redo Move Clip") */
  redoLabel: string | null;
}

/**
 * Command journal - central undo/redo system.
 */
export class CommandJournal {
  private _history: Command[] = [];
  private _position: number = -1;
  private _config: CommandJournalConfig;
  private _activeTransaction: Transaction | null = null;
  private _listeners: Set<(state: CommandJournalState) => void> = new Set();

  constructor(config: Partial<CommandJournalConfig> = {}) {
    this._config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─── Command Execution ─────────────────────────────────────────────────────

  /**
   * Execute a command and add it to history.
   *
   * @param command - Command to execute
   * @param state - Current timeline state
   * @returns New timeline state
   */
  execute<T>(command: Command, state: T): T {
    // If in transaction, add to transaction instead of history
    if (this._activeTransaction) {
      try {
        this._activeTransaction.addCommand(command);
        return command.apply(state) as T;
      } catch (err) {
        console.error("[CommandJournal] Command execution failed inside active transaction. Aborting transaction.", err);
        this.rollbackTransaction(state);
        throw err;
      }
    }

    // Skip non-undoable commands
    if (!command.undoable) {
      return command.apply(state) as T;
    }

    // Try to coalesce with last command
    if (this._config.enableCoalescing && this._position >= 0) {
      const lastCommand = this._history[this._position];
      const timeDiff = command.timestamp - lastCommand.timestamp;

      if (timeDiff < this._config.coalescingWindowMs && lastCommand.merge) {
        const merged = lastCommand.merge(command);
        if (merged) {
          // Replace last command with merged version
          this._history[this._position] = merged;
          this._notifyListeners();
          return merged.apply(state) as T;
        }
      }
    }

    // Clear redo history when executing new command
    if (this._position < this._history.length - 1) {
      this._history = this._history.slice(0, this._position + 1);
    }

    // Add command to history
    this._history.push(command);
    this._position++;

    // Enforce max size
    if (this._history.length > this._config.maxSize) {
      this._history.shift();
      this._position--;
    }

    this._notifyListeners();

    // Apply command
    return command.apply(state) as T;
  }

  // ─── Undo/Redo ─────────────────────────────────────────────────────────────

  /**
   * Undo last command.
   *
   * @param state - Current timeline state
   * @returns New timeline state
   */
  undo<T>(state: T): T {
    if (!this.canUndo()) {
      return state;
    }

    const command = this._history[this._position];
    const inverse = command.invert();

    this._position--;
    this._notifyListeners();

    return inverse.apply(state) as T;
  }

  /**
   * Redo last undone command.
   *
   * @param state - Current timeline state
   * @returns New timeline state
   */
  redo<T>(state: T): T {
    if (!this.canRedo()) {
      return state;
    }

    this._position++;
    const command = this._history[this._position];

    this._notifyListeners();

    return command.apply(state) as T;
  }

  /**
   * Whether undo is possible.
   */
  canUndo(): boolean {
    return this._position >= 0;
  }

  /**
   * Whether redo is possible.
   */
  canRedo(): boolean {
    return this._position < this._history.length - 1;
  }

  // ─── Transactions ──────────────────────────────────────────────────────────

  /**
   * Begin a transaction.
   * Commands executed during transaction are grouped.
   *
   * @param label - Transaction label (for UI)
   */
  beginTransaction(label: string): void {
    if (this._activeTransaction) {
      throw new Error("Transaction already active");
    }
    this._activeTransaction = new Transaction(label);
    this._notifyListeners();
  }

  /**
   * Commit active transaction.
   * Creates a single composite command in history.
   *
   * @param state - Current timeline state
   * @returns New timeline state
   */
  commitTransaction<T>(state: T): T {
    if (!this._activeTransaction) {
      throw new Error("No active transaction");
    }

    const transaction = this._activeTransaction;
    this._activeTransaction = null;

    // Skip empty transactions
    if (transaction.isEmpty()) {
      transaction.commit();
      this._notifyListeners();
      return state;
    }

    // Create composite command
    const composite = transaction.toCompositeCommand();
    transaction.commit();

    // A committed transaction is a new edit just like a standalone command.
    // Discard any commands that were undone before this transaction started;
    // they describe a stale future and must not remain redoable.
    if (this._position < this._history.length - 1) {
      this._history = this._history.slice(0, this._position + 1);
    }

    // Add to history (without executing - already applied)
    this._history.push(composite);
    this._position++;

    // Enforce max size
    if (this._history.length > this._config.maxSize) {
      this._history.shift();
      this._position--;
    }

    this._notifyListeners();

    return state;
  }

  /**
   * Rollback active transaction.
   * Discards all commands in transaction.
   *
   * @param state - Current timeline state
   * @returns Original timeline state (before transaction)
   */
  rollbackTransaction<T>(state: T): T {
    if (!this._activeTransaction) {
      throw new Error("No active transaction");
    }

    const transaction = this._activeTransaction;
    this._activeTransaction = null;

    // Invert all commands in reverse order
    const commands = transaction.getCommands();
    let currentState = state;

    for (let i = commands.length - 1; i >= 0; i--) {
      const inverse = commands[i].invert();
      currentState = inverse.apply(currentState) as T;
    }

    transaction.rollback();
    this._notifyListeners();

    return currentState;
  }

  /**
   * Whether a transaction is active.
   */
  isTransactionActive(): boolean {
    return this._activeTransaction !== null;
  }

  // ─── State ─────────────────────────────────────────────────────────────────

  /**
   * Get current history state.
   */
  getState(): CommandJournalState {
    const undoCommand = this._position >= 0 ? this._history[this._position] : null;
    const redoCommand = this._position < this._history.length - 1 ? this._history[this._position + 1] : null;

    return {
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      position: this._position,
      size: this._history.length,
      activeTransaction: this._activeTransaction,
      undoLabel: undoCommand?.label ?? null,
      redoLabel: redoCommand?.label ?? null,
    };
  }

  /**
   * Clear all history.
   */
  clear(): void {
    this._history = [];
    this._position = -1;
    this._activeTransaction = null;
    this._notifyListeners();
  }

  /**
   * Get command at position (for debugging).
   */
  getCommandAt(index: number): Command | null {
    return this._history[index] ?? null;
  }

  /**
   * Get all commands (for debugging).
   */
  getAllCommands(): readonly Command[] {
    return this._history;
  }

  // ─── Listeners ─────────────────────────────────────────────────────────────

  /**
   * Subscribe to history state changes.
   */
  subscribe(listener: (state: CommandJournalState) => void): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  private _notifyListeners(): void {
    const state = this.getState();
    this._listeners.forEach((listener) => listener(state));
  }
}

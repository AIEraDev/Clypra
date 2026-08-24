import { describe, it, expect, vi } from "vitest";
import { CommandJournal } from "../CommandJournal";
import { Transaction, TransactionState } from "../Transaction";
import type { Command } from "../Command";

class MockCommand implements Command {
  id = "mock-id";
  label = "Mock Command";
  timestamp = Date.now();
  undoable = true;

  constructor(
    public value: number,
    public prevValue: number = 0,
    private _mergeFn?: (next: Command) => Command | null
  ) {}

  apply(state: any): any {
    return { ...state, count: this.value };
  }

  invert(): Command {
    return new MockCommand(this.prevValue, this.value, this._mergeFn);
  }

  merge(next: Command): Command | null {
    if (this._mergeFn) return this._mergeFn(next);
    return null;
  }
}

describe("CommandHistory — CommandJournal & Transaction", () => {
  it("should execute commands and transition history state correctly", () => {
    const journal = new CommandJournal({ maxSize: 3 });
    const initialState = { count: 10 };

    const cmd1 = new MockCommand(15, 10);
    const state1 = journal.execute(cmd1, initialState);

    expect(state1.count).toBe(15);
    expect(journal.canUndo()).toBe(true);
    expect(journal.canRedo()).toBe(false);
    expect(journal.getState().size).toBe(1);

    const cmd2 = new MockCommand(17, 15);
    const state2 = journal.execute(cmd2, state1);
    expect(state2.count).toBe(17);
    expect(journal.getState().size).toBe(2);
  });

  it("should support undo and redo operations", () => {
    const journal = new CommandJournal();
    let state = { count: 10 };

    state = journal.execute(new MockCommand(15, 10), state); // count: 15
    state = journal.execute(new MockCommand(18, 15), state); // count: 18

    // Undo 1
    state = journal.undo(state);
    expect(state.count).toBe(15);
    expect(journal.canRedo()).toBe(true);

    // Undo 2
    state = journal.undo(state);
    expect(state.count).toBe(10);

    // Redo 1
    state = journal.redo(state);
    expect(state.count).toBe(15);

    // Redo 2
    state = journal.redo(state);
    expect(state.count).toBe(18);
  });

  it("should clear redo history when executing a new command", () => {
    const journal = new CommandJournal();
    let state = { count: 10 };

    state = journal.execute(new MockCommand(15, 10), state); // 15
    state = journal.execute(new MockCommand(17, 15), state); // 17

    state = journal.undo(state); // 15
    expect(journal.canRedo()).toBe(true);

    state = journal.execute(new MockCommand(16, 15), state); // 16
    expect(journal.canRedo()).toBe(false); // Redo cleared
    expect(journal.getState().size).toBe(2);
  });

  it("should clear redo history when committing a new transaction", () => {
    const journal = new CommandJournal();
    let state = { count: 10 };

    state = journal.execute(new MockCommand(15, 10), state); // 15
    state = journal.execute(new MockCommand(18, 15), state); // 18
    state = journal.undo(state); // 15; 18 is now a redo candidate
    expect(journal.canRedo()).toBe(true);

    journal.beginTransaction("Replace Future");
    state = journal.execute(new MockCommand(16, 15), state);
    state = journal.commitTransaction(state);

    expect(state.count).toBe(16);
    expect(journal.canRedo()).toBe(false);
    expect(journal.getState().size).toBe(2);

    // The committed transaction is the only valid redo future.
    state = journal.undo(state);
    expect(state.count).toBe(15);
    state = journal.redo(state);
    expect(state.count).toBe(16);
  });

  it("should enforce maximum history size limits", () => {
    const journal = new CommandJournal({ maxSize: 2 });
    let state = { count: 10 };

    state = journal.execute(new MockCommand(11, 10), state); // 11
    state = journal.execute(new MockCommand(13, 11), state); // 13
    state = journal.execute(new MockCommand(16, 13), state); // 16

    expect(journal.getState().size).toBe(2);
    
    // First command (1) should be evicted; cannot undo past 11
    state = journal.undo(state); // 13
    state = journal.undo(state); // 11 (original state for second command, first command undo is evicted)
    expect(journal.canUndo()).toBe(false);
  });

  it("should coalesce consecutive mergeable commands", () => {
    const journal = new CommandJournal({ enableCoalescing: true, coalescingWindowMs: 1000 });
    let state = { count: 10 };

    const cmd1 = new MockCommand(15, 10, (next) => {
      if (next instanceof MockCommand) {
        return new MockCommand(next.value, 10);
      }
      return null;
    });
    cmd1.timestamp = 1000;

    const cmd2 = new MockCommand(18, 15);
    cmd2.timestamp = 1500; // 500ms diff, fits window

    state = journal.execute(cmd1, state);
    state = journal.execute(cmd2, state);

    expect(state.count).toBe(18);
    expect(journal.getState().size).toBe(1); // Merged into 1 entry

    // Undo should rollback both changes at once
    state = journal.undo(state);
    expect(state.count).toBe(10);
  });

  it("should manage transaction scopes (begin, commit, rollback)", () => {
    const journal = new CommandJournal();
    let state = { count: 10 };

    journal.beginTransaction("Edit Group");
    expect(journal.isTransactionActive()).toBe(true);

    state = journal.execute(new MockCommand(15, 10), state); // 15
    state = journal.execute(new MockCommand(18, 15), state); // 18

    // Commit Transaction
    state = journal.commitTransaction(state);
    expect(journal.isTransactionActive()).toBe(false);
    expect(journal.getState().size).toBe(1); // Wrapped in 1 composite command

    // Undo transaction as a single block
    state = journal.undo(state);
    expect(state.count).toBe(10);

    // Rollback Transaction
    journal.beginTransaction("Failed Edit");
    state = journal.execute(new MockCommand(12, 10), state); // 12
    state = journal.rollbackTransaction(state); // Discards and rolls back changes
    expect(journal.isTransactionActive()).toBe(false);
    expect(state.count).toBe(10);
  });

  it("should support state subscription listeners", () => {
    const journal = new CommandJournal();
    const listener = vi.fn();
    const unsubscribe = journal.subscribe(listener);

    journal.execute(new MockCommand(15, 10), { count: 10 });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    journal.execute(new MockCommand(17, 15), { count: 15 });
    expect(listener).toHaveBeenCalledTimes(1); // No new call
  });
});

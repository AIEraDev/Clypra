/**
 * UpdateTranscriptWordCommand Tests
 *
 * Verifies that:
 * 1. Word text edits update state and increment epoch.
 * 2. Word timings (startMs, endMs) are strictly invariant.
 * 3. invert() correctly generates an undo command.
 * 4. merge() coalesces consecutive keystrokes within 1 second.
 * 5. Full undo/redo cycle functions through historyStore.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { UpdateTranscriptWordCommand } from "../CaptionCommands";
import { useTimelineStore } from "@/store/timelineStore";
import { useHistoryStore } from "@/store/historyStore";
import type { Transcript } from "@/types/captions";

describe("UpdateTranscriptWordCommand", () => {
  const sampleTranscript: Transcript = {
    id: "transcript-cmd-test",
    mediaId: "media-1",
    language: "en",
    text: "hello world",
    words: [
      { id: "w-0", text: "hello", startMs: 100, endMs: 500 },
      { id: "w-1", text: "world", startMs: 550, endMs: 950 },
    ],
    createdAt: 1000,
    updatedAt: 1000,
  };

  beforeEach(() => {
    useTimelineStore.setState({
      transcripts: {
        [sampleTranscript.id]: { ...sampleTranscript },
      },
      epoch: 0,
    });
    useHistoryStore.getState().clear();
  });

  it("applies word edit, increments epoch, and preserves timings", () => {
    const cmd = new UpdateTranscriptWordCommand(
      sampleTranscript.id,
      "w-0",
      "hi",
      "hello",
    );

    const prevState = useTimelineStore.getState();
    const nextState = cmd.apply(prevState);

    expect(nextState.epoch).toBe(prevState.epoch + 1);
    const updatedWord = nextState.transcripts[sampleTranscript.id].words[0];
    expect(updatedWord.text).toBe("hi");
    expect(updatedWord.startMs).toBe(100);
    expect(updatedWord.endMs).toBe(500);
  });

  it("inverts correctly for undo", () => {
    const cmd = new UpdateTranscriptWordCommand(
      sampleTranscript.id,
      "w-1",
      "everyone",
      "world",
    );

    const inverse = cmd.invert();
    expect(inverse).toBeInstanceOf(UpdateTranscriptWordCommand);

    const appliedState = cmd.apply(useTimelineStore.getState());
    const undoneState = inverse.apply(appliedState);

    expect(undoneState.transcripts[sampleTranscript.id].words[1].text).toBe("world");
    expect(undoneState.transcripts[sampleTranscript.id].words[1].startMs).toBe(550);
  });

  it("merges rapid keystrokes on the same word", () => {
    const cmd1 = new UpdateTranscriptWordCommand(
      sampleTranscript.id,
      "w-0",
      "hell",
      "hel",
    );
    const cmd2 = new UpdateTranscriptWordCommand(
      sampleTranscript.id,
      "w-0",
      "hello",
      "hell",
    );

    const merged = cmd1.merge(cmd2);
    expect(merged).not.toBeNull();
    expect((merged as UpdateTranscriptWordCommand).newText).toBe("hello");
    expect((merged as UpdateTranscriptWordCommand).previousText).toBe("hel");
  });

  it("executes through historyStore with working undo and redo", () => {
    const history = useHistoryStore.getState();
    const cmd = new UpdateTranscriptWordCommand(
      sampleTranscript.id,
      "w-0",
      "greetings",
      "hello",
    );

    history.execute(cmd);
    expect(useTimelineStore.getState().transcripts[sampleTranscript.id].words[0].text).toBe("greetings");

    history.undo();
    expect(useTimelineStore.getState().transcripts[sampleTranscript.id].words[0].text).toBe("hello");

    history.redo();
    expect(useTimelineStore.getState().transcripts[sampleTranscript.id].words[0].text).toBe("greetings");
  });
});

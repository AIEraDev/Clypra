/**
 * Transcript Editing & Multi-Clip Synchronization Tests
 *
 * Verifies that:
 * 1. A central Transcript owned in project.transcripts[transcriptId] serves as the
 *    single source of truth for all clips sharing that transcriptId.
 * 2. Editing a word's text in the transcript updates the spoken text without altering
 *    startMs or endMs timings.
 * 3. All clips referencing the transcript immediately reflect text edits without cloning
 *    words or desynchronizing audio-to-caption alignment.
 * 4. Split clips that partition the words maintain clean ownership boundaries.
 */

import { describe, it, expect } from "vitest";
import type { TextClip } from "@/types";
import type { Transcript, TranscriptWord } from "@/types/captions";
import { getWordsForClip, isWordInClipRange } from "@/core/timeline/captionTime";

describe("Transcript Editing & Multi-Clip Synchronization", () => {
  function makeTranscript(): Transcript {
    return {
      id: "transcript-media-1",
      mediaId: "media-1",
      language: "en",
      text: "The quick brown fox jumps over the lazy dog",
      words: [
        { id: "w-0", text: "The", startMs: 0, endMs: 250 },
        { id: "w-1", text: "quick", startMs: 260, endMs: 600 },
        { id: "w-2", text: "brown", startMs: 610, endMs: 950 },
        { id: "w-3", text: "fox", startMs: 960, endMs: 1300 },
        { id: "w-4", text: "jumps", startMs: 1400, endMs: 1850 },
        { id: "w-5", text: "over", startMs: 1860, endMs: 2150 },
        { id: "w-6", text: "the", startMs: 2160, endMs: 2350 },
        { id: "w-7", text: "lazy", startMs: 2360, endMs: 2750 },
        { id: "w-8", text: "dog", startMs: 2760, endMs: 3100 },
      ],
      createdAt: 100000,
      updatedAt: 100000,
    };
  }

  function makeCaptionClips(transcriptId: string): { clipA: TextClip; clipB: TextClip } {
    // Clip A covers 0.0s to 1.35s (words w-0 to w-3)
    const clipA: TextClip = {
      id: "clip-caption-a",
      kind: "text",
      textRole: "caption",
      trackId: "track-captions",
      mediaId: "media-1",
      transcriptId,
      startTime: 0,
      duration: 1.35,
      trimIn: 0,
      trimOut: 1.35,
      speed: 1,
      text: "The quick brown fox",
      fontSize: 48,
      fontFamily: "Inter",
      color: "#ffffff",
      x: 960,
      y: 900,
      width: 800,
      height: 120,
      rotation: 0,
      opacity: 1,
      zIndex: 10,
      align: "center",
      valign: "middle",
      lineHeight: 1.25,
      paddingX: 0,
      paddingY: 0,
    };

    // Clip B covers 1.35s to 3.2s (words w-4 to w-8)
    const clipB: TextClip = {
      id: "clip-caption-b",
      kind: "text",
      textRole: "caption",
      trackId: "track-captions",
      mediaId: "media-1",
      transcriptId,
      startTime: 1.35,
      duration: 1.85,
      trimIn: 1.35,
      trimOut: 3.2,
      speed: 1,
      text: "jumps over the lazy dog",
      fontSize: 48,
      fontFamily: "Inter",
      color: "#ffffff",
      x: 960,
      y: 900,
      width: 800,
      height: 120,
      rotation: 0,
      opacity: 1,
      zIndex: 10,
      align: "center",
      valign: "middle",
      lineHeight: 1.25,
      paddingX: 0,
      paddingY: 0,
    };

    return { clipA, clipB };
  }

  it("propagates word text corrections to referencing clips without altering timings", () => {
    const transcript = makeTranscript();
    const { clipA, clipB } = makeCaptionClips(transcript.id);

    // Initial words for Clip A
    const initialWordsA = getWordsForClip(transcript.words, clipA);
    expect(initialWordsA.map((w) => w.text)).toEqual(["The", "quick", "brown", "fox"]);
    expect(initialWordsA[1].startMs).toBe(260);
    expect(initialWordsA[1].endMs).toBe(600);

    // User corrects word "quick" -> "fast" in the central transcript
    const wordIndex = transcript.words.findIndex((w) => w.id === "w-1");
    expect(wordIndex).toBe(1);

    const originalStartMs = transcript.words[wordIndex].startMs;
    const originalEndMs = transcript.words[wordIndex].endMs;

    transcript.words[wordIndex] = {
      ...transcript.words[wordIndex],
      text: "fast",
    };

    // Verify timings are strictly invariant
    expect(transcript.words[wordIndex].startMs).toBe(originalStartMs);
    expect(transcript.words[wordIndex].endMs).toBe(originalEndMs);

    // Clip A immediately reflects the edited word
    const updatedWordsA = getWordsForClip(transcript.words, clipA);
    expect(updatedWordsA.map((w) => w.text)).toEqual(["The", "fast", "brown", "fox"]);
    expect(updatedWordsA[1].startMs).toBe(originalStartMs);
    expect(updatedWordsA[1].endMs).toBe(originalEndMs);

    // Clip B is completely unaffected
    const wordsB = getWordsForClip(transcript.words, clipB);
    expect(wordsB.map((w) => w.text)).toEqual(["jumps", "over", "the", "lazy", "dog"]);
  });

  it("two duplicate clips sharing the same transcriptId stay synchronized automatically", () => {
    const transcript = makeTranscript();
    const { clipA } = makeCaptionClips(transcript.id);

    // Duplicate clipA (e.g. user duplicated the caption clip or placed it on another timeline track)
    const clipADup: TextClip = {
      ...clipA,
      id: "clip-caption-a-copy",
      trackId: "track-secondary-captions",
    };

    // User edits word "fox" -> "wolf" in the shared transcript
    const foxIndex = transcript.words.findIndex((w) => w.id === "w-3");
    transcript.words[foxIndex] = {
      ...transcript.words[foxIndex],
      text: "wolf",
    };

    const wordsOriginal = getWordsForClip(transcript.words, clipA);
    const wordsCopy = getWordsForClip(transcript.words, clipADup);

    expect(wordsOriginal.map((w) => w.text)).toEqual(["The", "quick", "brown", "wolf"]);
    expect(wordsCopy.map((w) => w.text)).toEqual(["The", "quick", "brown", "wolf"]);

    // Both clips reference the identical word object; zero desync
    expect(wordsOriginal[3]).toBe(wordsCopy[3]);
  });

  it("handles word deletion and insertion in central transcript cleanly", () => {
    const transcript = makeTranscript();
    const { clipA } = makeCaptionClips(transcript.id);

    // Remove word "brown" (index 2)
    transcript.words = transcript.words.filter((w) => w.id !== "w-2");

    const wordsAfterDelete = getWordsForClip(transcript.words, clipA);
    expect(wordsAfterDelete.map((w) => w.text)).toEqual(["The", "quick", "fox"]);

    // Insert an inserted word between "quick" and "fox"
    const insertedWord: TranscriptWord = {
      id: "w-inserted",
      text: "red",
      startMs: 650,
      endMs: 900,
    };
    transcript.words.splice(2, 0, insertedWord);

    const wordsAfterInsert = getWordsForClip(transcript.words, clipA);
    expect(wordsAfterInsert.map((w) => w.text)).toEqual(["The", "quick", "red", "fox"]);
    expect(wordsAfterInsert[2].startMs).toBe(650);
  });
});

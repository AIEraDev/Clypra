/**
 * Smart NLE Caption Segmentation Engine
 *
 * Transforms raw continuous speech token streams / word timestamps into
 * readable, aesthetically balanced subtitle cues matching industry NLE
 * standards (Broadcast / Netflix guidelines or Social / Kinetic word-pop).
 */

import { TICKS_PER_SECOND } from "@/types/captions";

export type CaptionPacingPreset = "standard" | "kinetic" | "phrase";

export interface InputWordTimestamp {
  word: string;
  startMs: number;
  endMs: number;
  probability?: number;
}

export interface SegmentedCaptionWord {
  word: string;
  /** Seconds relative to the parent cue/clip start */
  start: number;
  /** Seconds relative to the parent cue/clip start */
  end: number;
  startMs: number;
  endMs: number;
  probability?: number;
}

export interface SegmentedSubtitleCue {
  id: string;
  startMs: number;
  endMs: number;
  startTicks: number;
  endTicks: number;
  text: string;
  words: SegmentedCaptionWord[];
}

export interface SegmentationOptions {
  preset?: CaptionPacingPreset;
  maxCharsPerLine?: number;
  maxLines?: number;
  maxWordsPerCue?: number;
  maxDurationMs?: number;
  minDurationMs?: number;
  maxGapMs?: number;
}

const PRESET_CONFIGS: Record<CaptionPacingPreset, Required<Omit<SegmentationOptions, "preset">>> = {
  standard: {
    maxCharsPerLine: 38,
    maxLines: 2,
    maxWordsPerCue: 14,
    maxDurationMs: 4500,
    minDurationMs: 800,
    maxGapMs: 350,
  },
  kinetic: {
    maxCharsPerLine: 20,
    maxLines: 1,
    maxWordsPerCue: 3,
    maxDurationMs: 1600,
    minDurationMs: 300,
    maxGapMs: 250,
  },
  phrase: {
    maxCharsPerLine: 30,
    maxLines: 1,
    maxWordsPerCue: 6,
    maxDurationMs: 3000,
    minDurationMs: 500,
    maxGapMs: 300,
  },
};

const SENTENCE_END_REGEX = /[.!?]+$/;
const CLAUSE_END_REGEX = /[,;:\u2014\u2013-]+$/;

/**
 * Converts a continuous array of word timestamps into structured subtitle cues.
 */
export function segmentWordTimestamps(
  words: InputWordTimestamp[],
  options: SegmentationOptions = {},
): SegmentedSubtitleCue[] {
  if (!words || words.length === 0) return [];

  const preset = options.preset || "standard";
  const defaults = PRESET_CONFIGS[preset];
  const config = {
    maxCharsPerLine: options.maxCharsPerLine ?? defaults.maxCharsPerLine,
    maxLines: options.maxLines ?? defaults.maxLines,
    maxWordsPerCue: options.maxWordsPerCue ?? defaults.maxWordsPerCue,
    maxDurationMs: options.maxDurationMs ?? defaults.maxDurationMs,
    minDurationMs: options.minDurationMs ?? defaults.minDurationMs,
    maxGapMs: options.maxGapMs ?? defaults.maxGapMs,
  };

  const cues: SegmentedSubtitleCue[] = [];
  let currentWords: InputWordTimestamp[] = [];
  let cueIndex = 0;

  const flushCue = () => {
    if (currentWords.length === 0) return;

    const firstWord = currentWords[0];
    const lastWord = currentWords[currentWords.length - 1];

    const startMs = firstWord.startMs;
    const rawEndMs = Math.max(lastWord.endMs, startMs + config.minDurationMs);
    const endMs = Math.max(rawEndMs, lastWord.endMs);

    const startTicks = Math.round((startMs / 1000) * TICKS_PER_SECOND);
    const endTicks = Math.round((endMs / 1000) * TICKS_PER_SECOND);

    // Format text and handle line wrapping for multi-line cues
    const text = formatCueText(currentWords, config.maxCharsPerLine, config.maxLines);

    // Build word list relative to cue start (in seconds)
    const cueWords: SegmentedCaptionWord[] = currentWords.map((w) => ({
      word: w.word,
      start: Math.max(0, (w.startMs - startMs) / 1000),
      end: Math.max(0, (w.endMs - startMs) / 1000),
      startMs: w.startMs,
      endMs: w.endMs,
      probability: w.probability,
    }));

    cues.push({
      id: `cue-${Date.now()}-${cueIndex++}`,
      startMs,
      endMs,
      startTicks,
      endTicks,
      text,
      words: cueWords,
    });

    currentWords = [];
  };

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const prevWord = currentWords.length > 0 ? currentWords[currentWords.length - 1] : null;

    if (prevWord) {
      const gap = word.startMs - prevWord.endMs;
      const currentDuration = word.endMs - currentWords[0].startMs;
      const currentWordCount = currentWords.length;
      const currentTotalChars = currentWords.reduce((sum, w) => sum + w.word.length + 1, 0);

      const isSentenceEnd = SENTENCE_END_REGEX.test(prevWord.word.trim());
      const isClauseEnd = CLAUSE_END_REGEX.test(prevWord.word.trim());
      const isGapTooLarge = gap > config.maxGapMs;
      const isDurationExceeded = currentDuration >= config.maxDurationMs;
      const isWordCountExceeded = currentWordCount >= config.maxWordsPerCue;
      const isCharCapacityExceeded =
        currentTotalChars + word.word.length > config.maxCharsPerLine * config.maxLines;

      let shouldSplit = false;

      if (isSentenceEnd) {
        shouldSplit = true;
      } else if (isGapTooLarge) {
        shouldSplit = true;
      } else if (isDurationExceeded || isWordCountExceeded || isCharCapacityExceeded) {
        shouldSplit = true;
      } else if (isClauseEnd && (currentWordCount >= 4 || currentTotalChars >= config.maxCharsPerLine * 0.8)) {
        shouldSplit = true;
      }

      if (shouldSplit) {
        flushCue();
      }
    }

    currentWords.push(word);
  }

  flushCue();
  return cues;
}

/**
 * Formats cue text, inserting natural line breaks when exceeding maxCharsPerLine.
 */
function formatCueText(words: InputWordTimestamp[], maxCharsPerLine: number, maxLines: number): string {
  if (words.length === 0) return "";
  if (maxLines <= 1) {
    return words.map((w) => w.word).join(" ");
  }

  const rawTokens = words.map((w) => w.word);
  const totalLength = rawTokens.reduce((acc, t) => acc + t.length + 1, 0) - 1;

  if (totalLength <= maxCharsPerLine) {
    return rawTokens.join(" ");
  }

  // 2-line balancing: find optimal split point near middle
  const lines: string[] = [];
  let currentLine: string[] = [];
  let currentCount = 0;

  for (let i = 0; i < rawTokens.length; i++) {
    const token = rawTokens[i];
    const wouldExceed = currentCount + token.length + (currentLine.length > 0 ? 1 : 0) > maxCharsPerLine;

    if (wouldExceed && currentLine.length > 0 && lines.length < maxLines - 1) {
      lines.push(currentLine.join(" "));
      currentLine = [token];
      currentCount = token.length;
    } else {
      currentLine.push(token);
      currentCount += token.length + (currentLine.length > 1 ? 1 : 0);
    }
  }

  if (currentLine.length > 0) {
    lines.push(currentLine.join(" "));
  }

  return lines.join("\n");
}

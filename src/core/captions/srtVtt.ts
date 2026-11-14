/**
 * SRT and WebVTT Import & Export with Word Timing Estimation
 *
 * Provides:
 * 1. parseSrtToTranscript(srtText, options)
 * 2. parseVttToTranscript(vttText, options)
 * 3. exportTranscriptToSrt(transcript, options)
 * 4. exportTranscriptToVtt(transcript, options)
 *
 * When word-level timestamps are absent in source subtitles, words are
 * proportionally estimated across the cue duration weighted by character count.
 */

import type { Transcript, TranscriptWord } from "@/types/captions";

export interface SubtitleParseOptions {
  transcriptId?: string;
  mediaId?: string;
  language?: string;
}

export interface SubtitleExportOptions {
  maxWordsPerCue?: number;
  maxCueDurationMs?: number;
}

/**
 * Parses timecodes in both SRT (00:01:23,456) and VTT (00:01:23.456 or 01:23.456) formats to milliseconds.
 */
export function parseSubtitleTimestampMs(raw: string): number {
  const clean = raw.trim().replace(",", ".");
  const parts = clean.split(":");
  if (parts.length === 3) {
    const hours = parseInt(parts[0], 10) || 0;
    const minutes = parseInt(parts[1], 10) || 0;
    const seconds = parseFloat(parts[2]) || 0;
    return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
  } else if (parts.length === 2) {
    const minutes = parseInt(parts[0], 10) || 0;
    const seconds = parseFloat(parts[1]) || 0;
    return Math.round((minutes * 60 + seconds) * 1000);
  }
  return Math.round((parseFloat(clean) || 0) * 1000);
}

/**
 * Formats milliseconds into SRT timecode (00:00:00,000).
 */
export function formatSrtTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const millis = Math.max(0, Math.floor(ms % 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

/**
 * Formats milliseconds into WebVTT timecode (00:00:00.000).
 */
export function formatVttTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const millis = Math.max(0, Math.floor(ms % 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

interface RawSubtitleCue {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
}

function parseRawCues(content: string, isVtt: boolean): RawSubtitleCue[] {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  const rawBlocks = normalized.split(/\n\n+/);
  const cues: RawSubtitleCue[] = [];
  let counter = 1;

  for (const block of rawBlocks) {
    const lines = block.trim().split("\n");
    if (lines.length === 0) continue;

    // Skip WebVTT header blocks
    if (
      isVtt &&
      (lines[0].startsWith("WEBVTT") ||
        lines[0].startsWith("STYLE") ||
        lines[0].startsWith("NOTE"))
    ) {
      continue;
    }

    let timeLineIdx = 0;
    let customId = "";

    if (!lines[0].includes("-->")) {
      customId = lines[0].trim();
      timeLineIdx = 1;
    }

    if (timeLineIdx >= lines.length || !lines[timeLineIdx].includes("-->")) {
      continue;
    }

    const [startRaw, endRaw] = lines[timeLineIdx].split("-->");
    if (!startRaw || !endRaw) continue;

    const startMs = parseSubtitleTimestampMs(startRaw);
    const endMs = parseSubtitleTimestampMs(endRaw.trim().split(" ")[0]);
    const text = lines
      .slice(timeLineIdx + 1)
      .join(" ")
      .replace(/<[^>]*>/g, "") // strip html/formatting tags
      .replace(/\s+/g, " ")
      .trim();

    if (text && endMs > startMs) {
      cues.push({
        id: customId || `cue-${counter++}`,
        startMs,
        endMs,
        text,
      });
    }
  }

  return cues;
}

/**
 * Distributes word timings proportionally across cue duration based on character length.
 */
function estimateWordsForCue(
  cue: RawSubtitleCue,
  startWordIndex: number,
): TranscriptWord[] {
  const rawTokens = cue.text.split(/\s+/).filter(Boolean);
  if (rawTokens.length === 0) return [];

  const totalChars = rawTokens.reduce((sum, token) => sum + token.length, 0);
  const totalDuration = cue.endMs - cue.startMs;
  let currentStart = cue.startMs;

  return rawTokens.map((token, idx) => {
    const isLast = idx === rawTokens.length - 1;
    const proportion = totalChars > 0 ? token.length / totalChars : 1 / rawTokens.length;
    const dur = isLast
      ? Math.max(50, cue.endMs - currentStart)
      : Math.max(50, Math.round(totalDuration * proportion));

    const word: TranscriptWord = {
      id: `w-${startWordIndex + idx}`,
      text: token,
      startMs: currentStart,
      endMs: currentStart + dur,
    };

    currentStart += dur;
    return word;
  });
}

/**
 * Parse an SRT string into a canonical Transcript object with word-level timestamps.
 */
export function parseSrtToTranscript(
  srtContent: string,
  options: SubtitleParseOptions = {},
): Transcript {
  const cues = parseRawCues(srtContent, false);
  const words: TranscriptWord[] = [];
  const fullTextPieces: string[] = [];

  for (const cue of cues) {
    const cueWords = estimateWordsForCue(cue, words.length);
    words.push(...cueWords);
    fullTextPieces.push(cue.text);
  }

  const transcriptId = options.transcriptId || `transcript-${Date.now()}`;

  return {
    id: transcriptId,
    mediaId: options.mediaId || "imported-srt",
    language: options.language || "en",
    text: fullTextPieces.join(" "),
    words,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Parse a WebVTT string into a canonical Transcript object with word-level timestamps.
 */
export function parseVttToTranscript(
  vttContent: string,
  options: SubtitleParseOptions = {},
): Transcript {
  const cues = parseRawCues(vttContent, true);
  const words: TranscriptWord[] = [];
  const fullTextPieces: string[] = [];

  for (const cue of cues) {
    const cueWords = estimateWordsForCue(cue, words.length);
    words.push(...cueWords);
    fullTextPieces.push(cue.text);
  }

  const transcriptId = options.transcriptId || `transcript-${Date.now()}`;

  return {
    id: transcriptId,
    mediaId: options.mediaId || "imported-vtt",
    language: options.language || "en",
    text: fullTextPieces.join(" "),
    words,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Groups words into natural subtitle cue chunks for export.
 */
function groupWordsIntoCues(
  words: TranscriptWord[],
  options: SubtitleExportOptions = {},
): Array<{ startMs: number; endMs: number; text: string }> {
  const maxWords = options.maxWordsPerCue ?? 8;
  const maxDur = options.maxCueDurationMs ?? 4000;
  const cues: Array<{ startMs: number; endMs: number; text: string }> = [];

  if (words.length === 0) return cues;

  let currentChunk: TranscriptWord[] = [];

  for (const word of words) {
    const chunkStart = currentChunk[0]?.startMs ?? word.startMs;
    const chunkDuration = word.endMs - chunkStart;
    const isPunctuationBreak = /[.!?]$/.test(word.text);
    const hasPauseGap =
      currentChunk.length > 0 &&
      word.startMs - currentChunk[currentChunk.length - 1].endMs > 1000;

    currentChunk.push(word);

    if (
      currentChunk.length >= maxWords ||
      chunkDuration >= maxDur ||
      isPunctuationBreak ||
      hasPauseGap
    ) {
      cues.push({
        startMs: currentChunk[0].startMs,
        endMs: currentChunk[currentChunk.length - 1].endMs,
        text: currentChunk.map((w) => w.text).join(" "),
      });
      currentChunk = [];
    }
  }

  if (currentChunk.length > 0) {
    cues.push({
      startMs: currentChunk[0].startMs,
      endMs: currentChunk[currentChunk.length - 1].endMs,
      text: currentChunk.map((w) => w.text).join(" "),
    });
  }

  return cues;
}

/**
 * Exports a canonical Transcript to standard SRT format.
 */
export function exportTranscriptToSrt(
  transcript: Transcript,
  options: SubtitleExportOptions = {},
): string {
  const cues = groupWordsIntoCues(transcript.words, options);
  return cues
    .map((cue, idx) => {
      const cueNumber = idx + 1;
      const startStr = formatSrtTimestamp(cue.startMs);
      const endStr = formatSrtTimestamp(cue.endMs);
      return `${cueNumber}\n${startStr} --> ${endStr}\n${cue.text}\n`;
    })
    .join("\n")
    .trim();
}

/**
 * Exports a canonical Transcript to WebVTT format.
 */
export function exportTranscriptToVtt(
  transcript: Transcript,
  options: SubtitleExportOptions = {},
): string {
  const cues = groupWordsIntoCues(transcript.words, options);
  const body = cues
    .map((cue, idx) => {
      const cueNumber = idx + 1;
      const startStr = formatVttTimestamp(cue.startMs);
      const endStr = formatVttTimestamp(cue.endMs);
      return `${cueNumber}\n${startStr} --> ${endStr}\n${cue.text}\n`;
    })
    .join("\n")
    .trim();

  return `WEBVTT\n\n${body}`.trim();
}

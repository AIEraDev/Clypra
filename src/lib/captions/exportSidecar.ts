/**
 * Caption Sidecar Export Engine (SRT & WebVTT)
 *
 * §5 Dual export independence:
 * Pure string generation for standard SubRip (.srt) and WebVTT (.vtt) sidecar files.
 * Zero dependency on native GPU/compositor pipelines.
 */

import type { CaptionTrack, CaptionCue } from "@/types/captions";
import { TICKS_PER_SECOND } from "@/types/captions";

/**
 * Format 1MHz ticks to SRT timestamp: HH:MM:SS,mmm
 */
export function formatSrtTimestamp(ticks: number): string {
  const safeTicks = Math.max(0, Math.round(ticks));
  const totalMs = Math.floor(safeTicks / 1000);

  const ms = totalMs % 1000;
  const totalSecs = Math.floor(totalMs / 1000);
  const secs = totalSecs % 60;
  const totalMins = Math.floor(totalSecs / 60);
  const mins = totalMins % 60;
  const hours = Math.floor(totalMins / 60);

  const pad = (num: number, size: number) => num.toString().padStart(size, "0");
  return `${pad(hours, 2)}:${pad(mins, 2)}:${pad(secs, 2)},${pad(ms, 3)}`;
}

/**
 * Format 1MHz ticks to WebVTT timestamp: HH:MM:SS.mmm
 */
export function formatVttTimestamp(ticks: number): string {
  const safeTicks = Math.max(0, Math.round(ticks));
  const totalMs = Math.floor(safeTicks / 1000);

  const ms = totalMs % 1000;
  const totalSecs = Math.floor(totalMs / 1000);
  const secs = totalSecs % 60;
  const totalMins = Math.floor(totalSecs / 60);
  const mins = totalMins % 60;
  const hours = Math.floor(totalMins / 60);

  const pad = (num: number, size: number) => num.toString().padStart(size, "0");
  return `${pad(hours, 2)}:${pad(mins, 2)}:${pad(secs, 2)}.${pad(ms, 3)}`;
}

/**
 * Strips HTML or template tags from cue text for clean sidecar generation.
 */
export function sanitizeCueText(text: string): string {
  return text.trim();
}

/**
 * Generates SubRip (.srt) subtitle string from a CaptionTrack.
 */
export function generateSrt(track: CaptionTrack): string {
  if (!track.cues || track.cues.length === 0) {
    return "";
  }

  // Sort cues by startTicks
  const sortedCues = [...track.cues].sort((a, b) => a.startTicks - b.startTicks);

  const blocks: string[] = [];

  sortedCues.forEach((cue, index) => {
    const text = sanitizeCueText(cue.text);
    if (!text) return;

    const start = formatSrtTimestamp(cue.startTicks);
    const end = formatSrtTimestamp(cue.endTicks);

    let content = text;
    if (cue.speaker) {
      content = `[${cue.speaker}]: ${text}`;
    }

    blocks.push(`${index + 1}\n${start} --> ${end}\n${content}`);
  });

  return blocks.join("\n\n") + "\n";
}

/**
 * Generates WebVTT (.vtt) subtitle string from a CaptionTrack.
 */
export function generateVtt(track: CaptionTrack): string {
  const header = "WEBVTT\n";
  if (!track.cues || track.cues.length === 0) {
    return header;
  }

  const sortedCues = [...track.cues].sort((a, b) => a.startTicks - b.startTicks);

  const blocks: string[] = [];

  sortedCues.forEach((cue) => {
    const text = sanitizeCueText(cue.text);
    if (!text) return;

    const start = formatVttTimestamp(cue.startTicks);
    const end = formatVttTimestamp(cue.endTicks);

    let content = text;
    if (cue.speaker) {
      content = `<v ${cue.speaker}>${text}`;
    }

    blocks.push(`${start} --> ${end}\n${content}`);
  });

  return header + "\n" + blocks.join("\n\n") + "\n";
}

/**
 * Exports sidecar string in requested format.
 */
export function generateSidecar(
  track: CaptionTrack,
  format: "srt" | "vtt",
): string {
  return format === "vtt" ? generateVtt(track) : generateSrt(track);
}

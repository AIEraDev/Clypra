/**
 * SMPTE 12M Timecode Engine
 *
 * Implements full broadcast-standard SMPTE timecode:
 * - Drop-Frame (DF) support for 29.97 and 59.94 fps (HH:MM:SS;FF)
 * - Non-Drop-Frame (NDF) support for all rates (HH:MM:SS:FF)
 * - Exact rational time mapping
 * - String parsing with shorthand and relative jump (+/- frames, +/- timecode)
 */

import { getExactRateFraction } from "./rationalTime";

export interface SmpteTimecodeOptions {
  frameRate?: number;
  dropFrame?: boolean;
}

export interface ParsedTimecodeResult {
  success: boolean;
  seconds?: number;
  frames?: number;
  isRelative?: boolean;
  deltaSeconds?: number;
  dropFrame?: boolean;
  error?: string;
}

/**
 * Determines whether a given frame rate defaults to drop-frame in broadcast workflows.
 */
export function isDefaultDropFrameRate(frameRate: number): boolean {
  if (Number.isInteger(frameRate)) return false;
  return Math.abs(frameRate - 29.97) < 0.01 || Math.abs(frameRate - 59.94) < 0.01;
}

/**
 * Normalizes nominal frame rate (e.g. 29.97 -> 30, 23.976 -> 24, 59.94 -> 60).
 */
export function getNominalFps(frameRate: number): number {
  if (Number.isInteger(frameRate)) return frameRate > 0 ? frameRate : 30;
  if (Math.abs(frameRate - 23.976) < 0.01 || Math.abs(frameRate - 23.98) < 0.01) return 24;
  if (Math.abs(frameRate - 29.97) < 0.01) return 30;
  if (Math.abs(frameRate - 59.94) < 0.01) return 60;
  if (Math.abs(frameRate - 119.88) < 0.01) return 120;
  return Math.max(1, Math.round(frameRate));
}

/**
 * Converts a continuous timeline seconds value to integer frame count at a given rate.
 */
export function secondsToFrames(seconds: number, frameRate = 30): number {
  if (!Number.isFinite(seconds) || isNaN(seconds)) return 0;
  const [num, den] = getExactRateFraction(frameRate);
  return Math.round((seconds * num) / den);
}

/**
 * Converts an integer frame count to timeline seconds.
 */
export function framesToSeconds(frames: number, frameRate = 30): number {
  if (!Number.isFinite(frames) || isNaN(frames)) return 0;
  const [num, den] = getExactRateFraction(frameRate);
  return (frames * den) / num;
}

/**
 * Converts integer frame number to SMPTE timecode string.
 */
export function framesToSmpteTimecode(
  frames: number,
  frameRate = 30,
  dropFrame?: boolean,
): string {
  if (!Number.isFinite(frames) || frames < 0 || isNaN(frames)) {
    frames = 0;
  }
  const isDF = dropFrame !== undefined ? dropFrame : isDefaultDropFrameRate(frameRate);
  const nominalFps = getNominalFps(frameRate);

  let adjustedFrames = Math.round(frames);

  if (isDF) {
    if (nominalFps === 30) {
      // 29.97 DF: drop 2 frames every minute except minutes divisible by 10
      const d = Math.floor(adjustedFrames / 17982);
      const m = adjustedFrames % 17982;
      if (m >= 2) {
        adjustedFrames = adjustedFrames + 18 * d + 2 * Math.floor((m - 2) / 1798);
      } else {
        adjustedFrames = adjustedFrames + 18 * d;
      }
    } else if (nominalFps === 60) {
      // 59.94 DF: drop 4 frames every minute except minutes divisible by 10
      const d = Math.floor(adjustedFrames / 35964);
      const m = adjustedFrames % 35964;
      if (m >= 4) {
        adjustedFrames = adjustedFrames + 36 * d + 4 * Math.floor((m - 4) / 3596);
      } else {
        adjustedFrames = adjustedFrames + 36 * d;
      }
    }
  }

  const ff = adjustedFrames % nominalFps;
  const ss = Math.floor(adjustedFrames / nominalFps) % 60;
  const mm = Math.floor(adjustedFrames / (nominalFps * 60)) % 60;
  const hh = Math.floor(adjustedFrames / (nominalFps * 3600));

  const delimiter = isDF ? ";" : ":";
  const hhStr = String(hh).padStart(2, "0");
  const mmStr = String(mm).padStart(2, "0");
  const ssStr = String(ss).padStart(2, "0");
  const ffStr = String(ff).padStart(2, "0");

  return `${hhStr}:${mmStr}:${ssStr}${delimiter}${ffStr}`;
}

/**
 * Converts timeline seconds to standard SMPTE timecode.
 */
export function secondsToSmpteTimecode(
  seconds: number,
  frameRate = 30,
  dropFrame?: boolean,
): string {
  const frames = secondsToFrames(seconds, frameRate);
  return framesToSmpteTimecode(frames, frameRate, dropFrame);
}

/**
 * Converts SMPTE timecode components (HH, MM, SS, FF) to integer frame count.
 */
export function smpteComponentsToFrames(
  hh: number,
  mm: number,
  ss: number,
  ff: number,
  frameRate = 30,
  dropFrame?: boolean,
): number {
  const isDF = dropFrame !== undefined ? dropFrame : isDefaultDropFrameRate(frameRate);
  const nominalFps = getNominalFps(frameRate);

  const totalMinutes = 60 * hh + mm;
  const nominalFrames = (totalMinutes * 60 + ss) * nominalFps + ff;

  if (isDF) {
    if (nominalFps === 30) {
      const dropCount = 2 * (totalMinutes - Math.floor(totalMinutes / 10));
      return Math.max(0, nominalFrames - dropCount);
    } else if (nominalFps === 60) {
      const dropCount = 4 * (totalMinutes - Math.floor(totalMinutes / 10));
      return Math.max(0, nominalFrames - dropCount);
    }
  }

  return Math.max(0, nominalFrames);
}

/**
 * Parses a SMPTE timecode string or relative offset into timeline seconds and frame count.
 * Supports:
 * - Full timecode: "01:23:45:12" or "01:23:45;12"
 * - Shorthand: "23:45:12" (MM:SS:FF) or "45:12" (SS:FF) or "12" (frames)
 * - Digits only: "01234512" (8 digits -> HH:MM:SS:FF) or "234512" (6 digits -> MM:SS:FF)
 * - Relative offsets: "+15", "-30", "+1:00", "-00:02:15"
 */
export function parseSmpteTimecode(
  input: string,
  currentTime = 0,
  frameRate = 30,
  dropFrame?: boolean,
): ParsedTimecodeResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { success: false, error: "Empty timecode input" };
  }

  const isDF = dropFrame !== undefined ? dropFrame : (trimmed.includes(";") || isDefaultDropFrameRate(frameRate));

  // Check for relative +/- prefix
  const isPlus = trimmed.startsWith("+");
  const isMinus = trimmed.startsWith("-");
  const isRelative = isPlus || isMinus;

  const raw = isRelative ? trimmed.slice(1).trim() : trimmed;

  // Pure integer frame offset (e.g. "+15" or "-30" or "100")
  if (/^\d+$/.test(raw)) {
    const num = parseInt(raw, 10);
    // If length is 6 or 8 digits, treat as unpunctuated timecode (HHMMSSFF or MMSSFF)
    if (!isRelative && (raw.length === 6 || raw.length === 8)) {
      const hh = raw.length === 8 ? parseInt(raw.slice(0, 2), 10) : 0;
      const mmIdx = raw.length === 8 ? 2 : 0;
      const mm = parseInt(raw.slice(mmIdx, mmIdx + 2), 10);
      const ss = parseInt(raw.slice(mmIdx + 2, mmIdx + 4), 10);
      const ff = parseInt(raw.slice(mmIdx + 4, mmIdx + 6), 10);

      const frames = smpteComponentsToFrames(hh, mm, ss, ff, frameRate, isDF);
      const seconds = framesToSeconds(frames, frameRate);
      return { success: true, frames, seconds, isRelative: false, dropFrame: isDF };
    }

    if (isRelative) {
      const deltaFrames = isMinus ? -num : num;
      const deltaSeconds = framesToSeconds(deltaFrames, frameRate);
      const targetSeconds = Math.max(0, currentTime + deltaSeconds);
      const targetFrames = secondsToFrames(targetSeconds, frameRate);
      return {
        success: true,
        seconds: targetSeconds,
        frames: targetFrames,
        isRelative: true,
        deltaSeconds,
        dropFrame: isDF,
      };
    } else {
      // Direct frame number jump
      const seconds = framesToSeconds(num, frameRate);
      return { success: true, frames: num, seconds, isRelative: false, dropFrame: isDF };
    }
  }

  // Punctuated timecode (colon or semicolon separated)
  const parts = raw.split(/[:;]/).map((p) => parseInt(p, 10));
  if (parts.some((p) => isNaN(p) || p < 0)) {
    return { success: false, error: `Invalid timecode format: "${input}"` };
  }

  let hh = 0;
  let mm = 0;
  let ss = 0;
  let ff = 0;

  if (parts.length === 4) {
    [hh, mm, ss, ff] = parts;
  } else if (parts.length === 3) {
    [mm, ss, ff] = parts;
  } else if (parts.length === 2) {
    [ss, ff] = parts;
  } else if (parts.length === 1) {
    [ff] = parts;
  } else {
    return { success: false, error: "Too many timecode fields" };
  }

  const frames = smpteComponentsToFrames(hh, mm, ss, ff, frameRate, isDF);
  const seconds = framesToSeconds(frames, frameRate);

  if (isRelative) {
    const deltaSeconds = isMinus ? -seconds : seconds;
    const targetSeconds = Math.max(0, currentTime + deltaSeconds);
    const targetFrames = secondsToFrames(targetSeconds, frameRate);
    return {
      success: true,
      seconds: targetSeconds,
      frames: targetFrames,
      isRelative: true,
      deltaSeconds,
      dropFrame: isDF,
    };
  }

  return { success: true, frames, seconds, isRelative: false, dropFrame: isDF };
}

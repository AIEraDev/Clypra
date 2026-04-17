/**
 * Time formatting utilities for Timeline Engine v1
 */

/**
 * Formats time in seconds to MM:SS or HH:MM:SS format
 * @param seconds - Time in seconds
 * @returns Formatted time string
 */
export function formatTime(seconds: number): string {
  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  // Use HH:MM:SS format for times >= 60 minutes
  if (hours > 0) {
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }

  // Use MM:SS format for times < 60 minutes
  return `${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Formats time with milliseconds (MM:SS.mmm or HH:MM:SS.mmm)
 * @param seconds - Time in seconds
 * @returns Formatted time string with milliseconds
 */
export function formatTimeWithMillis(seconds: number): string {
  const baseTime = formatTime(seconds);
  const millis = Math.round((seconds % 1) * 1000);
  return `${baseTime}.${millis.toString().padStart(3, "0")}`;
}

/**
 * Parses a time string (MM:SS or HH:MM:SS) to seconds
 * @param timeString - Time string to parse
 * @returns Time in seconds, or null if invalid
 */
export function parseTime(timeString: string): number | null {
  const parts = timeString.split(":").map((p) => parseInt(p, 10));

  if (parts.some(isNaN)) {
    return null;
  }

  if (parts.length === 2) {
    // MM:SS format
    const [minutes, seconds] = parts;
    return minutes * 60 + seconds;
  } else if (parts.length === 3) {
    // HH:MM:SS format
    const [hours, minutes, seconds] = parts;
    return hours * 3600 + minutes * 60 + seconds;
  }

  return null;
}

/**
 * Time Formatting Utilities
 *
 * OWNERSHIP: Pure utility functions (no state)
 * PERSISTENCE: Non-persistent (stateless)
 *
 * Single source of truth for all time formatting in the application.
 * Consolidates 5 previous duplicate implementations.
 */

/**
 * Format seconds as MM:SS or HH:MM:SS
 * Used for simple time displays without frame precision
 */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0 || isNaN(seconds)) {
    seconds = 0;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

/**
 * Format seconds as HH:MM:SS:FF (timecode with frames)
 * Used for precise timeline displays
 */
export function formatTimecode(seconds: number, frameRate: number): string {
  if (!Number.isFinite(seconds) || seconds < 0 || isNaN(seconds)) {
    seconds = 0;
  }
  const safeFps = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 30;
  const totalFrames = Math.round(seconds * safeFps);
  const totalSeconds = Math.floor(totalFrames / safeFps);
  const frames = totalFrames % safeFps;

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
}

/**
 * Format seconds as MM:SS.d (with deciseconds)
 * Used for less precise displays
 */
export function formatTimeWithDeciseconds(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${ms}`;
}

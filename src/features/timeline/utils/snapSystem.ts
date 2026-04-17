/**
 * Snap System for Timeline Engine v1
 * Provides magnetic alignment for clips to playhead, other clips, and markers
 */

import type { Clip, SnapTarget } from "../types/core";
import type { CoordinateSystem } from "./coordinateSystem";

export interface SnapSettings {
  playhead: boolean;
  clips: boolean;
  markers: boolean;
}

export class SnapSystem {
  private readonly SNAP_THRESHOLD = 8; // pixels

  constructor(
    private coords: CoordinateSystem,
    private enabled: SnapSettings,
  ) {}

  /**
   * Finds the closest snap target within threshold
   *
   * @param time - Time position to check for snapping
   * @param clips - All clips in the timeline
   * @param playhead - Current playhead position
   * @param markers - Array of marker times
   * @returns Closest snap target or null if none within threshold
   */
  findSnapTarget(time: number, clips: Clip[], playhead: number, markers: number[]): SnapTarget | null {
    const candidates: SnapTarget[] = [];
    const pixelPos = this.coords.timeToPixels(time);

    // Check playhead snap
    if (this.enabled.playhead) {
      const playheadPx = this.coords.timeToPixels(playhead);
      if (Math.abs(pixelPos - playheadPx) <= this.SNAP_THRESHOLD) {
        candidates.push({ time: playhead, type: "playhead" });
      }
    }

    // Check clip edge snaps
    if (this.enabled.clips) {
      for (const clip of clips) {
        const startPx = this.coords.timeToPixels(clip.startTime);
        const endPx = this.coords.timeToPixels(clip.startTime + clip.duration);

        if (Math.abs(pixelPos - startPx) <= this.SNAP_THRESHOLD) {
          candidates.push({
            time: clip.startTime,
            type: "clip-start",
            sourceId: clip.id,
          });
        }

        if (Math.abs(pixelPos - endPx) <= this.SNAP_THRESHOLD) {
          candidates.push({
            time: clip.startTime + clip.duration,
            type: "clip-end",
            sourceId: clip.id,
          });
        }
      }
    }

    // Check marker snaps
    if (this.enabled.markers) {
      for (const markerTime of markers) {
        const markerPx = this.coords.timeToPixels(markerTime);
        if (Math.abs(pixelPos - markerPx) <= this.SNAP_THRESHOLD) {
          candidates.push({ time: markerTime, type: "marker" });
        }
      }
    }

    // Return closest candidate by time distance
    if (candidates.length === 0) return null;

    return candidates.reduce((closest, candidate) => {
      const closestDist = Math.abs(time - closest.time);
      const candidateDist = Math.abs(time - candidate.time);
      return candidateDist < closestDist ? candidate : closest;
    });
  }

  /**
   * Updates snap settings
   */
  setEnabled(settings: Partial<SnapSettings>): void {
    Object.assign(this.enabled, settings);
  }

  /**
   * Gets current snap settings
   */
  getEnabled(): SnapSettings {
    return { ...this.enabled };
  }
}

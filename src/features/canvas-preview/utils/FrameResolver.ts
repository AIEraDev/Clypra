/**
 * FrameResolver - Determines which clips are active at any given timeline position
 */

import type { Clip, Track } from "../../timeline/types/core";
import type { ActiveClip } from "../types/core";

/**
 * FrameResolver determines which clips are active at a given timeline position
 * and calculates the correct clip time for each active clip.
 */
export class FrameResolver {
  private clips: Map<string, Clip>;
  private tracks: Map<string, Track>;

  constructor(clips: Map<string, Clip>, tracks: Map<string, Track>) {
    this.clips = clips;
    this.tracks = tracks;
  }

  /**
   * Get all active clips at the specified timeline position
   *
   * @param timelineTime - The timeline position in seconds
   * @returns Array of active clips sorted by track order (ascending)
   */
  getActiveClips(timelineTime: number): Omit<ActiveClip, "videoElement">[] {
    const activeClips: Omit<ActiveClip, "videoElement">[] = [];

    // Iterate through all clips
    for (const clip of this.clips.values()) {
      // Check if clip is active at this time
      const clipStart = clip.startTime;
      const clipEnd = clip.startTime + clip.duration;

      if (timelineTime >= clipStart && timelineTime < clipEnd) {
        // Get track info
        const track = this.tracks.get(clip.trackId);

        if (!track || !track.visible) {
          continue;
        }

        const clipTime = this.calculateClipTime(clip, timelineTime);

        // Create ActiveClip (without videoElement, which will be added by VideoPool)
        const activeClip: Omit<ActiveClip, "videoElement"> = {
          ...clip,
          trackIndex: track.order,
          clipTime,
        };

        activeClips.push(activeClip);
      }
    }

    activeClips.sort((a, b) => a.trackIndex - b.trackIndex);

    return activeClips;
  }

  /**
   * Calculate the clip time (position within source media) for a given timeline time
   *
   * Formula: clipTime = sourceStart + (timelineTime - startTime)
   *
   * @param clip - The clip to calculate time for
   * @param timelineTime - The timeline position in seconds
   * @returns The clip time clamped to source boundaries
   */
  private calculateClipTime(clip: Clip, timelineTime: number): number {
    const offset = timelineTime - clip.startTime;

    // Apply formula: clipTime = sourceStart + offset
    const clipTime = clip.sourceStart + offset;

    const clampedTime = Math.max(clip.sourceStart, Math.min(clipTime, clip.sourceEnd));

    return Math.max(0, clampedTime);
  }
}

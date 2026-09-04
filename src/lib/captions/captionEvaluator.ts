/**
 * Caption Evaluation Engine (§3 & §5)
 *
 * Evaluates active caption cues at any given tick timestamp on the timeline,
 * cascades track-defaults + per-cue-overrides into effective typography, and
 * produces evaluated layers for native preview and burn-in export.
 */

import type { CaptionTrack, CaptionCue } from "@/types/captions";
import { resolveEffectiveCaptionStyle } from "./captionStyle";
import type { TemplateTextProperties } from "@/features/text-templates/types";

export interface EvaluatedCaptionLayer {
  cueId: string;
  trackId: string;
  text: string;
  startTicks: number;
  endTicks: number;
  style: TemplateTextProperties;
  x: number;
  y: number;
  boxWidth: number;
  boxHeight: number;
}

/**
 * Finds the active caption cue on a track for a given tick timestamp.
 * Returns null if no cue is active or if the track is hidden.
 */
export function getActiveCaptionCue(
  track: CaptionTrack,
  timeTicks: number,
): CaptionCue | null {
  if (!track.visible || !track.cues || track.cues.length === 0) {
    return null;
  }

  // Active condition: startTicks <= timeTicks < endTicks
  return (
    track.cues.find(
      (cue) => timeTicks >= cue.startTicks && timeTicks < cue.endTicks,
    ) ?? null
  );
}

/**
 * Evaluates active captions for a given tick time across all tracks
 * and returns evaluated layers with canonical style resolution.
 */
export function evaluateCaptionsAtTicks(
  captionTracks: CaptionTrack[],
  timeTicks: number,
  canvasWidth = 1920,
  canvasHeight = 1080,
  burnInOption = true,
): EvaluatedCaptionLayer[] {
  if (!burnInOption || !captionTracks || captionTracks.length === 0) {
    return [];
  }

  const results: EvaluatedCaptionLayer[] = [];

  for (const track of captionTracks) {
    if (!track.visible) continue;

    const cue = getActiveCaptionCue(track, timeTicks);
    if (!cue || !cue.text.trim()) continue;

    const style = resolveEffectiveCaptionStyle(track.defaultStyle, cue.styleOverride);

    // Standard caption placement: bottom 15% of frame, centered within 80% title-safe area
    const boxWidth = canvasWidth * 0.8;
    const boxHeight = canvasHeight * 0.15;
    const x = (canvasWidth - boxWidth) / 2;
    const y = canvasHeight * 0.82;

    results.push({
      cueId: cue.id,
      trackId: track.id,
      text: cue.text,
      startTicks: cue.startTicks,
      endTicks: cue.endTicks,
      style,
      x,
      y,
      boxWidth,
      boxHeight,
    });
  }

  return results;
}

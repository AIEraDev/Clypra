import type { Clip, MediaAsset, Project, Track } from "@/types";
import { createClipFromAsset } from "@/lib/timeline/timelineClip";
import { resolveDefaultFitModeForAsset } from "@/lib/timeline/placementPolicy";
import type { ViralCutSuggestion } from "./types";

interface CreateViralCutClipParams {
  suggestion: ViralCutSuggestion;
  asset: MediaAsset;
  trackId: string;
  startTime: number;
  project: Pick<Project, "canvasWidth" | "canvasHeight">;
}

export const createViralCutClip = ({ suggestion, asset, trackId, startTime, project }: CreateViralCutClipParams): Clip => {
  const trimIn = Math.max(0, Math.min(suggestion.start, asset.duration));
  const trimOut = Math.max(trimIn, Math.min(suggestion.end, asset.duration));
  const clip = createClipFromAsset({
    asset,
    trackId,
    startTime,
    width: project.canvasWidth,
    height: project.canvasHeight,
    fitMode: resolveDefaultFitModeForAsset(asset),
  });

  return {
    ...clip,
    trimIn,
    trimOut,
    duration: Math.max(0, trimOut - trimIn),
  };
};

export const findUsableVideoTrack = (tracks: Track[]) => tracks.find((track) => track.type === "video" && !track.locked)?.id ?? null;

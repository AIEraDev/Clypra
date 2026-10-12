import { useCallback, useMemo } from "react";
import { useTimelineStore } from "@/store/timelineStore";
import { useHistoryStore } from "@/store/historyStore";
import { AddClipCommand } from "@/core/history/commands";
import { useProjectStore } from "@/store/projectStore";
import type { Clip, MediaAsset } from "@/types";
import { createClipFromAsset } from "@/lib/timeline/timelineClip";
import { autoAdaptSequenceForFirstVisualClip } from "@/lib/timeline/sequenceAutoAspect";
import {
  DEFAULT_PLACEMENT_POLICY,
  resolveDefaultFitModeForAsset,
} from "@/lib/timeline/placementPolicy";

export const useTimeline = () => {
  const {
    tracks,
    clips,
    zoomLevel,
    scrollLeft,
    pixelsPerSecond,
    setZoom,
    setScrollLeft,
  } = useTimelineStore();
  const { mediaAssets, project, updateProject } = useProjectStore();

  const addClipFromAsset = useCallback(
    (asset: MediaAsset, trackId: string, startTime: number) => {
      if (DEFAULT_PLACEMENT_POLICY.autoAdaptSequenceForFirstVisualClip) {
        autoAdaptSequenceForFirstVisualClip({
          project,
          existingClips: clips,
          asset,
          updateProject,
        });
      }
      const nextProject = useProjectStore.getState().project;

      const clip: Clip = createClipFromAsset({
        asset,
        trackId,
        startTime,
        width: nextProject?.canvasWidth || project?.canvasWidth || 1920,
        height: nextProject?.canvasHeight || project?.canvasHeight || 1080,
        fitMode: resolveDefaultFitModeForAsset(asset),
      });
      useHistoryStore.getState().execute(new AddClipCommand(clip));
    },
    [project, clips, updateProject],
  );

  const getClipsForTrack = useCallback(
    (trackId: string) => {
      return clips.filter((c) => c.trackId === trackId);
    },
    [clips],
  );

  // Wrap in useCallback to stabilize reference identity
  // Without this, Track components re-render on ANY mediaAssets change
  const getMediaAsset = useCallback(
    (mediaId: string) => {
      return mediaAssets.find((a) => a.id === mediaId);
    },
    [mediaAssets],
  );

  return useMemo(
    () => ({
      tracks,
      clips,
      zoomLevel,
      scrollLeft,
      pixelsPerSecond,
      setZoom,
      setScrollLeft,
      addClipFromAsset,
      getClipsForTrack,
      getMediaAsset,
    }),
    [
      tracks,
      clips,
      zoomLevel,
      scrollLeft,
      pixelsPerSecond,
      setZoom,
      setScrollLeft,
      addClipFromAsset,
      getClipsForTrack,
      getMediaAsset,
    ],
  );
};

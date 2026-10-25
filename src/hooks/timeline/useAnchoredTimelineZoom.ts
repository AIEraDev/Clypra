import { useCallback } from "react";
import { getPlaybackClock } from "@/hooks/usePlaybackClock";
import { useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import {
  TIMELINE_CLIP_START_OFFSET_PX,
  getAnchoredZoomScrollLeft,
  getFitSequencePixelsPerSecond,
  getTimelineLaneWidth,
  getTimelineViewportEndForDuration,
  zoomToPixelsPerSecond,
} from "@/lib/timeline/timelineViewport";
import {
  TIMELINE_ZOOM_STEP,
  TIMELINE_ZOOM_GEOMETRIC_FACTOR,
  clampTimelineZoom,
} from "@/lib/timeline/timelineZoom";
import { timelineZoomTelemetry } from "@/lib/timeline/timelineZoomTelemetry";

export type TimelineZoomAnchor = {
  anchorTime: number;
  localTimelineX: number;
};

function getTimelineContainer(): HTMLDivElement | null {
  return document.getElementById(
    "timeline-tracks-container",
  ) as HTMLDivElement | null;
}

function clampTime(time: number, viewportEndSeconds: number): number {
  return Math.max(0, Math.min(time, viewportEndSeconds));
}

export function useAnchoredTimelineZoom() {
  const captureZoomAnchor = useCallback((): TimelineZoomAnchor | null => {
    const state = useTimelineStore.getState();
    if (state.tracks.length === 0 && state.clips.length === 0) return null;
    const container = getTimelineContainer();
    if (!container) return null;

    const hasClips = state.clips.length > 0;
    const oldPps = state.pixelsPerSecond;
    const viewportEndSeconds = getTimelineViewportEndForDuration(
      state.getTimelineEndTime(),
    );
    const laneWidth = getTimelineLaneWidth(container.clientWidth, hasClips);
    const playheadTime = clampTime(getPlaybackClock().time, viewportEndSeconds);
    const playheadLocalX =
      playheadTime * oldPps +
      TIMELINE_CLIP_START_OFFSET_PX -
      container.scrollLeft;

    if (playheadLocalX >= 0 && playheadLocalX <= laneWidth) {
      return {
        anchorTime: playheadTime,
        localTimelineX: playheadLocalX,
      };
    }

    const centerX = laneWidth / 2;
    return {
      anchorTime: clampTime(
        (container.scrollLeft + centerX - TIMELINE_CLIP_START_OFFSET_PX) /
          oldPps,
        viewportEndSeconds,
      ),
      localTimelineX: centerX,
    };
  }, []);

  const applyZoomLevel = useCallback(
    (zoomLevel: number, anchor?: TimelineZoomAnchor | null) => {
      const state = useTimelineStore.getState();
      if (state.tracks.length === 0 && state.clips.length === 0) return;
      const container = getTimelineContainer();
      if (!container) {
        state.setZoom(zoomLevel);
        return;
      }

      const hasClips = state.clips.length > 0;
      const viewportEndSeconds = getTimelineViewportEndForDuration(
        state.getTimelineEndTime(),
      );
      const frameRate = useProjectStore.getState().project?.frameRate ?? 30;
      const nextPps = zoomToPixelsPerSecond(zoomLevel, frameRate);
      const resolvedAnchor = anchor ?? captureZoomAnchor();

      state.setPixelsPerSecond(nextPps);

      if (!resolvedAnchor) return;

      const nextScrollLeft = getAnchoredZoomScrollLeft({
        anchorTime: clampTime(resolvedAnchor.anchorTime, viewportEndSeconds),
        localTimelineX: resolvedAnchor.localTimelineX,
        containerWidth: container.clientWidth,
        viewportEndSeconds,
        nextPixelsPerSecond: nextPps,
        hasClips,
      });

      container.scrollLeft = nextScrollLeft;
      state.setScrollLeft(nextScrollLeft);

      // Check invariant: anchor drift must stay <= 1px
      const resultingX =
        resolvedAnchor.anchorTime * nextPps +
        TIMELINE_CLIP_START_OFFSET_PX -
        nextScrollLeft;
      if (Math.abs(resultingX - resolvedAnchor.localTimelineX) > 1.0) {
        timelineZoomTelemetry.recordInvariant("anchor_drift_gt_1px");
      }
    },
    [captureZoomAnchor],
  );

  const zoomByStep = useCallback(
    (direction: 1 | -1) => {
      const state = useTimelineStore.getState();
      if (state.tracks.length === 0 && state.clips.length === 0) return;
      const anchor = captureZoomAnchor();
      const frameRate = useProjectStore.getState().project?.frameRate ?? 30;
      const nextZoom =
        direction > 0
          ? state.zoomLevel * TIMELINE_ZOOM_GEOMETRIC_FACTOR
          : state.zoomLevel / TIMELINE_ZOOM_GEOMETRIC_FACTOR;
      const clampedZoom = clampTimelineZoom(nextZoom, frameRate);
      const nextPps = zoomToPixelsPerSecond(clampedZoom, frameRate);
      timelineZoomTelemetry.beginGesture("button", state.pixelsPerSecond);
      applyZoomLevel(clampedZoom, anchor);
      timelineZoomTelemetry.endGesture(nextPps);
    },
    [applyZoomLevel, captureZoomAnchor],
  );

  const fitSequence = useCallback(() => {
    const container = getTimelineContainer();
    if (!container) return;
    const state = useTimelineStore.getState();
    if (state.tracks.length === 0 && state.clips.length === 0) return;
    const pixelsPerSecond = getFitSequencePixelsPerSecond(
      container.clientWidth,
      state.getTimelineEndTime(),
      state.clips.length > 0,
    );
    timelineZoomTelemetry.beginGesture("fit", state.pixelsPerSecond);
    state.setPixelsPerSecond(pixelsPerSecond, true);
    container.scrollLeft = 0;
    state.setScrollLeft(0);
    timelineZoomTelemetry.endGesture(pixelsPerSecond);
  }, []);

  return {
    captureZoomAnchor,
    applyZoomLevel,
    zoomByStep,
    fitSequence,
  };
}

import React, { useRef, useEffect, useCallback, useMemo } from "react";
import { Film } from "lucide-react";
import { useTimelineStore } from "@/store/timelineStore";
import { useUIStore } from "@/store/uiStore";
import { GapManager } from "@/lib/timeline/gapManager";
import { EditingActions } from "@/core/interactions";
import { usePreviewMode } from "@/hooks/usePreviewMode";
import { usePlaybackClock, usePlaybackControls, getPlaybackClock } from "@/hooks/usePlaybackClock";
import { getTimelineViewportEnd, getTimelineCanvasDuration } from "@/lib/timeline/timelineClip";
import { useTimelineDrag, useTimelineTauriDrop, useTimelineZoom } from "@/hooks";
import { useRenderRuntime } from "@/hooks/useRenderRuntime";
import { TIMELINE_TRACK_LABEL_WIDTH_PX, getTimelineLabelColumnWidth, getTimelineLaneWidth, getTimelineMaxScrollLeft, timeToPixel } from "@/lib/timeline/timelineViewport";


import { TimelineToolbar } from "./TimelineToolbar";
import { TimelineRuler } from "./TimelineRuler";
import { TrackLabel } from "./TrackLabel";
import { Track } from "./Track";
import { Playhead } from "./Playhead";
import { EmptyTimelineDropZone } from "./EmptyTimelineDropZone";

const SELECT_TRACE = import.meta.env.DEV;
const traceSelect = (...args: unknown[]) => {
  if (!SELECT_TRACE) return;
};

export const Timeline: React.FC = () => {
  const { tracks, clips, pixelsPerSecond, scrollLeft, setScrollLeft, getTimelineEndTime, setViewportWidth, snapGuides } = useTimelineStore();
  const hasClips = clips.length > 0;

  const { previewMode, clearSelection } = useUIStore();
  const { exitSourceMode } = usePreviewMode();
  const clockState = usePlaybackClock();
  const { seek, setDuration } = usePlaybackControls();
  const currentTime = clockState.time;
  const duration = clockState.duration;
  const isPlaying = clockState.state === "playing";
  const containerRef = useRef<HTMLDivElement>(null);
  const wasPlayingRef = useRef(false);
  const runtime = useRenderRuntime();
  const isProgramPreviewActive = previewMode === "program";
  const hasTimelineContent = hasClips || tracks.length > 0;
  const showInactivePreviewOverlay = !isProgramPreviewActive && hasTimelineContent;

  // Consume extracted hooks
  useTimelineZoom(containerRef, hasTimelineContent);
  const { isDraggingOver, isDraggingMedia } = useTimelineTauriDrop(containerRef);
  const { dragState, handleClipDragStart, handleClipDragMove, handleClipDragEnd } = useTimelineDrag(containerRef);

  // Measure container width and observe resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      setViewportWidth(getTimelineLaneWidth(el.clientWidth || 1200, hasClips));
    };
    measure();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }
  }, [hasClips, setViewportWidth]);

  // Attach scroll/pointer listeners to the timeline scroll container
  useEffect(() => {
    const container = containerRef.current;
    if (!runtime || !container) return;
    return runtime.attach(container);
  }, [runtime]);

  // Notify runtime when zoom scale changes
  useEffect(() => {
    if (!runtime) return;
    runtime.notifyZoom(pixelsPerSecond / 100);
  }, [runtime, pixelsPerSecond]);

  // ── Set playback duration based on actual sequence content ──────────────────
  useEffect(() => {
    const sequenceDuration = getTimelineEndTime();
    setDuration(sequenceDuration);
  }, [clips, getTimelineEndTime, setDuration]);

  // ── Clamp playhead to sequence bounds ──────────────────────────────────────
  useEffect(() => {
    if (duration > 0 && currentTime > duration) {
      seek(duration);
    }
  }, [duration, currentTime, seek]);

  // ✅ PERFORMANCE OPTIMIZED: RAF-based auto-scroll with throttled state updates
  const autoScrollRafRef = useRef<number | null>(null);
  const lastScrollStateUpdateRef = useRef(0);
  const SCROLL_STATE_THROTTLE = 100; // Update React state only every 100ms during playback

  // Auto-scroll during playback: viewport tracking
  // SMOOTH-2 fix: read clock inside RAF tick — effect only re-runs on isPlaying/pps/duration change
  useEffect(() => {
    const container = containerRef.current;

    // Cleanup previous RAF loop
    if (autoScrollRafRef.current !== null) {
      cancelAnimationFrame(autoScrollRafRef.current);
      autoScrollRafRef.current = null;
    }

    if (!container || !isPlaying) {
      wasPlayingRef.current = isPlaying;
      return;
    }

    const labelColumnWidth = getTimelineLabelColumnWidth(hasClips);
    const effectiveViewportWidth = container.clientWidth - labelColumnWidth;

    // Bug 1 fix: On play-start transition, if playhead is outside viewport, snap to it
    const justStartedPlaying = !wasPlayingRef.current && isPlaying;
    wasPlayingRef.current = isPlaying;

    if (justStartedPlaying) {
      const playheadX = Math.round(currentTime * pixelsPerSecond);
      const leftEdge = container.scrollLeft;
      const rightEdge = leftEdge + effectiveViewportWidth;
      const canvasDuration = getTimelineCanvasDuration(duration);
      const maxScrollLeft = getTimelineMaxScrollLeft(container.clientWidth, canvasDuration, pixelsPerSecond, hasClips);

      if (playheadX < leftEdge || playheadX > rightEdge) {
        // Place playhead at 15% from left edge ("look-ahead" position)
        const centered = Math.max(0, playheadX - effectiveViewportWidth * 0.15);
        const newScrollLeft = Math.min(centered, maxScrollLeft);
        container.scrollLeft = newScrollLeft;
        setScrollLeft(newScrollLeft);
      }
    }

    // ✅ RAF loop for smooth auto-scroll (no state updates every frame)
    const autoScroll = () => {
      if (!isPlaying || !container) return;

      const now = performance.now();
      // SMOOTH-2: Read live clock inside tick instead of closing over stale currentTime
      const liveTime = getPlaybackClock().time;
      const playheadX = Math.round(liveTime * pixelsPerSecond);
      const canvasDuration = getTimelineCanvasDuration(duration);
      const maxScrollLeft = getTimelineMaxScrollLeft(container.clientWidth, canvasDuration, pixelsPerSecond, hasClips);
      let newScrollLeft = container.scrollLeft;

      const isAtAbsoluteEnd = liveTime >= duration - 0.01;

      if (isAtAbsoluteEnd) {
        newScrollLeft = maxScrollLeft;
      } else {
        const bufferPx = effectiveViewportWidth * 0.1;
        const rightEdge = newScrollLeft + effectiveViewportWidth;

        if (playheadX >= rightEdge - bufferPx) {
          newScrollLeft = playheadX;
        }

        const currentRightEdge = newScrollLeft + effectiveViewportWidth;
        if (playheadX > currentRightEdge) {
          newScrollLeft = Math.min(playheadX, maxScrollLeft);
        }
      }

      newScrollLeft = Math.max(0, Math.min(newScrollLeft, maxScrollLeft));

      const epsilon = 2; // px
      if (maxScrollLeft - newScrollLeft < epsilon) {
        newScrollLeft = maxScrollLeft;
      }

      // Always update DOM directly (smooth visual scroll)
      if (Math.abs(container.scrollLeft - newScrollLeft) > 0.5) {
        container.scrollLeft = newScrollLeft;

        // Throttled React state update (reduce re-renders)
        if (now - lastScrollStateUpdateRef.current >= SCROLL_STATE_THROTTLE) {
          setScrollLeft(newScrollLeft);
          lastScrollStateUpdateRef.current = now;
        }
      }

      autoScrollRafRef.current = requestAnimationFrame(autoScroll);
    };

    autoScrollRafRef.current = requestAnimationFrame(autoScroll);

    return () => {
      if (autoScrollRafRef.current !== null) {
        cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = null;
      }
    };
  }, [pixelsPerSecond, isPlaying, duration, setScrollLeft, hasClips]);

  // Handle keyboard shortcuts for timeline operations
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Ignore if typing in input/textarea
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }

      const uiState = useUIStore.getState();
      const store = useTimelineStore.getState();
      // Delete/Backspace: Remove selected clips or gaps
      if (e.key === "Delete" || e.key === "Backspace") {
        const { selectedClipIds, selectedGapId } = uiState;

        // Delete selected gap
        if (selectedGapId) {
          e.preventDefault();
          const gap = store.gaps.find((g) => g.id === selectedGapId);
          if (gap && !gap.protected) {
            GapManager.removeGap(selectedGapId);
            uiState.clearSelection();
          }
          return;
        }

        // Delete selected clips
        if (selectedClipIds.length === 0) return;
        e.preventDefault();

        EditingActions.deleteSelection(selectedClipIds, e.altKey);
        return;
      }

      // I key: Insert gap at playhead
      if (e.key === "i" || e.key === "I") {
        e.preventDefault();

        const { selectedTrackId } = uiState;
        const trackId = selectedTrackId || tracks[0]?.id;

        if (!trackId) return;

        // Insert 2-second gap at playhead position
        const gapDuration = 2.0;
        GapManager.insertGap(trackId, currentTime, gapDuration);
        return;
      }

      // Comma (,): Remove gap at playhead (ripple delete)
      if (e.key === ",") {
        e.preventDefault();

        const { selectedTrackId, selectedGapId } = uiState;

        // If gap is selected, remove it
        if (selectedGapId) {
          const gap = store.gaps.find((g) => g.id === selectedGapId);
          if (gap && !gap.protected) {
            GapManager.removeGap(selectedGapId);
            uiState.clearSelection();
          }
          return;
        }

        // Otherwise, find gap at playhead on selected track
        const trackId = selectedTrackId || tracks[0]?.id;
        if (!trackId) return;

        const gapAtPlayhead = GapManager.getGapAtPosition(trackId, currentTime);

        if (gapAtPlayhead && !gapAtPlayhead.protected) {
          GapManager.removeGap(gapAtPlayhead.id);
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [tracks, currentTime]);

  const handleTimelinePointerDownCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 && event.pointerType === "mouse") return;
      if (dragState?.draggingClipId) return;
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-timeline-interactive="true"]')) return;
      traceSelect("timeline pointerdown -> clearSelection", {
        target: target.tagName,
        className: target.className,
        selectedBefore: useUIStore.getState().selectedClipIds,
      });
      useUIStore.getState().clearSelection();
    },
    [dragState],
  );

  // A source preview can leave the shared playback clock with a duration,
  // but that is not timeline content. Keep the empty timeline on its own
  // canonical ruler range so the ruler/zoom never inherit source duration.
  const contentEnd = hasClips ? duration : 0;
  const canvasDuration = getTimelineCanvasDuration(contentEnd);
  const contentWidth = Math.round(canvasDuration * pixelsPerSecond);

  const seekFromPointer = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (target.closest('[data-timeline-interactive="true"]')) return;
      // Don't seek when clicking on track labels (sticky left column)
      if (target.closest("[data-track-label]")) return;

      clearSelection();

      if (previewMode === "source") {
        exitSourceMode(); // Auto-switches transport context
      }

      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const labelColumnWidth = getTimelineLabelColumnWidth(hasClips);
      const x = event.clientX - rect.left - labelColumnWidth + container.scrollLeft;
      const time = Math.max(0, Math.min(x / pixelsPerSecond, duration));
      seek(time);
    },
    [duration, pixelsPerSecond, seek, previewMode, exitSourceMode, clearSelection, hasClips],
  );

  // Simple scroll handler — no cross-container sync needed
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollLeft(e.currentTarget.scrollLeft);
  };

  return (
    <div
      data-preview-mode={previewMode}
      className="h-full min-h-0 flex flex-col select-none relative"
      style={{ backgroundColor: "var(--color-timeline-bg)" }}
    >
      <TimelineToolbar />

      {showInactivePreviewOverlay && (
        <div
          data-testid="timeline-program-inactive-overlay"
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-10 bottom-0 z-[170] bg-gray-500/25"
        />
      )}

      {hasClips && <div className="absolute top-[40px] left-0 right-0 bottom-0 bg-(--color-timeline-ruler-bg)" style={{ zIndex: 120, width: `${TIMELINE_TRACK_LABEL_WIDTH_PX}px`, minWidth: `${TIMELINE_TRACK_LABEL_WIDTH_PX}px` }}></div>}

      <div className="flex-1 min-h-0 overflow-hidden">
        {/* ── Single scroll container with CSS Grid ─────────────────────── */}
        <div
          ref={containerRef}
          onScroll={handleScroll}
          onPointerDownCapture={handleTimelinePointerDownCapture}
          onClick={seekFromPointer}
          id="timeline-tracks-container"
          className={`h-full overflow-auto scrollbar-thin relative transition-colors ${isDraggingOver ? "bg-cyan-500/10 ring-2 ring-cyan-500/50 ring-inset" : ""}`}
          style={{
            display: "grid",
            gridTemplateColumns: hasClips ? `${TIMELINE_TRACK_LABEL_WIDTH_PX}px 1fr` : "1fr",
            gridTemplateRows: hasTimelineContent ? (hasClips ? "auto 1fr" : "24px minmax(0, 1fr)") : "minmax(0, 1fr)",
            alignContent: hasClips ? "start" : "stretch",
            scrollbarWidth: "none",
            rowGap: 0,
          }}
        >
          {/* ── Row 1: Header + Ruler (both sticky top) ──────────────── */}
          {hasClips && (
            <div
              className="panel-head flex items-center px-3 shrink-0"
              style={{
                position: "sticky",
                top: 0,
                left: 0,
                zIndex: 150,
                height: "24px",
                width: `${TIMELINE_TRACK_LABEL_WIDTH_PX}px`,
                minWidth: `${TIMELINE_TRACK_LABEL_WIDTH_PX}px`,
                background: "var(--color-timeline-track-bg)",
                borderBottom: "1px solid var(--color-timeline-track-border)",
                borderRight: "1px solid var(--color-timeline-track-border)",
              }}
            >
              <span className="text-[11px] font-semibold tracking-wide text-timeline-track-label uppercase">Track</span>
            </div>
          )}

          {hasTimelineContent && (
            <div
              className="bg-timeline-bg overflow-hidden"
              style={{
                position: "sticky",
                top: 0,
                zIndex: 20,
                height: "24px",
                width: `${contentWidth}px`,
                borderBottom: "1px solid var(--color-timeline-track-border)",
              }}
            >
              <TimelineRuler pixelsPerSecond={pixelsPerSecond} scrollLeft={scrollLeft} sequenceDuration={contentEnd} />
            </div>
          )}


          {/* ── Row 2+: Track labels (sticky left) + Track clips ─────── */}
          {!hasClips ? (
            <div className="relative flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className="relative flex h-full items-center px-8 py-8 md:px-16">
                <div
                  className={`flex h-32 w-full items-center gap-5 rounded-xl border border-dashed px-10 transition-colors ${isDraggingMedia ? "border-accent/70 bg-accent/10" : "border-white/15 bg-white/[0.015]"}`}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center text-text-muted">
                    <Film className="h-7 w-7" strokeWidth={1.5} />
                  </div>
                  <span className="text-lg font-medium tracking-tight text-text-primary/90">Drag material here and start to create</span>
                </div>
              </div>
              <EmptyTimelineDropZone isDragging={isDraggingMedia} />
            </div>
          ) : (
            <>
              {/* Sub-grid wrapper: centers tracks vertically in remaining space */}
              <div
                style={{
                  gridColumn: "1 / -1",
                  display: "grid",
                  gridTemplateColumns: `${TIMELINE_TRACK_LABEL_WIDTH_PX}px 1fr`,
                  alignContent: "center",
                  rowGap: 0,
                }}
              >
                {dragState?.willCreateNewTrack && dragState?.newTrackPosition === "above" && (
                  <div
                    className="pointer-events-none z-50"
                    style={{
                      gridColumn: "1 / -1",
                      height: "2px",
                      background: "var(--color-timeline-drop-indicator)",
                      boxShadow: "0 0 8px var(--color-timeline-drop-indicator)",
                    }}
                  />
                )}

                {tracks.map((track) => {
                  // FIX: Filter clips per track to avoid passing entire clips array
                  // This prevents tracks from re-rendering when clips on OTHER tracks change
                  const trackClips = clips.filter((c) => c.trackId === track.id);

                  // FIX: Memoize dragState prop to prevent inline object creation
                  // Inline object literals break React.memo even when values are unchanged
                  const trackDragState = dragState
                    ? {
                        draggingClipId: dragState.draggingClipId,
                        draggedClipIds: dragState.draggedClipIds,
                        offsetX: dragState.offsetX,
                        offsetY: dragState.offsetY,
                        isInvalidPosition: dragState.isInvalidPosition,
                        targetTrackId: dragState.targetTrackId,
                        placementPreview: dragState.placementPreview,
                        draggedBlockDuration: dragState.draggedBlockDuration,
                        originalPlacements: dragState.originalPlacements,
                      }
                    : undefined;

                  return (
                    <React.Fragment key={track.id}>
                      {/* LEFT: Track label — sticky left, scrolls vertically with clips */}
                      <TrackLabel track={track} />

                      {/* RIGHT: Track clips — scrolls both directions */}
                      <div
                        className="relative mb-0"
                        style={{
                          width: `${contentWidth}px`,
                          height: `${track.height}px`,
                        }}
                      >
                        <Track track={track} pixelsPerSecond={pixelsPerSecond} clips={trackClips} onClipDragStart={handleClipDragStart} onClipDragMove={handleClipDragMove} onClipDragEnd={handleClipDragEnd} dragState={trackDragState} />
                      </div>

                      {/* Between-track indicator */}
                      {dragState?.willCreateNewTrack && dragState?.newTrackPosition === "between" && dragState?.betweenTrackIds?.aboveId === track.id && (
                        <div
                          className="relative pointer-events-none z-50 flex items-center justify-center"
                          style={{
                            gridColumn: "1 / -1",
                            height: "4px",
                            marginTop: "-2px",
                            marginBottom: "-2px",
                          }}
                        >
                          <div
                            className="absolute inset-0"
                            style={{
                              background: `linear-gradient(90deg, transparent, var(--color-timeline-drop-indicator) 10%, var(--color-timeline-drop-indicator) 90%, transparent)`,
                              boxShadow: "0 0 12px var(--color-timeline-drop-indicator)",
                            }}
                          />
                          <div
                            className="relative text-xs font-medium px-3 py-1 rounded-full text-white"
                            style={{
                              background: "var(--color-timeline-drop-indicator)",
                              boxShadow: "0 2px 8px rgba(0, 0, 0, 0.3)",
                            }}
                          >
                            Create New Track
                          </div>
                        </div>
                      )}
                    </React.Fragment>
                  );
                })}

                {dragState?.willCreateNewTrack && dragState?.newTrackPosition === "below" && (
                  <div
                    className="pointer-events-none z-50"
                    style={{
                      gridColumn: "1 / -1",
                      height: "2px",
                      background: "var(--color-timeline-drop-indicator)",
                      boxShadow: "0 0 8px var(--color-timeline-drop-indicator)",
                    }}
                  />
                )}
              </div>

              {/* Playhead spans the visible viewport (clips area only) */}
              <div
                className="pointer-events-none absolute"
                style={{
                  top: 0,
                  left: hasClips ? `${TIMELINE_TRACK_LABEL_WIDTH_PX}px` : "0px",
                  bottom: 0,
                  width: `${contentWidth}px`,
                  zIndex: 100,
                }}
              >
                <Playhead pixelsPerSecond={pixelsPerSecond} duration={duration} containerRef={containerRef} />
              </div>

              {/* Sequence End Line across track area */}
              {contentEnd > 0 && (
                <div
                  className="pointer-events-none absolute top-0 bottom-0 z-40"
                  style={{
                    left: `${getTimelineLabelColumnWidth(hasClips) + timeToPixel(contentEnd, pixelsPerSecond)}px`,
                    width: "2px",
                    background: "rgba(239, 68, 68, 0.4)",
                    borderRight: "1px dashed rgba(239, 68, 68, 0.7)",
                  }}
                />
              )}

              {/* Snap Guides - Vertical alignment indicators */}

              {snapGuides.map((guide, index) => {
                const guideLeft = guide.time * pixelsPerSecond + getTimelineLabelColumnWidth(hasClips);
                const guideColor = guide.type === "playhead" ? "var(--color-timeline-drop-indicator)" : "var(--color-snap-guide-clip)";

                return (
                  <div
                    key={`snap-guide-${index}-${guide.time}`}
                    className="absolute top-0 bottom-0 pointer-events-none z-60"
                    style={{
                      left: `${guideLeft}px`,
                      width: "2px",
                      background: guideColor,
                      boxShadow: `0 0 8px ${guideColor}`,
                    }}
                  />
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

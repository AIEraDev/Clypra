import React, { useRef, useEffect, useCallback } from "react";
import { useTimelineStore } from "@/store/timelineStore";
import { useUIStore } from "@/store/uiStore";
import { useHistoryStore } from "@/store/historyStore";
import { RippleDeleteCommand } from "@/core/history/commands/RippleDeleteCommand";
import { DeleteClipCommand } from "@/core/history/commands/DeleteClipCommand";
import { GapManager } from "@/lib/timeline/gapManager";
import { usePreviewMode } from "@/hooks/usePreviewMode";
import { usePlaybackClock, usePlaybackControls } from "@/hooks/usePlaybackClock";
import { getTimelineViewportEnd } from "@/lib/timeline/timelineClip";
import { useTimelineDrag } from "@/hooks/useTimelineDrag";
import { useTimelineTauriDrop } from "@/hooks/useTimelineTauriDrop";
import { useTimelineZoom } from "@/hooks/useTimelineZoom";
import { useRenderRuntime } from "@/hooks/useRenderRuntime";
import { TIMELINE_TRACK_LABEL_WIDTH_PX, getTimelineLabelColumnWidth, getTimelineLaneWidth } from "@/lib/timeline/timelineViewport";

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

  // Consume extracted hooks
  useTimelineZoom(containerRef);
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
      const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);

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
      const playheadX = Math.round(currentTime * pixelsPerSecond);
      const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);
      let newScrollLeft = container.scrollLeft;

      const isAtAbsoluteEnd = currentTime >= duration - 0.01;

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
  }, [currentTime, pixelsPerSecond, isPlaying, duration, setScrollLeft, hasClips]);

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
      const { execute, beginTransaction, commitTransaction } = useHistoryStore.getState();
      const rippleEnabled = store.rippleEditEnabled;

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

        const { normalizeTrack, removeEmptyNonMainTracks, withBatch } = store;
        const affectedTracks = new Set<string>();

        beginTransaction("Delete Clips");

        selectedClipIds.forEach((clipId) => {
          const clip = store.clips.find((c) => c.id === clipId);
          if (clip) {
            affectedTracks.add(clip.trackId);
            // Use ripple delete if ripple mode is enabled, otherwise regular delete
            if (rippleEnabled) {
              execute(new RippleDeleteCommand(clipId));
            } else {
              execute(new DeleteClipCommand(clipId));
            }
          }
        });

        commitTransaction();

        withBatch(() => {
          removeEmptyNonMainTracks(Array.from(affectedTracks));
        });

        uiState.clearSelection();
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
      if (event.button !== 0) return;
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

  const contentEnd = duration;
  const viewportEnd = getTimelineViewportEnd(contentEnd);
  const contentWidth = Math.round(viewportEnd * pixelsPerSecond);

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
    <div className="h-60 md:h-80 flex flex-col select-none relative" style={{ backgroundColor: "var(--color-timeline-bg)" }}>
      <TimelineToolbar />

      {hasClips && <div className="absolute top-[40px] left-0 right-0 bottom-0 bg-(--color-timeline-ruler-bg)" style={{ zIndex: 120, width: `${TIMELINE_TRACK_LABEL_WIDTH_PX}px`, minWidth: `${TIMELINE_TRACK_LABEL_WIDTH_PX}px` }}></div>}

      <div className="flex-1 overflow-hidden">
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
            gridTemplateRows: hasClips ? "auto 1fr" : undefined,
            alignContent: "start",
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

          <div
            className="bg-timeline-bg"
            style={{
              position: "sticky",
              top: 0,
              zIndex: 20,
              height: "24px",
              width: `${contentWidth}px`,
              borderBottom: "1px solid var(--color-timeline-track-border)",
            }}
          >
            <TimelineRuler pixelsPerSecond={pixelsPerSecond} scrollLeft={scrollLeft} />
          </div>

          {/* ── Row 2+: Track labels (sticky left) + Track clips ─────── */}
          {!hasClips ? (
            <div className="relative flex-1 flex flex-col min-h-0">
              <div className="absolute top-1/2 left-3 text-xl text-white pointer-events-none font-mono">Drop media here • I to import</div>
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

                {tracks.map((track) => (
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
                      <Track
                        track={track}
                        pixelsPerSecond={pixelsPerSecond}
                        clips={clips}
                        onClipDragStart={handleClipDragStart}
                        onClipDragMove={handleClipDragMove}
                        onClipDragEnd={handleClipDragEnd}
                        dragState={
                          dragState
                            ? {
                                draggingClipId: dragState.draggingClipId,
                                draggedClipIds: dragState.draggedClipIds,
                                offsetX: dragState.offsetX,
                                offsetY: dragState.offsetY,
                                isInvalidPosition: dragState.isInvalidPosition,
                                targetTrackId: dragState.targetTrackId,
                                placementPreview: dragState.placementPreview,
                                draggedBlockDuration: dragState.draggedBlockDuration,
                              }
                            : undefined
                        }
                      />
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
                ))}

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

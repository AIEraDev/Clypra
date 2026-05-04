import React, { useRef, useEffect, useState, useCallback, RefObject } from "react";
import { FolderOpen } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { TimelineToolbar } from "./TimelineToolbar";
import { TimelineRuler } from "./TimelineRuler";
import { TrackList } from "./TrackList";
import { Track } from "./Track";
import { Playhead } from "./Playhead";
import { useTimelineStore, getInsertIndexForNewTrack } from "../../../store/timelineStore";
import { useProjectStore } from "../../../store/projectStore";
import { useUIStore } from "../../../store/uiStore";
import { usePlayback } from "../../../hooks/usePlayback";
import { useTimelineAutoScroll } from "../../../hooks/useTimelineAutoScroll";
import type { VideoMetadata } from "../../../types";
import { createClipFromAsset } from "../../../lib/timelineClip";

/** Map viewport Y to a track using each row's DOM rect (ruler / flex centering safe). */
function resolveTrackAtClientY(
  container: HTMLElement,
  tracks: Array<{ id: string }>,
  clientY: number,
): { targetTrackId: string | null; willCreateNewTrack: boolean; newTrackPosition: "above" | "below" | null } {
  if (tracks.length === 0) {
    return { targetTrackId: null, willCreateNewTrack: true, newTrackPosition: "below" };
  }

  const rects: { id: string; top: number; bottom: number }[] = [];
  for (const track of tracks) {
    const row = container.querySelector<HTMLElement>(`[data-track-id="${track.id}"]`);
    if (!row) continue;
    const r = row.getBoundingClientRect();
    rects.push({ id: track.id, top: r.top, bottom: r.bottom });
  }

  if (rects.length === 0) {
    return { targetTrackId: null, willCreateNewTrack: false, newTrackPosition: null };
  }

  const firstTop = Math.min(...rects.map((x) => x.top));
  const lastBottom = Math.max(...rects.map((x) => x.bottom));

  if (clientY < firstTop) {
    return { targetTrackId: null, willCreateNewTrack: true, newTrackPosition: "above" };
  }
  if (clientY >= lastBottom) {
    return { targetTrackId: null, willCreateNewTrack: true, newTrackPosition: "below" };
  }

  for (const track of tracks) {
    const row = container.querySelector<HTMLElement>(`[data-track-id="${track.id}"]`);
    if (!row) continue;
    const r = row.getBoundingClientRect();
    if (clientY >= r.top && clientY < r.bottom) {
      return { targetTrackId: track.id, willCreateNewTrack: false, newTrackPosition: null };
    }
  }

  let bestId: string | null = null;
  let bestDist = Infinity;
  for (const rect of rects) {
    const mid = (rect.top + rect.bottom) / 2;
    const d = Math.abs(clientY - mid);
    if (d < bestDist) {
      bestDist = d;
      bestId = rect.id;
    }
  }
  return { targetTrackId: bestId, willCreateNewTrack: false, newTrackPosition: null };
}

export const Timeline: React.FC = () => {
  const { tracks, clips, pixelsPerSecond, scrollLeft, setScrollLeft, getTimelineEndTime, addClip, addTrack, insertTrackAt, insertClipAtIndex, getTrackClips, updateClip, normalizeTrack } = useTimelineStore();

  console.log("[TIMELINE] 🎬 Timeline render", {
    tracksCount: tracks.length,
    clipsCount: clips.length,
    clips: clips.map((c) => ({ id: c.id, trackId: c.trackId })),
  });

  const { mediaAssets, addMediaAsset } = useProjectStore();
  const { previewMode, exitSourceMode } = useUIStore();
  const { currentTime, duration, isPlaying, seek, setDuration } = usePlayback();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const isProcessingDropRef = useRef(false);

  // Pointer-based drag state with gap engine
  const [dragState, setDragState] = useState<{
    draggingClipId: string | null;
    offsetX: number;
    offsetY: number;
    /** Pointer X in timeline content space at drag start (handles horizontal scroll). */
    pointerXContentStart: number;
    /** Pointer Y in viewport at drag start (pairs with translateY in track space). */
    pointerClientYStart: number;
    /** Keeps ghost X aligned after moving dragged clip to tail in store (px). */
    visualLeftAnchorDelta: number;
    originalTrackId: string;
    originalIndex: number;
    originalStartTime: number; // Keep for ESC cancel
    // Gap engine state
    targetTrackId: string | null;
    insertionIndex: number | null;
    gapStartTime: number | null;
    gapDuration: number | null;
    isInvalidPosition?: boolean; // For visual feedback
    // New track creation
    willCreateNewTrack?: boolean;
    newTrackPosition?: "above" | "below" | null;
  } | null>(null);

  const dragStateRef = useRef(dragState);
  dragStateRef.current = dragState;

  // Handle clip drag with gap engine
  const handleClipDragStart = useCallback(
    (clipId: string, startX: number, startY: number) => {
      const clip = clips.find((c) => c.id === clipId);
      if (!clip) return;

      // Find clip's index in its track
      const trackClips = getTrackClips(clip.trackId);
      const originalIndex = trackClips.findIndex((c) => c.id === clipId);

      console.log("[TIMELINE] 🚀 Clip drag start", {
        clipId,
        originalIndex,
        trackId: clip.trackId,
      });

      // Pack other clips to t=0.. — then move dragged clip to tail so it never shares startTime with siblings (avoids overlap in store).
      const pps = useTimelineStore.getState().pixelsPerSecond;
      const originalLeftPx = Math.round(clip.startTime * pps);

      const otherClips = trackClips.filter((c) => c.id !== clipId);
      let currentTime = 0;
      otherClips.forEach((c) => {
        updateClip(c.id, { startTime: currentTime });
        currentTime += c.duration;
      });

      const tailTime = currentTime;
      updateClip(clipId, { startTime: tailTime });
      const leftNewPx = Math.round(tailTime * pps);
      const visualLeftAnchorDelta = originalLeftPx - leftNewPx;

      const container = containerRef.current;
      let pointerXContentStart = startX;
      const pointerClientYStart = startY;
      if (container) {
        const cr = container.getBoundingClientRect();
        pointerXContentStart = startX - cr.left + container.scrollLeft;
      }

      const nextDragState = {
        draggingClipId: clipId,
        offsetX: visualLeftAnchorDelta,
        offsetY: 0,
        pointerXContentStart,
        pointerClientYStart,
        visualLeftAnchorDelta,
        originalTrackId: clip.trackId,
        originalIndex,
        originalStartTime: clip.startTime,
        targetTrackId: null as string | null,
        insertionIndex: null as number | null,
        gapStartTime: null as number | null,
        gapDuration: null as number | null,
        isInvalidPosition: false,
        willCreateNewTrack: false,
        newTrackPosition: null as "above" | "below" | null,
      };
      dragStateRef.current = nextDragState;
      setDragState(nextDragState);
    },
    [clips, getTrackClips, updateClip],
  );

  const handleClipDragMove = useCallback((clipId: string, _deltaX: number, _deltaY: number, clientX: number, clientY: number) => {
    const ds = dragStateRef.current;
    if (!ds || ds.draggingClipId !== clipId) return;

    const container = containerRef.current;
    if (!container) return;

    const cr = container.getBoundingClientRect();
    const pointerXContent = clientX - cr.left + container.scrollLeft;
    const contentDeltaPx = pointerXContent - ds.pointerXContentStart;
    const offsetX = contentDeltaPx + ds.visualLeftAnchorDelta;
    const offsetY = clientY - ds.pointerClientYStart;

    const { clips: liveClips, tracks: liveTracks, getTrackClips, pixelsPerSecond: pps } = useTimelineStore.getState();
    const clip = liveClips.find((c) => c.id === clipId);
    if (!clip) return;

    const { targetTrackId, willCreateNewTrack, newTrackPosition } = resolveTrackAtClientY(container, liveTracks, clientY);

    // If creating new track, show indicator and skip gap calculation
    if (willCreateNewTrack) {
      setDragState((prev) => {
        if (!prev) {
          dragStateRef.current = null;
          return null;
        }
        const next = {
          ...prev,
          offsetX,
          offsetY,
          isInvalidPosition: false,
          targetTrackId: null,
          insertionIndex: null,
          gapStartTime: null,
          gapDuration: null,
          willCreateNewTrack: true,
          newTrackPosition,
        };
        dragStateRef.current = next;
        return next;
      });
      return;
    }

    // Check if target track is locked
    const targetTrack = liveTracks.find((t) => t.id === targetTrackId);
    const isInvalidPosition = targetTrack?.locked || false;

    if (isInvalidPosition) {
      setDragState((prev) => {
        if (!prev) {
          dragStateRef.current = null;
          return null;
        }
        const next = {
          ...prev,
          offsetX,
          offsetY,
          isInvalidPosition,
          targetTrackId: null,
          insertionIndex: null,
          gapStartTime: null,
          gapDuration: null,
          willCreateNewTrack: false,
          newTrackPosition: null,
        };
        dragStateRef.current = next;
        return next;
      });
      return;
    }

    if (!targetTrackId) {
      setDragState((prev) => {
        if (!prev) {
          dragStateRef.current = null;
          return null;
        }
        const next = { ...prev, offsetX, offsetY };
        dragStateRef.current = next;
        return next;
      });
      return;
    }

    const containerRect = cr;
    const trackClips = getTrackClips(targetTrackId).filter((c) => c.id !== clipId);
    const pointerX = clientX - containerRect.left + container.scrollLeft;

    let insertionIndex = 0;
    let accumulatedX = 0;

    for (let i = 0; i < trackClips.length; i++) {
      const clipWidth = trackClips[i].duration * pps;
      const clipMidpoint = accumulatedX + clipWidth / 2;

      if (pointerX < clipMidpoint) {
        insertionIndex = i;
        break;
      }

      accumulatedX += clipWidth;
      insertionIndex = i + 1;
    }

    let gapStartTime = 0;
    for (let i = 0; i < insertionIndex; i++) {
      if (i < trackClips.length) {
        gapStartTime += trackClips[i].duration;
      }
    }

    console.log("[TIMELINE] 📍 Gap engine", {
      targetTrackId,
      insertionIndex,
      gapStartTime,
      clipDuration: clip.duration,
    });

    setDragState((prev) => {
      if (!prev) {
        dragStateRef.current = null;
        return null;
      }
      const next = {
        ...prev,
        offsetX,
        offsetY,
        isInvalidPosition: false,
        targetTrackId,
        insertionIndex,
        gapStartTime,
        gapDuration: clip.duration,
        willCreateNewTrack: false,
        newTrackPosition: null,
      };
      dragStateRef.current = next;
      return next;
    });
  }, []);

  const handleClipDragEnd = useCallback(
    (clipId: string) => {
      const dragSnapshot = dragStateRef.current;
      if (!dragSnapshot) return;

      console.log("[TIMELINE] 🏁 Clip drag end", {
        clipId,
        insertionIndex: dragSnapshot.insertionIndex,
        targetTrackId: dragSnapshot.targetTrackId,
        willCreateNewTrack: dragSnapshot.willCreateNewTrack,
        newTrackPosition: dragSnapshot.newTrackPosition,
      });

      const clip = useTimelineStore.getState().clips.find((c) => c.id === clipId);
      if (!clip) {
        dragStateRef.current = null;
        setDragState(null);
        return;
      }

      // Handle new track creation (ordered: video at top, audio after first video track)
      if (dragSnapshot.willCreateNewTrack && dragSnapshot.newTrackPosition) {
        const mediaAsset = useProjectStore.getState().mediaAssets.find((a) => a.id === clip.mediaId);
        const trackType = mediaAsset?.type === "audio" ? "audio" : "video";

        const store = useTimelineStore.getState();
        const insertIndex = getInsertIndexForNewTrack(store.tracks, trackType);
        const newTrackId = store.insertTrackAt(trackType, insertIndex);
        insertClipAtIndex(clipId, newTrackId, 0);

        dragStateRef.current = null;
        setDragState(null);
        return;
      }

      if (dragSnapshot.targetTrackId && dragSnapshot.insertionIndex !== null) {
        insertClipAtIndex(clipId, dragSnapshot.targetTrackId, dragSnapshot.insertionIndex);
      } else {
        const pps = useTimelineStore.getState().pixelsPerSecond;
        const anchor = dragSnapshot.visualLeftAnchorDelta ?? 0;
        const deltaTime = (dragSnapshot.offsetX - anchor) / pps;
        const newStartTime = Math.max(0, dragSnapshot.originalStartTime + deltaTime);

        updateClip(clipId, {
          startTime: newStartTime,
          trackId: clip.trackId,
        });
        normalizeTrack(clip.trackId);
      }

      dragStateRef.current = null;
      setDragState(null);
    },
    [insertClipAtIndex, updateClip, insertTrackAt, normalizeTrack],
  );

  // Handle ESC key to cancel drag
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const ds = dragStateRef.current;
      if (!ds) return;

      console.log("[TIMELINE] ⚠️ Drag cancelled with ESC", { clipId: ds.draggingClipId });

      if (ds.draggingClipId) {
        const clip = useTimelineStore.getState().clips.find((c) => c.id === ds.draggingClipId);
        if (clip) {
          insertClipAtIndex(ds.draggingClipId, ds.originalTrackId, ds.originalIndex);
        }
      }

      dragStateRef.current = null;
      setDragState(null);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [insertClipAtIndex]);

  // ✅ Ensure content width uses same rounding as all other pixel calculations
  const contentWidth = Math.max(1000, Math.round(duration * pixelsPerSecond));

  const seekFromPointer = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      console.log(target);
      if (target.closest('[data-timeline-interactive="true"]')) return;

      // Exit source mode when clicking on timeline
      if (previewMode === "source") {
        exitSourceMode();
      }

      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const x = event.clientX - rect.left + container.scrollLeft;
      const time = Math.max(0, Math.min(x / pixelsPerSecond, duration));
      seek(time);
    },
    [duration, pixelsPerSecond, seek, previewMode, exitSourceMode],
  );

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    setScrollLeft(target.scrollLeft);
  };

  useEffect(() => {
    const timelineEnd = getTimelineEndTime();
    setDuration(Math.max(timelineEnd, 10));
  }, [clips, getTimelineEndTime, setDuration]);

  // Auto-scroll during playback: bulletproof viewport tracking with strict invariants
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ✅ 1. Use DOM truth for all measurements
    const viewportWidth = container.clientWidth;
    const contentWidthActual = container.scrollWidth;
    const maxScrollLeft = Math.max(0, contentWidthActual - viewportWidth);

    // ✅ 2. Derive playhead position in pixel space ONLY (single source of truth)
    const playheadX = Math.round(currentTime * pixelsPerSecond);

    // ✅ 3. Get current scroll position
    let newScrollLeft = container.scrollLeft;

    // ✅ 4. CRITICAL: When playhead is at the absolute end, force scroll to max
    // This handles the case where playback stops (isPlaying becomes false) at the end
    const isAtAbsoluteEnd = currentTime >= duration - 0.01; // Within 10ms of end

    if (isAtAbsoluteEnd) {
      // Force scroll to absolute maximum when at the end
      newScrollLeft = maxScrollLeft;
    } else if (isPlaying) {
      // ✅ 5. Jump logic during playback: when playhead reaches 90% of viewport, jump forward
      const bufferPx = viewportWidth * 0.1;
      const rightEdge = newScrollLeft + viewportWidth;

      if (playheadX >= rightEdge - bufferPx) {
        // Jump viewport so playhead appears at left edge
        newScrollLeft = playheadX;
      }

      // ✅ 6. Enforce visibility invariant during playback: playhead must always be visible
      const currentRightEdge = newScrollLeft + viewportWidth;
      if (playheadX > currentRightEdge) {
        newScrollLeft = Math.min(playheadX, maxScrollLeft);
      }
    }

    // ✅ 7. HARD CLAMP to valid scroll range
    newScrollLeft = Math.max(0, Math.min(newScrollLeft, maxScrollLeft));

    // ✅ 8. Snap to end if within epsilon (eliminate ghost gap)
    const epsilon = 2; // px
    if (maxScrollLeft - newScrollLeft < epsilon) {
      newScrollLeft = maxScrollLeft;
    }

    // 🔍 Debug logging - ENABLED to diagnose remaining gap
    if (currentTime > duration - 2) {
      console.log("[Timeline Scroll Debug]", {
        currentTime: currentTime.toFixed(2),
        duration: duration.toFixed(2),
        isAtAbsoluteEnd,
        playheadX,
        scrollLeft: container.scrollLeft,
        newScrollLeft,
        viewportWidth,
        contentWidthActual,
        contentWidthComputed: contentWidth,
        maxScrollLeft,
        gap: maxScrollLeft - newScrollLeft,
        pixelsPerSecond,
        isPlaying,
      });
    }

    // ✅ 9. Apply scroll if changed (avoid unnecessary updates)
    if (Math.abs(container.scrollLeft - newScrollLeft) > 0.5) {
      container.scrollLeft = newScrollLeft;
      setScrollLeft(newScrollLeft);
    }
  }, [currentTime, pixelsPerSecond, isPlaying, contentWidth, duration]);

  const getMediaType = (path: string): "video" | "audio" | "image" => {
    const lower = path.toLowerCase();
    if (/\.(mp4|mov|avi|mkv|webm|flv)$/i.test(lower)) return "video";
    if (/\.(mp3|wav|aac|flac|m4a)$/i.test(lower)) return "audio";
    return "image";
  };

  const handleTauriFileDrop = useCallback(
    async (paths: string[]) => {
      const dropTime = getTimelineEndTime();

      for (const filePath of paths) {
        try {
          const filename = filePath.split("/").pop() || filePath.split("\\").pop() || "Unknown";
          const type = getMediaType(filename);

          // Check if asset already exists
          let asset = mediaAssets.find((a) => a.path === filePath);

          if (!asset) {
            // Import new asset
            if (type === "video" || type === "audio") {
              const metadata: VideoMetadata = await invoke("get_video_metadata", { path: filePath });
              const posterFrame: string | undefined = type === "video" ? ((await invoke("extract_poster_frame", { path: filePath, time: 0.0 }).catch(() => undefined)) as string | undefined) : undefined;

              asset = {
                id: `asset-${Date.now()}-${Math.random()}`,
                name: filename,
                path: filePath,
                type,
                duration: metadata.duration,
                width: metadata.width,
                height: metadata.height,
                posterFrame,
                size: metadata.size,
              };
            } else {
              asset = {
                id: `asset-${Date.now()}-${Math.random()}`,
                name: filename,
                path: filePath,
                type: "image" as const,
                duration: 0,
                size: 0,
                posterFrame: convertFileSrc(filePath),
              };
            }

            addMediaAsset(asset);
          }

          // Add clip to timeline at end
          const targetTrackType = asset.type === "audio" ? "audio" : "video";
          let targetTrack = tracks.find((t) => t.type === targetTrackType && !t.locked);

          // If no track exists for this type, create one
          if (!targetTrack) {
            addTrack(targetTrackType);
            // Get the newly created track
            targetTrack = useTimelineStore.getState().tracks.find((t) => t.type === targetTrackType && !t.locked);
          }

          if (targetTrack) {
            const newClip = createClipFromAsset({
              asset,
              trackId: targetTrack.id,
              startTime: dropTime,
              width: useProjectStore.getState().project?.canvasWidth || 1920,
              height: useProjectStore.getState().project?.canvasHeight || 1080,
            });

            addClip(newClip);
          }
        } catch (error) {
          console.error(`[Timeline] Failed to import ${filePath}:`, error);
        }
      }
    },
    [mediaAssets, addMediaAsset, tracks, getTimelineEndTime, addClip, addTrack],
  );

  // Listen for drag events and handle file drops
  useEffect(() => {
    let unlistenHover: (() => void) | undefined;
    let unlistenDrop: (() => void) | undefined;
    let unlistenCancel: (() => void) | undefined;

    const setupListener = async () => {
      try {
        // Listen for drag over
        unlistenHover = await listen<{ position: { x: number; y: number } }>("tauri://drag-over", (event) => {
          if (!containerRef.current) return;

          const rect = containerRef.current.getBoundingClientRect();
          const { x, y } = event.payload.position;

          // Check if mouse is over this container
          const isOver = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
          setIsDraggingOver(isOver);
        });

        // Listen for drop and process files
        unlistenDrop = await listen<{
          paths: string[];
          position: { x: number; y: number };
        }>("tauri://drag-drop", async (event) => {
          setIsDraggingOver(false);

          if (!containerRef.current || isProcessingDropRef.current) {
            return;
          }

          const rect = containerRef.current.getBoundingClientRect();
          const { x, y } = event.payload.position;

          // Check if dropped over this container
          const isOver = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

          if (isOver) {
            isProcessingDropRef.current = true;
            try {
              await handleTauriFileDrop(event.payload.paths);
            } finally {
              isProcessingDropRef.current = false;
            }
          }
        });

        // Listen for drag cancelled
        unlistenCancel = await listen("tauri://drag-cancelled", () => {
          setIsDraggingOver(false);
        });
      } catch (error) {
        console.error("[Timeline] Failed to setup drag listeners:", error);
      }
    };

    setupListener();

    return () => {
      // Clean up listeners safely
      if (unlistenHover) {
        try {
          unlistenHover();
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      if (unlistenDrop) {
        try {
          unlistenDrop();
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      if (unlistenCancel) {
        try {
          unlistenCancel();
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    };
  }, [handleTauriFileDrop]);

  return (
    <div className="h-80 flex flex-col select-none bg-[#141920]">
      <TimelineToolbar />

      <div className="flex-1 flex overflow-hidden">
        <TrackList />

        <div ref={containerRef} onScroll={handleScroll} onClick={seekFromPointer} id="timeline-tracks-container" className={`flex-1 overflow-x-auto overflow-y-auto scrollbar-thin px-1 relative transition-colors border-l border-[#2b3442] ${isDraggingOver ? "bg-cyan-500/10 ring-2 ring-cyan-500/50 ring-inset" : ""}`}>
          {clips.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex items-center gap-3 text-[#6b7280] pointer-events-none">
                <FolderOpen className="w-5 h-5" />
                <span className="text-sm">Drag material here and start to create</span>
              </div>
            </div>
          )}

          <div
            style={{
              width: `${contentWidth}px`,
              minHeight: "100%",
            }}
            className="relative flex flex-col justify-center"
          >
            <TimelineRuler pixelsPerSecond={pixelsPerSecond} scrollLeft={scrollLeft} />

            <div className="relative flex-1 flex flex-col justify-center min-h-0">
              {/* New track indicator - above all tracks */}
              {dragState?.willCreateNewTrack && dragState?.newTrackPosition === "above" && (
                <div
                  className="absolute left-0 right-0 pointer-events-none z-50"
                  style={{
                    top: 0,
                    height: "2px",
                    background: "#3b82f6",
                    boxShadow: "0 0 8px rgba(59, 130, 246, 0.6)",
                  }}
                />
              )}

              {tracks.map((track, index) => (
                <React.Fragment key={track.id}>
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
                            offsetX: dragState.offsetX,
                            offsetY: dragState.offsetY,
                            isInvalidPosition: dragState.isInvalidPosition,
                            targetTrackId: dragState.targetTrackId,
                            insertionIndex: dragState.insertionIndex,
                            gapStartTime: dragState.gapStartTime,
                            gapDuration: dragState.gapDuration,
                          }
                        : undefined
                    }
                  />
                </React.Fragment>
              ))}

              {/* New track indicator - below all tracks */}
              {dragState?.willCreateNewTrack && dragState?.newTrackPosition === "below" && (
                <div
                  className="absolute left-0 right-0 pointer-events-none z-50"
                  style={{
                    bottom: 0,
                    height: "2px",
                    background: "#3b82f6",
                    boxShadow: "0 0 8px rgba(59, 130, 246, 0.6)",
                  }}
                />
              )}

              <Playhead pixelsPerSecond={pixelsPerSecond} duration={duration} containerRef={containerRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

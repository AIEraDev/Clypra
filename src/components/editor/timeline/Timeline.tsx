import React, { useRef, useEffect, useState, useCallback, RefObject } from "react";
import { FolderOpen } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
// @ts-ignore - react-dnd types issue
import { useDragLayer } from "react-dnd";
import { TimelineToolbar } from "./TimelineToolbar";
import { TimelineRuler } from "./TimelineRuler";
import { TrackList } from "./TrackList";
import { Track } from "./Track";
import { Playhead } from "./Playhead";
import { GhostTrack } from "./GhostTrack";
import { EmptyTimelineDropZone } from "./EmptyTimelineDropZone";
import { useTimelineStore } from "../../../store/timelineStore";
import { useProjectStore } from "../../../store/projectStore";
import { useUIStore } from "../../../store/uiStore";
import { usePlayback } from "../../../hooks/usePlayback";
import { useTimelineAutoScroll } from "../../../hooks/useTimelineAutoScroll";
import type { VideoMetadata } from "../../../types";
import { createClipFromAsset } from "../../../lib/timelineClip";

export const Timeline: React.FC = () => {
  const { tracks, clips, pixelsPerSecond, scrollLeft, setScrollLeft, getTimelineEndTime, addClip, addTrack } = useTimelineStore();
  const { mediaAssets, addMediaAsset } = useProjectStore();
  const { previewMode, exitSourceMode } = useUIStore();
  const { currentTime, duration, isPlaying, seek, setDuration } = usePlayback();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const isProcessingDropRef = useRef(false);

  // Detect if something is being dragged (only show ghost zones for MEDIA_ASSET)
  const { isDragging, itemType } = useDragLayer((monitor: any) => ({
    isDragging: monitor.isDragging(),
    itemType: monitor.getItemType(),
  }));

  // Only show ghost zones when dragging media assets, not clips
  const showGhostZones = isDragging && itemType === "MEDIA_ASSET";

  // Use new auto-scroll hook
  useTimelineAutoScroll(containerRef as RefObject<HTMLDivElement>);

  const contentWidth = Math.max(1000, duration * pixelsPerSecond);

  const seekFromPointer = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
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
    // Only auto-scroll when actually playing
    if (!isPlaying) return;

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

    // ✅ 4. Jump logic: when playhead reaches 90% of viewport, jump forward
    const bufferPx = viewportWidth * 0.1;
    const rightEdge = newScrollLeft + viewportWidth;

    if (playheadX >= rightEdge - bufferPx) {
      // Jump viewport so playhead appears at left edge
      newScrollLeft = playheadX;
    }

    // ✅ 5. HARD CLAMP to valid scroll range
    newScrollLeft = Math.max(0, Math.min(newScrollLeft, maxScrollLeft));

    // ✅ 6. Snap to end if within epsilon (eliminate ghost gap)
    const epsilon = 2; // px
    if (maxScrollLeft - newScrollLeft < epsilon) {
      newScrollLeft = maxScrollLeft;
    }

    // ✅ 7. Enforce visibility invariant: playhead must always be visible
    const currentRightEdge = newScrollLeft + viewportWidth;
    if (playheadX > currentRightEdge) {
      newScrollLeft = Math.min(playheadX, maxScrollLeft);
    }

    // 🔍 Debug logging (uncomment to diagnose issues)
    // if (currentTime > duration - 2) {
    //   console.log('[Timeline Scroll Debug]', {
    //     currentTime: currentTime.toFixed(2),
    //     playheadX,
    //     scrollLeft: container.scrollLeft,
    //     newScrollLeft,
    //     viewportWidth,
    //     contentWidthActual,
    //     contentWidthComputed: contentWidth,
    //     maxScrollLeft,
    //     gap: maxScrollLeft - newScrollLeft,
    //     pixelsPerSecond,
    //   });
    // }

    // ✅ 8. Apply scroll if changed (avoid unnecessary updates)
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
              {/* Ghost track above all tracks - only for media assets */}
              <GhostTrack insertIndex={0} isDragging={showGhostZones} />

              {tracks.map((track, index) => (
                <React.Fragment key={track.id}>
                  <Track track={track} pixelsPerSecond={pixelsPerSecond} clips={clips} />
                  {/* Ghost track between tracks - only for media assets */}
                  <GhostTrack insertIndex={index + 1} isDragging={showGhostZones} />
                </React.Fragment>
              ))}

              {/* Empty space below all tracks - only for media assets */}
              <EmptyTimelineDropZone isDragging={showGhostZones} />

              <Playhead pixelsPerSecond={pixelsPerSecond} duration={duration} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

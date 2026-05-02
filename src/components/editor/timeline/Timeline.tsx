import React, { useRef, useEffect, useState, useCallback } from "react";
import { FolderOpen } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { TimelineToolbar } from "./TimelineToolbar";
import { TimelineRuler } from "./TimelineRuler";
import { TrackList } from "./TrackList";
import { Track } from "./Track";
import { Playhead } from "./Playhead";
import { useTimelineStore } from "../../../store/timelineStore";
import { useProjectStore } from "../../../store/projectStore";
import { usePlayback } from "../../../hooks/usePlayback";
import type { VideoMetadata, Clip } from "../../../types";

export const Timeline: React.FC = () => {
  const { tracks, clips, pixelsPerSecond, scrollLeft, setScrollLeft, getTimelineEndTime, addClip, addTrack } = useTimelineStore();
  const { mediaAssets, addMediaAsset } = useProjectStore();
  const { currentTime, duration, seek, setDuration } = usePlayback();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const isProcessingDropRef = useRef(false);

  const contentWidth = Math.max(1000, duration * pixelsPerSecond);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    setScrollLeft(target.scrollLeft);
  };

  useEffect(() => {
    const timelineEnd = getTimelineEndTime();
    setDuration(Math.max(timelineEnd, 10));
  }, [clips, getTimelineEndTime, setDuration]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const playheadX = currentTime * pixelsPerSecond;
    const containerWidth = container.clientWidth;
    const scrollPadding = 100;

    if (playheadX < scrollLeft + scrollPadding) {
      setScrollLeft(Math.max(0, playheadX - scrollPadding));
    } else if (playheadX > scrollLeft + containerWidth - scrollPadding) {
      setScrollLeft(Math.min(playheadX - containerWidth + scrollPadding, contentWidth - containerWidth));
    }
  }, [currentTime, pixelsPerSecond, scrollLeft, setScrollLeft, contentWidth]);

  const getMediaType = (path: string): "video" | "audio" | "image" => {
    const lower = path.toLowerCase();
    if (/\.(mp4|mov|avi|mkv|webm|flv)$/i.test(lower)) return "video";
    if (/\.(mp3|wav|aac|flac|m4a)$/i.test(lower)) return "audio";
    return "image";
  };

  const handleTauriFileDrop = useCallback(
    async (paths: string[]) => {
      console.log("[Timeline] Processing dropped files:", paths);

      const dropTime = getTimelineEndTime();

      for (const filePath of paths) {
        try {
          const filename = filePath.split("/").pop() || filePath.split("\\").pop() || "Unknown";
          const type = getMediaType(filename);

          console.log("[Timeline] Processing file:", filename, "type:", type);

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
                duration: 5, // Default 5 seconds for images
                size: 0,
                posterFrame: convertFileSrc(filePath),
              };
            }

            console.log("[Timeline] Adding new asset to media library:", asset);
            addMediaAsset(asset);
          }

          // Add clip to timeline at end
          const targetTrackType = asset.type === "audio" ? "audio" : "video";
          let targetTrack = tracks.find((t) => t.type === targetTrackType);

          // If no track exists for this type, create one
          if (!targetTrack) {
            console.log("[Timeline] No track found for type:", targetTrackType, "- creating one");
            addTrack(targetTrackType);
            // Get the newly created track
            targetTrack = useTimelineStore.getState().tracks.find((t) => t.type === targetTrackType);
          }

          if (targetTrack) {
            const newClip: Clip = {
              id: `clip-${Date.now()}-${Math.random()}`,
              trackId: targetTrack.id,
              mediaId: asset.id,
              startTime: dropTime,
              duration: asset.duration,
              trimIn: 0,
              trimOut: asset.duration,
              x: 0,
              y: 0,
              width: asset.width || 1920,
              height: asset.height || 1080,
              opacity: 1,
              rotation: 0,
            };

            console.log("[Timeline] Adding clip to track:", targetTrack.id, "at time:", dropTime);
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
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      try {
        console.log("[Timeline] Setting up drag listeners");

        // Listen for drag over
        const unlistenHover = await listen<{ position: { x: number; y: number } }>("tauri://drag-over", (event) => {
          console.log("[Timeline] Drag over event received", event.payload.position);
          if (!containerRef.current) return;

          const rect = containerRef.current.getBoundingClientRect();
          const { x, y } = event.payload.position;

          // Check if mouse is over this container
          const isOver = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
          console.log("[Timeline] isOver:", isOver, "rect:", rect, "mouse:", { x, y });
          setIsDraggingOver(isOver);
        });

        // Listen for drop and process files
        const unlistenDrop = await listen<{
          paths: string[];
          position: { x: number; y: number };
        }>("tauri://drag-drop", async (event) => {
          setIsDraggingOver(false);

          if (!containerRef.current || isProcessingDropRef.current) {
            console.log("[Timeline] Drop ignored - already processing or no container");
            return;
          }

          const rect = containerRef.current.getBoundingClientRect();
          const { x, y } = event.payload.position;

          // Check if dropped over this container
          const isOver = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

          console.log("[Timeline] Drop detected, isOver:", isOver, "position:", { x, y }, "rect:", rect);

          if (isOver) {
            isProcessingDropRef.current = true;
            console.log("[Timeline] Processing drop...");
            try {
              await handleTauriFileDrop(event.payload.paths);
            } finally {
              isProcessingDropRef.current = false;
              console.log("[Timeline] Drop processing complete");
            }
          }
        });

        // Listen for drag cancelled
        const unlistenCancel = await listen("tauri://drag-cancelled", () => {
          console.log("[Timeline] Drag cancelled");
          setIsDraggingOver(false);
        });

        unlisten = () => {
          unlistenHover();
          unlistenDrop();
          unlistenCancel();
        };
      } catch (error) {
        console.error("[Timeline] Failed to setup drag listeners:", error);
      }
    };

    setupListener();

    return () => {
      if (unlisten) {
        console.log("[Timeline] Cleaning up drag listeners");
        unlisten();
      }
    };
  }, [handleTauriFileDrop]);

  return (
    <div className="h-80 flex flex-col select-none">
      <TimelineToolbar />

      <div className="flex-1 flex overflow-hidden">
        <TrackList />

        <div ref={containerRef} onScroll={handleScroll} className={`flex-1 overflow-x-auto overflow-y-auto scrollbar-thin px-1 relative transition-colors ${isDraggingOver ? "bg-cyan-500/10 ring-2 ring-cyan-500/50 ring-inset" : ""}`}>
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
            <TimelineRuler pixelsPerSecond={pixelsPerSecond} scrollLeft={scrollLeft} onSeek={seek} />

            <div className="relative flex-1 flex flex-col justify-center min-h-0">
              {tracks.map((track) => (
                <Track key={track.id} track={track} pixelsPerSecond={pixelsPerSecond} clips={clips} />
              ))}

              <Playhead pixelsPerSecond={pixelsPerSecond} duration={duration} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

import { useState, useEffect, useCallback, useRef, RefObject } from "react";
import { useDragLayer } from "react-dnd";
import { listen } from "@tauri-apps/api/event";
import { useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import { generateId } from "@/lib/utils/id";
import { createClipFromAsset } from "@/lib/timeline/timelineClip";
import { autoAdaptSequenceForFirstVisualClip } from "@/lib/sequence/sequenceAutoAspect";
import { DEFAULT_PLACEMENT_POLICY, resolveClipStartTime, resolvePreferredTrackId, resolveTargetTrackType } from "@/lib/timeline/placementPolicy";
import { platform, type VideoMetadata } from "@/core/platform";

const getMediaType = (path: string): "video" | "audio" | "image" => {
  const lower = path.toLowerCase();
  if (/\.(mp4|mov|mkv|webm|flv)$/i.test(lower)) return "video";
  if (/\.(mp3|wav|aac|flac|m4a)$/i.test(lower)) return "audio";
  return "image";
};

export function useTimelineTauriDrop(containerRef: RefObject<HTMLDivElement | null>) {
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isDraggingMedia, setIsDraggingMedia] = useState(false);
  const isProcessingDropRef = useRef(false);

  const { mediaAssets, addMediaAsset, project, updateProject } = useProjectStore();
  const { clips, addClip, addTrack } = useTimelineStore();

  // Monitor drag state from MediaTab
  const { isDragging: isMediaDragging } = useDragLayer((monitor) => ({
    isDragging: monitor.isDragging() && monitor.getItemType() === "MEDIA_ASSET",
  }));

  useEffect(() => {
    setIsDraggingMedia(isMediaDragging);
  }, [isMediaDragging]);

  const handleTauriFileDrop = useCallback(
    async (paths: string[]) => {
      const dropTime = resolveClipStartTime({
        intent: "timeline_end",
        timelineEndTime: useTimelineStore.getState().getTimelineEndTime(),
      });

      for (const filePath of paths) {
        try {
          const filename = filePath.split("/").pop() || filePath.split("\\").pop() || "Unknown";
          const type = getMediaType(filename);

          // Check if asset already exists
          let asset = useProjectStore.getState().mediaAssets.find((a) => a.path === filePath);

          if (!asset) {
            // Import new asset
            if (type === "video" || type === "audio") {
              const metadata: VideoMetadata = await platform.getMediaMetadata(filePath);
              const posterFrame: string | undefined = type === "video" ? await platform.extractPosterFrame(filePath, metadata.duration, window.devicePixelRatio || 1.0).catch(() => undefined) : undefined;

              asset = {
                id: generateId("asset"),
                name: filename,
                path: filePath,
                type,
                duration: metadata.duration,
                width: metadata.width,
                height: metadata.height,
                posterFrame,
                size: (metadata as any).size ?? 0,
              };
            } else {
              asset = {
                id: generateId("asset"),
                name: filename,
                path: filePath,
                type: "image" as const,
                duration: 0,
                size: 0,
                posterFrame: platform.convertFileSrc(filePath),
              };
            }

            addMediaAsset(asset);
          }

          // Add clip to timeline at end
          const targetTrackType = resolveTargetTrackType(asset);
          let targetTrackId = resolvePreferredTrackId({
            tracks: useTimelineStore.getState().tracks,
            asset,
          });

          // If no track exists for this type, create one
          if (!targetTrackId) {
            addTrack(targetTrackType);
            targetTrackId = resolvePreferredTrackId({
              tracks: useTimelineStore.getState().tracks,
              asset,
            });
          }

          if (targetTrackId) {
            if (DEFAULT_PLACEMENT_POLICY.autoAdaptSequenceForFirstVisualClip) {
              const activeClips = useTimelineStore.getState().clips;
              const currentProject = useProjectStore.getState().project;
              autoAdaptSequenceForFirstVisualClip({
                project: currentProject,
                existingClips: activeClips,
                asset,
                updateProject,
              });
            }
            const nextProject = useProjectStore.getState().project;

            const newClip = createClipFromAsset({
              asset,
              trackId: targetTrackId,
              startTime: dropTime,
              width: nextProject?.canvasWidth || project?.canvasWidth || 1920,
              height: nextProject?.canvasHeight || project?.canvasHeight || 1080,
            });

            addClip(newClip);
          }
        } catch (error) {
          console.error(`[Timeline] Failed to import ${filePath}:`, error);
          useProjectStore.getState().showToast(`Failed to import ${filePath.split("/").pop() || "file"}`, "error");
        }
      }
    },
    [addMediaAsset, addClip, addTrack, project, updateProject],
  );

  // Listen for drag events and handle file drops
  useEffect(() => {
    if (!platform.isTauri()) return;

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
  }, [handleTauriFileDrop, containerRef]);

  return { isDraggingOver, isDraggingMedia };
}

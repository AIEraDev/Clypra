import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface UseFileDropOptions {
  onDrop: (paths: string[]) => Promise<void>;
  enabled?: boolean;
}

/**
 * Hook to handle Tauri file drop events for a specific container
 * Only triggers when files are dropped over the container's bounds
 */
export const useFileDrop = ({ onDrop, enabled = true }: UseFileDropOptions) => {
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isProcessingRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      try {
        // Listen for file drop hover
        const unlistenHover = await listen<{ position: { x: number; y: number } }>("tauri://drag-over", (event) => {
          if (!containerRef.current) return;

          const rect = containerRef.current.getBoundingClientRect();
          const { x, y } = event.payload.position;

          // Check if mouse is over this container
          const isOver = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

          setIsDraggingOver(isOver);
        });

        // Listen for file drop
        const unlistenDrop = await listen<{
          paths: string[];
          position: { x: number; y: number };
        }>("tauri://drag-drop", async (event) => {
          setIsDraggingOver(false);

          if (!containerRef.current || isProcessingRef.current) {
            return;
          }

          const rect = containerRef.current.getBoundingClientRect();
          const { x, y } = event.payload.position;

          // Only process if dropped over this container
          const isOver = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

          if (isOver) {
            isProcessingRef.current = true;
            try {
              await onDrop(event.payload.paths);
            } finally {
              isProcessingRef.current = false;
            }
          }
        });

        // Listen for drag cancelled
        const unlistenCancel = await listen("tauri://drag-cancelled", () => {
          setIsDraggingOver(false);
        });

        unlisten = () => {
          unlistenHover();
          unlistenDrop();
          unlistenCancel();
        };
      } catch (error) {
        console.error("[useFileDrop] Failed to setup file drop listener:", error);
      }
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [enabled, onDrop]);

  return { containerRef, isDraggingOver };
};

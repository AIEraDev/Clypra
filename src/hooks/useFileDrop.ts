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
  const unlistenFns = useRef<Array<() => void>>([]);

  useEffect(() => {
    if (!enabled) return;

    let isMounted = true;
    unlistenFns.current = [];

    const setupListener = async () => {
      try {
        // Listen for file drop hover
        const unlistenHover = await listen<{ position: { x: number; y: number } }>("tauri://drag-over", (event) => {
          if (!containerRef.current || !isMounted) return;

          const rect = containerRef.current.getBoundingClientRect();
          const { x, y } = event.payload.position;

          // Check if mouse is over this container
          const isOver = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

          setIsDraggingOver(isOver);
        });
        unlistenFns.current.push(unlistenHover);

        // Listen for file drop
        const unlistenDrop = await listen<{
          paths: string[];
          position: { x: number; y: number };
        }>("tauri://drag-drop", async (event) => {
          if (!isMounted) return;

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
        unlistenFns.current.push(unlistenDrop);

        // Listen for drag cancelled
        const unlistenCancel = await listen("tauri://drag-cancelled", () => {
          if (!isMounted) return;
          setIsDraggingOver(false);
        });
        unlistenFns.current.push(unlistenCancel);

        if (!isMounted) {
          unlistenFns.current.forEach((fn) => {
            try {
              void Promise.resolve(fn()).catch(() => {});
            } catch (e) {}
          });
          unlistenFns.current = [];
        }
      } catch (error) {
        console.error("[useFileDrop] Failed to setup file drop listener:", error);
      }
    };

    setupListener();

    return () => {
      isMounted = false;
      unlistenFns.current.forEach((fn) => {
        try {
          void Promise.resolve(fn()).catch(() => {});
        } catch (e) {}
      });
      unlistenFns.current = [];
    };
  }, [enabled, onDrop]);

  return { containerRef, isDraggingOver };
};

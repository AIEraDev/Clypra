import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { platform } from "@/core/platform";

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
    if (!enabled || !platform.isTauri()) return;

    let unlisten: (() => void) | undefined;
    let isMounted = true;

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

        // Listen for drag cancelled
        const unlistenCancel = await listen("tauri://drag-cancelled", () => {
          if (!isMounted) return;
          setIsDraggingOver(false);
        });

        // Only set unlisten if component is still mounted
        if (isMounted) {
          unlisten = () => {
            try {
              unlistenHover();
            } catch (e) {
              // Listener already cleaned up
            }
            try {
              unlistenDrop();
            } catch (e) {
              // Listener already cleaned up
            }
            try {
              unlistenCancel();
            } catch (e) {
              // Listener already cleaned up
            }
          };
        } else {
          // Component unmounted before listeners were set up, clean up immediately
          try {
            unlistenHover();
          } catch (e) {
            // Ignore
          }
          try {
            unlistenDrop();
          } catch (e) {
            // Ignore
          }
          try {
            unlistenCancel();
          } catch (e) {
            // Ignore
          }
        }
      } catch (error) {
        console.error("[useFileDrop] Failed to setup file drop listener:", error);
      }
    };

    setupListener();

    return () => {
      isMounted = false;
      if (unlisten) {
        try {
          unlisten();
        } catch (error) {
          // Ignore errors during cleanup (listener may already be unregistered)
          console.debug("[useFileDrop] Cleanup error (expected):", error);
        }
      }
    };
  }, [enabled, onDrop]);

  return { containerRef, isDraggingOver };
};

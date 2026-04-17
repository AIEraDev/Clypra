/**
 * Keyboard shortcuts hook for Timeline Engine v1
 */

import { useEffect, useRef } from "react";
import { useTimelineStore } from "../store/timelineStore";

export type ToolMode = "selection" | "split";

export interface KeyboardShortcutsOptions {
  /** Callback for play/pause toggle (Space key) */
  onPlayPauseToggle?: () => void;
  /** Current tool mode (for V/S tool switching) */
  toolMode?: ToolMode;
  /** Callback when tool mode changes */
  onToolModeChange?: (mode: ToolMode) => void;
  /** Frame rate for frame stepping (default: 30 fps) */
  fps?: number;
}

/**
 * Hook to enable keyboard shortcuts for timeline operations
 *
 * Keyboard shortcuts:
 */
export function useTimelineKeyboardShortcuts(options: KeyboardShortcutsOptions = {}) {
  const { fps = 30 } = options;

  // Use ref to avoid recreating the handler on every render
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable) {
        return;
      }

      // Get fresh state and actions from store
      const store = useTimelineStore.getState();
      const { playhead, duration, pxPerSec, clips, selectedClipIds, setPlayhead, setZoom, deleteClip, splitClip, undo, redo } = store;

      if (e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        if (optionsRef.current.onPlayPauseToggle) {
          optionsRef.current.onPlayPauseToggle();
        }
        return;
      }

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        const frameDuration = 1 / fps;
        const newTime = Math.max(0, playhead - frameDuration);
        setPlayhead(newTime);
        return;
      }

      if (e.key === "ArrowRight") {
        e.preventDefault();
        const frameDuration = 1 / fps;
        const newTime = Math.min(duration, playhead + frameDuration);
        setPlayhead(newTime);
        return;
      }

      if (e.key === "Home") {
        e.preventDefault();
        setPlayhead(0);
        return;
      }

      if (e.key === "End") {
        e.preventDefault();
        setPlayhead(duration);
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        const selectedIds = Array.from(selectedClipIds);
        for (const clipId of selectedIds) {
          deleteClip(clipId);
        }
        return;
      }

      if ((e.key === "s" || e.key === "S") && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();

        // If tool mode callback provided, switch to split tool
        if (optionsRef.current.onToolModeChange) {
          optionsRef.current.onToolModeChange("split");
        }

        // Also perform split if playhead is over a clip
        const clipUnderPlayhead = Array.from(clips.values()).find((clip) => {
          return playhead > clip.startTime && playhead < clip.startTime + clip.duration;
        });

        if (clipUnderPlayhead) {
          splitClip(clipUnderPlayhead.id, playhead);
        }
        return;
      }

      if ((e.key === "v" || e.key === "V") && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (optionsRef.current.onToolModeChange) {
          optionsRef.current.onToolModeChange("selection");
        }
        return;
      }

      if ((e.key === "+" || e.key === "=") && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const zoomFactor = 1.2;
        const newZoom = Math.min(320, pxPerSec * zoomFactor);
        setZoom(newZoom);
        return;
      }

      if ((e.key === "-" || e.key === "_") && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const zoomFactor = 0.8;
        const newZoom = Math.max(16, pxPerSec * zoomFactor);
        setZoom(newZoom);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        redo();
        return;
      }

      // Alternative: Ctrl+Y or Cmd+Y for redo
      if ((e.ctrlKey || e.metaKey) && e.key === "y") {
        e.preventDefault();
        redo();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fps]);
}

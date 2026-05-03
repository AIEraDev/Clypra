import { useEffect } from "react";
import { usePlaybackStore } from "../store/playbackStore";
import { useTimelineStore } from "../store/timelineStore";
import { useUIStore } from "../store/uiStore";
import { useProjectStore } from "../store/projectStore";

export const useKeyboardShortcuts = () => {
  const { isPlaying, currentTime, frameRate, play, pause, seek } = usePlaybackStore();
  const { zoomLevel, setZoom } = useTimelineStore();
  const { selectedClipId, selectClip, selectTrack, previewMode, exitSourceMode, markSourceIn, markSourceOut } = useUIStore();
  const { project } = useProjectStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMeta = e.ctrlKey || e.metaKey;

      // Source preview shortcuts
      if (previewMode === "source") {
        if (e.key === "i") {
          e.preventDefault();
          // Get current time from video element
          const video = document.querySelector("video") as HTMLVideoElement;
          if (video) markSourceIn(video.currentTime);
          return;
        } else if (e.key === "o") {
          e.preventDefault();
          const video = document.querySelector("video") as HTMLVideoElement;
          if (video) markSourceOut(video.currentTime);
          return;
        } else if (e.key === "Escape") {
          e.preventDefault();
          exitSourceMode();
          return;
        }
      }

      // Program mode shortcuts
      if (e.code === "Space") {
        e.preventDefault();
        isPlaying ? pause() : play();
      } else if (e.key === "k") {
        e.preventDefault();
        pause();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        const frameTime = 1 / frameRate;
        seek(Math.max(0, currentTime - frameTime));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        const frameTime = 1 / frameRate;
        seek(currentTime + frameTime);
      } else if (isMeta && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        console.log("Undo");
      } else if ((isMeta && e.shiftKey && e.key === "z") || (isMeta && e.key === "y")) {
        e.preventDefault();
        console.log("Redo");
      } else if (isMeta && e.key === "s") {
        e.preventDefault();
        console.log("Save project");
      } else if (isMeta && e.key === "i") {
        e.preventDefault();
        console.log("Import media");
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedClipId) {
          e.preventDefault();
          console.log("Delete clip");
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        selectClip(null);
        selectTrack(null);
      } else if (isMeta && e.key === "=") {
        e.preventDefault();
        setZoom(Math.min(5, zoomLevel + 0.1));
      } else if (isMeta && e.key === "-") {
        e.preventDefault();
        setZoom(Math.max(0.5, zoomLevel - 0.1));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPlaying, currentTime, frameRate, zoomLevel, selectedClipId, previewMode, play, pause, seek, setZoom, selectClip, selectTrack, exitSourceMode, markSourceIn, markSourceOut]);
};

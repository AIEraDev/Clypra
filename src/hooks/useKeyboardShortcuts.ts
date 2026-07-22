import React, { useEffect } from "react";
import { useTransportControls, useTransportSnapshot } from "./usePlaybackClock";
import { getActiveSessionOrNull } from "@/core/runtime/ProjectSession";
import { getPlaybackClock } from "@/hooks/usePlaybackClock";
import { useTimelineStore } from "@/store/timelineStore";
import { useUIStore } from "@/store/uiStore";
import { useProjectStore } from "@/store/projectStore";
import { useHistoryStore } from "@/store/historyStore";
import { useShortcutStore } from "@/store/shortcutStore";
import { EditingActions } from "@/core/interactions";
import { generateId } from "@/lib/utils/id";
import { useAnchoredTimelineZoom } from "./useAnchoredTimelineZoom";
import { t } from "@/i18n";

let copiedClipsClipboard: Array<{
  trackId: string;
  mediaId: string;
  duration: number;
  trimIn: number;
  trimOut: number;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  rotation: number;
  startOffset: number;
  aspectRatioLocked?: boolean;
  sourceAspectRatio?: number;
  fitMode?: "contain" | "cover" | "fill" | "stretch" | "original";
}> = [];

export const useKeyboardShortcuts = () => {
  const { play, pause, seek, setActiveContext } = useTransportControls();
  const { state: transportState, time: transportTime, speed } = useTransportSnapshot();
  const { swapClips, rippleEditEnabled, toggleRippleEdit, addMarker } = useTimelineStore();
  const { selectedClipIds, selectClip, selectTrack, previewMode, exitSourceMode, markSourceIn, markSourceOut } = useUIStore();
  const { project } = useProjectStore();
  const { undo, redo } = useHistoryStore();
  const { zoomByStep } = useAnchoredTimelineZoom();
  const [toastMessage, setToastMessage] = React.useState<string | null>(null);

  const isPlaying = transportState === "playing";
  const frameRate = project?.frameRate ?? 30;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture shortcuts when typing in input fields
      const target = e.target as HTMLElement;
      const isTyping = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      if (isTyping) return;

      const isMeta = e.ctrlKey || e.metaKey;

      // ─── Transport (context-aware) ───────────────────────────────────────

      if (e.code === "Space") {
        e.preventDefault();
        isPlaying ? pause() : play();
        return;
      }

      if (e.key === "k") {
        e.preventDefault();
        pause();
        return;
      }

      // ─── Seeking (context-aware) ─────────────────────────────────────────
      // PB-BUG-001 fix: Read clock.time imperatively instead of using throttled
      // transportTime (which lags by up to 100ms at 10fps throttle rate).

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        const liveTime = getPlaybackClock().time;
        if (previewMode === "source") {
          seek?.(Math.max(0, liveTime - 1));
        } else {
          const frameTime = 1 / frameRate;
          seek?.(Math.max(0, liveTime - frameTime));
        }
        return;
      }

      if (e.key === "ArrowRight") {
        e.preventDefault();
        const liveTime = getPlaybackClock().time;
        if (previewMode === "source") {
          seek?.(liveTime + 1);
        } else {
          const frameTime = 1 / frameRate;
          seek?.(liveTime + frameTime);
        }
        return;
      }

      // ─── Source mode shortcuts ───────────────────────────────────────────

      if (previewMode === "source") {
        if (e.key === "i") {
          e.preventDefault();
          const session = getActiveSessionOrNull();
          const t = session?.sourceContext?.getTime() ?? 0;
          markSourceIn(t);
          return;
        }

        if (e.key === "o") {
          e.preventDefault();
          const session = getActiveSessionOrNull();
          const t = session?.sourceContext?.getTime() ?? 0;
          markSourceOut(t);
          return;
        }

        if (e.key === "Escape") {
          e.preventDefault();
          exitSourceMode();
          setActiveContext?.("program");
          return;
        }

        // Don't process remaining shortcuts in source mode
        return;
      }

      // ─── Program mode shortcuts ──────────────────────────────────────────

      if (isMeta && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((isMeta && e.shiftKey && e.key === "z") || (isMeta && e.key === "y")) {
        e.preventDefault();
        redo();
      } else if (isMeta && e.key === "s") {
        e.preventDefault();
      } else if (isMeta && e.key === "i") {
        e.preventDefault();
      } else if (isMeta && e.key.toLowerCase() === "d") {
        e.preventDefault();
        const store = useTimelineStore.getState();
        const selected = store.clips.filter((c) => selectedClipIds.includes(c.id)).sort((a, b) => a.startTime - b.startTime);
        if (selected.length === 0) return;
        const minStart = selected[0].startTime;
        const maxEnd = Math.max(...selected.map((c) => c.startTime + c.duration));
        const offset = maxEnd - minStart;
        selected.forEach((clip) => {
          store.addClip({
            ...clip,
            id: generateId("clip"),
            startTime: clip.startTime + offset,
          });
        });
        setToastMessage(t("timeline.toast.duplicated.count", { count: selected.length }));
        setTimeout(() => setToastMessage(null), 2000);
      } else if (isMeta && e.key.toLowerCase() === "c") {
        e.preventDefault();
        const store = useTimelineStore.getState();
        const selected = store.clips.filter((c) => selectedClipIds.includes(c.id)).sort((a, b) => a.startTime - b.startTime);
        if (selected.length === 0) return;
        const minStart = selected[0].startTime;
        copiedClipsClipboard = selected.map((clip) => ({
          trackId: clip.trackId,
          mediaId: clip.mediaId,
          duration: clip.duration,
          trimIn: clip.trimIn,
          trimOut: clip.trimOut,
          x: clip.x,
          y: clip.y,
          width: clip.width,
          height: clip.height,
          opacity: clip.opacity,
          rotation: clip.rotation,
          startOffset: clip.startTime - minStart,
          aspectRatioLocked: clip.aspectRatioLocked,
          sourceAspectRatio: clip.sourceAspectRatio,
          fitMode: clip.fitMode,
        }));
        setToastMessage(t("timeline.toast.copied.count", { count: copiedClipsClipboard.length }));
        setTimeout(() => setToastMessage(null), 1500);
      } else if (isMeta && e.key.toLowerCase() === "v") {
        e.preventDefault();
        if (copiedClipsClipboard.length === 0) return;
        const store = useTimelineStore.getState();
        copiedClipsClipboard.forEach((clip) => {
          store.addClip({
            id: generateId("clip"),
            trackId: clip.trackId,
            mediaId: clip.mediaId,
            startTime: Math.max(0, transportTime + clip.startOffset),
            duration: clip.duration,
            trimIn: clip.trimIn,
            trimOut: clip.trimOut,
            x: clip.x,
            y: clip.y,
            width: clip.width,
            height: clip.height,
            opacity: clip.opacity,
            rotation: clip.rotation,
            aspectRatioLocked: clip.aspectRatioLocked,
            sourceAspectRatio: clip.sourceAspectRatio,
            fitMode: clip.fitMode,
          });
        });
        setToastMessage(t("timeline.toast.pasted.count", { count: copiedClipsClipboard.length }));
        setTimeout(() => setToastMessage(null), 1500);
      } else if (isMeta && e.shiftKey && e.key === "S") {
        e.preventDefault();
        const result = swapClips();
        if (result.error) {
          setToastMessage(result.error);
          setTimeout(() => setToastMessage(null), 3000);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        selectClip(null);
        selectTrack(null);
      } else if (isMeta && e.key === "=") {
        e.preventDefault();
        zoomByStep(1);
      } else if (isMeta && e.key === "-") {
        e.preventDefault();
        zoomByStep(-1);
      } else if (e.key === "r" && !isMeta) {
        e.preventDefault();
        toggleRippleEdit();
        setToastMessage(t(rippleEditEnabled ? "timeline.toast.ripple.off" : "timeline.toast.ripple.on"));
        setTimeout(() => setToastMessage(null), 2000);
      } else if (isMeta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        // Ctrl/Cmd+K: Split selected clips (or all if none selected)
        if (e.shiftKey) {
          // PB-HIDDEN-005 fix: Ctrl+Shift+K splits ALL clips at playhead
          const results = EditingActions.splitAtPlayhead();
          if (results.length === 0) {
            setToastMessage(t("timeline.toast.split.none"));
          } else {
            const successCount = results.filter((r) => r.success).length;
            setToastMessage(t("timeline.toast.split.count", { count: successCount }));
          }
        } else {
          // PB-HIDDEN-005 fix: Ctrl+K splits only SELECTED clips at playhead
          // If no clips are selected, falls back to splitting all clips
          const store = useTimelineStore.getState();
          const selected = store.clips.filter((c) => selectedClipIds.includes(c.id));
          if (selected.length > 0) {
            const results = EditingActions.splitSelectedAtPlayhead(selectedClipIds);
            if (results.length === 0) {
              setToastMessage(t("timeline.toast.split.selectedNone"));
            } else {
              const successCount = results.filter((r) => r.success).length;
              setToastMessage(t("timeline.toast.split.selectedCount", { count: successCount }));
            }
          } else {
            // No selection — fall back to split all
            const results = EditingActions.splitAtPlayhead();
            if (results.length === 0) {
              setToastMessage(t("timeline.toast.split.none"));
            } else {
              const successCount = results.filter((r) => r.success).length;
              setToastMessage(t("timeline.toast.split.count", { count: successCount }));
            }
          }
        }
        setTimeout(() => setToastMessage(null), 2000);
      } else if (isMeta && e.key.toLowerCase() === "a") {
        e.preventDefault();
        // Ctrl/Cmd+A: Select all clips
        const store = useTimelineStore.getState();
        const allClipIds = store.clips.map((c) => c.id);
        useUIStore.setState({ selectedClipIds: allClipIds, selectedGapId: null });
        setToastMessage(t("timeline.toast.selected.count", { count: allClipIds.length }));
        setTimeout(() => setToastMessage(null), 1500);
      } else if (isMeta && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        // Ctrl/Cmd+Shift+D: Deselect all
        useUIStore.getState().clearSelection();
        setToastMessage(t("timeline.toast.deselectedAll"));
        setTimeout(() => setToastMessage(null), 1500);
      } else if (isMeta && (e.key === "]" || e.key === "[")) {
        e.preventDefault();
        // Ctrl/Cmd+] or Ctrl/Cmd+[: Nudge selected clips by frame
        const direction = e.key === "]" ? 1 : -1;
        const nudgeAmount = e.shiftKey ? 10 : 1; // Shift = 10 frames, no shift = 1 frame
        const frameTime = 1 / frameRate;
        const nudgeTime = direction * nudgeAmount * frameTime;

        const store = useTimelineStore.getState();
        const selectedClips = store.clips.filter((c) => selectedClipIds.includes(c.id));

        if (selectedClips.length === 0) {
          setToastMessage(t("timeline.toast.nudge.none"));
          setTimeout(() => setToastMessage(null), 1500);
          return;
        }

        store.withBatch(() => {
          selectedClips.forEach((clip) => {
            const newStartTime = Math.max(0, clip.startTime + nudgeTime);
            store.updateClip(clip.id, { startTime: newStartTime });
          });
        });

        setToastMessage(t("timeline.toast.nudge.count", {
          count: selectedClips.length,
          direction: t(direction > 0 ? "timeline.direction.right" : "timeline.direction.left"),
          frames: nudgeAmount,
        }));
        setTimeout(() => setToastMessage(null), 1500);
      } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        // Alt+Up/Down: Select clip on adjacent track
        const direction = e.key === "ArrowUp" ? -1 : 1;
        const store = useTimelineStore.getState();
        const uiStore = useUIStore.getState();

        // Get currently selected clip
        const currentClipId = selectedClipIds[0];
        if (!currentClipId) {
          setToastMessage(t("timeline.toast.navigation.noClip"));
          setTimeout(() => setToastMessage(null), 1500);
          return;
        }

        const currentClip = store.clips.find((c) => c.id === currentClipId);
        if (!currentClip) return;

        // Find current track index
        const currentTrackIndex = store.tracks.findIndex((t) => t.id === currentClip.trackId);
        if (currentTrackIndex === -1) return;

        // Find target track
        const targetTrackIndex = currentTrackIndex + direction;
        if (targetTrackIndex < 0 || targetTrackIndex >= store.tracks.length) {
          setToastMessage(t("timeline.toast.navigation.noTrack", {
            direction: t(direction < 0 ? "timeline.direction.above" : "timeline.direction.below"),
          }));
          setTimeout(() => setToastMessage(null), 1500);
          return;
        }

        const targetTrack = store.tracks[targetTrackIndex];

        // Find clip on target track closest to current clip's position
        const targetTrackClips = store.clips.filter((c) => c.trackId === targetTrack.id).sort((a, b) => Math.abs(a.startTime - currentClip.startTime) - Math.abs(b.startTime - currentClip.startTime));

        if (targetTrackClips.length === 0) {
          setToastMessage(t("timeline.toast.navigation.noClips", {
            direction: t(direction < 0 ? "timeline.direction.above" : "timeline.direction.below"),
          }));
          setTimeout(() => setToastMessage(null), 1500);
          return;
        }

        // Select the closest clip
        const closestClip = targetTrackClips[0];
        uiStore.selectClip(closestClip.id);
        setToastMessage(t("timeline.toast.navigation.selectedClip", {
          direction: t(direction < 0 ? "timeline.direction.above" : "timeline.direction.below"),
        }));
        setTimeout(() => setToastMessage(null), 1500);
      } else if (isMeta && e.altKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        // Ctrl/Cmd+Alt+L: Toggle lock on selected track
        const uiStore = useUIStore.getState();
        const selectedTrackId = uiStore.selectedTrackId;

        if (!selectedTrackId) {
          setToastMessage(t("timeline.toast.track.noneSelected"));
          setTimeout(() => setToastMessage(null), 1500);
          return;
        }

        const store = useTimelineStore.getState();
        store.toggleTrackLock(selectedTrackId);

        const track = store.tracks.find((t) => t.id === selectedTrackId);
        setToastMessage(t(track?.locked ? "timeline.toast.track.locked" : "timeline.toast.track.unlocked"));
        setTimeout(() => setToastMessage(null), 1500);
      } else if (isMeta && e.altKey && e.key.toLowerCase() === "v") {
        e.preventDefault();
        // Ctrl/Cmd+Alt+V: Toggle visibility on selected track
        const uiStore = useUIStore.getState();
        const selectedTrackId = uiStore.selectedTrackId;

        if (!selectedTrackId) {
          setToastMessage(t("timeline.toast.track.noneSelected"));
          setTimeout(() => setToastMessage(null), 1500);
          return;
        }

        const store = useTimelineStore.getState();
        store.toggleTrackVisibility(selectedTrackId);

        const track = store.tracks.find((t) => t.id === selectedTrackId);
        setToastMessage(t(track?.visible ? "timeline.toast.track.visible" : "timeline.toast.track.hidden"));
        setTimeout(() => setToastMessage(null), 1500);
      } else if (isMeta && e.altKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        // Ctrl/Cmd+Alt+M: Toggle mute on selected track
        const uiStore = useUIStore.getState();
        const selectedTrackId = uiStore.selectedTrackId;

        if (!selectedTrackId) {
          setToastMessage(t("timeline.toast.track.noneSelected"));
          setTimeout(() => setToastMessage(null), 1500);
          return;
        }

        const store = useTimelineStore.getState();
        store.toggleTrackMute(selectedTrackId);

        const track = store.tracks.find((t) => t.id === selectedTrackId);
        setToastMessage(t(track?.muted ? "timeline.toast.track.muted" : "timeline.toast.track.unmuted"));
        setTimeout(() => setToastMessage(null), 1500);
      } else if (isMeta && e.altKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        // Ctrl/Cmd+Alt+P: Pack selected track (remove gaps)
        const uiStore = useUIStore.getState();
        const selectedTrackId = uiStore.selectedTrackId;

        if (!selectedTrackId) {
          setToastMessage(t("timeline.toast.track.noneSelected"));
          setTimeout(() => setToastMessage(null), 1500);
          return;
        }

        // Import GapManager synchronously
        import("@/lib/timeline/gapManager").then(({ GapManager }) => {
          const unprotectedCount = GapManager.countUnprotectedGaps(selectedTrackId);

          if (unprotectedCount === 0) {
            setToastMessage(t("timeline.toast.track.noGaps"));
            setTimeout(() => setToastMessage(null), 1500);
            return;
          }

          GapManager.packTrack(selectedTrackId);
          setToastMessage(t("timeline.toast.track.packed", { count: unprotectedCount }));
          setTimeout(() => setToastMessage(null), 1500);
        });
      } else if (isMeta && e.altKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        // Ctrl/Cmd+Alt+T: Add new track
        const store = useTimelineStore.getState();

        // Determine track type based on selected clips
        const selectedClips = store.clips.filter((c) => selectedClipIds.includes(c.id));
        let trackType: "video" | "audio" | "text" = "video";

        if (selectedClips.length > 0) {
          const firstClip = selectedClips[0];
          if ("text" in firstClip) {
            trackType = "text";
          } else {
            const mediaAsset = useProjectStore.getState().mediaAssets.find((a) => a.id === firstClip.mediaId);
            if (mediaAsset?.type === "audio") {
              trackType = "audio";
            }
          }
        }

        // Add track at the end
        const newTrackId = store.insertTrackAt(trackType, store.tracks.length);
        setToastMessage(t("timeline.toast.track.added", {
          trackType: t(`timeline.trackType.${trackType}`),
        }));
        setTimeout(() => setToastMessage(null), 1500);

        // Select the new track
        useUIStore.getState().selectTrack(newTrackId);
      } else if (e.key === "m" && !isMeta && !e.altKey) {
        e.preventDefault();
        // M: Add marker at playhead position
        const liveTime = getPlaybackClock().time;
        const mins = Math.floor(liveTime / 60);
        const secs = Math.floor(liveTime % 60);
        const timeLabel = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
        addMarker(liveTime);
        setToastMessage(t("timeline.toast.marker.added", { time: timeLabel }));
        setTimeout(() => setToastMessage(null), 2000);
      } else if (e.key === "s" && !isMeta) {
        e.preventDefault();
        const results = EditingActions.splitAtPlayhead();

        if (results.length === 0) {
          setToastMessage(t("timeline.toast.split.none"));
        } else {
          const successCount = results.filter((r) => r.success).length;
          const failCount = results.length - successCount;

          if (successCount > 0) {
            setToastMessage(t("timeline.toast.split.count", { count: successCount }));
          } else if (failCount > 0) {
            setToastMessage(results[0].error || t("timeline.message.splitFailed"));
          }
        }
        setTimeout(() => setToastMessage(null), 2000);
      } else if (e.key.toLowerCase() === "q" && !isMeta) {
        e.preventDefault();
        const results = EditingActions.deleteLeftAtPlayhead();
        if (results.length === 0) {
          setToastMessage(t("timeline.toast.deleteLeft.none"));
        } else {
          const successCount = results.filter((r) => r.success).length;
          setToastMessage(t("timeline.toast.deleteLeft.count", { count: successCount }));
        }
        setTimeout(() => setToastMessage(null), 2000);
      } else if (e.key.toLowerCase() === "w" && !isMeta) {
        e.preventDefault();
        const results = EditingActions.deleteRightAtPlayhead();
        if (results.length === 0) {
          setToastMessage(t("timeline.toast.deleteRight.none"));
        } else {
          const successCount = results.filter((r) => r.success).length;
          setToastMessage(t("timeline.toast.deleteRight.count", { count: successCount }));
        }
        setTimeout(() => setToastMessage(null), 2000);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPlaying, transportTime, frameRate, selectedClipIds, previewMode, rippleEditEnabled, play, pause, seek, setActiveContext, zoomByStep, selectClip, selectTrack, exitSourceMode, markSourceIn, markSourceOut, swapClips, toggleRippleEdit, addMarker, undo, redo]);

  return { toastMessage };
};

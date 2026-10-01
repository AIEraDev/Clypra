import React, { useEffect, useRef } from "react";
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
import { useAnchoredTimelineZoom } from "./timeline/useAnchoredTimelineZoom";
import { toast } from "@/lib/toast";
import { formatSplitMessage } from "@/lib/timeline/clipName";

import { clipboardService } from "@/core/clipboard/clipboardService";
import { toggleTrackPropertyWithHistory } from "@/core/history/trackPropertyActions";
import { useSettingsStore } from "@/store/settingsStore";
import { EditorFeatureTelemetry } from "@/services/editorFeatureTelemetry";

export const useKeyboardShortcuts = () => {
  const { play, pause, seek, setSpeed, setActiveContext, togglePlayback } = useTransportControls();
  const { time: transportTime } = useTransportSnapshot();
  const { addMarker } = useTimelineStore();
  const { selectedClipIds, selectClip, selectTrack, previewMode, exitSourceMode, markSourceIn, markSourceOut } = useUIStore();
  const { project } = useProjectStore();
  const { undo, redo } = useHistoryStore();
  const { zoomByStep, fitSequence } = useAnchoredTimelineZoom();

  const frameRate = project?.frameRate ?? 30;
  const kPressedRef = useRef(false);
  const yPressedRef = useRef(false);
  const uPressedRef = useRef(false);
  const nPressedRef = useRef(false);

  useEffect(() => {
    const stepFrame = (direction: -1 | 1) => {
      const session = getActiveSessionOrNull();
      const clock = getPlaybackClock();
      const oneFrame = 1 / frameRate;
      let target = 0;
      if (previewMode === "source") {
        const sourceTime = session?.sourceContext?.getTime() ?? 0;
        const sourceDuration = session?.sourceContext?.getDuration() ?? Infinity;
        target =
          direction > 0
            ? Math.min(sourceDuration, sourceTime + oneFrame)
            : Math.max(0, sourceTime - oneFrame);
        seek?.(target, {
          source: "keyboard-seek",
          mode: "frameStep",
          quality: "full",
          allowKeyframeApprox: false,
        });
      } else {
        const liveTime = clock.time;
        const projectDuration = clock.duration || (project?.duration ?? Infinity);
        target =
          direction > 0
            ? Math.min(projectDuration, liveTime + oneFrame)
            : Math.max(0, liveTime - oneFrame);
        seek?.(target, {
          source: "keyboard-seek",
          mode: "frameStep",
          quality: "full",
          allowKeyframeApprox: false,
        });
      }
      EditorFeatureTelemetry.recordShuttle({
        action: "jog-step",
        direction: direction > 0 ? "step-forward" : "step-backward",
        frameRate,
        playheadTime: target,
      });
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture shortcuts when typing in input fields
      const target = e.target as HTMLElement;
      const isTyping = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      if (isTyping) return;

      const isMeta = e.ctrlKey || e.metaKey;

      // ─── Transport & J/K/L Shuttle (context-aware) ───────────────────────

      if (e.code === "Space") {
        e.preventDefault();
        if (!e.repeat) togglePlayback();
        return;
      }

      // J / K / L Shuttle Transport (DaVinci / Premiere standard)
      const isJ = !isMeta && !e.altKey && (e.key.toLowerCase() === "j" || e.code === "KeyJ");
      const isK = !isMeta && !e.altKey && (e.key.toLowerCase() === "k" || e.code === "KeyK");
      const isL = !isMeta && !e.altKey && (e.key.toLowerCase() === "l" || e.code === "KeyL");

      if (isK) {
        e.preventDefault();
        kPressedRef.current = true;
        const clock = getPlaybackClock();
        const prevSpeed = clock.speed;
        pause();
        setSpeed(1.0);
        EditorFeatureTelemetry.recordShuttle({
          action: "shuttle-speed",
          fromSpeed: prevSpeed,
          toSpeed: 0,
          direction: "pause",
          frameRate,
          playheadTime: clock.time,
        });
        return;
      }

      if (isL) {
        e.preventDefault();
        if (kPressedRef.current) {
          stepFrame(1);
          return;
        }

        const clock = getPlaybackClock();
        const isPlaying = clock.state === "playing";
        if (!isPlaying) {
          setSpeed(1.0);
          play();
          EditorFeatureTelemetry.recordShuttle({
            action: "shuttle-speed",
            fromSpeed: 0,
            toSpeed: 1.0,
            direction: "forward",
            frameRate,
            playheadTime: clock.time,
          });
        } else {
          const currentSpeed = clock.speed;
          let targetSpeed = 1.0;
          if (currentSpeed < 1.0) {
            targetSpeed = 1.0;
          } else if (currentSpeed < 2.0) {
            targetSpeed = 2.0;
          } else if (currentSpeed < 4.0) {
            targetSpeed = 4.0;
          } else {
            targetSpeed = currentSpeed;
          }
          setSpeed(targetSpeed);
          EditorFeatureTelemetry.recordShuttle({
            action: "shuttle-speed",
            fromSpeed: currentSpeed,
            toSpeed: targetSpeed,
            direction: "forward",
            frameRate,
            playheadTime: clock.time,
          });
        }
        return;
      }

      if (isJ) {
        e.preventDefault();
        if (kPressedRef.current) {
          stepFrame(-1);
          return;
        }

        const clock = getPlaybackClock();
        const isPlaying = clock.state === "playing";
        if (isPlaying) {
          const currentSpeed = clock.speed;
          let targetSpeed = 1.0;
          let direction: "forward" | "pause" = "forward";
          if (currentSpeed > 2.0) {
            targetSpeed = 2.0;
            setSpeed(2.0);
          } else if (currentSpeed > 1.0) {
            targetSpeed = 1.0;
            setSpeed(1.0);
          } else {
            pause();
            setSpeed(1.0);
            targetSpeed = 0;
            direction = "pause";
          }
          EditorFeatureTelemetry.recordShuttle({
            action: "shuttle-speed",
            fromSpeed: currentSpeed,
            toSpeed: targetSpeed,
            direction,
            frameRate,
            playheadTime: clock.time,
          });
        } else {
          stepFrame(-1);
        }
        return;
      }

      if (!isMeta && !e.altKey && (e.key.toLowerCase() === "y" || e.code === "KeyY")) {
        yPressedRef.current = true;
      }
      if (!isMeta && !e.altKey && (e.key.toLowerCase() === "u" || e.code === "KeyU")) {
        uPressedRef.current = true;
      }
      if (!isMeta && !e.altKey && (e.key.toLowerCase() === "n" || e.code === "KeyN")) {
        nPressedRef.current = true;
      }

      // ─── Seeking (context-aware) ─────────────────────────────────────────
      // PB-BUG-001 fix: Read clock.time imperatively instead of using throttled
      // transportTime (which lags by up to 100ms at 10fps throttle rate).
      const isArrowLeft = e.key === "ArrowLeft" || e.code === "ArrowLeft";
      const isArrowRight = e.key === "ArrowRight" || e.code === "ArrowRight";

      // Do not hijack Alt+Arrow (which nudges clips) or Meta/Ctrl+Arrow
      if (!e.altKey && !isMeta && (isArrowLeft || isArrowRight)) {
        // ─── Slip / Slide / Roll Shortcuts ────────────────────────────────
        if (selectedClipIds.length === 1 && (yPressedRef.current || uPressedRef.current)) {
          e.preventDefault();
          const targetId = selectedClipIds[0];
          const dir = isArrowRight ? 1 : -1;
          const frames = e.shiftKey ? 10 : 1;
          const delta = (dir * frames) / frameRate;

          if (yPressedRef.current) {
            const res = EditingActions.slipClip(targetId, delta);
            if (res.success) {
              toast.info(`Slipped ${dir > 0 ? "later" : "earlier"} by ${frames} frame${frames > 1 ? "s" : ""}`);
            } else if (res.error) {
              toast.error(res.error);
            }
            return;
          }

          if (uPressedRef.current) {
            const res = EditingActions.slideClip(targetId, delta);
            if (res.success) {
              toast.info(`Slid ${dir > 0 ? "right" : "left"} by ${frames} frame${frames > 1 ? "s" : ""}`);
            } else if (res.error) {
              toast.error(res.error);
            }
            return;
          }
        }

        if (nPressedRef.current && (selectedClipIds.length === 1 || selectedClipIds.length === 2)) {
          e.preventDefault();
          const dir = isArrowRight ? 1 : -1;
          const frames = e.shiftKey ? 10 : 1;
          const delta = (dir * frames) / frameRate;

          if (selectedClipIds.length === 1) {
            const clip = useTimelineStore.getState().clips.find((c) => c.id === selectedClipIds[0]);
            if (clip) {
              const hasOutgoing = useTimelineStore.getState().clips.some(
                (o) => o.trackId === clip.trackId && Math.abs(clip.startTime + clip.duration - o.startTime) < 0.001,
              );
              const res = hasOutgoing
                ? EditingActions.rollClipEdge(clip.id, "outgoing", delta)
                : EditingActions.rollClipEdge(clip.id, "incoming", delta);
              if (res.success) {
                toast.info(`Rolled cut point ${dir > 0 ? "right" : "left"} by ${frames} frame${frames > 1 ? "s" : ""}`);
              } else if (res.error) {
                toast.error(res.error);
              }
            }
            return;
          }

          if (selectedClipIds.length === 2) {
            const clips = useTimelineStore.getState().clips;
            const [c1, c2] = selectedClipIds.map((id) => clips.find((c) => c.id === id));
            if (c1 && c2 && c1.trackId === c2.trackId) {
              const [left, right] = c1.startTime <= c2.startTime ? [c1, c2] : [c2, c1];
              const res = EditingActions.rollEdit(left.id, right.id, delta);
              if (res.success) {
                toast.info(`Rolled cut point ${dir > 0 ? "right" : "left"} by ${frames} frame${frames > 1 ? "s" : ""}`);
              } else if (res.error) {
                toast.error(res.error);
              }
            }
            return;
          }
        }

        e.preventDefault();
        const session = getActiveSessionOrNull();
        const clock = getPlaybackClock();
        const isPlaying = clock.state === "playing";

        if (previewMode === "source") {
          // Source preview seeking
          const sourceTime = session?.sourceContext?.getTime() ?? 0;
          const sourceDuration = session?.sourceContext?.getDuration() ?? Infinity;
          const step = isPlaying
            ? e.shiftKey ? 5.0 : 1.0
            : e.shiftKey ? 1.0 : 1 / frameRate;

          const targetTime = isArrowLeft
            ? Math.max(0, sourceTime - step)
            : Math.min(sourceDuration, sourceTime + step);

          seek?.(targetTime, {
            source: "keyboard-seek",
            mode: isPlaying ? "playback" : (e.shiftKey ? "seek" : "frameStep"),
            quality: "full",
            allowKeyframeApprox: false,
          });
        } else {
          // Program timeline seeking
          const liveTime = clock.time;
          const projectDuration = clock.duration || (project?.duration ?? Infinity);
          const step = isPlaying
            ? e.shiftKey ? 5.0 : 1.0
            : e.shiftKey ? 1.0 : 1 / frameRate;

          const targetTime = isArrowLeft
            ? Math.max(0, liveTime - step)
            : Math.min(projectDuration, liveTime + step);

          seek?.(targetTime, {
            source: "keyboard-seek",
            mode: isPlaying ? "playback" : (e.shiftKey ? "seek" : "frameStep"),
            quality: "full",
            allowKeyframeApprox: false,
          });
        }
        return;
      }

      // ─── Undo / Redo (global, available in program and source mode) ─────
      const isZ = e.key.toLowerCase() === "z" || e.code === "KeyZ";
      const isY = e.key.toLowerCase() === "y" || e.code === "KeyY";
      const matchingAction = useShortcutStore.getState().getMatchingAction(e);

      if ((isMeta && !e.shiftKey && isZ) || matchingAction === "undo") {
        e.preventDefault();
        undo();
        return;
      }

      if (
        (isMeta && e.shiftKey && isZ) ||
        (isMeta && !e.shiftKey && isY) ||
        matchingAction === "redo" ||
        matchingAction === "redo-alt"
      ) {
        e.preventDefault();
        redo();
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

      const action = useShortcutStore.getState().getMatchingAction(e);

      if (action === "group-clips") {
        e.preventDefault();
        const result = EditingActions.groupSelectedClips(selectedClipIds);
        if (result.success) toast.success("Grouped clips");
        else if (result.error) toast.error(result.error);
        return;
      }

      // Cmd/Ctrl+S: Save project
      if (isMeta && !e.shiftKey && (e.key.toLowerCase() === "s" || e.code === "KeyS")) {
        e.preventDefault();
        const store = useProjectStore.getState();
        if (store.project) {
          store
            .saveCurrentProject()
            .then((result) => {
              if (result?.verified) {
                toast.success("Project saved");
              }
            })
            .catch(() => {
              toast.error("Failed to save project");
            });
        }
        return;
      }

      // Cmd/Ctrl+Shift+S: Swap selected clips
      if (isMeta && e.shiftKey && (e.key.toLowerCase() === "s" || e.code === "KeyS")) {
        e.preventDefault();
        const result = EditingActions.swapSelectedClips();
        if (result.error) {
          toast.error(result.error);
        }
        return;
      }

      // Cmd/Ctrl+D: Duplicate clips
      if (isMeta && !e.shiftKey && (e.key.toLowerCase() === "d" || e.code === "KeyD")) {
        e.preventDefault();
        clipboardService.duplicateClips(selectedClipIds);
        return;
      }

      // Cmd/Ctrl+Shift+D: Deselect all clips
      if (isMeta && e.shiftKey && (e.key.toLowerCase() === "d" || e.code === "KeyD")) {
        e.preventDefault();
        useUIStore.getState().clearSelection();
        toast.info("Deselected all clips");
        return;
      }

      // Cmd/Ctrl+C: Copy clips
      if (isMeta && !e.shiftKey && (e.key.toLowerCase() === "c" || e.code === "KeyC")) {
        e.preventDefault();
        clipboardService.copyClips(selectedClipIds);
        return;
      }

      // Cmd/Ctrl+X: Cut clips
      if (isMeta && !e.shiftKey && (e.key.toLowerCase() === "x" || e.code === "KeyX")) {
        e.preventDefault();
        clipboardService.cutClips(selectedClipIds, false);
        return;
      }

      // Cmd/Ctrl+V: Paste clips
      if (isMeta && !e.shiftKey && (e.key.toLowerCase() === "v" || e.code === "KeyV")) {
        e.preventDefault();
        clipboardService.pasteClips(transportTime);
        return;
      }

      // Cmd/Ctrl+A: Select all clips
      if (isMeta && !e.shiftKey && (e.key.toLowerCase() === "a" || e.code === "KeyA")) {
        e.preventDefault();
        const store = useTimelineStore.getState();
        const allClipIds = store.clips.map((c) => c.id);
        useUIStore.setState({ selectedClipIds: allClipIds, selectedGapId: null });
        toast.info(`Selected ${allClipIds.length} clip${allClipIds.length !== 1 ? "s" : ""}`);
        return;
      }

      // Escape: Deselect clip and track
      if (e.key === "Escape") {
        e.preventDefault();
        selectClip(null);
        selectTrack(null);
        return;
      }

      // Cmd/Ctrl+= or Cmd/Ctrl++: Zoom in
      if (isMeta && (e.key === "=" || e.key === "+" || e.code === "Equal" || e.code === "NumpadAdd")) {
        e.preventDefault();
        zoomByStep(1);
        return;
      }

      // Cmd/Ctrl+- or Cmd/Ctrl+_: Zoom out
      if (isMeta && (e.key === "-" || e.key === "_" || e.code === "Minus" || e.code === "NumpadSubtract")) {
        e.preventDefault();
        zoomByStep(-1);
        return;
      }

      // Cmd/Ctrl+0 or Shift+Z (without Cmd/Ctrl): Fit sequence to timeline
      if (
        (isMeta && (e.key === "0" || e.code === "Digit0" || e.code === "Numpad0")) ||
        (!isMeta && !e.ctrlKey && !e.altKey && e.shiftKey && (e.key.toLowerCase() === "z" || e.code === "KeyZ"))
      ) {
        e.preventDefault();
        fitSequence();
        return;
      }

      // Cmd/Ctrl+K or Cmd/Ctrl+Shift+K: Split clips at playhead
      if (isMeta && (e.key.toLowerCase() === "k" || e.code === "KeyK")) {
        e.preventDefault();
        if (e.shiftKey) {
          const results = EditingActions.splitAtPlayhead();
          if (results.length === 0) {
            toast.info("No clips under playhead to split");
          } else {
            const successCount = results.filter((r) => r.success).length;
            if (successCount > 0) {
              toast.success(formatSplitMessage(results));
            } else {
              toast.error(results.find((result) => result.error)?.error || "Split failed");
            }
          }
        } else {
          const store = useTimelineStore.getState();
          const selected = store.clips.filter((c) => selectedClipIds.includes(c.id));
          if (selected.length > 0) {
            const results = EditingActions.splitSelectedAtPlayhead(selectedClipIds);
            if (results.length === 0) {
              toast.info("No selected clips under playhead to split");
            } else {
              const successCount = results.filter((r) => r.success).length;
              if (successCount > 0) {
                toast.success(formatSplitMessage(results));
              } else {
                toast.error(results.find((result) => result.error)?.error || "Split failed");
              }
            }
          } else {
            const results = EditingActions.splitAtPlayhead();
            if (results.length === 0) {
              toast.info("No clips under playhead to split");
            } else {
              const successCount = results.filter((r) => r.success).length;
              if (successCount > 0) {
                toast.success(formatSplitMessage(results));
              } else {
                toast.error(results.find((result) => result.error)?.error || "Split failed");
              }
            }
          }
        }
        return;
      }

      // Ctrl/Cmd+] or Ctrl/Cmd+[: Nudge selected clips by frame
      if (isMeta && (e.key === "]" || e.key === "[" || e.code === "BracketRight" || e.code === "BracketLeft")) {
        e.preventDefault();
        const direction = e.key === "]" || e.code === "BracketRight" ? 1 : -1;
        const nudgeAmount = e.shiftKey ? 10 : 1; // Shift = 10 frames, no shift = 1 frame
        const frameTime = 1 / frameRate;
        const nudgeTime = direction * nudgeAmount * frameTime;

        const store = useTimelineStore.getState();
        const selectedClips = store.clips.filter((c) => selectedClipIds.includes(c.id));

        if (selectedClips.length === 0) {
          toast.info("No clips selected to nudge");
          return;
        }

        store.withBatch(() => {
          selectedClips.forEach((clip) => {
            const newStartTime = Math.max(0, clip.startTime + nudgeTime);
            store.updateClip(clip.id, { startTime: newStartTime });
          });
        });

        const directionText = direction > 0 ? "right" : "left";
        toast.info(`Nudged ${selectedClips.length} clip${selectedClips.length > 1 ? "s" : ""} ${directionText} by ${nudgeAmount} frame${nudgeAmount > 1 ? "s" : ""}`);
      } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        // Alt+Up/Down: Select clip on adjacent track
        const direction = e.key === "ArrowUp" ? -1 : 1;
        const store = useTimelineStore.getState();
        const uiStore = useUIStore.getState();

        // Get currently selected clip
        const currentClipId = selectedClipIds[0];
        if (!currentClipId) {
          toast.info("No clip selected");
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
          toast.info("No track " + (direction < 0 ? "above" : "below"));
          return;
        }

        const targetTrack = store.tracks[targetTrackIndex];

        // Find clip on target track closest to current clip's position
        const targetTrackClips = store.clips.filter((c) => c.trackId === targetTrack.id).sort((a, b) => Math.abs(a.startTime - currentClip.startTime) - Math.abs(b.startTime - currentClip.startTime));

        if (targetTrackClips.length === 0) {
          toast.info(`No clips on track ${direction < 0 ? "above" : "below"}`);
          return;
        }

        // Select the closest clip
        const closestClip = targetTrackClips[0];
        uiStore.selectClip(closestClip.id);
        toast.info(`Selected clip on track ${direction < 0 ? "above" : "below"}`);
      } else if (isMeta && e.altKey && (e.key.toLowerCase() === "l" || e.code === "KeyL")) {
        e.preventDefault();
        // Ctrl/Cmd+Alt+L: Toggle lock on selected track
        const uiStore = useUIStore.getState();
        const selectedTrackId = uiStore.selectedTrackId;

        if (!selectedTrackId) {
          toast.info("No track selected");
          return;
        }

        toggleTrackPropertyWithHistory(selectedTrackId, "locked");

        const track = useTimelineStore.getState().tracks.find((t) => t.id === selectedTrackId);
        toast.info(track?.locked ? "Track locked" : "Track unlocked");
      } else if (isMeta && e.altKey && (e.key.toLowerCase() === "v" || e.code === "KeyV")) {
        e.preventDefault();
        // Ctrl/Cmd+Alt+V: Toggle visibility on selected track
        const uiStore = useUIStore.getState();
        const selectedTrackId = uiStore.selectedTrackId;

        if (!selectedTrackId) {
          toast.info("No track selected");
          return;
        }

        toggleTrackPropertyWithHistory(selectedTrackId, "visible");

        const track = useTimelineStore.getState().tracks.find((t) => t.id === selectedTrackId);
        toast.info(track?.visible ? "Track visible" : "Track hidden");
      } else if (isMeta && e.altKey && (e.key.toLowerCase() === "m" || e.code === "KeyM")) {
        e.preventDefault();
        // Ctrl/Cmd+Alt+M: Toggle mute on selected track
        const uiStore = useUIStore.getState();
        const selectedTrackId = uiStore.selectedTrackId;

        if (!selectedTrackId) {
          toast.info("No track selected");
          return;
        }

        const store = useTimelineStore.getState();
        const trackBefore = store.tracks.find((track) => track.id === selectedTrackId);
        if (trackBefore?.locked) {
          toast.info("Unlock the track before changing mute");
          return;
        }
        toggleTrackPropertyWithHistory(selectedTrackId, "muted");

        const track = useTimelineStore.getState().tracks.find((t) => t.id === selectedTrackId);
        toast.info(track?.muted ? "Track muted" : "Track unmuted");
      } else if (isMeta && !e.altKey && !e.shiftKey && (e.key.toLowerCase() === "b" || e.code === "KeyB")) {
        e.preventDefault();
        // Ctrl/Cmd+B: Toggle media sidebar
        const settings = useSettingsStore.getState();
        settings.setSidebarCollapsed(!settings.sidebarCollapsed);
      } else if (
        ((e.altKey && !isMeta && !e.shiftKey) || (isMeta && e.shiftKey)) &&
        (e.key.toLowerCase() === "p" || e.code === "KeyP")
      ) {
        e.preventDefault();
        // Alt+P or Ctrl/Cmd+Shift+P: Toggle properties panel
        const settings = useSettingsStore.getState();
        settings.setPropertiesPanelCollapsed(!settings.propertiesPanelCollapsed);
      } else if (isMeta && e.altKey && (e.key.toLowerCase() === "p" || e.code === "KeyP")) {
        e.preventDefault();
        // Ctrl/Cmd+Alt+P: Pack selected track (remove gaps)
        const uiStore = useUIStore.getState();
        const selectedTrackId = uiStore.selectedTrackId;

        if (!selectedTrackId) {
          toast.info("No track selected");
          return;
        }

        // Import GapManager synchronously
        import("@/lib/timeline/gapManager").then(({ GapManager }) => {
          const unprotectedCount = GapManager.countUnprotectedGaps(selectedTrackId);

          if (unprotectedCount === 0) {
            toast.info("No unprotected gaps to remove");
            return;
          }

          GapManager.packTrack(selectedTrackId);
          toast.success(`Packed track - removed ${unprotectedCount} gap${unprotectedCount > 1 ? "s" : ""}`);
        });
      } else if (isMeta && e.altKey && (e.key.toLowerCase() === "t" || e.code === "KeyT")) {
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
        toast.success(`Added ${trackType} track`);

        // Select the new track
        useUIStore.getState().selectTrack(newTrackId);
      } else if (!isMeta && !e.altKey && (e.key.toLowerCase() === "m" || e.code === "KeyM")) {
        e.preventDefault();
        // M: Add marker at playhead position
        const liveTime = getPlaybackClock().time;
        const mins = Math.floor(liveTime / 60);
        const secs = Math.floor(liveTime % 60);
        const timeLabel = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
        addMarker(liveTime);
        toast.success(`Marker added at ${timeLabel}`);
      } else if (!isMeta && !e.altKey && (e.key.toLowerCase() === "s" || e.code === "KeyS")) {
        e.preventDefault();
        const results = EditingActions.splitAtPlayhead();

        if (results.length === 0) {
          toast.info("No clips under playhead to split");
        } else {
          const successCount = results.filter((r) => r.success).length;
          const failCount = results.length - successCount;

          if (successCount > 0) {
            toast.success(formatSplitMessage(results));
          } else if (failCount > 0) {
            toast.error(results[0].error || "Split failed");
          }
        }
      } else if (!isMeta && !e.altKey && (e.key.toLowerCase() === "q" || e.code === "KeyQ")) {
        e.preventDefault();
        const results = EditingActions.deleteLeftAtPlayhead();
        if (results.length === 0) {
          toast.info("No clips to delete left at playhead");
        } else {
          const successCount = results.filter((r) => r.success).length;
          toast.success(`Delete left applied to ${successCount} clip${successCount > 1 ? "s" : ""}`);
        }
      } else if (!isMeta && !e.altKey && (e.key.toLowerCase() === "w" || e.code === "KeyW")) {
        e.preventDefault();
        const results = EditingActions.deleteRightAtPlayhead();
        if (results.length === 0) {
          toast.info("No clips to delete right at playhead");
        } else {
          const successCount = results.filter((r) => r.success).length;
          toast.success(`Delete right applied to ${successCount} clip${successCount > 1 ? "s" : ""}`);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const isK = e.key.toLowerCase() === "k" || e.code === "KeyK";
      const isY = e.key.toLowerCase() === "y" || e.code === "KeyY";
      const isU = e.key.toLowerCase() === "u" || e.code === "KeyU";
      const isN = e.key.toLowerCase() === "n" || e.code === "KeyN";
      if (isK) kPressedRef.current = false;
      if (isY) yPressedRef.current = false;
      if (isU) uPressedRef.current = false;
      if (isN) nPressedRef.current = false;
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [transportTime, frameRate, selectedClipIds, previewMode, togglePlayback, play, pause, seek, setSpeed, setActiveContext, zoomByStep, fitSequence, selectClip, selectTrack, exitSourceMode, markSourceIn, markSourceOut, addMarker, undo, redo]);

  // Listen for native desktop application menu events ("menu-undo", "menu-redo").
  // On macOS, native menu bar accelerators (Cmd+Z / Shift+Cmd+Z) trigger menu events.
  useEffect(() => {
    let disposed = false;
    let unlistenUndo: (() => void) | undefined;
    let unlistenRedo: (() => void) | undefined;

    const setupMenuListeners = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        if (disposed) return;
        const uUndo = await listen("menu-undo", () => {
          const target = document.activeElement as HTMLElement | null;
          const isTyping =
            target &&
            (target.tagName === "INPUT" ||
              target.tagName === "TEXTAREA" ||
              target.isContentEditable);

          if (isTyping) {
            document.execCommand("undo");
            return;
          }

          useHistoryStore.getState().undo();
        });

        if (disposed) {
          uUndo();
          return;
        }
        unlistenUndo = uUndo;

        const uRedo = await listen("menu-redo", () => {
          const target = document.activeElement as HTMLElement | null;
          const isTyping =
            target &&
            (target.tagName === "INPUT" ||
              target.tagName === "TEXTAREA" ||
              target.isContentEditable);

          if (isTyping) {
            document.execCommand("redo");
            return;
          }

          useHistoryStore.getState().redo();
        });

        if (disposed) {
          uRedo();
          return;
        }
        unlistenRedo = uRedo;
      } catch {
        // Fallback for non-Tauri / test environments
      }
    };

    void setupMenuListeners();

    return () => {
      disposed = true;
      unlistenUndo?.();
      unlistenRedo?.();
    };
  }, []);

  return { toastMessage: null };
};

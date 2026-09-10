/**
 * Timeline Commands Registry
 *
 * Canonical commands for timeline empty space and track actions.
 */

import {
  ClipboardPaste,
  ScissorsLineDashed,
  Scissors,
  Plus,
  Lock,
  VolumeX,
  EyeOff,
  CheckSquare,
  Trash2,
} from "lucide-react";
import type { TimelineCommand } from "./types";
import { clipboardService } from "@/core/clipboard/clipboardService";
import { useTimelineStore } from "@/store/timelineStore";
import { useUIStore } from "@/store/uiStore";
import { toast } from "@/lib/toast";
import { GapManager } from "@/lib/timeline/gapManager";
import { toggleTrackPropertyWithHistory } from "@/core/history/trackPropertyActions";
import { EditingActions } from "@/core/interactions";

export const timelineCommands: TimelineCommand[] = [
  // ─── Clipboard ──────────────────────────────────────────────────────────────
  {
    id: "timeline.paste",
    label: "Paste at Cursor",
    shortcutId: "paste-clips",
    shortcutLabel: "⌘V",
    icon: ClipboardPaste,
    group: "clipboard",
    isVisible: () => true,
    isEnabled: () => clipboardService.hasClips(),
    disabledReason: () => "Clipboard is empty",
    execute: (ctx) => {
      clipboardService.pasteClips(
        ctx.clickedTime,
        ctx.clickedTrackId || undefined,
      );
    },
  },

  // ─── Gaps ───────────────────────────────────────────────────────────────────
  {
    id: "timeline.insertGap",
    label: "Insert Gap (2s)",
    shortcutLabel: "I",
    icon: ScissorsLineDashed,
    group: "gap",
    isVisible: () => true,
    isEnabled: (ctx) => Boolean(ctx.clickedTrackId || ctx.tracks[0]?.id),
    disabledReason: () => "No track available",
    execute: async (ctx) => {
      const trackId = ctx.clickedTrackId || ctx.tracks[0]?.id;
      if (!trackId) return;
      const { GapManager } = await import("@/lib/timeline/gapManager");
      GapManager.insertGap(trackId, ctx.clickedTime, 2.0);
      toast.success("Inserted 2s gap");
    },
  },
  {
    id: "timeline.closeTrackGaps",
    label: "Close All Gaps on Track",
    icon: Scissors,
    group: "gap",
    isVisible: (ctx) => Boolean(ctx.clickedTrackId),
    isEnabled: (ctx) =>
      Boolean(
        ctx.clickedTrackId &&
        !ctx.tracks.find((track) => track.id === ctx.clickedTrackId)?.locked,
      ),
    disabledReason: () => "Track is locked or no track is selected",
    execute: (ctx) => {
      if (!ctx.clickedTrackId) return;
      GapManager.packTrack(ctx.clickedTrackId);
      toast.success("Closed track gaps");
    },
  },
  {
    id: "timeline.closeAllGaps",
    label: "Close All Timeline Gaps",
    icon: Scissors,
    group: "gap",
    isVisible: () => true,
    isEnabled: (ctx) => ctx.tracks.some((track) => !track.locked),
    disabledReason: () => "No unlocked track available",
    execute: () => {
      GapManager.packAllTracks();
      toast.success("Closed timeline gaps");
    },
  },

  // ─── Track Operations ───────────────────────────────────────────────────────
  {
    id: "timeline.addVideoTrack",
    label: "Add Video Track",
    icon: Plus,
    group: "track",
    isVisible: () => true,
    isEnabled: () => true,
    execute: () => {
      const store = useTimelineStore.getState();
      const newTrackId = store.insertTrackAt("video", store.tracks.length);
      useUIStore.getState().selectTrack(newTrackId);
      toast.success("Added video track");
    },
  },
  {
    id: "timeline.addAudioTrack",
    label: "Add Audio Track",
    icon: Plus,
    group: "track",
    isVisible: () => true,
    isEnabled: () => true,
    execute: () => {
      const store = useTimelineStore.getState();
      const newTrackId = store.insertTrackAt("audio", store.tracks.length);
      useUIStore.getState().selectTrack(newTrackId);
      toast.success("Added audio track");
    },
  },
  {
    id: "timeline.toggleTrackLock",
    label: "Toggle Track Lock",
    shortcutId: "toggle-track-lock",
    shortcutLabel: "⌘⌥L",
    icon: Lock,
    group: "track",
    isVisible: (ctx) => Boolean(ctx.clickedTrackId),
    isEnabled: (ctx) => Boolean(ctx.clickedTrackId),
    execute: (ctx) => {
      if (!ctx.clickedTrackId) return;
      toggleTrackPropertyWithHistory(ctx.clickedTrackId, "locked");
      const track = useTimelineStore
        .getState()
        .tracks.find((t) => t.id === ctx.clickedTrackId);
      toast.info(track?.locked ? "Track locked" : "Track unlocked");
    },
  },
  {
    id: "timeline.toggleTrackMute",
    label: "Toggle Track Mute",
    shortcutId: "toggle-track-mute",
    shortcutLabel: "⌘⌥M",
    icon: VolumeX,
    group: "track",
    isVisible: (ctx) => Boolean(ctx.clickedTrackId),
    isEnabled: (ctx) =>
      Boolean(
        ctx.clickedTrackId &&
        !ctx.tracks.find((track) => track.id === ctx.clickedTrackId)?.locked,
      ),
    disabledReason: () => "Unlock the track before changing mute",
    execute: (ctx) => {
      if (!ctx.clickedTrackId) return;
      const store = useTimelineStore.getState();
      const trackBefore = store.tracks.find(
        (track) => track.id === ctx.clickedTrackId,
      );
      if (trackBefore?.locked) {
        toast.info("Unlock the track before changing mute");
        return;
      }
      toggleTrackPropertyWithHistory(ctx.clickedTrackId, "muted");
      const track = useTimelineStore
        .getState()
        .tracks.find((t) => t.id === ctx.clickedTrackId);
      toast.info(track?.muted ? "Track muted" : "Track unmuted");
    },
  },
  {
    id: "timeline.toggleTrackVisibility",
    label: "Toggle Track Visibility",
    shortcutId: "toggle-track-visibility",
    shortcutLabel: "⌘⌥V",
    icon: EyeOff,
    group: "track",
    isVisible: (ctx) => Boolean(ctx.clickedTrackId),
    isEnabled: (ctx) => Boolean(ctx.clickedTrackId),
    execute: (ctx) => {
      if (!ctx.clickedTrackId) return;
      toggleTrackPropertyWithHistory(ctx.clickedTrackId, "visible");
      const track = useTimelineStore
        .getState()
        .tracks.find((t) => t.id === ctx.clickedTrackId);
      toast.info(track?.visible ? "Track visible" : "Track hidden");
    },
  },

  // ─── Track Clip Selection & Deletion ────────────────────────────────────────
  {
    id: "track.selectAllClips",
    label: "Select All Clips in Track",
    shortcutLabel: "⌘A",
    icon: CheckSquare,
    group: "track",
    isVisible: (ctx) => Boolean(ctx.clickedTrackId),
    isEnabled: (ctx) => {
      if (!ctx.clickedTrackId) return false;
      return ctx.clips.some((c) => c.trackId === ctx.clickedTrackId);
    },
    disabledReason: () => "Track has no clips",
    execute: (ctx) => {
      if (!ctx.clickedTrackId) return;
      useUIStore.getState().selectAllClipsInTrack(ctx.clickedTrackId);
    },
  },
  {
    id: "track.deleteAllClips",
    label: "Delete All Clips in Track",
    icon: Trash2,
    group: "track",
    danger: true,
    isVisible: (ctx) => Boolean(ctx.clickedTrackId),
    isEnabled: (ctx) => {
      if (!ctx.clickedTrackId) return false;
      const track = ctx.tracks.find((t) => t.id === ctx.clickedTrackId);
      if (track?.locked) return false;
      return ctx.clips.some((c) => c.trackId === ctx.clickedTrackId);
    },
    disabledReason: (ctx) => {
      const track = ctx.tracks.find((t) => t.id === ctx.clickedTrackId);
      return track?.locked ? "Track is locked" : "Track has no clips";
    },
    execute: (ctx) => {
      if (!ctx.clickedTrackId) return;
      const ids = ctx.clips
        .filter((c) => c.trackId === ctx.clickedTrackId)
        .map((c) => c.id);
      if (ids.length === 0) return;
      const result = EditingActions.deleteSelection(ids, false);
      if (result) {
        toast.success(
          `Deleted ${result.deletedClipIds.length} clip${result.deletedClipIds.length !== 1 ? "s" : ""} from track`,
        );
      }
    },
  },
];

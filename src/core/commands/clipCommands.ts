/**
 * Clip Commands Registry
 *
 * Single source of truth for all timeline clip actions.
 * Grouped according to professional NLE standards (Premiere Pro / DaVinci Resolve).
 */

import {
  Scissors,
  ScissorsLineDashed,
  Copy,
  ClipboardPaste,
  CopyPlus,
  Trash2,
  Volume2,
  VolumeX,
  Sliders,
  ArrowLeftRight,
  CheckSquare,
  Square,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { ClipCommand, ClipCommandContext } from "./types";
import { clipboardService } from "@/core/clipboard/clipboardService";
import { EditingActions } from "@/core/interactions";
import { useTimelineStore } from "@/store/timelineStore";
import { useUIStore } from "@/store/uiStore";
import { toast } from "@/lib/toast";

function getTargetClipIds(ctx: ClipCommandContext): string[] {
  if (ctx.selectedClipIds.length > 0) {
    // If a specific clip was clicked and is part of the selection, use full selection.
    // If a clip outside selection was right-clicked, use clicked clip.
    if (ctx.clickedClipId && !ctx.selectedClipIds.includes(ctx.clickedClipId)) {
      return [ctx.clickedClipId];
    }
    return ctx.selectedClipIds;
  }
  return ctx.clickedClipId ? [ctx.clickedClipId] : [];
}

export const clipCommands: ClipCommand[] = [
  // ─── Clipboard & Duplication ────────────────────────────────────────────────
  {
    id: "clip.cut",
    label: "Cut",
    shortcutId: "cut-clips",
    shortcutLabel: "⌘X",
    icon: Scissors,
    group: "clipboard",
    isVisible: (ctx) => getTargetClipIds(ctx).length > 0,
    isEnabled: (ctx) => {
      const ids = getTargetClipIds(ctx);
      if (ids.length === 0) return false;
      return ids.some((id) => {
        const c = ctx.clips.find((clip) => clip.id === id);
        return c && !ctx.tracks.find((t) => t.id === c.trackId)?.locked;
      });
    },
    disabledReason: () => "Selected clips are on a locked track",
    execute: (ctx) => {
      const ids = getTargetClipIds(ctx);
      clipboardService.cutClips(ids, false);
    },
  },
  {
    id: "clip.copy",
    label: "Copy",
    shortcutId: "copy-clips",
    shortcutLabel: "⌘C",
    icon: Copy,
    group: "clipboard",
    isVisible: () => true,
    isEnabled: (ctx) => getTargetClipIds(ctx).length > 0,
    disabledReason: () => "No clip selected",
    execute: (ctx) => {
      const ids = getTargetClipIds(ctx);
      clipboardService.copyClips(ids);
    },
  },
  {
    id: "clip.paste",
    label: "Paste at Playhead",
    shortcutId: "paste-clips",
    shortcutLabel: "⌘V",
    icon: ClipboardPaste,
    group: "clipboard",
    isVisible: () => true,
    isEnabled: () => clipboardService.hasClips(),
    disabledReason: () => "Clipboard is empty",
    execute: (ctx) => {
      clipboardService.pasteClips(ctx.playheadTime, ctx.clickedTrackId || undefined);
    },
  },
  {
    id: "clip.duplicate",
    label: "Duplicate",
    shortcutId: "duplicate-clips",
    shortcutLabel: "⌘D",
    icon: CopyPlus,
    group: "clipboard",
    isVisible: () => true,
    isEnabled: (ctx) => getTargetClipIds(ctx).length > 0,
    disabledReason: () => "No clip selected",
    execute: (ctx) => {
      const ids = getTargetClipIds(ctx);
      clipboardService.duplicateClips(ids);
    },
  },

  // ─── Trim & Split ───────────────────────────────────────────────────────────
  {
    id: "clip.splitAtPlayhead",
    label: "Split at Playhead",
    shortcutId: "split-selected-at-playhead",
    shortcutLabel: "⌘K",
    icon: ScissorsLineDashed,
    group: "trim",
    isVisible: () => true,
    isEnabled: (ctx) => {
      const ids = getTargetClipIds(ctx);
      const targetClips = ctx.clips.filter((c) => ids.includes(c.id));
      return targetClips.some((c) => {
        const isUnlocked = !ctx.tracks.find((t) => t.id === c.trackId)?.locked;
        return isUnlocked && ctx.playheadTime > c.startTime && ctx.playheadTime < c.startTime + c.duration;
      });
    },
    disabledReason: (ctx) => {
      const ids = getTargetClipIds(ctx);
      const targetClips = ctx.clips.filter((c) => ids.includes(c.id));
      const intersects = targetClips.some(
        (c) => ctx.playheadTime > c.startTime && ctx.playheadTime < c.startTime + c.duration,
      );
      if (!intersects) return "Playhead is outside clip bounds";
      return "Clip is on a locked track";
    },
    execute: (ctx) => {
      const ids = getTargetClipIds(ctx);
      const results = EditingActions.splitSelectedAtPlayhead(ids);
      if (results.length > 0) {
        const successCount = results.filter((r) => r.success).length;
        if (successCount > 0) {
          toast.success(`Split ${successCount} clip${successCount > 1 ? "s" : ""}`);
        } else if (results[0].error) {
          toast.error(results[0].error);
        }
      } else {
        toast.info("Playhead is outside clip bounds");
      }
    },
  },
  {
    id: "clip.trimStartToPlayhead",
    label: "Trim Start to Playhead",
    shortcutId: "delete-left-at-playhead",
    shortcutLabel: "Q",
    icon: ChevronLeft,
    group: "trim",
    isVisible: (ctx) => ctx.selectedClipIds.length <= 1,
    isEnabled: (ctx) => {
      const ids = getTargetClipIds(ctx);
      const targetClips = ctx.clips.filter((c) => ids.includes(c.id));
      return targetClips.some((c) => {
        const isUnlocked = !ctx.tracks.find((t) => t.id === c.trackId)?.locked;
        return isUnlocked && ctx.playheadTime > c.startTime && ctx.playheadTime < c.startTime + c.duration;
      });
    },
    disabledReason: () => "Playhead is outside clip bounds",
    execute: () => {
      const results = EditingActions.deleteLeftAtPlayhead();
      const successCount = results.filter((r) => r.success).length;
      if (successCount > 0) {
        toast.success(`Trimmed start on ${successCount} clip${successCount > 1 ? "s" : ""}`);
      } else {
        toast.info("No clips under playhead to trim");
      }
    },
  },
  {
    id: "clip.trimEndToPlayhead",
    label: "Trim End to Playhead",
    shortcutId: "delete-right-at-playhead",
    shortcutLabel: "W",
    icon: ChevronRight,
    group: "trim",
    isVisible: (ctx) => ctx.selectedClipIds.length <= 1,
    isEnabled: (ctx) => {
      const ids = getTargetClipIds(ctx);
      const targetClips = ctx.clips.filter((c) => ids.includes(c.id));
      return targetClips.some((c) => {
        const isUnlocked = !ctx.tracks.find((t) => t.id === c.trackId)?.locked;
        return isUnlocked && ctx.playheadTime > c.startTime && ctx.playheadTime < c.startTime + c.duration;
      });
    },
    disabledReason: () => "Playhead is outside clip bounds",
    execute: () => {
      const results = EditingActions.deleteRightAtPlayhead();
      const successCount = results.filter((r) => r.success).length;
      if (successCount > 0) {
        toast.success(`Trimmed end on ${successCount} clip${successCount > 1 ? "s" : ""}`);
      } else {
        toast.info("No clips under playhead to trim");
      }
    },
  },
  {
    id: "clip.rippleDelete",
    label: "Ripple Delete",
    shortcutLabel: "⌫",
    icon: Trash2,
    group: "trim",
    danger: true,
    isVisible: () => true,
    isEnabled: (ctx) => {
      const ids = getTargetClipIds(ctx);
      if (ids.length === 0) return false;
      return ids.some((id) => {
        const c = ctx.clips.find((clip) => clip.id === id);
        return c && !ctx.tracks.find((t) => t.id === c.trackId)?.locked;
      });
    },
    disabledReason: () => "Selected clips are on a locked track",
    execute: (ctx) => {
      const ids = getTargetClipIds(ctx);
      const result = EditingActions.deleteSelection(ids, false);
      if (result) {
        toast.success(`Ripple deleted ${result.deletedClipIds.length} clip${result.deletedClipIds.length > 1 ? "s" : ""}`);
      }
    },
  },
  {
    id: "clip.delete",
    label: "Delete / Lift (Leave Gap)",
    shortcutLabel: "⌥⌫",
    icon: Trash2,
    group: "trim",
    danger: true,
    isVisible: () => true,
    isEnabled: (ctx) => {
      const ids = getTargetClipIds(ctx);
      if (ids.length === 0) return false;
      return ids.some((id) => {
        const c = ctx.clips.find((clip) => clip.id === id);
        return c && !ctx.tracks.find((t) => t.id === c.trackId)?.locked;
      });
    },
    disabledReason: () => "Selected clips are on a locked track",
    execute: (ctx) => {
      const ids = getTargetClipIds(ctx);
      const result = EditingActions.deleteSelection(ids, true);
      if (result) {
        toast.success(`Lift deleted ${result.deletedClipIds.length} clip${result.deletedClipIds.length > 1 ? "s" : ""}`);
      }
    },
  },

  // ─── Audio ──────────────────────────────────────────────────────────────────
  {
    id: "clip.toggleMute",
    label: "Mute / Unmute",
    icon: VolumeX,
    group: "audio",
    isVisible: () => true,
    isEnabled: (ctx) => getTargetClipIds(ctx).length > 0,
    disabledReason: () => "No clip selected",
    execute: (ctx) => {
      const ids = getTargetClipIds(ctx);
      const store = useTimelineStore.getState();
      const targetClips = store.clips.filter((c) => ids.includes(c.id));
      if (targetClips.length === 0) return;

      const allMuted = targetClips.every((c) => c.volume === 0);
      store.withBatch(() => {
        targetClips.forEach((clip) => {
          store.updateClip(clip.id, { volume: allMuted ? 1.0 : 0.0 });
        });
      });
      toast.info(allMuted ? `Unmuted ${targetClips.length} clip(s)` : `Muted ${targetClips.length} clip(s)`);
    },
  },
  {
    id: "clip.resetAudioGain",
    label: "Reset Volume to 100%",
    icon: Sliders,
    group: "audio",
    isVisible: () => true,
    isEnabled: (ctx) => getTargetClipIds(ctx).length > 0,
    disabledReason: () => "No clip selected",
    execute: (ctx) => {
      const ids = getTargetClipIds(ctx);
      const store = useTimelineStore.getState();
      store.withBatch(() => {
        ids.forEach((id) => store.updateClip(id, { volume: 1.0 }));
      });
      toast.success("Reset clip volume to 100%");
    },
  },

  // ─── Organization ───────────────────────────────────────────────────────────
  {
    id: "clip.swap",
    label: "Swap Clips",
    shortcutId: "swap-clips",
    shortcutLabel: "⌘⇧S",
    icon: ArrowLeftRight,
    group: "organize",
    isVisible: (ctx) => ctx.selectedClipIds.length === 2,
    isEnabled: (ctx) => ctx.selectedClipIds.length === 2,
    disabledReason: () => "Requires exactly 2 clips selected",
    execute: () => {
      const result = useTimelineStore.getState().swapClips();
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Swapped clips");
      }
    },
  },
  {
    id: "clip.selectAll",
    label: "Select All Clips",
    shortcutId: "select-all",
    shortcutLabel: "⌘A",
    icon: CheckSquare,
    group: "organize",
    isVisible: () => true,
    isEnabled: (ctx) => ctx.clips.length > 0,
    disabledReason: () => "Timeline is empty",
    execute: (ctx) => {
      useUIStore.setState({
        selectedClipIds: ctx.clips.map((c) => c.id),
        selectedGapId: null,
      });
    },
  },
  {
    id: "clip.deselectAll",
    label: "Deselect All",
    shortcutId: "deselect-all",
    shortcutLabel: "⌘⇧D",
    icon: Square,
    group: "organize",
    isVisible: (ctx) => ctx.selectedClipIds.length > 0,
    isEnabled: (ctx) => ctx.selectedClipIds.length > 0,
    disabledReason: () => "Nothing selected",
    execute: () => {
      useUIStore.getState().clearSelection();
    },
  },

  // ─── Info & Inspector ───────────────────────────────────────────────────────
  {
    id: "clip.inspectProperties",
    label: "Inspect Properties",
    icon: SlidersHorizontal,
    group: "info",
    isVisible: (ctx) => ctx.selectedClipIds.length <= 1,
    isEnabled: (ctx) => getTargetClipIds(ctx).length > 0,
    disabledReason: () => "No clip selected",
    execute: (ctx) => {
      const ids = getTargetClipIds(ctx);
      if (ids[0]) {
        useUIStore.getState().selectClip(ids[0]);
        useUIStore.getState().setActivePanel("properties");
      }
    },
  },
];

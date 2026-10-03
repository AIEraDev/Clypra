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
  AudioLines,
  Layers,
  Ungroup,
  Pencil,
  Link2,
  Sparkles,
  Gauge,
  Snowflake,
  FlipHorizontal2,
  RotateCcw,
} from "lucide-react";
import type { ClipCommand, ClipCommandContext } from "./types";
import type { PlaybackMapping } from "@/types";
import { resolveClipSourceTime } from "@/core/timeline/sourceTime";
import { getPlaybackClock } from "@/hooks/usePlaybackClock";
import { clipboardService } from "@/core/clipboard/clipboardService";
import { EditingActions } from "@/core/interactions";
import { useTimelineStore } from "@/store/timelineStore";
import { useUIStore } from "@/store/uiStore";
import { toast } from "@/lib/toast";
import { useHistoryStore } from "@/store/historyStore";
import { useProjectStore } from "@/store/projectStore";
import { DetachAudioCommand } from "@/core/history/commands/DetachAudioCommand";
import { SwapClipsCommand } from "@/core/history/commands/SwapClipsCommand";
import { useMediaJobStore } from "@/store/mediaJobStore";
import { validateGroupSelection } from "@/core/history/commands/CompoundClipCommands";
import { formatSplitMessage } from "@/lib/timeline/clipName";
import { getClipDisplayName } from "@/lib/timeline/clipName";
import { bakeClymatteClip } from "@/features/body-effects";
import { assetHasAudio, clipHasAudio } from "@/core/media/mediaAudioDetection";

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

function getPlayheadTargetClips(ctx: ClipCommandContext): ClipCommandContext["clips"] {
  const ids = getTargetClipIds(ctx);
  if (ids.length > 0) return ctx.clips.filter((clip) => ids.includes(clip.id));
  return ctx.clips.filter((clip) => ctx.playheadTime > clip.startTime && ctx.playheadTime < clip.startTime + clip.duration);
}

function isWithinPlayhead(clip: ClipCommandContext["clips"][number], playheadTime: number): boolean {
  return playheadTime > clip.startTime && playheadTime < clip.startTime + clip.duration;
}

export const clipCommands: ClipCommand[] = [
  {
    id: "clip.rename",
    label: "Rename Clip",
    icon: Pencil,
    group: "organize",
    isVisible: (ctx) => getTargetClipIds(ctx).length === 1,
    isEnabled: (ctx) => {
      const clip = ctx.clips.find((candidate) => candidate.id === getTargetClipIds(ctx)[0]);
      return !!clip && !ctx.tracks.find((track) => track.id === clip.trackId)?.locked;
    },
    disabledReason: () => "The clip is on a locked track",
    execute: (ctx) => {
      const clipId = getTargetClipIds(ctx)[0];
      const clip = ctx.clips.find((candidate) => candidate.id === clipId);
      if (!clip) return;

      const currentName = getClipDisplayName(clip, useProjectStore.getState().mediaAssets);
      const nextName = typeof window !== "undefined" ? window.prompt("Rename Clip", currentName) : null;
      if (nextName === null) return;

      const result = EditingActions.renameClip(clipId, nextName);
      if (result.success) toast.success(`Renamed clip to “${result.name}”`);
      else if (result.error) toast.error(result.error);
    },
  },
  {
    id: "clip.group",
    label: "Group Clips",
    shortcutId: "group-clips",
    shortcutLabel: "Alt+G",
    icon: Layers,
    group: "organize",
    isVisible: (ctx) => getTargetClipIds(ctx).length >= 2,
    isEnabled: (ctx) => validateGroupSelection(getTargetClipIds(ctx), ctx.clips, ctx.tracks, ctx.transitions).valid,
    disabledReason: (ctx) => {
      const validation = validateGroupSelection(getTargetClipIds(ctx), ctx.clips, ctx.tracks, ctx.transitions);
      return validation.valid ? undefined : validation.reason;
    },
    execute: (ctx) => {
      const result = EditingActions.groupSelectedClips(getTargetClipIds(ctx));
      if (result.success) toast.success("Grouped clips");
      else if (result.error) toast.error(result.error);
    },
  },
  {
    id: "clip.ungroup",
    label: "Ungroup",
    icon: Ungroup,
    group: "organize",
    isVisible: (ctx) => getTargetClipIds(ctx).some((id) => ctx.clips.some((clip) => clip.id === id && clip.kind === "compound")),
    isEnabled: (ctx) => getTargetClipIds(ctx).some((id) => {
      const clip = ctx.clips.find((candidate) => candidate.id === id);
      return !!clip && clip.kind === "compound" && !ctx.tracks.find((track) => track.id === clip.trackId)?.locked;
    }),
    disabledReason: () => "The compound track is locked",
    execute: (ctx) => {
      const compound = getTargetClipIds(ctx).map((id) => ctx.clips.find((clip) => clip.id === id)).find((clip) => clip?.kind === "compound");
      if (!compound) return;
      const result = EditingActions.ungroupClip(compound.id);
      if (result.success) toast.success("Ungrouped clips");
      else if (result.error) toast.error(result.error);
    },
  },
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
    id: "clip.splitAllAtPlayhead",
    label: "Split All at Playhead",
    shortcutLabel: "S",
    icon: ScissorsLineDashed,
    group: "trim",
    isVisible: () => true,
    isEnabled: (ctx) => getPlayheadTargetClips(ctx).some((clip) => clip.kind !== "compound" && !ctx.tracks.find((track) => track.id === clip.trackId)?.locked),
    disabledReason: () => "No unlocked clips under playhead",
    execute: () => {
      const results = EditingActions.splitAllAtPlayhead();
      const successCount = results.filter((result) => result.success).length;
      if (successCount > 0) toast.success(formatSplitMessage(results));
      else toast.info("No clips under playhead to split");
    },
  },
  {
    id: "clip.splitAtPlayhead",
    label: "Split at Playhead",
    shortcutId: "split-selected-at-playhead",
    shortcutLabel: "⌘K",
    icon: ScissorsLineDashed,
    group: "trim",
    isVisible: () => true,
    isEnabled: (ctx) => {
      const targetClips = getPlayheadTargetClips(ctx);
      return targetClips.some((c) => {
        const isUnlocked = !ctx.tracks.find((t) => t.id === c.trackId)?.locked;
        return c.kind !== "compound" && isUnlocked && ctx.playheadTime > c.startTime && ctx.playheadTime < c.startTime + c.duration;
      });
    },
    disabledReason: (ctx) => {
      const targetClips = getPlayheadTargetClips(ctx);
      const intersects = targetClips.some((c) => c.kind !== "compound" && !ctx.tracks.find((track) => track.id === c.trackId)?.locked && isWithinPlayhead(c, ctx.playheadTime));
      if (targetClips.some((clip) => clip.kind === "compound")) return "Compound clips are move-only; ungroup them before splitting";
      if (!intersects && !targetClips.some((clip) => isWithinPlayhead(clip, ctx.playheadTime))) return "Playhead is outside clip bounds";
      return "Clip is on a locked track";
    },
    execute: (ctx) => {
      const ids = getTargetClipIds(ctx);
      const results = EditingActions.splitSelectedAtPlayhead(ids);
      if (results.length > 0) {
        const successCount = results.filter((r) => r.success).length;
        if (successCount > 0) {
          toast.success(formatSplitMessage(results));
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
      const targetClips = getPlayheadTargetClips(ctx);
      return targetClips.some((c) => {
        const isUnlocked = !ctx.tracks.find((t) => t.id === c.trackId)?.locked;
        return c.kind !== "compound" && isUnlocked && ctx.playheadTime > c.startTime && ctx.playheadTime < c.startTime + c.duration;
      });
    },
    disabledReason: (ctx) => getPlayheadTargetClips(ctx).some((clip) => clip.kind === "compound")
      ? "Compound clips are move-only; ungroup them before trimming"
      : "Playhead is outside clip bounds",
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
      const targetClips = getPlayheadTargetClips(ctx);
      return targetClips.some((c) => {
        const isUnlocked = !ctx.tracks.find((t) => t.id === c.trackId)?.locked;
        return c.kind !== "compound" && isUnlocked && ctx.playheadTime > c.startTime && ctx.playheadTime < c.startTime + c.duration;
      });
    },
    disabledReason: (ctx) => getPlayheadTargetClips(ctx).some((clip) => clip.kind === "compound")
      ? "Compound clips are move-only; ungroup them before trimming"
      : "Playhead is outside clip bounds",
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
    id: "clip.detachAudio",
    label: "Detach Audio",
    icon: AudioLines,
    group: "audio",
    isVisible: (ctx) => getTargetClipIds(ctx).some((id) => ctx.clips.some((clip) => clip.id === id && clip.kind !== "audio")),
    isEnabled: (ctx) => {
      const assets = useProjectStore.getState().mediaAssets;
      return getTargetClipIds(ctx).some((id) => {
        const clip = ctx.clips.find((candidate) => candidate.id === id);
        if (!clip || clip.kind === "audio") return false;
        const track = ctx.tracks.find((candidate) => candidate.id === clip.trackId);
        const asset = assets.find((candidate) => candidate.id === clip.mediaId);
        return (
          track?.type === "video" &&
          !track.locked &&
          asset?.type === "video" &&
          assetHasAudio(asset) &&
          !DetachAudioCommand.isAlreadyDetached(clip, ctx.clips)
        );
      });
    },
    disabledReason: (ctx) => {
      const assets = useProjectStore.getState().mediaAssets;
      const clipId = getTargetClipIds(ctx)[0];
      const clip = ctx.clips.find((candidate) => candidate.id === clipId);
      if (!clip) return "No clip selected";
      const asset = assets.find((candidate) => candidate.id === clip.mediaId);
      if (asset && !assetHasAudio(asset)) return "Video has no audio stream to detach";
      return "Audio is already detached, the clip has no video source, or its track is locked";
    },
    execute: (ctx) => {
      const assets = useProjectStore.getState().mediaAssets;
      const clipId = getTargetClipIds(ctx)[0];
      const clip = ctx.clips.find((candidate) => candidate.id === clipId);
      if (!clip) return;
      const asset = assets.find((candidate) => candidate.id === clip.mediaId);
      if (!asset) return;
      useHistoryStore.getState().execute(new DetachAudioCommand(clip, asset.path, ctx.tracks));
      toast.success("Audio detached");
    },
  },

  {
    id: "clip.toggleMute",
    label: "Mute / Unmute",
    icon: VolumeX,
    group: "audio",
    isVisible: () => true,
    isEnabled: (ctx) => {
      const assets = useProjectStore.getState().mediaAssets;
      return getTargetClipIds(ctx).some((id) => {
        const clip = ctx.clips.find((c) => c.id === id);
        if (!clip) return false;
        const asset = assets.find((a) => a.id === clip.mediaId);
        return clipHasAudio(clip, asset);
      });
    },
    disabledReason: (ctx) => {
      if (getTargetClipIds(ctx).length === 0) return "No clip selected";
      return "Selected clip has no audio to mute";
    },
    execute: (ctx) => {
      const ids = getTargetClipIds(ctx);
      const store = useTimelineStore.getState();
      const assets = useProjectStore.getState().mediaAssets;
      const targetClips = store.clips.filter((c) =>
        ids.includes(c.id) &&
        clipHasAudio(c, assets.find((a) => a.id === c.mediaId)),
      );
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
    isEnabled: (ctx) => {
      const assets = useProjectStore.getState().mediaAssets;
      return getTargetClipIds(ctx).some((id) => {
        const clip = ctx.clips.find((c) => c.id === id);
        if (!clip) return false;
        const asset = assets.find((a) => a.id === clip.mediaId);
        return clipHasAudio(clip, asset);
      });
    },
    disabledReason: (ctx) => {
      if (getTargetClipIds(ctx).length === 0) return "No clip selected";
      return "Selected clip has no audio";
    },
    execute: (ctx) => {
      const ids = getTargetClipIds(ctx);
      const store = useTimelineStore.getState();
      const assets = useProjectStore.getState().mediaAssets;
      const targetClips = store.clips.filter((c) =>
        ids.includes(c.id) &&
        clipHasAudio(c, assets.find((a) => a.id === c.mediaId)),
      );
      if (targetClips.length === 0) return;

      store.withBatch(() => {
        targetClips.forEach((clip) => store.updateClip(clip.id, { volume: 1.0 }));
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
    isEnabled: (ctx) => ctx.selectedClipIds.length === 2 && !SwapClipsCommand.validate({
      clips: ctx.clips,
      tracks: ctx.tracks,
      transitions: ctx.transitions ?? [],
      epoch: 0,
    }, ctx.selectedClipIds[0], ctx.selectedClipIds[1]),
    disabledReason: (ctx) => SwapClipsCommand.validate({
      clips: ctx.clips,
      tracks: ctx.tracks,
      transitions: ctx.transitions ?? [],
      epoch: 0,
    }, ctx.selectedClipIds[0], ctx.selectedClipIds[1]) ?? "Selected clips must be on unlocked tracks",
    execute: () => {
      const result = EditingActions.swapSelectedClips();
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

  // ─── Media Management ───────────────────────────────────────────────────────
  {
    id: "clip.relinkMedia",
    label: "Relink Media...",
    icon: Link2,
    group: "media",
    isVisible: (ctx) => {
      const ids = getTargetClipIds(ctx);
      if (ids.length !== 1) return false;
      const clip = ctx.clips.find((c) => c.id === ids[0]);
      if (!clip || !clip.mediaId) return false;
      return !clip.id.startsWith("text-clip-") && clip.kind !== "text" && clip.kind !== "filter";
    },
    isEnabled: (ctx) => {
      const ids = getTargetClipIds(ctx);
      const clip = ctx.clips.find((c) => c.id === ids[0]);
      return !!clip?.mediaId;
    },
    execute: (ctx) => {
      const ids = getTargetClipIds(ctx);
      const clip = ctx.clips.find((c) => c.id === ids[0]);
      if (clip?.mediaId) {
        void useProjectStore.getState().promptRelinkMedia(clip.mediaId);
      }
    },
  },
  {
    id: "clip.bakeSubjectMask",
    label: "Bake Subject Mask (Render in Place)",
    icon: Sparkles,
    group: "media",
    isVisible: (ctx) => {
      const ids = getTargetClipIds(ctx);
      if (ids.length !== 1) return false;
      const clip = ctx.clips.find((c) => c.id === ids[0]);
      if (!clip) return false;
      return clip.kind === "video" || (!clip.id.startsWith("text-clip-") && clip.kind !== "text" && clip.kind !== "filter" && clip.kind !== "audio");
    },
    isEnabled: (ctx) => {
      const ids = getTargetClipIds(ctx);
      const clip = ctx.clips.find((c) => c.id === ids[0]);
      return !!clip && (clip.kind === "video" || !!clip.mediaId);
    },
    execute: (ctx) => {
      const ids = getTargetClipIds(ctx);
      const clip = ctx.clips.find((c) => c.id === ids[0]);
      if (clip) {
        const asset = clip.mediaId
          ? useProjectStore.getState().mediaAssets.find((candidate) => candidate.id === clip.mediaId)
          : undefined;
        const videoPath = (asset as any)?.path || (asset as any)?.url || clip.mediaId || clip.id;
        void bakeClymatteClip({
          clipId: clip.id,
          videoPath,
        });
      }
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

  // ─── Speed & Playback ────────────────────────────────────────────────────────
  {
    id: "clip.freezeFrame",
    label: "Freeze Frame at Playhead",
    icon: Snowflake,
    group: "speed",
    isVisible: (ctx) => {
      const ids = getTargetClipIds(ctx);
      if (ids.length !== 1) return false;
      const clip = ctx.clips.find((c) => c.id === ids[0]);
      return !!clip && (clip.kind === "video" || clip.kind === "image");
    },
    isEnabled: (ctx) => {
      const ids = getTargetClipIds(ctx);
      const clip = ctx.clips.find((c) => c.id === ids[0]);
      if (!clip) return false;
      const isUnlocked = !ctx.tracks.find((t) => t.id === clip.trackId)?.locked;
      return isUnlocked && ctx.playheadTime >= clip.startTime && ctx.playheadTime < clip.startTime + clip.duration;
    },
    disabledReason: (ctx) => {
      const ids = getTargetClipIds(ctx);
      const clip = ctx.clips.find((c) => c.id === ids[0]);
      if (!clip) return "No clip selected";
      if (ctx.tracks.find((t) => t.id === clip.trackId)?.locked) return "Clip is on a locked track";
      return "Playhead must be inside the clip to freeze a frame";
    },
    execute: (ctx) => {
      const ids = getTargetClipIds(ctx);
      const clip = ctx.clips.find((c) => c.id === ids[0]);
      if (!clip) return;

      const store = useTimelineStore.getState();

      // Toggle: if already frozen, unfreeze
      if (clip.playbackMapping?.kind === "freeze") {
        store.updateClip(clip.id, { playbackMapping: { kind: "normal", speed: 1 } });
        toast.info("Clip unfrozen");
        return;
      }

      const clock = getPlaybackClock();
      const { sourceTime } = resolveClipSourceTime(clip, clock.time, { clampToRange: true });
      const mapping: PlaybackMapping = { kind: "freeze", atSourceTime: sourceTime };
      store.updateClip(clip.id, { playbackMapping: mapping });
      toast.success(`Frozen at ${sourceTime.toFixed(3)}s`);
    },
  },
  {
    id: "clip.reverseClip",
    label: "Reverse Clip",
    icon: FlipHorizontal2,
    group: "speed",
    isVisible: (ctx) => {
      const ids = getTargetClipIds(ctx);
      return ids.some((id) => {
        const c = ctx.clips.find((clip) => clip.id === id);
        return !!c && (c.kind === "video" || c.kind === "audio");
      });
    },
    isEnabled: (ctx) => {
      const ids = getTargetClipIds(ctx);
      return ids.some((id) => {
        const c = ctx.clips.find((clip) => clip.id === id);
        return !!c && !ctx.tracks.find((t) => t.id === c.trackId)?.locked;
      });
    },
    disabledReason: () => "Selected clips are on a locked track",
    execute: (ctx) => {
      const ids = getTargetClipIds(ctx);
      const store = useTimelineStore.getState();
      store.withBatch(() => {
        ids.forEach((id) => {
          const clip = store.clips.find((c) => c.id === id);
          if (!clip) return;
          const currentMapping = clip.playbackMapping;
          const currentSpeed = (currentMapping?.kind === "normal" || currentMapping?.kind === "reverse")
            ? currentMapping.speed
            : (clip.speed ?? 1);
          const isCurrentlyReversed = currentMapping?.kind === "reverse";
          const mapping: PlaybackMapping = isCurrentlyReversed
            ? { kind: "normal", speed: currentSpeed }
            : { kind: "reverse", speed: currentSpeed };
          store.updateClip(id, { playbackMapping: mapping });
        });
      });
      const anyReversed = ids.some((id) => {
        const c = store.clips.find((clip) => clip.id === id);
        return c?.playbackMapping?.kind === "reverse";
      });
      toast.info(anyReversed ? "Clips reversed" : "Clips unreversed");
    },
  },
  {
    id: "clip.setSpeedHalf",
    label: "Set Speed 0.5×",
    icon: Gauge,
    group: "speed",
    isVisible: (ctx) => {
      const ids = getTargetClipIds(ctx);
      return ids.some((id) => ctx.clips.some((c) => c.id === id && (c.kind === "video" || c.kind === "audio")));
    },
    isEnabled: (ctx) => {
      const ids = getTargetClipIds(ctx);
      return ids.some((id) => {
        const c = ctx.clips.find((clip) => clip.id === id);
        return !!c && !ctx.tracks.find((t) => t.id === c.trackId)?.locked;
      });
    },
    disabledReason: () => "Selected clips are on a locked track",
    execute: (ctx) => {
      const ids = getTargetClipIds(ctx);
      const store = useTimelineStore.getState();
      store.withBatch(() => {
        ids.forEach((id) => {
          const clip = store.clips.find((c) => c.id === id);
          if (!clip) return;
          const isReversed = clip.playbackMapping?.kind === "reverse";
          const mapping: PlaybackMapping = { kind: isReversed ? "reverse" : "normal", speed: 0.5 };
          store.updateClip(id, { playbackMapping: mapping });
        });
      });
      toast.info("Speed set to 0.5×");
    },
  },
  {
    id: "clip.setSpeedNormal",
    label: "Reset Speed (1×)",
    icon: RotateCcw,
    group: "speed",
    isVisible: (ctx) => {
      const ids = getTargetClipIds(ctx);
      return ids.some((id) => {
        const c = ctx.clips.find((clip) => clip.id === id);
        return !!c && (c.kind === "video" || c.kind === "audio");
      });
    },
    isEnabled: (ctx) => {
      const ids = getTargetClipIds(ctx);
      return ids.some((id) => {
        const c = ctx.clips.find((clip) => clip.id === id);
        return !!c && !ctx.tracks.find((t) => t.id === c.trackId)?.locked;
      });
    },
    disabledReason: () => "Selected clips are on a locked track",
    execute: (ctx) => {
      const ids = getTargetClipIds(ctx);
      const store = useTimelineStore.getState();
      store.withBatch(() => {
        ids.forEach((id) => store.updateClip(id, { playbackMapping: { kind: "normal", speed: 1 } }));
      });
      toast.success("Speed reset to 1×");
    },
  },
  {
    id: "clip.setSpeed2x",
    label: "Set Speed 2×",
    icon: Gauge,
    group: "speed",
    isVisible: (ctx) => {
      const ids = getTargetClipIds(ctx);
      return ids.some((id) => ctx.clips.some((c) => c.id === id && (c.kind === "video" || c.kind === "audio")));
    },
    isEnabled: (ctx) => {
      const ids = getTargetClipIds(ctx);
      return ids.some((id) => {
        const c = ctx.clips.find((clip) => clip.id === id);
        return !!c && !ctx.tracks.find((t) => t.id === c.trackId)?.locked;
      });
    },
    disabledReason: () => "Selected clips are on a locked track",
    execute: (ctx) => {
      const ids = getTargetClipIds(ctx);
      const store = useTimelineStore.getState();
      store.withBatch(() => {
        ids.forEach((id) => {
          const clip = store.clips.find((c) => c.id === id);
          if (!clip) return;
          const isReversed = clip.playbackMapping?.kind === "reverse";
          const mapping: PlaybackMapping = { kind: isReversed ? "reverse" : "normal", speed: 2 };
          store.updateClip(id, { playbackMapping: mapping });
        });
      });
      toast.info("Speed set to 2×");
    },
  },

  // ─── Slip / Slide / Roll (NLE Precision Tools) ─────────────────────────────
  {
    id: "clip.slipEarlier",
    label: "Slip Content Earlier",
    shortcutLabel: "Y + ←",
    icon: ArrowLeftRight,
    group: "trim",
    isVisible: (ctx) => getTargetClipIds(ctx).length === 1,
    isEnabled: (ctx) => {
      const ids = getTargetClipIds(ctx);
      if (ids.length !== 1) return false;
      const clip = ctx.clips.find((c) => c.id === ids[0]);
      return !!clip && clip.kind !== "compound" && !ctx.tracks.find((t) => t.id === clip.trackId)?.locked;
    },
    execute: (ctx) => {
      const ids = getTargetClipIds(ctx);
      const frameRate = useProjectStore.getState().project?.frameRate ?? 30;
      const res = EditingActions.slipClip(ids[0], -1 / frameRate);
      if (res.success) toast.info("Slipped earlier by 1 frame");
      else if (res.error) toast.error(res.error);
    },
  },
  {
    id: "clip.slipLater",
    label: "Slip Content Later",
    shortcutLabel: "Y + →",
    icon: ArrowLeftRight,
    group: "trim",
    isVisible: (ctx) => getTargetClipIds(ctx).length === 1,
    isEnabled: (ctx) => {
      const ids = getTargetClipIds(ctx);
      if (ids.length !== 1) return false;
      const clip = ctx.clips.find((c) => c.id === ids[0]);
      return !!clip && clip.kind !== "compound" && !ctx.tracks.find((t) => t.id === clip.trackId)?.locked;
    },
    execute: (ctx) => {
      const ids = getTargetClipIds(ctx);
      const frameRate = useProjectStore.getState().project?.frameRate ?? 30;
      const res = EditingActions.slipClip(ids[0], 1 / frameRate);
      if (res.success) toast.info("Slipped later by 1 frame");
      else if (res.error) toast.error(res.error);
    },
  },
  {
    id: "clip.slideLeft",
    label: "Slide Clip Earlier",
    shortcutLabel: "U + ←",
    icon: ArrowLeftRight,
    group: "trim",
    isVisible: (ctx) => getTargetClipIds(ctx).length === 1,
    isEnabled: (ctx) => {
      const ids = getTargetClipIds(ctx);
      if (ids.length !== 1) return false;
      const clip = ctx.clips.find((c) => c.id === ids[0]);
      return !!clip && clip.kind !== "compound" && !ctx.tracks.find((t) => t.id === clip.trackId)?.locked;
    },
    execute: (ctx) => {
      const ids = getTargetClipIds(ctx);
      const frameRate = useProjectStore.getState().project?.frameRate ?? 30;
      const res = EditingActions.slideClip(ids[0], -1 / frameRate);
      if (res.success) toast.info("Slid left by 1 frame");
      else if (res.error) toast.error(res.error);
    },
  },
  {
    id: "clip.slideRight",
    label: "Slide Clip Later",
    shortcutLabel: "U + →",
    icon: ArrowLeftRight,
    group: "trim",
    isVisible: (ctx) => getTargetClipIds(ctx).length === 1,
    isEnabled: (ctx) => {
      const ids = getTargetClipIds(ctx);
      if (ids.length !== 1) return false;
      const clip = ctx.clips.find((c) => c.id === ids[0]);
      return !!clip && clip.kind !== "compound" && !ctx.tracks.find((t) => t.id === clip.trackId)?.locked;
    },
    execute: (ctx) => {
      const ids = getTargetClipIds(ctx);
      const frameRate = useProjectStore.getState().project?.frameRate ?? 30;
      const res = EditingActions.slideClip(ids[0], 1 / frameRate);
      if (res.success) toast.info("Slid right by 1 frame");
      else if (res.error) toast.error(res.error);
    },
  },
  {
    id: "clip.rollEarlier",
    label: "Roll Cut Point Earlier",
    shortcutLabel: "N + ←",
    icon: ArrowLeftRight,
    group: "trim",
    isVisible: (ctx) => {
      const ids = getTargetClipIds(ctx);
      return ids.length === 1 || ids.length === 2;
    },
    isEnabled: (ctx) => {
      const ids = getTargetClipIds(ctx);
      if (ids.length === 1) {
        const clip = ctx.clips.find((c) => c.id === ids[0]);
        return !!clip && clip.kind !== "compound" && !ctx.tracks.find((t) => t.id === clip.trackId)?.locked;
      }
      if (ids.length === 2) {
        const [c1, c2] = ids.map((id) => ctx.clips.find((c) => c.id === id));
        return !!c1 && !!c2 && c1.trackId === c2.trackId && c1.kind !== "compound" && c2.kind !== "compound";
      }
      return false;
    },
    execute: (ctx) => {
      const ids = getTargetClipIds(ctx);
      const frameRate = useProjectStore.getState().project?.frameRate ?? 30;
      const delta = -1 / frameRate;
      if (ids.length === 1) {
        const clip = ctx.clips.find((c) => c.id === ids[0]);
        if (!clip) return;
        const hasOutgoing = ctx.clips.some((o) => o.trackId === clip.trackId && Math.abs(clip.startTime + clip.duration - o.startTime) < 0.001);
        const res = hasOutgoing
          ? EditingActions.rollClipEdge(clip.id, "outgoing", delta)
          : EditingActions.rollClipEdge(clip.id, "incoming", delta);
        if (res.success) toast.info("Rolled cut point earlier by 1 frame");
        else if (res.error) toast.error(res.error);
      } else if (ids.length === 2) {
        const [c1, c2] = ids.map((id) => ctx.clips.find((c) => c.id === id));
        if (c1 && c2) {
          const [left, right] = c1.startTime <= c2.startTime ? [c1, c2] : [c2, c1];
          const res = EditingActions.rollEdit(left.id, right.id, delta);
          if (res.success) toast.info("Rolled cut point earlier by 1 frame");
          else if (res.error) toast.error(res.error);
        }
      }
    },
  },
  {
    id: "clip.rollLater",
    label: "Roll Cut Point Later",
    shortcutLabel: "N + →",
    icon: ArrowLeftRight,
    group: "trim",
    isVisible: (ctx) => {
      const ids = getTargetClipIds(ctx);
      return ids.length === 1 || ids.length === 2;
    },
    isEnabled: (ctx) => {
      const ids = getTargetClipIds(ctx);
      if (ids.length === 1) {
        const clip = ctx.clips.find((c) => c.id === ids[0]);
        return !!clip && clip.kind !== "compound" && !ctx.tracks.find((t) => t.id === clip.trackId)?.locked;
      }
      if (ids.length === 2) {
        const [c1, c2] = ids.map((id) => ctx.clips.find((c) => c.id === id));
        return !!c1 && !!c2 && c1.trackId === c2.trackId && c1.kind !== "compound" && c2.kind !== "compound";
      }
      return false;
    },
    execute: (ctx) => {
      const ids = getTargetClipIds(ctx);
      const frameRate = useProjectStore.getState().project?.frameRate ?? 30;
      const delta = 1 / frameRate;
      if (ids.length === 1) {
        const clip = ctx.clips.find((c) => c.id === ids[0]);
        if (!clip) return;
        const hasOutgoing = ctx.clips.some((o) => o.trackId === clip.trackId && Math.abs(clip.startTime + clip.duration - o.startTime) < 0.001);
        const res = hasOutgoing
          ? EditingActions.rollClipEdge(clip.id, "outgoing", delta)
          : EditingActions.rollClipEdge(clip.id, "incoming", delta);
        if (res.success) toast.info("Rolled cut point later by 1 frame");
        else if (res.error) toast.error(res.error);
      } else if (ids.length === 2) {
        const [c1, c2] = ids.map((id) => ctx.clips.find((c) => c.id === id));
        if (c1 && c2) {
          const [left, right] = c1.startTime <= c2.startTime ? [c1, c2] : [c2, c1];
          const res = EditingActions.rollEdit(left.id, right.id, delta);
          if (res.success) toast.info("Rolled cut point later by 1 frame");
          else if (res.error) toast.error(res.error);
        }
      }
    },
  },
];

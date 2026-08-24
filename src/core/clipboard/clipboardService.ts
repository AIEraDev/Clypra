/**
 * Clipboard Service
 *
 * Unified clipboard layer for timeline clip copy, cut, paste, and duplicate operations.
 * Shared between keyboard shortcuts, context menus, and toolbar actions.
 */

import { useTimelineStore } from "@/store/timelineStore";
import { useUIStore } from "@/store/uiStore";
import { getPlaybackClock } from "@/hooks/usePlaybackClock";
import { EditingActions } from "@/core/interactions";
import { generateId } from "@/lib/utils/id";
import { toast } from "@/lib/toast";
import type { Clip } from "@/types";

export interface CopiedClipItem {
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
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
  volumeKeyframes?: Clip["volumeKeyframes"];
  audioFX?: Clip["audioFX"];
  overlays?: Clip["overlays"];
  effects?: Clip["effects"];
  filter?: Clip["filter"];
  name?: string;
  kind?: Clip["kind"];
  stickerFormat?: Clip["stickerFormat"];
  stickerAnimationPath?: string;
  stickerSourceId?: string;
  stickerImagePath?: string;
  templateId?: string;
  adjustments?: Clip["adjustments"];
  chromaKey?: Clip["chromaKey"];
  colorGrade?: Clip["colorGrade"];
}

let clipboard: CopiedClipItem[] = [];
const clipboardListeners = new Set<() => void>();

function notifyClipboardChanged() {
  clipboardListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // ignore
    }
  });
}

export const clipboardService = {
  /** Copy selected clips to clipboard */
  copyClips(clipIds: string[]): boolean {
    if (!clipIds || clipIds.length === 0) return false;
    const store = useTimelineStore.getState();
    const selected = store.clips
      .filter((c) => clipIds.includes(c.id))
      .sort((a, b) => a.startTime - b.startTime);

    if (selected.length === 0) return false;

    const minStart = selected[0].startTime;
    clipboard = selected.map((clip) => ({
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
      volume: clip.volume,
      fadeIn: clip.fadeIn,
      fadeOut: clip.fadeOut,
      volumeKeyframes: clip.volumeKeyframes ? JSON.parse(JSON.stringify(clip.volumeKeyframes)) : undefined,
      audioFX: clip.audioFX ? JSON.parse(JSON.stringify(clip.audioFX)) : undefined,
      overlays: clip.overlays ? JSON.parse(JSON.stringify(clip.overlays)) : undefined,
      effects: clip.effects ? JSON.parse(JSON.stringify(clip.effects)) : undefined,
      filter: clip.filter ? { ...clip.filter } : undefined,
      name: clip.name,
      kind: clip.kind,
      stickerFormat: clip.stickerFormat,
      stickerAnimationPath: clip.stickerAnimationPath,
      stickerSourceId: clip.stickerSourceId,
      stickerImagePath: clip.stickerImagePath,
      templateId: clip.templateId,
      adjustments: clip.adjustments ? { ...clip.adjustments } : undefined,
      chromaKey: clip.chromaKey ? { ...clip.chromaKey } : undefined,
      colorGrade: clip.colorGrade ? { ...clip.colorGrade } : undefined,
    }));

    notifyClipboardChanged();
    toast.info(`Copied ${clipboard.length} clip${clipboard.length > 1 ? "s" : ""}`);
    return true;
  },

  /** Cut selected clips (copies then removes) */
  cutClips(clipIds: string[], lift = false): boolean {
    if (!clipIds || clipIds.length === 0) return false;
    const copied = this.copyClips(clipIds);
    if (!copied) return false;

    const deleteResult = EditingActions.deleteSelection(clipIds, lift);
    return deleteResult !== null;
  },

  /** Paste clips at playhead or specified target time */
  pasteClips(targetTime?: number, targetTrackId?: string): string[] {
    if (clipboard.length === 0) return [];
    const store = useTimelineStore.getState();
    const uiStore = useUIStore.getState();
    const pasteBaseTime = targetTime ?? getPlaybackClock().time;

    const availableTrackIds = new Set(store.tracks.map((t) => t.id));
    const fallbackTrackId = targetTrackId ?? store.tracks[0]?.id;
    const pastedClipIds: string[] = [];

    store.withBatch(() => {
      clipboard.forEach((item) => {
        const destinationTrackId =
          targetTrackId || (availableTrackIds.has(item.trackId) ? item.trackId : fallbackTrackId);
        if (!destinationTrackId) return;

        const newId = generateId("clip");
        const newClip: Clip = {
          ...item,
          id: newId,
          trackId: destinationTrackId,
          startTime: Math.max(0, pasteBaseTime + item.startOffset),
        };

        store.addClip(newClip);
        pastedClipIds.push(newId);
      });
    });

    if (pastedClipIds.length > 0) {
      uiStore.clearSelection();
      pastedClipIds.forEach((id, idx) => {
        if (idx === 0) {
          uiStore.selectClip(id);
        } else {
          uiStore.toggleClipSelection(id);
        }
      });
      toast.success(`Pasted ${pastedClipIds.length} clip${pastedClipIds.length > 1 ? "s" : ""}`);
    }

    return pastedClipIds;
  },

  /** Duplicate selected clips immediately after their range */
  duplicateClips(clipIds: string[]): string[] {
    if (!clipIds || clipIds.length === 0) return [];
    const store = useTimelineStore.getState();
    const uiStore = useUIStore.getState();
    const selected = store.clips
      .filter((c) => clipIds.includes(c.id))
      .sort((a, b) => a.startTime - b.startTime);

    if (selected.length === 0) return [];

    const minStart = selected[0].startTime;
    const maxEnd = Math.max(...selected.map((c) => c.startTime + c.duration));
    const offset = maxEnd - minStart;
    const duplicatedClipIds: string[] = [];

    store.withBatch(() => {
      selected.forEach((clip) => {
        const newId = generateId("clip");
        store.addClip({
          ...clip,
          id: newId,
          startTime: clip.startTime + offset,
        });
        duplicatedClipIds.push(newId);
      });
    });

    if (duplicatedClipIds.length > 0) {
      uiStore.clearSelection();
      duplicatedClipIds.forEach((id, idx) => {
        if (idx === 0) {
          uiStore.selectClip(id);
        } else {
          uiStore.toggleClipSelection(id);
        }
      });
      toast.success(`Duplicated ${duplicatedClipIds.length} clip${duplicatedClipIds.length > 1 ? "s" : ""}`);
    }

    return duplicatedClipIds;
  },

  /** Check if clipboard has items */
  hasClips(): boolean {
    return clipboard.length > 0;
  },

  /** Get count of items currently in clipboard */
  getClipCount(): number {
    return clipboard.length;
  },

  /** Get snapshot of clipboard items */
  getItems(): CopiedClipItem[] {
    return [...clipboard];
  },

  /** Clear clipboard */
  clear(): void {
    clipboard = [];
    notifyClipboardChanged();
  },

  /** Subscribe to clipboard change events */
  subscribe(listener: () => void): () => void {
    clipboardListeners.add(listener);
    return () => {
      clipboardListeners.delete(listener);
    };
  },
};

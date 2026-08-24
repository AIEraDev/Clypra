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

/**
 * A clipboard item preserves the complete clip model by default. Only the
 * identity and absolute start position are regenerated when materialized;
 * trackId remains as the source-track preference used by paste routing.
 */
export type CopiedClipItem = Omit<Clip, "id" | "startTime"> & {
  startOffset: number;
};

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

function cloneClipData<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Create the one canonical, structurally complete clipboard snapshot. */
function createClipSnapshot(clip: Clip, minStart: number): CopiedClipItem {
  const { id: _id, startTime: _startTime, ...clipData } = cloneClipData(clip);
  void _id;
  void _startTime;
  return {
    ...clipData,
    startOffset: clip.startTime - minStart,
  };
}

/** Materialize a clipboard snapshot with regenerated identity and placement. */
function materializeClip(
  item: CopiedClipItem,
  id: string,
  startTime: number,
  trackId: string,
): Clip {
  const { startOffset: _startOffset, ...clipData } = cloneClipData(item);
  void _startOffset;
  return {
    ...clipData,
    id,
    trackId,
    startTime,
  };
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
    clipboard = selected.map((clip) => createClipSnapshot(clip, minStart));

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
        const newClip = materializeClip(
          item,
          newId,
          Math.max(0, pasteBaseTime + item.startOffset),
          destinationTrackId,
        );

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
        const snapshot = createClipSnapshot(clip, minStart);
        store.addClip(materializeClip(snapshot, newId, minStart + snapshot.startOffset + offset, clip.trackId));
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

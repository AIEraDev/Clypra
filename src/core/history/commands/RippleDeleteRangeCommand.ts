import type { Command } from "../Command";
import { generateCommandId } from "../Command";
import type { Clip, Track } from "@/types";
import type { Gap } from "@/types/gap";
import { shouldAutoPruneTrack } from "@/lib/timeline/trackTypeConfig";

interface TimelineState {
  tracks: Track[];
  clips: Clip[];
  gaps: Gap[];
  mainVideoTrackId?: string | null;
  epoch: number;
}

type TimelineSnapshot = Pick<TimelineState, "tracks" | "clips" | "gaps" | "mainVideoTrackId">;

function cloneClipSnapshot(clip: Clip): Clip {
  if (typeof structuredClone === "function") return structuredClone(clip);
  return JSON.parse(JSON.stringify(clip)) as Clip;
}

function cloneSnapshot(state: Partial<TimelineState>): TimelineSnapshot {
  return {
    tracks: (state.tracks ?? []).map((track) => ({ ...track })),
    clips: (state.clips ?? []).map(cloneClipSnapshot),
    gaps: (state.gaps ?? []).map((gap) => ({ ...gap, metadata: gap.metadata ? { ...gap.metadata } : gap.metadata })),
    mainVideoTrackId: state.mainVideoTrackId ?? null,
  };
}

class RestoreTimelineSnapshotCommand implements Command {
  readonly id = generateCommandId();
  readonly label = "Restore Ripple Delete";
  readonly timestamp = Date.now();
  readonly undoable = true;
  private replaced: TimelineSnapshot | null = null;

  private readonly snapshot: TimelineSnapshot;

  constructor(snapshot: TimelineSnapshot) {
    this.snapshot = cloneSnapshot(snapshot);
  }

  apply(state: TimelineState): TimelineState {
    this.replaced = cloneSnapshot(state);
    return {
      ...state,
      ...cloneSnapshot({ ...state, ...this.snapshot }),
      epoch: state.epoch + 1,
    };
  }

  invert(): Command {
    if (!this.replaced) throw new Error("Cannot invert before applying snapshot");
    return new RestoreTimelineSnapshotCommand(this.replaced);
  }
}

/**
 * Removes one or more clips and closes only their occupied time on each track.
 * Calculating one shift per survivor avoids the repeated/double shifts produced
 * by executing one ripple command per selected clip.
 */
export class RippleDeleteRangeCommand implements Command {
  readonly id = generateCommandId();
  readonly label = "Ripple Delete Clips";
  readonly timestamp = Date.now();
  readonly undoable = true;
  private before: TimelineSnapshot | null = null;

  constructor(private readonly clipIds: string[]) {}

  apply(state: TimelineState): TimelineState {
    this.before = cloneSnapshot(state);
    const selected = new Set(this.clipIds);
    const deleted = state.clips.filter((clip) => selected.has(clip.id));
    if (deleted.length === 0) return state;

    const deletedByTrack = new Map<string, Clip[]>();
    for (const clip of deleted) {
      const track = state.tracks.find((candidate) => candidate.id === clip.trackId);
      if (track?.locked) continue;
      const clips = deletedByTrack.get(clip.trackId) ?? [];
      clips.push(clip);
      deletedByTrack.set(clip.trackId, clips);
    }
    const actuallyDeleted = new Set(Array.from(deletedByTrack.values()).flat().map((clip) => clip.id));

    const clips = state.clips
      .filter((clip) => !actuallyDeleted.has(clip.id))
      .map((clip) => {
        const removed = deletedByTrack.get(clip.trackId);
        if (!removed) return cloneClipSnapshot(clip);
        const lastProtectedBarrier = state.gaps
          .filter((gap) => gap.trackId === clip.trackId && gap.protected && gap.startTime + gap.duration <= clip.startTime + 0.0005)
          .reduce((latest, gap) => Math.max(latest, gap.startTime + gap.duration), 0);
        const shift = removed
          .filter((deletedClip) => deletedClip.startTime < clip.startTime && deletedClip.startTime >= lastProtectedBarrier - 0.0005)
          .reduce((sum, deletedClip) => sum + deletedClip.duration, 0);
        return shift > 0
          ? { ...cloneClipSnapshot(clip), startTime: Math.max(0, clip.startTime - shift) }
          : cloneClipSnapshot(clip);
      });

    const occupiedTrackIds = new Set(clips.map((clip) => clip.trackId));
    // Keep a track if it still has clips OR if its type is non-prunable (autoPrune: false).
    // This is driven purely by TRACK_TYPE_CONFIG — no hardcoded type strings here.
    const tracks = state.tracks.filter(
      (track) => occupiedTrackIds.has(track.id) || !shouldAutoPruneTrack(track, state.tracks, state.mainVideoTrackId),
    );
    const deletedTrackIds = new Set(state.tracks.filter((track) => !tracks.some((candidate) => candidate.id === track.id)).map((track) => track.id));

    let mainVideoTrackId = state.mainVideoTrackId;
    if (mainVideoTrackId && !tracks.some((t) => t.id === mainVideoTrackId)) {
      mainVideoTrackId = tracks.find((t) => t.type === "video")?.id ?? null;
    }

    return {
      ...state,
      tracks,
      clips,
      gaps: state.gaps.filter((gap) => !deletedTrackIds.has(gap.trackId)),
      mainVideoTrackId,
      epoch: state.epoch + 1,
    };
  }

  invert(): Command {
    if (!this.before) throw new Error("Cannot invert RippleDeleteRangeCommand before apply");
    return new RestoreTimelineSnapshotCommand(this.before);
  }
}

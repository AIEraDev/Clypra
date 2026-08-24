import type { Clip, Track, TrackType } from "@/types";
import type { Gap } from "@/types/gap";
import { generateCommandId } from "../Command";
import type { Command } from "../Command";
import { generateId, getCounter } from "@/lib/utils/id";
import { TRACK_TYPE_CONFIG } from "@/lib/timeline/trackTypeConfig";
import { detectGaps, mergeAdjacentGaps } from "@/lib/timeline/gapEngine";
import { calculateDepartureClosurePositions, type OriginalClipPlacement } from "@/lib/timeline/clipPositions";
import { findSnap } from "@/lib/timeline/snapTargets";
import type { DropTarget } from "@/lib/timeline/dropTarget";
import type { PlacementPreview } from "@/lib/timeline/placementPreview";

export interface TimelineDragSnapshot {
  draggingClipId: string | null;
  draggedClipIds: string[];
  originalPlacements: Record<string, OriginalClipPlacement>;
  originalStartTime: number;
  offsetX: number;
  willCreateNewTrack?: boolean;
  newTrackPosition?: "above" | "below" | "between" | null;
  betweenTrackIds?: { aboveId: string; belowId: string };
  targetTrackId?: string | null;
  dropTarget?: DropTarget | null;
  placementPreview?: PlacementPreview | null;
}

export interface TimelineDragState {
  tracks: Track[];
  clips: Clip[];
  gaps: Gap[];
  mainVideoTrackId: string | null;
  epoch: number;
}

export interface TimelineDragResult {
  beforeClips: Clip[];
  afterClips: Clip[];
  beforeTracks: Track[];
  afterTracks: Track[];
  beforeTrackIndices: number[];
  afterTrackIndices: number[];
  beforeGaps: Gap[];
  afterGaps: Gap[];
  beforeGapIndices: number[];
  afterGapIndices: number[];
  affectedTrackIds: string[];
  mainVideoTrackIdBefore: string | null;
  mainVideoTrackIdAfter: string | null;
}

export interface BuildTimelineDragResultInput {
  state: TimelineDragState;
  drag: TimelineDragSnapshot;
  clip: Clip;
  trackType?: TrackType;
  snapEnabled: boolean;
  currentTime: number;
  pixelsPerSecond: number;
  newTrackInsertIndex?: number;
}

function makeTrack(type: TrackType): Track {
  return {
    id: generateId("track"),
    type,
    name: `${type.charAt(0).toUpperCase() + type.slice(1)} ${getCounter() % 100}`,
    muted: false,
    locked: false,
    visible: true,
    height: TRACK_TYPE_CONFIG[type].height,
  };
}

function equalClip(a: Clip | undefined, b: Clip | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function syncGapsForTracks(state: TimelineDragState, afterClips: Clip[], afterTracks: Track[], trackIds: Set<string>): Gap[] {
  const processed = new Set(afterTracks.filter((track) => trackIds.has(track.id)).map((track) => track.id));
  let nextGaps = state.gaps.filter((gap) => !trackIds.has(gap.trackId));

  for (const track of afterTracks) {
    if (!processed.has(track.id)) continue;
    const detected = detectGaps(afterClips.filter((clip) => clip.trackId === track.id), []);
    const protectedGaps = state.gaps.filter((gap) => gap.trackId === track.id && gap.protected);
    const preserved: Gap[] = [];

    for (const protectedGap of protectedGaps) {
      const matching = detected.find((gap) => {
        const overlapStart = Math.max(gap.startTime, protectedGap.startTime);
        const overlapEnd = Math.min(gap.startTime + gap.duration, protectedGap.startTime + protectedGap.duration);
        return overlapStart < overlapEnd - 0.001;
      });
      if (!matching) continue;
      preserved.push({ ...matching, id: protectedGap.id, protected: true, type: protectedGap.type, metadata: protectedGap.metadata });
      detected.splice(detected.indexOf(matching), 1);
    }
    nextGaps = [...nextGaps, ...preserved, ...detected];
  }

  return mergeAdjacentGaps(nextGaps);
}

function applyClipUpdates(clips: Clip[], updates: Map<string, Partial<Clip>>): Clip[] {
  return clips.map((clip) => {
    const update = updates.get(clip.id);
    return update ? { ...clip, ...update } : clip;
  });
}

export function buildTimelineDragResult(input: BuildTimelineDragResultInput): TimelineDragResult | null {
  const { state, drag, clip, snapEnabled, currentTime } = input;
  if (!state.clips.some((item) => item.id === clip.id) || drag.draggedClipIds.length === 0 || drag.draggedClipIds.some((id) => !state.clips.some((item) => item.id === id))) {
    return null;
  }
  // A multi-clip drag must be atomic: a locked source clip cannot be moved
  // indirectly because it was selected together with an unlocked clip.
  const draggedClips = state.clips.filter((item) => drag.draggedClipIds.includes(item.id));
  if (draggedClips.some((item) => state.tracks.find((track) => track.id === item.trackId)?.locked)) {
    return null;
  }
  const sourceTrackIds = new Set(Object.values(drag.originalPlacements).map((placement) => placement.trackId));
  const affectedTrackIds = new Set(sourceTrackIds);
  const updates = new Map<string, Partial<Clip>>();
  let afterTracks = [...state.tracks];
  let targetTrackId = drag.targetTrackId ?? null;
  let createdTrackId: string | null = null;

  const orderedDragged = [...drag.draggedClipIds].sort((a, b) => {
    const pa = drag.originalPlacements[a];
    const pb = drag.originalPlacements[b];
    if (!pa || !pb) return a.localeCompare(b);
    return pa.startTime - pb.startTime || a.localeCompare(b);
  });
  const primaryId = drag.draggingClipId ?? orderedDragged[0];
  if (!primaryId) return null;
  const primaryOriginalStart = drag.originalPlacements[primaryId]?.startTime ?? drag.originalStartTime;

  const closeSourceGaps = (destinationTrackId: string | null) => {
    for (const sourceTrackId of sourceTrackIds) {
      if (sourceTrackId === destinationTrackId) continue;
      const closure = calculateDepartureClosurePositions({
        trackClips: state.clips.filter((item) => item.trackId === sourceTrackId),
        draggedClipIds: drag.draggedClipIds,
        originalPlacements: drag.originalPlacements,
      });
      for (const [id, startTime] of closure) updates.set(id, { startTime });
    }
  };

  if (drag.willCreateNewTrack && drag.newTrackPosition && input.trackType) {
    const newTrack = makeTrack(input.trackType);
    const insertIndex = Math.max(0, Math.min(input.newTrackInsertIndex ?? afterTracks.length, afterTracks.length));
    afterTracks.splice(insertIndex, 0, newTrack);
    targetTrackId = newTrack.id;
    createdTrackId = newTrack.id;
    affectedTrackIds.add(newTrack.id);

    const pps = Math.max(1, input.pixelsPerSecond);
    const candidateStartTime = Math.max(0, drag.originalStartTime + drag.offsetX / pps);
    const snap = findSnap({
      candidateTime: candidateStartTime,
      trackClips: state.clips,
      draggedClipIds: drag.draggedClipIds,
      snapEnabled,
      snapThresholdPx: 8,
      pixelsPerSecond: pps,
      playheadTime: currentTime,
    });
    const baseStartTime = snap.snapped ? snap.snappedTime! : candidateStartTime;
    closeSourceGaps(targetTrackId);
    for (const id of orderedDragged) {
      const placement = drag.originalPlacements[id];
      if (!placement) continue;
      updates.set(id, {
        trackId: targetTrackId,
        startTime: Math.max(0, baseStartTime + placement.startTime - primaryOriginalStart),
      });
    }
  } else if (targetTrackId && drag.dropTarget && drag.placementPreview) {
    affectedTrackIds.add(targetTrackId);
    if (drag.dropTarget.type === "insert") {
      const insertionIndex = drag.placementPreview.type === "insert" ? drag.placementPreview.insertionIndex : 0;
      const rest = state.clips
        .filter((item) => item.trackId === targetTrackId && !drag.draggedClipIds.includes(item.id))
        .sort((a, b) => a.startTime - b.startTime);
      rest.splice(Math.max(0, Math.min(insertionIndex, rest.length)), 0, ...orderedDragged.map((id) => state.clips.find((item) => item.id === id)).filter((item): item is Clip => Boolean(item)));
      let time = 0;
      for (const item of rest) {
        updates.set(item.id, { trackId: targetTrackId, startTime: time });
        time += item.duration;
      }
      closeSourceGaps(targetTrackId);
    } else {
      const targetClips = state.clips
        .filter((item) => item.trackId === targetTrackId && !drag.draggedClipIds.includes(item.id))
        .sort((a, b) => a.startTime - b.startTime);
      const proposed: Array<{ clip: Clip; startTime: number }> = [];
      const baseStartTime = drag.dropTarget.startTime;
      for (const id of orderedDragged) {
        const dragged = state.clips.find((item) => item.id === id);
        if (!dragged) continue;
        const startTime = Math.max(0, baseStartTime + (drag.originalPlacements[id]?.startTime ?? 0) - primaryOriginalStart);
        const endTime = startTime + dragged.duration;
        if (targetClips.some((item) => startTime < item.startTime + item.duration - 0.001 && endTime > item.startTime + 0.001)) return null;
        if (proposed.some((item) => startTime < item.startTime + item.clip.duration - 0.001 && endTime > item.startTime + 0.001)) return null;
        proposed.push({ clip: dragged, startTime });
      }
      closeSourceGaps(targetTrackId);
      for (const item of proposed) updates.set(item.clip.id, { trackId: targetTrackId, startTime: item.startTime });
    }
  } else {
    return null;
  }

  let afterClips = applyClipUpdates(state.clips, updates);
  const mainVideoTrackIdAfter = state.mainVideoTrackId ??
    (createdTrackId && input.trackType === "video" ? createdTrackId : afterTracks.find((track) => track.type === "video")?.id ?? null);
  afterTracks = afterTracks.filter(
    (track) =>
      !sourceTrackIds.has(track.id) ||
      track.id === mainVideoTrackIdAfter ||
      afterClips.some((item) => item.trackId === track.id),
  );

  // A drop that leaves both the clips and track list unchanged is a true no-op.
  // Return before gap redetection so regenerated auto-gap IDs cannot create a
  // history entry for a drag that did not actually change the timeline.
  const clipsChanged = state.clips.some((before) => !equalClip(before, afterClips.find((after) => after.id === before.id)));
  if (!clipsChanged && JSON.stringify(state.tracks) === JSON.stringify(afterTracks)) return null;

  const afterGaps = syncGapsForTracks(state, afterClips, afterTracks, affectedTrackIds);

  const affectedClipIds = new Set<string>();
  for (const before of state.clips) {
    const after = afterClips.find((item) => item.id === before.id);
    if (!equalClip(before, after)) affectedClipIds.add(before.id);
  }
  const beforeTracks = state.tracks.filter((track) => affectedTrackIds.has(track.id));
  const changedAfterTrackIds = new Set(afterTracks.filter((track) => affectedTrackIds.has(track.id)).map((track) => track.id));
  const afterAffectedTracks = afterTracks.filter((track) => changedAfterTrackIds.has(track.id));
  const beforeGaps = state.gaps.filter((gap) => affectedTrackIds.has(gap.trackId));
  const afterAffectedGaps = afterGaps.filter((gap) => affectedTrackIds.has(gap.trackId));

  if (affectedClipIds.size === 0 && JSON.stringify(beforeTracks) === JSON.stringify(afterAffectedTracks) && JSON.stringify(beforeGaps) === JSON.stringify(afterAffectedGaps) && state.mainVideoTrackId === mainVideoTrackIdAfter) {
    return null;
  }

  return {
    beforeClips: state.clips.filter((item) => affectedClipIds.has(item.id)),
    afterClips: afterClips.filter((item) => affectedClipIds.has(item.id)),
    beforeTracks,
    afterTracks: afterAffectedTracks,
    beforeTrackIndices: beforeTracks.map((track) => state.tracks.findIndex((item) => item.id === track.id)),
    afterTrackIndices: afterAffectedTracks.map((track) => afterTracks.findIndex((item) => item.id === track.id)),
    beforeGaps,
    afterGaps: afterAffectedGaps,
    beforeGapIndices: beforeGaps.map((gap) => state.gaps.findIndex((item) => item.id === gap.id)),
    afterGapIndices: afterAffectedGaps.map((gap) => afterGaps.findIndex((item) => item.id === gap.id)),
    affectedTrackIds: [...affectedTrackIds],
    mainVideoTrackIdBefore: state.mainVideoTrackId,
    mainVideoTrackIdAfter,
  };
}

function applyPatch(state: TimelineDragState, patch: TimelineDragResult, undo: boolean): TimelineDragState {
  const clips = undo ? patch.beforeClips : patch.afterClips;
  const tracks = undo ? patch.beforeTracks : patch.afterTracks;
  const gaps = undo ? patch.beforeGaps : patch.afterGaps;
  const clipMap = new Map(clips.map((clip) => [clip.id, clip]));
  const trackIds = new Set(patch.affectedTrackIds);
  const gapIds = new Set(patch.beforeGaps.map((gap) => gap.id).concat(patch.afterGaps.map((gap) => gap.id)));
  const nextClips = state.clips.map((clip) => clipMap.get(clip.id) ?? clip);
  const nextTracks = [...state.tracks.filter((track) => !trackIds.has(track.id))];
  const indices = undo ? patch.beforeTrackIndices : patch.afterTrackIndices;
  tracks.forEach((track, index) => {
    const targetIndex = Math.max(0, Math.min(indices[index] ?? nextTracks.length, nextTracks.length));
    nextTracks.splice(targetIndex, 0, track);
  });
  const nextGaps = [...state.gaps.filter((gap) => !trackIds.has(gap.trackId) && !gapIds.has(gap.id))];
  const gapIndices = undo ? patch.beforeGapIndices : patch.afterGapIndices;
  gaps.forEach((gap, index) => {
    const targetIndex = Math.max(0, Math.min(gapIndices[index] ?? nextGaps.length, nextGaps.length));
    nextGaps.splice(targetIndex, 0, gap);
  });
  return {
    ...state,
    clips: nextClips,
    tracks: nextTracks,
    gaps: nextGaps,
    mainVideoTrackId: undo ? patch.mainVideoTrackIdBefore : patch.mainVideoTrackIdAfter,
    epoch: state.epoch + 1,
  };
}

export class TimelineDragCommand implements Command {
  readonly id: string;
  readonly label: string;
  readonly timestamp: number;
  readonly undoable = true;

  constructor(private readonly patch: TimelineDragResult, label = "Move Clips") {
    this.id = generateCommandId();
    this.label = label;
    this.timestamp = Date.now();
  }

  apply(state: TimelineDragState): TimelineDragState {
    return applyPatch(state, this.patch, false);
  }

  invert(): TimelineDragCommand {
    return new TimelineDragCommand({
      ...this.patch,
      beforeClips: this.patch.afterClips,
      afterClips: this.patch.beforeClips,
      beforeTracks: this.patch.afterTracks,
      afterTracks: this.patch.beforeTracks,
      beforeTrackIndices: this.patch.afterTrackIndices,
      afterTrackIndices: this.patch.beforeTrackIndices,
      beforeGaps: this.patch.afterGaps,
      afterGaps: this.patch.beforeGaps,
      beforeGapIndices: this.patch.afterGapIndices,
      afterGapIndices: this.patch.beforeGapIndices,
      mainVideoTrackIdBefore: this.patch.mainVideoTrackIdAfter,
      mainVideoTrackIdAfter: this.patch.mainVideoTrackIdBefore,
    }, "Undo Move Clips");
  }

  toJSON(): Record<string, unknown> {
    return { type: "TimelineDrag", patch: this.patch };
  }

  static fromJSON(data: Record<string, any>): TimelineDragCommand {
    return new TimelineDragCommand(data.patch);
  }
}

export function buildTimelineDragCommand(input: BuildTimelineDragResultInput): TimelineDragCommand | null {
  const patch = buildTimelineDragResult(input);
  return patch ? new TimelineDragCommand(patch) : null;
}

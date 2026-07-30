import type { Clip, MediaAsset, Track } from "@/types";
import { snapToFrameBoundary } from "@/lib/utils/frameTime";

/** Frame-snapped placement decision shared by insert preview and commit. */
export interface InsertEditDecision {
  accepted: boolean;
  targetTrackId: string;
  insertionTime: number;
  splitClipId: string | null;
  shiftedClipIds: string[];
  reason?: string;
}

function isCompatible(track: Track, asset: MediaAsset): boolean {
  if (asset.type === "audio") return track.type === "audio";
  return track.type === "video";
}

/** Resolve whether and how a media asset can be inserted on a timeline track. */
export function resolveInsertEdit(params: {
  track: Track;
  asset: MediaAsset;
  clips: Clip[];
  requestedTime: number;
  frameRate: number;
}): InsertEditDecision {
  const { track, asset, clips, frameRate } = params;
  const insertionTime = Math.max(0, snapToFrameBoundary(params.requestedTime, frameRate));

  if (track.locked) {
    return { accepted: false, targetTrackId: track.id, insertionTime, splitClipId: null, shiftedClipIds: [], reason: "Track is locked" };
  }
  if (!isCompatible(track, asset)) {
    return { accepted: false, targetTrackId: track.id, insertionTime, splitClipId: null, shiftedClipIds: [], reason: "Media type is incompatible with this track" };
  }

  const trackClips = clips.filter((clip) => clip.trackId === track.id);
  const splitClip = trackClips.find((clip) => insertionTime > clip.startTime + 0.0005 && insertionTime < clip.startTime + clip.duration - 0.0005);
  const shiftedClipIds = trackClips.filter((clip) => clip.id !== splitClip?.id && clip.startTime >= insertionTime - 0.0005).map((clip) => clip.id);

  return {
    accepted: true,
    targetTrackId: track.id,
    insertionTime,
    splitClipId: splitClip?.id ?? null,
    shiftedClipIds,
  };
}

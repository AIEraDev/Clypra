import type { Clip, MediaAsset, MediaTimelineItem, TextClip, TextTimelineItem, TimelineItem, TimelineItemRole, Track } from "@/types";
import { inferRoleFromTrackPosition } from "./adapter";
import { expandCompoundClips } from "./compoundClips";

const emptyEffects = () => ({ effects: [], version: 0 });

export function legacyClipToTimelineItem(clip: Clip, tracks: Track[], assets: MediaAsset[] = []): MediaTimelineItem | TextTimelineItem {
  const track = tracks.find((t) => t.id === clip.trackId);
  const trackIndex = tracks.findIndex((t) => t.id === clip.trackId);
  const asset = assets.find((a) => a.id === clip.mediaId);
  const isText = clip.kind === "text";
  const role = (((clip as any).role as TimelineItemRole | undefined) ?? inferRoleFromTrackPosition(track, trackIndex, tracks)) as TimelineItemRole;

  const placement = {
    trackId: clip.trackId,
    startTime: clip.startTime,
    duration: clip.duration,
    role,
    zIndex: Number.isFinite((clip as any).zIndex) ? (clip as any).zIndex : Math.max(0, trackIndex),
  };

  const transform = {
    x: clip.x,
    y: clip.y,
    width: clip.width,
    height: clip.height,
    opacity: clip.opacity,
    rotation: clip.rotation,
    aspectRatioLocked: clip.aspectRatioLocked,
    sourceAspectRatio: clip.sourceAspectRatio,
    fitMode: clip.fitMode,
  };

  if (isText) {
    const { id, trackId, mediaId, startTime, duration, trimIn, trimOut, x, y, width, height, opacity, rotation, aspectRatioLocked, sourceAspectRatio, fitMode, ...text } = clip as TextClip;
    void id;
    void trackId;
    void mediaId;
    void startTime;
    void duration;
    void trimIn;
    void trimOut;
    void x;
    void y;
    void width;
    void height;
    void opacity;
    void rotation;
    void aspectRatioLocked;
    void sourceAspectRatio;
    void fitMode;
    return {
      id: clip.id,
      kind: "text",
      placement: { ...placement, role: "text" },
      transform,
      effects: emptyEffects(),
      text,
    };
  }

  return {
    id: clip.id,
    kind: asset?.type ?? "video",
    placement,
    source: {
      mediaId: clip.mediaId,
      trimIn: clip.trimIn,
      trimOut: clip.trimOut,
      playbackRate: 1,
      reverse: false,
    },
    transform,
    audio: asset?.type === "audio" || asset?.type === "video" ? { volume: 1, pan: 0, muted: false } : undefined,
    effects: emptyEffects(),
  };
}

export function legacyClipsToTimelineItems(clips: Clip[], tracks: Track[], assets: MediaAsset[] = []): TimelineItem[] {
  return expandCompoundClips(clips).map((clip) => legacyClipToTimelineItem(clip, tracks, assets));
}

export function timelineItemToLegacyClip(item: TimelineItem): Clip | null {
  if (item.kind === "transition") return null;

  const base = {
    id: item.id,
    trackId: item.placement.trackId,
    startTime: item.placement.startTime,
    duration: item.placement.duration,
    x: item.transform.x,
    y: item.transform.y,
    width: item.transform.width,
    height: item.transform.height,
    opacity: item.transform.opacity,
    rotation: item.transform.rotation,
    aspectRatioLocked: item.transform.aspectRatioLocked,
    sourceAspectRatio: item.transform.sourceAspectRatio,
    fitMode: item.transform.fitMode,
  };

  if (item.kind === "text") {
    return {
      ...base,
      mediaId: "",
      trimIn: 0,
      trimOut: item.placement.duration,
      ...item.text,
    } as TextClip;
  }

  return {
    ...base,
    mediaId: item.source.mediaId,
    trimIn: item.source.trimIn,
    trimOut: item.source.trimOut,
  } as Clip;
}

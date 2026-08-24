import type { Clip, Track } from "@/types";
import { snapToFrameBoundary } from "@/lib/utils/frameTime";

/**
 * Timeline content that participates in the program-preview bridge.
 * Overlay/effect content intentionally stays on its existing interaction path.
 */
export const PROGRAM_BRIDGE_CLIP_KINDS = new Set<Clip["kind"]>([
  "video",
  "image",
  "audio",
]);

export function isProgramBridgeClip(clip: Pick<Clip, "kind">): boolean {
  return PROGRAM_BRIDGE_CLIP_KINDS.has(clip.kind);
}

/**
 * Clamp a user-initiated timeline seek to the program duration and project
 * frame grid. Playback itself remains continuous; this is for scrubbing,
 * playhead dragging, and frame-step commands.
 */
export function clampAndSnapProgramTime(
  time: number,
  duration: number,
  frameRate: number,
): number {
  const safeDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  const safeTime = Number.isFinite(time) ? time : 0;
  const clamped = Math.max(0, Math.min(safeTime, safeDuration));
  const safeFrameRate = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 30;
  const snapped = snapToFrameBoundary(clamped, safeFrameRate);

  return Math.max(0, Math.min(snapped, safeDuration));
}

export function getActiveProgramBridgeClips(
  clips: Clip[],
  time: number,
): Clip[] {
  return clips.filter(
    (clip) =>
      isProgramBridgeClip(clip) &&
      clip.startTime <= time &&
      time < clip.startTime + Math.max(0, clip.duration),
  );
}

/**
 * Returns the topmost active visual clip using the compositor's track order.
 * Audio participates in the active-clip calculation above, but has no visual
 * transform surface in the program preview.
 */
export function getActiveVisualProgramClip(
  clips: Clip[],
  tracks: Track[],
  time: number,
): Clip | null {
  const trackOrder = new Map(tracks.map((track, index) => [track.id, index]));
  const activeVisual = clips
    .map((clip, index) => ({ clip, index }))
    .filter(
      ({ clip }) =>
        (clip.kind === "video" || clip.kind === "image") &&
        tracks.find((track) => track.id === clip.trackId)?.visible !== false &&
        clip.startTime <= time &&
        time < clip.startTime + Math.max(0, clip.duration),
    )
    .sort((a, b) => {
      const trackDelta =
        (trackOrder.get(a.clip.trackId) ?? Number.MAX_SAFE_INTEGER) -
        (trackOrder.get(b.clip.trackId) ?? Number.MAX_SAFE_INTEGER);
      return trackDelta || b.index - a.index;
    });

  return activeVisual[0]?.clip ?? null;
}


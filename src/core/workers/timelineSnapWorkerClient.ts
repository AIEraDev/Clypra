/**
 * TimelineSnapWorkerClient — Main-Thread Client for TimelineSnapWorker
 *
 * Provides off-thread magnetic snapping, collision detection, and ripple math
 * via WorkerBus with synchronous fallback support for test/SSR environments.
 */

import { WorkerBus } from "./workerBus";
import type {
  TimelineSnapWorkerRequest,
  TimelineSnapWorkerResponse,
  SnapClip,
  SnapMarker,
  SnapResult,
  RippleResult,
  SnapGuideType,
} from "@/workers/types";

export class TimelineSnapWorkerClient {
  private readonly bus: WorkerBus<
    TimelineSnapWorkerRequest,
    TimelineSnapWorkerResponse
  >;
  private fallbackClips: SnapClip[] = [];
  private fallbackMarkers: SnapMarker[] = [];

  constructor() {
    this.bus = new WorkerBus(
      () =>
        new Worker(
          new URL("../../workers/timelineSnap.worker.ts", import.meta.url),
          { type: "module" },
        ),
      { name: "TimelineSnapWorker", autoRestart: true },
    );
  }

  /**
   * Synchronize the worker's internal interval tree with current timeline state.
   */
  syncState(clips: SnapClip[], markers: SnapMarker[] = []): void {
    this.fallbackClips = clips;
    this.fallbackMarkers = markers;
    this.bus.post({ type: "SYNC_STATE", clips, markers });
  }

  /**
   * Query the nearest magnetic snap boundary and colliding clip IDs.
   */
  async querySnap(
    draggedClipId: string,
    proposedStartTime: number,
    trackId: string,
    options: {
      snapEnabled?: boolean;
      snapRadiusSeconds?: number;
      playheadTime?: number;
    } = {},
  ): Promise<SnapResult> {
    const {
      snapEnabled = true,
      snapRadiusSeconds = 0.1,
      playheadTime = 0,
    } = options;

    if (this.bus.status === "error" || typeof Worker === "undefined") {
      return this.fallbackQuerySnap(
        draggedClipId,
        proposedStartTime,
        trackId,
        snapEnabled,
        snapRadiusSeconds,
        playheadTime,
      );
    }

    try {
      return await this.bus.send<SnapResult>({
        type: "SNAP_QUERY",
        draggedClipId,
        proposedStartTime,
        trackId,
        snapEnabled,
        snapRadiusSeconds,
        playheadTime,
      } as any);
    } catch {
      return this.fallbackQuerySnap(
        draggedClipId,
        proposedStartTime,
        trackId,
        snapEnabled,
        snapRadiusSeconds,
        playheadTime,
      );
    }
  }

  /**
   * Compute multi-track ripple displacements when a clip is moved or trimmed.
   */
  async computeRipple(
    anchorClipId: string,
    side: "left" | "right",
    deltaSeconds: number,
    lockedTrackIds: string[] = [],
  ): Promise<RippleResult> {
    if (this.bus.status === "error" || typeof Worker === "undefined") {
      return this.fallbackComputeRipple(
        anchorClipId,
        side,
        deltaSeconds,
        lockedTrackIds,
      );
    }

    try {
      return await this.bus.send<RippleResult>({
        type: "RIPPLE_COMPUTE",
        anchorClipId,
        side,
        deltaSeconds,
        lockedTrackIds,
      } as any);
    } catch {
      return this.fallbackComputeRipple(
        anchorClipId,
        side,
        deltaSeconds,
        lockedTrackIds,
      );
    }
  }

  dispose(): void {
    this.fallbackClips = [];
    this.fallbackMarkers = [];
    this.bus.dispose();
  }

  // ─── Main-Thread Fallback ───────────────────────────────────────────────────

  private fallbackQuerySnap(
    draggedClipId: string,
    proposedStartTime: number,
    trackId: string,
    snapEnabled: boolean,
    snapRadiusSeconds: number,
    playheadTime: number,
  ): SnapResult {
    if (!snapEnabled) {
      return {
        type: "SNAP_RESULT",
        id: "fallback",
        snappedTime: proposedStartTime,
        snapGuides: [],
        collidingClipIds: this.findCollisions(draggedClipId, trackId, proposedStartTime),
      };
    }

    let closestDistance = snapRadiusSeconds;
    let snappedTime = proposedStartTime;
    let activeGuide: { time: number; guideType: SnapGuideType } | null = null;

    if (Math.abs(proposedStartTime) < closestDistance) {
      closestDistance = Math.abs(proposedStartTime);
      snappedTime = 0;
      activeGuide = { time: 0, guideType: "clip-start" };
    }

    if (Math.abs(proposedStartTime - playheadTime) < closestDistance) {
      closestDistance = Math.abs(proposedStartTime - playheadTime);
      snappedTime = playheadTime;
      activeGuide = { time: playheadTime, guideType: "playhead" };
    }

    for (const clip of this.fallbackClips) {
      if (clip.clipId === draggedClipId) continue;

      const distStart = Math.abs(clip.startTime - proposedStartTime);
      if (distStart < closestDistance) {
        closestDistance = distStart;
        snappedTime = clip.startTime;
        activeGuide = { time: clip.startTime, guideType: "clip-start" };
      }

      const clipEnd = clip.startTime + clip.duration;
      const distEnd = Math.abs(clipEnd - proposedStartTime);
      if (distEnd < closestDistance) {
        closestDistance = distEnd;
        snappedTime = clipEnd;
        activeGuide = { time: clipEnd, guideType: "clip-end" };
      }
    }

    for (const marker of this.fallbackMarkers) {
      const distMarker = Math.abs(marker.time - proposedStartTime);
      if (distMarker < closestDistance) {
        closestDistance = distMarker;
        snappedTime = marker.time;
        activeGuide = { time: marker.time, guideType: "marker" };
      }
    }

    return {
      type: "SNAP_RESULT",
      id: "fallback",
      snappedTime,
      snapGuides: activeGuide ? [activeGuide] : [],
      collidingClipIds: this.findCollisions(draggedClipId, trackId, snappedTime),
    };
  }

  private findCollisions(
    draggedClipId: string,
    trackId: string,
    startTime: number,
  ): string[] {
    const dragged = this.fallbackClips.find((c) => c.clipId === draggedClipId);
    const duration = dragged?.duration ?? 5.0;
    const endTime = startTime + duration;

    const colliding: string[] = [];
    for (const clip of this.fallbackClips) {
      if (clip.clipId === draggedClipId || clip.trackId !== trackId) continue;
      const clipEnd = clip.startTime + clip.duration;
      if (startTime < clipEnd && endTime > clip.startTime) {
        colliding.push(clip.clipId);
      }
    }

    return colliding;
  }

  private fallbackComputeRipple(
    anchorClipId: string,
    side: "left" | "right",
    deltaSeconds: number,
    lockedTrackIds: string[],
  ): RippleResult {
    const anchor = this.fallbackClips.find((c) => c.clipId === anchorClipId);
    if (!anchor || deltaSeconds === 0) {
      return { type: "RIPPLE_RESULT", id: "fallback", clipDeltas: [] };
    }

    const lockedSet = new Set(lockedTrackIds);
    const boundary =
      side === "left" ? anchor.startTime : anchor.startTime + anchor.duration;

    const clipDeltas: Array<{ clipId: string; deltaSeconds: number }> = [];

    for (const clip of this.fallbackClips) {
      if (clip.clipId === anchorClipId || lockedSet.has(clip.trackId)) continue;
      if (clip.startTime >= boundary) {
        clipDeltas.push({ clipId: clip.clipId, deltaSeconds });
      }
    }

    return { type: "RIPPLE_RESULT", id: "fallback", clipDeltas };
  }
}

// ─── Singleton Factory ────────────────────────────────────────────────────────

let clientInstance: TimelineSnapWorkerClient | null = null;

export function getTimelineSnapWorkerClient(): TimelineSnapWorkerClient {
  if (!clientInstance) {
    clientInstance = new TimelineSnapWorkerClient();
  }
  return clientInstance;
}

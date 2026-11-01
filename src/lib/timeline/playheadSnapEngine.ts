/**
 * Playhead Magnetic Snapping Engine
 *
 * Implements high-performance, tactile magnetic playhead snapping during
 * timeline dragging and scrubbing.
 *
 * Features:
 * - Exhaustive 10-target snapping support: sequence bounds (0:00, end),
 *   clip in/out edges, cut/split seams, timeline markers, clip markers,
 *   transitions (start, center, end), visual/audio keyframes, gaps, captions.
 * - Screen-calibrated magnetic hysteresis: snap-in radius vs. escape breakaway
 *   threshold to give physical tactile "pressure".
 * - Visual guide line color-coding and priority tie-breaking.
 * - Modifier bypass (Cmd / Ctrl) for micro-scrubbing.
 * - Zero IPC overhead: purely in-memory, synchronous, 60fps rAF compliant.
 */

import type {
  Clip,
  Track,
  TransitionTimelineItem,
  TimelineMarker,
  Gap,
  CaptionTrack,
} from "@/types";
import { ticksToSeconds } from "@/types/captions";
import type { TimelineSnapGuide, SnapGuideType } from "@/store/timelineStore";
import { collectTimelineKeyframes } from "./snapTargets";

export type PlayheadSnapCategory =
  | "sequence-boundary"
  | "cut"
  | "clip-edge"
  | "marker"
  | "transition"
  | "keyframe"
  | "gap";

export interface PlayheadSnapTarget {
  id: string;
  time: number;
  category: PlayheadSnapCategory;
  guideType: SnapGuideType;
  label?: string;
  priority: number; // Lower number = higher priority
}

export interface CollectSnapTargetsParams {
  clips: readonly Clip[];
  tracks?: readonly Track[];
  markers?: readonly TimelineMarker[];
  transitions?: readonly TransitionTimelineItem[];
  gaps?: readonly Gap[];
  captionTracks?: readonly CaptionTrack[];
  duration: number;
}

export interface EvaluatePlayheadSnapParams {
  candidateTime: number;
  pointerPx: number;
  currentSnappedTarget: PlayheadSnapTarget | null;
  anchorPointerPx: number | null;
  snapTargets: readonly PlayheadSnapTarget[];
  pixelsPerSecond: number;
  snapEnabled: boolean;
  bypassModifier?: boolean;
  snapInThresholdPx?: number;
  escapeThresholdPx?: number;
}

export interface PlayheadSnapEvaluationResult {
  snapped: boolean;
  time: number;
  activeTarget: PlayheadSnapTarget | null;
  anchorPointerPx: number | null;
  guide: TimelineSnapGuide | null;
}

export const PLAYHEAD_SNAP_DEFAULTS = {
  SNAP_IN_THRESHOLD_PX: 10,
  ESCAPE_THRESHOLD_PX: 22,
  COINCIDENT_EPSILON_SEC: 0.001,
} as const;

/**
 * Collects and prioritizes all snap targets across the timeline.
 * Results are sorted strictly by timestamp, with coincident points
 * resolved by priority.
 */
export function collectPlayheadSnapTargets(
  params: CollectSnapTargetsParams,
): PlayheadSnapTarget[] {
  const {
    clips = [],
    tracks = [],
    markers = [],
    transitions = [],
    gaps = [],
    captionTracks = [],
    duration = 0,
  } = params;

  const rawTargets: PlayheadSnapTarget[] = [];
  const lockedTrackIds = new Set(
    tracks.filter((t) => t.locked).map((t) => t.id),
  );

  // 1. Sequence Boundaries (Priority 1)
  rawTargets.push({
    id: "seq-start",
    time: 0,
    category: "sequence-boundary",
    guideType: "sequence-boundary",
    label: "00:00:00:00",
    priority: 1,
  });

  if (typeof duration === "number" && duration > 0.01) {
    rawTargets.push({
      id: "seq-end",
      time: duration,
      category: "sequence-boundary",
      guideType: "sequence-boundary",
      label: "Sequence End",
      priority: 1,
    });
  }

  // 2. Clip Boundaries, Cuts & Clip Markers
  // Filter out clips on locked tracks to respect track locking
  const unlockedClips = clips.filter((c) => !lockedTrackIds.has(c.trackId));

  // Group by track to identify abutting cut seams
  const clipsByTrack = new Map<string, Clip[]>();
  for (const clip of unlockedClips) {
    if (typeof clip.startTime !== "number" || isNaN(clip.startTime)) continue;
    const list = clipsByTrack.get(clip.trackId) || [];
    list.push(clip);
    clipsByTrack.set(clip.trackId, list);
  }

  for (const trackClips of clipsByTrack.values()) {
    trackClips.sort((a, b) => a.startTime - b.startTime);

    for (let i = 0; i < trackClips.length; i++) {
      const clip = trackClips[i];
      const clipEnd = clip.startTime + Math.max(0, clip.duration || 0);

      // Check if this clip's start abuts the previous clip's end
      const prevClip = i > 0 ? trackClips[i - 1] : null;
      const prevEnd = prevClip
        ? prevClip.startTime + Math.max(0, prevClip.duration || 0)
        : null;

      const isAbuttingCut =
        prevEnd !== null &&
        Math.abs(clip.startTime - prevEnd) <= PLAYHEAD_SNAP_DEFAULTS.COINCIDENT_EPSILON_SEC;

      if (isAbuttingCut) {
        rawTargets.push({
          id: `cut-${clip.trackId}-${clip.id}`,
          time: clip.startTime,
          category: "cut",
          guideType: "cut",
          label: "Cut",
          priority: 2,
        });
      } else {
        rawTargets.push({
          id: `clip-start-${clip.id}`,
          time: clip.startTime,
          category: "clip-edge",
          guideType: "clip-start",
          label: clip.name,
          priority: 3,
        });
      }

      // Check if next clip abuts this clip's end (if so, next clip handles the cut)
      const nextClip = i < trackClips.length - 1 ? trackClips[i + 1] : null;
      const nextAbuts =
        nextClip !== null &&
        Math.abs(nextClip.startTime - clipEnd) <= PLAYHEAD_SNAP_DEFAULTS.COINCIDENT_EPSILON_SEC;

      if (!nextAbuts) {
        rawTargets.push({
          id: `clip-end-${clip.id}`,
          time: clipEnd,
          category: "clip-edge",
          guideType: "clip-end",
          label: clip.name,
          priority: 3,
        });
      }

      // Clip-level Markers (Priority 4)
      if (Array.isArray((clip as any).markers)) {
        for (const cm of (clip as any).markers) {
          if (typeof cm?.localTime === "number" && !isNaN(cm.localTime)) {
            const absTime = clip.startTime + cm.localTime;
            if (absTime >= 0 && absTime <= clipEnd) {
              rawTargets.push({
                id: `clip-marker-${clip.id}-${cm.id || cm.localTime}`,
                time: absTime,
                category: "marker",
                guideType: "marker",
                label: cm.name || "Clip Marker",
                priority: 4,
              });
            }
          }
        }
      }
    }
  }

  // 3. Global Timeline Markers (Priority 3)
  for (const marker of markers) {
    if (typeof marker?.time === "number" && !isNaN(marker.time) && marker.time >= 0) {
      rawTargets.push({
        id: `marker-${marker.id || marker.time}`,
        time: marker.time,
        category: "marker",
        guideType: "marker",
        label: marker.name || "Marker",
        priority: 3,
      });
    }
  }

  // 4. Transitions (Start, Center Cut, End) (Priority 4/5)
  for (const tr of transitions) {
    const trStartTime = (tr as any).startTime ?? tr.placement?.startTime;
    const trDurationRaw = (tr as any).duration ?? tr.placement?.duration;

    if (typeof trStartTime === "number" && !isNaN(trStartTime)) {
      const trDuration = Math.max(0, trDurationRaw || 0);
      const trEnd = trStartTime + trDuration;
      const trCenter = trStartTime + trDuration / 2;

      rawTargets.push({
        id: `tr-start-${tr.id}`,
        time: trStartTime,
        category: "transition",
        guideType: "transition",
        label: "Transition Start",
        priority: 5,
      });

      if (trDuration > 0.05) {
        rawTargets.push({
          id: `tr-center-${tr.id}`,
          time: trCenter,
          category: "transition",
          guideType: "cut",
          label: "Transition Center",
          priority: 4,
        });
      }

      rawTargets.push({
        id: `tr-end-${tr.id}`,
        time: trEnd,
        category: "transition",
        guideType: "transition",
        label: "Transition End",
        priority: 5,
      });
    }
  }

  // 5. Keyframes (Visual & Audio) (Priority 6)
  const keyframes = collectTimelineKeyframes(unlockedClips);
  for (const kf of keyframes) {
    rawTargets.push({
      id: `kf-${kf.clipId}-${kf.propertyKey || "prop"}-${kf.time.toFixed(3)}`,
      time: kf.time,
      category: "keyframe",
      guideType: "keyframe",
      label: kf.propertyKey ? `Keyframe: ${kf.propertyKey}` : "Keyframe",
      priority: 6,
    });
  }

  // 6. Gaps (Start and End) (Priority 7)
  for (const gap of gaps) {
    if (typeof gap?.startTime === "number" && !isNaN(gap.startTime)) {
      const gapEnd = gap.startTime + Math.max(0, gap.duration || 0);
      rawTargets.push({
        id: `gap-start-${gap.id}`,
        time: gap.startTime,
        category: "gap",
        guideType: "gap",
        label: "Gap Start",
        priority: 7,
      });
      rawTargets.push({
        id: `gap-end-${gap.id}`,
        time: gapEnd,
        category: "gap",
        guideType: "gap",
        label: "Gap End",
        priority: 7,
      });
    }
  }

  // 7. Caption Track Cues (Priority 5)
  for (const ct of captionTracks) {
    if (Array.isArray(ct?.cues)) {
      for (const cue of ct.cues) {
        const cueStart =
          typeof cue?.startTicks === "number"
            ? ticksToSeconds(cue.startTicks)
            : (cue as any)?.startTime;
        const cueEnd =
          typeof cue?.endTicks === "number"
            ? ticksToSeconds(cue.endTicks)
            : (cue as any)?.endTime;

        if (typeof cueStart === "number" && typeof cueEnd === "number") {
          rawTargets.push({
            id: `caption-start-${cue.id || cueStart}`,
            time: cueStart,
            category: "marker",
            guideType: "marker",
            label: "Caption Start",
            priority: 5,
          });
          rawTargets.push({
            id: `caption-end-${cue.id || cueEnd}`,
            time: cueEnd,
            category: "marker",
            guideType: "marker",
            label: "Caption End",
            priority: 5,
          });
        }
      }
    }
  }

  // Sort by time ascending; resolve coincident targets by priority (lowest number first)
  rawTargets.sort((a, b) => {
    const timeDiff = a.time - b.time;
    if (Math.abs(timeDiff) > PLAYHEAD_SNAP_DEFAULTS.COINCIDENT_EPSILON_SEC) {
      return timeDiff;
    }
    return a.priority - b.priority;
  });

  // Deduplicate coincident targets (points within 1ms), keeping highest priority
  const dedupedTargets: PlayheadSnapTarget[] = [];
  for (const target of rawTargets) {
    const last = dedupedTargets[dedupedTargets.length - 1];
    if (
      last &&
      Math.abs(last.time - target.time) <= PLAYHEAD_SNAP_DEFAULTS.COINCIDENT_EPSILON_SEC
    ) {
      // If the incoming target has strictly higher priority, replace it
      if (target.priority < last.priority) {
        dedupedTargets[dedupedTargets.length - 1] = target;
      }
      continue;
    }
    dedupedTargets.push(target);
  }

  return dedupedTargets;
}

/**
 * Evaluates magnetic snapping for the playhead during scrubbing or dragging.
 * Handles snap-in attraction and escape hysteresis resistance.
 */
export function evaluatePlayheadSnap(
  params: EvaluatePlayheadSnapParams,
): PlayheadSnapEvaluationResult {
  const {
    candidateTime,
    pointerPx,
    currentSnappedTarget,
    anchorPointerPx,
    snapTargets,
    pixelsPerSecond,
    snapEnabled,
    bypassModifier = false,
    snapInThresholdPx = PLAYHEAD_SNAP_DEFAULTS.SNAP_IN_THRESHOLD_PX,
    escapeThresholdPx = PLAYHEAD_SNAP_DEFAULTS.ESCAPE_THRESHOLD_PX,
  } = params;

  // Bypassed or disabled
  if (
    !snapEnabled ||
    bypassModifier ||
    !snapTargets ||
    snapTargets.length === 0 ||
    !Number.isFinite(candidateTime) ||
    pixelsPerSecond <= 0
  ) {
    return {
      snapped: false,
      time: candidateTime,
      activeTarget: null,
      anchorPointerPx: null,
      guide: null,
    };
  }

  const snapInThresholdSec = snapInThresholdPx / pixelsPerSecond;

  // ── Hysteresis check: currently locked target ─────────────────────────────
  if (currentSnappedTarget !== null && anchorPointerPx !== null) {
    const pointerDeltaPx = Math.abs(pointerPx - anchorPointerPx);

    // If pointer has not exceeded escape threshold, stay magnetically locked
    if (pointerDeltaPx < escapeThresholdPx) {
      return {
        snapped: true,
        time: currentSnappedTarget.time,
        activeTarget: currentSnappedTarget,
        anchorPointerPx,
        guide: {
          time: currentSnappedTarget.time,
          type: currentSnappedTarget.guideType,
          label: currentSnappedTarget.label,
        },
      };
    }
  }

  // ── Snap-in search: find closest target within snap-in radius ─────────────
  let bestTarget: PlayheadSnapTarget | null = null;
  let minDistance = snapInThresholdSec;

  for (const target of snapTargets) {
    const dist = Math.abs(target.time - candidateTime);
    if (
      dist < minDistance ||
      (Math.abs(dist - minDistance) <= PLAYHEAD_SNAP_DEFAULTS.COINCIDENT_EPSILON_SEC &&
        bestTarget !== null &&
        target.priority < bestTarget.priority)
    ) {
      minDistance = dist;
      bestTarget = target;
    }
  }

  if (bestTarget !== null) {
    return {
      snapped: true,
      time: bestTarget.time,
      activeTarget: bestTarget,
      anchorPointerPx: pointerPx,
      guide: {
        time: bestTarget.time,
        type: bestTarget.guideType,
        label: bestTarget.label,
      },
    };
  }

  return {
    snapped: false,
    time: candidateTime,
    activeTarget: null,
    anchorPointerPx: null,
    guide: null,
  };
}

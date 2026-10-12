import React, { useState, useRef, useCallback, useMemo } from "react";
import {
  Activity,
  Maximize2,
  Minimize2,
  Move,
  RotateCw,
  Eye,
  Volume2,
  Sparkles,
  Plus,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { useTimelineStore } from "@/store/timelineStore";
import { useUIStore } from "@/store/uiStore";
import { useHistoryStore } from "@/store/historyStore";
import { usePlaybackClock, usePlaybackControls } from "@/hooks/usePlaybackClock";
import { TransformClipCommand } from "@/core/history/commands/TransformCommand";
import {
  retimeKeyframe,
  duplicateKeyframe,
  deleteKeyframe,
  sortKeyframes,
} from "@/core/animation/keyframeTrackOps";
import type { Clip, VisualPropertyKey } from "@/types";
import type { Keyframe, KeyframeEasing } from "@/types/keyframes";
import type { AudioKeyframe } from "@/types/audio";
import { timeToPixel, pixelToTime } from "@/lib/timeline/timelineViewport";

interface InlineKeyframeLaneProps {
  clip: Clip;
  clipWidthPx: number;
  pixelsPerSecond: number;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

interface PropertyLaneConfig {
  key: "position" | "size" | "rotation" | "opacity" | "volume";
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  keyframes: Keyframe[];
}

export const InlineKeyframeLane: React.FC<InlineKeyframeLaneProps> = ({
  clip,
  clipWidthPx,
  pixelsPerSecond,
  isExpanded = false,
  onToggleExpand,
}) => {
  const { time: currentTime } = usePlaybackClock();
  const { seek } = usePlaybackControls();
  const updateClip = useTimelineStore((s) => s.updateClip);
  const openCurveEditor = useUIStore((s) => s.openCurveEditor);
  const { execute } = useHistoryStore();

  const containerRef = useRef<HTMLDivElement>(null);

  // Drag state for interactive keyframe retiming
  const [activeDrag, setActiveDrag] = useState<{
    propertyKey: string;
    keyframeId: string;
    initialTime: number;
    startX: number;
    isAltDuplicate: boolean;
  } | null>(null);

  const [selectedKeyframe, setSelectedKeyframe] = useState<{
    propertyKey: string;
    keyframeId: string;
  } | null>(null);

  // Extract all property lanes
  const visual = clip.visualKeyframes || {};
  const posXKeyframes = visual.x || [];
  const posYKeyframes = visual.y || [];
  const widthKeyframes = visual.width || [];
  const heightKeyframes = visual.height || [];
  const rotKeyframes = visual.rotation || [];
  const opacityKeyframes = visual.opacity || [];
  const volKeyframes: Keyframe<number>[] = useMemo(() => {
    return (clip.volumeKeyframes || []).map((ak) => ({
      id: ak.id,
      time: ak.time,
      value: ak.gain ?? ak.value ?? 1,
      easing: ak.easing as KeyframeEasing,
    }));
  }, [clip.volumeKeyframes]);

  // Group position (X, Y) and size (W, H)
  const lanes: PropertyLaneConfig[] = useMemo(() => {
    const list: PropertyLaneConfig[] = [];

    // Position (combined X / Y)
    const combinedPos = sortKeyframes([
      ...posXKeyframes,
      ...posYKeyframes.filter((py) => !posXKeyframes.some((px) => Math.abs(px.time - py.time) < 0.02)),
    ]);
    if (combinedPos.length > 0) {
      list.push({
        key: "position",
        label: "Position",
        icon: Move,
        color: "#38bdf8", // light blue
        keyframes: combinedPos,
      });
    }

    // Size / Scale (combined W / H)
    const combinedSize = sortKeyframes([
      ...widthKeyframes,
      ...heightKeyframes.filter((h) => !widthKeyframes.some((w) => Math.abs(w.time - h.time) < 0.02)),
    ]);
    if (combinedSize.length > 0) {
      list.push({
        key: "size",
        label: "Size",
        icon: Maximize2,
        color: "#a855f7", // purple
        keyframes: combinedSize,
      });
    }

    // Rotation
    if (rotKeyframes.length > 0) {
      list.push({
        key: "rotation",
        label: "Rotation",
        icon: RotateCw,
        color: "#f59e0b", // amber
        keyframes: rotKeyframes,
      });
    }

    // Opacity
    if (opacityKeyframes.length > 0) {
      list.push({
        key: "opacity",
        label: "Opacity",
        icon: Eye,
        color: "#10b981", // emerald
        keyframes: opacityKeyframes,
      });
    }

    // Volume
    if (volKeyframes.length > 0) {
      list.push({
        key: "volume",
        label: "Volume",
        icon: Volume2,
        color: "#ec4899", // pink
        keyframes: volKeyframes,
      });
    }

    return list;
  }, [
    posXKeyframes,
    posYKeyframes,
    widthKeyframes,
    heightKeyframes,
    rotKeyframes,
    opacityKeyframes,
    volKeyframes,
  ]);

  // Unified summary diamonds (all unique timestamps across all properties)
  const summaryKeyframes = useMemo(() => {
    const all = [
      ...posXKeyframes,
      ...posYKeyframes,
      ...widthKeyframes,
      ...heightKeyframes,
      ...rotKeyframes,
      ...opacityKeyframes,
      ...volKeyframes,
    ];
    if (all.length === 0) return [];

    // Deduplicate within 0.04s
    const unique: Keyframe[] = [];
    const sorted = sortKeyframes(all);
    for (const kf of sorted) {
      if (!unique.some((u) => Math.abs(u.time - kf.time) < 0.04)) {
        unique.push(kf);
      }
    }
    return unique;
  }, [
    posXKeyframes,
    posYKeyframes,
    widthKeyframes,
    heightKeyframes,
    rotKeyframes,
    opacityKeyframes,
    volKeyframes,
  ]);

  // Jump playhead to keyframe
  const handleKeyframeClick = (e: React.MouseEvent, kf: Keyframe) => {
    e.stopPropagation();
    seek(clip.startTime + kf.time);
  };

  // Retiming pointer drag
  const handleKeyframePointerDown = (
    e: React.PointerEvent,
    propertyKey: string,
    keyframe: Keyframe,
  ) => {
    e.stopPropagation();
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);

    const isAlt = e.altKey;
    setActiveDrag({
      propertyKey,
      keyframeId: keyframe.id,
      initialTime: keyframe.time,
      startX: e.clientX,
      isAltDuplicate: isAlt,
    });
    setSelectedKeyframe({ propertyKey, keyframeId: keyframe.id });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!activeDrag || !containerRef.current) return;
    const deltaPx = e.clientX - activeDrag.startX;
    const deltaTime = deltaPx / pixelsPerSecond;
    const rawTargetTime = activeDrag.initialTime + deltaTime;
    const newTime = Math.max(0, Math.min(clip.duration, rawTargetTime));

    const oldClip = clip;
    let updatedClip = { ...clip };

    const updatePropTrack = (kfs: Keyframe[]) => {
      if (activeDrag.isAltDuplicate) {
        return duplicateKeyframe(kfs, activeDrag.keyframeId, newTime, clip.duration);
      }
      return retimeKeyframe(kfs, activeDrag.keyframeId, newTime, clip.duration);
    };

    if (activeDrag.propertyKey === "volume") {
      const currentUnified: Keyframe<number>[] = (clip.volumeKeyframes || []).map((ak) => ({
        id: ak.id,
        time: ak.time,
        value: ak.gain ?? ak.value ?? 1,
        easing: ak.easing as KeyframeEasing,
      }));
      const updatedUnified = updatePropTrack(currentUnified);
      updatedClip.volumeKeyframes = updatedUnified.map((k) => ({
        id: k.id,
        time: k.time,
        gain: k.value,
        value: k.value,
        easing: k.easing as any,
      }));
    } else if (activeDrag.propertyKey === "position") {
      const v = { ...(clip.visualKeyframes || {}) };
      if (v.x) v.x = updatePropTrack(v.x);
      if (v.y) v.y = updatePropTrack(v.y);
      updatedClip.visualKeyframes = v;
    } else if (activeDrag.propertyKey === "size") {
      const v = { ...(clip.visualKeyframes || {}) };
      if (v.width) v.width = updatePropTrack(v.width);
      if (v.height) v.height = updatePropTrack(v.height);
      updatedClip.visualKeyframes = v;
    } else {
      const v = { ...(clip.visualKeyframes || {}) };
      const key = activeDrag.propertyKey as VisualPropertyKey;
      if (v[key]) v[key] = updatePropTrack(v[key]!);
      updatedClip.visualKeyframes = v;
    }

    // Skip epoch during real-time dragging for smooth 60fps rendering
    updateClip(clip.id, {
      ...updatedClip,
      _skipEpochIncrement: true,
    } as any);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!activeDrag) return;
    try {
      (e.target as Element).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    // Commit change into history undo/redo
    const finalClip = useTimelineStore.getState().clips.find((c) => c.id === clip.id);
    if (finalClip) {
      execute(
        new TransformClipCommand(
          clip.id,
          { visualKeyframes: clip.visualKeyframes, volumeKeyframes: clip.volumeKeyframes },
          { visualKeyframes: finalClip.visualKeyframes, volumeKeyframes: finalClip.volumeKeyframes },
          { before: clip, after: finalClip },
        ),
      );
    }
    setActiveDrag(null);
  };

  // Delete selected keyframe
  const handleDeleteSelectedKeyframe = useCallback(() => {
    if (!selectedKeyframe) return;
    const { propertyKey, keyframeId } = selectedKeyframe;

    const oldClip = { ...clip };
    let updatedClip = { ...clip };

    if (propertyKey === "volume") {
      const currentUnified: Keyframe<number>[] = (clip.volumeKeyframes || []).map((ak) => ({
        id: ak.id,
        time: ak.time,
        value: ak.gain ?? ak.value ?? 1,
        easing: ak.easing as KeyframeEasing,
      }));
      const updatedUnified = deleteKeyframe(currentUnified, keyframeId);
      updatedClip.volumeKeyframes = updatedUnified.map((k) => ({
        id: k.id,
        time: k.time,
        gain: k.value,
        value: k.value,
        easing: k.easing as any,
      }));
    } else if (propertyKey === "position") {
      const v = { ...(clip.visualKeyframes || {}) };
      if (v.x) v.x = deleteKeyframe(v.x, keyframeId);
      if (v.y) v.y = deleteKeyframe(v.y, keyframeId);
      updatedClip.visualKeyframes = v;
    } else if (propertyKey === "size") {
      const v = { ...(clip.visualKeyframes || {}) };
      if (v.width) v.width = deleteKeyframe(v.width, keyframeId);
      if (v.height) v.height = deleteKeyframe(v.height, keyframeId);
      updatedClip.visualKeyframes = v;
    } else {
      const v = { ...(clip.visualKeyframes || {}) };
      const key = propertyKey as VisualPropertyKey;
      if (v[key]) v[key] = deleteKeyframe(v[key]!, keyframeId);
      updatedClip.visualKeyframes = v;
    }

    execute(
      new TransformClipCommand(
        clip.id,
        { visualKeyframes: oldClip.visualKeyframes, volumeKeyframes: oldClip.volumeKeyframes },
        { visualKeyframes: updatedClip.visualKeyframes, volumeKeyframes: updatedClip.volumeKeyframes },
        { before: oldClip, after: updatedClip },
      ),
    );
    setSelectedKeyframe(null);
  }, [clip, selectedKeyframe, execute]);

  if (summaryKeyframes.length === 0 && !isExpanded) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className={`w-full select-none transition-all ${
        isExpanded
          ? "bg-surface-app/95 border-t border-border/80 shadow-lg py-1 px-1 flex flex-col gap-1 z-30"
          : "h-3.5 bg-black/40 border-t border-white/10 flex items-center relative overflow-hidden"
      }`}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* ── Compact Mode (Single bar with diamonds) ───────────────────────── */}
      {!isExpanded ? (
        <div className="relative w-full h-full flex items-center">
          {/* Guide line across clip */}
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[1px] bg-white/15" />

          {/* Render diamond nodes */}
          {summaryKeyframes.map((kf) => {
            const leftPx = (kf.time / clip.duration) * clipWidthPx;
            const isSelected = selectedKeyframe?.keyframeId === kf.id;
            return (
              <div
                key={kf.id}
                role="button"
                tabIndex={-1}
                onClick={(e) => handleKeyframeClick(e, kf)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  openCurveEditor(clip.id, "rotation");
                }}
                onPointerDown={(e) => handleKeyframePointerDown(e, "rotation", kf)}
                style={{ left: `${leftPx}px` }}
                className={`absolute -translate-x-1/2 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rotate-45 border transition-transform cursor-pointer hover:scale-125 ${
                  isSelected
                    ? "bg-accent border-white shadow-[0_0_6px_var(--color-accent)]"
                    : "bg-amber-400/90 border-amber-200/90 hover:bg-amber-300"
                }`}
                title={`Keyframe at ${kf.time.toFixed(2)}s • Double-click for Curve Editor`}
              />
            );
          })}
        </div>
      ) : (
        /* ── Expanded Drawer Mode (Individual property sub-tracks) ────────── */
        <div className="flex flex-col gap-1 w-full">
          {/* Drawer Header */}
          <div className="flex items-center justify-between px-1.5 py-0.5 text-[10px] text-text-muted border-b border-border/40">
            <span className="font-semibold text-text-primary flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-accent" /> Keyframe Animation Lanes
            </span>
            <div className="flex items-center gap-1">
              {selectedKeyframe && (
                <button
                  type="button"
                  onClick={handleDeleteSelectedKeyframe}
                  className="px-1.5 py-0.5 rounded text-red-400 hover:text-red-300 hover:bg-red-500/10 flex items-center gap-1 transition-colors"
                  title="Delete selected keyframe"
                >
                  <Trash2 className="w-2.5 h-2.5" /> Delete
                </button>
              )}
              {onToggleExpand && (
                <button
                  type="button"
                  onClick={onToggleExpand}
                  className="p-0.5 rounded hover:bg-surface-raised text-text-muted hover:text-text-primary transition-colors"
                  title="Collapse Keyframe Lane"
                >
                  <Minimize2 className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Sub-lane rows */}
          {lanes.map((lane) => {
            const Icon = lane.icon;
            return (
              <div
                key={lane.key}
                className="flex items-center gap-2 h-5 rounded px-1.5 bg-surface-raised/40 hover:bg-surface-raised/70 transition-colors"
              >
                {/* Lane Label */}
                <div className="w-16 shrink-0 flex items-center gap-1 text-[9px] font-medium text-text-muted truncate">
                  <Icon className="w-2.5 h-2.5" />
                  <span className="truncate">{lane.label}</span>
                </div>

                {/* Sub-lane track */}
                <div className="relative flex-1 h-full flex items-center">
                  {/* Track base line */}
                  <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[1px] bg-border/80" />

                  {/* Connecting segments between keyframes */}
                  {lane.keyframes.map((kf, i) => {
                    if (i === lane.keyframes.length - 1) return null;
                    const nextKf = lane.keyframes[i + 1];
                    const startPx = (kf.time / clip.duration) * (clipWidthPx - 70);
                    const endPx = (nextKf.time / clip.duration) * (clipWidthPx - 70);
                    const widthPx = Math.max(1, endPx - startPx);

                    return (
                      <div
                        key={`seg-${kf.id}`}
                        style={{ left: `${startPx}px`, width: `${widthPx}px` }}
                        className="absolute top-1/2 -translate-y-1/2 h-[2px] bg-accent/40 hover:bg-accent cursor-pointer group flex items-center justify-center"
                        onClick={(e) => {
                          e.stopPropagation();
                          openCurveEditor(clip.id, lane.key === "position" ? "rotation" : lane.key, i);
                        }}
                        title={`Curve: ${kf.easing || "easeInOut"} • Click to Edit Curve`}
                      >
                        {widthPx > 28 && (
                          <div className="opacity-0 group-hover:opacity-100 px-1 py-px rounded bg-surface-base border border-accent/60 text-[8px] font-mono text-accent -translate-y-3 shadow-md flex items-center gap-0.5">
                            <TrendingUp className="w-2 h-2" />
                            <span>{kf.easing || "ease"}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Diamond Keyframe Nodes */}
                  {lane.keyframes.map((kf, idx) => {
                    const leftPx = (kf.time / clip.duration) * (clipWidthPx - 70);
                    const isSelected = selectedKeyframe?.keyframeId === kf.id;
                    return (
                      <div
                        key={kf.id}
                        role="button"
                        tabIndex={-1}
                        onClick={(e) => handleKeyframeClick(e, kf)}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          openCurveEditor(clip.id, lane.key === "position" ? "rotation" : lane.key, idx);
                        }}
                        onPointerDown={(e) => handleKeyframePointerDown(e, lane.key, kf)}
                        className={`absolute -translate-x-1/2 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rotate-45 border transition-transform cursor-pointer hover:scale-130 ${
                          isSelected
                            ? "bg-white border-accent shadow-[0_0_8px_var(--color-accent)]"
                            : "border-white/80"
                        }`}
                        style={{
                          left: `${leftPx}px`,
                          backgroundColor: isSelected ? "#ffffff" : lane.color,
                        }}
                        title={`${lane.label} at ${kf.time.toFixed(2)}s • Drag to retime, Alt+Drag to duplicate, Double-click for curve`}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

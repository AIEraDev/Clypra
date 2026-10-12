import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Activity,
  Zap,
  Play,
  Pause,
  RotateCcw,
  Check,
  Sliders,
  Copy,
  Layers,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { Modal } from "@/components/ui/primitives/Modal";
import { useUIStore } from "@/store/uiStore";
import { useTimelineStore } from "@/store/timelineStore";
import { useHistoryStore } from "@/store/historyStore";
import { TransformClipCommand } from "@/core/history/commands/TransformCommand";
import {
  CURVE_PRESETS,
  getCurveEvaluator,
  type CurvePreset,
} from "@/core/animation/curvePresets";
import {
  generateCurveSamples,
  applyCurveToKeyframe,
  applyCurveToAllKeyframes,
  findActiveKeyframeSegment,
  type CurveSamplePoint,
} from "@/core/animation/keyframeTrackOps";
import type { BezierControlPoints } from "@/core/animation/cubicBezier";
import type { Keyframe, KeyframeEasing, KeyframeSpringConfig } from "@/types/keyframes";
import type { AudioKeyframe } from "@/types/audio";
import type { Clip, VisualPropertyKey } from "@/types";
import { usePlaybackClock } from "@/hooks/usePlaybackClock";

export const CurveEditorModal: React.FC = () => {
  const activeCurveEditor = useUIStore((s) => s.activeCurveEditor);
  const closeCurveEditor = useUIStore((s) => s.closeCurveEditor);
  const clips = useTimelineStore((s) => s.clips);
  const { time: currentTime } = usePlaybackClock();
  const { execute } = useHistoryStore();

  const clip = useMemo(() => {
    if (!activeCurveEditor) return null;
    return clips.find((c) => c.id === activeCurveEditor.clipId) || null;
  }, [clips, activeCurveEditor]);

  const property = activeCurveEditor?.property || "rotation";
  const isVisualProp = property !== "volume";

  // Target keyframe list
  const keyframes: Keyframe[] = useMemo(() => {
    if (!clip) return [];
    if (property === "volume") {
      return (clip.volumeKeyframes || []).map((ak) => ({
        id: ak.id,
        time: ak.time,
        value: ak.gain ?? ak.value ?? 1,
        easing: ak.easing as KeyframeEasing,
      }));
    }
    return (clip.visualKeyframes as any)?.[property] || [];
  }, [clip, property]);

  // Active keyframe segment index
  const activeSegment = useMemo(() => {
    if (!clip || keyframes.length === 0) return null;
    if (activeCurveEditor?.keyframeIndex !== undefined) {
      const idx = Math.max(0, Math.min(keyframes.length - 1, activeCurveEditor.keyframeIndex));
      return {
        index: idx,
        startKeyframe: keyframes[idx],
        endKeyframe: keyframes[idx + 1] || keyframes[idx],
        progress: 0,
      };
    }
    const localTime = Math.max(0, Math.min(clip.duration, currentTime - clip.startTime));
    return findActiveKeyframeSegment(keyframes, localTime);
  }, [clip, keyframes, activeCurveEditor?.keyframeIndex, currentTime]);

  // Editing state: control points [x1, y1, x2, y2]
  const [controlPoints, setControlPoints] = useState<BezierControlPoints>([0.42, 0.0, 0.58, 1.0]);
  const [selectedEasing, setSelectedEasing] = useState<KeyframeEasing>("easeInOut");
  const [springConfig, setSpringConfig] = useState<KeyframeSpringConfig | undefined>(undefined);
  const [viewMode, setViewMode] = useState<"value" | "speed">("value");
  const [applyScope, setApplyScope] = useState<"segment" | "property" | "clip">("segment");
  const [copiedNotification, setCopiedNotification] = useState(false);

  // Local animation loop for live curve riding preview
  const [isLoopPlaying, setIsLoopPlaying] = useState(false);
  const [localProgress, setLocalProgress] = useState(0);
  const loopAnimRef = useRef<number | null>(null);

  // Initialize from active keyframe on open
  useEffect(() => {
    if (!activeSegment?.startKeyframe) return;
    const kf = activeSegment.startKeyframe;
    if (kf.controlPoints) {
      setControlPoints([...kf.controlPoints]);
      setSelectedEasing(kf.easing || "cubic-bezier");
    } else if (kf.easing && CURVE_PRESETS[kf.easing]) {
      const preset = CURVE_PRESETS[kf.easing];
      if (preset.controlPoints) setControlPoints([...preset.controlPoints]);
      setSelectedEasing(kf.easing);
      setSpringConfig(preset.spring);
    } else {
      setControlPoints([0.42, 0.0, 0.58, 1.0]);
      setSelectedEasing("easeInOut");
    }
  }, [activeSegment?.startKeyframe]);

  // Handle local loop playback
  useEffect(() => {
    if (!isLoopPlaying) {
      if (loopAnimRef.current) cancelAnimationFrame(loopAnimRef.current);
      return;
    }
    let startTimestamp = performance.now();
    const durationMs = 1200;

    const tick = (now: number) => {
      const elapsed = (now - startTimestamp) % durationMs;
      setLocalProgress(elapsed / durationMs);
      loopAnimRef.current = requestAnimationFrame(tick);
    };

    loopAnimRef.current = requestAnimationFrame(tick);
    return () => {
      if (loopAnimRef.current) cancelAnimationFrame(loopAnimRef.current);
    };
  }, [isLoopPlaying]);

  // SVG coordinate transformation helpers
  const SVG_WIDTH = 480;
  const SVG_HEIGHT = 220;
  const PAD_X = 40;
  const PAD_Y = 35;
  const GRAPH_W = SVG_WIDTH - PAD_X * 2;
  const GRAPH_H = SVG_HEIGHT - PAD_Y * 2;

  // Coordinate mapping: t in [0, 1] -> SVG X
  const toSvgX = useCallback(
    (t: number) => PAD_X + Math.max(0, Math.min(1, t)) * GRAPH_W,
    [GRAPH_W, PAD_X],
  );

  // Coordinate mapping: val in [-0.5, 1.5] -> SVG Y (Y=0 is bottom, Y=1 is top)
  const toSvgY = useCallback(
    (v: number) => {
      const zeroY = PAD_Y + GRAPH_H; // bottom
      return zeroY - v * GRAPH_H;
    },
    [GRAPH_H, PAD_Y],
  );

  const fromSvgX = useCallback(
    (svgX: number) => {
      const clamped = Math.max(PAD_X, Math.min(PAD_X + GRAPH_W, svgX));
      return (clamped - PAD_X) / GRAPH_W;
    },
    [GRAPH_W, PAD_X],
  );

  const fromSvgY = useCallback(
    (svgY: number) => {
      const zeroY = PAD_Y + GRAPH_H;
      return (zeroY - svgY) / GRAPH_H;
    },
    [GRAPH_H, PAD_Y],
  );

  // SVG Pointer Dragging for control handles P1 and P2
  const [activeHandle, setActiveHandle] = useState<1 | 2 | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const handlePointerDown = (handle: 1 | 2, e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setActiveHandle(handle);
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!activeHandle || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mouseSvgX = ((e.clientX - rect.left) / rect.width) * SVG_WIDTH;
    const mouseSvgY = ((e.clientY - rect.top) / rect.height) * SVG_HEIGHT;

    const newT = Math.max(0, Math.min(1, fromSvgX(mouseSvgX)));
    const newVal = Math.max(-0.6, Math.min(1.6, fromSvgY(mouseSvgY)));

    setControlPoints((prev) => {
      const next: BezierControlPoints = [...prev];
      if (activeHandle === 1) {
        next[0] = Math.round(newT * 100) / 100;
        next[1] = Math.round(newVal * 100) / 100;
      } else {
        next[2] = Math.round(newT * 100) / 100;
        next[3] = Math.round(newVal * 100) / 100;
      }
      return next;
    });
    setSelectedEasing("cubic-bezier");
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (activeHandle) {
      try {
        (e.target as Element).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      setActiveHandle(null);
    }
  };

  // Generate curve samples
  const samples: CurveSamplePoint[] = useMemo(() => {
    return generateCurveSamples(controlPoints, selectedEasing, springConfig, 75);
  }, [controlPoints, selectedEasing, springConfig]);

  // Compute curve paths
  const valueCurvePath = useMemo(() => {
    if (samples.length === 0) return "";
    let d = `M ${toSvgX(samples[0].t)} ${toSvgY(samples[0].value)}`;
    for (let i = 1; i < samples.length; i++) {
      d += ` L ${toSvgX(samples[i].t)} ${toSvgY(samples[i].value)}`;
    }
    return d;
  }, [samples, toSvgX, toSvgY]);

  const valueAreaPath = useMemo(() => {
    if (samples.length === 0) return "";
    let d = `M ${toSvgX(0)} ${toSvgY(0)}`;
    for (const pt of samples) {
      d += ` L ${toSvgX(pt.t)} ${toSvgY(pt.value)}`;
    }
    d += ` L ${toSvgX(1)} ${toSvgY(0)} Z`;
    return d;
  }, [samples, toSvgX, toSvgY]);

  const speedCurvePath = useMemo(() => {
    if (samples.length === 0) return "";
    // Normalize velocity for graph display (0 to 3 range mapped into graph height)
    let d = `M ${toSvgX(samples[0].t)} ${toSvgY(samples[0].velocity / 2)}`;
    for (let i = 1; i < samples.length; i++) {
      d += ` L ${toSvgX(samples[i].t)} ${toSvgY(samples[i].velocity / 2)}`;
    }
    return d;
  }, [samples, toSvgX, toSvgY]);

  // Current preview value for playhead indicator
  const currentT = isLoopPlaying ? localProgress : activeSegment?.progress ?? 0;
  const currentCurveEvaluator = useMemo(() => {
    return getCurveEvaluator(selectedEasing, controlPoints, springConfig);
  }, [selectedEasing, controlPoints, springConfig]);
  const currentVal = currentCurveEvaluator(currentT);

  // Apply curve preset
  const handleSelectPreset = (preset: CurvePreset) => {
    setSelectedEasing(preset.id as KeyframeEasing);
    if (preset.controlPoints) {
      setControlPoints([...preset.controlPoints]);
    }
    setSpringConfig(preset.spring);
  };

  // Reset to linear
  const handleResetCurve = () => {
    setControlPoints([0, 0, 1, 1]);
    setSelectedEasing("linear");
    setSpringConfig(undefined);
  };

  // Copy CSS cubic-bezier
  const handleCopyCss = () => {
    const css = `cubic-bezier(${controlPoints.map((n) => n.toFixed(2)).join(", ")})`;
    navigator.clipboard.writeText(css);
    setCopiedNotification(true);
    setTimeout(() => setCopiedNotification(false), 1500);
  };

  // Apply curve to clip
  const handleApply = () => {
    if (!clip) return;

    const oldClip = { ...clip };
    let updatedClip = { ...clip };

    if (property === "volume") {
      const currentUnified: Keyframe<number>[] = (clip.volumeKeyframes || []).map((ak) => ({
        id: ak.id,
        time: ak.time,
        value: ak.gain ?? ak.value ?? 1,
        easing: ak.easing as KeyframeEasing,
      }));
      const newUnified =
        applyScope === "segment" && activeSegment
          ? applyCurveToKeyframe(
              currentUnified,
              activeSegment.index,
              selectedEasing,
              controlPoints,
              springConfig,
            )
          : applyCurveToAllKeyframes(
              currentUnified,
              selectedEasing,
              controlPoints,
              springConfig,
            );
      const newAudioKfs: AudioKeyframe[] = newUnified.map((k) => ({
        id: k.id,
        time: k.time,
        gain: k.value,
        value: k.value,
        easing: k.easing as any,
      }));
      updatedClip = { ...updatedClip, volumeKeyframes: newAudioKfs };
    } else {
      const currentVisual = { ...(clip.visualKeyframes || {}) };
      if (applyScope === "clip") {
        // Apply to all visual properties
        for (const key of Object.keys(currentVisual) as VisualPropertyKey[]) {
          const kfs = currentVisual[key] || [];
          currentVisual[key] = applyCurveToAllKeyframes(
            kfs,
            selectedEasing,
            controlPoints,
            springConfig,
          );
        }
      } else if (applyScope === "property") {
        const kfs = (currentVisual as any)[property] || [];
        (currentVisual as any)[property] = applyCurveToAllKeyframes(
          kfs,
          selectedEasing,
          controlPoints,
          springConfig,
        );
      } else {
        // Apply to current segment
        const kfs = (currentVisual as any)[property] || [];
        if (activeSegment) {
          (currentVisual as any)[property] = applyCurveToKeyframe(
            kfs,
            activeSegment.index,
            selectedEasing,
            controlPoints,
            springConfig,
          );
        }
      }
      updatedClip = { ...updatedClip, visualKeyframes: currentVisual };
    }

    // Execute with history undo/redo
    execute(
      new TransformClipCommand(
        clip.id,
        {
          visualKeyframes: oldClip.visualKeyframes,
          volumeKeyframes: oldClip.volumeKeyframes,
        },
        {
          visualKeyframes: updatedClip.visualKeyframes,
          volumeKeyframes: updatedClip.volumeKeyframes,
        },
        { before: oldClip, after: updatedClip },
      ),
    );

    closeCurveEditor();
  };

  const p1X = toSvgX(controlPoints[0]);
  const p1Y = toSvgY(controlPoints[1]);
  const p2X = toSvgX(controlPoints[2]);
  const p2Y = toSvgY(controlPoints[3]);
  const p0X = toSvgX(0);
  const p0Y = toSvgY(0);
  const p3X = toSvgX(1);
  const p3Y = toSvgY(1);

  return (
    <Modal
      isOpen={Boolean(activeCurveEditor)}
      onClose={closeCurveEditor}
      title={`Speed & Curve Editor — ${property.toUpperCase()}`}
      size="lg"
      footer={
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-text-muted">Scope:</span>
            <div className="inline-flex rounded-md border border-border/60 bg-surface-raised p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setApplyScope("segment")}
                className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
                  applyScope === "segment"
                    ? "bg-accent text-white font-medium"
                    : "text-text-muted hover:text-text-primary"
                }`}
              >
                Segment
              </button>
              <button
                type="button"
                onClick={() => setApplyScope("property")}
                className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
                  applyScope === "property"
                    ? "bg-accent text-white font-medium"
                    : "text-text-muted hover:text-text-primary"
                }`}
              >
                Property
              </button>
              <button
                type="button"
                onClick={() => setApplyScope("clip")}
                className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
                  applyScope === "clip"
                    ? "bg-accent text-white font-medium"
                    : "text-text-muted hover:text-text-primary"
                }`}
              >
                All Properties
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={closeCurveEditor}
              className="px-3 py-1.5 rounded-md border border-border/60 text-text-muted hover:text-text-primary text-xs cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="px-4 py-1.5 rounded-md bg-accent hover:bg-accent/90 text-white font-medium text-xs cursor-pointer transition-colors flex items-center gap-1.5 shadow-sm"
            >
              <Check className="w-3.5 h-3.5" />
              Apply Curve
            </button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4 p-4 text-xs select-none">
        {/* Top Control Bar */}
        <div className="flex items-center justify-between bg-surface-raised/50 border border-border/60 rounded-lg px-3 py-2">
          {/* Mode switch */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setViewMode("value")}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer transition-all ${
                viewMode === "value"
                  ? "bg-accent/20 text-accent border border-accent/40"
                  : "text-text-muted hover:text-text-primary"
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              Value Curve
            </button>
            <button
              type="button"
              onClick={() => setViewMode("speed")}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer transition-all ${
                viewMode === "speed"
                  ? "bg-accent/20 text-accent border border-accent/40"
                  : "text-text-muted hover:text-text-primary"
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              Speed Profile (dv/dt)
            </button>
          </div>

          {/* Scrub / Loop preview toggle */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsLoopPlaying(!isLoopPlaying)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer transition-all ${
                isLoopPlaying
                  ? "bg-accent text-white"
                  : "bg-surface-raised border border-border/60 text-text-muted hover:text-text-primary"
              }`}
              title="Preview animation loop"
            >
              {isLoopPlaying ? (
                <>
                  <Pause className="w-3 h-3" /> Pause Loop
                </>
              ) : (
                <>
                  <Play className="w-3 h-3" /> Preview Loop
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleResetCurve}
              className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-raised border border-transparent hover:border-border/60 transition-colors"
              title="Reset curve to linear"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Interactive SVG Curve Canvas */}
        <div className="relative bg-surface-base/90 border border-border/80 rounded-xl overflow-hidden shadow-inner flex flex-col items-center justify-center p-2">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
            className="w-full h-56 cursor-crosshair overflow-visible touch-none"
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            <defs>
              <linearGradient id="curve-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="var(--color-accent, #3b82f6)" stopOpacity="0.25" />
                <stop offset="100%" stopColor="var(--color-accent, #3b82f6)" stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Grid & Guide lines */}
            <rect
              x={PAD_X}
              y={PAD_Y}
              width={GRAPH_W}
              height={GRAPH_H}
              fill="rgba(255,255,255,0.015)"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth="1"
            />

            {/* Horizontal progress guides (0%, 50%, 100%) */}
            <line
              x1={PAD_X}
              y1={toSvgY(0)}
              x2={PAD_X + GRAPH_W}
              y2={toSvgY(0)}
              stroke="rgba(255,255,255,0.18)"
              strokeWidth="1"
            />
            <line
              x1={PAD_X}
              y1={toSvgY(0.5)}
              x2={PAD_X + GRAPH_W}
              y2={toSvgY(0.5)}
              stroke="rgba(255,255,255,0.08)"
              strokeDasharray="4,4"
              strokeWidth="1"
            />
            <line
              x1={PAD_X}
              y1={toSvgY(1)}
              x2={PAD_X + GRAPH_W}
              y2={toSvgY(1)}
              stroke="rgba(255,255,255,0.18)"
              strokeWidth="1"
            />

            {/* Overshoot guide lines (+20%, -20%) */}
            <line
              x1={PAD_X}
              y1={toSvgY(1.2)}
              x2={PAD_X + GRAPH_W}
              y2={toSvgY(1.2)}
              stroke="rgba(234, 179, 8, 0.15)"
              strokeDasharray="2,2"
              strokeWidth="1"
            />
            <line
              x1={PAD_X}
              y1={toSvgY(-0.2)}
              x2={PAD_X + GRAPH_W}
              y2={toSvgY(-0.2)}
              stroke="rgba(234, 179, 8, 0.15)"
              strokeDasharray="2,2"
              strokeWidth="1"
            />

            {/* Linear diagonal reference */}
            <line
              x1={p0X}
              y1={p0Y}
              x2={p3X}
              y2={p3Y}
              stroke="rgba(255,255,255,0.08)"
              strokeDasharray="3,3"
              strokeWidth="1"
            />

            {/* Render Value Curve */}
            {viewMode === "value" && (
              <>
                <path d={valueAreaPath} fill="url(#curve-gradient)" />
                <path
                  d={valueCurvePath}
                  fill="none"
                  stroke="var(--color-accent, #3b82f6)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </>
            )}

            {/* Render Speed Curve */}
            {viewMode === "speed" && (
              <>
                <path
                  d={speedCurvePath}
                  fill="none"
                  stroke="#10b981"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <line
                  x1={PAD_X}
                  y1={toSvgY(0.5)}
                  x2={PAD_X + GRAPH_W}
                  y2={toSvgY(0.5)}
                  stroke="#10b981"
                  strokeOpacity="0.4"
                  strokeDasharray="3,3"
                  strokeWidth="1"
                />
              </>
            )}

            {/* Tangent Handle Arms */}
            <line
              x1={p0X}
              y1={p0Y}
              x2={p1X}
              y2={p1Y}
              stroke="#06b6d4"
              strokeWidth="1.5"
              strokeDasharray="3,2"
            />
            <line
              x1={p3X}
              y1={p3Y}
              x2={p2X}
              y2={p2Y}
              stroke="#f59e0b"
              strokeWidth="1.5"
              strokeDasharray="3,2"
            />

            {/* Anchor endpoints P0 and P3 */}
            <circle cx={p0X} cy={p0Y} r="4" fill="#ffffff" stroke="#18181b" strokeWidth="1.5" />
            <circle cx={p3X} cy={p3Y} r="4" fill="#ffffff" stroke="#18181b" strokeWidth="1.5" />

            {/* Draggable Handle P1 */}
            <g
              transform={`translate(${p1X}, ${p1Y})`}
              className="cursor-grab active:cursor-grabbing"
              onPointerDown={(e) => handlePointerDown(1, e)}
            >
              <circle r="12" fill="transparent" />
              <circle
                r="6"
                fill="#06b6d4"
                stroke="#ffffff"
                strokeWidth="1.5"
                className="transition-transform hover:scale-125"
              />
            </g>

            {/* Draggable Handle P2 */}
            <g
              transform={`translate(${p2X}, ${p2Y})`}
              className="cursor-grab active:cursor-grabbing"
              onPointerDown={(e) => handlePointerDown(2, e)}
            >
              <circle r="12" fill="transparent" />
              <circle
                r="6"
                fill="#f59e0b"
                stroke="#ffffff"
                strokeWidth="1.5"
                className="transition-transform hover:scale-125"
              />
            </g>

            {/* Live Playhead Indicator */}
            <line
              x1={toSvgX(currentT)}
              y1={PAD_Y}
              x2={toSvgX(currentT)}
              y2={PAD_Y + GRAPH_H}
              stroke="#ef4444"
              strokeWidth="1.5"
              strokeOpacity="0.8"
            />
            <circle
              cx={toSvgX(currentT)}
              cy={toSvgY(currentVal)}
              r="5"
              fill="#ef4444"
              stroke="#ffffff"
              strokeWidth="1.5"
              className="shadow-md"
            />
          </svg>

          {/* Coordinate Readout HUD */}
          <div className="absolute bottom-2 left-4 flex items-center gap-3 text-[10px] text-text-muted">
            <span className="flex items-center gap-1 font-mono">
              <span className="inline-block w-2 h-2 rounded-full bg-[#06b6d4]" />
              P1: ({controlPoints[0].toFixed(2)}, {controlPoints[1].toFixed(2)})
            </span>
            <span className="flex items-center gap-1 font-mono">
              <span className="inline-block w-2 h-2 rounded-full bg-[#f59e0b]" />
              P2: ({controlPoints[2].toFixed(2)}, {controlPoints[3].toFixed(2)})
            </span>
            <span className="font-mono text-text-primary">
              t={currentT.toFixed(2)} → v={currentVal.toFixed(2)}
            </span>
          </div>

          <button
            type="button"
            onClick={handleCopyCss}
            className="absolute top-3 right-4 flex items-center gap-1 text-[10px] font-mono bg-surface-raised/80 hover:bg-surface-raised text-text-muted hover:text-text-primary border border-border/60 rounded px-2 py-1 transition-all cursor-pointer"
            title="Copy CSS cubic-bezier"
          >
            {copiedNotification ? (
              <>
                <Check className="w-3 h-3 text-emerald-400" /> Copied!
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" /> CSS
              </>
            )}
          </button>
        </div>

        {/* Preset Curve Chips */}
        <div>
          <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider block mb-2">
            Curve Library & Dynamics
          </span>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {Object.values(CURVE_PRESETS).map((preset: CurvePreset) => {
              const isSelected = selectedEasing === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleSelectPreset(preset)}
                  className={`flex flex-col items-start p-2 rounded-lg border text-left transition-all cursor-pointer ${
                    isSelected
                      ? "bg-accent/15 border-accent text-text-primary shadow-sm"
                      : "bg-surface-raised/60 border-border/60 text-text-muted hover:text-text-primary hover:bg-surface-raised"
                  }`}
                >
                  <div className="flex items-center justify-between w-full mb-0.5">
                    <span className="font-medium text-[11px] text-text-primary truncate">
                      {preset.name}
                    </span>
                    {preset.category === "kinetic" ? (
                      <Zap className="w-3 h-3 text-amber-400 shrink-0" />
                    ) : preset.category === "speed" ? (
                      <TrendingUp className="w-3 h-3 text-emerald-400 shrink-0" />
                    ) : preset.category === "spring" ? (
                      <Sparkles className="w-3 h-3 text-purple-400 shrink-0" />
                    ) : null}
                  </div>
                  <span className="text-[9px] text-text-muted/75 line-clamp-1">
                    {preset.description}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Fine-Tuning Tangent Sliders */}
        <div className="bg-surface-raised/40 border border-border/60 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold text-text-muted flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5" /> Manual Tangent Micro-Adjustments
            </span>
            <span className="text-[10px] font-mono text-accent">
              cubic-bezier({controlPoints[0]}, {controlPoints[1]}, {controlPoints[2]},{" "}
              {controlPoints[3]})
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <div className="flex justify-between text-[10px] text-text-muted mb-1">
                <span>P1.X (Time)</span>
                <span className="font-mono tabular-nums">{controlPoints[0]}</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={controlPoints[0]}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setControlPoints([val, controlPoints[1], controlPoints[2], controlPoints[3]]);
                  setSelectedEasing("cubic-bezier");
                }}
                className="w-full accent-[#06b6d4]"
              />
            </div>
            <div>
              <div className="flex justify-between text-[10px] text-text-muted mb-1">
                <span>P1.Y (Value)</span>
                <span className="font-mono tabular-nums">{controlPoints[1]}</span>
              </div>
              <input
                type="range"
                min="-0.5"
                max="1.5"
                step="0.01"
                value={controlPoints[1]}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setControlPoints([controlPoints[0], val, controlPoints[2], controlPoints[3]]);
                  setSelectedEasing("cubic-bezier");
                }}
                className="w-full accent-[#06b6d4]"
              />
            </div>
            <div>
              <div className="flex justify-between text-[10px] text-text-muted mb-1">
                <span>P2.X (Time)</span>
                <span className="font-mono tabular-nums">{controlPoints[2]}</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={controlPoints[2]}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setControlPoints([controlPoints[0], controlPoints[1], val, controlPoints[3]]);
                  setSelectedEasing("cubic-bezier");
                }}
                className="w-full accent-[#f59e0b]"
              />
            </div>
            <div>
              <div className="flex justify-between text-[10px] text-text-muted mb-1">
                <span>P2.Y (Value)</span>
                <span className="font-mono tabular-nums">{controlPoints[3]}</span>
              </div>
              <input
                type="range"
                min="-0.5"
                max="1.5"
                step="0.01"
                value={controlPoints[3]}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setControlPoints([controlPoints[0], controlPoints[1], controlPoints[2], val]);
                  setSelectedEasing("cubic-bezier");
                }}
                className="w-full accent-[#f59e0b]"
              />
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};

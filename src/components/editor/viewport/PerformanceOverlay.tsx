/**
 * Performance Overlay
 *
 * Real-time performance metrics display for preview optimization.
 * Shows key metrics in a compact overlay that doesn't interfere with editing.
 *
 * Metrics displayed:
 * - FPS and frame times (p95)
 * - Active video count and decoder budget
 * - Decoded/presented frame rates
 * - Seek rate and stale frame reuse
 * - Pipeline breakdown (scene eval, scheduler, Pixi render)
 */

import { useEffect, useState } from "react";
import { getTraceCollector, type TraceStats } from "@/core/monitoring/PerformanceTraceCollector";

interface PerformanceMetrics {
  fps: number;
  p95FrameTime: number;
  qualityTier: "full" | "balanced" | "draft" | "survival";
  activeVideoCount: number;
  decoderBudget: number;
  decodedFps: number;
  presentedFps: number;
  seeksPerSecond: number;
  staleFrameReuse: number;
  sceneEvalMs: number;
  schedulerMs: number;
  pixiRenderMs: number;
}

interface PerformanceOverlayProps {
  visible?: boolean;
  position?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  compact?: boolean;
}

export function PerformanceOverlay({ visible = true, position = "top-right", compact = false }: PerformanceOverlayProps) {
  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null);
  const [stats, setStats] = useState<TraceStats | null>(null);

  useEffect(() => {
    if (!visible) return;

    const collector = getTraceCollector();

    // Update metrics every 500ms
    const interval = setInterval(() => {
      const traceStats = collector.calculateStats();
      setStats(traceStats);

      // Get latest sample for real-time metrics
      const trace = collector.exportTrace();
      const latestSample = trace.samples[trace.samples.length - 1];

      if (latestSample) {
        setMetrics({
          fps: latestSample.rafDeltaMs > 0 ? 1000 / latestSample.rafDeltaMs : 0,
          p95FrameTime: traceStats.p95FrameTime,
          qualityTier: latestSample.qualityTier,
          activeVideoCount: latestSample.activeVideoCount,
          decoderBudget: 4, // TODO: Make configurable
          decodedFps: 0, // TODO: Calculate from frame arrivals
          presentedFps: 0, // TODO: Calculate from texture uploads
          seeksPerSecond: traceStats.avgSeeksPerSecond,
          staleFrameReuse: traceStats.staleFrameReuseRate,
          sceneEvalMs: latestSample.sceneEvaluateMs,
          schedulerMs: latestSample.schedulerMs,
          pixiRenderMs: latestSample.pixiRenderMs,
        });
      }
    }, 500);

    return () => clearInterval(interval);
  }, [visible]);

  if (!visible || !metrics) return null;

  const positionClasses = {
    "top-left": "top-4 left-4",
    "top-right": "top-4 right-4",
    "bottom-left": "bottom-4 left-4",
    "bottom-right": "bottom-4 right-4",
  };

  const getQualityColor = (tier: string) => {
    switch (tier) {
      case "full":
        return "text-green-400";
      case "balanced":
        return "text-yellow-400";
      case "draft":
        return "text-orange-400";
      case "survival":
        return "text-red-400";
      default:
        return "text-gray-400";
    }
  };

  const getFrameTimeColor = (p95: number) => {
    if (p95 <= 33) return "text-green-400"; // 30fps target met
    if (p95 <= 50) return "text-yellow-400"; // 20fps
    return "text-red-400"; // Below 20fps
  };

  if (compact) {
    return (
      <div className={`fixed ${positionClasses[position]} z-50 pointer-events-none`} style={{ fontFamily: "monospace" }}>
        <div className="bg-black/80 backdrop-blur-sm rounded-lg px-3 py-2 text-xs">
          <div className="flex items-center gap-3">
            <span className={getFrameTimeColor(metrics.p95FrameTime)}>{metrics.fps.toFixed(1)} fps</span>
            <span className="text-gray-400">|</span>
            <span className="text-gray-300">
              {metrics.activeVideoCount}/{metrics.decoderBudget} videos
            </span>
            <span className="text-gray-400">|</span>
            <span className={getQualityColor(metrics.qualityTier)}>{metrics.qualityTier}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`fixed ${positionClasses[position]} z-50 pointer-events-none`} style={{ fontFamily: "monospace" }}>
      <div className="bg-black/90 backdrop-blur-sm rounded-lg px-4 py-3 text-xs space-y-1.5 min-w-[320px] border border-gray-700/50">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-700 pb-1.5">
          <span className="text-gray-400 font-semibold">Preview Performance</span>
          <span className={getQualityColor(metrics.qualityTier)}>{metrics.qualityTier}</span>
        </div>

        {/* Frame Timing */}
        <div className="flex items-center justify-between">
          <span className="text-gray-400">FPS</span>
          <span className={getFrameTimeColor(metrics.p95FrameTime)}>{metrics.fps.toFixed(1)} fps</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-400">p95 Frame Time</span>
          <span className={getFrameTimeColor(metrics.p95FrameTime)}>{metrics.p95FrameTime.toFixed(1)}ms</span>
        </div>

        {/* Decoder State */}
        <div className="flex items-center justify-between pt-1">
          <span className="text-gray-400">Active Videos</span>
          <span className="text-gray-300">
            {metrics.activeVideoCount} / {metrics.decoderBudget}
          </span>
        </div>

        {/* Seek Rate */}
        <div className="flex items-center justify-between">
          <span className="text-gray-400">Seeks/sec</span>
          <span className={metrics.seeksPerSecond > 0.5 ? "text-red-400" : "text-green-400"}>{metrics.seeksPerSecond.toFixed(2)}</span>
        </div>

        {/* Stale Frame Reuse */}
        <div className="flex items-center justify-between">
          <span className="text-gray-400">Stale Reuse</span>
          <span className="text-gray-300">{(metrics.staleFrameReuse * 100).toFixed(1)}%</span>
        </div>

        {/* Pipeline Breakdown */}
        <div className="pt-1 border-t border-gray-700/50">
          <div className="flex items-center justify-between">
            <span className="text-gray-400">Scene Eval</span>
            <span className="text-gray-300">{metrics.sceneEvalMs.toFixed(1)}ms</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-400">Scheduler</span>
            <span className="text-gray-300">{metrics.schedulerMs.toFixed(1)}ms</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-400">Pixi Render</span>
            <span className="text-gray-300">{metrics.pixiRenderMs.toFixed(1)}ms</span>
          </div>
        </div>

        {/* Stats Summary */}
        {stats && (
          <div className="pt-1 border-t border-gray-700/50 text-[10px] text-gray-500">
            <div className="flex items-center justify-between">
              <span>Dropped Frames</span>
              <span className={stats.droppedFrames > 10 ? "text-red-400" : "text-gray-400"}>{stats.droppedFrames}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Samples Collected</span>
              <span>{stats.totalSamples}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Hook to control performance overlay visibility.
 */
export function usePerformanceOverlay() {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<"top-left" | "top-right" | "bottom-left" | "bottom-right">("top-right");
  const [compact, setCompact] = useState(false);

  const toggleVisible = () => setVisible((v) => !v);
  const toggleCompact = () => setCompact((c) => !c);

  return {
    visible,
    position,
    compact,
    setVisible,
    setPosition,
    setCompact,
    toggleVisible,
    toggleCompact,
  };
}

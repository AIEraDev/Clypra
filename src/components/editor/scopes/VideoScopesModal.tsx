import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, Activity, BarChart2, Radio, Sliders } from "lucide-react";
import type { VideoScopePayload, ScopeType } from "@/types/scopes";
import { VideoScopeCanvas } from "./VideoScopeCanvas";
import { useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import { usePlaybackClock } from "@/hooks/usePlaybackClock";
import { evaluateTimelineSceneCached } from "@/core/evaluation/evaluator";
import { buildNativeFrameRequest } from "@/components/editor/preview/nativeVideoPreview";
import { getFrameIndexAtTime, getFrameStartTime } from "@/lib/utils/frameTime";
import { getColorScopesWorkerClient } from "@/core/workers/colorScopesWorkerClient";
import { isTauriRuntime } from "@/lib/platform/tauri";

interface VideoScopesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const VideoScopesModal: React.FC<VideoScopesModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [activeScope, setActiveScope] = useState<ScopeType>("waveform");
  const [telemetry, setTelemetry] = useState<VideoScopePayload | undefined>(
    undefined,
  );

  const clock = usePlaybackClock();
  const tracks = useTimelineStore((s) => s.tracks);
  const clips = useTimelineStore((s) => s.clips);
  const transitions = useTimelineStore((s) => s.transitions);
  const epoch = useTimelineStore((s) => s.epoch);
  const project = useProjectStore((s) => s.project);
  const mediaAssets = useProjectStore((s) => s.mediaAssets);

  const canvasWidth = project?.canvasWidth ?? 1920;
  const canvasHeight = project?.canvasHeight ?? 1080;
  const frameRate = project?.frameRate ?? 30;

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;

    const fetchScopes = async () => {
      try {
        const frameIndex = getFrameIndexAtTime(clock.time, frameRate);
        const frameStartTime = getFrameStartTime(frameIndex, frameRate);

        const scene = evaluateTimelineSceneCached(
          frameStartTime,
          clips,
          tracks,
          mediaAssets,
          project,
          epoch,
          transitions,
        );

        const nativeReq = buildNativeFrameRequest(
          scene,
          `${project?.id ?? "unknown-project"}:${epoch}`,
          frameIndex,
          frameRate,
          Math.min(canvasWidth, 960),
          Math.min(canvasHeight, 540),
          [],
          { mode: "scrub" },
        );

        if (isTauriRuntime() && nativeReq) {
          const result = await invoke<VideoScopePayload>("get_video_scopes", {
            request: nativeReq,
            scopeType: activeScope === "all" ? "all" : activeScope,
          });

          if (isMounted) {
            setTelemetry(result);
          }
        } else {
          // Off-thread web worker analysis via ColorScopesWorkerClient
          const workerClient = getColorScopesWorkerClient();
          const previewCanvas = document.querySelector("canvas") as HTMLCanvasElement | null;
          if (previewCanvas && previewCanvas.width > 0 && previewCanvas.height > 0) {
            const scopeKind = activeScope === "rgb_parade" ? "parade" : activeScope === "all" ? ["histogram", "vectorscope", "waveform", "parade"] : [activeScope];
            const scopes = Array.isArray(scopeKind) ? (scopeKind as any) : [scopeKind as any];
            const scopeRes = await workerClient.analyzeCanvas(previewCanvas, scopes, 2);
            if (isMounted && scopeRes) {
              setTelemetry({
                histogram: scopeRes.histogram ? {
                  red: Array.from(scopeRes.histogram.r),
                  green: Array.from(scopeRes.histogram.g),
                  blue: Array.from(scopeRes.histogram.b),
                  luma: Array.from(scopeRes.histogram.luma),
                  maxBinCount: Math.max(...scopeRes.histogram.luma, 1),
                } : undefined,
                vectorscope: scopeRes.vectorscope ? {
                  width: 256,
                  height: 256,
                  data: Array.from(scopeRes.vectorscope),
                } : undefined,
                rgbParade: scopeRes.parade ? {
                  width: 256,
                  height: 256,
                  red: Array.from(scopeRes.parade),
                  green: Array.from(scopeRes.parade),
                  blue: Array.from(scopeRes.parade),
                } : undefined,
                waveform: undefined,
              });
            }
          }
        }
      } catch (err) {
        console.error("Failed to compute video scopes:", err);
      }
    };

    fetchScopes();

    const interval = setInterval(fetchScopes, 150); // ~7 FPS telemetry poll
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [
    isOpen,
    activeScope,
    clock.time,
    tracks,
    clips,
    transitions,
    epoch,
    project,
    mediaAssets,
    canvasWidth,
    canvasHeight,
    frameRate,
  ]);

  if (!isOpen) return null;

  return (
    <div className="fixed bottom-20 right-6 z-50 w-96 bg-[#121318]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl overflow-hidden flex flex-col transition-all animate-in fade-in zoom-in-95">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-white/2">
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-accent" />
          <span className="text-xs font-semibold text-text-primary tracking-wide">
            Video Scopes
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-text-muted hover:text-text-primary transition-colors p-1 rounded-lg hover:bg-white/5"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Scope Mode Selector Tabs */}
      <div className="flex items-center gap-1 p-2 border-b border-white/5 bg-black/20">
        <button
          type="button"
          onClick={() => setActiveScope("waveform")}
          className={`flex-1 py-1 px-2 text-[10px] rounded font-medium transition-all flex items-center justify-center gap-1.5 ${
            activeScope === "waveform"
              ? "bg-accent text-white shadow"
              : "text-text-muted hover:text-text-primary hover:bg-white/5"
          }`}
        >
          <Sliders className="w-3 h-3" />
          <span>Waveform</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveScope("rgb_parade")}
          className={`flex-1 py-1 px-2 text-[10px] rounded font-medium transition-all flex items-center justify-center gap-1.5 ${
            activeScope === "rgb_parade"
              ? "bg-accent text-white shadow"
              : "text-text-muted hover:text-text-primary hover:bg-white/5"
          }`}
        >
          <BarChart2 className="w-3 h-3" />
          <span>Parade</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveScope("vectorscope")}
          className={`flex-1 py-1 px-2 text-[10px] rounded font-medium transition-all flex items-center justify-center gap-1.5 ${
            activeScope === "vectorscope"
              ? "bg-accent text-white shadow"
              : "text-text-muted hover:text-text-primary hover:bg-white/5"
          }`}
        >
          <Radio className="w-3 h-3" />
          <span>Vectorscope</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveScope("histogram")}
          className={`flex-1 py-1 px-2 text-[10px] rounded font-medium transition-all flex items-center justify-center gap-1.5 ${
            activeScope === "histogram"
              ? "bg-accent text-white shadow"
              : "text-text-muted hover:text-text-primary hover:bg-white/5"
          }`}
        >
          <BarChart2 className="w-3 h-3 rotate-90" />
          <span>Histogram</span>
        </button>
      </div>

      {/* Scope Canvas Viewport */}
      <div className="p-3 flex justify-center items-center bg-black/40">
        <VideoScopeCanvas
          payload={telemetry}
          scopeType={activeScope}
          width={360}
          height={260}
        />
      </div>
    </div>
  );
};

import React, { useState } from "react";
import { Crosshair, Play, CheckCircle2, AlertCircle } from "lucide-react";
import type { TextClip } from "@/types";

interface TextTrackingSectionProps {
  textClip: TextClip;
}

export const TextTrackingSection: React.FC<TextTrackingSectionProps> = ({
  textClip,
}) => {
  const [trackingMode, setTrackingMode] = useState<"object" | "face">("object");
  const [direction, setDirection] = useState<"forward" | "backward" | "both">(
    "both",
  );
  const [isTracking, setIsTracking] = useState(false);
  const [trackingDone, setTrackingDone] = useState(false);

  const handleStartTracking = () => {
    setIsTracking(true);
    setTimeout(() => {
      setIsTracking(false);
      setTrackingDone(true);
    }, 1200);
  };

  return (
    <div className="space-y-1.5 select-none text-text-primary relative p-2 pt-0">
      {/* Header Info */}
      <div className="flex items-start gap-3 p-3 bg-surface-elevated border border-border-default rounded-xl">
        <div className="w-9 h-9 rounded-lg bg-cyan-400/10 border border-cyan-400/20 flex items-center justify-center text-cyan-400 shrink-0">
          <Crosshair className="w-5 h-5" />
        </div>
        <div>
          <h4 className="text-xs font-semibold text-text-primary">Motion Tracking</h4>
          <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">
            Attach this text clip to a moving person or object in the video
            canvas.
          </p>
        </div>
      </div>

      {/* Target Preview Box */}
      <div className="border border-dashed border-border-default rounded-xl p-6 flex flex-col items-center justify-center text-center bg-surface-panel/40">
        <div className="w-16 h-16 rounded-xl border-2 border-cyan-400/60 bg-cyan-400/5 flex items-center justify-center relative mb-3">
          <Crosshair className="w-8 h-8 text-cyan-400 animate-pulse" />
          <span className="absolute -top-2 -right-2 text-[9px] font-bold bg-cyan-400 text-black px-1.5 py-0.2 rounded">
            Target
          </span>
        </div>
        <p className="text-xs text-text-primary font-medium">
          Position tracking box on preview
        </p>
        <p className="text-[11px] text-text-muted mt-0.5 max-w-[240px]">
          Drag the target box in the preview window over the object you want
          &quot;{textClip.text || "Text"}&quot; to follow.
        </p>
      </div>

      {/* Tracking Options */}
      <div className="space-y-3">
        {/* Track Mode */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-muted">Track object</span>
          <div className="flex bg-surface-elevated border border-border-default rounded-md p-0.5">
            <button
              type="button"
              onClick={() => setTrackingMode("object")}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                trackingMode === "object"
                  ? "bg-accent-primary text-white shadow-sm font-semibold"
                  : "text-text-muted hover:text-text-primary hover:bg-surface-hover"
              }`}
            >
              Object
            </button>
            <button
              type="button"
              onClick={() => setTrackingMode("face")}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                trackingMode === "face"
                  ? "bg-accent-primary text-white shadow-sm font-semibold"
                  : "text-text-muted hover:text-text-primary hover:bg-surface-hover"
              }`}
            >
              Face
            </button>
          </div>
        </div>

        {/* Direction */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-muted">Direction</span>
          <div className="flex bg-surface-elevated border border-border-default rounded-md p-0.5">
            <button
              type="button"
              onClick={() => setDirection("forward")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                direction === "forward"
                  ? "bg-accent-primary text-white shadow-sm"
                  : "text-text-muted hover:text-text-primary hover:bg-surface-hover"
              }`}
            >
              Forward
            </button>
            <button
              type="button"
              onClick={() => setDirection("backward")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                direction === "backward"
                  ? "bg-accent-primary text-white shadow-sm"
                  : "text-text-muted hover:text-text-primary hover:bg-surface-hover"
              }`}
            >
              Backward
            </button>
            <button
              type="button"
              onClick={() => setDirection("both")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                direction === "both"
                  ? "bg-accent-primary text-white shadow-sm"
                  : "text-text-muted hover:text-text-primary hover:bg-surface-hover"
              }`}
            >
              Both
            </button>
          </div>
        </div>
      </div>

      {/* Start Button */}
      <div className="pt-2">
        <button
          type="button"
          onClick={handleStartTracking}
          disabled={isTracking}
          className="w-full py-2 px-4 rounded-lg bg-cyan-400 hover:bg-cyan-300 disabled:opacity-60 text-black font-semibold text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm"
        >
          {isTracking ? (
            <>
              <div className="w-3.5 h-3.5 border-2 border-black border-t-transparent rounded-full animate-spin" />
              Tracking motion...
            </>
          ) : trackingDone ? (
            <>
              <CheckCircle2 className="w-4 h-4 text-black" />
              Tracking Complete &bull; Re-track
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5 fill-black" />
              Start Tracking
            </>
          )}
        </button>
      </div>
    </div>
  );
};

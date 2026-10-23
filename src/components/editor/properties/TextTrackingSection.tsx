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
    <div className="space-y-1.5 select-none text-white relative p-2 pt-0">
      {/* Header Info */}
      <div className="flex items-start gap-3 p-3 bg-[#242428] border border-white/5 rounded-xl">
        <div className="w-9 h-9 rounded-lg bg-cyan-400/10 border border-cyan-400/20 flex items-center justify-center text-cyan-400 shrink-0">
          <Crosshair className="w-5 h-5" />
        </div>
        <div>
          <h4 className="text-xs font-semibold text-white">Motion Tracking</h4>
          <p className="text-[11px] text-[#a1a1aa] mt-0.5 leading-relaxed">
            Attach this text clip to a moving person or object in the video
            canvas.
          </p>
        </div>
      </div>

      {/* Target Preview Box */}
      <div className="border border-dashed border-[#3f3f46] rounded-xl p-6 flex flex-col items-center justify-center text-center bg-[#18181b]/40">
        <div className="w-16 h-16 rounded-xl border-2 border-cyan-400/60 bg-cyan-400/5 flex items-center justify-center relative mb-3">
          <Crosshair className="w-8 h-8 text-cyan-400 animate-pulse" />
          <span className="absolute -top-2 -right-2 text-[9px] font-bold bg-cyan-400 text-black px-1.5 py-0.2 rounded">
            Target
          </span>
        </div>
        <p className="text-xs text-white font-medium">
          Position tracking box on preview
        </p>
        <p className="text-[11px] text-[#8e8e93] mt-0.5 max-w-[240px]">
          Drag the target box in the preview window over the object you want
          &quot;{textClip.text || "Text"}&quot; to follow.
        </p>
      </div>

      {/* Tracking Options */}
      <div className="space-y-3">
        {/* Track Mode */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-[#a1a1aa]">Track object</span>
          <div className="flex bg-[#242428] border border-white/5 rounded-md p-0.5">
            <button
              type="button"
              onClick={() => setTrackingMode("object")}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                trackingMode === "object"
                  ? "bg-[#38383e] text-white shadow-sm font-semibold"
                  : "text-[#8e8e93] hover:text-white"
              }`}
            >
              Object
            </button>
            <button
              type="button"
              onClick={() => setTrackingMode("face")}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                trackingMode === "face"
                  ? "bg-[#38383e] text-white shadow-sm font-semibold"
                  : "text-[#8e8e93] hover:text-white"
              }`}
            >
              Face
            </button>
          </div>
        </div>

        {/* Direction */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-[#a1a1aa]">Direction</span>
          <div className="flex bg-[#242428] border border-white/5 rounded-md p-0.5">
            <button
              type="button"
              onClick={() => setDirection("forward")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                direction === "forward"
                  ? "bg-[#38383e] text-white shadow-sm"
                  : "text-[#8e8e93] hover:text-white"
              }`}
            >
              Forward
            </button>
            <button
              type="button"
              onClick={() => setDirection("backward")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                direction === "backward"
                  ? "bg-[#38383e] text-white shadow-sm"
                  : "text-[#8e8e93] hover:text-white"
              }`}
            >
              Backward
            </button>
            <button
              type="button"
              onClick={() => setDirection("both")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                direction === "both"
                  ? "bg-[#38383e] text-white shadow-sm"
                  : "text-[#8e8e93] hover:text-white"
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

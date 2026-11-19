import React, { useState } from "react";
import { Crosshair, Play, CheckCircle2, AlertCircle } from "lucide-react";
import { useI18n } from "@/i18n";
import type { TextClip } from "@/types";

interface TextTrackingSectionProps {
  textClip: TextClip;
}

export const TextTrackingSection: React.FC<TextTrackingSectionProps> = ({
  textClip,
}) => {
  const { t } = useI18n();
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
          <h4 className="text-xs font-semibold text-text-primary">{t("properties.tracking.title")}</h4>
          <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">
            {t("properties.tracking.desc")}
          </p>
        </div>
      </div>

      {/* Target Preview Box */}
      <div className="border border-dashed border-border-default rounded-xl p-6 flex flex-col items-center justify-center text-center bg-surface-panel/40">
        <div className="w-16 h-16 rounded-xl border-2 border-cyan-400/60 bg-cyan-400/5 flex items-center justify-center relative mb-3">
          <Crosshair className="w-8 h-8 text-cyan-400 animate-pulse" />
          <span className="absolute -top-2 -right-2 text-[9px] font-bold bg-accent-primary text-white px-1.5 py-0.2 rounded">
            {t("properties.tracking.target")}
          </span>
        </div>
        <p className="text-xs text-text-primary font-medium">
          {t("properties.tracking.positionBox")}
        </p>
        <p className="text-[11px] text-text-muted mt-0.5 max-w-[240px]">
          {t("properties.tracking.dragInstruction")}
        </p>
      </div>

      {/* Tracking Options */}
      <div className="space-y-3">
        {/* Track Mode */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-secondary">{t("properties.tracking.trackObject")}</span>
          <div className="flex bg-surface-elevated border border-border-default rounded-md p-0.5">
            <button
              type="button"
              onClick={() => setTrackingMode("object")}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                trackingMode === "object"
                  ? "bg-accent-primary text-white shadow-sm font-semibold"
                  : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"
              }`}
            >
              {t("properties.tracking.object")}
            </button>
            <button
              type="button"
              onClick={() => setTrackingMode("face")}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                trackingMode === "face"
                  ? "bg-accent-primary text-white shadow-sm font-semibold"
                  : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"
              }`}
            >
              {t("properties.tracking.face")}
            </button>
          </div>
        </div>

        {/* Direction */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-secondary">{t("properties.tracking.direction")}</span>
          <div className="flex bg-surface-elevated border border-border-default rounded-md p-0.5">
            <button
              type="button"
              onClick={() => setDirection("forward")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                direction === "forward"
                  ? "bg-accent-primary text-white shadow-sm"
                  : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"
              }`}
            >
              {t("properties.tracking.forward")}
            </button>
            <button
              type="button"
              onClick={() => setDirection("backward")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                direction === "backward"
                  ? "bg-accent-primary text-white shadow-sm"
                  : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"
              }`}
            >
              {t("properties.tracking.backward")}
            </button>
            <button
              type="button"
              onClick={() => setDirection("both")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                direction === "both"
                  ? "bg-accent-primary text-white shadow-sm"
                  : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"
              }`}
            >
              {t("properties.tracking.both")}
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
          className="w-full py-2 px-4 rounded-lg bg-accent-primary hover:bg-accent-hover disabled:opacity-60 text-white font-semibold text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm"
        >
          {isTracking ? (
            <>
              <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              {t("properties.tracking.trackingMotion")}
            </>
          ) : trackingDone ? (
            <>
              <CheckCircle2 className="w-4 h-4 text-white" />
              {t("properties.tracking.trackingComplete")}
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5 fill-white text-white" />
              {t("properties.tracking.startTracking")}
            </>
          )}
        </button>
      </div>
    </div>
  );
};

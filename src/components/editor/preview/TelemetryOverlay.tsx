import React from "react";
import { t } from "@/i18n";

export interface TelemetryStats {
  avgEvaluationTimeMs: number;
  avgRasterTimeMs: number;
  avgTotalTimeMs: number;
  cacheHitRate: number;
  active: number;
  droppedFrames: number;
  driftMagnitude: number;
}

interface TelemetryOverlayProps {
  showTelemetry: boolean;
  telemetryStats: TelemetryStats | null;
}

export const TelemetryOverlay: React.FC<TelemetryOverlayProps> = ({
  showTelemetry,
  telemetryStats,
}) => {
  if (!showTelemetry || !telemetryStats) return null;

  return (
    <div className="absolute top-4 left-4 z-20 bg-black/80 backdrop-blur-sm rounded-lg p-3 text-xs font-mono text-white/90 space-y-1 border border-white/10">
      <div className="font-semibold text-accent mb-2">{t("editor.preview.telemetry.title")}</div>
      <div className="flex justify-between gap-4">
        <span className="text-white/60">{t("editor.preview.telemetry.evaluation")}：</span>
        <span>{telemetryStats.avgEvaluationTimeMs.toFixed(2)}ms</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-white/60">{t("editor.preview.telemetry.raster")}：</span>
        <span>{telemetryStats.avgRasterTimeMs.toFixed(2)}ms</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-white/60">{t("editor.preview.telemetry.total")}：</span>
        <span>{telemetryStats.avgTotalTimeMs.toFixed(2)}ms</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-white/60">{t("editor.preview.telemetry.cacheHitRate")}：</span>
        <span>{(telemetryStats.cacheHitRate * 100).toFixed(0)}%</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-white/60">{t("editor.preview.telemetry.active")}：</span>
        <span>{telemetryStats.active}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-white/60">{t("editor.preview.telemetry.droppedFrames")}：</span>
        <span className={telemetryStats.droppedFrames > 0 ? "text-yellow-400" : ""}>
          {telemetryStats.droppedFrames}
        </span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-white/60">{t("editor.preview.telemetry.maxDrift")}：</span>
        <span className={telemetryStats.driftMagnitude > 0.04 ? "text-yellow-400" : ""}>
          {(telemetryStats.driftMagnitude * 1000).toFixed(0)}ms
        </span>
      </div>
    </div>
  );
};

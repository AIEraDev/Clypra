import React, { useRef, useEffect, useState } from "react";
import { drawProfessionalWaveform } from "@/lib/utils/canvasUtils";
import { useWaveformData } from "./useWaveformData";

interface TimelineWaveformProps {
  audioPath: string;
  clipWidthPx: number;
  duration: number;
  trimIn?: number;
  trimOut?: number;
  heightPx?: number;
  className?: string;
}

// ── Shared theme-change observer (PERF-7 fix: single observer, not N per clip) ──
type ThemeListener = () => void;
const themeListeners = new Set<ThemeListener>();
let sharedThemeObserver: MutationObserver | null = null;

function subscribeToThemeChanges(listener: ThemeListener): () => void {
  themeListeners.add(listener);
  if (!sharedThemeObserver) {
    sharedThemeObserver = new MutationObserver(() => {
      themeListeners.forEach((fn) => fn());
    });
    sharedThemeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style"],
    });
  }
  return () => {
    themeListeners.delete(listener);
    if (themeListeners.size === 0 && sharedThemeObserver) {
      sharedThemeObserver.disconnect();
      sharedThemeObserver = null;
    }
  };
}

function getVisibleWaveColor(): string {
  if (typeof document !== "undefined") {
    const waveColor = getComputedStyle(document.documentElement)
      .getPropertyValue("--clypra-clip-audio-wave")
      .trim();
    if (waveColor) return waveColor;
  }
  return "transparent";
}

export const TimelineWaveform: React.FC<TimelineWaveformProps> = ({ audioPath, clipWidthPx, duration, trimIn = 0, trimOut, heightPx = 40, className = "" }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [themeRevision, setThemeRevision] = useState(0);
  const { waveformData, isLoading, hasError } = useWaveformData({
    audioPath,
    clipWidthPx,
    duration,
    trimIn,
    trimOut,
  });
  const validClipWidth =
    typeof clipWidthPx === "number" && !isNaN(clipWidthPx) ? clipWidthPx : 300;

  // Watch for theme changes via shared observer (PERF-7 fix)
  useEffect(() => {
    return subscribeToThemeChanges(() => setThemeRevision((r) => r + 1));
  }, []);

  // Draw professional waveform on canvas
  // PERF-6 fix: use clipWidthPx instead of getBoundingClientRect to avoid forced reflow
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || waveformData.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const logicalW = Math.max(1, validClipWidth);
    const logicalH = Math.max(12, heightPx);
    canvas.width = logicalW * dpr;
    canvas.height = logicalH * dpr;
    ctx.scale(dpr, dpr);

    const color = getVisibleWaveColor();

    // Use professional dense bar renderer with logical dimensions
    drawProfessionalWaveform(canvas, waveformData, color, logicalW, logicalH);
  }, [waveformData, themeRevision, validClipWidth, heightPx]);

  if (hasError) {
    return <div className={`w-full h-full rounded-[2px] border border-clypra-clip-waveform-border/40 bg-clypra-clip-waveform-bg/60 ${className}`} title="Waveform unavailable" />;
  }

  return (
    <div className="relative flex h-full min-h-0 w-full items-center">
      {isLoading && <div className={`absolute inset-0 rounded-[2px] bg-clypra-clip-waveform-bg/60 animate-pulse border border-clypra-clip-waveform-border/40 ${className}`} />}
      <canvas
        ref={canvasRef}
        className={`w-full h-full block ${className}`}
        style={{
          minHeight: heightPx,
          opacity: isLoading ? 0 : 1,
          transition: "opacity 300ms ease-out",
        }}
      />
    </div>
  );
};

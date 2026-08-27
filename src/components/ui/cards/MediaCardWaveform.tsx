import React, { useRef, useEffect, useState } from "react";
import { drawProfessionalWaveform, getThemeAccentRgb } from "@/lib/utils/canvasUtils";
import { useWaveformData } from "@/components/editor/timeline/useWaveformData";

interface MediaCardWaveformProps {
  audioPath: string;
  duration: number;
  className?: string;
}

// Compact waveform visualization for audio files in media cards.
// Uses the shared source-scoped waveform service used by timeline clips.
export const MediaCardWaveform: React.FC<MediaCardWaveformProps> = ({ audioPath, duration, className = "" }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [themeRevision, setThemeRevision] = useState(0);
  const { waveformData, isLoading, hasError } = useWaveformData({
    audioPath,
    clipWidthPx: 300,
    duration,
    mediaDuration: duration,
  });

  // Watch for theme changes on document element and trigger redraw
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setThemeRevision((r) => r + 1);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style"],
    });
    return () => observer.disconnect();
  }, []);

  // Draw professional waveform on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || waveformData.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size with device pixel ratio for crisp rendering
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    // Read theme accent color
    const accentRgb = getThemeAccentRgb();
    const color = accentRgb
      ? `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.85)`
      : "transparent";

    // Use professional dense bar renderer with logical dimensions
    drawProfessionalWaveform(canvas, waveformData, color, rect.width, rect.height);
  }, [waveformData, themeRevision]);

  return (
    <div className={`relative w-full h-full flex flex-col items-center justify-center ${className}`}>
      {/* Waveform canvas */}
      <canvas ref={canvasRef} className="w-full h-full" style={{ display: isLoading ? "none" : "block" }} />

      {/* Loading state */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex gap-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="w-1 h-8 bg-cyan-400/30 rounded-full animate-pulse" style={{ animationDelay: `${i * 100}ms` }} />
            ))}
          </div>
        </div>
      )}

      {/* Error indicator - honest signal that waveform is unavailable */}
      {hasError && !isLoading && (
        <div className="absolute bottom-1 left-1 bg-text-muted/20 px-1.5 py-0.5 rounded text-[9px] text-text-muted/70" title="Waveform unavailable for this format">
          No waveform
        </div>
      )}
    </div>
  );
};

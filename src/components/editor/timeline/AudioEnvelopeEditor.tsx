import React, { useState, useRef } from "react";
import { useTimelineStore } from "@/store/timelineStore";
import { useHistoryStore } from "@/store/historyStore";
import { TransformClipCommand } from "@/core/history/commands/TransformCommand";
import type { Clip } from "@/types";
import { t } from "@/i18n";

interface AudioEnvelopeEditorProps {
  clip: Clip;
  clipWidthPx: number;
  pixelsPerSecond: number;
}

export const AudioEnvelopeEditor: React.FC<AudioEnvelopeEditorProps> = ({
  clip,
  clipWidthPx,
  pixelsPerSecond,
}) => {
  const updateClip = useTimelineStore((s) => s.updateClip);
  const { execute } = useHistoryStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [activeDrag, setActiveDrag] = useState<"fadeIn" | "fadeOut" | "volume" | null>(null);
  const [dragValue, setDragValue] = useState<number | null>(null);

  // Drag tracking refs
  const dragStartRef = useRef<{
    startX: number;
    startY: number;
    initialVolume: number;
    initialFadeIn: number;
    initialFadeOut: number;
    clipHeight: number;
  } | null>(null);

  const volume = clip.volume ?? 1.0;
  const fadeIn = clip.fadeIn ?? 0;
  const fadeOut = clip.fadeOut ?? 0;

  // Calculate pixel positions for SVG paths
  const fadeInPx = Math.max(0, Math.min(clipWidthPx, fadeIn * pixelsPerSecond));
  const fadeOutPx = Math.max(0, Math.min(clipWidthPx, fadeOut * pixelsPerSecond));

  // Height is 100% of container. Volume maps to Y position:
  // Volume 1.0 => 10% (top padding)
  // Volume 0.0 => 90% (bottom padding)
  const volumePercent = volume * 100;
  const volumeYPercent = 90 - volume * 80; // 0.0 -> 90%, 1.0 -> 10%

  // Build SVG path for envelope visual overlay
  const envelopePoints = `
    0,100
    ${(fadeInPx / clipWidthPx) * 100},${volumeYPercent}
    ${((clipWidthPx - fadeOutPx) / clipWidthPx) * 100},${volumeYPercent}
    100,100
  `;

  // Start drag handler
  const handleDragStart = (
    e: React.PointerEvent<HTMLDivElement>,
    type: "fadeIn" | "fadeOut" | "volume"
  ) => {
    e.stopPropagation();
    e.preventDefault();

    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const clipHeight = rect.height || 40;

    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialVolume: volume,
      initialFadeIn: fadeIn,
      initialFadeOut: fadeOut,
      clipHeight,
    };

    setActiveDrag(type);
    setDragValue(type === "volume" ? volume : type === "fadeIn" ? fadeIn : fadeOut);
    container.setPointerCapture(e.pointerId);
  };

  // Pointer move handler
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!activeDrag || !dragStartRef.current) return;

    const start = dragStartRef.current;
    const deltaX = e.clientX - start.startX;
    const deltaY = e.clientY - start.startY;

    if (activeDrag === "fadeIn") {
      const deltaTime = deltaX / pixelsPerSecond;
      const nextFadeIn = Math.max(0, Math.min(clip.duration - start.initialFadeOut, start.initialFadeIn + deltaTime));
      updateClip(clip.id, { fadeIn: nextFadeIn });
      setDragValue(nextFadeIn);
    } else if (activeDrag === "fadeOut") {
      const deltaTime = -deltaX / pixelsPerSecond;
      const nextFadeOut = Math.max(0, Math.min(clip.duration - start.initialFadeIn, start.initialFadeOut + deltaTime));
      updateClip(clip.id, { fadeOut: nextFadeOut });
      setDragValue(nextFadeOut);
    } else if (activeDrag === "volume") {
      // Dragging UP decreases Y coordinate, so -deltaY increases volume
      const deltaVol = -deltaY / (start.clipHeight * 0.8);
      const nextVol = Math.max(0, Math.min(1.0, start.initialVolume + deltaVol));
      updateClip(clip.id, { volume: nextVol });
      setDragValue(nextVol);
    }
  };

  // Pointer up handler
  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!activeDrag || !dragStartRef.current) return;

    const start = dragStartRef.current;
    const finalVolume = clip.volume ?? 1.0;
    const finalFadeIn = clip.fadeIn ?? 0;
    const finalFadeOut = clip.fadeOut ?? 0;

    containerRef.current?.releasePointerCapture(e.pointerId);
    dragStartRef.current = null;
    setActiveDrag(null);
    setDragValue(null);

    // Commit change to undo history if anything actually changed
    if (
      finalVolume !== start.initialVolume ||
      finalFadeIn !== start.initialFadeIn ||
      finalFadeOut !== start.initialFadeOut
    ) {
      execute(
        new TransformClipCommand(
          clip.id,
          {
            volume: start.initialVolume,
            fadeIn: start.initialFadeIn,
            fadeOut: start.initialFadeOut,
          },
          {
            volume: finalVolume,
            fadeIn: finalFadeIn,
            fadeOut: finalFadeOut,
          }
        )
      );
    }
  };

  // Double click resets volume to 100%
  const handleVolumeDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (volume !== 1.0) {
      execute(
        new TransformClipCommand(
          clip.id,
          { volume },
          { volume: 1.0 }
        )
      );
    }
  };

  return (
    <div
      ref={containerRef}
      onPointerEnter={() => setIsHovered(true)}
      onPointerLeave={() => setIsHovered(false)}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className="absolute inset-0 z-20 pointer-events-none select-none overflow-hidden"
    >
      {/* Visual Envelope Shape (SVG) */}
      <svg
        className="w-full h-full absolute inset-0 opacity-40 hover:opacity-60 transition-opacity"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        {/* Shaded area underneath volume envelope */}
        <polygon
          points={envelopePoints}
          fill="rgba(16, 185, 129, 0.12)"
          stroke="none"
        />
        {/* Envelope boundary line */}
        <polyline
          points={`0,100 ${(fadeInPx / clipWidthPx) * 100},${volumeYPercent} ${((clipWidthPx - fadeOutPx) / clipWidthPx) * 100},${volumeYPercent} 100,100`}
          fill="none"
          stroke="rgba(16, 185, 129, 0.65)"
          strokeWidth="1.5"
        />
      </svg>

      {/* Draggable fade-in handle (knob) */}
      <div
        className={`absolute w-3 h-3 bg-emerald-400 border border-white rounded-bl-lg cursor-ew-resize pointer-events-auto transition-opacity duration-150 flex items-center justify-center shadow-lg ${
          isHovered || activeDrag === "fadeIn" ? "opacity-100 animate-fade-in" : "opacity-0"
        }`}
        style={{
          left: `${fadeInPx}px`,
          top: "0px",
          transform: "translateX(-50%)",
        }}
        onPointerDown={(e) => handleDragStart(e, "fadeIn")}
        title={t("timeline.audio.fadeIn", { duration: fadeIn.toFixed(1) })}
      />

      {/* Draggable fade-out handle (knob) */}
      <div
        className={`absolute w-3 h-3 bg-emerald-400 border border-white rounded-br-lg cursor-ew-resize pointer-events-auto transition-opacity duration-150 flex items-center justify-center shadow-lg ${
          isHovered || activeDrag === "fadeOut" ? "opacity-100 animate-fade-in" : "opacity-0"
        }`}
        style={{
          right: `${fadeOutPx}px`,
          top: "0px",
          transform: "translateX(50%)",
        }}
        onPointerDown={(e) => handleDragStart(e, "fadeOut")}
        title={t("timeline.audio.fadeOut", { duration: fadeOut.toFixed(1) })}
      />

      {/* Draggable volume bar line */}
      <div
        className={`absolute left-0 w-full h-[6px] -translate-y-1/2 cursor-ns-resize pointer-events-auto flex items-center transition-all ${
          isHovered || activeDrag === "volume" ? "opacity-100" : "opacity-0"
        }`}
        style={{
          top: `${volumeYPercent}%`,
        }}
        onPointerDown={(e) => handleDragStart(e, "volume")}
        onDoubleClick={handleVolumeDoubleClick}
        title={t("timeline.audio.resetVolume")}
      >
        <div className="w-full h-[1.5px] bg-emerald-400/90 shadow-[0_0_4px_rgba(52,211,153,0.5)] hover:bg-white" />
      </div>

      {/* Value drag Tooltip indicator */}
      {activeDrag && dragValue !== null && (
        <div
          className="absolute left-1/2 bottom-1.5 -translate-x-1/2 bg-slate-950/85 text-[9px] font-bold text-white px-2 py-0.5 rounded border border-white/10 shadow-md flex items-center gap-1 backdrop-blur-sm z-30"
        >
          <span>
            {activeDrag === "volume"
              ? t("timeline.audio.volume", { volume: Math.round(dragValue * 100) })
              : activeDrag === "fadeIn"
              ? t("timeline.audio.fadeIn", { duration: dragValue.toFixed(1) })
              : t("timeline.audio.fadeOut", { duration: dragValue.toFixed(1) })}
          </span>
        </div>
      )}
    </div>
  );
};

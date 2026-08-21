import React, { useState, useRef } from "react";
import { useTimelineStore } from "@/store/timelineStore";
import { useHistoryStore } from "@/store/historyStore";
import { TransformClipCommand } from "@/core/history/commands/TransformCommand";
import type { Clip } from "@/types";

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
  const dragTargetRef = useRef<HTMLDivElement | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [activeDrag, setActiveDrag] = useState<
    "fadeIn" | "fadeOut" | "volume" | null
  >(null);
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
  const fadeOutPx = Math.max(
    0,
    Math.min(clipWidthPx, fadeOut * pixelsPerSecond),
  );

  // Height is 100% of container. Volume maps to Y position:
  // Volume 1.0 => 10% (top padding)
  // Volume 0.0 => 90% (bottom padding)
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
    type: "fadeIn" | "fadeOut" | "volume",
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
    setDragValue(
      type === "volume" ? volume : type === "fadeIn" ? fadeIn : fadeOut,
    );
    dragTargetRef.current = e.currentTarget;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  // Pointer move handler
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!activeDrag || !dragStartRef.current) return;

    const start = dragStartRef.current;
    const deltaX = e.clientX - start.startX;
    const deltaY = e.clientY - start.startY;
    if (activeDrag === "fadeIn") {
      const deltaTime = deltaX / pixelsPerSecond;
      const nextFadeIn = Math.max(
        0,
        Math.min(
          clip.duration - start.initialFadeOut,
          start.initialFadeIn + deltaTime,
        ),
      );
      updateClip(clip.id, { fadeIn: nextFadeIn });
      setDragValue(nextFadeIn);
    } else if (activeDrag === "fadeOut") {
      const deltaTime = -deltaX / pixelsPerSecond;
      const nextFadeOut = Math.max(
        0,
        Math.min(
          clip.duration - start.initialFadeIn,
          start.initialFadeOut + deltaTime,
        ),
      );
      updateClip(clip.id, { fadeOut: nextFadeOut });
      setDragValue(nextFadeOut);
    } else if (activeDrag === "volume") {
      // Volume is controlled by the bottom rail: up is louder, down is quieter.
      const deltaVol = -deltaY / (start.clipHeight * 0.8);
      const nextVol = Math.max(
        0,
        Math.min(1.0, start.initialVolume + deltaVol),
      );
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

    dragTargetRef.current?.releasePointerCapture(e.pointerId);
    dragTargetRef.current = null;
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
          },
        ),
      );
    }
  };

  // Double click resets volume to 100%
  const handleVolumeDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (volume !== 1.0) {
      execute(new TransformClipCommand(clip.id, { volume }, { volume: 1.0 }));
    }
  };

  const addAudioKeyframe = useTimelineStore((s) => s.addAudioKeyframe);
  const removeAudioKeyframe = useTimelineStore((s) => s.removeAudioKeyframe);
  const updateAudioKeyframe = useTimelineStore((s) => s.updateAudioKeyframe);

  const [activeKfDrag, setActiveKfDrag] = useState<string | null>(null);

  const keyframes = clip.volumeKeyframes || [];

  // Double click line to add keyframe
  const handleLineDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const relTime = Math.max(
      0,
      Math.min(clip.duration, clickX / pixelsPerSecond),
    );
    const gain = Math.max(0, Math.min(2.0, (1 - clickY / rect.height) * 1.25));

    addAudioKeyframe(clip.id, relTime, gain);
  };

  return (
    <div
      ref={containerRef}
      onPointerEnter={() => setIsHovered(true)}
      onPointerLeave={() => setIsHovered(false)}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className="absolute inset-0 z-35 pointer-events-none select-none overflow-hidden"
    >
      {/* Visual Envelope Shape (SVG) */}
      <svg
        className="w-full h-full absolute inset-0 opacity-40 hover:opacity-60 transition-opacity pointer-events-auto cursor-pointer"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        onDoubleClick={handleLineDoubleClick}
      >
        {/* Shaded area underneath volume envelope */}
        <polygon
          points={envelopePoints}
          fill="rgba(16, 185, 129, 0.12)"
          stroke="none"
        />
        {/* Envelope boundary line */}
      </svg>

      {/* Render Keyframe Points */}
      {keyframes.map((kf) => {
        const kfX = Math.max(
          0,
          Math.min(clipWidthPx, kf.time * pixelsPerSecond),
        );
        const kfYPercent = 90 - (kf.gain / 1.25) * 80;
        return (
          <div
            key={kf.id}
            className="absolute w-2.5 h-2.5 bg-emerald-300 border border-white rotate-45 cursor-grab pointer-events-auto z-30 shadow-md hover:scale-125 transition-transform"
            style={{
              left: `${kfX}px`,
              top: `${kfYPercent}%`,
              transform: "translate(-50%, -50%) rotate(45deg)",
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              removeAudioKeyframe(clip.id, kf.id);
            }}
            title={`Keyframe: ${(kf.gain * 100).toFixed(0)}% at ${kf.time.toFixed(2)}s (Right-click to remove)`}
          />
        );
      })}

      {/* Draggable fade-in handle (knob) */}
      <div
        className={`absolute w-4 h-4 bg-emerald-400 border border-white rounded-br-lg cursor-ew-resize pointer-events-auto transition-opacity duration-150 flex items-center justify-center shadow-lg z-40 ${
          isHovered || activeDrag === "fadeIn"
            ? "opacity-100 animate-fade-in"
            : "opacity-0"
        }`}
        style={{
          left: `${Math.max(4, fadeInPx)}px`,
          top: "4px",
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          handleDragStart(e, "fadeIn");
        }}
        title={`Fade In: ${fadeIn.toFixed(1)}s`}
      />

      {/* Draggable fade-out handle (knob) */}
      <div
        className={`absolute w-4 h-4 bg-emerald-400 border border-white rounded-bl-lg cursor-ew-resize pointer-events-auto transition-opacity duration-150 flex items-center justify-center shadow-lg z-40 ${
          isHovered || activeDrag === "fadeOut"
            ? "opacity-100 animate-fade-in"
            : "opacity-0"
        }`}
        style={{
          right: `${Math.max(4, fadeOutPx)}px`,
          top: "4px",
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          handleDragStart(e, "fadeOut");
        }}
        title={`Fade Out: ${fadeOut.toFixed(1)}s`}
      />

      {/* Bottom volume rail: keeps the control out of the filmstrip content. */}
      <div
        role="slider"
        aria-label="Clip volume"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(volume * 100)}
        className={`absolute bottom-1 left-1 right-1 z-40 h-2 cursor-ns-resize pointer-events-auto transition-opacity ${
          isHovered || activeDrag === "volume" ? "opacity-100" : "opacity-70"
        }`}
        style={{
          touchAction: "none",
        }}
        onPointerDown={(e) => handleDragStart(e, "volume")}
        onDoubleClick={handleVolumeDoubleClick}
        title={`Volume: ${Math.round(volume * 100)}%. Drag vertically to adjust; double-click to reset.`}
      >
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 rounded-full bg-black/45" />
        <div
          className="absolute left-0 top-1/2 h-px -translate-y-1/2 rounded-full bg-emerald-300 shadow-[0_0_4px_rgba(52,211,153,0.75)]"
          style={{ width: `${volume * 100}%` }}
        />
        <div className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize rounded-full border border-white bg-emerald-300 shadow-[0_0_5px_rgba(52,211,153,0.9)]" />
      </div>

      {/* Value drag Tooltip indicator */}
      {activeDrag && dragValue !== null && (
        <div className="absolute bottom-5 left-1/2 z-[60] flex min-w-20 -translate-x-1/2 items-center justify-center rounded border border-emerald-200/70 bg-emerald-300 px-2 py-0.5 text-[9px] font-bold text-slate-950 shadow-[0_0_8px_rgba(52,211,153,0.55)]">
          <span>
            {activeDrag === "volume"
              ? `Volume: ${Math.round(dragValue * 100)}%`
              : activeDrag === "fadeIn"
                ? `Fade In: ${dragValue.toFixed(1)}s`
                : `Fade Out: ${dragValue.toFixed(1)}s`}
          </span>
        </div>
      )}
    </div>
  );
};

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
  const dragTargetRef = useRef<HTMLElement | null>(null);

  const [isHovered, setIsHovered] = useState(false);
  const [activeDrag, setActiveDrag] = useState<"volume" | null>(null);
  const [dragValue, setDragValue] = useState<number | null>(null);

  const dragStartRef = useRef<{
    startY: number;
    initialVolume: number;
    clipHeight: number;
  } | null>(null);

  const volume = clip.volume ?? 1.0;
  const fadeIn = clip.fadeIn ?? 0;
  const fadeOut = clip.fadeOut ?? 0;

  // Pixel positions for the envelope shape
  const fadeInPx = Math.max(0, Math.min(clipWidthPx, fadeIn * pixelsPerSecond));
  const fadeOutPx = Math.max(
    0,
    Math.min(clipWidthPx, fadeOut * pixelsPerSecond),
  );

  // Volume envelope SVG (normalised 0–100 viewBox)
  const volumeYPercent = 90 - volume * 80;
  const envelopePoints = `
    0,100
    ${clipWidthPx > 0 ? (fadeInPx / clipWidthPx) * 100 : 0},${volumeYPercent}
    ${clipWidthPx > 0 ? ((clipWidthPx - fadeOutPx) / clipWidthPx) * 100 : 100},${volumeYPercent}
    100,100
  `;

  // ── Volume drag ───────────────────────────────────────────────────────────

  const handleVolumeDragStart = (e: React.PointerEvent<HTMLElement>) => {
    e.stopPropagation();
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    dragStartRef.current = {
      startY: e.clientY,
      initialVolume: volume,
      clipHeight: rect.height || 40,
    };
    setActiveDrag("volume");
    setDragValue(volume);
    dragTargetRef.current = e.currentTarget;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activeDrag !== "volume" || !dragStartRef.current) return;
    const deltaY = e.clientY - dragStartRef.current.startY;
    const deltaVol = -deltaY / (dragStartRef.current.clipHeight * 0.8);
    const nextVol = Math.max(
      0,
      Math.min(1.0, dragStartRef.current.initialVolume + deltaVol),
    );
    updateClip(clip.id, { volume: nextVol });
    setDragValue(nextVol);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!activeDrag || !dragStartRef.current) return;
    const initialVolume = dragStartRef.current.initialVolume;
    const finalVolume = clip.volume ?? 1.0;
    dragTargetRef.current?.releasePointerCapture(e.pointerId);
    dragTargetRef.current = null;
    dragStartRef.current = null;
    setActiveDrag(null);
    setDragValue(null);
    if (finalVolume !== initialVolume) {
      execute(
        new TransformClipCommand(
          clip.id,
          { volume: initialVolume },
          { volume: finalVolume },
        ),
      );
    }
  };

  const handleVolumeDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (volume !== 1.0) {
      execute(new TransformClipCommand(clip.id, { volume }, { volume: 1.0 }));
    }
  };

  // ── Keyframes ─────────────────────────────────────────────────────────────

  const addAudioKeyframe = useTimelineStore((s) => s.addAudioKeyframe);
  const removeAudioKeyframe = useTimelineStore((s) => s.removeAudioKeyframe);
  const keyframes = clip.volumeKeyframes || [];

  const handleLineDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const relTime = Math.max(
      0,
      Math.min(clip.duration, (e.clientX - rect.left) / pixelsPerSecond),
    );
    const gain = Math.max(
      0,
      Math.min(2.0, (1 - (e.clientY - rect.top) / rect.height) * 1.25),
    );
    addAudioKeyframe(clip.id, relTime, gain);
  };

  // ── Render ────────────────────────────────────────────────────────────────

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
      {/* Volume envelope shape */}
      <svg
        className="w-full h-full absolute inset-0 opacity-40 hover:opacity-60 transition-opacity pointer-events-auto cursor-pointer"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        onDoubleClick={handleLineDoubleClick}
      >
        <polygon
          points={envelopePoints}
          fill="rgba(16, 185, 129, 0.12)"
          stroke="none"
        />
      </svg>

      {/* Volume keyframe diamonds */}
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

      {/* Volume rail */}
      <div
        role="slider"
        aria-label="Clip volume"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(volume * 100)}
        className={`absolute bottom-1 left-1 right-1 z-40 h-2 cursor-ns-resize pointer-events-auto transition-opacity ${
          isHovered || activeDrag === "volume" ? "opacity-100" : "opacity-70"
        }`}
        style={{ touchAction: "none" }}
        onPointerDown={handleVolumeDragStart}
        onDoubleClick={handleVolumeDoubleClick}
        title={`Volume: ${Math.round(volume * 100)}% — drag up/down; double-click to reset`}
      >
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 rounded-full bg-black/45" />
        <div
          className="absolute left-0 top-1/2 h-px -translate-y-1/2 rounded-full bg-emerald-300 shadow-[0_0_4px_rgba(52,211,153,0.75)]"
          style={{ width: `${volume * 100}%` }}
        />
        <div className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-emerald-300 shadow-[0_0_5px_rgba(52,211,153,0.9)]" />
      </div>

      {/* Live volume tooltip during drag */}
      {activeDrag === "volume" && dragValue !== null && (
        <div className="absolute bottom-5 left-1/2 z-[60] -translate-x-1/2 flex items-center justify-center rounded border border-emerald-200/70 bg-slate-900/90 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300 shadow pointer-events-none whitespace-nowrap">
          Vol {Math.round(dragValue * 100)}%
        </div>
      )}
    </div>
  );
};

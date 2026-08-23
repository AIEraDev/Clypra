import React, { useState, useRef } from "react";
import { useTimelineStore } from "@/store/timelineStore";
import { useHistoryStore } from "@/store/historyStore";
import { TransformClipCommand } from "@/core/history/commands/TransformCommand";
import type { Clip } from "@/types";
import { timeToPixel, pixelToTime } from "@/lib/timeline/timelineViewport";


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
  const volumeLaneRef = useRef<HTMLDivElement>(null);
  const dragTargetRef = useRef<HTMLElement | null>(null);
  const dragValueRef = useRef<number | null>(null);

  const [isHovered, setIsHovered] = useState(false);
  const [activeDrag, setActiveDrag] = useState<"volume" | null>(null);
  const [dragValue, setDragValue] = useState<number | null>(null);
  const [dragPoint, setDragPoint] = useState<{ x: number; y: number } | null>(
    null,
  );

  const dragStartRef = useRef<{
    startY: number;
    initialVolume: number;
    clipHeight: number;
  } | null>(null);

  const volume = clip.volume ?? 1.0;
  const fadeIn = clip.fadeIn ?? 0;
  const fadeOut = clip.fadeOut ?? 0;

  // Pixel positions for the envelope shape — use timeToPixel so these match the
  // same rounded pixel grid as clip boundaries and the playhead.
  const fadeInPx = Math.max(0, Math.min(clipWidthPx, timeToPixel(fadeIn, pixelsPerSecond)));
  const fadeOutPx = Math.max(
    0,
    Math.min(clipWidthPx, timeToPixel(fadeOut, pixelsPerSecond)),
  );


  // Volume envelope SVG (normalised 0–100 viewBox)
  const displayVolume =
    activeDrag === "volume" && dragValue !== null ? dragValue : volume;
  const volumeYPercent = 90 - displayVolume * 80;
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
    const laneRect = volumeLaneRef.current?.getBoundingClientRect();
    const point = getTooltipPoint(
      e.clientX - rect.left,
      e.clientY - rect.top,
      rect,
    );
    dragStartRef.current = {
      startY: e.clientY,
      initialVolume: displayVolume,
      clipHeight: laneRect?.height || 16,
    };
    setActiveDrag("volume");
    setDragValue(displayVolume);
    dragValueRef.current = displayVolume;
    setDragPoint(point);
    dragTargetRef.current = e.currentTarget;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    // The ref is authoritative during a pointer gesture. React state is only
    // presentation state and may lag during a captured mouse event.
    if (!dragStartRef.current) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const deltaY = e.clientY - dragStartRef.current.startY;
    const deltaVol = -deltaY / (dragStartRef.current.clipHeight * 0.8);
    const nextVol = Math.max(
      0,
      Math.min(1.0, dragStartRef.current.initialVolume + deltaVol),
    );
    updateClip(clip.id, { volume: nextVol });
    setDragValue(nextVol);
    dragValueRef.current = nextVol;
    setDragPoint(
      getTooltipPoint(e.clientX - rect.left, e.clientY - rect.top, rect),
    );
  };

  const finishVolumeDrag = (pointerId?: number) => {
    if (!dragStartRef.current) return;
    const initialVolume = dragStartRef.current.initialVolume;
    const finalVolume = dragValueRef.current ?? clip.volume ?? 1.0;
    const dragTarget = dragTargetRef.current;
    dragTargetRef.current = null;
    dragStartRef.current = null;
    dragValueRef.current = null;
    setActiveDrag(null);
    setDragValue(null);
    setDragPoint(null);
    if (pointerId !== undefined && dragTarget?.hasPointerCapture(pointerId)) {
      dragTarget.releasePointerCapture(pointerId);
    }
    if (finalVolume !== initialVolume) {
      // The pointer-move updates are previews. Re-assert the final value before
      // recording history so a stale parent clip prop cannot restore the default.
      if ((clip.volume ?? 1.0) !== finalVolume) {
        updateClip(clip.id, { volume: finalVolume });
      }
      execute(
        new TransformClipCommand(
          clip.id,
          { volume: initialVolume },
          { volume: finalVolume },
        ),
      );
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    finishVolumeDrag(e.pointerId);
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

  function getTooltipPoint(x: number, y: number, rect: DOMRect) {
    const halfTooltipWidth = 28;
    const minX = Math.min(halfTooltipWidth, rect.width / 2);
    const maxX = Math.max(minX, rect.width - halfTooltipWidth);
    const minY = Math.min(22, rect.height / 2);
    const maxY = Math.max(minY, rect.height - 4);
    return {
      x: Math.max(minX, Math.min(maxX, x)),
      y: Math.max(minY, Math.min(maxY, y)),
    };
  }

  const handleLineDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const lane = volumeLaneRef.current;
    if (!lane) return;
    const rect = lane.getBoundingClientRect();
    const relTime = Math.max(
      0,
      Math.min(clip.duration, pixelToTime(e.clientX - rect.left, pixelsPerSecond)),
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
      onLostPointerCapture={handlePointerUp}
      className="absolute inset-0 z-20 pointer-events-none select-none overflow-hidden"
    >
      {/* Third row: audio waveform and volume management */}
      <div
        ref={volumeLaneRef}
        className="absolute inset-x-0 bottom-0 h-4 pointer-events-none"
      >
        {/* Volume envelope shape */}
        <svg
          className="absolute inset-0 z-10 h-full w-full opacity-40 transition-opacity hover:opacity-60 pointer-events-auto cursor-pointer"
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
            Math.min(clipWidthPx, timeToPixel(kf.time, pixelsPerSecond)),
          );

          const kfYPercent = 90 - (kf.gain / 1.25) * 80;
          return (
            <div
              key={kf.id}
              className="absolute z-30 h-2.5 w-2.5 rotate-45 cursor-grab border border-white bg-emerald-300 pointer-events-auto shadow-md transition-transform hover:scale-125"
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

        {/* Full-width volume guide and drag target */}
        <div
          role="slider"
          aria-label="Clip volume"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(displayVolume * 100)}
          className={`absolute left-1 right-1 z-40 h-4 -translate-y-1/2 cursor-ns-resize cursor-row-resize pointer-events-auto transition-opacity ${
            isHovered || activeDrag === "volume" ? "opacity-100" : "opacity-70"
          }`}
          style={{ top: `${volumeYPercent}%`, touchAction: "none" }}
          onPointerDown={handleVolumeDragStart}
          onDoubleClick={handleVolumeDoubleClick}
          title={`Volume: ${Math.round(displayVolume * 100)}% — drag up/down; double-click to reset`}
        >
          <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 rounded-full bg-black/45" />
          <div
            className="absolute left-0 top-1/2 h-px -translate-y-1/2 rounded-full bg-emerald-300 shadow-[0_0_4px_rgba(52,211,153,0.75)]"
            style={{ width: `${displayVolume * 100}%` }}
          />
        </div>
      </div>

      {/* Live volume tooltip during drag */}
      {activeDrag === "volume" && dragValue !== null && dragPoint !== null && (
        <div
          className="absolute z-60 flex -translate-x-1/2 -translate-y-full -mt-1 items-center justify-center rounded border border-emerald-200/70 bg-slate-900/90 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300 shadow pointer-events-none whitespace-nowrap"
          style={{ left: dragPoint.x, top: dragPoint.y }}
        >
          Vol {Math.round(dragValue * 100)}%
        </div>
      )}
    </div>
  );
};

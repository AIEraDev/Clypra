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
  const fadeDragRef = useRef<{
    type: "fadeIn" | "fadeOut";
    initialFade: number;
    pointerId: number;
  } | null>(null);
  const fadeDragTargetRef = useRef<HTMLElement | null>(null);
  const fadeValueRef = useRef<number | null>(null);

  const [isHovered, setIsHovered] = useState(false);
  const [activeDrag, setActiveDrag] = useState<
    "volume" | "fadeIn" | "fadeOut" | null
  >(null);
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

  const displayVolume =
    activeDrag === "volume" && dragValue !== null ? dragValue : volume;
  // Keep the resting (100%) guide in the center of the clip body, matching
  // the familiar CapCut-style rubber band instead of confining it to a tiny
  // footer lane. Lowering volume moves it down; raising it moves it up.
  const volumeYPercent = 80 - displayVolume * 30;
  const displayFadeIn =
    activeDrag === "fadeIn" && dragValue !== null ? dragValue : fadeIn;
  const displayFadeOut =
    activeDrag === "fadeOut" && dragValue !== null ? dragValue : fadeOut;
  const displayFadeInPx = Math.max(
    0,
    Math.min(clipWidthPx, timeToPixel(displayFadeIn, pixelsPerSecond)),
  );
  const displayFadeOutPx = Math.max(
    0,
    Math.min(clipWidthPx, timeToPixel(displayFadeOut, pixelsPerSecond)),
  );
  const fadeInPercent =
    clipWidthPx > 0 ? (displayFadeInPx / clipWidthPx) * 100 : 0;
  const fadeOutPercent =
    clipWidthPx > 0
      ? ((clipWidthPx - displayFadeOutPx) / clipWidthPx) * 100
      : 100;

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

  const handleFadeDragStart = (
    e: React.PointerEvent<HTMLElement>,
    type: "fadeIn" | "fadeOut",
  ) => {
    e.stopPropagation();
    e.preventDefault();
    const initialFade = type === "fadeIn" ? fadeIn : fadeOut;
    fadeDragRef.current = { type, initialFade, pointerId: e.pointerId };
    fadeDragTargetRef.current = e.currentTarget;
    fadeValueRef.current = initialFade;
    setActiveDrag(type);
    setDragValue(initialFade);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const updateFadeFromPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = fadeDragRef.current;
    const lane = volumeLaneRef.current;
    if (!drag || !lane) return false;

    const rect = lane.getBoundingClientRect();
    // Clamp pointer to the clip width in pixels so dragging past the clip edge
    // never produces a fade longer than the clip duration.
    const localX = Math.max(0, Math.min(clipWidthPx, e.clientX - rect.left));
    const rawFade =
      drag.type === "fadeIn"
        ? pixelToTime(localX, pixelsPerSecond)
        : pixelToTime(Math.max(0, clipWidthPx - localX), pixelsPerSecond);
    // Read the opposite fade from the clip's current stored value (not the drag
    // ref, which tracks the handle being dragged) so the two fades cannot
    // overlap or together exceed the clip duration.
    const MAX_FADE_SECONDS = 5;
    const oppositeFade = drag.type === "fadeIn" ? fadeOut : fadeIn;
    const maxAllowed = Math.min(
      MAX_FADE_SECONDS,
      Math.max(0, clip.duration - oppositeFade),
    );
    const nextFade = Math.max(0, Math.min(maxAllowed, rawFade));
    const field = drag.type;

    updateClip(clip.id, { [field]: nextFade });
    fadeValueRef.current = nextFade;
    setDragValue(nextFade);
    return true;
  };

  const finishFadeDrag = (pointerId?: number) => {
    const drag = fadeDragRef.current;
    if (!drag) return;

    const finalFade = fadeValueRef.current ?? drag.initialFade;
    const field = drag.type;
    const target = fadeDragTargetRef.current;
    fadeDragRef.current = null;
    fadeDragTargetRef.current = null;
    fadeValueRef.current = null;
    setActiveDrag(null);
    setDragValue(null);
    if (pointerId !== undefined && target?.hasPointerCapture(pointerId)) {
      target.releasePointerCapture(pointerId);
    }

    if (finalFade !== drag.initialFade) {
      execute(
        new TransformClipCommand(
          clip.id,
          { [field]: drag.initialFade },
          { [field]: finalFade },
        ),
      );
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (updateFadeFromPointer(e)) return;
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
    if (fadeDragRef.current) {
      finishFadeDrag(e.pointerId);
      return;
    }
    finishVolumeDrag(e.pointerId);
  };

  const handleVolumeDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (volume !== 1.0) {
      execute(new TransformClipCommand(clip.id, { volume }, { volume: 1.0 }));
    }
  };

  // ── Keyframes ─────────────────────────────────────────────────────────────

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
      className="absolute inset-x-0 bottom-0 top-5 z-40 pointer-events-none select-none overflow-hidden"
    >
      {/* CapCut-style full-clip audio overlay. */}
      <div ref={volumeLaneRef} className="absolute inset-0 pointer-events-none">
        {/* Fade shading and curved envelope guides. */}
        <svg
          className="absolute inset-0 z-10 h-full w-full pointer-events-none"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {displayFadeInPx > 0 && (
            <>
              <path
                d={`M 0 100 Q ${fadeInPercent * 0.55} 35 ${fadeInPercent} 24 L ${fadeInPercent} 100 Z`}
                fill="rgba(56, 189, 248, 0.22)"
              />
              <path
                d={`M 0 100 Q ${fadeInPercent * 0.55} 35 ${fadeInPercent} 24`}
                fill="none"
                stroke="rgba(186, 230, 253, 0.72)"
                strokeWidth="0.7"
              />
            </>
          )}
          {displayFadeOutPx > 0 && (
            <>
              <path
                d={`M ${fadeOutPercent} 24 Q ${fadeOutPercent + (100 - fadeOutPercent) * 0.45} 35 100 100 L ${fadeOutPercent} 100 Z`}
                fill="rgba(56, 189, 248, 0.22)"
              />
              <path
                d={`M ${fadeOutPercent} 24 Q ${fadeOutPercent + (100 - fadeOutPercent) * 0.45} 35 100 100`}
                fill="none"
                stroke="rgba(186, 230, 253, 0.72)"
                strokeWidth="0.7"
              />
            </>
          )}
        </svg>

        {/* CapCut-style endpoint knobs: drag either edge inward to create a fade. */}
        <button
          type="button"
          aria-label="Fade in handle"
          data-testid="audio-fade-in-handle"
          className={`absolute z-50 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-900 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.75)] pointer-events-auto ${activeDrag === "fadeIn" ? "cursor-grabbing" : "cursor-grab"}`}
          style={{
            left: `${displayFadeInPx}px`,
            top: "24%",
            touchAction: "none",
          }}
          onPointerDown={(event) => handleFadeDragStart(event, "fadeIn")}
          title={`Fade in: ${displayFadeIn.toFixed(2)}s — drag right to set`}
        />
        <button
          type="button"
          aria-label="Fade out handle"
          data-testid="audio-fade-out-handle"
          className={`absolute z-50 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-900 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.75)] pointer-events-auto ${activeDrag === "fadeOut" ? "cursor-grabbing" : "cursor-grab"}`}
          style={{
            left: `${clipWidthPx - displayFadeOutPx}px`,
            top: "24%",
            touchAction: "none",
          }}
          onPointerDown={(event) => handleFadeDragStart(event, "fadeOut")}
          title={`Fade out: ${displayFadeOut.toFixed(2)}s — drag left to set`}
        />

        {/* Volume keyframe diamonds */}
        {keyframes.map((kf) => {
          const kfX = Math.max(
            0,
            Math.min(clipWidthPx, timeToPixel(kf.time, pixelsPerSecond)),
          );

          const kfYPercent = 80 - Math.min(1, kf.gain) * 30;
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

        {/* Full-width, vertically draggable volume rubber band. */}
        <div
          role="slider"
          aria-label="Clip volume"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(displayVolume * 100)}
          className={`absolute left-1 right-1 z-40 h-4 -translate-y-1/2 cursor-ns-resize pointer-events-auto transition-opacity ${
            isHovered || activeDrag === "volume" ? "opacity-100" : "opacity-70"
          }`}
          style={{ top: `${volumeYPercent}%`, touchAction: "none" }}
          onPointerDown={handleVolumeDragStart}
          onDoubleClick={handleVolumeDoubleClick}
          title={`Volume: ${Math.round(displayVolume * 100)}% — drag up/down; double-click to reset`}
        >
          <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 rounded-full bg-white/75 shadow-[0_0_3px_rgba(255,255,255,0.35)]" />
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

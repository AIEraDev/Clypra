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

// Half-width of the draggable hit strip on each fade handle (px).
const HANDLE_HIT_HALF = 5;

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
  const [activeDrag, setActiveDrag] = useState<
    "fadeIn" | "fadeOut" | "volume" | null
  >(null);
  // Live value shown in tooltip while dragging
  const [dragValue, setDragValue] = useState<number | null>(null);
  // Pixel X of the active handle — used to position the tooltip near the cursor
  const [handlePx, setHandlePx] = useState<number | null>(null);

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

  // Pixel width of each fade region — clamped to clip width.
  // Uses the same pixelsPerSecond unit as timeToPixel() / trim math.
  const fadeInPx = Math.max(0, Math.min(clipWidthPx, fadeIn * pixelsPerSecond));
  const fadeOutPx = Math.max(
    0,
    Math.min(clipWidthPx, fadeOut * pixelsPerSecond),
  );

  // Volume envelope SVG (viewBox 0–100 normalised space)
  const volumeYPercent = 90 - volume * 80;
  const envelopePoints = `
    0,100
    ${clipWidthPx > 0 ? (fadeInPx / clipWidthPx) * 100 : 0},${volumeYPercent}
    ${clipWidthPx > 0 ? ((clipWidthPx - fadeOutPx) / clipWidthPx) * 100 : 100},${volumeYPercent}
    100,100
  `;

  // ── Drag handlers ─────────────────────────────────────────────────────────

  const handleDragStart = (
    e: React.PointerEvent<HTMLElement>,
    type: "fadeIn" | "fadeOut" | "volume",
  ) => {
    e.stopPropagation();
    e.preventDefault();

    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();

    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialVolume: volume,
      initialFadeIn: fadeIn,
      initialFadeOut: fadeOut,
      clipHeight: rect.height || 40,
    };

    const initVal =
      type === "volume" ? volume : type === "fadeIn" ? fadeIn : fadeOut;
    setActiveDrag(type);
    setDragValue(initVal);
    setHandlePx(
      type === "fadeIn"
        ? fadeInPx
        : type === "fadeOut"
          ? clipWidthPx - fadeOutPx
          : null,
    );

    dragTargetRef.current = e.currentTarget;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!activeDrag || !dragStartRef.current) return;

    const start = dragStartRef.current;
    const deltaX = e.clientX - start.startX;
    const deltaY = e.clientY - start.startY;

    if (activeDrag === "fadeIn") {
      // Drag right = longer fade-in
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
      setHandlePx(nextFadeIn * pixelsPerSecond);
    } else if (activeDrag === "fadeOut") {
      // Drag left = longer fade-out (deltaX is negative when dragging left)
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
      setHandlePx(clipWidthPx - nextFadeOut * pixelsPerSecond);
    } else if (activeDrag === "volume") {
      // Drag up = louder, down = quieter
      const deltaVol = -deltaY / (start.clipHeight * 0.8);
      const nextVol = Math.max(
        0,
        Math.min(1.0, start.initialVolume + deltaVol),
      );
      updateClip(clip.id, { volume: nextVol });
      setDragValue(nextVol);
    }
  };

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
    setHandlePx(null);

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
          { volume: finalVolume, fadeIn: finalFadeIn, fadeOut: finalFadeOut },
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

  // ── Keyframe support ──────────────────────────────────────────────────────

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

  // Premiere-style corner triangle fill heights — full clip height
  const TRIANGLE_H = "100%";

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
      {/* ── Volume envelope SVG ── */}
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

      {/* ── Volume keyframe diamonds ── */}
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

      {/* ── Fade-in: Premiere-style corner triangle ── */}
      {(isHovered || activeDrag === "fadeIn") && fadeInPx > 0 && (
        <svg
          className="absolute top-0 left-0 pointer-events-none"
          style={{ width: `${fadeInPx}px`, height: TRIANGLE_H }}
          preserveAspectRatio="none"
          viewBox="0 0 1 1"
        >
          {/* Filled triangle: top-left corner to bottom-left, to the handle position */}
          <polygon points="0,0 1,0 0,1" fill="rgba(16,185,129,0.28)" />
          {/* Hypotenuse line */}
          <line
            x1="0"
            y1="1"
            x2="1"
            y2="0"
            stroke="rgba(52,211,153,0.85)"
            strokeWidth="0.025"
          />
        </svg>
      )}

      {/* Fade-in drag handle — vertical strip at the end of the fade region */}
      <div
        className={`absolute top-0 bottom-0 z-40 cursor-ew-resize pointer-events-auto transition-opacity ${
          isHovered || activeDrag === "fadeIn" ? "opacity-100" : "opacity-0"
        }`}
        style={{
          left: `${fadeInPx - HANDLE_HIT_HALF}px`,
          width: `${HANDLE_HIT_HALF * 2}px`,
        }}
        onPointerDown={(e) => handleDragStart(e, "fadeIn")}
        title={`Fade In: ${fadeIn.toFixed(2)}s — drag right to extend`}
      >
        {/* Visible marker line */}
        <div className="absolute left-1/2 top-0 bottom-0 w-[2px] -translate-x-1/2 bg-emerald-400/80 rounded-full" />
      </div>

      {/* ── Fade-out: Premiere-style corner triangle ── */}
      {(isHovered || activeDrag === "fadeOut") && fadeOutPx > 0 && (
        <svg
          className="absolute top-0 right-0 pointer-events-none"
          style={{ width: `${fadeOutPx}px`, height: TRIANGLE_H }}
          preserveAspectRatio="none"
          viewBox="0 0 1 1"
        >
          {/* Filled triangle: top-right corner, to bottom-right, to the handle position */}
          <polygon points="0,0 1,0 1,1" fill="rgba(16,185,129,0.28)" />
          {/* Hypotenuse line */}
          <line
            x1="0"
            y1="0"
            x2="1"
            y2="1"
            stroke="rgba(52,211,153,0.85)"
            strokeWidth="0.025"
          />
        </svg>
      )}

      {/* Fade-out drag handle — vertical strip at the start of the fade-out region */}
      <div
        className={`absolute top-0 bottom-0 z-40 cursor-ew-resize pointer-events-auto transition-opacity ${
          isHovered || activeDrag === "fadeOut" ? "opacity-100" : "opacity-0"
        }`}
        style={{
          right: `${fadeOutPx - HANDLE_HIT_HALF}px`,
          width: `${HANDLE_HIT_HALF * 2}px`,
        }}
        onPointerDown={(e) => handleDragStart(e, "fadeOut")}
        title={`Fade Out: ${fadeOut.toFixed(2)}s — drag left to extend`}
      >
        {/* Visible marker line */}
        <div className="absolute left-1/2 top-0 bottom-0 w-[2px] -translate-x-1/2 bg-emerald-400/80 rounded-full" />
      </div>

      {/* ── Volume rail (bottom of clip) ── */}
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
        onPointerDown={(e) => handleDragStart(e, "volume")}
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

      {/* ── Live drag tooltip ── */}
      {activeDrag && dragValue !== null && (
        <div
          className="absolute top-1 z-[60] flex items-center justify-center rounded border border-emerald-200/70 bg-slate-900/90 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300 shadow-[0_0_6px_rgba(52,211,153,0.4)] pointer-events-none whitespace-nowrap"
          style={{
            // Position tooltip near the active handle; keep it inside the clip
            left:
              activeDrag === "fadeIn"
                ? `${Math.min(handlePx ?? fadeInPx, clipWidthPx - 52)}px`
                : activeDrag === "fadeOut"
                  ? `${Math.max(0, (handlePx ?? clipWidthPx - fadeOutPx) - 52)}px`
                  : "50%",
            transform: activeDrag === "volume" ? "translateX(-50%)" : "none",
          }}
        >
          {activeDrag === "volume"
            ? `Vol ${Math.round(dragValue * 100)}%`
            : activeDrag === "fadeIn"
              ? `In ${dragValue.toFixed(2)}s`
              : `Out ${dragValue.toFixed(2)}s`}
        </div>
      )}
    </div>
  );
};

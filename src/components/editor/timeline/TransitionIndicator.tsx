import React, { useState, useRef, useEffect } from "react";
import { GripVertical } from "lucide-react";
import { useTimelineStore } from "@/store/timelineStore";
import { useUIStore } from "@/store/uiStore";
import type { TransitionTimelineItem } from "@/types";
import { t, useLanguage, type MessageKey } from "@/i18n";

interface TransitionIndicatorProps {
  transition: TransitionTimelineItem;
  pixelsPerSecond: number;
  fromClip: { id: string; startTime: number; duration: number } | undefined;
  toClip: { id: string; startTime: number; duration: number } | undefined;
}

const MIN_TRANSITION_DURATION = 0.1; // 100ms minimum
const MAX_TRANSITION_DURATION = 5.0; // 5 seconds maximum
const TRANSITION_TYPE_LABEL_KEYS = new Map<TransitionTimelineItem["type"], MessageKey>([
  ["fade", "timeline.transition.type.fade"],
  ["dissolve", "timeline.transition.type.dissolve"],
  ["canvas", "timeline.transition.type.canvas"],
]);

export const TransitionIndicator: React.FC<TransitionIndicatorProps> = ({ transition, pixelsPerSecond, fromClip, toClip }) => {
  useLanguage();
  const selectedTransitionId = useUIStore((s) => s.selectedTransitionId);
  const selectTransition = useUIStore((s) => s.selectTransition);
  const updateTransition = useTimelineStore((s) => s.updateTransition);

  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; originalDuration: number; originalStartTime: number } | null>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);

  const isSelected = selectedTransitionId === transition.id;
  const transitionTypeLabelKey = TRANSITION_TYPE_LABEL_KEYS.get(transition.type);
  const transitionTypeLabel = transitionTypeLabelKey ? t(transitionTypeLabelKey) : transition.type;
  const duration = transition.placement.duration.toFixed(2);

  // If clips are missing, don't render (edge case safety)
  if (!fromClip || !toClip) return null;

  const left = transition.placement.startTime * pixelsPerSecond;
  const width = transition.placement.duration * pixelsPerSecond;

  // Calculate the cut point (where clips meet)
  const cutPoint = fromClip.startTime + fromClip.duration;

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.stopPropagation();

    selectTransition(transition.id);

    // Start dragging to adjust duration
    dragStartRef.current = {
      x: e.clientX,
      originalDuration: transition.placement.duration,
      originalStartTime: transition.placement.startTime,
    };
    setIsDragging(true);
    indicatorRef.current?.setPointerCapture(e.pointerId);
  };

  useEffect(() => {
    if (!isDragging || !dragStartRef.current) return;

    const handlePointerMove = (e: PointerEvent) => {
      if (!dragStartRef.current) return;

      const deltaX = e.clientX - dragStartRef.current.x;
      const deltaTime = deltaX / pixelsPerSecond;

      // Calculate new duration (dragging right increases, left decreases)
      let newDuration = dragStartRef.current.originalDuration + deltaTime;

      // Clamp duration to min/max and clip constraints
      const maxDurationByFromClip = fromClip ? fromClip.duration : MAX_TRANSITION_DURATION;
      const maxDurationByToClip = toClip ? toClip.duration : MAX_TRANSITION_DURATION;
      const maxDuration = Math.min(maxDurationByFromClip, maxDurationByToClip, MAX_TRANSITION_DURATION);

      newDuration = Math.max(MIN_TRANSITION_DURATION, Math.min(newDuration, maxDuration));

      // Update transition - keep it centered at the cut point
      const newStartTime = cutPoint - newDuration / 2;

      updateTransition(transition.id, {
        placement: {
          ...transition.placement,
          duration: newDuration,
          startTime: newStartTime,
        },
      });
    };

    const handlePointerUp = () => {
      setIsDragging(false);
      dragStartRef.current = null;
    };

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handlePointerUp);

    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [isDragging, pixelsPerSecond, transition.id, fromClip, toClip, cutPoint, updateTransition]);

  return (
    <div
      ref={indicatorRef}
      data-timeline-interactive="true"
      onPointerDown={handlePointerDown}
      className={`absolute top-0 bottom-0 pointer-events-auto cursor-ew-resize transition-all z-40 ${isSelected ? "ring-2 ring-white ring-offset-2 ring-offset-transparent" : ""}`}
      style={{
        left: `${left}px`,
        width: `${width}px`,
      }}
      title={t("timeline.transition.title", { type: transitionTypeLabel, duration })}
    >
      {/* Diagonal gradient overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `linear-gradient(135deg, 
            rgba(255, 255, 255, 0.15) 0%, 
            rgba(255, 255, 255, 0.25) 25%, 
            rgba(255, 255, 255, 0.15) 50%, 
            rgba(255, 255, 255, 0.25) 75%, 
            rgba(255, 255, 255, 0.15) 100%
          )`,
          backgroundSize: "20px 20px",
          opacity: isDragging ? 0.9 : isSelected ? 0.7 : 0.5,
          transition: "opacity 0.15s ease",
        }}
      />

      {/* Left border accent */}
      <div
        className="absolute left-0 top-0 bottom-0 w-0.5 pointer-events-none"
        style={{
          background: "rgba(255, 255, 255, 0.6)",
          boxShadow: "0 0 4px rgba(255, 255, 255, 0.4)",
        }}
      />

      {/* Right border accent */}
      <div
        className="absolute right-0 top-0 bottom-0 w-0.5 pointer-events-none"
        style={{
          background: "rgba(255, 255, 255, 0.6)",
          boxShadow: "0 0 4px rgba(255, 255, 255, 0.4)",
        }}
      />

      {/* Draggable handle in the center */}
      <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none transition-all ${isDragging || isSelected ? "opacity-100 scale-110" : "opacity-70 scale-100"}`}>
        <div
          className="flex items-center justify-center rounded-full bg-white/90 shadow-lg backdrop-blur-sm"
          style={{
            width: "24px",
            height: "24px",
          }}
        >
          <GripVertical className="w-3 h-3 text-gray-700" />
        </div>
      </div>

      {/* Duration label - shows on hover or when selected */}
      {(isSelected || isDragging) && (
        <div
          className="absolute -bottom-6 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded bg-black/80 text-white text-[10px] font-medium whitespace-nowrap pointer-events-none"
          style={{
            zIndex: 50,
          }}
        >
          {t("timeline.transition.duration", { duration })}
        </div>
      )}
    </div>
  );
};

/**
 * InlineKeyframeNav.tsx
 *
 * CapCut-parity inline keyframe diamond navigation controls: < ◇ >
 * Used across Transform, Stroke, Background, and Shadow sections.
 */

import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export interface InlineKeyframeNavProps {
  state: {
    hasKeyframes: boolean;
    isAtKeyframe: boolean;
    hasPrev: boolean;
    hasNext: boolean;
  };
  onToggle: () => void;
  onPrev: () => void;
  onNext: () => void;
  label: string;
}

export const InlineKeyframeNav: React.FC<InlineKeyframeNavProps> = ({
  state,
  onToggle,
  onPrev,
  onNext,
  label,
}) => {
  return (
    <div className="flex items-center gap-0.5 select-none shrink-0">
      <button
        type="button"
        onClick={onPrev}
        disabled={!state.hasPrev}
        className={`p-0.5 transition-colors cursor-pointer ${
          state.hasPrev
            ? "text-[#8e8e93] hover:text-white"
            : "text-[#4a4a4e] pointer-events-none"
        }`}
        title={`Previous keyframe for ${label}`}
      >
        <ChevronLeft className="w-3 h-3" />
      </button>

      <button
        type="button"
        onClick={onToggle}
        className={`p-0.5 rounded transition-colors cursor-pointer ${
          state.isAtKeyframe
            ? "text-cyan-400 drop-shadow-[0_0_6px_rgba(34,211,238,0.5)]"
            : "text-[#8e8e93] hover:text-white"
        }`}
        title={
          state.isAtKeyframe
            ? `Remove keyframe for ${label}`
            : `Add keyframe for ${label}`
        }
      >
        <span className="text-xs">◇</span>
      </button>

      <button
        type="button"
        onClick={onNext}
        disabled={!state.hasNext}
        className={`p-0.5 transition-colors cursor-pointer ${
          state.hasNext
            ? "text-[#8e8e93] hover:text-white"
            : "text-[#4a4a4e] pointer-events-none"
        }`}
        title={`Next keyframe for ${label}`}
      >
        <ChevronRight className="w-3 h-3" />
      </button>
    </div>
  );
};

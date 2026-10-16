import React from "react";
import { ChevronLeft, ChevronRight, TrendingUp } from "lucide-react";
import { KeyframeToggleButton } from "./KeyframeToggleButton";

export interface KeyframeNavControlsProps {
  /** Whether the property has any keyframes at all */
  hasKeyframes: boolean;
  /** Whether playhead is currently positioned on an existing keyframe */
  isAtKeyframe: boolean;
  /** Callback to insert/remove keyframe at current playhead position */
  onToggleKeyframe: () => void;
  /** Callback to jump playhead to previous keyframe */
  onPrevKeyframe?: () => void;
  /** Callback to jump playhead to next keyframe */
  onNextKeyframe?: () => void;
  /** Has keyframe before current playhead time */
  hasPrev?: boolean;
  /** Has keyframe after current playhead time */
  hasNext?: boolean;
  /** Optional callback to open curve/speed editor */
  onOpenCurveEditor?: () => void;
  /** Label for accessibility/tooltips */
  label?: string;
}

export const KeyframeNavControls: React.FC<KeyframeNavControlsProps> = ({
  hasKeyframes,
  isAtKeyframe,
  onToggleKeyframe,
  onPrevKeyframe,
  onNextKeyframe,
  hasPrev = false,
  hasNext = false,
  onOpenCurveEditor,
  label = "Property",
}) => {
  return (
    <div className="flex items-center gap-0.5 select-none">
      {/* Previous keyframe navigation */}
      {hasKeyframes && onPrevKeyframe && (
        <button
          type="button"
          onClick={onPrevKeyframe}
          disabled={!hasPrev}
          className={`p-0.5 rounded transition-all cursor-pointer ${
            hasPrev
              ? "text-text-muted hover:text-accent hover:bg-accent/10"
              : "opacity-25 pointer-events-none text-text-muted"
          }`}
          title={`Previous keyframe for ${label}`}
        >
          <ChevronLeft className="w-3 h-3" />
        </button>
      )}

      {/* Diamond keyframe toggle */}
      <KeyframeToggleButton
        active={isAtKeyframe}
        onToggle={onToggleKeyframe}
        title={isAtKeyframe ? `Remove keyframe for ${label}` : `Add keyframe for ${label}`}
      />

      {/* Next keyframe navigation */}
      {hasKeyframes && onNextKeyframe && (
        <button
          type="button"
          onClick={onNextKeyframe}
          disabled={!hasNext}
          className={`p-0.5 rounded transition-all cursor-pointer ${
            hasNext
              ? "text-text-muted hover:text-accent hover:bg-accent/10"
              : "opacity-25 pointer-events-none text-text-muted"
          }`}
          title={`Next keyframe for ${label}`}
        >
          <ChevronRight className="w-3 h-3" />
        </button>
      )}

      {/* Curve editor shortcut */}
      {hasKeyframes && onOpenCurveEditor && (
        <button
          type="button"
          onClick={onOpenCurveEditor}
          className="p-1 text-accent hover:text-accent/80 hover:bg-accent/10 rounded transition-all cursor-pointer ml-0.5"
          title={`Open Speed & Curve Editor for ${label}`}
        >
          <TrendingUp className="w-3 h-3" />
        </button>
      )}
    </div>
  );
};

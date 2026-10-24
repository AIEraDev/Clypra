import React from "react";

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
    <div className="flex items-center gap-x-0">
      <span
        className="text-text-muted cursor-pointer"
        onClick={onPrevKeyframe}
        title={`Previous keyframe for ${label}`}
      >
        {/* prettier-ignore */}
        <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none" /><path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m14 6l-6 6l6 6" /></svg>
      </span>

      <button
        className={`w-2.5 h-2.5 border border-text-muted text-white inline-flex justify-center items-center transition-colors duration-300 cursor-pointer group ${isAtKeyframe ? "bg-accent" : "hover:bg-accent hover:border-none"}`}
        style={{ transform: "rotate(45deg)", willChange: "transform" }}
        onClick={onToggleKeyframe}
        title={
          isAtKeyframe
            ? `Remove keyframe for ${label}`
            : `Add keyframe for ${label}`
        }
      >
        {!isAtKeyframe ? (
          <span
            className="opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ display: "inline-block", transform: "rotate(-45deg)" }}
          >
            {/* prettier-ignore */}
            <svg xmlns="http://www.w3.org/2000/svg" className="Plus-Icon" width="8px" height="8px" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none" /><path fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" d="M12 20v-8m0 0V4m0 8h8m-8 0H4" /></svg>
          </span>
        ) : (
          <span
            className="opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ display: "inline-block", transform: "rotate(-45deg)" }}
          >
            {/* prettier-ignore */}
            <svg xmlns="http://www.w3.org/2000/svg" className="Minus-Icon" width="8px" height="8px" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none" /><path fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" d="M20 12H4" /></svg>
          </span>
        )}
      </button>

      <span
        className="text-text-muted cursor-pointer"
        onClick={onNextKeyframe}
        title={`Next keyframe for ${label}`}
      >
        {/* prettier-ignore */}
        <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none" /><path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m9 6l6 6l-6 6" /></svg>
      </span>
    </div>
  );
};

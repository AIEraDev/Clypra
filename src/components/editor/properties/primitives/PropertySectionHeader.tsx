import { useState } from "react";
import { KeyframeNavControls } from "./KeyframeNavControls";

interface PropertySectionHeaderProps {
  title: string;
  /** Whether the section is collapsed */
  isCollapsed?: boolean;
  /** Callback when collapse state changes */
  onToggleCollapse?: () => void;
}

export const PropertySectionHeader: React.FC<PropertySectionHeaderProps> = ({
  title,
  isCollapsed = false,
  onToggleCollapse,
}) => {
  const [keyframe, setKeyframe] = useState(false);

  const handleClick = () => {
    if (onToggleCollapse) {
      onToggleCollapse();
    }
  };

  return (
    <div
      className="flex justify-between items-center cursor-pointer"
      onClick={handleClick}
    >
      <div className="flex items-center gap-x-0.5">
        <h3 className="text-xs font-medium text-white/80 tracking-wider">
          {title}
        </h3>

        {/* Chevron icon - rotates based on collapsed state */}
        {/* prettier-ignore */}
        <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" className={`transition-transform ${isCollapsed ? "-rotate-90" : ""}`} ><path d="M0 0h24v24H0z" fill="none" /><path fill="currentColor" d="m12 15l5.5-5.5h-11z" /></svg>
      </div>

      <div
        className="flex items-center gap-x-0.5"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="cursor-pointer">
          {/* prettier-ignore */}
          <svg xmlns="http://www.w3.org/2000/svg" width="12px" height="12px" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none" /><path fill="currentColor" d="M21.21 8.11c-.25-.59-.56-1.16-.92-1.7c-.36-.53-.77-1.03-1.22-1.48s-.95-.86-1.48-1.22c-.54-.36-1.11-.67-1.7-.92c-.6-.26-1.24-.45-1.88-.58c-1.32-.27-2.71-.27-4.03 0c-.64.13-1.27.33-1.88.58c-.59.25-1.16.56-1.7.92c-.53.36-1.03.77-1.48 1.22c-.17.17-.32.35-.48.52L1.99 3v6h6L5.86 6.87c.15-.18.31-.36.48-.52c.36-.36.76-.69 1.18-.98c.43-.29.89-.54 1.36-.74c.48-.2.99-.36 1.5-.47a8 8 0 0 1 4.73.47c.47.2.93.45 1.36.74c.42.29.82.62 1.18.98s.69.76.98 1.18c.29.43.54.89.74 1.36c.2.48.36.99.47 1.5c.11.53.16 1.07.16 1.61a7.85 7.85 0 0 1-.63 3.11c-.2.47-.45.93-.74 1.36c-.29.42-.62.82-.98 1.18s-.76.69-1.18.98c-.43.29-.89.54-1.36.74c-.48.2-.99.36-1.5.47a8 8 0 0 1-4.73-.47c-.47-.2-.93-.45-1.36-.74c-.42-.29-.82-.62-1.18-.98s-.69-.76-.98-1.18c-.29-.43-.54-.89-.74-1.36c-.2-.48-.36-.99-.47-1.5A8 8 0 0 1 3.99 12h-2c0 .68.07 1.36.2 2.01c.13.64.33 1.27.58 1.88c.25.59.56 1.16.92 1.7c.36.53.77 1.03 1.22 1.48s.95.86 1.48 1.22c.54.36 1.11.67 1.7.92c.6.26 1.24.45 1.88.58c.66.13 1.34.2 2.01.2s1.35-.07 2.01-.2c.64-.13 1.27-.33 1.88-.58c.59-.25 1.16-.56 1.7-.92c.53-.36 1.03-.77 1.48-1.22s.86-.95 1.22-1.48c.36-.54.67-1.11.92-1.7c.26-.6.45-1.24.58-1.88c.13-.66.2-1.33.2-2.01s-.07-1.36-.2-2.01c-.13-.64-.33-1.27-.58-1.88Z" /></svg>
        </button>

        <KeyframeNavControls
          hasKeyframes={keyframe}
          isAtKeyframe={keyframe}
          onToggleKeyframe={() => setKeyframe(!keyframe)}
          onPrevKeyframe={() => {}}
          onNextKeyframe={() => {}}
          label={title}
        />
      </div>
    </div>
  );
};

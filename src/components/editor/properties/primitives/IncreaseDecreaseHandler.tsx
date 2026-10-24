import React from "react";

interface IncreaseDecreaseHandlerProps {
  onIncrease: () => void;
  onDecrease: () => void;
  label: string;
}

export const IncreaseDecreaseHandler: React.FC<
  IncreaseDecreaseHandlerProps
> = ({ onIncrease, onDecrease, label }) => {
  return (
    <div className="flex flex-col bg-[#27272a] border border-white/8 rounded-sm overflow-hidden">
      <button
        type="button"
        onClick={onIncrease}
        className="h-[10px] w-[16px] flex items-center justify-center text-[#71717a] hover:text-white hover:bg-white/8 transition-colors cursor-pointer border-b border-white/8"
        aria-label={`Increase ${label}`}
      >
        {/* prettier-ignore */}
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15" /></svg>
      </button>
      <button
        type="button"
        onClick={onDecrease}
        className="h-[10px] w-[16px] flex items-center justify-center text-[#71717a] hover:text-white hover:bg-white/8 transition-colors cursor-pointer"
        aria-label={`Decrease ${label}`}
      >
        {/* prettier-ignore */}
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" ><polyline points="6 9 12 15 18 9" /></svg>
      </button>
    </div>
  );
};

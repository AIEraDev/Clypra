import React, { useEffect } from "react";
import { X } from "lucide-react";

export interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export const BottomSheet: React.FC<BottomSheetProps> = ({
  isOpen,
  onClose,
  title,
  children,
}) => {
  // Close on Escape key press
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-10000 flex flex-col justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-[2px] transition-opacity duration-300 animate-in fade-in"
        onClick={onClose}
      />

      {/* Sheet Container */}
      <div
        className="relative w-full max-h-[80vh] flex flex-col bg-surface-panel/95 backdrop-blur-lg border-t border-white/10 rounded-t-2xl shadow-2xl z-10 animate-in slide-in-from-bottom duration-300 ease-out"
        style={{
          boxShadow: "0 -8px 32px rgba(0, 0, 0, 0.4)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Gestural Drag Handle Indicator */}
        <div className="flex justify-center py-2 shrink-0 cursor-pointer" onClick={onClose}>
          <div className="w-12 h-1.5 rounded-full bg-white/10 hover:bg-white/20 transition-colors" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pb-3 border-b border-white/6 shrink-0">
          <h2 className="text-sm font-semibold text-text-primary tracking-tight">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/6 transition-colors text-text-muted hover:text-text-primary cursor-pointer"
            aria-label="Close sheet"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body (scrollable) */}
        <div className="flex-1 overflow-y-auto scrollbar-thin min-h-0 select-none">
          {children}
        </div>
      </div>
    </div>
  );
};

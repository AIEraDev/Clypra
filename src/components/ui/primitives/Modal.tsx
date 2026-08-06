import React, { useEffect } from "react";
import { X } from "lucide-react";

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Use "lg" for wide settings-style modals */
  size?: "default" | "lg";
}

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, footer, size = "default" }) => {
  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const maxW = size === "lg" ? "max-w-[680px]" : "max-w-xl";

  return (
    <div className="fixed inset-0 z-10000 flex items-center justify-center p-2 sm:p-4">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/70 backdrop-blur-[2px] animate-in fade-in duration-150" onClick={onClose} />
      {/* Dialog */}
      <div className={`relative ${maxW} w-[94vw] md:w-[90vw] h-[70vh] overflow-hidden rounded-xl border border-white/6 bg-surface shadow-2xl animate-in zoom-in-95 fade-in duration-150 flex flex-col`} style={{ boxShadow: "0 0 0 1px rgba(255,255,255,0.04), 0 24px 64px rgba(0,0,0,0.55)" }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 h-12 border-b border-white/6 shrink-0">
          <h2 className="text-[15px] font-semibold text-text-primary tracking-tight">{title}</h2>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-white/6 transition-colors text-text-muted hover:text-text-primary">
            <X className="w-4 h-4" />
          </button>
        </div>
        {/* Body */}
        <div className="flex-1 overflow-hidden min-h-0 flex flex-col">{children}</div>
        {/* Footer */}
        {footer && <div className="px-5 py-3 border-t border-white/6 flex justify-end gap-2 shrink-0">{footer}</div>}
      </div>
    </div>
  );
};

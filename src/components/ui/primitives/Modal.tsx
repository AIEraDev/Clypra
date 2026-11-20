import React, { useEffect } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { hideNativeSurfaceWhenIdle } from "@/core/runtime/nativeSurfaceLifecycle";

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Use "lg" for wide settings-style modals, "xl" for extra-wide content-heavy modals */
  size?: "default" | "lg" | "xl";
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = "default",
}) => {
  const { t } = useI18n();

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  // Ensure native GPU preview surface is hidden while any modal is open
  useEffect(() => {
    if (!isOpen) return;
    void hideNativeSurfaceWhenIdle().catch(() => undefined);
  }, [isOpen]);

  if (!isOpen) return null;

  const sizeClass =
    size === "xl"
      ? "w-[96vw] md:w-[92vw] max-w-[1100px] h-[92vh] max-h-[92vh]"
      : size === "lg"
        ? "w-[94vw] md:w-[90vw] max-w-[680px] h-[85vh] max-h-[85vh]"
        : "w-[94vw] md:w-[90vw] max-w-md max-h-[85vh] h-auto";

  return (
    <div className="fixed inset-0 z-10000 flex items-center justify-center p-2 sm:p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-[2px] animate-in fade-in duration-150"
        onClick={onClose}
      />
      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative ${sizeClass} overflow-hidden rounded-xl border border-border bg-surface shadow-2xl animate-in zoom-in-95 fade-in duration-150 flex flex-col`}
        style={{
          boxShadow:
            "0 0 0 1px rgba(255,255,255,0.04), 0 24px 64px rgba(0,0,0,0.55)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 h-12 border-b border-border shrink-0">
          <h2 className="text-[15px] font-semibold text-text-primary tracking-tight">
            {title}
          </h2>
          <button
            onClick={onClose}
            aria-label={t("common.actions.close")}
            title={t("common.actions.close")}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-surface-hover transition-colors text-text-muted hover:text-text-primary cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {/* Body */}
        <div className="overflow-hidden min-h-0 flex-1">{children}</div>
        {/* Footer */}
        {footer && (
          <div className="px-5 py-3 border-t border-border flex justify-end gap-2 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

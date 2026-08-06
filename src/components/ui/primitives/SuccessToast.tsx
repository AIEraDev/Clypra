/**
 * Toast Component
 * Animated toast notification with slide-up entry, progress bar, and dismiss support.
 */

import { useEffect, useRef, useState } from "react";

export type ToastVariant = "success" | "error" | "warning";

export interface SuccessToastProps {
  message: string | null;
  variant?: ToastVariant;
  onDismiss?: () => void;
  autoHideDuration?: number; // ms, 0 to disable auto-hide
}

const variantConfig: Record<ToastVariant, { label: string; iconPath: string; accentVar: string; iconColor: string; glowClass: string; barClass: string; bgClass: string; borderClass: string }> = {
  success: {
    label: "Success",
    iconPath: "M2.5 7.5L5.5 10.5L11.5 4",
    accentVar: "var(--color-accent-soft)",
    iconColor: "text-accent-soft",
    glowClass: "bg-accent opacity-10",
    barClass: "bg-accent",
    bgClass: "bg-accent/15",
    borderClass: "border-accent/25",
  },
  error: {
    label: "Error",
    iconPath: "M2 2L12 12M12 2L2 12",
    accentVar: "#ef4444",
    iconColor: "text-red-400",
    glowClass: "bg-red-500 opacity-10",
    barClass: "bg-red-500",
    bgClass: "bg-red-500/15",
    borderClass: "border-red-500/25",
  },
  warning: {
    label: "Warning",
    iconPath: "M7 2L1 12H13L7 2ZM7 5V8M7 10V10.5",
    accentVar: "#f59e0b",
    iconColor: "text-amber-400",
    glowClass: "bg-amber-500 opacity-10",
    barClass: "bg-amber-500",
    bgClass: "bg-amber-500/15",
    borderClass: "border-amber-500/25",
  },
};

export function SuccessToast({ message, variant = "success", onDismiss, autoHideDuration = 3000 }: SuccessToastProps) {
  // "hidden" → "entering" → "visible" → "leaving"
  const [phase, setPhase] = useState<"hidden" | "entering" | "visible" | "leaving">("hidden");
  const [progress, setProgress] = useState(100);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressRafRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);

  const clearTimers = () => {
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    if (progressRafRef.current) cancelAnimationFrame(progressRafRef.current);
  };

  const startDismiss = () => {
    setPhase("leaving");
    dismissTimerRef.current = setTimeout(() => {
      setPhase("hidden");
      onDismiss?.();
    }, 350);
  };

  useEffect(() => {
    if (!message) {
      clearTimers();
      setPhase("hidden");
      setProgress(100);
      return;
    }

    clearTimers();
    setProgress(100);
    setPhase("entering");

    const enterTimer = setTimeout(() => setPhase("visible"), 10);

    if (autoHideDuration > 0) {
      startTimeRef.current = performance.now();

      const tick = (now: number) => {
        const elapsed = now - startTimeRef.current;
        const remaining = Math.max(0, 1 - elapsed / autoHideDuration);
        setProgress(remaining * 100);
        if (remaining > 0) {
          progressRafRef.current = requestAnimationFrame(tick);
        }
      };
      progressRafRef.current = requestAnimationFrame(tick);

      dismissTimerRef.current = setTimeout(startDismiss, autoHideDuration);
    }

    return () => {
      clearTimeout(enterTimer);
      clearTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message, autoHideDuration]);

  if (phase === "hidden") return null;

  const isEntering = phase === "entering";
  const isLeaving = phase === "leaving";
  const cfg = variantConfig[variant];

  return (
    <div
      role="alert"
      aria-live="polite"
      aria-atomic="true"
      style={{
        transform: isEntering || isLeaving ? "translateY(16px) scale(0.97)" : "translateY(0) scale(1)",
        opacity: isEntering || isLeaving ? 0 : 1,
        transition: "transform 350ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 300ms ease",
        zIndex: 1000,
      }}
      className="fixed bottom-5 right-5 z-50 w-80 overflow-hidden rounded-xl elev-soft"
    >
      {/* Card */}
      <div className="relative flex items-start gap-3 px-4 pt-4 pb-3 bg-surface-floating border border-border-soft">
        {/* Accent glow blob */}
        <div className={`pointer-events-none absolute -top-6 -left-6 h-24 w-24 rounded-full ${cfg.glowClass} blur-2xl`} aria-hidden="true" />

        {/* Icon */}
        <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${cfg.bgClass} border ${cfg.borderClass}`}>
          <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d={cfg.iconPath} stroke={cfg.accentVar} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <p className={`text-label ${cfg.iconColor}`}>{cfg.label}</p>
          <p className="mt-0.5 text-sm leading-snug text-text-primary">{message}</p>
        </div>

        {/* Dismiss button */}
        <button onClick={startDismiss} aria-label="Dismiss" className="shrink-0 ml-1 rounded-md p-1 text-text-muted hover:text-text-primary transition-colors">
          <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M2 2L12 12M12 2L2 12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Progress bar */}
      {autoHideDuration > 0 && (
        <div className="h-[2px] w-full bg-accent/10">
          <div
            className={`h-full ${cfg.barClass}`}
            style={{
              width: `${progress}%`,
              boxShadow: "0 0 6px var(--color-accent, #6c63ff)",
              transition: "width 100ms linear",
            }}
          />
        </div>
      )}
    </div>
  );
}

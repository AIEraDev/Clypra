/**
 * Error Toast Component for Timeline Engine v1
 * Displays user-friendly error messages
 */

import { useEffect, useState } from "react";
import { TimelineError } from "../../features/timeline/types/errors";

export interface ErrorToastProps {
  error: Error | TimelineError | string | null;
  onDismiss?: () => void;
  autoHideDuration?: number; // milliseconds, 0 to disable auto-hide
}

/**
 * Displays error messages with appropriate styling and auto-dismiss
 */
export function ErrorToast({ error, onDismiss, autoHideDuration = 5000 }: ErrorToastProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (error) {
      setVisible(true);

      // Auto-hide after duration if enabled
      if (autoHideDuration > 0) {
        const timer = setTimeout(() => {
          setVisible(false);
          if (onDismiss) {
            setTimeout(onDismiss, 300); // Wait for fade-out animation
          }
        }, autoHideDuration);

        return () => clearTimeout(timer);
      }
    } else {
      setVisible(false);
    }
  }, [error, autoHideDuration, onDismiss]);

  if (!error) return null;

  const handleDismiss = () => {
    setVisible(false);
    if (onDismiss) {
      setTimeout(onDismiss, 300); // Wait for fade-out animation
    }
  };

  // Extract error message and determine if recoverable
  let message: string;
  let isRecoverable = true;

  if (error instanceof TimelineError) {
    message = error.message;
    isRecoverable = error.recoverable;
  } else if (error instanceof Error) {
    message = error.message;
  } else {
    message = String(error);
  }

  return (
    <div
      className={`fixed bottom-4 right-4 z-50 max-w-md rounded-lg shadow-lg transition-all duration-300 ${visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0 pointer-events-none"}`}
      style={{
        background: isRecoverable ? "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)" : "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)",
      }}
      role="alert"
      aria-live="assertive"
    >
      <div className="flex items-start gap-3 p-4">
        {/* Icon */}
        <div className="shrink-0 mt-0.5">
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>

        {/* Message */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white">{isRecoverable ? "Warning" : "Error"}</p>
          <p className="mt-1 text-sm text-white/90">{message}</p>
        </div>

        {/* Dismiss button */}
        <button onClick={handleDismiss} className="shrink-0 ml-2 text-white/80 hover:text-white transition-colors" aria-label="Dismiss error">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

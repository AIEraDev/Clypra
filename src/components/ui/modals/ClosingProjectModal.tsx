import { useEffect, useState } from "react";

interface ClosingProjectModalProps {
  isOpen: boolean;
  projectName: string;
  onComplete?: () => void;
}

interface CloseStep {
  id: string;
  label: string;
  status: "pending" | "in-progress" | "completed" | "error";
  error?: string;
}

export const ClosingProjectModal: React.FC<ClosingProjectModalProps> = ({ isOpen, projectName, onComplete }) => {
  const [steps, setSteps] = useState<CloseStep[]>([
    { id: "save", label: "Saving project", status: "pending" },
    { id: "session", label: "Stopping preview", status: "pending" },
    { id: "cleanup", label: "Cleaning up resources", status: "pending" },
    { id: "reset", label: "Resetting state", status: "pending" },
  ]);

  const [currentStepIndex, setCurrentStepIndex] = useState(-1);

  useEffect(() => {
    if (!isOpen) {
      setSteps((prev) => prev.map((s) => ({ ...s, status: "pending", error: undefined })));
      setCurrentStepIndex(-1);
    }
  }, [isOpen]);

  // External control: parent can update step status by calling exposed functions
  const updateStepStatus = (stepId: string, status: CloseStep["status"], error?: string) => {
    setSteps((prev) => {
      const updated = prev.map((s) => (s.id === stepId ? { ...s, status, error } : s));

      // Check completion with the UPDATED array, not stale closure
      const allCompleted = updated.every((s) => s.status === "completed");
      if (allCompleted && onComplete) {
        // Don't call onComplete here - parent handles modal close timing
      }

      return updated;
    });

    if (status === "in-progress") {
      setSteps((prev) => {
        const index = prev.findIndex((s) => s.id === stepId);
        setCurrentStepIndex(index);
        return prev;
      });
    }
  };

  // Expose update function via window for external control
  useEffect(() => {
    if (isOpen) {
      (window as any).__updateClosingStep = updateStepStatus;
    }
    return () => {
      delete (window as any).__updateClosingStep;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const hasError = steps.some((s) => s.status === "error");
  const allCompleted = steps.every((s) => s.status === "completed");

  return (
    <div className="fixed inset-0 z-9999 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-bg border border-border rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
        {/* Icon */}
        <div className="flex items-center justify-center w-14 h-14 rounded-full bg-accent/10 border border-accent/30 mb-5 mx-auto">
          {hasError ? (
            <svg className="w-7 h-7 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          ) : allCompleted ? (
            <svg className="w-7 h-7 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-7 h-7 text-accent animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
            </svg>
          )}
        </div>

        <h2 className="text-xl font-bold text-text-primary text-center mb-2">{hasError ? "Error Closing Project" : allCompleted ? "Project Closed" : "Closing Project"}</h2>

        <p className="text-sm text-text-muted text-center mb-6">
          {hasError ? (
            "Some cleanup steps failed. Please check the console for details."
          ) : allCompleted ? (
            <>Returning to home...</>
          ) : (
            <>
              Saving <span className="font-semibold text-text-primary">"{projectName}"</span> and cleaning up...
            </>
          )}
        </p>

        {/* Step list */}
        <div className="space-y-3 mb-6">
          {steps.map((step, index) => (
            <div key={step.id} className="flex items-center gap-3">
              {/* Status icon */}
              <div className="shrink-0 w-5 h-5">
                {step.status === "completed" ? (
                  <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : step.status === "error" ? (
                  <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : step.status === "in-progress" ? (
                  <svg className="w-5 h-5 text-accent animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                  </svg>
                ) : (
                  <div className="w-5 h-5 rounded-full border-2 border-border" />
                )}
              </div>

              {/* Step label */}
              <div className="flex-1">
                <p className={`text-sm font-medium ${step.status === "error" ? "text-red-500" : step.status === "completed" ? "text-green-500" : step.status === "in-progress" ? "text-accent" : "text-text-muted"}`}>{step.label}</p>
                {step.error && <p className="text-xs text-red-400 mt-0.5">{step.error}</p>}
              </div>
            </div>
          ))}
        </div>

        {/* Error actions */}
        {hasError && (
          <div className="flex gap-3">
            <button
              onClick={() => {
                // Force close anyway
                if (onComplete) onComplete();
              }}
              className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-lg bg-accent text-white hover:bg-accent-soft transition-colors"
            >
              Force Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

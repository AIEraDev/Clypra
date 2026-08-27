import React, { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

interface UnsavedChangesDialogProps {
  isOpen: boolean;
  projectName: string;
  isSaving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export const UnsavedChangesDialog: React.FC<UnsavedChangesDialogProps> = ({
  isOpen,
  projectName,
  isSaving,
  onSave,
  onDiscard,
  onCancel,
}) => {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isSaving) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        event.stopPropagation();
        onSave();
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [isOpen, isSaving, onCancel, onSave]);

  if (!isOpen) return null;

  return (
    <div
      id="unsaved-changes-dialog-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unsaved-changes-title"
      className="fixed inset-0 z-9999 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      <div className="bg-bg border border-border rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
        {/* Icon */}
        <div className="flex items-center justify-center w-14 h-14 rounded-full bg-amber-500/10 border border-amber-500/30 mb-5 mx-auto text-amber-500">
          <AlertTriangle className="w-7 h-7" />
        </div>

        <h2 id="unsaved-changes-title" className="text-xl font-bold text-text-primary text-center mb-2">
          Save changes before closing?
        </h2>

        <p className="text-sm text-text-muted text-center mb-2">
          Project <span className="font-semibold text-text-primary">"{projectName || "Untitled"}"</span> has unsaved changes.
        </p>
        <p className="text-xs text-text-muted text-center mb-6">
          If you close without saving, your recent edits will be permanently lost.
        </p>

        <div className="flex flex-col sm:flex-row gap-2.5">
          <button
            id="unsaved-changes-cancel-btn"
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            className="flex-1 px-4 py-2.5 text-sm font-medium rounded-lg border border-border text-text-muted hover:text-text-primary hover:border-border-strong transition-colors disabled:opacity-50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            id="unsaved-changes-discard-btn"
            type="button"
            onClick={onDiscard}
            disabled={isSaving}
            className="flex-1 px-4 py-2.5 text-sm font-medium rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors disabled:opacity-50 cursor-pointer"
          >
            Don't Save
          </button>
          <button
            id="unsaved-changes-save-btn"
            type="button"
            onClick={onSave}
            disabled={isSaving}
            className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-lg bg-accent text-white hover:bg-accent-soft transition-colors disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer shadow-sm"
          >
            {isSaving ? (
              <>
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                </svg>
                Saving…
              </>
            ) : (
              "Save"
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

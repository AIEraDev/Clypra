import type { RecoverySnapshot } from "@/core/runtime/CrashRecoveryService";
import { t } from "@/i18n";

interface CrashRecoveryDialogProps {
  isOpen: boolean;
  snapshot: RecoverySnapshot | null;
  isRestoring: boolean;
  onRestore: () => void;
  onDiscard: () => void;
}

export const CrashRecoveryDialog: React.FC<CrashRecoveryDialogProps> = ({ isOpen, snapshot, isRestoring, onRestore, onDiscard }) => {
  if (!isOpen || !snapshot) return null;

  const savedAt = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(snapshot.savedAt));

  return (
    <div id="crash-recovery-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="crash-recovery-title" className="fixed inset-0 z-9999 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-bg border border-border rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
        {/* Icon */}
        <div className="flex items-center justify-center w-14 h-14 rounded-full bg-accent/10 border border-accent/30 mb-5 mx-auto">
          <svg className="w-7 h-7 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        </div>

        <h2 id="crash-recovery-title" className="text-xl font-bold text-text-primary text-center mb-2">
          {t("recovery.title")}
        </h2>

        <p className="text-sm text-text-muted text-center mb-1">
          {t("recovery.unsavedDetected", { project: snapshot.project.name })}
        </p>
        <p className="text-xs text-text-muted text-center mb-6">
          {t("recovery.lastSaved", { date: savedAt })}
        </p>

        <div className="flex gap-3">
          <button id="crash-recovery-discard-btn" onClick={onDiscard} disabled={isRestoring} className="flex-1 px-4 py-2.5 text-sm font-medium rounded-lg border border-border text-text-muted hover:text-text-primary hover:border-border-strong transition-colors disabled:opacity-50">
            {t("recovery.discard")}
          </button>
          <button id="crash-recovery-restore-btn" onClick={onRestore} disabled={isRestoring} className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-lg bg-accent text-white hover:bg-accent-soft transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {isRestoring ? (
              <>
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                </svg>
                {t("recovery.restoring")}
              </>
            ) : (
              t("recovery.restoreProject", { project: snapshot.project.name })
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

import React from "react";
import { AlertTriangle, Check, LoaderCircle } from "lucide-react";
import { useProjectStore, type ProjectInitializationPhase } from "@/store/projectStore";

const phases: Array<{ id: ProjectInitializationPhase; label: string }> = [
  { id: "preparing", label: "Prepare project" },
  { id: "loading-assets", label: "Load project assets" },
  { id: "hydrating-timeline", label: "Build timeline" },
  { id: "warming-text", label: "Prepare text and fonts" },
  { id: "starting-preview", label: "Start preview runtime" },
];

const phaseIndex = (phase: ProjectInitializationPhase): number => {
  if (phase === "error") return -1;
  return phases.findIndex((item) => item.id === phase);
};

export const ProjectLoadingModal: React.FC = () => {
  const initialization = useProjectStore((state) => state.projectInitialization);
  const clearProjectInitialization = useProjectStore((state) => state.clearProjectInitialization);

  if (!initialization) return null;

  const hasError = initialization.phase === "error";
  const currentIndex = phaseIndex(initialization.phase);

  return (
    <div
      className="fixed inset-0 z-10000 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      role={hasError ? "alertdialog" : "dialog"}
      aria-modal="true"
      aria-busy={!hasError}
    >
      <div className="w-[min(92vw,440px)] rounded-2xl border border-border bg-bg p-7 shadow-2xl">
        <div className="mb-5 flex items-center gap-4">
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border ${hasError ? "border-red-500/30 bg-red-500/10" : "border-accent/30 bg-accent/10"}`}>
            {hasError ? <AlertTriangle className="h-6 w-6 text-red-400" /> : <LoaderCircle className="h-6 w-6 animate-spin text-accent" />}
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-text-primary">{hasError ? "Project failed to open" : "Preparing project"}</h2>
            <p className="truncate text-sm text-text-muted">{initialization.projectName}</p>
          </div>
        </div>

        <p className="mb-4 text-sm text-text-muted">{hasError ? initialization.error : initialization.message}</p>

        <div className="mb-6 h-1.5 overflow-hidden rounded-full bg-surface">
          <div
            className={`h-full rounded-full transition-[width] duration-300 ${hasError ? "bg-red-400" : "bg-accent"}`}
            style={{ width: `${Math.max(4, initialization.progress)}%` }}
          />
        </div>

        <div className="space-y-2.5" aria-label="Project initialization steps">
          {phases.map((item, index) => {
            const complete = !hasError && currentIndex > index;
            const active = !hasError && currentIndex === index;
            return (
              <div key={item.id} className="flex items-center gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                  {complete ? <Check className="h-4 w-4 text-green-400" /> : active ? <LoaderCircle className="h-4 w-4 animate-spin text-accent" /> : <span className="h-2 w-2 rounded-full bg-border" />}
                </span>
                <span className={`text-sm ${complete ? "text-green-400" : active ? "font-medium text-accent" : "text-text-muted"}`}>{item.label}</span>
              </div>
            );
          })}
        </div>

        {hasError && (
          <button onClick={clearProjectInitialization} className="mt-6 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-soft">
            Dismiss
          </button>
        )}
        {!hasError && <p className="mt-6 text-center text-xs text-text-muted">Editing is locked until the preview session is ready.</p>}
      </div>
    </div>
  );
};

import React, { useMemo } from "react";
import { X } from "lucide-react";
import { useMediaJobStore } from "@/store/mediaJobStore";

export const MediaJobIndicator: React.FC = () => {
  const jobsById = useMediaJobStore((state) => state.jobs);
  const jobs = useMemo(() => Object.values(jobsById).filter((job) => job.state === "queued" || job.state === "running"), [jobsById]);
  const cancel = useMediaJobStore((state) => state.cancel);
  if (jobs.length === 0) return null;
  return (
    <div className="pointer-events-auto fixed bottom-4 right-4 z-50 min-w-[220px] rounded-md border border-border bg-surface-raised/95 p-3 shadow-xl backdrop-blur">
      {jobs.map((job) => (
        <div key={job.id} className="flex items-center gap-2 text-xs text-foreground">
          <div className="min-w-0 flex-1">
            <div className="truncate">Extracting audio · {Math.round(job.progress * 100)}%</div>
            <div className="mt-1 h-1 overflow-hidden rounded bg-border"><div className="h-full bg-accent transition-[width]" style={{ width: `${Math.max(2, job.progress * 100)}%` }} /></div>
          </div>
          <button type="button" aria-label="Cancel audio extraction" className="rounded p-1 text-muted-foreground hover:bg-destructive/15 hover:text-destructive" onClick={() => void cancel(job.id)}><X size={14} /></button>
        </div>
      ))}
    </div>
  );
};

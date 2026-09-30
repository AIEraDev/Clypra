import React, { useEffect, useState } from "react";
import { Activity, Check, Copy, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  getNativePreviewPerformanceReport,
  isTauriRuntime,
} from "@/lib/platform/tauri";
import { toast } from "@/lib/toast";
import { useProjectStore } from "@/store/projectStore";
import { useTimelineStore } from "@/store/timelineStore";
import {
  usePlaybackStatus,
  useTransportControls,
} from "@/hooks/usePlaybackClock";
import {
  PREVIEW_PERFORMANCE_BUDGETS,
  previewQualificationController,
  startPreviewQualificationFromDiagnostics,
  type PreviewQualificationState,
} from "@/core/playback/previewPerformanceContract";

/** Desktop-only diagnostics action; this is intentionally not an editor telemetry HUD. */
export const PreviewDiagnosticsTab: React.FC = () => {
  const project = useProjectStore((state) => state.project);
  const epoch = useTimelineStore((state) => state.epoch);
  const { play, pause } = useTransportControls();
  const { isPlaying } = usePlaybackStatus();
  const [state, setState] = useState<PreviewQualificationState>(
    previewQualificationController.getState(),
  );
  const [startedFromPause, setStartedFromPause] = useState(false);
  const [copyingReport, setCopyingReport] = useState(false);
  const [reportCopied, setReportCopied] = useState(false);

  useEffect(() => previewQualificationController.subscribe(setState), []);

  const start = () => {
    if (!project?.id || !isTauriRuntime()) return;
    const wasPlaying = isPlaying;
    if (!wasPlaying) {
      play();
      setStartedFromPause(true);
    }
    const projectId = project.id;
    const projectEpoch = epoch;
    startPreviewQualificationFromDiagnostics({
      isSnapshotValid: () => {
        return (
          useProjectStore.getState().project?.id === projectId &&
          useTimelineStore.getState().epoch === projectEpoch
        );
      },
      onComplete: () => {
        if (!wasPlaying) pause();
      },
    });
  };

  const cancel = () => {
    previewQualificationController.cancel();
    if (startedFromPause) {
      pause();
      setStartedFromPause(false);
    }
  };

  const copyPerformanceReport = async () => {
    if (!isTauriRuntime() || copyingReport) return;
    setCopyingReport(true);
    try {
      const report = await getNativePreviewPerformanceReport();
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      setReportCopied(true);
      window.setTimeout(() => setReportCopied(false), 2_000);
      toast.success("Performance report copied");
    } catch (error) {
      console.warn(
        "[PreviewDiagnostics] Failed to copy performance report",
        error,
      );
      toast.error("Could not copy the performance report");
    } finally {
      setCopyingReport(false);
    }
  };

  const running = state.status === "running";
  const pathLabel =
    state.path === "native"
      ? "Native"
      : state.path === "webview"
        ? "WebView"
        : "—";

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-text-primary">
          Preview diagnostics
        </h2>
        <p className="mt-1 max-w-lg text-xs leading-relaxed text-text-muted">
          Run the same timeline through Native and WebView for{" "}
          {PREVIEW_PERFORMANCE_BUDGETS.qualificationDurationMs / 1000}s per
          path. Results are sent automatically to the API and reviewed in Studio
          Admin.
        </p>
      </div>
      <div className="rounded-lg border border-white/8 bg-white/2 p-3 text-xs text-text-muted">
        <div className="flex items-center gap-2 text-text-primary">
          <Activity className="h-4 w-4 text-accent" />
          <span>
            Status: {running ? `Running ${pathLabel} pass` : state.status}
          </span>
        </div>
        <p className="mt-2">
          No localStorage flag, permission prompt, or console command is used.
        </p>
      </div>
      <div className="flex gap-2">
        <Button
          onClick={start}
          className="cursor-pointer"
          disabled={!isTauriRuntime() || !project?.id || running}
        >
          <Play className="mr-2 h-4 w-4" />
          Run 30-second qualification
        </Button>
        <Button
          variant="secondary"
          className="cursor-pointer"
          onClick={cancel}
          disabled={!running}
        >
          <Square className="mr-2 h-4 w-4" />
          Cancel
        </Button>
      </div>
      <div>
        <Button
          variant="secondary"
          onClick={() => void copyPerformanceReport()}
          disabled={!isTauriRuntime() || copyingReport}
          className="cursor-pointer"
        >
          {reportCopied ? (
            <Check className="mr-2 h-4 w-4" />
          ) : (
            <Copy className="mr-2 h-4 w-4" />
          )}
          {copyingReport
            ? "Preparing report…"
            : reportCopied
              ? "Copied"
              : "Copy performance report"}
        </Button>
      </div>
      <p className="text-xs text-text-muted">
        The copied report contains local runtime and aggregate preview metrics.
        It does not send data automatically or include project/media paths.
      </p>
      {!isTauriRuntime() && (
        <p className="text-xs text-text-muted">
          Preview qualification is available in the Tauri desktop app only.
        </p>
      )}
    </section>
  );
};

import React, { useEffect, useState } from "react";
import { Activity, Check, Copy, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  getNativePreviewPerformanceReport,
  isTauriRuntime,
  renderNativePreviewTransportProbe,
  streamNativePlaybackFrames,
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
import { nativePerfCollector } from "@/core/playback/nativePerfTelemetry";

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
  const [runningTransportProbe, setRunningTransportProbe] = useState(false);
  const [transportProbeResult, setTransportProbeResult] = useState<string | null>(null);
  const [runningPushGate, setRunningPushGate] = useState(false);
  const [pushGateResult, setPushGateResult] = useState<string | null>(null);

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
      const nativeReport = await getNativePreviewPerformanceReport();
      const report = {
        ...nativeReport,
        // Native samples explain decode/composition/readback; this bounded
        // local summary completes the trace with the WebView-side boundary.
        frontend: {
          units: "milliseconds",
          modeStats: nativePerfCollector.allStats(),
        },
      };
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

  const runTransportProbe = async () => {
    if (!isTauriRuntime() || runningTransportProbe) return;
    setRunningTransportProbe(true);
    setTransportProbeResult(null);
    try {
      const samples: number[] = [];
      // The default payload is deliberately comparable with the 480px RGBA
      // fallback (~518 KB), and no preview/GPU work occurs inside this loop.
      for (let index = 0; index < 20; index += 1) {
        const startedAt = performance.now();
        const bytes = await renderNativePreviewTransportProbe();
        if (bytes.byteLength !== 518 * 1024) {
          throw new Error(`Unexpected probe payload: ${bytes.byteLength} bytes`);
        }
        samples.push(performance.now() - startedAt);
      }
      samples.sort((left, right) => left - right);
      const percentile = (fraction: number) =>
        samples[Math.round((samples.length - 1) * fraction)] ?? 0;
      setTransportProbeResult(
        `518 KB bridge-only: p50 ${percentile(0.5).toFixed(1)} ms · p95 ${percentile(0.95).toFixed(1)} ms (20 runs)`,
      );
    } catch (error) {
      console.warn("[PreviewDiagnostics] Transport probe failed", error);
      setTransportProbeResult("Bridge-only probe failed; see diagnostics log.");
    } finally {
      setRunningTransportProbe(false);
    }
  };

  const runPushTransportGate = async () => {
    if (!isTauriRuntime() || runningPushGate) return;
    setRunningPushGate(true);
    setPushGateResult(null);
    try {
      const samples: number[] = [];
      const expectedBytes = 52 + 480 * 270 * 4;
      const received = new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(
          () => reject(new Error("Push Channel delivered fewer than 20 frames within 5 seconds")),
          5_000,
        );
        let receivedFrames = 0;
        void streamNativePlaybackFrames(1n, (packet) => {
          try {
            if (packet.byteLength !== expectedBytes) {
              throw new Error(`Unexpected push packet: ${packet.byteLength} bytes`);
            }
            const view = new DataView(packet);
            if (view.getUint32(0, true) !== 0x4350_4652 || view.getUint16(4, true) !== 1) {
              throw new Error("Unsupported push-bridge packet header");
            }
            const headerBytes = view.getUint16(6, true);
            const t8EpochUs = Number(view.getBigUint64(32, true));
            const width = view.getUint32(40, true);
            const height = view.getUint32(44, true);
            const stride = view.getUint32(48, true);
            if (headerBytes !== 52 || width !== 480 || height !== 270 || stride !== 1920) {
              throw new Error("Unexpected push-bridge frame layout");
            }
            // t8 is epoch-based so it can cross the Rust/JS monotonic-clock
            // boundary. This is intentionally t8 → t9 only; canvas painting
            // and watermark flow control belong to Phase 2b.
            const t9EpochUs = Math.round((performance.timeOrigin + performance.now()) * 1_000);
            samples.push(Math.max(0, (t9EpochUs - t8EpochUs) / 1_000));
            receivedFrames += 1;
            if (receivedFrames === 20) {
              window.clearTimeout(timeout);
              resolve();
            }
          } catch (error) {
            window.clearTimeout(timeout);
            reject(error);
          }
        }).catch((error) => {
          window.clearTimeout(timeout);
          reject(error);
        });
      });
      await received;
      samples.sort((left, right) => left - right);
      const percentile = (fraction: number) =>
        samples[Math.round((samples.length - 1) * fraction)] ?? 0;
      const p50 = percentile(0.5);
      const p95 = percentile(0.95);
      setPushGateResult(
        `Push Channel t8→t9, 518 KB: p50 ${p50.toFixed(1)} ms · p95 ${p95.toFixed(1)} ms (20 frames)${p95 >= 100 ? " — gate failed; do not enable push playback." : " — gate passed."}`,
      );
    } catch (error) {
      console.warn("[PreviewDiagnostics] Push transport gate failed", error);
      setPushGateResult("Push Channel gate failed; do not enable push playback. See diagnostics log.");
    } finally {
      setRunningPushGate(false);
    }
  };

  const running = state.status === "running";
  const pathLabel =
    state.path === "native"
      ? "Native surface"
    : state.path === "webview"
        ? "WebView bridge"
        : "—";

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-text-primary">
          Preview diagnostics
        </h2>
        <p className="mt-1 max-w-lg text-xs leading-relaxed text-text-muted">
          Run the embedded WebView preview for{" "}
          {PREVIEW_PERFORMANCE_BUDGETS.qualificationDurationMs / 1000}s. The
          report records its presenter mode and fallback reason, so it cannot
          be mistaken for a native-surface qualification.
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
      <div className="space-y-2">
        <Button
          variant="secondary"
          onClick={() => void runTransportProbe()}
          disabled={!isTauriRuntime() || runningTransportProbe}
          className="cursor-pointer"
        >
          {runningTransportProbe ? "Measuring bridge…" : "Run 518 KB bridge-only probe"}
        </Button>
        {transportProbeResult && (
          <p className="text-xs text-text-muted">{transportProbeResult}</p>
        )}
      </div>
      <div className="space-y-2">
        <Button
          variant="secondary"
          onClick={() => void runPushTransportGate()}
          disabled={!isTauriRuntime() || runningPushGate}
          className="cursor-pointer"
        >
          {runningPushGate ? "Measuring push Channel…" : "Run push-bridge transport gate"}
        </Button>
        {pushGateResult && (
          <p className="text-xs text-text-muted">{pushGateResult}</p>
        )}
      </div>
      <p className="text-xs text-text-muted">
        The copied report contains local native and WebView stage percentiles.
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

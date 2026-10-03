import React, { useEffect, useState } from "react";
import { Activity, Check, Copy, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  getNativePreviewPerformanceReport,
  getNativePushTransportCapabilities,
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
import { EditorFeatureTelemetry } from "@/services/editorFeatureTelemetry";
import { perfLogService, PerfLogService } from "@/services/perfLogService";
import { getTextMetricsSnapshot } from "@/lib/playback/textMetrics";
import { getSyncMetricsSnapshot } from "@/lib/playback/syncMetrics";

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
  const [pushCapabilities, setPushCapabilities] = useState<string | null>(null);
  const [telemetryOptIn, setTelemetryOptIn] = useState(() =>
    PerfLogService.isTelemetryUploadEnabledStatic(),
  );

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void getNativePushTransportCapabilities()
      .then((caps) => {
        const candidates = [
          caps.channel ? "Channel" : null,
          caps.customProtocolLongPoll ? "protocol long-poll" : null,
          caps.webview2SharedBuffer ? "WebView2 shared buffer" : null,
        ].filter(Boolean).join(", ");
        setPushCapabilities(`Transport candidates: ${candidates || "none"}${caps.webviewRuntime ? ` · WebView ${caps.webviewRuntime}` : ""}`);
      })
      .catch(() => setPushCapabilities("Transport candidate discovery failed."));
  }, []);

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
        text: getTextMetricsSnapshot(),
        sync: getSyncMetricsSnapshot(),
        // Native samples explain decode/composition/readback; this bounded
        // local summary completes the trace with the WebView-side boundary.
        frontend: {
          units: "milliseconds",
          modeStats: nativePerfCollector.allStats(),
          pushBridge: nativePerfCollector.pushBridgeStats(),
        },
      };
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      EditorFeatureTelemetry.recordPreviewBenchmarkReport(report);
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
      const run = async (label: string, payloadBytes: number, frameCount: number, paceMs: number) => {
        const receiveSamples: number[] = [];
        const paintSamples: number[] = [];
        const expectedBytes = 52 + payloadBytes;
        const rgbaBytes = 480 * 270 * 4;
        // The gate's t11 is deliberately a real canvas write followed by rAF,
        // rather than merely an rAF after receipt. It is still a diagnostic
        // canvas, so label it as a paint boundary rather than physical scanout.
        const canvas = payloadBytes === rgbaBytes ? document.createElement("canvas") : null;
        const context = canvas?.getContext("2d") ?? null;
        if (canvas) {
          canvas.width = 480;
          canvas.height = 270;
        }
        const startedAt = performance.now();
        await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(
          () => reject(new Error(`Push Channel ${label} timed out`)),
          Math.max(5_000, frameCount * Math.max(paceMs, 1) + 2_000),
        );
        let completedFrames = 0;
        const completeFrame = () => {
          completedFrames += 1;
          if (completedFrames === frameCount) {
            window.clearTimeout(timeout);
            resolve();
          }
        };
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
            // boundary. t9 is delivery to JS; t11 is a canvas paint plus rAF
            // boundary, recorded below for full RGBA-sized frames.
            const t9EpochUs = Math.round((performance.timeOrigin + performance.now()) * 1_000);
            receiveSamples.push(Math.max(0, (t9EpochUs - t8EpochUs) / 1_000));
            if (context && payloadBytes === rgbaBytes) {
              const pixels = new Uint8ClampedArray(packet, headerBytes, rgbaBytes);
              context.putImageData(new ImageData(pixels, width, height), 0, 0);
              requestAnimationFrame(() => {
                const t11EpochUs = Math.round((performance.timeOrigin + performance.now()) * 1_000);
                paintSamples.push(Math.max(0, (t11EpochUs - t8EpochUs) / 1_000));
                completeFrame();
              });
            } else {
              completeFrame();
            }
          } catch (error) {
            window.clearTimeout(timeout);
            reject(error);
          }
        }, { frameCount, payloadBytes, paceMs }).catch((error) => {
          window.clearTimeout(timeout);
          reject(error);
        });
        });
        receiveSamples.sort((left, right) => left - right);
        paintSamples.sort((left, right) => left - right);
        const percentile = (fraction: number) =>
          receiveSamples[Math.round((receiveSamples.length - 1) * fraction)] ?? 0;
        const paintPercentile = (fraction: number) =>
          paintSamples[Math.round((paintSamples.length - 1) * fraction)] ?? null;
        return {
          label,
          p50: percentile(0.5),
          p95: percentile(0.95),
          paintP50: paintPercentile(0.5),
          paintP95: paintPercentile(0.95),
          fps: (frameCount * 1_000) / Math.max(1, performance.now() - startedAt),
        };
      };
      // Same 20 fps cadence across sizes isolates a fixed per-message delay
      // from a size-scaled copy/serialization cost. The final burst measures
      // whether this candidate has enough sustained rate for Tier 1.
      // Run serially. Parallel diagnostic streams compete for the same
      // WebView Channel dispatcher and turn this into a queueing benchmark.
      const fullPaced = await run("518 KB paced", 480 * 270 * 4, 20, 50);
      const smallPaced = await run("1 KB paced", 1024, 20, 50);
      const fullBurst = await run("518 KB burst", 480 * 270 * 4, 60, 0);
      setPushGateResult(
        `${fullPaced.label} t8→t9 p50/p95 ${fullPaced.p50.toFixed(1)}/${fullPaced.p95.toFixed(1)} ms; t8→t11 canvas+rAF ${fullPaced.paintP50?.toFixed(1) ?? "—"}/${fullPaced.paintP95?.toFixed(1) ?? "—"} ms; ${smallPaced.label} ${smallPaced.p50.toFixed(1)}/${smallPaced.p95.toFixed(1)} ms; ${fullBurst.label} ${fullBurst.fps.toFixed(1)} FPS. ${fullPaced.p95 < 100 && fullBurst.fps >= 20 ? "Gate passed." : "Gate failed; do not enable push playback."}`,
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
        {pushCapabilities && (
          <p className="text-xs text-text-muted">{pushCapabilities}</p>
        )}
      </div>
      <p className="text-xs text-text-muted">
        The copied report contains local native and WebView stage percentiles.
        Performance reports are uploaded to Clypra servers when a session closes,
        only if telemetry upload is enabled in Settings. Reports do not include
        project paths or media file names.
      </p>
      <div className="pt-2 border-t border-border/40 space-y-2">
        <label className="flex items-center gap-2 text-xs text-text-primary cursor-pointer select-none">
          <input
            type="checkbox"
            checked={telemetryOptIn}
            onChange={(e) => {
              const enabled = e.target.checked;
              setTelemetryOptIn(enabled);
              PerfLogService.setTelemetryUploadEnabled(enabled);
            }}
            className="rounded border-border bg-surface text-primary focus:ring-1 focus:ring-primary"
          />
          <span>Share anonymous performance diagnostics with Clypra (off by default)</span>
        </label>
        {perfLogService.getSessionId() && (
          <p className="text-[11px] text-text-muted font-mono">
            Session ID: {perfLogService.getSessionId()}
          </p>
        )}
      </div>
      {!isTauriRuntime() && (
        <p className="text-xs text-text-muted">
          Preview qualification is available in the Tauri desktop app only.
        </p>
      )}
    </section>
  );
};

import React, { useEffect, useState, useCallback } from "react";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Gauge,
  Layers,
  Loader2,
  Play,
  Square,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  getNativePushTransportCapabilities,
  getNativeSessionTelemetry,
  isTauriRuntime,
  renderNativePreviewTransportProbe,
  streamNativePlaybackFrames,
  type NativeSessionSnapshot,
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

export interface TransportProbeResult {
  runs: number;
  payloadBytes: number;
  p50Ms: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
  samplesMs: number[];
  success: boolean;
  error?: string;
  compiledAtEpochMs: number;
}

export interface PushGateResult {
  passed: boolean;
  capabilities: string | null;
  fullPaced: {
    label: string;
    payloadBytes: number;
    frameCount: number;
    p50ReceiveMs: number;
    p95ReceiveMs: number;
    p50PaintMs: number | null;
    p95PaintMs: number | null;
    fps: number;
  };
  smallPaced: {
    label: string;
    payloadBytes: number;
    frameCount: number;
    p50ReceiveMs: number;
    p95ReceiveMs: number;
    fps: number;
  };
  fullBurst: {
    label: string;
    payloadBytes: number;
    frameCount: number;
    fps: number;
  };
  success: boolean;
  error?: string;
  compiledAtEpochMs: number;
}

export interface QualificationResult {
  runId: string;
  durationMs: number;
  path: string;
  status: string;
  framesProduced: number;
  framesDropped: number;
  dropRatePct: number;
  renderedFps: number | null;
  uniqueFramesPaintedFps: number | null;
  passed: boolean;
  compiledAtEpochMs: number;
}

/**
 * Desktop Diagnostics Tab.
 * Redesigned to exclusively support "Run" actions. All benchmark outputs are
 * compiled automatically into the session API data telemetry (NDJSON log stream)
 * for unified fleet and local analysis — eliminating manual copy-pasting.
 */
export const PreviewDiagnosticsTab: React.FC = () => {
  const project = useProjectStore((state) => state.project);
  const epoch = useTimelineStore((state) => state.epoch);
  const { play, pause } = useTransportControls();
  const { isPlaying } = usePlaybackStatus();

  const [state, setState] = useState<PreviewQualificationState>(
    previewQualificationController.getState(),
  );
  const [startedFromPause, setStartedFromPause] = useState(false);

  // Diagnostic Results (Structured & Compiled into Session Telemetry)
  const [transportProbeResult, setTransportProbeResult] =
    useState<TransportProbeResult | null>(null);
  const [runningTransportProbe, setRunningTransportProbe] = useState(false);

  const [pushGateResult, setPushGateResult] = useState<PushGateResult | null>(null);
  const [runningPushGate, setRunningPushGate] = useState(false);
  const [pushCapabilities, setPushCapabilities] = useState<string | null>(null);

  const [qualificationResult, setQualificationResult] =
    useState<QualificationResult | null>(null);

  // Complete Suite State
  const [runningSuite, setRunningSuite] = useState(false);
  const [suiteStep, setSuiteStep] = useState<string | null>(null);
  const [suiteCompletedAt, setSuiteCompletedAt] = useState<number | null>(null);

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
        ]
          .filter(Boolean)
          .join(", ");
        setPushCapabilities(
          `Transport candidates: ${candidates || "none"}${caps.webviewRuntime ? ` · WebView ${caps.webviewRuntime}` : ""}`,
        );
      })
      .catch(() => setPushCapabilities("Transport candidate discovery failed."));
  }, []);

  useEffect(() => previewQualificationController.subscribe(setState), []);

  const anyRunning =
    runningSuite ||
    runningTransportProbe ||
    runningPushGate ||
    state.status === "running";

  // ── 1. 518 KB Bridge-Only Probe ──────────────────────────────────────────
  const runTransportProbe = useCallback(
    async (): Promise<TransportProbeResult | null> => {
      if (!isTauriRuntime() || runningTransportProbe) return null;
      setRunningTransportProbe(true);
      try {
        const samples: number[] = [];
        const count = 20;
        const expectedBytes = 518 * 1024;
        for (let index = 0; index < count; index += 1) {
          const startedAt = performance.now();
          const bytes = await renderNativePreviewTransportProbe();
          if (bytes.byteLength !== expectedBytes) {
            throw new Error(`Unexpected probe payload: ${bytes.byteLength} bytes`);
          }
          samples.push(performance.now() - startedAt);
        }
        const sorted = [...samples].sort((a, b) => a - b);
        const percentile = (fraction: number) =>
          sorted[Math.round((sorted.length - 1) * fraction)] ?? 0;
        const p50 = percentile(0.5);
        const p95 = percentile(0.95);
        const min = sorted[0] ?? 0;
        const max = sorted[sorted.length - 1] ?? 0;
        const sum = samples.reduce((acc, v) => acc + v, 0);
        const avg = sum / samples.length;

        const result: TransportProbeResult = {
          runs: count,
          payloadBytes: expectedBytes,
          p50Ms: Number(p50.toFixed(2)),
          p95Ms: Number(p95.toFixed(2)),
          minMs: Number(min.toFixed(2)),
          maxMs: Number(max.toFixed(2)),
          avgMs: Number(avg.toFixed(2)),
          samplesMs: samples.map((s) => Number(s.toFixed(2))),
          success: true,
          compiledAtEpochMs: Date.now(),
        };

        EditorFeatureTelemetry.recordDiagnosticRun(
          "bridge-probe-518kb",
          result as unknown as Record<string, unknown>,
        );
        await EditorFeatureTelemetry.compileAndRecordSessionReport({
          bridgeProbe: result,
        });

        setTransportProbeResult(result);
        toast.success("518 KB bridge probe compiled into session telemetry");
        return result;
      } catch (error) {
        console.warn("[PreviewDiagnostics] Transport probe failed", error);
        const errResult: TransportProbeResult = {
          runs: 0,
          payloadBytes: 518 * 1024,
          p50Ms: 0,
          p95Ms: 0,
          minMs: 0,
          maxMs: 0,
          avgMs: 0,
          samplesMs: [],
          success: false,
          error: error instanceof Error ? error.message : String(error),
          compiledAtEpochMs: Date.now(),
        };
        EditorFeatureTelemetry.recordDiagnosticRun(
          "bridge-probe-518kb",
          errResult as unknown as Record<string, unknown>,
        );
        setTransportProbeResult(errResult);
        toast.error("Bridge-only probe failed");
        return null;
      } finally {
        setRunningTransportProbe(false);
      }
    },
    [runningTransportProbe],
  );

  // ── 2. Push-Bridge Transport Gate ────────────────────────────────────────
  const runPushTransportGate = useCallback(
    async (): Promise<PushGateResult | null> => {
      if (!isTauriRuntime() || runningPushGate) return null;
      setRunningPushGate(true);
      try {
        const run = async (
          label: string,
          payloadBytes: number,
          frameCount: number,
          paceMs: number,
        ) => {
          const receiveSamples: number[] = [];
          const paintSamples: number[] = [];
          const expectedBytes = 52 + payloadBytes;
          const rgbaBytes = 480 * 270 * 4;
          const canvas =
            payloadBytes === rgbaBytes ? document.createElement("canvas") : null;
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
            void streamNativePlaybackFrames(
              1n,
              (packet) => {
                try {
                  if (packet.byteLength !== expectedBytes) {
                    throw new Error(
                      `Unexpected push packet: ${packet.byteLength} bytes`,
                    );
                  }
                  const view = new DataView(packet);
                  if (
                    view.getUint32(0, true) !== 0x4350_4652 ||
                    view.getUint16(4, true) !== 1
                  ) {
                    throw new Error("Unsupported push-bridge packet header");
                  }
                  const headerBytes = view.getUint16(6, true);
                  const t8EpochUs = Number(view.getBigUint64(32, true));
                  const width = view.getUint32(40, true);
                  const height = view.getUint32(44, true);
                  const stride = view.getUint32(48, true);
                  if (
                    headerBytes !== 52 ||
                    width !== 480 ||
                    height !== 270 ||
                    stride !== 1920
                  ) {
                    throw new Error("Unexpected push-bridge frame layout");
                  }
                  const t9EpochUs = Math.round(
                    (performance.timeOrigin + performance.now()) * 1_000,
                  );
                  receiveSamples.push(
                    Math.max(0, (t9EpochUs - t8EpochUs) / 1_000),
                  );
                  if (context && payloadBytes === rgbaBytes && typeof ImageData !== "undefined") {
                    const pixels = new Uint8ClampedArray(
                      packet,
                      headerBytes,
                      rgbaBytes,
                    );
                    context.putImageData(
                      new ImageData(pixels, width, height),
                      0,
                      0,
                    );
                    requestAnimationFrame(() => {
                      const t11EpochUs = Math.round(
                        (performance.timeOrigin + performance.now()) * 1_000,
                      );
                      paintSamples.push(
                        Math.max(0, (t11EpochUs - t8EpochUs) / 1_000),
                      );
                      completeFrame();
                    });
                  } else {
                    completeFrame();
                  }
                } catch (error) {
                  window.clearTimeout(timeout);
                  reject(error);
                }
              },
              { frameCount, payloadBytes, paceMs },
            ).catch((error) => {
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
            payloadBytes,
            frameCount,
            p50ReceiveMs: Number(percentile(0.5).toFixed(2)),
            p95ReceiveMs: Number(percentile(0.95).toFixed(2)),
            p50PaintMs:
              paintPercentile(0.5) !== null
                ? Number(paintPercentile(0.5)!.toFixed(2))
                : null,
            p95PaintMs:
              paintPercentile(0.95) !== null
                ? Number(paintPercentile(0.95)!.toFixed(2))
                : null,
            fps: Number(
              (
                (frameCount * 1_000) /
                Math.max(1, performance.now() - startedAt)
              ).toFixed(1),
            ),
          };
        };

        const fullPaced = await run("518 KB paced", 480 * 270 * 4, 20, 50);
        const smallPaced = await run("1 KB paced", 1024, 20, 50);
        const fullBurst = await run("518 KB burst", 480 * 270 * 4, 60, 0);

        const passed = fullPaced.p95ReceiveMs < 100 && fullBurst.fps >= 20;

        const result: PushGateResult = {
          passed,
          capabilities: pushCapabilities,
          fullPaced,
          smallPaced,
          fullBurst,
          success: true,
          compiledAtEpochMs: Date.now(),
        };

        EditorFeatureTelemetry.recordDiagnosticRun(
          "push-transport-gate",
          result as unknown as Record<string, unknown>,
        );
        await EditorFeatureTelemetry.compileAndRecordSessionReport({
          pushGate: result,
        });

        setPushGateResult(result);
        toast.success(
          `Push-bridge gate ${passed ? "passed" : "failed"} — compiled into session telemetry`,
        );
        return result;
      } catch (error) {
        console.warn("[PreviewDiagnostics] Push transport gate failed", error);
        const errResult: PushGateResult = {
          passed: false,
          capabilities: pushCapabilities,
          fullPaced: {
            label: "518 KB paced",
            payloadBytes: 480 * 270 * 4,
            frameCount: 20,
            p50ReceiveMs: 0,
            p95ReceiveMs: 0,
            p50PaintMs: null,
            p95PaintMs: null,
            fps: 0,
          },
          smallPaced: {
            label: "1 KB paced",
            payloadBytes: 1024,
            frameCount: 20,
            p50ReceiveMs: 0,
            p95ReceiveMs: 0,
            fps: 0,
          },
          fullBurst: {
            label: "518 KB burst",
            payloadBytes: 480 * 270 * 4,
            frameCount: 60,
            fps: 0,
          },
          success: false,
          error: error instanceof Error ? error.message : String(error),
          compiledAtEpochMs: Date.now(),
        };
        EditorFeatureTelemetry.recordDiagnosticRun(
          "push-transport-gate",
          errResult as unknown as Record<string, unknown>,
        );
        setPushGateResult(errResult);
        toast.error("Push-bridge transport gate failed");
        return null;
      } finally {
        setRunningPushGate(false);
      }
    },
    [runningPushGate, pushCapabilities],
  );

  // ── 3. 30-Second Preview Qualification ───────────────────────────────────
  const finalizeQualification = useCallback(
    async (): Promise<QualificationResult> => {
      const qualState = previewQualificationController.getState();
      let nativeSnapshot: NativeSessionSnapshot | null = null;
      try {
        nativeSnapshot = await getNativeSessionTelemetry();
      } catch {
        // Non-fatal if session telemetry is not queryable directly
      }
      const frontendStats = nativePerfCollector.statsFor("playback");
      const framesProduced =
        nativeSnapshot?.framesProduced ??
        frontendStats.bridgeCount + frontendStats.nativeSurfaceCount;
      const framesDropped =
        nativeSnapshot?.framesDropped ?? frontendStats.droppedCount;
      const dropRatePct =
        nativeSnapshot?.dropRatePct ??
        (framesProduced > 0 ? (framesDropped / framesProduced) * 100 : 0);
      const passed =
        dropRatePct <= PREVIEW_PERFORMANCE_BUDGETS.droppedFrameRatio * 100;

      const result: QualificationResult = {
        runId: qualState.runId ?? `qual_${Date.now()}`,
        durationMs: qualState.durationMs,
        path: "webview",
        status: "complete",
        framesProduced,
        framesDropped,
        dropRatePct: Number(dropRatePct.toFixed(2)),
        renderedFps:
          nativeSnapshot && nativeSnapshot.sessionDurationSecs > 0
            ? Number(
                (
                  nativeSnapshot.framesProduced /
                  nativeSnapshot.sessionDurationSecs
                ).toFixed(1),
              )
            : null,
        uniqueFramesPaintedFps:
          frontendStats.uniqueFramesPaintedPerSecond !== null
            ? Number(frontendStats.uniqueFramesPaintedPerSecond.toFixed(1))
            : null,
        passed,
        compiledAtEpochMs: Date.now(),
      };

      EditorFeatureTelemetry.recordDiagnosticRun(
        "preview-qualification-30s",
        result as unknown as Record<string, unknown>,
      );
      await EditorFeatureTelemetry.compileAndRecordSessionReport({
        qualification: result,
      });

      setQualificationResult(result);
      toast.success("30-second qualification compiled into session telemetry");
      return result;
    },
    [],
  );

  const startQualification = () => {
    if (!project?.id || !isTauriRuntime() || anyRunning) return;
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
        void finalizeQualification();
      },
    });
  };

  const cancelQualification = () => {
    previewQualificationController.cancel();
    if (startedFromPause) {
      pause();
      setStartedFromPause(false);
    }
  };

  // ── 4. Run Complete Diagnostic Suite ─────────────────────────────────────
  const runCompleteDiagnosticSuite = async () => {
    if (!isTauriRuntime() || anyRunning) return;
    setRunningSuite(true);
    setSuiteCompletedAt(null);
    try {
      // Step 1: 518 KB bridge probe
      setSuiteStep("Step 1 of 3: Running 518 KB bridge-only probe…");
      const probeResult = await runTransportProbe();

      // Step 2: Push transport gate
      setSuiteStep("Step 2 of 3: Running push-bridge transport gate…");
      const gateResult = await runPushTransportGate();

      // Step 3: Qualification (if project is open)
      let qualResult: QualificationResult | null = null;
      if (project?.id) {
        setSuiteStep("Step 3 of 3: Running 30-second preview qualification…");
        qualResult = await new Promise<QualificationResult>((resolve) => {
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
            onComplete: async () => {
              if (!wasPlaying) pause();
              const q = await finalizeQualification();
              resolve(q);
            },
          });
        });
      } else {
        setSuiteStep(
          "Step 3 of 3: Skipped qualification (no active project loaded)",
        );
      }

      setSuiteStep("Compiling complete diagnostic telemetry into session log…");
      const suitePayload = {
        type: "complete-diagnostic-suite",
        probeResult,
        gateResult,
        qualResult,
        completedAtEpochMs: Date.now(),
      };
      EditorFeatureTelemetry.recordDiagnosticRun(
        "complete-diagnostic-suite",
        suitePayload,
      );
      await EditorFeatureTelemetry.compileAndRecordSessionReport({
        completeSuite: suitePayload,
      });

      const finishedAt = Date.now();
      setSuiteCompletedAt(finishedAt);
      toast.success(
        "Complete diagnostic suite finished and compiled into session telemetry",
      );
    } catch (err) {
      console.warn("[PreviewDiagnostics] Diagnostic suite failed:", err);
      toast.error("Diagnostic suite encountered an error");
    } finally {
      setRunningSuite(false);
      setSuiteStep(null);
    }
  };

  const isQualRunning = state.status === "running";
  const pathLabel =
    state.path === "native"
      ? "Native surface"
      : state.path === "webview"
        ? "WebView bridge"
        : "—";

  return (
    <section className="space-y-5">
      {/* ── Section Header ─────────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Gauge className="h-5 w-5 text-accent" />
            <h2 className="text-base font-semibold text-text-primary">
              Preview Diagnostics & Engine Telemetry
            </h2>
          </div>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-text-muted">
            Run automated performance qualification and transport benchmarks. All
            outputs are compiled directly into the active session telemetry
            stream for unified analysis — no manual copy-pasting required.
          </p>
        </div>
      </div>

      {/* ── Primary Action: Run Complete Diagnostic Suite ───────────────── */}
      <div className="rounded-xl border border-accent/25 bg-accent/5 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
              <Zap className="h-4 w-4 text-accent" />
              <span>Full Diagnostic Benchmark Suite</span>
            </div>
            <p className="text-xs text-text-muted">
              Sequentially executes 518 KB probe, push-bridge transport gate, and
              30s preview qualification, then compiles the unified telemetry report.
            </p>
          </div>
          <Button
            onClick={() => void runCompleteDiagnosticSuite()}
            disabled={!isTauriRuntime() || anyRunning}
            className="cursor-pointer"
          >
            {runningSuite ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin text-accent" />
                Running Suite…
              </>
            ) : (
              <>
                <Zap className="mr-2 h-4 w-4" />
                Run Complete Diagnostic Suite
              </>
            )}
          </Button>
        </div>

        {suiteStep && (
          <div className="flex items-center gap-2 rounded-md bg-white/5 px-3 py-2 text-xs text-text-secondary border border-white/5">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-accent shrink-0" />
            <span>{suiteStep}</span>
          </div>
        )}

        {suiteCompletedAt && !runningSuite && (
          <div className="flex items-center gap-2 rounded-md bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            <span>
              Complete diagnostic suite compiled into session telemetry at{" "}
              {new Date(suiteCompletedAt).toLocaleTimeString()}
            </span>
          </div>
        )}
      </div>

      {/* ── Diagnostic 1: 30-Second Preview Qualification ────────────────── */}
      <div className="rounded-lg border border-white/8 bg-white/2 p-4 space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
              <Layers className="h-4 w-4 text-accent" />
              <span>30-Second Preview Qualification</span>
            </div>
            <p className="mt-0.5 text-xs text-text-muted max-w-lg">
              Runs real-time playback in WebView bridge fallback mode for{" "}
              {PREVIEW_PERFORMANCE_BUDGETS.qualificationDurationMs / 1000}s to
              verify dropped frames remain under the 1% budget.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={startQualification}
              disabled={!isTauriRuntime() || !project?.id || anyRunning}
              size="sm"
              className="cursor-pointer"
            >
              <Play className="mr-1.5 h-3.5 w-3.5" />
              Run 30s qualification
            </Button>
            {isQualRunning && (
              <Button
                variant="secondary"
                size="sm"
                onClick={cancelQualification}
                className="cursor-pointer text-destructive hover:bg-destructive/10"
              >
                <Square className="mr-1.5 h-3.5 w-3.5" />
                Cancel
              </Button>
            )}
          </div>
        </div>

        {isQualRunning && (
          <div className="flex items-center gap-2 rounded-md bg-accent/10 px-3 py-2 text-xs text-accent border border-accent/20">
            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
            <span>
              Running {pathLabel} qualification pass… Timeline playing.
            </span>
          </div>
        )}

        {qualificationResult && !isQualRunning && (
          <div className="rounded-md border border-white/8 bg-black/20 p-3 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>
                  Compiled into session telemetry (
                  {new Date(
                    qualificationResult.compiledAtEpochMs,
                  ).toLocaleTimeString()}
                  )
                </span>
              </div>
              <span
                className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                  qualificationResult.passed
                    ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25"
                    : "bg-rose-500/15 text-rose-400 border border-rose-500/25"
                }`}
              >
                {qualificationResult.passed ? "PASSED" : "FAILED"}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-text-muted">
              <div>
                <span className="block text-[10px] uppercase tracking-wider">
                  Frames Produced
                </span>
                <span className="text-sm font-semibold text-text-primary">
                  {qualificationResult.framesProduced}
                </span>
              </div>
              <div>
                <span className="block text-[10px] uppercase tracking-wider">
                  Dropped Frames
                </span>
                <span className="text-sm font-semibold text-text-primary">
                  {qualificationResult.framesDropped} (
                  {qualificationResult.dropRatePct}%)
                </span>
              </div>
              <div>
                <span className="block text-[10px] uppercase tracking-wider">
                  Rendered FPS
                </span>
                <span className="text-sm font-semibold text-text-primary">
                  {qualificationResult.renderedFps ??
                    qualificationResult.uniqueFramesPaintedFps ??
                    "—"}
                </span>
              </div>
              <div>
                <span className="block text-[10px] uppercase tracking-wider">
                  Presenter
                </span>
                <span className="text-sm font-semibold text-text-primary">
                  {qualificationResult.path}
                </span>
              </div>
            </div>
          </div>
        )}

        {!project?.id && (
          <p className="text-[11px] text-text-muted italic">
            Note: 30-second qualification requires an active project to be open.
          </p>
        )}
      </div>

      {/* ── Diagnostic 2: 518 KB Bridge-Only Probe ───────────────────────── */}
      <div className="rounded-lg border border-white/8 bg-white/2 p-4 space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
              <Activity className="h-4 w-4 text-accent" />
              <span>518 KB Bridge-Only Probe</span>
            </div>
            <p className="mt-0.5 text-xs text-text-muted max-w-lg">
              Measures raw IPC crossing and deserialization latency over 20 runs
              using a synthetic 518 KB payload (simulating 480px RGBA fallback).
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void runTransportProbe()}
            disabled={!isTauriRuntime() || anyRunning}
            className="cursor-pointer"
          >
            {runningTransportProbe ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Measuring bridge…
              </>
            ) : (
              "Run 518 KB bridge probe"
            )}
          </Button>
        </div>

        {transportProbeResult && (
          <div className="rounded-md border border-white/8 bg-black/20 p-3 space-y-2 text-xs">
            {transportProbeResult.success ? (
              <>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>
                      Compiled into session telemetry (
                      {new Date(
                        transportProbeResult.compiledAtEpochMs,
                      ).toLocaleTimeString()}
                      )
                    </span>
                  </div>
                  <span className="text-[11px] text-text-muted font-mono">
                    {transportProbeResult.runs} runs · 518 KB
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-text-muted">
                  <div>
                    <span className="block text-[10px] uppercase tracking-wider">
                      p50 Latency
                    </span>
                    <span className="text-sm font-semibold text-text-primary">
                      {transportProbeResult.p50Ms} ms
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase tracking-wider">
                      p95 Latency
                    </span>
                    <span className="text-sm font-semibold text-text-primary">
                      {transportProbeResult.p95Ms} ms
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase tracking-wider">
                      Min / Max
                    </span>
                    <span className="text-sm font-semibold text-text-primary">
                      {transportProbeResult.minMs} / {transportProbeResult.maxMs} ms
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase tracking-wider">
                      Average
                    </span>
                    <span className="text-sm font-semibold text-text-primary">
                      {transportProbeResult.avgMs} ms
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2 text-rose-400">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>
                  Probe failed: {transportProbeResult.error || "Unknown error"}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Diagnostic 3: Push-Bridge Transport Gate ────────────────────── */}
      <div className="rounded-lg border border-white/8 bg-white/2 p-4 space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
              <Zap className="h-4 w-4 text-accent" />
              <span>Push-Bridge Transport Gate</span>
            </div>
            <p className="mt-0.5 text-xs text-text-muted max-w-lg">
              Evaluates 518 KB paced (t8→t9 receive and t8→t11 canvas+rAF), 1 KB
              paced, and 518 KB burst rates to gate activation of push-bridge
              streaming.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void runPushTransportGate()}
            disabled={!isTauriRuntime() || anyRunning}
            className="cursor-pointer"
          >
            {runningPushGate ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Measuring Channel…
              </>
            ) : (
              "Run push-bridge transport gate"
            )}
          </Button>
        </div>

        {pushCapabilities && (
          <p className="text-[11px] text-text-muted font-mono">
            {pushCapabilities}
          </p>
        )}

        {pushGateResult && (
          <div className="rounded-md border border-white/8 bg-black/20 p-3 space-y-2 text-xs">
            {pushGateResult.success ? (
              <>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>
                      Compiled into session telemetry (
                      {new Date(
                        pushGateResult.compiledAtEpochMs,
                      ).toLocaleTimeString()}
                      )
                    </span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                      pushGateResult.passed
                        ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25"
                        : "bg-rose-500/15 text-rose-400 border border-rose-500/25"
                    }`}
                  >
                    {pushGateResult.passed
                      ? "GATE PASSED (Tier 1 Ready)"
                      : "GATE FAILED (Fallback Enforced)"}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-text-muted">
                  <div>
                    <span className="block text-[10px] uppercase tracking-wider">
                      518KB Paced Receive
                    </span>
                    <span className="text-sm font-semibold text-text-primary">
                      {pushGateResult.fullPaced.p50ReceiveMs} /{" "}
                      {pushGateResult.fullPaced.p95ReceiveMs} ms
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase tracking-wider">
                      518KB Canvas+rAF
                    </span>
                    <span className="text-sm font-semibold text-text-primary">
                      {pushGateResult.fullPaced.p50PaintMs ?? "—"} /{" "}
                      {pushGateResult.fullPaced.p95PaintMs ?? "—"} ms
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase tracking-wider">
                      1KB Paced Receive
                    </span>
                    <span className="text-sm font-semibold text-text-primary">
                      {pushGateResult.smallPaced.p50ReceiveMs} /{" "}
                      {pushGateResult.smallPaced.p95ReceiveMs} ms
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase tracking-wider">
                      518KB Burst Rate
                    </span>
                    <span className="text-sm font-semibold text-text-primary">
                      {pushGateResult.fullBurst.fps} FPS
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2 text-rose-400">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>
                  Gate failed: {pushGateResult.error || "Unknown error"}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Telemetry Stream Persistence Footer ─────────────────────────── */}
      <div className="pt-3 border-t border-white/8 space-y-3">
        <p className="text-xs text-text-muted leading-relaxed">
          Diagnostic benchmark metrics are compiled directly into the active
          session&apos;s NDJSON telemetry log on disk. When this session closes,
          all compiled benchmarks and cold-start traces are archived and uploaded
          to Clypra servers (if telemetry sharing is enabled).
        </p>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-1">
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
            <span>Share anonymous performance diagnostics with Clypra</span>
          </label>
          {perfLogService.getSessionId() && (
            <div className="flex items-center gap-1.5 text-[11px] text-text-muted font-mono bg-white/4 px-2 py-1 rounded border border-white/6">
              <span className="text-text-secondary">Session:</span>
              <span>{perfLogService.getSessionId()}</span>
            </div>
          )}
        </div>
      </div>

      {!isTauriRuntime() && (
        <div className="rounded-md bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-400">
          Preview diagnostics and transport benchmarks are available in the Clypra
          desktop application only.
        </div>
      )}
    </section>
  );
};

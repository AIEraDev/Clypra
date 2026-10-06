import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { PreviewDiagnosticsTab } from "../PreviewDiagnosticsTab";
import * as tauriPlatform from "@/lib/platform/tauri";
import { EditorFeatureTelemetry } from "@/services/editorFeatureTelemetry";
import { perfLogService } from "@/services/perfLogService";
import { useProjectStore } from "@/store/projectStore";

// Mock Tauri platform functions
vi.mock("@/lib/platform/tauri", () => ({
  isTauriRuntime: vi.fn(() => true),
  getNativePushTransportCapabilities: vi.fn().mockResolvedValue({
    channel: true,
    customProtocolLongPoll: false,
    webview2SharedBuffer: true,
    webviewRuntime: "WebView2 120.0",
  }),
  renderNativePreviewTransportProbe: vi.fn(),
  streamNativePlaybackFrames: vi.fn(),
  getNativeSessionTelemetry: vi.fn().mockResolvedValue({
    framesProduced: 1800,
    framesDropped: 0,
    dropRatePct: 0.0,
    sessionDurationSecs: 30.0,
    avgDecodeUs: 4500,
    avgQueueWaitUs: 1200,
    avgIpcWaitUs: 2100,
    avgGpuRenderUs: 3200,
  }),
  getNativePreviewPerformanceReport: vi.fn().mockResolvedValue({
    reportVersion: 1,
    capturedAtMs: Date.now(),
    applicationVersion: "1.5.9",
    buildProfile: "release",
    operatingSystem: "macos",
    architecture: "arm64",
    gpu: null,
    preview: null,
    session: {
      framesProduced: 1800,
      framesDropped: 0,
      dropRatePct: 0.0,
      sessionDurationSecs: 30.0,
    },
    stageDiagnoses: [],
    pushBridge: null,
  }),
}));

vi.mock("@/lib/toast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe("PreviewDiagnosticsTab (Redesigned Run-Only Architecture)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(tauriPlatform, "isTauriRuntime").mockReturnValue(true);
    vi.spyOn(perfLogService, "getSessionId").mockReturnValue("session-diag-xyz");
    useProjectStore.setState({
      project: {
        id: "test-project-1",
        name: "Test Project",
        canvasWidth: 1920,
        canvasHeight: 1080,
      } as any,
    });
  });

  it("renders the diagnostics tab with run actions and NO copy button", () => {
    render(<PreviewDiagnosticsTab />);

    // Header and Suite
    expect(
      screen.getByText("Preview Diagnostics & Engine Telemetry"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Run Complete Diagnostic Suite"),
    ).toBeInTheDocument();

    // Individual Run Actions
    expect(screen.getByText("Run 30s qualification")).toBeInTheDocument();
    expect(screen.getByText("Run 518 KB bridge probe")).toBeInTheDocument();
    expect(
      screen.getByText("Run push-bridge transport gate"),
    ).toBeInTheDocument();

    // Critical assertion: NO "Copy performance report" or clipboard button exists
    expect(
      screen.queryByText(/copy performance report/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/copying/i)).not.toBeInTheDocument();

    // Active session ID is visible in the telemetry footer
    expect(screen.getByText(/session-diag-xyz/)).toBeInTheDocument();
  });

  it("executes 518 KB bridge probe and compiles results directly into session telemetry", async () => {
    const recordSpy = vi
      .spyOn(EditorFeatureTelemetry, "recordDiagnosticRun")
      .mockImplementation(() => {});
    const compileSpy = vi
      .spyOn(EditorFeatureTelemetry, "compileAndRecordSessionReport")
      .mockResolvedValue({} as any);

    // Mock 518 KB buffer returned on each probe iteration
    const dummyBuffer = new ArrayBuffer(518 * 1024);
    vi.mocked(tauriPlatform.renderNativePreviewTransportProbe).mockResolvedValue(
      dummyBuffer,
    );

    render(<PreviewDiagnosticsTab />);

    const runProbeButton = screen.getByText("Run 518 KB bridge probe");
    fireEvent.click(runProbeButton);

    await waitFor(() => {
      expect(recordSpy).toHaveBeenCalledTimes(1);
    });

    const [diagType, payload] = recordSpy.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(diagType).toBe("bridge-probe-518kb");
    expect(payload.runs).toBe(20);
    expect(payload.payloadBytes).toBe(518 * 1024);
    expect(payload.success).toBe(true);
    expect(typeof payload.p50Ms).toBe("number");
    expect(typeof payload.p95Ms).toBe("number");

    // Full session report is compiled
    expect(compileSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        bridgeProbe: expect.objectContaining({
          runs: 20,
          payloadBytes: 518 * 1024,
        }),
      }),
    );

    // UI displays compiled badge
    await waitFor(() => {
      expect(
        screen.getByText(/Compiled into session telemetry/),
      ).toBeInTheDocument();
      expect(screen.getByText(/20 runs · 518 KB/)).toBeInTheDocument();
    });
  });

  it("executes push-bridge transport gate and compiles metrics into session telemetry", async () => {
    const recordSpy = vi
      .spyOn(EditorFeatureTelemetry, "recordDiagnosticRun")
      .mockImplementation(() => {});
    const compileSpy = vi
      .spyOn(EditorFeatureTelemetry, "compileAndRecordSessionReport")
      .mockResolvedValue({} as any);

    // Mock push packets with header matching the gate layout
    vi.mocked(tauriPlatform.streamNativePlaybackFrames).mockImplementation(
      async (_generation, onPacket, options) => {
        const frameCount = options?.frameCount ?? 20;
        const payloadBytes = options?.payloadBytes ?? 1024;
        const totalBytes = 52 + payloadBytes;

        for (let i = 0; i < frameCount; i += 1) {
          const buffer = new ArrayBuffer(totalBytes);
          const view = new DataView(buffer);
          // Magic 0x4350_4652
          view.setUint32(0, 0x4350_4652, true);
          // Version 1
          view.setUint16(4, 1, true);
          // Header bytes 52
          view.setUint16(6, 52, true);
          // t8EpochUs
          view.setBigUint64(32, BigInt(Date.now() * 1000), true);
          // Width 480, height 270, stride 1920
          view.setUint32(40, 480, true);
          view.setUint32(44, 270, true);
          view.setUint32(48, 1920, true);

          onPacket(buffer);
        }
      },
    );

    render(<PreviewDiagnosticsTab />);

    const runGateButton = screen.getByText("Run push-bridge transport gate");
    fireEvent.click(runGateButton);

    await waitFor(() => {
      expect(recordSpy).toHaveBeenCalledTimes(1);
    });

    const [diagType, payload] = recordSpy.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(diagType).toBe("push-transport-gate");
    expect(payload.success).toBe(true);
    expect(payload.fullPaced).toBeDefined();
    expect(payload.smallPaced).toBeDefined();
    expect(payload.fullBurst).toBeDefined();

    // Full session report is compiled
    expect(compileSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        pushGate: expect.objectContaining({
          success: true,
        }),
      }),
    );

    // UI displays Gate status badge
    await waitFor(() => {
      expect(
        screen.getByText(/GATE PASSED/i) || screen.getByText(/GATE FAILED/i),
      ).toBeInTheDocument();
    });
  });

  it("handles 30-second qualification and compiles results into session telemetry", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const recordSpy = vi
      .spyOn(EditorFeatureTelemetry, "recordDiagnosticRun")
      .mockImplementation(() => {});
    const compileSpy = vi
      .spyOn(EditorFeatureTelemetry, "compileAndRecordSessionReport")
      .mockResolvedValue({} as any);

    render(<PreviewDiagnosticsTab />);

    const runQualButton = screen.getByText("Run 30s qualification");
    fireEvent.click(runQualButton);

    // Fast-forward qualification duration (30s)
    vi.advanceTimersByTime(30_000);

    await waitFor(() => {
      expect(recordSpy).toHaveBeenCalledWith(
        "preview-qualification-30s",
        expect.objectContaining({
          path: "webview",
          status: "complete",
          framesProduced: 1800,
          framesDropped: 0,
        }),
      );
    });

    expect(compileSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        qualification: expect.objectContaining({
          status: "complete",
        }),
      }),
    );

    vi.useRealTimers();
  });
});

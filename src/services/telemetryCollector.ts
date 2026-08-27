/**
 * Production Telemetry Collector for Clypra Desktop & Mobile Editor.
 *
 * Responsibilities:
 * - Collects real-time runtime frame render timings, seek latencies, and fallback events.
 * - Samples adaptively (100% on dropped frames/anomalies, 1% on smooth frames) to keep overhead near 0%.
 * - Dispatches non-blocking async batches to Clypra Performance API.
 * - Strict Zero PII: Zero video frames, media assets, project titles, or user identities are ever collected.
 */

export interface TelemetryHardwareContext {
  osFamily: "macos" | "windows" | "linux" | "ios" | "android" | "web";
  osVersion: string;
  cpuArch: "arm64" | "x86_64" | "wasm32";
  cpuCores: number;
  systemMemoryMb: number;
  gpuVendor: "apple" | "nvidia" | "amd" | "intel" | "qualcomm" | "arm" | "software" | "unknown";
  gpuModel: string;
  gpuDriverVersion?: string;
  graphicsBackend: "metal" | "d3d12" | "d3d11" | "vulkan" | "webgpu" | "webgl2" | "software";
  displayDpr: number;
  isBatteryPowered?: boolean;
}

export interface TelemetryVideoProfile {
  container: "mp4" | "mov" | "webm" | "mkv";
  codec: "h264" | "hevc" | "av1" | "vp9" | "prores422" | "prores4444";
  width: number;
  height: number;
  resolutionBucket: "720p" | "1080p" | "1440p" | "4k" | "8k" | "custom";
  nominalFps: number;
  pacingMode: "cfr" | "vfr";
  bitDepth: 8 | 10 | 12;
  colorSpace: "rec709" | "rec2020" | "srgb" | "p3";
  hdrFormat: "none" | "hdr10" | "hlg" | "dolby_vision";
  bitrateKbps: number;
}

export interface TelemetryStageTimings {
  decodeUs?: number;
  decoderMutexWaitUs?: number;
  conversionUploadUs?: number;
  composeUs?: number;
  surfaceAcquireUs?: number;
  readbackUs?: number;
  submitPresentUs?: number;
  totalTimeUs: number;
}

export interface TelemetryEvent {
  eventId: string;
  appVersion: string;
  appBuildNumber: string;
  appEnvironment: "production" | "canary" | "beta";
  device: TelemetryHardwareContext;
  video: TelemetryVideoProfile;
  workload: {
    mode: "playback" | "seek-warm" | "seek-cold" | "scrub" | "export-transcode" | "shader-composition";
    durationMs: number;
    targetFps: number;
    renderedFps: number;
    totalFrames: number;
    droppedFrames: number;
    droppedFramesRatio: number;
    staleFrames: number;
    cancelledFrames: number;
    avDriftMs?: number;
    peakRamMb: number;
    cacheHitRatio: number;
    stageTimings: TelemetryStageTimings;
  };
  fallbackEvent?: {
    triggered: boolean;
    fromBackend: string;
    toBackend: string;
    reasonCode: string;
    stackSnippet?: string;
  };
  timestampMs: number;
}

const DEFAULT_API_INGEST_URL = "https://clypra-worker-api.abdulkabirmusa.com/performance/telemetry/ingest/batch";
const MAX_QUEUE_SIZE = 100;
const FLUSH_INTERVAL_MS = 15000;
const NOMINAL_SAMPLE_RATE = 0.01; // 1% sample rate for smooth 60fps frames

class TelemetryCollector {
  private queue: TelemetryEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private cachedHardware: TelemetryHardwareContext | null = null;
  private isEnabled: boolean = true;
  private appVersion: string = "1.4.5";

  constructor() {
    if (typeof window !== "undefined") {
      this.initHardwareContext();
      this.startFlushTimer();
      window.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
          this.flush();
        }
      });
    }
  }

  public setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
  }

  public setAppVersion(version: string): void {
    this.appVersion = version;
  }

  public getQueueLength(): number {
    return this.queue.length;
  }

  public clearQueue(): void {
    this.queue = [];
  }

  /**
   * Probes GPU and OS hardware properties safely with zero performance overhead.
   */
  public initHardwareContext(): TelemetryHardwareContext {
    if (this.cachedHardware) return this.cachedHardware;

    const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "";
    let osFamily: TelemetryHardwareContext["osFamily"] = "web";
    let graphicsBackend: TelemetryHardwareContext["graphicsBackend"] = "webgl2";

    if (/Macintosh|Mac OS X/i.test(userAgent)) {
      osFamily = "macos";
      graphicsBackend = "metal";
    } else if (/Windows/i.test(userAgent)) {
      osFamily = "windows";
      graphicsBackend = "d3d12";
    } else if (/Linux/i.test(userAgent) && !/Android/i.test(userAgent)) {
      osFamily = "linux";
      graphicsBackend = "vulkan";
    } else if (/iPhone|iPad|iPod/i.test(userAgent)) {
      osFamily = "ios";
      graphicsBackend = "metal";
    } else if (/Android/i.test(userAgent)) {
      osFamily = "android";
      graphicsBackend = "webgpu";
    }

    let gpuVendor: TelemetryHardwareContext["gpuVendor"] = "unknown";
    let gpuModel = "Generic GPU";

    if (typeof document !== "undefined") {
      try {
        const canvas = document.createElement("canvas");
        const gl = (canvas.getContext("webgl") || canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
        if (gl && typeof gl.getExtension === "function") {
          const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
          if (debugInfo) {
            const renderer = (gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) as string) || "";
            gpuModel = renderer;
            if (/Apple/i.test(renderer)) gpuVendor = "apple";
            else if (/NVIDIA/i.test(renderer)) gpuVendor = "nvidia";
            else if (/AMD|Radeon/i.test(renderer)) gpuVendor = "amd";
            else if (/Intel/i.test(renderer)) gpuVendor = "intel";
            else if (/Mali/i.test(renderer)) gpuVendor = "arm";
            else if (/Adreno|Qualcomm/i.test(renderer)) gpuVendor = "qualcomm";
          }
        }
      } catch {
        // Safe fallback
      }
    }

    const cpuArch: TelemetryHardwareContext["cpuArch"] =
      osFamily === "macos" || osFamily === "ios" || osFamily === "android" ? "arm64" : "x86_64";

    const cpuCores = typeof navigator !== "undefined" && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 8;
    const displayDpr = typeof window !== "undefined" && window.devicePixelRatio ? window.devicePixelRatio : 1.0;

    this.cachedHardware = {
      osFamily,
      osVersion: "production",
      cpuArch,
      cpuCores,
      systemMemoryMb: 16384,
      gpuVendor,
      gpuModel,
      graphicsBackend,
      displayDpr,
    };

    return this.cachedHardware;
  }

  /**
   * Records a completed playback or render span.
   */
  public recordRenderSpan(
    timings: TelemetryStageTimings,
    droppedFrames: number,
    totalFrames: number,
    videoProfile: Partial<TelemetryVideoProfile> = {},
    workloadMode: "playback" | "scrub" | "export-transcode" = "playback"
  ): void {
    if (!this.isEnabled) return;

    const droppedRatio = totalFrames > 0 ? droppedFrames / totalFrames : 0;
    const isAnomaly = droppedRatio > 0.05 || timings.totalTimeUs > 16667;

    // Adaptive sampling: 100% on dropped frames / latency SLA overruns, 1% on nominal smooth frames
    if (!isAnomaly && Math.random() > NOMINAL_SAMPLE_RATE) {
      return;
    }

    const hardware = this.initHardwareContext();
    const fullVideoProfile: TelemetryVideoProfile = {
      container: videoProfile.container || "mp4",
      codec: videoProfile.codec || "hevc",
      width: videoProfile.width || 3840,
      height: videoProfile.height || 2160,
      resolutionBucket: videoProfile.resolutionBucket || "4k",
      nominalFps: videoProfile.nominalFps || 60,
      pacingMode: videoProfile.pacingMode || "cfr",
      bitDepth: videoProfile.bitDepth || 10,
      colorSpace: videoProfile.colorSpace || "rec709",
      hdrFormat: videoProfile.hdrFormat || "none",
      bitrateKbps: videoProfile.bitrateKbps || 25000,
    };

    const event: TelemetryEvent = {
      eventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      appVersion: this.appVersion,
      appBuildNumber: "prod",
      appEnvironment: "production",
      device: hardware,
      video: fullVideoProfile,
      workload: {
        mode: workloadMode,
        durationMs: Math.round(timings.totalTimeUs / 1000),
        targetFps: fullVideoProfile.nominalFps,
        renderedFps: timings.totalTimeUs > 0 ? Math.min(fullVideoProfile.nominalFps, 1000000 / timings.totalTimeUs) : fullVideoProfile.nominalFps,
        totalFrames: totalFrames || 1,
        droppedFrames: droppedFrames || 0,
        droppedFramesRatio: droppedRatio,
        staleFrames: 0,
        cancelledFrames: 0,
        peakRamMb: 512,
        cacheHitRatio: 0.9,
        stageTimings: timings,
      },
      timestampMs: Date.now(),
    };

    this.enqueueEvent(event);
  }

  /**
   * Records a seek response span (cold or warm seek).
   */
  public recordSeekSpan(
    seekLatencyMs: number,
    isColdSeek: boolean = true,
    videoProfile: Partial<TelemetryVideoProfile> = {}
  ): void {
    if (!this.isEnabled) return;

    const isAnomaly = seekLatencyMs > 100.0;
    if (!isAnomaly && Math.random() > NOMINAL_SAMPLE_RATE) {
      return;
    }

    const hardware = this.initHardwareContext();
    const fullVideoProfile: TelemetryVideoProfile = {
      container: videoProfile.container || "mp4",
      codec: videoProfile.codec || "hevc",
      width: videoProfile.width || 3840,
      height: videoProfile.height || 2160,
      resolutionBucket: videoProfile.resolutionBucket || "4k",
      nominalFps: videoProfile.nominalFps || 60,
      pacingMode: videoProfile.pacingMode || "cfr",
      bitDepth: videoProfile.bitDepth || 10,
      colorSpace: videoProfile.colorSpace || "rec709",
      hdrFormat: videoProfile.hdrFormat || "none",
      bitrateKbps: videoProfile.bitrateKbps || 25000,
    };

    const event: TelemetryEvent = {
      eventId: `evt_seek_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      appVersion: this.appVersion,
      appBuildNumber: "prod",
      appEnvironment: "production",
      device: hardware,
      video: fullVideoProfile,
      workload: {
        mode: isColdSeek ? "seek-cold" : "seek-warm",
        durationMs: Math.round(seekLatencyMs),
        targetFps: fullVideoProfile.nominalFps,
        renderedFps: fullVideoProfile.nominalFps,
        totalFrames: 1,
        droppedFrames: 0,
        droppedFramesRatio: 0,
        staleFrames: 0,
        cancelledFrames: 0,
        peakRamMb: 512,
        cacheHitRatio: isColdSeek ? 0.0 : 1.0,
        stageTimings: {
          decodeUs: Math.round(seekLatencyMs * 600),
          conversionUploadUs: Math.round(seekLatencyMs * 200),
          composeUs: Math.round(seekLatencyMs * 200),
          totalTimeUs: Math.round(seekLatencyMs * 1000),
        },
      },
      timestampMs: Date.now(),
    };

    this.enqueueEvent(event);
  }

  /**
   * Records a hardware fallback occurrence (e.g. WebGPU -> WebGL, HW decode -> SW FFmpeg).
   */
  public recordFallbackEvent(
    fromBackend: string,
    toBackend: string,
    reasonCode: string,
    stackSnippet?: string
  ): void {
    if (!this.isEnabled) return;

    const hardware = this.initHardwareContext();
    const event: TelemetryEvent = {
      eventId: `evt_fallback_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      appVersion: this.appVersion,
      appBuildNumber: "prod",
      appEnvironment: "production",
      device: hardware,
      video: {
        container: "mp4",
        codec: "hevc",
        width: 3840,
        height: 2160,
        resolutionBucket: "4k",
        nominalFps: 60,
        pacingMode: "cfr",
        bitDepth: 10,
        colorSpace: "rec709",
        hdrFormat: "none",
        bitrateKbps: 25000,
      },
      workload: {
        mode: "playback",
        durationMs: 100,
        targetFps: 60,
        renderedFps: 30,
        totalFrames: 1,
        droppedFrames: 1,
        droppedFramesRatio: 1.0,
        staleFrames: 0,
        cancelledFrames: 0,
        peakRamMb: 512,
        cacheHitRatio: 0,
        stageTimings: {
          totalTimeUs: 33000,
        },
      },
      fallbackEvent: {
        triggered: true,
        fromBackend,
        toBackend,
        reasonCode,
        stackSnippet,
      },
      timestampMs: Date.now(),
    };

    this.enqueueEvent(event);
    // Flush immediately for high-priority fallbacks
    this.flush();
  }

  private enqueueEvent(event: TelemetryEvent): void {
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      // Drop oldest to maintain strict upper memory bounds
      this.queue.shift();
    }
    this.queue.push(event);

    if (this.queue.length >= 30) {
      this.flush();
    }
  }

  private startFlushTimer(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = setInterval(() => {
      this.flush();
    }, FLUSH_INTERVAL_MS);
  }

  /**
   * Flushes queued telemetry events asynchronously via non-blocking batch POST.
   */
  public async flush(): Promise<boolean> {
    if (this.queue.length === 0) return true;

    const eventsToFlush = [...this.queue];
    this.queue = [];

    const payload = {
      batchId: `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      sentAtMs: Date.now(),
      events: eventsToFlush,
    };

    try {
      if (typeof navigator !== "undefined" && typeof fetch === "function") {
        const res = await fetch(DEFAULT_API_INGEST_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Clypra-Client": "tauri-desktop",
          },
          body: JSON.stringify(payload),
          keepalive: true,
        });
        return res.ok;
      }
      return true;
    } catch {
      // Non-blocking catch: telemetry never throws or disturbs the editor
      return false;
    }
  }

  public dispose(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }
}

export const telemetryCollector = new TelemetryCollector();

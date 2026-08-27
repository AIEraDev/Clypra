import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Expand, Shrink } from "lucide-react";
import {
  usePlaybackClock,
  usePlaybackControls,
  useTransportControls,
  getPlaybackClock,
} from "@/hooks/usePlaybackClock";
import { useProjectStore } from "@/store/projectStore";
import { useTimelineStore } from "@/store/timelineStore";
import { useUIStore } from "@/store/uiStore";
import { useSettingsStore } from "@/store/settingsStore";
import { getActiveSessionOrNull } from "@/core/runtime/ProjectSession";
import { useViewportState } from "@/hooks/useViewportController";
import { PreviewTransport } from "./PreviewTransport";
import { TransformOverlayMemoized as TransformOverlay } from "../transform/TransformOverlay";
import { SafeOverlay } from "../viewport/SafeOverlay";
import {
  useViewportKeyboardShortcuts,
  useViewportWheelZoom,
  useViewportPan,
} from "../viewport/ViewportControls";
import { calculateDisplayTransform } from "@/lib/utils/coordinateSystem";
import {
  PreviewQualityManager,
  PreviewQualityTier,
} from "./PreviewQualityManager";
import { cn } from "@/lib/utils";
import { AspectRatio } from "@/types";
import { formatTime } from "@/lib/utils/timeFormatting";
import { refitClipsForCanvasChange } from "@/lib/timeline/refitClips";
import { useAudioSyncEngine } from "@/hooks/useAudioSyncEngine";
import { toast } from "@/lib/toast";

import { TelemetryOverlay, type TelemetryStats } from "./TelemetryOverlay";
import { AspectSelector } from "./AspectSelector";
import { PlaybackSpeedSelector } from "./PlaybackSpeedSelector";
import { VolumeControl } from "./VolumeControl";
import { getCanvasBackgroundLayer } from "./canvasBackground";
import { getFrameIndexAtTime, getFrameStartTime } from "@/lib/utils/frameTime";
import { clampAndSnapProgramTime } from "@/lib/timeline/programTimelineBridge";
import { getPlaybackMetricsSnapshot } from "@/core/playback/playbackTrace";
import {
  getSyncMetricsSnapshot,
  startSyncMetricsFlushLoop,
} from "@/lib/playback/syncMetrics";
import {
  nativePerfCollector,
  type NativePerfSpan,
} from "@/core/playback/nativePerfTelemetry";
import type { SeekIntent } from "@/core/playback/seekController";
import {
  getNativePreviewSurfaceGeometry,
  hideNativeSurface,
  cancelNativePreviewRequests,
  isTauriRuntime,
  onNativePreviewWindowMoved,
  presentNativeFrame,
  getNativeFrameServiceStats,
  getNativeSyncMetricsSnapshot,
  getNativeGpuStatus,
  queueNativeFrame,
  registerNativeRasterAsset,
  probeNativeSurface,
  renderNativeFrame,
  resizeNativeSurface,
} from "@/lib/platform/tauri";
import { telemetryCollector } from "@/services/telemetryCollector";
import type { NativeSurfaceGeometry } from "@/lib/platform/nativeCore";

import type { SmartOverlayClip } from "@/types/smartOverlay";
import { KaraokeCaptions } from "@/components/captions/KaraokeCaptions";
import { useCaptionStore } from "@/store/captionStore";
import type { EvaluatedScene } from "@/core/evaluation/types";
import { makeBodyMaskCacheKey, segmentBodyMask } from "@/features/body-effects";
import { useEffectsStore } from "@/features/text-effects/store/effectsStore";

import {
  evaluateTimelineSceneCached,
  type PrecomputedSceneVersions,
} from "@/core/evaluation/evaluator";
import {
  computeClipVersion,
  computeAssetsVersion,
  computeEffectsStoreVersion,
} from "@/core/evaluation/cache";
import {
  buildNativeFrameRequest,
  getNativePreviewBlockers,
  getNativeFrameRequestKey,
  isRenderableNativePreviewFrame,
} from "./nativeVideoPreview";
import {
  NativePreviewFrameScheduler,
  type NativePreviewRequestSource,
} from "./nativePreviewScheduler";
import { NativeRasterBridge } from "@/core/render/nativeRasterBridge";
import { ensureNativeFontsRegistered } from "@/core/fonts/nativeFontRegistry";
import {
  NATIVE_PREVIEW_ONLY,
  type NativeFrameRequest,
  type NativeRasterLayerSnapshot,
} from "@/lib/platform/nativeCore";

const CANVAS_DIMENSIONS: Record<
  Exclude<AspectRatio, "original">,
  { width: number; height: number }
> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "21:9": { width: 2520, height: 1080 },
  "4:3": { width: 1440, height: 1080 },
};

function drawNativeFrameToCanvas(
  canvas: HTMLCanvasElement,
  frame: { rgba: ArrayBuffer; width: number; height: number },
): boolean {
  if (
    frame.width <= 0 ||
    frame.height <= 0 ||
    frame.rgba.byteLength !== frame.width * frame.height * 4
  ) {
    return false;
  }

  if (canvas.width !== frame.width) canvas.width = frame.width;
  if (canvas.height !== frame.height) canvas.height = frame.height;
  const context = canvas.getContext("2d");
  if (!context) return false;

  const image = context.createImageData(frame.width, frame.height);
  image.data.set(new Uint8ClampedArray(frame.rgba));
  context.putImageData(image, 0, 0);
  return true;
}

export const NativeProgramPreview: React.FC = () => {
  const karaokeOverlayEnabled = useCaptionStore((s) => s.karaokeOverlayEnabled);
  const project = useProjectStore((s) => s.project);
  const updateProject = useProjectStore((s) => s.updateProject);
  const mediaAssets = useProjectStore((s) => s.mediaAssets);
  const tracks = useTimelineStore((s) => s.tracks);
  const clips = useTimelineStore((s) => s.clips);
  const transitions = useTimelineStore((s) => s.transitions);
  const epoch = useTimelineStore((s) => s.epoch);
  const clearSelection = useUIStore((s) => s.clearSelection);

  const viewport = useViewportState();

  const previewQuality = useSettingsStore((s) => s.previewQuality);
  const setPreviewQuality = useSettingsStore((s) => s.setPreviewQuality);

  const clockState = usePlaybackClock();
  const clock = getPlaybackClock();
  const { setDuration, setFrameRate } = usePlaybackControls();
  const {
    play: transportPlay,
    pause: transportPause,
    seek: transportSeek,
    setSpeed: transportSetSpeed,
    setActiveContext,
  } = useTransportControls();

  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(100);

  // Tauri Program Preview has one native A/V authority. Browser Web Audio is
  // retained only for browser preview; native failures must surface through
  // the native diagnostics rather than silently switching playback engines.
  useAudioSyncEngine({ volume, muted: isMuted, nativeMode: isTauriRuntime() });
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  const [previewAspectPreset, setPreviewAspectPreset] =
    useState<AspectRatio>("original");
  const [aspectMenuOpen, setAspectMenuOpen] = useState(false);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [showTelemetry, setShowTelemetry] = useState(false);
  const [showSafeOverlay, setShowSafeOverlay] = useState(false);
  const [telemetryStats, setTelemetryStats] = useState<TelemetryStats | null>(
    null,
  );
  const [nativeSurfaceReady, setNativeSurfaceReady] = useState(false);
  // Audit 4.6 fix: mirror nativeSurfaceReady in a ref so the render loop can read the
  // latest value imperatively without nativeSurfaceReady being listed in the effect deps.
  // Having it in deps caused the entire render loop to restart (RAF cancelled, blank frame)
  // on every native surface probe and window resize.
  const nativeSurfaceReadyRef = useRef(false);
  const [nativeSurfacePresenting, setNativeSurfacePresenting] = useState(false);
  const nativeOnlyBlockersKeyRef = useRef("");

  const previewContainerRef = useRef<HTMLDivElement>(null);
  const nativeSurfaceTargetRef = useRef<HTMLDivElement>(null);
  const nativeSurfaceConfiguredRef = useRef(false);
  const nativeSurfaceGeometrySettledRef = useRef(false);
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const previewContainerCallback = useCallback(
    (node: HTMLDivElement | null) => {
      previewContainerRef.current = node;
      setContainerEl(node);
    },
    [],
  );

  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const canvasRef = useCallback((node: HTMLCanvasElement | null) => {
    setCanvasEl(node);
  }, []);

  const [smartOverlayCanvasEl, setSmartOverlayCanvasEl] =
    useState<HTMLCanvasElement | null>(null);
  const smartOverlayCanvasRefObj = useRef<HTMLCanvasElement | null>(null);
  const smartOverlayCanvasRef = useCallback(
    (node: HTMLCanvasElement | null) => {
      smartOverlayCanvasRefObj.current = node;
      setSmartOverlayCanvasEl(node);
    },
    [],
  );

  const aspectMenuRef = useRef<HTMLDivElement>(null);
  const speedMenuRef = useRef<HTMLDivElement>(null);
  const qualityMenuRef = useRef<HTMLDivElement>(null);
  const qualityManagerRef = useRef<PreviewQualityManager | null>(null);
  // Native frames are authoritative for representable scenes. Retaining the
  // last successful frame prevents media-pool updates or native decode latency
  // from blanking the preview while the next exact frame is being decoded.
  const nativeDisplayedFrameRef = useRef<{
    rgba: ArrayBuffer;
    width: number;
    height: number;
  } | null>(null);
  // Persist prefetch identity across native surface/canvas effect restarts.
  // Without this, a remounted render loop could repeatedly warm the same
  // boundary and contend with visible presentation.
  const nativePrefetchStateRef = useRef({
    inFlight: new Map<string, Promise<void>>(),
    completed: new Set<string>(),
    failedAt: new Map<string, number>(),
  });
  const qualityManagerSigRef = useRef<string>("");
  const telemetryRef = useRef(telemetryStats);
  const lastTelemetryFlushRef = useRef(0);
  const showTelemetryRef = useRef(showTelemetry);
  const droppedFramesRef = useRef(0);
  const maxDriftRef = useRef(0);
  const originalCanvasDimsRef = useRef<{
    projectId: string;
    width: number;
    height: number;
  } | null>(null);
  const prevDurationRef = useRef<number>(0);
  const prevFrameRateRef = useRef<number>(0);
  const isMutedRef = useRef(isMuted);
  const volumeRef = useRef(volume);

  isMutedRef.current = isMuted;
  volumeRef.current = volume;

  const renderStateRef = useRef({
    clips,
    tracks,
    transitions,
    mediaAssets,
    project,
    epoch,
    clock,
    clockState,
    canvasWidth: project?.canvasWidth ?? 1920,
    canvasHeight: project?.canvasHeight ?? 1080,
    displayWidth: 0,
    displayHeight: 0,
    // Bug 3 fix: viewport transform values live in the ref so the render loop
    // can read fresh values without these triggering an effect restart on pan/zoom.
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    dpr: window.devicePixelRatio || 1,
    previewQuality,
    // Audit 1.3 fix: version hashes are expensive to compute (O(n log n) sort+hash).
    // Memoize at React-render time (driven by Zustand subscriptions) so the RAF loop
    // can pass them directly to evaluateTimelineSceneCached without rehashing every frame.
    sceneVersions: {
      clipVersion: computeClipVersion(clips, transitions),
      assetsVersion: computeAssetsVersion(mediaAssets),
      effectsStoreVersion: computeEffectsStoreVersion(
        useEffectsStore.getState().definitions,
      ),
    } satisfies PrecomputedSceneVersions,
  });
  // The native render loop is event-driven while paused. React/store changes
  // use this wake-up hook to request exactly one new frame instead of keeping
  // an idle RAF loop alive.
  const wakeNativeRenderLoopRef = useRef<(() => void) | null>(null);

  showTelemetryRef.current = showTelemetry;

  useEffect(() => {
    // Probe native GPU status for accurate hardware telemetry
    if (isTauriRuntime()) {
      getNativeGpuStatus()
        .then((status) => {
          if (status) {
            telemetryCollector.updateFromNativeGpu({
              adapterName: status.adapterName,
              backend: status.backend,
              deviceType: status.deviceType,
            });
          }
        })
        .catch(() => {});
    }

    startSyncMetricsFlushLoop();
    let active = true;
    const flushMetrics = async () => {
      const snapshot = getPlaybackMetricsSnapshot();
      const frontendSync = getSyncMetricsSnapshot();
      const [nativeSync, nativeRender] = await Promise.all([
        getNativeSyncMetricsSnapshot().catch(() => null),
        getNativeFrameServiceStats().catch(() => null),
      ]);
      if (!active) return;

      // Extract current video profile
      const videoAsset = renderStateRef.current.mediaAssets.find(
        (a) => a.type === "video",
      );

      const profile = {
        width:
          videoAsset?.width || renderStateRef.current.project?.canvasWidth || 3840,
        height:
          videoAsset?.height || renderStateRef.current.project?.canvasHeight || 2160,
        nominalFps: renderStateRef.current.project?.frameRate || 60,
      };

      // Feed production telemetry collector in background
      telemetryCollector.recordNativeSyncSnapshot(
        nativeSync,
        nativeRender,
        profile,
      );

      if (!showTelemetryRef.current) {
        setTelemetryStats(null);
        return;
      }

      const hasNativeDrift = Boolean(nativeSync && nativeSync.av_drift.n > 0);
      const hasNativeSeeks = Boolean(nativeSync && nativeSync.seeks.n > 0);
      const lastRender = nativeRender?.lastSample;
      const cacheTotal = snapshot.cacheHits + snapshot.cacheMisses;
      const next: TelemetryStats = {
        avgEvaluationTimeMs: lastRender ? lastRender.decodeTimeUs / 1000 : 0,
        avgRasterTimeMs: lastRender
          ? (lastRender.readbackTimeUs + (lastRender.presentTimeUs ?? 0)) / 1000
          : 0,
        avgTotalTimeMs: lastRender
          ? lastRender.totalTimeUs / 1000
          : (snapshot.seekP95Ms ?? 0),
        cacheHitRate:
          nativeRender?.windowCacheHitRate ??
          (cacheTotal > 0 ? snapshot.cacheHits / cacheTotal : 0),
        active: nativeRender?.windowRequestCount ?? 0,
        droppedFrames: Math.max(
          snapshot.droppedFrames,
          nativeSync?.dropped_frames ?? 0,
          nativeRender?.windowDroppedFrames ?? 0,
        ),
        driftMagnitude: hasNativeDrift
          ? nativeSync!.av_drift.max_abs_micros / 1_000_000
          : snapshot.maxDriftMs / 1000,
        seekP50Ms:
          nativeRender?.windowSeekP50Ms ??
          (hasNativeSeeks
            ? nativeSync!.seeks.avg_latency_micros / 1000
            : snapshot.seekP50Ms),
        seekP95Ms:
          nativeRender?.windowSeekP95Ms ??
          (hasNativeSeeks
            ? nativeSync!.seeks.max_latency_micros / 1000
            : snapshot.seekP95Ms),
        seekP99Ms: snapshot.seekP99Ms,
        avDriftP95Ms: hasNativeDrift
          ? nativeSync!.av_drift.p95_abs_micros / 1000
          : 0,
        uiPlayheadDriftAvgMs: frontendSync.ui_playhead_drift.avg,
        uiPlayheadDriftMaxMs: frontendSync.ui_playhead_drift.maxAbs,
        paintIntervalAvgMs: frontendSync.playhead_paint_jitter.avg,
        framePacingJank: nativeSync?.frame_pacing.jank_events ?? 0,
        nativeSeekAvgMs: hasNativeSeeks
          ? nativeSync!.seeks.avg_latency_micros / 1000
          : null,
        nativeSeekMaxMs: hasNativeSeeks
          ? nativeSync!.seeks.max_latency_micros / 1000
          : null,
        nativeSeekCorrect: hasNativeSeeks ? nativeSync!.seeks.correct : 0,
        nativeSeekCount: hasNativeSeeks ? nativeSync!.seeks.n : 0,
        staleFrames: Math.max(
          snapshot.staleFrames,
          nativeRender?.windowStaleFrames ?? 0,
        ),
        cancelledFrames: Math.max(
          snapshot.cancelledFrames,
          nativeRender?.windowCancelledFrames ?? 0,
        ),
        cacheMisses: nativeRender
          ? nativeRender.cacheMisses
          : snapshot.cacheMisses,
      };
      telemetryRef.current = next;
      setTelemetryStats(next);
    };

    void flushMetrics();
    const pollIntervalMs = showTelemetry ? 250 : 1000;
    const interval = window.setInterval(
      () => void flushMetrics(),
      pollIntervalMs,
    );
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [showTelemetry]);
  renderStateRef.current.clips = clips;
  renderStateRef.current.tracks = tracks;
  renderStateRef.current.transitions = transitions;
  renderStateRef.current.mediaAssets = mediaAssets;
  renderStateRef.current.project = project;
  renderStateRef.current.epoch = epoch;
  renderStateRef.current.clock = clock;
  renderStateRef.current.clockState = clockState;
  renderStateRef.current.dpr = window.devicePixelRatio || 1;
  renderStateRef.current.previewQuality = previewQuality;
  // Audit 1.3 fix: recompute version hashes here (React-render time) rather than in
  // the RAF loop. Zustand only triggers a React render when the relevant slices change,
  // so this runs at most once per actual timeline/effects change, not 60× per second.
  renderStateRef.current.sceneVersions = {
    clipVersion: computeClipVersion(clips, transitions),
    assetsVersion: computeAssetsVersion(mediaAssets),
    effectsStoreVersion: computeEffectsStoreVersion(
      useEffectsStore.getState().definitions,
    ),
  };

  const canvasWidth = project?.canvasWidth ?? 1920;
  const canvasHeight = project?.canvasHeight ?? 1080;

  useViewportKeyboardShortcuts(
    canvasWidth,
    canvasHeight,
    dimensions.width,
    dimensions.height,
  );
  useViewportWheelZoom(previewContainerRef as React.RefObject<HTMLElement>);
  const { isPanning, spacePressed } = useViewportPan(
    previewContainerRef as React.RefObject<HTMLElement>,
  );

  const displayTransform = useMemo(() => {
    return calculateDisplayTransform(
      { width: canvasWidth, height: canvasHeight },
      viewport,
      dimensions.width,
      dimensions.height,
      "fit",
    );
  }, [
    canvasWidth,
    canvasHeight,
    viewport.panX,
    viewport.panY,
    viewport.zoom,
    dimensions.width,
    dimensions.height,
  ]);

  const { scale, offsetX, offsetY, displayWidth, displayHeight } =
    displayTransform;

  // The native presenter is hosted in a transparent child surface positioned
  // over the displayed program viewport and configured only in Tauri.
  useEffect(() => {
    if (
      !isTauriRuntime() ||
      !nativeSurfaceTargetRef.current ||
      displayWidth <= 0 ||
      displayHeight <= 0
    ) {
      return;
    }

    let active = true;
    let syncInFlight = false;
    let syncRequested = false;
    let appliedGeometryKey = "";

    const geometryKey = (geometry: NativeSurfaceGeometry): string =>
      [
        geometry.xPhysical,
        geometry.yPhysical,
        geometry.widthPhysical,
        geometry.heightPhysical,
        geometry.devicePixelRatio,
      ].join(":");

    const syncSurface = () => {
      syncRequested = true;
      if (syncInFlight) return;
      syncInFlight = true;

      void (async () => {
        try {
          while (active && syncRequested) {
            syncRequested = false;
            const target = nativeSurfaceTargetRef.current;
            if (!target) break;

            const geometry = await getNativePreviewSurfaceGeometry(target);
            if (!active) break;
            const nextGeometryKey = geometryKey(geometry);
            if (
              nextGeometryKey === appliedGeometryKey &&
              nativeSurfaceConfiguredRef.current
            )
              continue;

            // Do not keep presenting into the old child-window position while
            // the DOM viewport is moving. Complete the hide before resizing so
            // an older hide cannot race a later native presentation.
            nativeSurfaceGeometrySettledRef.current = false;
            setNativeSurfacePresenting(false);
            await hideNativeSurface().catch(() => undefined);
            if (!active) break;

            if (nativeSurfaceConfiguredRef.current) {
              await resizeNativeSurface(geometry);
            } else {
              await probeNativeSurface(geometry);
              nativeSurfaceConfiguredRef.current = true;
            }
            appliedGeometryKey = nextGeometryKey;
            nativeSurfaceGeometrySettledRef.current = true;
            if (active) {
              nativeSurfaceReadyRef.current = true;
              setNativeSurfaceReady(true);
            }
          }
        } catch (error) {
          nativeSurfaceConfiguredRef.current = false;
          nativeSurfaceGeometrySettledRef.current = false;
          if (active) {
            nativeSurfaceReadyRef.current = false;
            setNativeSurfaceReady(false);
          }
        } finally {
          syncInFlight = false;
          // A ResizeObserver/position sample can arrive while the IPC resize
          // is in flight. Drain the newest geometry instead of losing it.
          if (active && syncRequested) syncSurface();
        }
      })();
    };

    const handleWindowResize = () => syncSurface();

    syncSurface();
    let unlistenWindowMoved: (() => void | Promise<void>) | null = null;
    void onNativePreviewWindowMoved(syncSurface)
      .then((unlisten) => {
        if (active) {
          unlistenWindowMoved = unlisten;
        } else {
          void Promise.resolve(unlisten()).catch(() => undefined);
        }
      })
      .catch(() => undefined);
    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => syncSurface())
        : null;
    resizeObserver?.observe(nativeSurfaceTargetRef.current);
    window.addEventListener("resize", handleWindowResize);

    return () => {
      active = false;
      resizeObserver?.disconnect();
      if (unlistenWindowMoved) {
        void Promise.resolve(unlistenWindowMoved()).catch(() => undefined);
      }
      window.removeEventListener("resize", handleWindowResize);
      nativeSurfaceConfiguredRef.current = false;
      nativeSurfaceGeometrySettledRef.current = false;
      nativeSurfaceReadyRef.current = false;
      setNativeSurfaceReady(false);
      setNativeSurfacePresenting(false);
      void hideNativeSurface().catch(() => undefined);
    };
    // Audit 5.4 fix: empty deps — mount once per component lifetime.
    // The ResizeObserver + window 'resize' handler inside already call syncSurface()
    // on every dimension change; displayWidth/displayHeight in deps caused the effect
    // to re-mount on every pixel change during resize, accumulating window-moved
    // listeners before the async unlistenWindowMoved Promise could resolve and clean up.
  }, []);

  // Keep paused/seeking frames on the DOM canvas. The native surface is a
  // separate child window, so leaving it visible after a pause can make the
  // same frame appear at stale coordinates while the canvas is laid out in
  // the current preview viewport.
  useEffect(() => {
    if (!nativeSurfaceReady || clockState.state === "playing") return;

    setNativeSurfacePresenting(false);
    void hideNativeSurface().catch(() => undefined);
  }, [clockState.state, nativeSurfaceReady]);

  const previewBackgroundLayer = useMemo(() => {
    return getCanvasBackgroundLayer(project?.canvasBackground);
  }, [project?.canvasBackground]);

  renderStateRef.current.displayWidth = displayWidth;
  renderStateRef.current.displayHeight = displayHeight;
  renderStateRef.current.canvasWidth = canvasWidth;
  renderStateRef.current.canvasHeight = canvasHeight;
  // Bug 3 fix: keep viewport transform values in sync so the render loop reads
  // them from the ref instead of from its closure (avoids stale values and loop restarts).
  renderStateRef.current.scale = scale;
  renderStateRef.current.offsetX = offsetX;
  renderStateRef.current.offsetY = offsetY;

  const handlePreviewPointerDownCapture = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      if (isPanning || spacePressed) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-transform-handle]")) return;
      if (target.closest("[data-playhead]")) return;
      clearSelection();
    },
    [clearSelection, isPanning, spacePressed],
  );

  const selectAspectPreset = useCallback(
    (p: AspectRatio) => {
      setPreviewAspectPreset(p);
      setAspectMenuOpen(false);

      if (!project) return;

      if (p === "original") {
        if (originalCanvasDimsRef.current) {
          updateProject({
            canvasWidth: originalCanvasDimsRef.current.width,
            canvasHeight: originalCanvasDimsRef.current.height,
            aspectRatio: "original",
          });
          refitClipsForCanvasChange(
            originalCanvasDimsRef.current.width,
            originalCanvasDimsRef.current.height,
          );
        }
      } else {
        const dims = CANVAS_DIMENSIONS[p];
        updateProject({
          canvasWidth: dims.width,
          canvasHeight: dims.height,
          aspectRatio: p,
        });
        refitClipsForCanvasChange(dims.width, dims.height);
      }
    },
    [project, updateProject],
  );

  // Bug 1 fix: guard on projectId instead of truthiness so the ref is always
  // refreshed when the user switches to a different project without unmounting.
  useEffect(() => {
    if (!project) return;
    if (originalCanvasDimsRef.current?.projectId !== project.id) {
      originalCanvasDimsRef.current = {
        projectId: project.id,
        width: project.canvasWidth,
        height: project.canvasHeight,
      };
    }
  }, [project?.id]);

  useEffect(() => {
    if (!project || !originalCanvasDimsRef.current) return;
    if (project.aspectRatio === "original") {
      // Bug 1 fix: include projectId so the stored value is always project-scoped.
      originalCanvasDimsRef.current = {
        projectId: project.id,
        width: project.canvasWidth,
        height: project.canvasHeight,
      };
    }
  }, [
    project?.canvasWidth,
    project?.canvasHeight,
    project?.aspectRatio,
    project?.id,
  ]);

  useEffect(() => {
    if (project?.aspectRatio) {
      setPreviewAspectPreset(project.aspectRatio);
    }
  }, [project?.id, project?.aspectRatio]);

  useEffect(() => {
    nativeDisplayedFrameRef.current = null;
  }, [project?.id]);

  useEffect(() => {
    if (!project) return;
    const maxEndTime = clips.reduce((max, clip) => {
      const endTime = clip.startTime + clip.duration;
      return Math.max(max, endTime);
    }, 0);
    const newDuration = maxEndTime > 0 ? maxEndTime : 10;
    const newFrameRate = project.frameRate || 30;
    if (newDuration !== prevDurationRef.current) {
      setDuration(newDuration);
      prevDurationRef.current = newDuration;
    }
    if (newFrameRate !== prevFrameRateRef.current) {
      setFrameRate(newFrameRate);
      prevFrameRateRef.current = newFrameRate;
    }
    // Bug 6 fix: narrow from the full `project` object (unstable reference) to only the
    // specific fields this effect actually reads, preventing spurious re-runs every render.
  }, [project?.id, project?.frameRate, clips, setDuration, setFrameRate]);

  // Sync aspect / size ResizeObserver
  useEffect(() => {
    if (!containerEl) return;

    const updateDimensions = () => {
      const newWidth = containerEl.clientWidth;
      const newHeight = containerEl.clientHeight;

      // Bug 7 fix: never reset to (0,0) once dimensions have been established.
      // This can happen transiently when the shared previewContainerCallback
      // fires null during the placeholder → main-view commit (the placeholder
      // unmounts before the real container mounts), causing a momentary preview
      // blank that re-shows the loading placeholder.
      if (newWidth === 0 && newHeight === 0) return;

      setDimensions((prev) => {
        if (prev.width === newWidth && prev.height === newHeight) {
          return prev;
        }
        return { width: newWidth, height: newHeight };
      });
    };
    const resizeObserver = new ResizeObserver(updateDimensions);
    resizeObserver.observe(containerEl);
    updateDimensions();
    window.addEventListener("resize", updateDimensions);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateDimensions);
    };
  }, [containerEl]);

  useEffect(() => {
    if (!project) return;
    const qmSig = `${project.id}:${canvasWidth}x${canvasHeight}`;
    const dprVal = window.devicePixelRatio || 1;
    if (!qualityManagerRef.current || qualityManagerSigRef.current !== qmSig) {
      qualityManagerRef.current = new PreviewQualityManager({
        sequenceWidth: canvasWidth,
        sequenceHeight: canvasHeight,
        viewportWidth: Math.floor(displayWidth),
        viewportHeight: Math.floor(displayHeight),
        dpr: dprVal,
      });
      qualityManagerSigRef.current = qmSig;
    } else {
      qualityManagerRef.current.updateViewport(
        Math.floor(displayWidth),
        Math.floor(displayHeight),
        dprVal,
      );
    }
    // Bug 6 fix: `canvasWidth`/`canvasHeight` already encode the project canvas dimensions;
    // `project?.id` covers project-switch; no need for the full unstable `project` object.
  }, [project?.id, canvasWidth, canvasHeight, displayWidth, displayHeight]);

  // ── Render loop ──────────────────────────────────────────────────
  useEffect(() => {
    // The desktop editor is the native runtime. Browser rendering is kept out
    // of this component so a missing native runtime cannot silently resurrect a
    // second renderer.
    if (!canvasEl || !project || !isTauriRuntime()) return;

    let rafId: number | null = null;
    let isActive = true;
    let renderInFlight = false;
    let forceRenderNeeded = false;
    let lastRenderedFrameIndex = -1;
    let lastRenderedEpoch = -1;
    let lastRenderedTransportRevision = -1;
    let lastRenderedMediaReadyRevision = -1;
    let lastRenderedPlaybackState: "playing" | "paused" | "stopped" = "stopped";
    let lastRenderedClips = renderStateRef.current.clips;
    let lastRenderedTracks = renderStateRef.current.tracks;
    let lastRenderedTransitions = renderStateRef.current.transitions;
    let lastRenderedProject = renderStateRef.current.project;
    let nativeRetryAt = 0;
    let nativeRetryKey = "";
    let nativeFailureKey = "";
    let nativeFailureCount = 0;
    let nativeBlockedKey = "";
    let nativePlaybackInFlight: Promise<void> | null = null;
    let nativeContinuousFailureStreak = 0;
    let nativeDroppedFrameCount = 0;
    let nativeContinuousBlockedRevision = "";
    let nativeContinuousObservedRevision = "";
    let lastSeekTraceKey = "";
    let frameScheduled = false;
    let lastRenderLoopError = "";
    let lastLoggedTextSignature = "";
    let lastLoggedMissingTextSignature = "";
    let lastLoggedTextPresentationSignature = "";
    let lastLoggedTextDropSignature = "";
    const nativePrefetchInFlight = nativePrefetchStateRef.current.inFlight;
    const nativePrefetchCompleted = nativePrefetchStateRef.current.completed;
    const nativePrefetchFailedAt = nativePrefetchStateRef.current.failedAt;

    // Native frame decode/presentation is asynchronous. A small measured
    // look-ahead keeps the frame that completes aligned with the audio clock
    // instead of presenting the frame that was current when decoding started.
    let nativePresentationLatencyMs = 0;
    let nativeSurfaceShown = false;
    let lastNativePlaybackRequestKey = "";
    let visibleRequestKey = "";
    const seekController =
      getActiveSessionOrNull()?.transportAuthority?.getSeekController();
    let latestSeekIntent: SeekIntent | null =
      seekController?.getCurrent() ?? null;
    let visibleRequestGeneration = seekController?.getGeneration() ?? 0;
    let transportRevision = 0;
    const nativeRasterBridge = new NativeRasterBridge();
    const nativeBodyMaskInFlight = new Map<
      string,
      Promise<NativeRasterLayerSnapshot | null>
    >();
    const nativeBodyMaskAssetsById = new Map<
      string,
      NativeRasterLayerSnapshot & { rgba: number[] }
    >();
    const registeredNativeBodyMaskAssets = new Set<string>();
    const nativeFrontendPerfSpans = new Map<string, NativePerfSpan>();
    const maxNativeBodyMaskCacheEntries = 90;

    const ensureNativeBodyMaskAssetRegistered = async (
      asset: NativeRasterLayerSnapshot & { rgba: number[] },
      force = false,
    ): Promise<void> => {
      nativeBodyMaskAssetsById.set(asset.assetId, asset);
      while (nativeBodyMaskAssetsById.size > maxNativeBodyMaskCacheEntries) {
        const oldestId = nativeBodyMaskAssetsById.keys().next().value as
          | string
          | undefined;
        if (!oldestId) break;
        nativeBodyMaskAssetsById.delete(oldestId);
        registeredNativeBodyMaskAssets.delete(oldestId);
      }
      if (!force && registeredNativeBodyMaskAssets.has(asset.assetId)) return;
      await registerNativeRasterAsset(asset);
      registeredNativeBodyMaskAssets.add(asset.assetId);
    };

    /**
     * Promote completed WebView segmentation results into immutable native
     * mask assets. Segmentation remains demand-driven and in-flight work is
     * deduplicated, so a missing mask never blocks or thrashes the preview.
     */
    const rasterizeNativeBodyMasks = async (
      scene: EvaluatedScene,
      videoElements: Map<string, HTMLVideoElement>,
    ): Promise<NativeRasterLayerSnapshot[]> => {
      if (!isTauriRuntime()) return [];
      const assets: NativeRasterLayerSnapshot[] = [];
      const mediaLayers = scene.visualLayers.filter(
        (
          layer,
        ): layer is import("@/core/evaluation/types").EvaluatedMediaLayer =>
          layer.layerType === "media",
      );

      for (const layer of mediaLayers) {
        const bodyEffects = (layer.effects ?? []).filter((effect) => {
          const renderer = (effect.renderer || effect.effectId)
            .replace(/^fx-/, "")
            .replace(/-/g, "_")
            .toLowerCase();
          return (
            effect.intensity > 0.001 &&
            [
              "body_outline",
              "body_glow",
              "body_segmentation_glow",
              "body_particles",
            ].includes(renderer)
          );
        });
        if (bodyEffects.length === 0) continue;

        const source = videoElements.get(`${layer.clipId}-${layer.mediaId}`);
        if (!source || source.readyState < HTMLMediaElement.HAVE_CURRENT_DATA)
          continue;
        const width = Math.max(1, Math.floor(source.videoWidth || layer.width));
        const height = Math.max(
          1,
          Math.floor(source.videoHeight || layer.height),
        );

        for (const effect of bodyEffects) {
          const renderer = (effect.renderer || effect.effectId)
            .replace(/^fx-/, "")
            .replace(/-/g, "_")
            .toLowerCase();
          const maskKey = makeBodyMaskCacheKey({
            clipId: layer.clipId,
            effectId: effect.effectId,
            renderer,
            time: layer.sourceTime,
            width,
            height,
          });
          const baseAssetId = `${layer.layerId}_${effect.effectId}`;
          const assetId = `${baseAssetId}:${maskKey}`;
          const cachedAsset = nativeBodyMaskAssetsById.get(assetId);
          if (cachedAsset) {
            assets.push({ ...cachedAsset, rgba: undefined });
            continue;
          }

          let pending = nativeBodyMaskInFlight.get(assetId);
          if (!pending) {
            pending = segmentBodyMask(source, {
              clipId: layer.clipId,
              effectId: effect.effectId,
              renderer,
              time: layer.sourceTime,
              width,
              height,
            })
              .then(async (mask) => {
                if (!mask) return null;
                const nativeAsset: NativeRasterLayerSnapshot & {
                  rgba: number[];
                } = {
                  assetId,
                  rgba: Array.from(mask.data),
                  width: mask.width,
                  height: mask.height,
                  x: 0,
                  y: 0,
                  rotation: 0,
                  opacity: 0,
                  zIndex: -2147483648,
                  blendMode: "normal",
                  isMask: true,
                };
                await ensureNativeBodyMaskAssetRegistered(nativeAsset);
                return nativeAsset;
              })
              .catch(() => {
                return null;
              })
              .finally(() => {
                nativeBodyMaskInFlight.delete(assetId);
              });
            nativeBodyMaskInFlight.set(assetId, pending);
            void pending.then(() => {
              // Audit finding 3 fix: use scheduleNextFrame() instead of a raw
              // window.requestAnimationFrame call. The raw call bypassed the
              // frameScheduled guard (risking a concurrent render loop), skipped
              // setting rafId (so unmount cleanup couldn't cancel it), and left
              // frameScheduled in an inconsistent state for the rest of the loop's life.
              if (isActive) scheduleNextFrame();
            });
          }
        }
      }
      return assets;
    };

    const reRegisterTextAssetsForRequest = async (
      request: NativeFrameRequest,
    ): Promise<boolean> => {
      const references = request.project.rasterLayers ?? [];
      if (references.length === 0) return false;
      const bridgeReferences = references.filter(
        (reference) =>
          reference.isText ||
          reference.assetId.startsWith("native-background:") ||
          reference.assetId.startsWith("native-image:") ||
          reference.assetId.startsWith("native-sticker:") ||
          reference.assetId.startsWith("native-smart-overlay:"),
      );
      const maskAssets = references
        .map((reference) => nativeBodyMaskAssetsById.get(reference.assetId))
        .filter(
          (asset): asset is NativeRasterLayerSnapshot & { rgba: number[] } =>
            Boolean(asset),
        );
      if (bridgeReferences.length + maskAssets.length !== references.length)
        return false;
      const [bridgeReregistered] = await Promise.all([
        nativeRasterBridge.reregister(bridgeReferences),
        ...maskAssets.map((asset) =>
          ensureNativeBodyMaskAssetRegistered(asset, true),
        ),
      ]);
      return bridgeReregistered;
    };

    const ensureNativeRequestFonts = async (
      request: NativeFrameRequest,
    ): Promise<void> => {
      const fontIds = (request.project.textLayers ?? []).map(
        (layer) => layer.fontId,
      );
      if (fontIds.length === 0) return;
      try {
        await ensureNativeFontsRegistered(fontIds);
      } catch (error) {
        console.error("[native-preview] font-registration-failed", {
          fontIds,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    };

    const nativePreviewScheduler = new NativePreviewFrameScheduler({
      maxCacheEntries: 12,
      maxInFlight: 2,
      load: async (request, signal) => {
        if (signal?.aborted) {
          throw new DOMException(
            "Native preview request cancelled",
            "AbortError",
          );
        }
        const requestKey = getNativeFrameRequestKey(request);
        const frontendSpan = nativePerfCollector.isEnabled()
          ? nativePerfCollector.begin(request)
          : null;
        frontendSpan?.markDispatchStarted();
        if (frontendSpan) nativeFrontendPerfSpans.set(requestKey, frontendSpan);
        const render = async () => {
          frontendSpan?.markIpcStarted();
          try {
            return await renderNativeFrame(request);
          } finally {
            frontendSpan?.markIpcFinished();
          }
        };
        let rgba: ArrayBuffer;
        try {
          await ensureNativeRequestFonts(request);
          rgba = await render();
        } catch (error) {
          if (!(await reRegisterTextAssetsForRequest(request))) throw error;
          rgba = await render();
        }
        if (
          !isRenderableNativePreviewFrame(
            rgba,
            request.outputWidth,
            request.outputHeight,
          )
        ) {
          throw new Error("Native preview returned an invalid frame payload");
        }
        return {
          rgba,
          width: request.outputWidth,
          height: request.outputHeight,
        };
      },
    });

    const unsubscribeSeekIntent = seekController?.subscribe((intent) => {
      latestSeekIntent = intent;
      visibleRequestGeneration = Math.max(
        visibleRequestGeneration,
        intent.generation,
      );
      nativePreviewScheduler.setVisibleGeneration(intent.generation);
      void cancelNativePreviewRequests(intent.generation).catch(
        () => undefined,
      );
      forceRenderNeeded = true;
    });

    const presentNativePlaybackFrame = async (request: NativeFrameRequest) => {
      const present = () =>
        queueNativeFrame(request).then(() => presentNativeFrame(request));
      try {
        await ensureNativeRequestFonts(request);
        return await present();
      } catch (error) {
        if (!(await reRegisterTextAssetsForRequest(request))) throw error;
        return present();
      }
    };

    const nativeTextDebugSummary = (request: NativeFrameRequest) =>
      (request.project.textLayers ?? []).map((layer) => ({
        text: layer.text.slice(0, 80),
        fontId: layer.fontId,
        fontWeight: layer.fontWeight,
        fontStyle: layer.fontStyle,
        effectId: layer.effect?.effectId,
        effectVersion: layer.effect?.effectVersion,
      }));

    /**
     * Warm the native caches before a visual clip boundary reaches the audio
     * clock. The visible RAF never awaits this work: image registration,
     * animated asset rasterization, body-mask generation, native text SDF
     * compilation, and decode-ahead all happen on the low-priority path.
     */
    const prefetchNativeFrame = (frameIndex: number): void => {
      const state = renderStateRef.current;
      const project = state.project;
      if (!project || state.clock.state !== "playing" || !isTauriRuntime()) return;

      const frameRate = Math.max(1, project.frameRate ?? 30);
      const durationFrames = Math.max(1, Math.ceil(state.clock.duration * frameRate));
      const targetFrame = Math.min(durationFrames - 1, Math.max(0, Math.floor(frameIndex)));
      const revision = `${project.id ?? "unknown-project"}:${state.epoch}`;
      const key = `${revision}:${targetFrame}`;
      if (
        nativePrefetchCompleted.has(key) ||
        nativePrefetchInFlight.has(key)
      ) {
        return;
      }
      const previousFailureAt = nativePrefetchFailedAt.get(key) ?? 0;
      if (performance.now() - previousFailureAt < 1000) return;
      // Keep warm-up behind the visible playback path. A full native decode
      // can be CPU-heavy, and two concurrent look-ahead jobs were enough to
      // contend with surface presentation and reintroduce playback stutter.
      // One nearby boundary is sufficient: text/image assets remain cached
      // after that frame and do not need a second adjacent-frame prefetch.
      if (nativePlaybackInFlight || nativePrefetchInFlight.size >= 1) return;

      const task = (async () => {
        const time = getFrameStartTime(targetFrame / frameRate, frameRate);
        const scene = evaluateTimelineSceneCached(
          time,
          state.clips,
          state.tracks,
          state.mediaAssets,
          project,
          state.epoch,
          state.transitions,
          state.sceneVersions,
        );
        const bridgeRasters = await nativeRasterBridge.rasterize(scene, {
          frameKey: targetFrame,
        });
        const bodyMasks = await rasterizeNativeBodyMasks(
          scene,
          getActiveSessionOrNull()?.getPreviewVideoElements() ?? new Map(),
        );
        const activeSmartClips = state.clips.filter(
          (clip): clip is SmartOverlayClip =>
            clip.kind === "smart-overlay" &&
            time >= clip.startTime &&
            time < clip.startTime + clip.duration,
        );
        const smartOverlays = await nativeRasterBridge.rasterizeSmartOverlays(
          activeSmartClips,
          time,
          state.canvasWidth,
          state.canvasHeight,
          { frameKey: targetFrame },
        );
        const request = buildNativeFrameRequest(
          scene,
          revision,
          targetFrame,
          frameRate,
          state.canvasWidth,
          state.canvasHeight,
          [...bridgeRasters, ...bodyMasks, ...smartOverlays],
          { mode: "prefetch", quality: "full" },
        );
        if (!request) return;

        const requestTextLayers = request.project.textLayers ?? [];
        if (requestTextLayers.length > 0) {
          console.debug("[native-preview] text-prefetch-ready", {
            frameIndex: targetFrame,
            textLayerCount: requestTextLayers.length,
            textLayers: nativeTextDebugSummary(request),
          });
        }

        const current = renderStateRef.current;
        if (
          !isActive ||
          current.project?.id !== project.id ||
          current.epoch !== state.epoch ||
          current.clock.state !== "playing"
        ) {
          return;
        }
        await ensureNativeRequestFonts(request);
        await queueNativeFrame(request);
        nativePrefetchCompleted.add(key);
        nativePrefetchFailedAt.delete(key);
      })()
        .catch((error) => {
          nativePrefetchFailedAt.set(key, performance.now());
          console.error("[native-preview] prefetch-failed", {
            frameIndex: targetFrame,
            revision,
            error: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          nativePrefetchInFlight.delete(key);
        });

      nativePrefetchInFlight.set(key, task);
    };

    const prefetchUpcomingNativeFrames = (currentFrame: number): void => {
      const state = renderStateRef.current;
      if (!state.project || state.clock.state !== "playing") return;
      const frameRate = Math.max(1, state.project.frameRate ?? 30);
      const currentTime = getFrameStartTime(currentFrame / frameRate, frameRate);
      const prefetchHorizonFrame = currentFrame + Math.ceil(frameRate * 3);
      const durationFrames = Math.max(1, Math.ceil(state.clock.duration * frameRate));
      const candidates = new Set<number>();

      // Target activation boundaries rather than every adjacent frame. The
      // retained surface already queues its measured playback look-ahead;
      // this path exists to prepare the expensive first-use assets for a
      // layer that begins several seconds ahead without competing with the
      // currently visible video decode.
      for (const clip of state.clips) {
        if (clip.kind === "audio" || clip.startTime <= currentTime) continue;
        const boundary = Math.min(
          durationFrames - 1,
          Math.max(currentFrame + 1, Math.ceil(clip.startTime * frameRate)),
        );
        if (boundary <= prefetchHorizonFrame) candidates.add(boundary);
      }

      [...candidates]
        .filter((frame) => frame > currentFrame && frame < durationFrames)
        .sort((left, right) => left - right)
        .slice(0, 1)
        .forEach(prefetchNativeFrame);
    };

    const scheduleNextFrame = () => {
      if (!isActive || frameScheduled) return;
      frameScheduled = true;
      rafId = requestAnimationFrame(() => {
        frameScheduled = false;
        void renderLoop();
      });
    };
    wakeNativeRenderLoopRef.current = scheduleNextFrame;

    const renderLoop = async () => {
      if (!isActive || renderInFlight) return;
      renderInFlight = true;

      try {
        const state = renderStateRef.current;
        const timeToRender = state.clock.time;
        const playbackState = state.clock.state;
        const isPlaying = playbackState === "playing";

        const frameRate = state.project?.frameRate ?? 30;
        const frameIndex = getFrameIndexAtTime(timeToRender, frameRate);
        const frameStartTime = getFrameStartTime(timeToRender, frameRate);
        const requestIntent = latestSeekIntent
          ? {
              generation: latestSeekIntent.generation,
              mode:
                isPlaying && latestSeekIntent.mode !== "scrub"
                  ? ("playback" as const)
                  : latestSeekIntent.mode,
              quality:
                isPlaying && latestSeekIntent.mode !== "scrub"
                  ? ("full" as const)
                  : latestSeekIntent.quality,
              velocityPxPerSecond: latestSeekIntent.velocityPxPerSecond,
              requestedAtMs: latestSeekIntent.issuedAtMs,
            }
          : isPlaying
            ? { mode: "playback" as const, quality: "full" as const }
            : undefined;

        const timeChanged = frameIndex !== lastRenderedFrameIndex;
        const epochChanged = state.epoch !== lastRenderedEpoch;
        const transportChanged =
          transportRevision !== lastRenderedTransportRevision;
        const isFirstFrame = lastRenderedFrameIndex === -1;

        // Bug 2/3 fix: hoist all change-detection variables to before the heavy
        // async rasterization and IPC calls. If nothing could have changed visually
        // since the last rendered frame, exit immediately — cutting per-RAF CPU cost
        // to near-zero during steady paused sessions or locked-off playback.
        const clipsChanged = state.clips !== lastRenderedClips;
        const tracksChanged = state.tracks !== lastRenderedTracks;
        const transitionsChanged =
          state.transitions !== lastRenderedTransitions;
        const projectChanged = state.project !== lastRenderedProject;

        const session = getActiveSessionOrNull();
        const mediaReadyRevision = session?.getPreviewMediaReadyRevision() ?? 0;
        const mediaReadyChanged =
          mediaReadyRevision !== lastRenderedMediaReadyRevision;

        const mightNeedRender =
          isPlaying ||
          timeChanged ||
          epochChanged ||
          transportChanged ||
          isFirstFrame ||
          forceRenderNeeded ||
          clipsChanged ||
          tracksChanged ||
          transitionsChanged ||
          projectChanged ||
          mediaReadyChanged;

        if (!mightNeedRender) return;

        const scene = evaluateTimelineSceneCached(
          frameStartTime,
          state.clips,
          state.tracks,
          state.mediaAssets,
          state.project,
          state.epoch,
          state.transitions,
          state.sceneVersions,
        );
        const nativeBridgeRasters = await nativeRasterBridge.rasterize(scene, {
          frameKey: frameIndex,
        });
        const nativeBodyMasks = await rasterizeNativeBodyMasks(
          scene,
          session?.getPreviewVideoElements() ?? new Map(),
        );
        const nativeActiveSmartClips = state.clips.filter(
          (clip): clip is SmartOverlayClip =>
            clip.kind === "smart-overlay" &&
            frameStartTime >= clip.startTime &&
            // Audit 3.5 fix: use strict < to match the evaluator's boundary convention
            // (startTime <= evalTime < clipEnd). Was <= which rendered overlays one extra frame.
            frameStartTime < clip.startTime + clip.duration,
        );
        const nativeSmartOverlays =
          await nativeRasterBridge.rasterizeSmartOverlays(
            nativeActiveSmartClips,
            frameStartTime,
            state.canvasWidth,
            state.canvasHeight,
            { frameKey: frameIndex },
          );
        const nativeRasterLayers = [
          ...nativeBridgeRasters,
          ...nativeBodyMasks,
          ...nativeSmartOverlays,
        ];
        const nativeRequest = buildNativeFrameRequest(
          scene,
          `${state.project?.id ?? "unknown-project"}:${state.epoch}`,
          frameIndex,
          frameRate,
          state.canvasWidth,
          state.canvasHeight,
          nativeRasterLayers,
          requestIntent,
        );
        const textLayers = nativeRequest?.project.textLayers ?? [];
        const sceneTextLayers = scene.visualLayers.filter(
          (layer) => layer.layerType === "text",
        );
        const missingTextSignature = sceneTextLayers
          .map((layer) => `${layer.layerId}|${layer.text}`)
          .join("\u001f");
        const textSignature = textLayers
          .map(
            (layer) =>
              `${layer.text}|${layer.fontId}|${layer.fontWeight ?? ""}|${layer.fontStyle ?? ""}|${layer.effect?.effectId ?? ""}`,
          )
          .join("\u001f");
        if (
          !nativeRequest &&
          sceneTextLayers.length > 0 &&
          missingTextSignature !== lastLoggedMissingTextSignature
        ) {
          lastLoggedMissingTextSignature = missingTextSignature;
          console.error("[native-preview] text-request-not-built", {
            frameIndex,
            textLayerCount: sceneTextLayers.length,
            blockers: getNativePreviewBlockers(scene, nativeRasterLayers),
          });
        }
        if (textLayers.length > 0 && textSignature !== lastLoggedTextSignature) {
          lastLoggedTextSignature = textSignature;
          console.debug("[native-preview] text-request-ready", {
            frameIndex,
            textLayerCount: textLayers.length,
            textLayers: nativeTextDebugSummary(nativeRequest!),
          });
        }
        if (isPlaying) prefetchUpcomingNativeFrames(frameIndex);
        let nativePlaybackRequest = nativeRequest;
        if (isPlaying && nativeRequest && nativePresentationLatencyMs > 0) {
          const leadFrames = Math.min(
            6,
            Math.max(
              0,
              Math.round((nativePresentationLatencyMs * frameRate) / 1000),
            ),
          );
          if (leadFrames > 0) {
            const durationFrames = Math.max(
              1,
              Math.ceil(state.clock.duration * frameRate),
            );
            const lookAheadFrame = Math.min(
              durationFrames - 1,
              frameIndex + leadFrames,
            );
            if (lookAheadFrame !== frameIndex) {
              const lookAheadTime = getFrameStartTime(
                lookAheadFrame / frameRate,
                frameRate,
              );
              const lookAheadScene = evaluateTimelineSceneCached(
                lookAheadTime,
                state.clips,
                state.tracks,
                state.mediaAssets,
                state.project,
                state.epoch,
                state.transitions,
                state.sceneVersions,
              );
              const lookAheadBridgeRasters = await nativeRasterBridge.rasterize(
                lookAheadScene,
                { frameKey: lookAheadFrame },
              );
              const lookAheadSmartClips = state.clips.filter(
                (clip): clip is SmartOverlayClip =>
                  clip.kind === "smart-overlay" &&
                  lookAheadTime >= clip.startTime &&
                  // Bug 4 fix: use strict < to match the evaluator boundary convention
                  // (startTime <= evalTime < clipEnd). The visible-frame path at line
                  // 1015 was already corrected; the look-ahead path had the same bug.
                  lookAheadTime < clip.startTime + clip.duration,
              );
              const lookAheadSmartOverlays =
                await nativeRasterBridge.rasterizeSmartOverlays(
                  lookAheadSmartClips,
                  lookAheadTime,
                  state.canvasWidth,
                  state.canvasHeight,
                  { frameKey: lookAheadFrame },
                );
              nativePlaybackRequest =
                buildNativeFrameRequest(
                  lookAheadScene,
                  `${state.project?.id ?? "unknown-project"}:${state.epoch}`,
                  lookAheadFrame,
                  frameRate,
                  state.canvasWidth,
                  state.canvasHeight,
                  [...lookAheadBridgeRasters, ...lookAheadSmartOverlays],
                  requestIntent
                    ? { ...requestIntent, mode: "playback-lookahead" as const }
                    : {
                        mode: "playback-lookahead" as const,
                        quality: "full" as const,
                      },
                ) ?? nativeRequest;
            }
          }
        }
        const nativeRequestKey = nativeRequest
          ? getNativeFrameRequestKey(nativeRequest)
          : "";
        if (state.clock.isSeeking) {
          const seekTraceKey = `${playbackState}:${frameIndex}:${nativeRequestKey || "no-native-request"}`;
          if (seekTraceKey !== lastSeekTraceKey) {
            lastSeekTraceKey = seekTraceKey;
          }
        } else {
          lastSeekTraceKey = "";
        }
        if (nativeRequestKey !== nativeRetryKey) {
          nativeRetryKey = nativeRequestKey;
          nativeRetryAt = 0;
          nativeFailureKey = nativeRequestKey;
          nativeFailureCount = 0;
          nativeBlockedKey = "";
        }
        if (nativeRequestKey !== visibleRequestKey) {
          visibleRequestKey = nativeRequestKey;
          visibleRequestGeneration += 1;
          nativePreviewScheduler.setVisibleGeneration();
        }
        const targetGeneration = visibleRequestGeneration;
        // Do not hand the visible surface to native video until native audio has
        // supplied its first hardware-clock sample. Before that point the
        // Wait for the native audio clock before handing continuous playback to
        // the retained surface; readback remains available while it initializes.
        const nativeAudioClockReady =
          !isTauriRuntime() || state.clock.hasNativeClockPosition;
        const nativePlaybackPath =
          isTauriRuntime() &&
          Boolean(nativePlaybackRequest) &&
          isPlaying &&
          nativeAudioClockReady;
        const nativePausedPath =
          isTauriRuntime() && Boolean(nativeRequest) && !isPlaying;
        // The retained native surface owns every desktop frame state. A paused
        // frame uses the exact request; playback may use the latency-compensated
        // look-ahead request above.
        const nativePlaybackRequestKey = nativePlaybackRequest
          ? getNativeFrameRequestKey(nativePlaybackRequest)
          : nativeRequestKey;
        const nativeOnlyMode = isTauriRuntime() && NATIVE_PREVIEW_ONLY;
        const nativeOnlySceneBlocked = nativeOnlyMode && !nativeRequest;
        // Audit 4.6 fix: read nativeSurfaceReadyRef.current (imperative ref) rather than
        // the React state `nativeSurfaceReady` to avoid having the state in the effect deps.
        const nativeSurfaceReadyNow = nativeSurfaceReadyRef.current;
        if (nativeOnlyMode) {
          const blockers = [
            ...(!nativeRequest
              ? getNativePreviewBlockers(scene, nativeRasterLayers)
              : []),
            ...(!nativeSurfaceReadyNow
              ? ["The retained native wgpu surface is not ready."]
              : []),
          ];
          const blockerKey = blockers.join("\n");
          if (nativeOnlyBlockersKeyRef.current !== blockerKey) {
            nativeOnlyBlockersKeyRef.current = blockerKey;
            if (blockers.length > 0) {
              toast.error(
                ["Native-only preview", ...blockers].join("\n"),
                { id: "native-only-preview-blocked", duration: 6000 },
              );
            } else {
              toast.dismiss("native-only-preview-blocked");
            }
          }
        } else if (nativeOnlyBlockersKeyRef.current) {
          nativeOnlyBlockersKeyRef.current = "";
          toast.dismiss("native-only-preview-blocked");
        }
        const nativeRevision = `${state.project?.id ?? "unknown-project"}:${state.epoch}`;
        if (nativeRevision !== nativeContinuousObservedRevision) {
          nativeContinuousObservedRevision = nativeRevision;
          nativeContinuousFailureStreak = 0;
          nativeContinuousBlockedRevision = "";
        }
        const nativeSurfaceUsable =
          nativeSurfaceReadyNow &&
          nativeSurfaceGeometrySettledRef.current &&
          nativeContinuousBlockedRevision !== nativeRevision;
        const nativeSurfaceOwnsCurrentFrame =
          nativeSurfaceShown &&
          lastNativePlaybackRequestKey === nativePlaybackRequestKey &&
          (!isPlaying || nativeAudioClockReady) &&
          nativeSurfaceUsable;
        const nativeDirectSurfacePath =
          nativeSurfaceUsable &&
          Boolean(nativeRequest) &&
          (nativePlaybackPath || nativePausedPath);
        const nativeReadbackFallbackPath =
          isPlaying && nativePlaybackPath && !nativeSurfaceUsable;
        if (
          nativeSurfaceShown &&
          !nativeDirectSurfacePath &&
          !nativeSurfaceOwnsCurrentFrame
        ) {
          nativeSurfaceShown = false;
          lastNativePlaybackRequestKey = "";
          setNativeSurfacePresenting(false);
          void hideNativeSurface().catch(() => undefined);
        }
        const cachedNativeFrame =
          nativeRequestKey !== ""
            ? nativePreviewScheduler.getCached(nativeRequestKey)
            : null;
        const nativePausedReadbackPath = nativePausedPath;
        const nativeFrameNeedsRetry =
          nativePausedReadbackPath &&
          Boolean(nativeRequest) &&
          !cachedNativeFrame &&
          nativeBlockedKey !== nativeRequestKey &&
          performance.now() >= nativeRetryAt;
        const targetStillCurrent = (
          requireExactFrame: boolean = !isPlaying,
        ) => {
          const current = renderStateRef.current;
          return (
            isActive &&
            visibleRequestGeneration === targetGeneration &&
            current.project?.id === state.project?.id &&
            current.epoch === state.epoch &&
            current.clock.state === playbackState &&
            (!requireExactFrame ||
              getFrameIndexAtTime(current.clock.time, frameRate) === frameIndex)
          );
        };

        // Continuous native presentation is intentionally non-blocking. The
        // render loop keeps the last accepted native frame while one request is
        // in flight, preventing native decode latency from stalling playback.
        if (
          (nativeDirectSurfacePath || nativeReadbackFallbackPath) &&
          nativeRequest &&
          (isPlaying ? !cachedNativeFrame : true) &&
          nativeBlockedKey !== nativeRequestKey &&
          performance.now() >= nativeRetryAt &&
          !nativePlaybackInFlight
        ) {
          const requestToPresent =
            isPlaying
              ? nativePlaybackRequest ?? nativeRequest
              : nativeRequest;
          if (requestToPresent) {
            const requestKey = getNativeFrameRequestKey(requestToPresent);
            if (requestKey !== lastNativePlaybackRequestKey) {
              lastNativePlaybackRequestKey = requestKey;
              const requestStartedAt = performance.now();
              const requestSource: NativePreviewRequestSource = {
                requestKey,
                frameIndex: requestToPresent.frameTime.frameIndex,
                request: requestToPresent,
                generation: targetGeneration,
              };

              if (nativeSurfaceUsable) {
                const frontendSpan = nativePerfCollector.isEnabled()
                  ? nativePerfCollector.begin(requestToPresent)
                  : null;
                frontendSpan?.markDispatchStarted();
                frontendSpan?.markIpcStarted();
                nativePlaybackInFlight = presentNativePlaybackFrame(
                  requestToPresent,
                )
                  .then((presentation) => {
                    frontendSpan?.markIpcFinished();
                    const elapsedMs = performance.now() - requestStartedAt;
                    nativePresentationLatencyMs =
                      nativePresentationLatencyMs > 0
                        ? nativePresentationLatencyMs * 0.75 + elapsedMs * 0.25
                        : elapsedMs;
                    if (!presentation.presented) {
                      const droppedTextLayers =
                        requestToPresent.project.textLayers ?? [];
                      const droppedTextSignature = droppedTextLayers
                        .map(
                          (layer) =>
                            `${layer.text}|${layer.fontId}|${layer.fontWeight ?? ""}|${layer.effect?.effectId ?? ""}`,
                        )
                        .join("\u001f");
                      if (
                        droppedTextLayers.length > 0 &&
                        droppedTextSignature !== lastLoggedTextDropSignature
                      ) {
                        lastLoggedTextDropSignature = droppedTextSignature;
                        console.warn("[native-preview] text-surface-dropped", {
                          frameIndex: requestToPresent.frameTime.frameIndex,
                          dropped: presentation.dropped,
                          stale: presentation.stale,
                          frameAgeTicks: presentation.frameAgeTicks,
                          audioPositionTicks: presentation.audioPositionTicks,
                          textLayers: nativeTextDebugSummary(requestToPresent),
                        });
                      }
                      frontendSpan?.finish({
                        dropped: presentation.dropped,
                        stale: presentation.stale === true,
                      });
                      lastNativePlaybackRequestKey = "";
                      if (presentation.dropped) {
                        nativeDroppedFrameCount += 1;
                      }
                    } else {
                      frontendSpan?.finish();
                      const current = renderStateRef.current;
                      const currentRequestIsStillAuthoritative =
                        requestKey === nativeRequestKey || isPlaying;
                      if (
                        isActive &&
                        nativeSurfaceGeometrySettledRef.current &&
                        current.project?.id === state.project?.id &&
                        current.epoch === state.epoch &&
                        current.clock.state !== "stopped" &&
                        currentRequestIsStillAuthoritative
                      ) {
                        const presentedTextLayers =
                          requestToPresent.project.textLayers ?? [];
                        const presentationTextSignature = presentedTextLayers
                          .map(
                            (layer) =>
                              `${layer.text}|${layer.fontId}|${layer.fontWeight ?? ""}|${layer.effect?.effectId ?? ""}`,
                          )
                          .join("\u001f");
                        if (
                          presentedTextLayers.length > 0 &&
                          presentationTextSignature !==
                            lastLoggedTextPresentationSignature
                        ) {
                          lastLoggedTextPresentationSignature =
                            presentationTextSignature;
                          console.debug("[native-preview] text-surface-presented", {
                            frameIndex: requestToPresent.frameTime.frameIndex,
                            textLayers: nativeTextDebugSummary(requestToPresent),
                            presented: presentation.presented,
                            dropped: presentation.dropped,
                            stale: presentation.stale,
                          });
                        }
                        nativeSurfaceShown = true;
                        if (nativeSurfaceReadyRef.current) {
                          setNativeSurfacePresenting(true);
                        }
                      } else if (presentation.presented) {
                        if (lastNativePlaybackRequestKey === requestKey) {
                          lastNativePlaybackRequestKey = "";
                          nativeSurfaceShown = false;
                          setNativeSurfacePresenting(false);
                          void hideNativeSurface().catch(() => undefined);
                        }
                      }
                    }
                  })
                  .catch((error) => {
                    console.error("[native-preview] surface-present-failed", {
                      frameIndex: requestToPresent.frameTime.frameIndex,
                      requestKey,
                      textLayers: nativeTextDebugSummary(requestToPresent),
                      error: error instanceof Error ? error.message : String(error),
                    });
                    frontendSpan?.markIpcFinished();
                    frontendSpan?.finish({ dropped: true });
                    nativeContinuousFailureStreak += 1;
                    lastNativePlaybackRequestKey = "";
                    if (nativeContinuousFailureStreak >= 3) {
                      nativeContinuousBlockedRevision = nativeRevision;
                    }
                    nativeRetryAt = performance.now() + 250;
                    if (nativeSurfaceShown) {
                      nativeSurfaceShown = false;
                      lastNativePlaybackRequestKey = "";
                      setNativeSurfacePresenting(false);
                      void hideNativeSurface().catch(() => undefined);
                    }
                  })
                  .finally(() => {
                    nativePlaybackInFlight = null;
                  });
              } else {
                // Non-authoritative diagnostic path retained for browser harnesses;
                // Tauri never enters this branch because its preview is surface-only.
                nativePlaybackInFlight = nativePreviewScheduler
                  .requestVisible(requestSource)
                  .then((frame) => {
                    const frontendSpan =
                      nativeFrontendPerfSpans.get(requestKey);
                    frontendSpan?.finish();
                    nativeFrontendPerfSpans.delete(requestKey);
                    const current = renderStateRef.current;
                    if (
                      isActive &&
                      current.project?.id === state.project?.id &&
                      current.epoch === state.epoch &&
                      current.clock.state === "playing"
                    ) {
                      if (frame) {
                        nativeDisplayedFrameRef.current = frame;
                      }
                      nativeContinuousFailureStreak = 0;
                      forceRenderNeeded = true;
                    }
                  })
                  .catch((error) => {
                    const frontendSpan =
                      nativeFrontendPerfSpans.get(requestKey);
                    frontendSpan?.finish({
                      stale: true,
                      cancelled:
                        error instanceof DOMException &&
                        error.name === "AbortError",
                    });
                    nativeFrontendPerfSpans.delete(requestKey);
                    nativeContinuousFailureStreak += 1;
                    lastNativePlaybackRequestKey = "";
                    if (nativeContinuousFailureStreak >= 3) {
                      nativeContinuousBlockedRevision = nativeRevision;
                    }
                    nativeRetryAt = performance.now() + 250;
                  })
                  .finally(() => {
                    nativePlaybackInFlight = null;
                  });
              }
            }
          }
        }

        const needsRender =
          isPlaying ||
          timeChanged ||
          epochChanged ||
          transportChanged ||
          isFirstFrame ||
          forceRenderNeeded ||
          nativeFrameNeedsRetry ||
          clipsChanged ||
          tracksChanged ||
          transitionsChanged ||
          projectChanged ||
          (mediaReadyChanged &&
            (!nativePausedPath || nativeBlockedKey === nativeRequestKey));

        if (needsRender) {
          lastRenderedClips = state.clips;
          lastRenderedTracks = state.tracks;
          lastRenderedTransitions = state.transitions;
          lastRenderedProject = state.project;
          lastRenderedFrameIndex = frameIndex;
          lastRenderedEpoch = state.epoch;
          lastRenderedTransportRevision = transportRevision;
          lastRenderedMediaReadyRevision = mediaReadyRevision;
          lastRenderedPlaybackState = playbackState;
          if (forceRenderNeeded) forceRenderNeeded = false;

          const nativeFrameReady =
            !isTauriRuntime() ||
            nativeRequest === null ||
            cachedNativeFrame !== null ||
            isPlaying ||
            nativeSurfaceOwnsCurrentFrame ||
            nativeDirectSurfacePath;
          if (state.clock.isSeeking && nativeFrameReady) {
            state.clock.completeSeek();
          }
        }

        // Native Tauri preview is a hard boundary. Readback is reserved for
        // export/diagnostics; the desktop preview keeps the last surface frame
        // while the retained surface recovers.
        if (
          needsRender &&
          !nativeSurfaceShown &&
          !nativeOnlySceneBlocked &&
          !nativeDirectSurfacePath
        ) {
          try {
            // Hold the previous native image while a new seek is decoding. It
            // is visual continuity only; `cachedNativeFrame` remains the
            // separate exact-target readiness signal below.
            let exactNativeFrame = cachedNativeFrame;
            let nativeFrame =
              exactNativeFrame ??
              (nativePausedPath || nativePlaybackPath
                ? nativeDisplayedFrameRef.current
                : null);
            const requestForRender = nativeRequest;

            const canUseNativePreview =
              isTauriRuntime() &&
              requestForRender !== null &&
              !cachedNativeFrame &&
              // Paused seeks await an exact native frame. Continuous native
              // playback is scheduled asynchronously in nativePlaybackInFlight
              // and never blocks the RAF render loop.
              !isPlaying &&
              !nativeDirectSurfacePath &&
              performance.now() >= nativeRetryAt &&
              nativeBlockedKey !== nativeRequestKey;

            if (
              canUseNativePreview &&
              requestForRender &&
              !nativeDirectSurfacePath
            ) {
              try {
                const visibleSource: NativePreviewRequestSource = {
                  requestKey: nativeRequestKey,
                  frameIndex,
                  request: requestForRender,
                  generation: targetGeneration,
                };
                const loadedFrame =
                  await nativePreviewScheduler.requestVisible(visibleSource);
                // A seek or play action may have happened while native decode
                // was awaiting FFmpeg/GPU readback. Never commit that stale
                // response to the current program canvas.
                if (!targetStillCurrent()) {
                  const frontendSpan =
                    nativeFrontendPerfSpans.get(nativeRequestKey);
                  frontendSpan?.finish({ stale: true });
                  nativeFrontendPerfSpans.delete(nativeRequestKey);
                  forceRenderNeeded = true;
                  return;
                }
                exactNativeFrame = loadedFrame;
                nativeFrame = loadedFrame;
                nativeDisplayedFrameRef.current = loadedFrame;
                nativeRetryAt = 0;
              } catch (error) {
                // Keep the last native frame visible for this render boundary, then
                // retry this exact request. One failed readback must not
                // permanently disable paused seeking.
                nativeFrame = null;
                if (nativeFailureKey !== nativeRequestKey) {
                  nativeFailureKey = nativeRequestKey;
                  nativeFailureCount = 0;
                }
                nativeFailureCount += 1;
                if (nativeFailureCount >= 3) {
                  // Repeated invalid payloads are a native-renderer failure, not
                  // a reason to hammer FFmpeg/wgpu every RAF. Wait until the user
                  // changes the target or explicitly seeks again.
                  nativeBlockedKey = nativeRequestKey;
                }
                const frontendSpan =
                  nativeFrontendPerfSpans.get(nativeRequestKey);
                frontendSpan?.finish({
                  stale:
                    error instanceof Error &&
                    /stale|cancel/i.test(error.message),
                  cancelled:
                    error instanceof DOMException &&
                    error.name === "AbortError",
                });
                nativeFrontendPerfSpans.delete(nativeRequestKey);
                nativeRetryAt = performance.now() + 250;
                if (nativeOnlyMode) {
                  toast.error(
                    [
                      "Native-only preview",
                      "Native GPU frame rendering failed for the current frame.",
                      error instanceof Error ? error.message : String(error),
                    ].join("\n"),
                    { id: "native-only-preview-blocked", duration: 6000 },
                  );
                }
              }
            }

            // Do not speculative-prefetch paused readback frames. Each item would
            // trigger a full GPU composition plus RGBA readback, and all requests
            // for one source serialize on its decoder mutex. On a seek this turns
            // eight background frames into visible latency for the next target.
            // Playback lookahead uses the retained native surface path instead.

            if (!targetStillCurrent()) {
              forceRenderNeeded = true;
              return;
            }

            let canvasPaintMs: number | undefined;
            if (nativeFrame && canvasEl) {
              const canvasPaintStarted = performance.now();
              if (!drawNativeFrameToCanvas(canvasEl, nativeFrame)) {
                throw new Error(
                  "Native preview returned a frame that could not be drawn to the preview canvas",
                );
              }
              canvasPaintMs = performance.now() - canvasPaintStarted;
            }
            if (nativeFrame && canvasEl && exactNativeFrame !== null) {
              const frontendSpan =
                nativeFrontendPerfSpans.get(nativeRequestKey);
              if (frontendSpan) {
                frontendSpan.finish({
                  canvasPaintMs,
                });
                nativeFrontendPerfSpans.delete(nativeRequestKey);
              }
            }

            // Smart overlays are already rasterized into the native request. The
            // separate overlay canvas must stay clear to avoid double rendering.
            const smartCanvas = smartOverlayCanvasRefObj.current;
            smartCanvas
              ?.getContext("2d")
              ?.clearRect(0, 0, smartCanvas.width, smartCanvas.height);

            if (!targetStillCurrent()) {
              forceRenderNeeded = true;
              return;
            }

            // was in-flight (e.g. rapid project switch, React Strict Mode remount).
            // Without this, post-await code would write into a torn-down WebGL context.
            if (!isActive) return;

            const nativeFrameReady =
              !isTauriRuntime() ||
              nativeRequest === null ||
              exactNativeFrame !== null ||
              isPlaying ||
              nativeSurfaceOwnsCurrentFrame;
            if (state.clock.isSeeking && nativeFrameReady) {
              state.clock.completeSeek();
            }
          } catch (error) {
            console.error("[native-preview] paused-frame-failed", {
              frameIndex,
              requestKey: nativeRequestKey,
              textLayers: nativeRequest ? nativeTextDebugSummary(nativeRequest) : [],
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const currentState = renderStateRef.current;
        const currentFrameIndex = getFrameIndexAtTime(
          currentState.clock.time,
          currentState.clock.frameRate,
        );
        const errorKey = `${currentState.project?.id ?? "unknown-project"}:${currentState.epoch}:${currentFrameIndex}:${message}`;
        if (errorKey !== lastRenderLoopError) {
          lastRenderLoopError = errorKey;
          console.error("[native-preview] render-loop-failed", {
            frameIndex: currentFrameIndex,
            requestKey: lastNativePlaybackRequestKey || undefined,
            error: message,
          });
        }
        forceRenderNeeded = true;
        nativeRetryAt = performance.now() + 250;
      } finally {
        renderInFlight = false;
        const latest = renderStateRef.current;
        const hasPendingVisualChange =
          latest.clock.state === "playing" ||
          forceRenderNeeded ||
          latest.clips !== lastRenderedClips ||
          latest.tracks !== lastRenderedTracks ||
          latest.transitions !== lastRenderedTransitions ||
          latest.project !== lastRenderedProject ||
          getFrameIndexAtTime(latest.clock.time, latest.clock.frameRate) !==
            lastRenderedFrameIndex;
        if (hasPendingVisualChange) scheduleNextFrame();
      }
    };

    let lastSubscriberClockState: "playing" | "paused" | "stopped" =
      clock.state;
    const unsubscribeClock = clock.subscribe((newClockState) => {
      forceRenderNeeded = true;
      transportRevision += 1;
      // Bug 5/9 fix: only invalidate the prefetch cache and circuit-breakers
      // on actual transport events (play/pause/stop state changes).
      // The clock notifies at up to 10fps during steady playback; resetting the
      // prefetch neighborhood that often discards useful look-ahead frames and
      // makes frame-stepping feel sluggish. The render loop itself clears
      // visibleRequestGeneration/setVisibleGeneration whenever the frame key
      // changes, so time-tick notifications don't need to do it too.
      const wasStateChange = newClockState.state !== lastSubscriberClockState;
      lastSubscriberClockState = newClockState.state;
      if (wasStateChange) {
        visibleRequestGeneration += 1;
        nativePreviewScheduler.setVisibleGeneration();
        // A play/pause/stop transition is a new opportunity for native decode.
        // Clear the per-target circuit breaker without re-enabling retries every RAF.
        nativeBlockedKey = "";
        nativeFailureCount = 0;
        nativeRetryAt = 0;
        if (newClockState.state === "playing") {
          prefetchUpcomingNativeFrames(
            getFrameIndexAtTime(newClockState.time, renderStateRef.current.clock.frameRate),
          );
        }
      }
      scheduleNextFrame();
    });

    scheduleNextFrame();
    return () => {
      isActive = false;
      unsubscribeClock();
      unsubscribeSeekIntent?.();
      nativePreviewScheduler.dispose();
      nativeRasterBridge.dispose();
      if (wakeNativeRenderLoopRef.current === scheduleNextFrame) {
        wakeNativeRenderLoopRef.current = null;
      }
      if (rafId !== null) cancelAnimationFrame(rafId);
      frameScheduled = false;
    };
    // Bug 3 fix: viewport values (scale, offsetX, offsetY, canvasWidth, canvasHeight) are
    // now read from renderStateRef inside the loop, so they are NOT listed as deps here.
    // Bug 6 fix: project?.id instead of full project object (updateProject always creates
    // a new reference, so `project` as a dep would restart the loop on every store write).
    // Audit 4.6 fix: nativeSurfaceReady removed from deps — it is now read from
    // nativeSurfaceReadyRef.current inside the loop, preventing the loop from restarting
    // (and emitting a blank frame) on every native surface probe and window resize.
  }, [canvasEl, project?.id]);

  // Wake the paused native renderer for timeline edits, text input, seeks,
  // and viewport changes. The loop itself decides whether one frame is
  // actually needed and then goes idle again.
  useEffect(() => {
    wakeNativeRenderLoopRef.current?.();
  }, [
    clips,
    tracks,
    transitions,
    mediaAssets,
    epoch,
    clockState.state,
    clockState.time,
    dimensions.width,
    dimensions.height,
    previewQuality,
  ]);

  useEffect(() => {
    setActiveContext("program");
  }, [setActiveContext]);

  if (!project) return null;

  if (dimensions.width === 0 || dimensions.height === 0) {
    return (
      <div className="flex-1 bg-bg flex flex-col min-h-0 border-l border-t border-white/3">
        <div className="flex-1 flex items-center justify-center p-4 md:p-6 overflow-hidden relative bg-[#06080a]">
          <div
            ref={previewContainerCallback}
            className="w-full h-full flex items-center justify-center"
          >
            <div className="text-text-muted">Loading preview...</div>
          </div>
        </div>
      </div>
    );
  }

  const currentTime = clockState.time;
  const duration = clockState.duration;
  const isPlaying = clockState.state === "playing";
  const playbackSpeed = clockState.speed;
  const frameRate = clockState.frameRate;
  const step = 1 / Math.max(1, frameRate);

  return (
    <div
      data-preview-space="program"
      className="flex-1 bg-bg flex flex-col min-h-0 border-l border-t border-white/3"
    >
      <div className="flex items-center px-4 h-10 shrink-0 gap-2 overflow-hidden">
        <span className="text-[13px] font-semibold text-text-primary tracking-tight leading-none">
          {isTauriRuntime()
            ? "Program Preview (Native)"
            : "Program Preview (Desktop required)"}
        </span>
        <span className="text-[13px] text-text-muted leading-none">
          —{" "}
          {isTauriRuntime()
            ? nativeSurfacePresenting
              ? "wgpu Surface"
              : "Preparing wgpu Surface"
            : "Open the desktop runtime"}
        </span>
        <button
          onClick={() => setShowTelemetry((s) => !s)}
          className={cn(
            "ml-auto px-2 h-6 rounded text-[10px] font-medium transition-colors cursor-pointer",
            showTelemetry
              ? "bg-accent/20 text-accent"
              : "text-text-muted hover:text-text-primary hover:bg-white/6",
          )}
        >
          Metrics
        </button>
        <button
          onClick={() => setShowSafeOverlay((s) => !s)}
          className={cn(
            "px-2 h-6 rounded text-[10px] font-medium transition-colors cursor-pointer",
            showSafeOverlay
              ? "bg-accent/20 text-accent"
              : "text-text-muted hover:text-text-primary hover:bg-white/6",
          )}
        >
          Safe Zones
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center overflow-hidden bg-[#06080a] relative">
        <TelemetryOverlay
          showTelemetry={showTelemetry}
          telemetryStats={telemetryStats}
        />
        <div
          ref={previewContainerCallback}
          onPointerDownCapture={handlePreviewPointerDownCapture}
          className={cn(
            "w-full h-full flex items-center justify-center relative z-10 overflow-hidden",
            isPanning && "cursor-grabbing",
            spacePressed && !isPanning && "cursor-grab",
          )}
        >
          <div
            ref={nativeSurfaceTargetRef}
            data-testid="program-preview-viewport"
            className="relative flex shrink-0 items-center justify-center overflow-visible shadow-[0_0_40px_rgba(0,0,0,0.36)]"
            style={{ width: displayWidth, height: displayHeight }}
          >
            <>
              {previewBackgroundLayer && (
                <div
                  data-testid="program-preview-background"
                  className={cn(
                    "absolute inset-0 z-0 pointer-events-none overflow-hidden",
                    previewBackgroundLayer.className,
                  )}
                  style={previewBackgroundLayer.style}
                />
              )}
              <canvas
                ref={canvasRef}
                data-testid="program-preview-canvas"
                style={{
                  position: "relative",
                  zIndex: 1,
                  width: displayWidth,
                  height: displayHeight,
                  imageRendering: "auto",
                  background: "transparent",
                  visibility: nativeSurfacePresenting ? "hidden" : "visible",
                }}
              />
              <canvas
                ref={smartOverlayCanvasRef}
                data-testid="program-preview-smart-overlay-canvas"
                width={displayWidth}
                height={displayHeight}
                style={{
                  position: "absolute",
                  inset: 0,
                  zIndex: 2,
                  pointerEvents: "none",
                  width: displayWidth,
                  height: displayHeight,
                  background: "transparent",
                  visibility: nativeSurfacePresenting ? "hidden" : "visible",
                }}
              />

              <TransformOverlay
                canvasWidth={canvasWidth}
                canvasHeight={canvasHeight}
                scale={scale}
                viewport={viewport}
                displayOffset={{ x: offsetX, y: offsetY }}
                displayWidth={displayWidth}
                displayHeight={displayHeight}
                currentTime={currentTime}
                visible={!isPlaying}
              />
              <SafeOverlay
                visible={showSafeOverlay}
                displayWidth={displayWidth}
                displayHeight={displayHeight}
                displayOffset={{ x: offsetX, y: offsetY }}
              />
              {karaokeOverlayEnabled && <KaraokeCaptions />}
            </>
          </div>
        </div>

        {clips.length === 0 && (
          <div
            className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none mx-auto"
            style={{ width: displayWidth, height: displayHeight }}
          >
            <div className="text-center space-y-3">
              <div className="text-sm font-medium text-text-muted">
                No clips in sequence
              </div>
              <div className="text-xs text-text-muted/80 space-y-1 font-mono">
                <div>
                  {canvasWidth}×{canvasHeight} • {frameRate}fps
                </div>
                <div className="text-text-muted/60">Rec.709</div>
              </div>
            </div>
          </div>
        )}
      </div>

      <PreviewTransport
        currentTime={currentTime}
        duration={duration}
        isPlaying={isPlaying}
        disabled={clips.length === 0}
        onPlayPause={() => {
          if (clips.length === 0) return;
          setActiveContext?.("program");
          isPlaying ? transportPause() : transportPlay();
        }}
        onSeek={(time) => {
          if (clips.length === 0) return;
          transportSeek(clampAndSnapProgramTime(time, duration, frameRate));
        }}
        formatTime={formatTime}
        onStepBack={() => {
          if (clips.length === 0) return;
          const targetTime = Math.max(0, currentTime - step);
          transportSeek(
            clampAndSnapProgramTime(targetTime, duration, frameRate),
            { mode: "frameStep", quality: "full" },
          );
        }}
        onStepForward={() => {
          if (clips.length === 0) return;
          const targetTime = Math.min(duration, currentTime + step);
          transportSeek(
            clampAndSnapProgramTime(targetTime, duration, frameRate),
            { mode: "frameStep", quality: "full" },
          );
        }}
        leftActions={
          <div className="relative" ref={speedMenuRef}>
            <PlaybackSpeedSelector
              playbackSpeed={playbackSpeed}
              speedMenuOpen={speedMenuOpen}
              setSpeedMenuOpen={setSpeedMenuOpen}
              setSpeed={transportSetSpeed}
            />
          </div>
        }
        rightActions={
          <>
            <div className="relative shrink-0" ref={aspectMenuRef}>
              <AspectSelector
                aspectMenuOpen={aspectMenuOpen}
                setAspectMenuOpen={setAspectMenuOpen}
                previewAspectPreset={previewAspectPreset}
                selectAspectPreset={selectAspectPreset}
                canvasWidth={canvasWidth}
                canvasHeight={canvasHeight}
              />
            </div>

            <div className="hidden @[360px]:block w-px h-4 bg-white/10 mx-0.5" />
            <VolumeControl
              isMuted={isMuted}
              setIsMuted={setIsMuted}
              volume={volume}
              setVolume={setVolume}
            />
          </>
        }
      />
    </div>
  );
};

/** @deprecated Import NativeProgramPreview. Kept temporarily for downstream integrations. */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Expand, Shrink, Activity } from "lucide-react";
import { VideoScopesModal } from "../scopes/VideoScopesModal";
import {
  usePlaybackClock,
  usePlaybackStatus,
  usePlaybackControls,
  useTransportControls,
  getPlaybackClock,
} from "@/hooks/usePlaybackClock";
import { useProjectStore } from "@/store/projectStore";
import { useTimelineStore } from "@/store/timelineStore";
import { useUIStore } from "@/store/uiStore";
import { useSettingsStore } from "@/store/settingsStore";
import { getActiveSessionOrNull } from "@/core/runtime/ProjectSession";
import { getTransformController, type DragGeometry } from "@/core/interactions";
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
import { AspectRatio, type Clip } from "@/types";
import { formatTime } from "@/lib/utils/timeFormatting";
import { refitClipsForCanvasChange } from "@/lib/timeline/refitClips";
import { useAudioSyncEngine } from "@/hooks/useAudioSyncEngine";
import { toast } from "@/lib/toast";

import { AspectSelector } from "./AspectSelector";
import { PlaybackSpeedSelector } from "./PlaybackSpeedSelector";
import { VolumeControl } from "./VolumeControl";
import { getCanvasBackgroundLayer } from "./canvasBackground";
import { getFrameIndexAtTime, getFrameStartTime } from "@/lib/utils/frameTime";
import { clampAndSnapProgramTime } from "@/lib/timeline/programTimelineBridge";
import {
  tracePlayback,
  traceSlowPlaybackStage,
} from "@/core/playback/playbackTrace";
import {
  nativePerfCollector,
  type NativePerfSpan,
} from "@/core/playback/nativePerfTelemetry";
import type { SeekIntent } from "@/core/playback/seekController";
import {
  getNativePreviewSurfaceGeometry,
  cancelNativePreviewRequests,
  isTauriRuntime,
  onNativePreviewWindowMoved,
  presentNativeFrame,
  configureNativePlaybackRender,
  submitNativePlaybackDemand,
  getNativeFrameServiceStats,
  getNativeFrameServiceSamples,
  getNativeSyncMetricsSnapshot,
  getNativeGpuStatus,
  registerNativeRasterAsset,
  renderNativeFrame,
} from "@/lib/platform/tauri";
import { telemetryCollector } from "@/services/telemetryCollector";
import type { NativeSurfaceGeometry } from "@/lib/platform/nativeCore";
import type { TelemetryPreviewContext } from "@/services/telemetryCollector";

import type { SmartOverlayClip } from "@/types/smartOverlay";
import { KaraokeCaptions } from "@/components/captions/KaraokeCaptions";
import { paintTextLayersToCanvas } from "./nativeTextPreview";
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
import {
  previewQualificationController,
} from "@/core/playback/previewPerformanceContract";
import {
  NativeSurfaceOutput,
  WebViewCanvasOutput,
} from "@/core/playback/previewOutputAdapters";
import { ensureNativeFontsRegistered } from "@/core/fonts/nativeFontRegistry";
import {
  NATIVE_PREVIEW_ONLY,
  createNativePlaybackFrameDemand,
  type NativeFrameRequest,
  type NativeRasterLayerSnapshot,
} from "@/lib/platform/nativeCore";
import {
  claimNativeSurfaceReadiness,
  configureNativeSurface,
  failNativeSurfaceReadiness,
  hideNativeSurfaceWhenIdle,
  isNativeSurfaceRequestSuperseded,
  markNativeSurfaceReady,
  presentOnNativeSurface,
  releaseNativeSurface,
  releaseNativeSurfaceReadiness,
} from "@/core/runtime/nativeSurfaceLifecycle";

function isExpectedStaleNativePreviewError(error: unknown): boolean {
  return /native preview frame request is stale|request cancelled/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

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
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) return false;

  const image = getReusableCanvasImageData(
    canvas,
    context,
    frame.width,
    frame.height,
  );
  image.data.set(new Uint8ClampedArray(frame.rgba));
  context.putImageData(image, 0, 0);
  return true;
}

const reusableCanvasImages = new WeakMap<
  HTMLCanvasElement,
  { width: number; height: number; image: ImageData }
>();

function getReusableCanvasImageData(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): ImageData {
  const cached = reusableCanvasImages.get(canvas);
  if (cached?.width === width && cached.height === height) return cached.image;
  const image = context.createImageData(width, height);
  reusableCanvasImages.set(canvas, { width, height, image });
  return image;
}

/**
 * WebView readback is a fallback/qualification path, not a full-resolution
 * export path. Keep the transfer bounded even when a large editor viewport or
 * DPR would otherwise make every RGBA frame expensive.
 */
const WEBVIEW_MAX_OUTPUT_DIMENSION = 960;

function capWebViewRenderTarget(target: {
  width: number;
  height: number;
  quality: NativeFrameRequest["quality"];
}): typeof target {
  const largest = Math.max(target.width, target.height);
  if (largest <= WEBVIEW_MAX_OUTPUT_DIMENSION) return target;
  const scale = WEBVIEW_MAX_OUTPUT_DIMENSION / largest;
  return {
    ...target,
    width: Math.max(1, Math.floor(target.width * scale)),
    height: Math.max(1, Math.floor(target.height * scale)),
  };
}

interface ConnectedProgramTransportProps {
  duration: number;
  frameRate: number;
  disabled: boolean;
  onPlayPause: () => void;
  onSeek: (time: number) => void;
  formatTime: (seconds: number) => string;
  onStepBack: (currentTime: number) => void;
  onStepForward: (currentTime: number) => void;
  speedMenuRef: React.RefObject<HTMLDivElement | null>;
  speedMenuOpen: boolean;
  setSpeedMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  transportSetSpeed: (speed: number) => void;
  aspectMenuRef: React.RefObject<HTMLDivElement | null>;
  aspectMenuOpen: boolean;
  setAspectMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  previewAspectPreset: AspectRatio;
  selectAspectPreset: (preset: AspectRatio) => void;
  canvasWidth: number;
  canvasHeight: number;
  isMuted: boolean;
  setIsMuted: React.Dispatch<React.SetStateAction<boolean>>;
  volume: number;
  setVolume: React.Dispatch<React.SetStateAction<number>>;
  scopesOpen: boolean;
  setScopesOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

const ConnectedProgramTransport: React.FC<ConnectedProgramTransportProps> =
  React.memo((props) => {
    const clockState = usePlaybackClock();
    return (
      <PreviewTransport
        currentTime={clockState.time}
        duration={props.duration || clockState.duration}
        isPlaying={clockState.state === "playing"}
        disabled={props.disabled}
        onPlayPause={props.onPlayPause}
        onSeek={props.onSeek}
        formatTime={props.formatTime}
        onStepBack={() => props.onStepBack(clockState.time)}
        onStepForward={() => props.onStepForward(clockState.time)}
        leftActions={
          <div className="relative" ref={props.speedMenuRef}>
            <PlaybackSpeedSelector
              playbackSpeed={clockState.speed}
              speedMenuOpen={props.speedMenuOpen}
              setSpeedMenuOpen={props.setSpeedMenuOpen}
              setSpeed={props.transportSetSpeed}
            />
          </div>
        }
        rightActions={
          <>
            <button
              type="button"
              onClick={() => props.setScopesOpen((prev) => !prev)}
              title="Toggle Video Scopes (Waveform, Parade, Vectorscope, Histogram)"
              className={`p-1.5 rounded-lg transition-colors flex items-center justify-center ${
                props.scopesOpen
                  ? "bg-accent text-white shadow-sm"
                  : "text-text-muted hover:text-text-primary hover:bg-white/5"
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
            </button>

            <div className="relative shrink-0" ref={props.aspectMenuRef}>
              <AspectSelector
                aspectMenuOpen={props.aspectMenuOpen}
                setAspectMenuOpen={props.setAspectMenuOpen}
                previewAspectPreset={props.previewAspectPreset}
                selectAspectPreset={props.selectAspectPreset}
                canvasWidth={props.canvasWidth}
                canvasHeight={props.canvasHeight}
              />
            </div>

            <div className="hidden @[360px]:block w-px h-4 bg-white/10 mx-0.5" />
            <VolumeControl
              isMuted={props.isMuted}
              setIsMuted={props.setIsMuted}
              volume={props.volume}
              setVolume={props.setVolume}
            />
          </>
        }
      />
    );
  });

interface ConnectedTransformOverlayProps extends Omit<
  React.ComponentProps<typeof TransformOverlay>,
  "currentTime" | "visible"
> {}

/**
 * Playback is a leaf concern for the transform overlay. Keeping this clock
 * subscription here prevents playhead ticks from re-rendering the preview
 * container, canvas host, and native-surface coordination tree.
 */
const ConnectedTransformOverlay = React.memo(
  (props: ConnectedTransformOverlayProps) => {
    const clockState = usePlaybackClock();
    const { pause } = useTransportControls();

    return (
      <TransformOverlay
        {...props}
        currentTime={clockState.time}
        visible={clockState.state !== "playing"}
        interactionMode={clockState.state === "playing" ? "playing" : "editing"}
        onPlaybackInteraction={pause}
      />
    );
  },
);

export const NativeProgramPreview: React.FC = () => {
  const karaokeOverlayEnabled = useCaptionStore((s) => s.karaokeOverlayEnabled);
  const project = useProjectStore((s) => s.project);
  const projectInitializing = useProjectStore(
    (s) => s.projectInitialization !== null,
  );
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

  const clock = getPlaybackClock();
  const { state: playbackState } = usePlaybackStatus();
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
  const [showSafeOverlay, setShowSafeOverlay] = useState(false);
  const [scopesOpen, setScopesOpen] = useState(false);
  const [nativeSurfaceReady, setNativeSurfaceReady] = useState(false);
  const [nativeSurfaceError, setNativeSurfaceError] = useState<string | null>(
    null,
  );
  // Audit 4.6 fix: mirror nativeSurfaceReady in a ref so the render loop can read the
  // latest value imperatively without nativeSurfaceReady being listed in the effect deps.
  // Having it in deps caused the entire render loop to restart (RAF cancelled, blank frame)
  // on every native surface probe and window resize.
  const nativeSurfaceReadyRef = useRef(false);
  const nativeSurfaceErrorRef = useRef<string | null>(null);
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
      // Measurement belongs to the mounted container. Clear it when the
      // project view leaves the tree so a later session cannot configure the
      // native child surface from a previous session's rectangle.
      if (!node) setDimensions({ width: 0, height: 0 });
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
  // Persist text-prefetch identity across native surface/canvas effect
  // restarts. Text prewarming is isolated from the visible video decoder path.
  const nativePrefetchStateRef = useRef({
    textInFlight: new Map<string, Promise<void>>(),
    textCompleted: new Set<string>(),
    textFailedAt: new Map<string, number>(),
  });
  const qualityManagerSigRef = useRef<string>("");
  const previewTelemetryContextRef = useRef<TelemetryPreviewContext>({
    view: "webview",
    surface: "dom-canvas",
    runtimeEnvironment: import.meta.env.DEV ? "development" : "production",
  });
  // Native telemetry is read through the service's bounded sequence cursor.
  // This preserves every retained observation between polls without creating
  // a measurement when the editor is idle.
  const lastNativeSampleSequenceRef = useRef(0);
  const originalCanvasDimsRef = useRef<{
    projectId: string;
    width: number;
    height: number;
  } | null>(null);
  const prevDurationRef = useRef<number>(0);
  const prevFrameRateRef = useRef<number>(0);
  const isMutedRef = useRef(isMuted);
  const volumeRef = useRef(volume);
  // Qualification is diagnostic lifecycle work, not a user preference. Start
  // one automatic two-path pass the first time each project actually plays so
  // WebView data is collected without a console command or editor telemetry UI.
  const automaticQualificationProjectRef = useRef<string | null>(null);
  const automaticQualificationStartedRef = useRef(false);

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
    clockState: clock.getState(),
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

    let active = true;
    const flushMetrics = async () => {
      const afterSequence = lastNativeSampleSequenceRef.current;
      const [nativeSync, nativeRender, nativeSampleBatch] = await Promise.all([
        getNativeSyncMetricsSnapshot().catch(() => null),
        getNativeFrameServiceStats().catch(() => null),
        getNativeFrameServiceSamples(afterSequence, 256).catch(() => null),
      ]);
      if (!active) return;

      // A project reset starts the native sequence over. Do not let the old
      // cursor suppress all samples from the new project.
      if (
        nativeSampleBatch &&
        nativeSampleBatch.latestSequence < lastNativeSampleSequenceRef.current
      ) {
        lastNativeSampleSequenceRef.current = 0;
      }

      // Extract current video profile
      const videoAsset = renderStateRef.current.mediaAssets.find(
        (a) => a.type === "video",
      );

      const profile = {
        width:
          videoAsset?.width ||
          renderStateRef.current.project?.canvasWidth ||
          3840,
        height:
          videoAsset?.height ||
          renderStateRef.current.project?.canvasHeight ||
          2160,
        nominalFps: renderStateRef.current.project?.frameRate || 60,
      };

      const samples = nativeSampleBatch?.samples ?? [];
      if (nativeSampleBatch) {
        for (let index = 0; index < samples.length; index += 1) {
          const sample = samples[index];
          const sequence = nativeSampleBatch.firstSequence + index;
          telemetryCollector.recordNativeSyncSnapshot(
            nativeSync,
            { ...(nativeRender ?? {}), lastSample: sample },
            profile,
            previewTelemetryContextRef.current,
            `sequence:${sequence}:${sample.requestId}:${sample.frameIndex}`,
          );
        }
        lastNativeSampleSequenceRef.current = nativeSampleBatch.nextSequence;
      } else {
        // Compatibility fallback for older desktop binaries that do not yet
        // expose the cursor command. It remains cursor-protected.
        const lastNativeSample = nativeRender?.lastSample;
        const nativeSampleCursor = lastNativeSample && nativeRender?.lastSampleSequence !== undefined
          ? `sequence:${nativeRender.lastSampleSequence}:${lastNativeSample.requestId}:${lastNativeSample.frameIndex}`
          : null;
        if (nativeSampleCursor && nativeRender?.lastSampleSequence !== undefined && nativeRender.lastSampleSequence > afterSequence) {
          lastNativeSampleSequenceRef.current = nativeRender.lastSampleSequence;
          telemetryCollector.recordNativeSyncSnapshot(
            nativeSync,
            nativeRender,
            profile,
            previewTelemetryContextRef.current,
            nativeSampleCursor,
          );
        }
      }
    };

    void flushMetrics();
    const interval = window.setInterval(
      () => void flushMetrics(),
      1000,
    );
    return () => {
      active = false;
      window.clearInterval(interval);
      lastNativeSampleSequenceRef.current = 0;
    };
  }, []);
  renderStateRef.current.clips = clips;
  renderStateRef.current.tracks = tracks;
  renderStateRef.current.transitions = transitions;
  renderStateRef.current.mediaAssets = mediaAssets;
  renderStateRef.current.project = project;
  renderStateRef.current.epoch = epoch;
  renderStateRef.current.clock = clock;
  renderStateRef.current.clockState = clock.getState();
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

  useEffect(() => {
    const projectId = project?.id ?? null;
    if (projectId !== automaticQualificationProjectRef.current) {
      automaticQualificationProjectRef.current = projectId;
      automaticQualificationStartedRef.current = false;
    }
  }, [project?.id]);

  useEffect(() => {
    if (
      !isTauriRuntime() ||
      projectInitializing ||
      !project?.id ||
      playbackState !== "playing" ||
      automaticQualificationStartedRef.current
    ) {
      return;
    }

    const qualification = previewQualificationController.getState();
    if (qualification.status === "running") return;

    automaticQualificationStartedRef.current = true;
    const projectId = project.id;
    const projectEpoch = epoch;
    previewQualificationController.start({
      isSnapshotValid: () => {
        const current = renderStateRef.current;
        return current.project?.id === projectId && current.epoch === projectEpoch;
      },
    });
  }, [epoch, playbackState, project?.id, projectInitializing]);

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
  const nativeSurfaceViewportReady = displayWidth > 0 && displayHeight > 0;

  // Browser fallback for localhost/editor testing. Tauri continues through
  // the native surface loop below; browser text uses the same timeline
  // evaluator and package-owned renderer, instead of silently showing an
  // empty canvas when no native surface exists.
  useEffect(() => {
    if (isTauriRuntime() || !canvasEl || !project || projectInitializing)
      return;

    let disposed = false;
    let rafId: number | null = null;
    let renderInFlight = false;
    let renderQueued = true;

    const schedule = () => {
      renderQueued = true;
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        void render();
      });
    };

    const render = async () => {
      if (disposed || renderInFlight) return;
      renderInFlight = true;
      renderQueued = false;
      try {
        const state = renderStateRef.current;
        const scene = evaluateTimelineSceneCached(
          state.clock.getState().time,
          state.clips,
          state.tracks,
          state.mediaAssets,
          state.project,
          state.epoch,
          state.transitions,
          state.sceneVersions,
        );
        canvasEl.width = state.canvasWidth;
        canvasEl.height = state.canvasHeight;
        if (scene.visualLayers.some((layer) => layer.layerType === "text")) {
          await paintTextLayersToCanvas(canvasEl, scene);
        } else {
          canvasEl
            .getContext("2d")
            ?.clearRect(0, 0, canvasEl.width, canvasEl.height);
        }
      } catch (error) {
        console.error("[browser-preview] text-render-failed", error);
      } finally {
        renderInFlight = false;
        if (renderQueued && !disposed) schedule();
      }
    };

    const unsubscribe = clock.subscribe(() => schedule());
    schedule();
    return () => {
      disposed = true;
      unsubscribe();
      if (rafId !== null) window.cancelAnimationFrame(rafId);
    };
  }, [canvasEl, project?.id, projectInitializing, epoch]);

  // The native presenter is hosted in a transparent child surface positioned
  // over the displayed program viewport and configured only in Tauri.
  useEffect(() => {
    if (
      !isTauriRuntime() ||
      !project?.id ||
      !nativeSurfaceTargetRef.current ||
      !nativeSurfaceViewportReady
    ) {
      return;
    }
    const readinessToken = claimNativeSurfaceReadiness(project.id);
    // tracePlayback("surface-setup-start", {
    //   projectId: project.id,
    //   generation: readinessToken.generation,
    //   viewport: `${Math.round(displayWidth)}x${Math.round(displayHeight)}`,
    // });

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
      nativeSurfaceErrorRef.current = null;
      setNativeSurfaceError(null);

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

            // Geometry changes are handled as a non-destructive transaction by
            // the shared surface coordinator. Keep the retained native frame
            // visible while the child window moves; hiding here exposes an
            // empty DOM canvas and causes the resize blank-frame regression.
            await configureNativeSurface(project.id, geometry);
            if (!active) break;
            nativeSurfaceConfiguredRef.current = true;
            appliedGeometryKey = nextGeometryKey;
            nativeSurfaceGeometrySettledRef.current = true;
            if (active) {
              nativeSurfaceReadyRef.current = true;
              nativeSurfaceErrorRef.current = null;
              setNativeSurfaceError(null);
              setNativeSurfaceReady(true);
              markNativeSurfaceReady(readinessToken);
              // Resizing intentionally hides the retained child surface. The
              // paused renderer is otherwise event-driven, so without an
              // explicit wake it can leave the DOM fallback canvas visible
              // and blank after a window resize. Request a fresh frame after
              // the new native surface geometry is fully configured.
              wakeNativeRenderLoopRef.current?.();
            }
          }
        } catch (error) {
          if (isNativeSurfaceRequestSuperseded(error)) {
            // A newer geometry or project transaction owns the coordinator.
            // This request is obsolete, not a surface failure.
            return;
          }
          nativeSurfaceConfiguredRef.current = false;
          nativeSurfaceGeometrySettledRef.current = false;
          if (active) {
            const message =
              error instanceof Error ? error.message : String(error);
            nativeSurfaceErrorRef.current = message;
            setNativeSurfaceError(message);
            nativeSurfaceReadyRef.current = false;
            setNativeSurfaceReady(false);
            failNativeSurfaceReadiness(readinessToken, error);
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
      nativeSurfaceErrorRef.current = null;
      setNativeSurfaceError(null);
      setNativeSurfaceReady(false);
      releaseNativeSurfaceReadiness(readinessToken);
      void releaseNativeSurface(project.id).catch(() => undefined);
    };
    // The boolean viewport dependency retries setup when the initial layout
    // changes from zero-sized placeholder to a real preview. It remains stable
    // during ordinary resize events, which keeps this effect from remounting on
    // every pixel change; ResizeObserver handles those through syncSurface().
  }, [project?.id, nativeSurfaceViewportReady]);

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
      // tracePlayback("preview-pointer-capture", {
      //   pointer: { clientX: e.clientX, clientY: e.clientY },
      //   target: {
      //     tagName: target.tagName,
      //     id: target.id || null,
      //     testId: target.getAttribute("data-testid"),
      //     transformOverlay: Boolean(target.closest("[data-transform-overlay]")),
      //     viewport: Boolean(
      //       target.closest("[data-testid='program-preview-viewport']"),
      //     ),
      //   },
      //   playbackState: clock.state,
      //   currentTime: Number(clock.time.toFixed(3)),
      //   nativeSurfaceReady,
      //   selectedClipIds: useUIStore.getState().selectedClipIds,
      // });
      if (target.closest("[data-transform-handle]")) return;
      if (target.closest("[data-playhead]")) return;
      if (target.closest("[data-transform-overlay]")) return;
      if (target.closest("[data-testid='program-preview-viewport']")) return;
      clearSelection();
    },
    [clearSelection, isPanning, spacePressed, clock, nativeSurfaceReady],
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
    // The project store exposes the project before session activation so the
    // loading modal can render its progress. Do not start the visible RAF loop
    // in that gap: it would create an unowned bridge and can issue a long
    // stopped-state render while session prewarming is still in progress.
    if (!canvasEl || !project || !isTauriRuntime() || projectInitializing)
      return;

    const capturedSession = getActiveSessionOrNull();
    if (!capturedSession) return;

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
    let nativePlaybackRenderSnapshotKey = "";
    let nativePlaybackRenderSnapshotInFlight: Promise<void> | null = null;
    let nativePlaybackRenderSnapshotInFlightKey = "";
    let nativePlaybackRenderFailed = false;
    let nativeContinuousFailureStreak = 0;
    let nativeDroppedFrameCount = 0;
    let nativeContinuousBlockedRevision = "";
    let nativeContinuousObservedRevision = "";
    let lastSeekTraceKey = "";
    let lastTracedPlaybackState: string | null = null;
    let frameScheduled = false;
    let lastRenderLoopError = "";
    let lastLoggedMissingTextSignature = "";
    let lastLoggedTextDropSignature = "";
    const nativeTextPrefetchInFlight =
      nativePrefetchStateRef.current.textInFlight;
    const nativeTextPrefetchCompleted =
      nativePrefetchStateRef.current.textCompleted;
    const nativeTextPrefetchFailedAt =
      nativePrefetchStateRef.current.textFailedAt;
    let nativeTextPrefetchTimer: number | null = null;

    let nativeSurfaceShown = false;
    let lastNativePlaybackRequestKey = "";
    let visibleRequestKey = "";
    const seekController =
      capturedSession.transportAuthority?.getSeekController();
    let latestSeekIntent: SeekIntent | null =
      seekController?.getCurrent() ?? null;
    let visibleRequestGeneration = seekController?.getGeneration() ?? 0;
    let transportRevision = 0;
    const sessionNativeRasterBridge = capturedSession?.nativeRasterBridge;
    if (!sessionNativeRasterBridge) {
      console.warn(
        "[native-preview] active session has no native raster bridge",
      );
      return;
    }
    const nativeRasterBridge = sessionNativeRasterBridge;
    // tracePlayback("playback-loop-start", {
    //   projectId: project.id,
    //   sessionId: capturedSession.sessionId,
    //   surfaceReady: nativeSurfaceReadyRef.current,
    //   surfaceError: nativeSurfaceErrorRef.current,
    // });
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

    const getNativeRenderTarget = (
      state: typeof renderStateRef.current,
      isInteracting: boolean,
    ): {
      width: number;
      height: number;
      quality: NativeFrameRequest["quality"];
    } => {
      const manager = qualityManagerRef.current;
      if (!manager) {
        return {
          width: Math.max(1, Math.round(state.canvasWidth)),
          height: Math.max(1, Math.round(state.canvasHeight)),
          quality: "full",
        };
      }

      const tier = manager.selectTierForPreview(
        isInteracting,
        state.previewQuality,
      );
      const profile = manager.getRenderProfile(tier);
      const quality: NativeFrameRequest["quality"] =
        tier === PreviewQualityTier.Interaction
          ? "quarter"
          : tier === PreviewQualityTier.Playback
            ? "half"
            : "full";
      return {
        width: Math.max(1, profile.maxWidth),
        height: Math.max(1, profile.maxHeight),
        quality,
      };
    };

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
      maxInFlight: 1,
      load: async (request, signal) => {
        if (signal?.aborted) {
          throw new DOMException(
            "Native preview request cancelled",
            "AbortError",
          );
        }
        const requestKey = getNativeFrameRequestKey(request);
        const frontendSpan = nativePerfCollector.isEnabled()
          ? nativePerfCollector.begin(request, {
              view: "webview",
              surface: "dom-canvas",
              runtimeEnvironment: import.meta.env.DEV
                ? "development"
                : "production",
              sessionId: capturedSession.sessionId,
              qualificationRunId:
                previewQualificationController.getState().runId ?? undefined,
              scenario:
                previewQualificationController.getState().status === "running"
                  ? "qualification"
                  : request.mode === "seek"
                    ? "seek"
                    : request.mode === "scrub"
                      ? "scrub"
                      : request.mode === "frameStep"
                        ? "paused-interaction"
                        : "playback",
            })
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
      const startedAt = performance.now();
      const present = () => presentNativeFrame(request);
      try {
        await ensureNativeRequestFonts(request);
        // The native surface is process-global and its window can be hidden or
        // reconfigured by the lifecycle effect. Keep presentation in the same
        // operation lane as hide/resize so a stale cleanup cannot hide the
        // surface immediately after this frame is submitted.
        return await presentOnNativeSurface(project.id, present);
      } catch (error) {
        if (!(await reRegisterTextAssetsForRequest(request))) throw error;
        return presentOnNativeSurface(project.id, present);
      } finally {
        traceSlowPlaybackStage("native-present", startedAt, {
          frameIndex: request.frameTime.frameIndex,
          textLayerCount: request.project.textLayers?.length ?? 0,
          mode: request.mode,
        });
      }
    };

    const nativePlaybackSnapshotKeyFor = (request: NativeFrameRequest) =>
      [
        request.project.projectRevision,
        request.renderGraphVersion,
        request.outputWidth,
        request.outputHeight,
        request.quality,
      ].join(":");

    const ensureNativePlaybackRenderSnapshot = (
      request: NativeFrameRequest,
    ): void => {
      const key = nativePlaybackSnapshotKeyFor(request);
      if (
        nativePlaybackRenderSnapshotKey === key ||
        nativePlaybackRenderSnapshotInFlightKey === key
      ) {
        return;
      }
      nativePlaybackRenderSnapshotInFlightKey = key;
      nativePlaybackRenderFailed = false;
      nativePlaybackRenderSnapshotInFlight = configureNativePlaybackRender(
        request,
      )
        .then(() => {
          nativePlaybackRenderSnapshotKey = key;
        })
        .catch((error) => {
          nativePlaybackRenderFailed = true;
          console.warn("[native-preview] persistent-render-session-failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          nativePlaybackRenderSnapshotInFlight = null;
          nativePlaybackRenderSnapshotInFlightKey = "";
          forceRenderNeeded = true;
        });
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
     * Text has a distinct first-use cost: browser font loading, effect
     * rasterization, and (when needed) native font registration. Warm only
     * that path several seconds before a text boundary so it never competes
     * with the first visible text frame.
     */
    const prefetchUpcomingNativeText = (currentFrame: number): void => {
      const state = renderStateRef.current;
      const project = state.project;
      if (!project || state.clock.state !== "playing" || !isTauriRuntime()) {
        return;
      }

      const frameRate = Math.max(1, project.frameRate ?? 30);
      const currentTime = getFrameStartTime(
        currentFrame / frameRate,
        frameRate,
      );
      const durationFrames = Math.max(
        1,
        Math.ceil(state.clock.duration * frameRate),
      );
      const horizonTime = currentTime + 8;
      const assetMap = new Map(state.mediaAssets.map((a) => [a.id, a]));
      const isRasterClip = (clip: (typeof state.clips)[number]) => {
        if (
          clip.kind === "text" ||
          clip.kind === "text-template" ||
          clip.kind === "image" ||
          clip.kind === "sticker"
        )
          return true;
        const asset = assetMap.get(clip.mediaId);
        return (
          asset?.type === "image" ||
          (clip.mediaId && clip.mediaId.startsWith("sticker-"))
        );
      };
      const upcomingRasterClip = state.clips
        .filter(
          (clip) =>
            isRasterClip(clip) &&
            clip.startTime > currentTime &&
            clip.startTime <= horizonTime,
        )
        .sort((left, right) => left.startTime - right.startTime)[0];
      if (!upcomingRasterClip) return;

      const targetFrame = Math.min(
        durationFrames - 1,
        Math.max(
          currentFrame + 1,
          Math.ceil(upcomingRasterClip.startTime * frameRate),
        ),
      );
      const revision = `${project.id ?? "unknown-project"}:${state.epoch}`;
      const key = `${revision}:${targetFrame}`;
      if (
        nativeTextPrefetchCompleted.has(key) ||
        nativeTextPrefetchInFlight.has(key)
      ) {
        return;
      }
      const previousFailureAt = nativeTextPrefetchFailedAt.get(key) ?? 0;
      if (performance.now() - previousFailureAt < 1000) return;

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
        const textLayers = scene.visualLayers.filter(
          (layer) => layer.layerType === "text",
        );
        const imageLayers = scene.visualLayers.filter(
          (layer) =>
            layer.layerType === "media" &&
            layer.mediaType === "image" &&
            layer.stickerFormat !== "gif" &&
            layer.stickerFormat !== "lottie",
        );
        if (textLayers.length === 0 && imageLayers.length === 0) return;

        await Promise.all([
          textLayers.length > 0
            ? nativeRasterBridge.prewarmTextAssets(scene, "text-prefetch")
            : Promise.resolve(),
          textLayers.length > 0
            ? ensureNativeFontsRegistered(
                textLayers.map((layer) => layer.fontFamily),
              )
            : Promise.resolve(),
          imageLayers.length > 0
            ? nativeRasterBridge.prewarmImageAssets(scene)
            : Promise.resolve(),
        ]);

        const current = renderStateRef.current;
        if (
          !isActive ||
          current.project?.id !== project.id ||
          current.epoch !== state.epoch ||
          current.clock.state !== "playing"
        ) {
          return;
        }
        nativeTextPrefetchCompleted.add(key);
        while (nativeTextPrefetchCompleted.size > 128) {
          const oldestKey = nativeTextPrefetchCompleted.values().next().value;
          if (oldestKey === undefined) break;
          nativeTextPrefetchCompleted.delete(oldestKey);
        }
        nativeTextPrefetchFailedAt.delete(key);
      })()
        .catch((error) => {
          nativeTextPrefetchFailedAt.set(key, performance.now());
          console.error("[native-preview] text-prefetch-failed", {
            frameIndex: targetFrame,
            revision,
            error: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          nativeTextPrefetchInFlight.delete(key);
        });

      nativeTextPrefetchInFlight.set(key, task);
    };

    // Never start text preparation in the same turn as the first play intent.
    // Canvas rasterization can occupy the WebView thread even though the
    // function is async; give the first native frame and audio clock a head
    // start, then warm the next text boundary from an idle timer.
    const scheduleUpcomingNativeTextPrefetch = (): void => {
      if (nativeTextPrefetchTimer !== null) return;
      nativeTextPrefetchTimer = window.setTimeout(() => {
        nativeTextPrefetchTimer = null;
        const current = renderStateRef.current;
        if (current.clock.state !== "playing") return;
        prefetchUpcomingNativeText(
          getFrameIndexAtTime(current.clock.time, current.clock.frameRate),
        );
      }, 100);
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

    // Transform feedback is an ephemeral render concern. Keep it outside
    // renderStateRef and Zustand so a pointer drag cannot invalidate every
    // editor subscriber. The active geometry is merged into a private clip
    // snapshot only at the native scene boundary below.
    const transformController = getTransformController();
    let dragPreviewClipId: string | null = null;
    let dragPreviewSessionId = 0;
    let dragPreviewRevision = 0;
    let dragPreviewGeometry: DragGeometry | null = null;
    let dragPreviewPendingCommit = false;

    const getRenderClips = (
      baseClips: Clip[],
    ): {
      clips: Clip[];
      previewRevision: number;
    } => {
      if (!dragPreviewClipId || !dragPreviewGeometry) {
        return { clips: baseClips, previewRevision: 0 };
      }

      const previewGeometry = dragPreviewGeometry;
      const previewClipId = dragPreviewClipId;
      const previewRevision = dragPreviewRevision;
      const previewClips = baseClips.map((clip) =>
        clip.id === previewClipId
          ? ({
              ...clip,
              x: previewGeometry.x,
              y: previewGeometry.y,
              width: previewGeometry.width,
              height: previewGeometry.height,
              rotation: previewGeometry.rotation,
              ...(previewGeometry.fontSize !== undefined
                ? { fontSize: previewGeometry.fontSize }
                : {}),
              ...(previewGeometry.conform
                ? { conform: previewGeometry.conform }
                : {}),
            } as Clip)
          : clip,
      );

      // The final command is written synchronously, but React may publish its
      // new timeline snapshot on the next commit. Retain the final geometry
      // for that handoff, then release the ephemeral override after one render.
      if (dragPreviewPendingCommit) {
        dragPreviewPendingCommit = false;
        dragPreviewClipId = null;
        dragPreviewGeometry = null;
      }

      return { clips: previewClips, previewRevision };
    };

    const renderLoop = async () => {
      if (!isActive || renderInFlight) return;
      renderInFlight = true;
      const renderStartedAt = performance.now();
      let traceFrameIndex = -1;
      let traceTextLayerCount = 0;

      try {
        const state = renderStateRef.current;
        const timeToRender = state.clock.time;
        const playbackState = state.clock.state;
        const isPlaying = playbackState === "playing";
        const frameRate = state.project?.frameRate ?? 30;
        const frameIndex = getFrameIndexAtTime(timeToRender, frameRate);
        if (playbackState !== lastTracedPlaybackState) {
          lastTracedPlaybackState = playbackState;
          // tracePlayback("playback-state", {
          //   projectId: state.project?.id ?? null,
          //   sessionId: capturedSession.sessionId,
          //   playbackState,
          //   time: Number(timeToRender.toFixed(3)),
          //   frameIndex,
          //   nativeClockReady: state.clock.hasNativeClockPosition,
          //   surfaceReady: nativeSurfaceReadyRef.current,
          //   surfacePresenting: nativeSurfaceShown,
          //   renderInFlight,
          // });
        }
        traceFrameIndex = frameIndex;
        const frameStartTime = getFrameStartTime(timeToRender, frameRate);
        const qualificationState = previewQualificationController.getState();
        const nativeAudioClockReadyForTarget =
          !isTauriRuntime() || state.clock.hasNativeClockPosition;
        const nativeRevisionForTarget = `${state.project?.id ?? "unknown-project"}:${state.epoch}`;
        const nativeSurfaceCanOwnPlayback =
          nativeSurfaceReadyRef.current &&
          nativeSurfaceGeometrySettledRef.current &&
          nativeAudioClockReadyForTarget &&
          nativeContinuousBlockedRevision !== nativeRevisionForTarget;
        const baseRenderTarget = getNativeRenderTarget(
          state,
          !isPlaying && clock.isSeeking,
        );
        const webViewTargetRequired =
          !isPlaying ||
          qualificationState.path === "webview" ||
          !nativeSurfaceCanOwnPlayback;
        const renderTarget = webViewTargetRequired
          ? capWebViewRenderTarget(baseRenderTarget)
          : baseRenderTarget;
        const requestIntent = latestSeekIntent
          ? {
              generation: latestSeekIntent.generation,
              mode:
                isPlaying && latestSeekIntent.mode !== "scrub"
                  ? ("playback" as const)
                  : latestSeekIntent.mode,
              quality: renderTarget.quality,
              velocityPxPerSecond: latestSeekIntent.velocityPxPerSecond,
              requestedAtMs: latestSeekIntent.issuedAtMs,
            }
          : isPlaying
            ? { mode: "playback" as const, quality: renderTarget.quality }
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

        const mediaReadyRevision =
          capturedSession.getPreviewMediaReadyRevision();
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

        const { clips: renderClips, previewRevision } = getRenderClips(
          state.clips,
        );
        const dragPreviewRevisionAtStart = dragPreviewRevision;
        const renderSceneVersions =
          previewRevision > 0
            ? {
                ...state.sceneVersions,
                clipVersion: `${state.sceneVersions.clipVersion}:drag:${dragPreviewSessionId}:${previewRevision}`,
              }
            : state.sceneVersions;

        const evaluationStartedAt = performance.now();
        const scene = evaluateTimelineSceneCached(
          frameStartTime,
          renderClips,
          state.tracks,
          state.mediaAssets,
          state.project,
          state.epoch,
          state.transitions,
          renderSceneVersions,
        );
        traceTextLayerCount = scene.visualLayers.filter(
          (layer) => layer.layerType === "text",
        ).length;
        traceSlowPlaybackStage(
          "visible-scene-evaluation",
          evaluationStartedAt,
          {
            frameIndex,
            playbackState,
            textLayerCount: traceTextLayerCount,
          },
        );
        const bridgeStartedAt = performance.now();
        const nativeBridgeRasters = await nativeRasterBridge.rasterize(scene, {
          frameKey: frameIndex,
          phase: "visible-playback",
        });
        traceSlowPlaybackStage("visible-raster-bridge", bridgeStartedAt, {
          frameIndex,
          playbackState,
          textLayerCount: traceTextLayerCount,
          rasterLayerCount: nativeBridgeRasters.length,
        });
        // Playback is a latest-frame stream. If the clock advanced while the
        // WebView was rasterizing an integration layer, abandon this work
        // before doing more raster/IPC work or presenting an obsolete frame.
        // Paused seeks remain strict and are checked by targetStillCurrent()
        // after their awaited native response below.
        const playbackTargetStillCurrent = () => {
          const current = renderStateRef.current;
          return (
            dragPreviewRevision === dragPreviewRevisionAtStart &&
            (!isPlaying ||
              (current.project?.id === state.project?.id &&
                current.epoch === state.epoch &&
                current.clock.state === "playing" &&
                getFrameIndexAtTime(current.clock.time, frameRate) ===
                  frameIndex))
          );
        };
        if (!playbackTargetStillCurrent()) {
          forceRenderNeeded = true;
          return;
        }
        const bodyMaskStartedAt = performance.now();
        const nativeBodyMasks = await rasterizeNativeBodyMasks(
          scene,
          capturedSession.getPreviewVideoElements(),
        );
        traceSlowPlaybackStage("visible-body-masks", bodyMaskStartedAt, {
          frameIndex,
          bodyMaskCount: nativeBodyMasks.length,
        });
        const nativeActiveSmartClips = renderClips.filter(
          (clip): clip is SmartOverlayClip =>
            clip.kind === "smart-overlay" &&
            frameStartTime >= clip.startTime &&
            // Audit 3.5 fix: use strict < to match the evaluator's boundary convention
            // (startTime <= evalTime < clipEnd). Was <= which rendered overlays one extra frame.
            frameStartTime < clip.startTime + clip.duration,
        );
        const smartOverlayStartedAt = performance.now();
        const nativeSmartOverlays =
          await nativeRasterBridge.rasterizeSmartOverlays(
            nativeActiveSmartClips,
            frameStartTime,
            renderTarget.width,
            renderTarget.height,
            { frameKey: frameIndex },
          );
        traceSlowPlaybackStage(
          "visible-smart-overlays",
          smartOverlayStartedAt,
          {
            frameIndex,
            smartOverlayCount: nativeSmartOverlays.length,
          },
        );
        if (!playbackTargetStillCurrent()) {
          forceRenderNeeded = true;
          return;
        }
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
          renderTarget.width,
          renderTarget.height,
          nativeRasterLayers,
          requestIntent,
        );
        const sceneTextLayers = scene.visualLayers.filter(
          (layer) => layer.layerType === "text",
        );
        const missingTextSignature = sceneTextLayers
          .map((layer) => `${layer.layerId}|${layer.text}`)
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
        // Do not queue a speculative native video frame from the visible RAF.
        // `queue_native_frame` uses the same decoder mutex as presentation, so
        // launching it immediately before the visible request can freeze the
        // surface several seconds before a text/media boundary. Decoder cold
        // starts are handled during project/session initialization; text and
        // other WebView assets use their isolated prewarm paths below.
        if (isPlaying) scheduleUpcomingNativeTextPrefetch();
        // Present the frame that was actually evaluated. Building a second
        // look-ahead scene here doubles WebView rasterization and IPC exactly
        // when the renderer is already behind. Native queue/prefetch remains
        // responsible for bounded decode warm-up; this loop is latest-frame
        // only and must never make the visible frame wait for another frame.
        const nativePlaybackRequest = nativeRequest;
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
        // frame and playback both use the exact request evaluated for this tick.
        const nativePlaybackRequestKey = nativePlaybackRequest
          ? getNativeFrameRequestKey(nativePlaybackRequest)
          : nativeRequestKey;
        const nativeOnlyMode = isTauriRuntime() && NATIVE_PREVIEW_ONLY;
        const nativeOnlySceneBlocked = nativeOnlyMode && !nativeRequest;
        // Audit 4.6 fix: read nativeSurfaceReadyRef.current (imperative ref) rather than
        // the React state `nativeSurfaceReady` to avoid having the state in the effect deps.
        const nativeSurfaceReadyNow = nativeSurfaceReadyRef.current;
        const nativeSurfaceErrorNow = nativeSurfaceErrorRef.current;
        if (nativeOnlyMode) {
          const blockers = [
            ...(!nativeRequest
              ? getNativePreviewBlockers(scene, nativeRasterLayers)
              : []),
            ...(nativeSurfaceErrorNow
              ? [
                  `The retained native wgpu surface failed to initialize: ${nativeSurfaceErrorNow}`,
                ]
              : []),
          ];
          const blockerKey = blockers.join("\n");
          if (nativeOnlyBlockersKeyRef.current !== blockerKey) {
            nativeOnlyBlockersKeyRef.current = blockerKey;
            if (blockers.length > 0) {
              toast.error(["Native-only preview", ...blockers].join("\n"), {
                id: "native-only-preview-blocked",
                duration: 6000,
              });
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
        const qualification = previewQualificationController.getState();
        const qualificationForcesWebView =
          qualification.status === "running" && qualification.path === "webview";
        const nativeSurfaceOwnsCurrentFrame =
          nativeSurfaceShown &&
          isPlaying &&
          lastNativePlaybackRequestKey === nativePlaybackRequestKey &&
          nativeAudioClockReady &&
          nativeSurfaceUsable;
        const nativeDirectSurfacePath =
          nativeSurfaceUsable &&
          Boolean(nativeRequest) &&
          nativePlaybackPath &&
          !qualificationForcesWebView;
        const outputAdapter = nativeDirectSurfacePath
          ? NativeSurfaceOutput
          : WebViewCanvasOutput;
        const nativeReadbackFallbackPath =
          isPlaying &&
          nativePlaybackPath &&
          (!nativeSurfaceUsable || qualificationForcesWebView);
        const telemetryScenario =
          qualification.status === "running"
            ? "qualification"
            : isPlaying
              ? "playback"
              : clock.isSeeking
                ? "seek"
                : "paused-interaction";
        const telemetryContextBase = {
          sessionId: capturedSession.sessionId,
          qualificationRunId:
            qualification.status === "running" ? qualification.runId ?? undefined : undefined,
          scenario: telemetryScenario as "playback" | "seek" | "paused-interaction" | "qualification",
          runtimeEnvironment: import.meta.env.DEV
            ? ("development" as const)
            : ("production" as const),
        };
        previewTelemetryContextRef.current = nativeDirectSurfacePath
          ? {
              view: outputAdapter.path,
              surface: outputAdapter.surface,
              ...telemetryContextBase,
            }
          : {
              view: outputAdapter.path,
              surface: outputAdapter.surface,
              ...telemetryContextBase,
            };
        // The child surface is playback-only on desktop. Paused and seeking
        // frames must be committed to the DOM canvas so they share the exact
        // same placement and layering as the editor overlays (TransformOverlay,
        // SafeOverlay, captions).
        const nativeSurfaceNeedsHide =
          nativeSurfaceShown &&
          (!nativeDirectSurfacePath ||
            !nativeSurfaceUsable ||
            (!nativeRequest && !nativeSurfaceOwnsCurrentFrame));
        if (nativeSurfaceNeedsHide) {
          // tracePlayback("surface-hide-for-recovery", {
          //   projectId: state.project?.id ?? null,
          //   playbackState,
          //   frameIndex,
          //   surfaceReady: nativeSurfaceReadyNow,
          //   surfaceUsable: nativeSurfaceUsable,
          //   hasNativeRequest: Boolean(nativeRequest),
          //   surfaceOwnsCurrentFrame: nativeSurfaceOwnsCurrentFrame,
          // });
          nativeSurfaceShown = false;
          lastNativePlaybackRequestKey = "";
          void hideNativeSurfaceWhenIdle().catch(() => undefined);
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
            dragPreviewRevision === dragPreviewRevisionAtStart &&
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
          const requestToPresent = isPlaying
            ? (nativePlaybackRequest ?? nativeRequest)
            : nativeRequest;
          if (requestToPresent) {
            const requestKey = getNativeFrameRequestKey(requestToPresent);
            if (requestKey !== lastNativePlaybackRequestKey) {
              lastNativePlaybackRequestKey = requestKey;
              const requestSource: NativePreviewRequestSource = {
                requestKey,
                frameIndex: requestToPresent.frameTime.frameIndex,
                request: requestToPresent,
                generation: targetGeneration,
              };

              const persistentNativePlaybackEligible =
                isPlaying &&
                nativeSurfaceUsable &&
                !qualificationForcesWebView &&
                !nativePlaybackRenderFailed;
              if (persistentNativePlaybackEligible) {
                ensureNativePlaybackRenderSnapshot(requestToPresent);
                const snapshotKey = nativePlaybackSnapshotKeyFor(
                  requestToPresent,
                );
                if (
                  nativePlaybackRenderSnapshotKey === snapshotKey &&
                  nativePlaybackRenderSnapshotInFlight === null
                ) {
                  // Rust owns the active decode/present operation and keeps
                  // one latest pending demand. This command contains only
                  // dynamic layer values; it never sends paths or the full
                  // project snapshot and it does not wait for presentation.
                  void submitNativePlaybackDemand(
                    createNativePlaybackFrameDemand(requestToPresent),
                  ).catch((error) => {
                    nativePlaybackRenderFailed = true;
                    lastNativePlaybackRequestKey = "";
                    forceRenderNeeded = true;
                    console.warn("[native-preview] demand-submit-failed", {
                      frameIndex: requestToPresent.frameTime.frameIndex,
                      error: error instanceof Error ? error.message : String(error),
                    });
                  });
                  nativeSurfaceShown = true;
                  lastNativePlaybackRequestKey = requestKey;
                }
              } else if (nativeSurfaceUsable && !qualificationForcesWebView) {
                const tracePresentation = isFirstFrame || !isPlaying;
                if (tracePresentation) {
                  // tracePlayback("native-present-start", {
                  //   projectId: state.project?.id ?? null,
                  //   sessionId: capturedSession.sessionId,
                  //   frameIndex: requestToPresent.frameTime.frameIndex,
                  //   requestKey,
                  //   playbackState,
                  //   audioClockReady: nativeAudioClockReady,
                  //   surfaceReady: nativeSurfaceReadyNow,
                  //   surfaceGeometrySettled:
                  //     nativeSurfaceGeometrySettledRef.current,
                  // });
                }
                const frontendSpan = nativePerfCollector.isEnabled()
                  ? nativePerfCollector.begin(requestToPresent, {
                      view: "native",
                      surface: "native-surface",
                      runtimeEnvironment: import.meta.env.DEV
                        ? "development"
                        : "production",
                      sessionId: capturedSession.sessionId,
                      qualificationRunId:
                        previewQualificationController.getState().runId ?? undefined,
                      scenario:
                        previewQualificationController.getState().status ===
                        "running"
                          ? "qualification"
                          : "playback",
                    })
                  : null;
                frontendSpan?.markDispatchStarted();
                frontendSpan?.markIpcStarted();
                nativePlaybackInFlight = presentNativePlaybackFrame(
                  requestToPresent,
                )
                  .then((presentation) => {
                    frontendSpan?.markIpcFinished();
                    const timings = presentation.timings;
                    if (timings && timings.totalUs >= 16_667) {
                      // tracePlayback("native-present-stages", {
                      //   projectId: state.project?.id ?? null,
                      //   sessionId: capturedSession.sessionId,
                      //   frameIndex: requestToPresent.frameTime.frameIndex,
                      //   totalMs: Number((timings.totalUs / 1000).toFixed(2)),
                      //   decodeMs: Number((timings.decodeUs / 1000).toFixed(2)),
                      //   decoderWaitMs: Number(
                      //     (timings.decoderMutexWaitUs / 1000).toFixed(2),
                      //   ),
                      //   conversionUploadMs: Number(
                      //     (timings.conversionUploadUs / 1000).toFixed(2),
                      //   ),
                      //   composeMs: Number(
                      //     (timings.composeUs / 1000).toFixed(2),
                      //   ),
                      //   surfaceAcquireMs: Number(
                      //     (timings.surfaceAcquireUs / 1000).toFixed(2),
                      //   ),
                      //   submitPresentMs: Number(
                      //     (timings.submitPresentUs / 1000).toFixed(2),
                      //   ),
                      //   queueHit: timings.queueHit,
                      // });
                    }
                    if (tracePresentation) {
                      // tracePlayback("native-present-result", {
                      //   projectId: state.project?.id ?? null,
                      //   sessionId: capturedSession.sessionId,
                      //   frameIndex: requestToPresent.frameTime.frameIndex,
                      //   requestKey,
                      //   playbackState,
                      //   presented: presentation.presented,
                      //   dropped: presentation.dropped,
                      //   stale: presentation.stale,
                      //   frameAgeTicks: presentation.frameAgeTicks,
                      //   audioPositionTicks: presentation.audioPositionTicks,
                      // });
                    }
                    if (!presentation.presented) {
                      // tracePlayback(
                      //   presentation.stale
                      //     ? "native-frame-stale"
                      //     : "native-frame-dropped",
                      //   {
                      //     projectId: state.project?.id ?? null,
                      //     sessionId: capturedSession.sessionId,
                      //     frameIndex: requestToPresent.frameTime.frameIndex,
                      //     playbackState,
                      //     dropped: presentation.dropped,
                      //     stale: presentation.stale,
                      //     frameAgeTicks: presentation.frameAgeTicks,
                      //     audioPositionTicks: presentation.audioPositionTicks,
                      //   },
                      // );
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
                        dropReason:
                          presentation.dropReason ??
                          (presentation.dropped ? "present-failed" : undefined),
                      });
                      lastNativePlaybackRequestKey = "";
                      if (presentation.dropped) {
                        nativeDroppedFrameCount += 1;
                        if (
                          isPlaying &&
                          typeof presentation.audioPositionTicks === "number" &&
                          presentation.audioPositionTicks > 0 &&
                          typeof presentation.frameAgeTicks === "number" &&
                          presentation.frameAgeTicks > 60_000
                        ) {
                          clock.setNativeClockPosition(
                            presentation.audioPositionTicks / 1_000_000,
                            clock.speed,
                          );
                        }
                      }
                    } else {
                      frontendSpan?.finish({
                    stageTimings: timings
                      ? {
                          decodeUs: timings.decodeUs,
                          decoderMutexWaitUs: timings.decoderMutexWaitUs,
                          conversionUploadUs: timings.conversionUploadUs,
                          composeUs: timings.composeUs,
                          surfaceAcquireUs: timings.surfaceAcquireUs,
                          gpuQueueWaitUs: timings.gpuQueueWaitUs,
                          submitPresentUs: timings.submitPresentUs,
                        }
                          : undefined,
                      });
                      const current = renderStateRef.current;
                      const currentRequestIsStillAuthoritative =
                        requestKey === nativeRequestKey || isPlaying;
                      // A stopped clock is the normal state immediately after
                      // project load. A successfully presented frame must be
                      // accepted there as the initial still, and it should
                      // remain visible while a play/pause/seek transition is
                      // waiting for its replacement.
                      const canRetainPresentedSurface =
                        isActive &&
                        nativeSurfaceGeometrySettledRef.current &&
                        current.project?.id === state.project?.id &&
                        current.epoch === state.epoch &&
                        isPlaying;
                      if (
                        canRetainPresentedSurface &&
                        currentRequestIsStillAuthoritative
                      ) {
                        nativeSurfaceShown = true;
                      } else if (
                        canRetainPresentedSurface &&
                        presentation.presented
                      ) {
                        // The request may have become non-authoritative while
                        // it was in flight, but its frame is still valid visual
                        // continuity. Leave the retained surface visible until
                        // the newer request is presented.
                        // tracePlayback("surface-retain-presented-frame", {
                        //   projectId: state.project?.id ?? null,
                        //   frameIndex: requestToPresent.frameTime.frameIndex,
                        //   playbackState,
                        //   currentPlaybackState: current.clock.state,
                        // });
                      }
                    }
                  })
                  .catch((error) => {
                    if (isExpectedStaleNativePreviewError(error)) {
                      // A newer playback tick can invalidate a request while
                      // native decode is still unwinding. This is expected
                      // latest-frame behavior, not a renderer fault.
                      frontendSpan?.markIpcFinished();
                      frontendSpan?.finish({ stale: true });
                      lastNativePlaybackRequestKey = "";
                      forceRenderNeeded = true;
                      return;
                    }
                    console.error("[native-preview] surface-present-failed", {
                      frameIndex: requestToPresent.frameTime.frameIndex,
                      requestKey,
                      textLayers: nativeTextDebugSummary(requestToPresent),
                      error:
                        error instanceof Error ? error.message : String(error),
                    });
                    frontendSpan?.markIpcFinished();
                    frontendSpan?.finish({ dropped: true });
                    nativeContinuousFailureStreak += 1;
                    lastNativePlaybackRequestKey = "";
                    if (nativeContinuousFailureStreak >= 3) {
                      nativeContinuousBlockedRevision = nativeRevision;
                    }
                    nativeRetryAt = performance.now() + 250;
                    if (isActive && nativeSurfaceShown) {
                      nativeSurfaceShown = false;
                      lastNativePlaybackRequestKey = "";
                      void hideNativeSurfaceWhenIdle().catch(() => undefined);
                    }
                  })
                  .finally(() => {
                    nativePlaybackInFlight = null;
                  });
              } else {
                // Non-authoritative readback path used by native-surface
                // recovery and by paused/seeking editor interaction.
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

        // Native Tauri preview normally uses the retained surface during
        // playback. Readback is used automatically for paused/seeking editor
        // interaction and whenever the native surface is unavailable.
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
                const stale = isExpectedStaleNativePreviewError(error);
                if (stale) {
                  // Stale paused work is expected during rapid scrubbing. It
                  // must not trip the renderer circuit breaker or show a
                  // native-only failure toast for an obsolete frame.
                  const frontendSpan =
                    nativeFrontendPerfSpans.get(nativeRequestKey);
                  frontendSpan?.finish({ stale: true });
                  nativeFrontendPerfSpans.delete(nativeRequestKey);
                  nativeRetryAt = 0;
                  forceRenderNeeded = true;
                  return;
                }
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
                  stale,
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
            // Playback prefetch uses the retained native surface path instead.

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
            // Browser/local development has no retained native surface. Paint
            // evaluated text layers through the same package-backed raster
            // bridge so Program Preview is functional before Tauri starts.
            if (
              !isTauriRuntime() &&
              canvasEl &&
              scene.visualLayers.some((layer) => layer.layerType === "text")
            ) {
              const browserPaintStarted = performance.now();
              await paintTextLayersToCanvas(canvasEl, scene);
              canvasPaintMs = performance.now() - browserPaintStarted;
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
              textLayers: nativeRequest
                ? nativeTextDebugSummary(nativeRequest)
                : [],
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
        traceSlowPlaybackStage("visible-render-loop", renderStartedAt, {
          frameIndex: traceFrameIndex,
          playbackState: renderStateRef.current.clock.state,
          textLayerCount: traceTextLayerCount,
          renderInFlightAtStart: true,
        });
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

    const unsubscribeTransformGeometry = transformController.onDragGeometry(
      (geometry, sessionId, revision) => {
        const active = transformController.getActiveTransform();
        if (!active) return;

        dragPreviewClipId = active.clipId;
        dragPreviewSessionId = sessionId;
        dragPreviewRevision = revision;
        dragPreviewGeometry = geometry;
        dragPreviewPendingCommit = false;
        forceRenderNeeded = true;
        scheduleNextFrame();
      },
    );
    const unsubscribeTransformEnd = transformController.onDragEnd(
      (sessionId, finalGeometry) => {
        dragPreviewSessionId = sessionId;
        dragPreviewRevision += 1;
        dragPreviewGeometry = finalGeometry;
        dragPreviewPendingCommit = true;
        forceRenderNeeded = true;
        scheduleNextFrame();
      },
    );

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
          scheduleUpcomingNativeTextPrefetch();
        }
      }
      scheduleNextFrame();
    });

    scheduleNextFrame();
    return () => {
      // tracePlayback("playback-loop-stop", {
      //   projectId: project.id,
      //   sessionId: capturedSession.sessionId,
      //   playbackState: clock.state,
      //   surfaceReady: nativeSurfaceReadyRef.current,
      //   surfacePresenting: nativeSurfaceShown,
      //   renderInFlight,
      // });
      isActive = false;
      unsubscribeClock();
      unsubscribeSeekIntent?.();
      unsubscribeTransformGeometry();
      unsubscribeTransformEnd();
      nativePreviewScheduler.dispose();
      if (nativeTextPrefetchTimer !== null) {
        window.clearTimeout(nativeTextPrefetchTimer);
        nativeTextPrefetchTimer = null;
      }
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
  }, [canvasEl, project?.id, projectInitializing]);

  // Wake the paused native renderer for timeline edits, text input, seeks,
  // and viewport changes. When actively playing, the RAF loop runs continuously;
  // do not trigger wake loops on every clock tick.
  useEffect(() => {
    if (clock.state !== "playing") {
      wakeNativeRenderLoopRef.current?.();
    }
  }, [
    clips,
    tracks,
    transitions,
    mediaAssets,
    epoch,
    dimensions.width,
    dimensions.height,
    previewQuality,
    nativeSurfaceError,
  ]);

  useEffect(() => {
    setActiveContext("program");
    if (typeof window !== "undefined") {
      (
        window as unknown as { __CLYPRA_PREVIEW_DEBUG__?: unknown }
      ).__CLYPRA_PREVIEW_DEBUG__ = {
        getPlaybackState: () => clock.getState(),
        getPreviewOutputMode: () =>
          previewTelemetryContextRef.current.surface === "native-surface"
            ? "native-surface"
            : "dom-readback",
      };
    }
  }, [setActiveContext, clock]);

  if (!project) return null;

  const duration = project.duration || 0;
  const frameRate = project.frameRate ?? 30;
  const step = 1 / Math.max(1, frameRate);

  return (
    <div
      data-preview-space="program"
      className="flex-1 bg-bg flex flex-col min-h-0 border-l border-t border-white/3"
    >
      <div
        data-preview-header
        className="flex items-center px-4 h-10 shrink-0 gap-2 overflow-hidden"
      >
        <span className="text-[13px] font-semibold text-text-primary tracking-tight leading-none">
          Program Preview
        </span>
        {import.meta.env.DEV && nativeSurfaceError && (
          <span className="text-[11px] text-danger leading-none truncate">
            Preview surface unavailable
          </span>
        )}
        <button
          onClick={() => setShowSafeOverlay((s) => !s)}
          className={cn(
            "ml-auto px-2 h-6 rounded text-[10px] font-medium transition-colors cursor-pointer",
            showSafeOverlay
              ? "bg-accent/20 text-accent"
              : "text-text-muted hover:text-text-primary hover:bg-white/6",
          )}
        >
          Safe Zones
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center overflow-hidden bg-[#06080a] relative">
        <div
          ref={previewContainerCallback}
          onPointerDownCapture={handlePreviewPointerDownCapture}
          className={cn(
            "w-full h-full flex items-center justify-center relative z-10 overflow-hidden",
            isPanning && "cursor-grabbing",
            spacePressed && !isPanning && "cursor-grab",
          )}
        >
          {dimensions.width > 0 && dimensions.height > 0 ? (
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
                  }}
                />

                <ConnectedTransformOverlay
                  canvasWidth={canvasWidth}
                  canvasHeight={canvasHeight}
                  scale={scale}
                  viewport={viewport}
                  displayOffset={{ x: offsetX, y: offsetY }}
                  displayWidth={displayWidth}
                  displayHeight={displayHeight}
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
          ) : (
            <div className="text-text-muted">Loading preview...</div>
          )}
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

      <ConnectedProgramTransport
        duration={duration}
        frameRate={frameRate}
        disabled={clips.length === 0}
        onPlayPause={() => {
          if (clips.length === 0) return;
          setActiveContext?.("program");
          clock.state === "playing" ? transportPause() : transportPlay();
        }}
        onSeek={(time) => {
          if (clips.length === 0) return;
          transportSeek(clampAndSnapProgramTime(time, duration, frameRate));
        }}
        formatTime={formatTime}
        onStepBack={(currentTime) => {
          if (clips.length === 0) return;
          const targetTime = Math.max(0, currentTime - step);
          transportSeek(
            clampAndSnapProgramTime(targetTime, duration, frameRate),
            { mode: "frameStep", quality: "full" },
          );
        }}
        onStepForward={(currentTime) => {
          if (clips.length === 0) return;
          const targetTime = Math.min(duration, currentTime + step);
          transportSeek(
            clampAndSnapProgramTime(targetTime, duration, frameRate),
            { mode: "frameStep", quality: "full" },
          );
        }}
        speedMenuRef={speedMenuRef}
        speedMenuOpen={speedMenuOpen}
        setSpeedMenuOpen={setSpeedMenuOpen}
        transportSetSpeed={transportSetSpeed}
        aspectMenuRef={aspectMenuRef}
        aspectMenuOpen={aspectMenuOpen}
        setAspectMenuOpen={setAspectMenuOpen}
        previewAspectPreset={previewAspectPreset}
        selectAspectPreset={selectAspectPreset}
        canvasWidth={canvasWidth}
        canvasHeight={canvasHeight}
        isMuted={isMuted}
        setIsMuted={setIsMuted}
        volume={volume}
        setVolume={setVolume}
        scopesOpen={scopesOpen}
        setScopesOpen={setScopesOpen}
      />

      <VideoScopesModal
        isOpen={scopesOpen}
        onClose={() => setScopesOpen(false)}
      />
    </div>
  );
};

/** @deprecated Import NativeProgramPreview. Kept temporarily for downstream integrations. */

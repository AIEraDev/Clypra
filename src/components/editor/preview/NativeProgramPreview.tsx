import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Expand, Shrink } from "lucide-react";
import { usePlaybackClock, usePlaybackControls, useTransportControls, getPlaybackClock } from "@/hooks/usePlaybackClock";
import { useProjectStore } from "@/store/projectStore";
import { useTimelineStore } from "@/store/timelineStore";
import { useUIStore } from "@/store/uiStore";
import { useSettingsStore } from "@/store/settingsStore";
import { getActiveSessionOrNull } from "@/core/runtime/ProjectSession";
import { getTransformController } from "@/core/interactions";
import { useViewportState } from "@/hooks/useViewportController";
import { PreviewTransport } from "./PreviewTransport";
import { TransformOverlayMemoized as TransformOverlay } from "../transform/TransformOverlay";
import { SafeOverlay } from "../viewport/SafeOverlay";
import { useViewportKeyboardShortcuts, useViewportWheelZoom, useViewportPan } from "../viewport/ViewportControls";
import { calculateDisplayTransform } from "@/lib/utils/coordinateSystem";
import { PreviewQualityManager, PreviewQualityTier } from "./PreviewQualityManager";
import { cn } from "@/lib/utils";
import { AspectRatio } from "@/types";
import { formatTime } from "@/lib/utils/timeFormatting";
import { refitClipsForCanvasChange } from "@/lib/timeline/refitClips";
import { useAudioSyncEngine } from "@/hooks/useAudioSyncEngine";

import { type TelemetryStats } from "./TelemetryOverlay";
import { AspectSelector } from "./AspectSelector";
import { PlaybackSpeedSelector } from "./PlaybackSpeedSelector";
import { PlaybackQualitySelector } from "./PlaybackQualitySelector";
import { VolumeControl } from "./VolumeControl";
import { getCanvasBackgroundLayer } from "./canvasBackground";
import { drawCanvasBackground } from "@/core/render/canvasBackground";
import { captureCanvasThumbnail } from "@/lib/media/projectThumbnail";
import { getFrameIndexAtTime, getFrameStartTime } from "@/lib/utils/frameTime";
import {
  getNativePreviewSurfaceGeometry,
  hideNativeSurface,
  isTauriRuntime,
  onNativePreviewWindowMoved,
  presentNativeFrame,
  queueNativeFrame,
  registerNativeRasterAsset,
  probeNativeSurface,
  renderNativeFrame,
  resizeNativeSurface,
} from "@/lib/platform/tauri";
import type { NativeSurfaceGeometry } from "@/lib/platform/nativeCore";

import { SmartOverlayRenderer } from "@/features/smart-overlays/renderer/SmartOverlayRenderer";
import type { SmartOverlayClip } from "@/types/smartOverlay";
import { KaraokeCaptions } from "@/components/captions/KaraokeCaptions";
import { useCaptionStore } from "@/store/captionStore";
import type { EvaluatedScene } from "@/core/evaluation/types";
import { makeBodyMaskCacheKey, segmentBodyMask } from "@/features/body-effects";
import { useEffectsStore } from "@/features/text-effects/store/effectsStore";


import { evaluateTimelineSceneCached, type PrecomputedSceneVersions } from "@/core/evaluation/evaluator";
import { computeClipVersion, computeAssetsVersion, computeEffectsStoreVersion } from "@/core/evaluation/cache";
import {
  buildNativeFrameRequest,
  getNativePreviewBlockers,
  getNativeFrameRequestKey,
  isRenderableNativePreviewFrame,
} from "./nativeVideoPreview";
import { NativePreviewFrameScheduler, type NativePreviewRequestSource } from "./nativePreviewScheduler";
import {
  buildNativeTextRasterKey,
  rasterizeTextLayerForNative,
  type NativeTextRasterAsset,
} from "./nativeTextPreview";
import { NativeAnimatedStickerRenderer, type NativeAnimatedStickerRaster } from "./nativeStickerPreview";
import {
  NATIVE_PREVIEW_ONLY,
  type NativeFrameRequest,
  type NativeRasterLayerSnapshot,
} from "@/lib/platform/nativeCore";


const CANVAS_DIMENSIONS: Record<Exclude<AspectRatio, "original">, { width: number; height: number }> = {
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
  if (frame.width <= 0 || frame.height <= 0 || frame.rgba.byteLength !== frame.width * frame.height * 4) {
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
  const { seek, setSpeed, setDuration, setFrameRate } = usePlaybackControls();
  const { play: transportPlay, pause: transportPause, setActiveContext } = useTransportControls();

  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(100);

  // Browser audio uses Web Audio; Tauri program preview uses the native CPAL
  // authority through the same transport hook.
  useAudioSyncEngine({ volume, muted: isMuted, nativeMode: isTauriRuntime() });
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [previewScaleMode, setPreviewScaleMode] = useState<"fit" | "fill">("fit");
  const [previewAspectPreset, setPreviewAspectPreset] = useState<AspectRatio>("original");
  const [aspectMenuOpen, setAspectMenuOpen] = useState(false);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [showTelemetry, setShowTelemetry] = useState(false);
  const [showSafeOverlay, setShowSafeOverlay] = useState(false);
  const [telemetryStats, setTelemetryStats] = useState<TelemetryStats | null>(null);
  const [nativeSurfaceReady, setNativeSurfaceReady] = useState(false);
  // Audit 4.6 fix: mirror nativeSurfaceReady in a ref so the render loop can read the
  // latest value imperatively without nativeSurfaceReady being listed in the effect deps.
  // Having it in deps caused the entire render loop to restart (RAF cancelled, blank frame)
  // on every native surface probe and window resize.
  const nativeSurfaceReadyRef = useRef(false);
  const [nativeSurfacePresenting, setNativeSurfacePresenting] = useState(false);
  const [nativeOnlyBlocked, setNativeOnlyBlocked] = useState(false);
  const [nativeOnlyBlockers, setNativeOnlyBlockers] = useState<string[]>([]);
  const nativeOnlyBlockedRef = useRef(false);
  const nativeOnlyBlockersKeyRef = useRef("");

  const previewContainerRef = useRef<HTMLDivElement>(null);
  const nativeSurfaceTargetRef = useRef<HTMLDivElement>(null);
  const nativeSurfaceConfiguredRef = useRef(false);
  const nativeSurfaceGeometrySettledRef = useRef(false);
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const previewContainerCallback = useCallback((node: HTMLDivElement | null) => {
    previewContainerRef.current = node;
    setContainerEl(node);
  }, []);

  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const canvasRef = useCallback((node: HTMLCanvasElement | null) => {
    setCanvasEl(node);
  }, []);

  const [smartOverlayCanvasEl, setSmartOverlayCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const smartOverlayCanvasRefObj = useRef<HTMLCanvasElement | null>(null);
  const smartOverlayCanvasRef = useCallback((node: HTMLCanvasElement | null) => {
    smartOverlayCanvasRefObj.current = node;
    setSmartOverlayCanvasEl(node);
  }, []);

  const aspectMenuRef = useRef<HTMLDivElement>(null);
  const speedMenuRef = useRef<HTMLDivElement>(null);
  const qualityMenuRef = useRef<HTMLDivElement>(null);
  const qualityManagerRef = useRef<PreviewQualityManager | null>(null);
  // Native frames are authoritative for representable scenes. Retaining the
  // last successful frame prevents media-pool updates or native decode latency
  // from blanking the preview while the next exact frame is being decoded.
  const nativeDisplayedFrameRef = useRef<{ rgba: ArrayBuffer; width: number; height: number } | null>(null);
  const qualityManagerSigRef = useRef<string>("");
  const telemetryRef = useRef(telemetryStats);
  const lastTelemetryFlushRef = useRef(0);
  const showTelemetryRef = useRef(showTelemetry);
  const droppedFramesRef = useRef(0);
  const maxDriftRef = useRef(0);
  const originalCanvasDimsRef = useRef<{ projectId: string; width: number; height: number } | null>(null);
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
      effectsStoreVersion: computeEffectsStoreVersion(useEffectsStore.getState().definitions),
    } satisfies PrecomputedSceneVersions,
  });

  showTelemetryRef.current = showTelemetry;
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
    effectsStoreVersion: computeEffectsStoreVersion(useEffectsStore.getState().definitions),
  };

  const canvasWidth = project?.canvasWidth ?? 1920;
  const canvasHeight = project?.canvasHeight ?? 1080;

  useViewportKeyboardShortcuts(canvasWidth, canvasHeight, dimensions.width, dimensions.height);
  useViewportWheelZoom(previewContainerRef as React.RefObject<HTMLElement>);
  const { isPanning, spacePressed } = useViewportPan(previewContainerRef as React.RefObject<HTMLElement>);

  const displayTransform = useMemo(() => {
    return calculateDisplayTransform({ width: canvasWidth, height: canvasHeight }, viewport, dimensions.width, dimensions.height, previewScaleMode);
  }, [canvasWidth, canvasHeight, viewport.panX, viewport.panY, viewport.zoom, dimensions.width, dimensions.height, previewScaleMode]);

  const { scale, offsetX, offsetY, displayWidth, displayHeight } = displayTransform;

  // The native presenter is hosted in a transparent child surface positioned
  // over the displayed program viewport and configured only in Tauri.
  useEffect(() => {
    if (!isTauriRuntime() || !nativeSurfaceTargetRef.current || displayWidth <= 0 || displayHeight <= 0) {
      return;
    }

    let active = true;
    let syncInFlight = false;
    let syncRequested = false;
    let appliedGeometryKey = "";

    const geometryKey = (geometry: NativeSurfaceGeometry): string => [
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
            if (nextGeometryKey === appliedGeometryKey && nativeSurfaceConfiguredRef.current) continue;

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
            if (active) { nativeSurfaceReadyRef.current = true; setNativeSurfaceReady(true); }
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
    let unlistenWindowMoved: (() => void) | null = null;
    void onNativePreviewWindowMoved(syncSurface)
      .then((unlisten) => {
        if (active) {
          unlistenWindowMoved = unlisten;
        } else {
          unlisten();
        }
      })
      .catch(() => undefined);
    const resizeObserver = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => syncSurface())
      : null;
    resizeObserver?.observe(nativeSurfaceTargetRef.current);
    window.addEventListener("resize", handleWindowResize);

    return () => {
      active = false;
      resizeObserver?.disconnect();
      unlistenWindowMoved?.();
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
          refitClipsForCanvasChange(originalCanvasDimsRef.current.width, originalCanvasDimsRef.current.height);
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
  }, [project?.canvasWidth, project?.canvasHeight, project?.aspectRatio, project?.id]);

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
      qualityManagerRef.current.updateViewport(Math.floor(displayWidth), Math.floor(displayHeight), dprVal);
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
    let frameScheduled = false;
    let lastRenderLoopError = "";

    // Native frame decode/presentation is asynchronous. A small measured
    // look-ahead keeps the frame that completes aligned with the audio clock
    // instead of presenting the frame that was current when decoding started.
    let nativePresentationLatencyMs = 0;
    let nativeSurfaceShown = false;
    let lastNativePlaybackRequestKey = "";
    let visibleRequestKey = "";
    let visibleRequestGeneration = 0;
    let prefetchCenterKey = "";
    let transportRevision = 0;
    const nativeTextRasterCache = new Map<string, Promise<NativeTextRasterAsset>>();
    const registeredNativeTextAssets = new Set<string>();
    const nativeTextAssetsById = new Map<string, NativeTextRasterAsset>();
    const nativeBodyMaskInFlight = new Map<string, Promise<NativeRasterLayerSnapshot | null>>();
    const nativeBodyMaskAssetsById = new Map<string, NativeRasterLayerSnapshot & { rgba: number[] }>();
    const registeredNativeBodyMaskAssets = new Set<string>();
    const nativeSmartOverlayAssetsById = new Map<string, NativeRasterLayerSnapshot & { rgba: number[] }>();
    const nativeAnimatedStickerRenderer = new NativeAnimatedStickerRenderer();
    const nativeAnimatedStickerAssetsById = new Map<string, NativeAnimatedStickerRaster>();
    const registeredNativeAnimatedStickerAssets = new Set<string>();
    const nativeBackgroundAssetsById = new Map<string, NativeRasterLayerSnapshot & { rgba: number[] }>();
    const registeredNativeBackgroundAssets = new Set<string>();
    const maxNativeTextRasterCacheEntries = 96;
    const maxNativeBodyMaskCacheEntries = 90;
    const maxNativeSmartOverlayCacheEntries = 48;
    const maxNativeAnimatedStickerCacheEntries = 90;
    const maxNativeBackgroundCacheEntries = 90;

    const ensureNativeTextAssetRegistered = async (
      asset: NativeTextRasterAsset,
      force = false,
    ): Promise<void> => {
      nativeTextAssetsById.delete(asset.assetId);
      nativeTextAssetsById.set(asset.assetId, asset);
      while (nativeTextAssetsById.size > maxNativeTextRasterCacheEntries) {
        const oldestId = nativeTextAssetsById.keys().next().value as string | undefined;
        if (!oldestId) break;
        nativeTextAssetsById.delete(oldestId);
        registeredNativeTextAssets.delete(oldestId);
      }

      if (!force && registeredNativeTextAssets.has(asset.assetId)) return;
      await registerNativeRasterAsset(asset);
      registeredNativeTextAssets.add(asset.assetId);
    };

    const rasterizeNativeTextLayers = async (scene: EvaluatedScene): Promise<NativeRasterLayerSnapshot[]> => {
      const textLayers = scene.visualLayers.filter((layer) => layer.layerType === "text");
      if (!isTauriRuntime() || textLayers.length === 0) return [];

      try {
        const assets = await Promise.all(textLayers.map((layer) => {
          const key = buildNativeTextRasterKey(layer);
          const cached = nativeTextRasterCache.get(key);
          if (cached) {
            nativeTextRasterCache.delete(key);
            nativeTextRasterCache.set(key, cached);
            return cached;
          }

          const raster = rasterizeTextLayerForNative(layer);
          nativeTextRasterCache.set(key, raster);
          while (nativeTextRasterCache.size > maxNativeTextRasterCacheEntries) {
            const oldestKey = nativeTextRasterCache.keys().next().value as string | undefined;
            if (!oldestKey) break;
            nativeTextRasterCache.delete(oldestKey);
          }
          void raster.catch(() => {
            if (nativeTextRasterCache.get(key) === raster) nativeTextRasterCache.delete(key);
          });
          return raster;
        }));

        await Promise.all(assets.map((asset) => ensureNativeTextAssetRegistered(asset)));

        return assets.map(({ rgba: _rgba, ...asset }) => asset);
      } catch {
        return [];
      }
    };

    const ensureNativeBodyMaskAssetRegistered = async (
      asset: NativeRasterLayerSnapshot & { rgba: number[] },
      force = false,
    ): Promise<void> => {
      nativeBodyMaskAssetsById.set(asset.assetId, asset);
      while (nativeBodyMaskAssetsById.size > maxNativeBodyMaskCacheEntries) {
        const oldestId = nativeBodyMaskAssetsById.keys().next().value as string | undefined;
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
        (layer): layer is import("@/core/evaluation/types").EvaluatedMediaLayer => layer.layerType === "media",
      );

      for (const layer of mediaLayers) {
        const bodyEffects = (layer.effects ?? []).filter((effect) => {
          const renderer = (effect.renderer || effect.effectId).replace(/^fx-/, "").replace(/-/g, "_").toLowerCase();
          return effect.intensity > 0.001 && ["body_outline", "body_glow", "body_segmentation_glow", "body_particles"].includes(renderer);
        });
        if (bodyEffects.length === 0) continue;

        const source = videoElements.get(`${layer.clipId}-${layer.mediaId}`);
        if (!source || source.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) continue;
        const width = Math.max(1, Math.floor(source.videoWidth || layer.width));
        const height = Math.max(1, Math.floor(source.videoHeight || layer.height));

        for (const effect of bodyEffects) {
          const renderer = (effect.renderer || effect.effectId).replace(/^fx-/, "").replace(/-/g, "_").toLowerCase();
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
            }).then(async (mask) => {
              if (!mask) return null;
              const nativeAsset: NativeRasterLayerSnapshot & { rgba: number[] } = {
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
            }).catch(() => {
              return null;
            }).finally(() => {
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

    const ensureNativeAnimatedStickerAssetRegistered = async (
      asset: NativeAnimatedStickerRaster,
      force = false,
    ): Promise<void> => {
      nativeAnimatedStickerAssetsById.set(asset.assetId, asset);
      while (nativeAnimatedStickerAssetsById.size > maxNativeAnimatedStickerCacheEntries) {
        const oldestId = nativeAnimatedStickerAssetsById.keys().next().value as string | undefined;
        if (!oldestId) break;
        nativeAnimatedStickerAssetsById.delete(oldestId);
        registeredNativeAnimatedStickerAssets.delete(oldestId);
      }
      if (!force && registeredNativeAnimatedStickerAssets.has(asset.assetId)) return;
      await registerNativeRasterAsset(asset);
      registeredNativeAnimatedStickerAssets.add(asset.assetId);
    };

    const rasterizeNativeAnimatedStickers = async (scene: EvaluatedScene): Promise<NativeRasterLayerSnapshot[]> => {
      if (!isTauriRuntime()) return [];
      const layers = scene.visualLayers.filter(
        (layer): layer is import("@/core/evaluation/types").EvaluatedMediaLayer =>
          layer.layerType === "media" && layer.clipKind === "sticker" && layer.stickerFormat === "lottie",
      );
      const assets: NativeRasterLayerSnapshot[] = [];
      for (const layer of layers) {
        try {
          const raster = await nativeAnimatedStickerRenderer.render(layer);
          if (!raster) continue;
          const cached = nativeAnimatedStickerAssetsById.get(raster.assetId);
          if (!cached) await ensureNativeAnimatedStickerAssetRegistered(raster);
          assets.push({ ...raster, rgba: undefined });
        } catch {
          // ignore
        }
      }
      return assets;
    };

    const ensureNativeBackgroundAssetRegistered = async (
      asset: NativeRasterLayerSnapshot & { rgba: number[] },
      force = false,
    ): Promise<void> => {
      nativeBackgroundAssetsById.set(asset.assetId, asset);
      while (nativeBackgroundAssetsById.size > maxNativeBackgroundCacheEntries) {
        const oldestId = nativeBackgroundAssetsById.keys().next().value as string | undefined;
        if (!oldestId) break;
        nativeBackgroundAssetsById.delete(oldestId);
        registeredNativeBackgroundAssets.delete(oldestId);
      }
      if (!force && registeredNativeBackgroundAssets.has(asset.assetId)) return;
      await registerNativeRasterAsset(asset);
      registeredNativeBackgroundAssets.add(asset.assetId);
    };

    const rasterizeNativeBackground = async (
      scene: EvaluatedScene,
      frameIndex: number,
    ): Promise<NativeRasterLayerSnapshot[]> => {
      if (!isTauriRuntime() || typeof document === "undefined") return [];
      const background = scene.metadata.canvasBackground;
      if (
        !background ||
        background.isTransparent ||
        background.type === "solid" ||
        (background.type !== "gradient" && background.type !== "shader")
      ) return [];

      const width = Math.max(1, Math.round(scene.metadata.canvasWidth || renderStateRef.current.canvasWidth));
      const height = Math.max(1, Math.round(scene.metadata.canvasHeight || renderStateRef.current.canvasHeight));
      // Audit 3.2 fix: use a stable sorted-key serializer instead of JSON.stringify.
      // Plain JSON.stringify does not guarantee property order across different creation
      // paths (spread, deserialization, etc.), causing false cache misses for identical
      // gradient/shader configs.
      const stableBackgroundKey = JSON.stringify(background, Object.keys(background as object).sort());
      const assetId = `native-background:${frameIndex}:${stableBackgroundKey}`;
      const cached = nativeBackgroundAssetsById.get(assetId);
      if (cached) return [{ ...cached, rgba: undefined }];

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) return [];
      drawCanvasBackground(context, background, width, height, scene.metadata.time);
      const asset: NativeRasterLayerSnapshot & { rgba: number[] } = {
        assetId,
        rgba: Array.from(context.getImageData(0, 0, width, height).data),
        width,
        height,
        x: 0,
        y: 0,
        rotation: 0,
        opacity: 1,
        zIndex: -1_000_000,
        blendMode: "normal",
        isText: false,
      };
      await ensureNativeBackgroundAssetRegistered(asset);
      return [{ ...asset, rgba: undefined }];
    };

    const reRegisterTextAssetsForRequest = async (request: NativeFrameRequest): Promise<boolean> => {
      const references = request.project.rasterLayers ?? [];
      if (references.length === 0) return false;
      const textAssets = references
        .map((reference) => nativeTextAssetsById.get(reference.assetId))
        .filter((asset): asset is NativeTextRasterAsset => Boolean(asset));
      const maskAssets = references
        .map((reference) => nativeBodyMaskAssetsById.get(reference.assetId))
        .filter((asset): asset is NativeRasterLayerSnapshot & { rgba: number[] } => Boolean(asset));
      const stickerAssets = references
        .map((reference) => nativeAnimatedStickerAssetsById.get(reference.assetId))
        .filter((asset): asset is NativeAnimatedStickerRaster => Boolean(asset));
      const backgroundAssets = references
        .map((reference) => nativeBackgroundAssetsById.get(reference.assetId))
        .filter((asset): asset is NativeRasterLayerSnapshot & { rgba: number[] } => Boolean(asset));
      if (textAssets.length + maskAssets.length + stickerAssets.length + backgroundAssets.length !== references.length) return false;
      await Promise.all([
        ...textAssets.map((asset) => ensureNativeTextAssetRegistered(asset, true)),
        ...maskAssets.map((asset) => ensureNativeBodyMaskAssetRegistered(asset, true)),
        ...stickerAssets.map((asset) => ensureNativeAnimatedStickerAssetRegistered(asset, true)),
        ...backgroundAssets.map((asset) => ensureNativeBackgroundAssetRegistered(asset, true)),
      ]);
      return true;
    };

    const rasterizeNativeSmartOverlays = async (
      smartClips: SmartOverlayClip[],
      currentTime: number,
      width: number,
      height: number,
      frameIndex: number,
    ): Promise<NativeRasterLayerSnapshot[]> => {
      if (!isTauriRuntime() || smartClips.length === 0 || typeof document === "undefined") return [];

      const rasterWidth = Math.max(1, Math.round(width));
      const rasterHeight = Math.max(1, Math.round(height));
      const assetId = `native-smart-overlay:${frameIndex}:${smartClips.map((clip) => clip.id).join(",")}`;
      const cached = nativeSmartOverlayAssetsById.get(assetId);
      if (cached) {
        return [{ ...cached, rgba: undefined }];
      }

      const canvas = document.createElement("canvas");
      canvas.width = rasterWidth;
      canvas.height = rasterHeight;
      const context = canvas.getContext("2d");
      if (!context) return [];
      context.clearRect(0, 0, rasterWidth, rasterHeight);
      for (const smartClip of smartClips) {
        const renderer = new SmartOverlayRenderer(smartClip);
        renderer.draw(context, currentTime - smartClip.startTime, rasterWidth, rasterHeight);
      }

      const rgba = Array.from(context.getImageData(0, 0, rasterWidth, rasterHeight).data);
      if (!rgba.some((value, index) => index % 4 === 3 && value > 0)) return [];

      const asset: NativeRasterLayerSnapshot & { rgba: number[] } = {
        assetId,
        rgba,
        width: rasterWidth,
        height: rasterHeight,
        x: 0,
        y: 0,
        rotation: 0,
        opacity: 1,
        zIndex: 1_000_000,
        blendMode: "normal",
        isText: false,
      };
      await registerNativeRasterAsset(asset);
      nativeSmartOverlayAssetsById.set(assetId, asset);
      while (nativeSmartOverlayAssetsById.size > maxNativeSmartOverlayCacheEntries) {
        const oldestId = nativeSmartOverlayAssetsById.keys().next().value as string | undefined;
        if (!oldestId) break;
        nativeSmartOverlayAssetsById.delete(oldestId);
      }
      return [{ ...asset, rgba: undefined }];
    };

    const nativePreviewScheduler = new NativePreviewFrameScheduler({
      maxCacheEntries: 12,
      maxInFlight: 2,
      load: async (request) => {
        const render = () => renderNativeFrame(request);
        let rgba: ArrayBuffer;
        try {
          rgba = await render();
        } catch (error) {
          if (!await reRegisterTextAssetsForRequest(request)) throw error;
          rgba = await render();
        }
        if (!isRenderableNativePreviewFrame(rgba, request.outputWidth, request.outputHeight)) {
          throw new Error("Native preview returned an invalid frame payload");
        }
        return {
          rgba,
          width: request.outputWidth,
          height: request.outputHeight,
        };
      },
    });

    const presentNativePlaybackFrame = async (request: NativeFrameRequest) => {
      const present = () => queueNativeFrame(request).then(() => presentNativeFrame(request));
      try {
        return await present();
      } catch (error) {
        if (!await reRegisterTextAssetsForRequest(request)) throw error;
        return present();
      }
    };

    const scheduleNextFrame = () => {
      if (!isActive || frameScheduled) return;
      frameScheduled = true;
      rafId = requestAnimationFrame(() => {
        frameScheduled = false;
        void renderLoop();
      });
    };

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

      const timeChanged = frameIndex !== lastRenderedFrameIndex;
      const epochChanged = state.epoch !== lastRenderedEpoch;
      const transportChanged = transportRevision !== lastRenderedTransportRevision;
      const isFirstFrame = lastRenderedFrameIndex === -1;

      const scene = evaluateTimelineSceneCached(frameStartTime, state.clips, state.tracks, state.mediaAssets, state.project, state.epoch, state.transitions, state.sceneVersions);
      const nativeBackground = await rasterizeNativeBackground(scene, frameIndex);
      const nativeTextRasters = await rasterizeNativeTextLayers(scene);
      const nativeBodyMasks = await rasterizeNativeBodyMasks(
        scene,
        getActiveSessionOrNull()?.getPreviewVideoElements() ?? new Map(),
      );
      const nativeAnimatedStickers = await rasterizeNativeAnimatedStickers(scene);
      const nativeActiveSmartClips = state.clips.filter(
        (clip): clip is SmartOverlayClip =>
          clip.kind === "smart-overlay" &&
          frameStartTime >= clip.startTime &&
          // Audit 3.5 fix: use strict < to match the evaluator's boundary convention
          // (startTime <= evalTime < clipEnd). Was <= which rendered overlays one extra frame.
          frameStartTime < clip.startTime + clip.duration,
      );
      const nativeSmartOverlays = await rasterizeNativeSmartOverlays(
        nativeActiveSmartClips,
        frameStartTime,
        state.canvasWidth,
        state.canvasHeight,
        frameIndex,
      );
      const nativeRasterLayers = [
        ...nativeBackground,
        ...nativeTextRasters,
        ...nativeBodyMasks,
        ...nativeAnimatedStickers,
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
      );
      let nativePlaybackRequest = nativeRequest;
      if (isPlaying && nativeRequest && nativePresentationLatencyMs > 0) {
        const leadFrames = Math.min(
          6,
          Math.max(0, Math.round((nativePresentationLatencyMs * frameRate) / 1000)),
        );
        if (leadFrames > 0) {
          const durationFrames = Math.max(1, Math.ceil(state.clock.duration * frameRate));
          const lookAheadFrame = Math.min(durationFrames - 1, frameIndex + leadFrames);
          if (lookAheadFrame !== frameIndex) {
            const lookAheadTime = getFrameStartTime(lookAheadFrame / frameRate, frameRate);
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
            const lookAheadBackground = await rasterizeNativeBackground(lookAheadScene, lookAheadFrame);
            const lookAheadTextRasters = await rasterizeNativeTextLayers(lookAheadScene);
            const lookAheadAnimatedStickers = await rasterizeNativeAnimatedStickers(lookAheadScene);
            const lookAheadSmartClips = state.clips.filter(
              (clip): clip is SmartOverlayClip =>
                clip.kind === "smart-overlay" &&
                lookAheadTime >= clip.startTime &&
                lookAheadTime <= clip.startTime + clip.duration,
            );
            const lookAheadSmartOverlays = await rasterizeNativeSmartOverlays(
              lookAheadSmartClips,
              lookAheadTime,
              state.canvasWidth,
              state.canvasHeight,
              lookAheadFrame,
            );
            nativePlaybackRequest = buildNativeFrameRequest(
              lookAheadScene,
              `${state.project?.id ?? "unknown-project"}:${state.epoch}`,
              lookAheadFrame,
              frameRate,
              state.canvasWidth,
              state.canvasHeight,
              [...lookAheadBackground, ...lookAheadTextRasters, ...lookAheadAnimatedStickers, ...lookAheadSmartOverlays],
            ) ?? nativeRequest;
          }
        }
      }
      const nativeRequestKey = nativeRequest ? getNativeFrameRequestKey(nativeRequest) : "";
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
        prefetchCenterKey = "";
      }
      const targetGeneration = visibleRequestGeneration;
      // Do not hand the visible surface to native video until native audio has
      // supplied its first hardware-clock sample. Before that point the
      // Wait for the native audio clock before handing continuous playback to
      // the retained surface; readback remains available while it initializes.
      const nativeAudioClockReady = !isTauriRuntime() || state.clock.hasNativeClockPosition;
      const nativePlaybackPath = isTauriRuntime() && Boolean(nativePlaybackRequest) && isPlaying && nativeAudioClockReady;
      const nativePausedPath = isTauriRuntime() && Boolean(nativeRequest) && !isPlaying;
      // The child surface is playback-only. Paused and seeking frames must be
      // committed to the DOM canvas so they share the exact same placement as
      // the editor overlays and transport layout.
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
          ...(!nativeRequest ? getNativePreviewBlockers(scene, nativeRasterLayers) : []),
          ...(!nativeSurfaceReadyNow ? ["The retained native wgpu surface is not ready."] : []),
        ];
        const blockerKey = blockers.join("\n");
        if (nativeOnlyBlockersKeyRef.current !== blockerKey) {
          nativeOnlyBlockersKeyRef.current = blockerKey;
          setNativeOnlyBlockers(blockers);
        }
      }
      if (nativeOnlyBlockedRef.current !== nativeOnlySceneBlocked) {
        nativeOnlyBlockedRef.current = nativeOnlySceneBlocked;
        setNativeOnlyBlocked(nativeOnlySceneBlocked);
      }
      const nativeRevision = `${state.project?.id ?? "unknown-project"}:${state.epoch}`;
      if (nativeRevision !== nativeContinuousObservedRevision) {
        nativeContinuousObservedRevision = nativeRevision;
        nativeContinuousFailureStreak = 0;
        nativeContinuousBlockedRevision = "";
      }
      const nativeSurfaceUsable = nativeSurfaceReadyNow && nativeSurfaceGeometrySettledRef.current &&
        nativeContinuousBlockedRevision !== nativeRevision;
      const nativeSurfaceOwnsCurrentFrame = nativeSurfaceShown && isPlaying &&
        lastNativePlaybackRequestKey === nativePlaybackRequestKey && nativeAudioClockReady &&
        nativeSurfaceUsable;
      const nativeDirectSurfacePath = nativeSurfaceUsable && Boolean(nativeRequest) && nativePlaybackPath;
      const nativeReadbackFallbackPath = isPlaying && nativePlaybackPath && !nativeSurfaceUsable;
      if (nativeSurfaceShown && !nativeDirectSurfacePath && !nativeSurfaceOwnsCurrentFrame) {
        nativeSurfaceShown = false;
        lastNativePlaybackRequestKey = "";
        setNativeSurfacePresenting(false);
        void hideNativeSurface().catch(() => undefined);
      }
      const cachedNativeFrame = nativeRequestKey !== ""
        ? nativePreviewScheduler.getCached(nativeRequestKey)
        : null;
      const nativePausedReadbackPath = nativePausedPath;
      const nativeFrameNeedsRetry = nativePausedReadbackPath && Boolean(nativeRequest) && !cachedNativeFrame &&
        nativeBlockedKey !== nativeRequestKey && performance.now() >= nativeRetryAt;
      const targetStillCurrent = () => {
        const current = renderStateRef.current;
        return isActive &&
          visibleRequestGeneration === targetGeneration &&
          current.project?.id === state.project?.id &&
          current.epoch === state.epoch &&
          current.clock.state === playbackState &&
          getFrameIndexAtTime(current.clock.time, frameRate) === frameIndex;
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
        const requestToPresent = isPlaying && nativeSurfaceUsable ? nativePlaybackRequest : nativeRequest;
        if (!requestToPresent) return;
        const requestKey = getNativeFrameRequestKey(requestToPresent);
        if (requestKey === lastNativePlaybackRequestKey) {
          return;
        }
        lastNativePlaybackRequestKey = requestKey;
        const requestStartedAt = performance.now();
        const requestSource: NativePreviewRequestSource = {
          requestKey,
          frameIndex: requestToPresent.frameTime.frameIndex,
          request: requestToPresent,
        };
        nativePlaybackInFlight = (nativeSurfaceUsable
          ? presentNativePlaybackFrame(requestToPresent).then((presentation) => {
            const elapsedMs = performance.now() - requestStartedAt;
            nativePresentationLatencyMs = nativePresentationLatencyMs > 0
              ? nativePresentationLatencyMs * 0.75 + elapsedMs * 0.25
              : elapsedMs;
            if (!presentation.presented) {
              lastNativePlaybackRequestKey = "";
              if (presentation.dropped) {
                nativeDroppedFrameCount += 1;
              }
            } else {
              const current = renderStateRef.current;
              if (
                isActive &&
                nativeSurfaceGeometrySettledRef.current &&
                current.project?.id === state.project?.id &&
                current.epoch === state.epoch &&
                current.clock.state === "playing"
              ) {
                nativeSurfaceShown = true;
                if (nativeSurfaceReadyRef.current) {
                  // The direct native surface is the exclusive owner of the base
                  // video layer for continuous playback. The native presentation
                  // sequence is authoritative for ordering in the IPC/GPU path.
                  setNativeSurfacePresenting(true);
                }
              } else if (presentation.presented) {
                // The session was paused, changed, or torn down while the IPC
                // request was in flight. Do not allow that frame to reappear.
                if (lastNativePlaybackRequestKey === requestKey) {
                  lastNativePlaybackRequestKey = "";
                  nativeSurfaceShown = false;
                  setNativeSurfacePresenting(false);
                  void hideNativeSurface().catch(() => undefined);
                }
              }
            }
          })
          : nativePreviewScheduler.requestVisible(requestSource))
          .then((frame) => {
            const current = renderStateRef.current;
            if (
              isActive &&
              visibleRequestKey === requestKey &&
              current.clock.state === "playing"
            ) {
              if (frame) nativeDisplayedFrameRef.current = frame;
              nativeContinuousFailureStreak = 0;
              forceRenderNeeded = true;
            }
          })
          .catch((error) => {
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
      }

      const session = getActiveSessionOrNull();
      const mediaReadyRevision = session?.getPreviewMediaReadyRevision() ?? 0;
      const mediaReadyChanged = mediaReadyRevision !== lastRenderedMediaReadyRevision;

      const transformController = getTransformController();
      const hasActiveTransform = transformController.getActiveTransform() !== null;

      const clipsChanged = state.clips !== lastRenderedClips;
      const tracksChanged = state.tracks !== lastRenderedTracks;
      const transitionsChanged = state.transitions !== lastRenderedTransitions;
      const projectChanged = state.project !== lastRenderedProject;

      const needsRender = isPlaying || timeChanged || epochChanged || transportChanged || isFirstFrame || forceRenderNeeded || nativeFrameNeedsRetry || hasActiveTransform || clipsChanged || tracksChanged || transitionsChanged || projectChanged ||
        (mediaReadyChanged && (!nativePausedPath || nativeBlockedKey === nativeRequestKey));

      if (needsRender) {
        lastRenderedClips = state.clips;
        lastRenderedTracks = state.tracks;
        lastRenderedTransitions = state.transitions;
        lastRenderedProject = state.project;
        if (forceRenderNeeded) forceRenderNeeded = false;
      }

      // Native Tauri preview is a hard boundary. If the retained surface is
      // temporarily unavailable, use the same native renderer's RGBA readback
      // path; never create a second renderer.
      if (needsRender && !nativeSurfaceShown && !nativeOnlySceneBlocked && !nativeDirectSurfacePath) {
        try {
          // Hold the previous native image while a new seek is decoding. It
          // is visual continuity only; `cachedNativeFrame` remains the
          // separate exact-target readiness signal below.
          let exactNativeFrame = cachedNativeFrame;
          let nativeFrame = exactNativeFrame ?? ((nativePausedPath || nativePlaybackPath) ? nativeDisplayedFrameRef.current : null);
          const requestForRender = nativeRequest;

          const canUseNativePreview =
            isTauriRuntime() &&
            requestForRender !== null &&
            !cachedNativeFrame &&
            // Paused seeks may await an exact native frame. Continuous native
            // playback is scheduled separately above and never blocks this
            // render loop; the returned frame is validated before replacing
            // the existing native readback frame.
            (!isPlaying || nativeReadbackFallbackPath) &&
            !nativeDirectSurfacePath &&
            performance.now() >= nativeRetryAt &&
            nativeBlockedKey !== nativeRequestKey;

          if (canUseNativePreview && requestForRender && !nativeDirectSurfacePath) {
            try {
              const visibleSource: NativePreviewRequestSource = {
                requestKey: nativeRequestKey,
                frameIndex,
                request: requestForRender,
              };
              const loadedFrame = await nativePreviewScheduler.requestVisible(visibleSource);
              // A seek or play action may have happened while native decode
              // was awaiting FFmpeg/GPU readback. Never commit that stale
              // response to the current program canvas.
              if (!targetStillCurrent()) {
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
              nativeRetryAt = performance.now() + 250;
              if (nativeOnlyMode) {
                setNativeOnlyBlocked(true);
                setNativeOnlyBlockers(["Native GPU frame rendering failed for the current frame.", error instanceof Error ? error.message : String(error)]);
              }
            }
          }

          // Prefetch only after the visible request is satisfied. The visible
          // frame therefore always wins the decoder/GPU budget over lookahead.
          if (nativePausedReadbackPath && exactNativeFrame && prefetchCenterKey !== nativeRequestKey) {
            const durationFrames = Math.max(0, Math.ceil(state.clock.duration * frameRate));
            const prefetchSources: NativePreviewRequestSource[] = [];
            for (const offset of [1, 2, 3, 4, 5, 6, -1, -2]) {
              const targetFrameIndex = frameIndex + offset;
              if (targetFrameIndex < 0 || (durationFrames > 0 && targetFrameIndex >= durationFrames)) continue;

              const targetTime = getFrameStartTime(targetFrameIndex / frameRate, frameRate);
              const targetScene = evaluateTimelineSceneCached(
                targetTime,
                state.clips,
                state.tracks,
                state.mediaAssets,
                state.project,
                state.epoch,
                state.transitions,
                state.sceneVersions,
              );
              const targetRequest = buildNativeFrameRequest(
                targetScene,
                `${state.project?.id ?? "unknown-project"}:${state.epoch}`,
                targetFrameIndex,
                frameRate,
                state.canvasWidth,
                state.canvasHeight,
              );
              if (!targetRequest) continue;
              prefetchSources.push({
                requestKey: getNativeFrameRequestKey(targetRequest),
                frameIndex: targetFrameIndex,
                request: targetRequest,
                priority: offset > 0 ? offset : 10 + Math.abs(offset),
              });
            }
            nativePreviewScheduler.prefetch(prefetchSources);
            prefetchCenterKey = nativeRequestKey;
          }

          if (!targetStillCurrent()) {
            forceRenderNeeded = true;
            return;
          }

          if (nativeFrame && canvasEl && !drawNativeFrameToCanvas(canvasEl, nativeFrame)) {
            throw new Error("Native preview returned a frame that could not be drawn to the preview canvas");
          }

          // Smart overlays are already rasterized into the native request. The
          // separate overlay canvas must stay clear to avoid double rendering.
          const smartCanvas = smartOverlayCanvasRefObj.current;
          smartCanvas?.getContext("2d")?.clearRect(0, 0, smartCanvas.width, smartCanvas.height);

          if (!targetStillCurrent()) {
            forceRenderNeeded = true;
            return;
          }

          // was in-flight (e.g. rapid project switch, React Strict Mode remount).
          // Without this, post-await code would write into a torn-down WebGL context.
          if (!isActive) return;

          lastRenderedFrameIndex = frameIndex;
          lastRenderedEpoch = state.epoch;
          lastRenderedTransportRevision = transportRevision;
          lastRenderedMediaReadyRevision = mediaReadyRevision;
          lastRenderedPlaybackState = playbackState;

          const nativeFrameReady = !isTauriRuntime() || nativeRequest === null ||
            exactNativeFrame !== null || isPlaying ||
            nativeSurfaceOwnsCurrentFrame;
          if (state.clock.isSeeking && nativeFrameReady) {
            state.clock.completeSeek();
          }

          // Live program preview thumbnail sync: capture frame snapshot when paused / seeking finished.
          // Audit 1.6 fix: `!playbackState` was always false because playbackState is a non-empty
          // string. Replaced with an explicit check for non-playing states.
          if (playbackState !== "playing" && nativeFrameReady && !state.clock.isSeeking) {
            if (thumbnailDebounceTimer) clearTimeout(thumbnailDebounceTimer);
            thumbnailDebounceTimer = setTimeout(() => {
              if (!isActive || !canvasEl) return;
              const thumbnailDataUrl = captureCanvasThumbnail(canvasEl, 640, 0.85);
              if (thumbnailDataUrl && thumbnailDataUrl !== useProjectStore.getState().project?.thumbnail) {
                useProjectStore.getState().updateProject({ thumbnail: thumbnailDataUrl });
              }
            }, 500);
          }
        } catch (err) {
        }
      }

      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const currentState = renderStateRef.current;
        const currentFrameIndex = getFrameIndexAtTime(currentState.clock.time, currentState.clock.frameRate);
        const errorKey = `${currentState.project?.id ?? "unknown-project"}:${currentState.epoch}:${currentFrameIndex}:${message}`;
        if (errorKey !== lastRenderLoopError) {
          lastRenderLoopError = errorKey;
        }
        forceRenderNeeded = true;
        nativeRetryAt = performance.now() + 250;
      } finally {
        renderInFlight = false;
        scheduleNextFrame();
      }
    };

    let thumbnailDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    const unsubscribeClock = clock.subscribe(() => {
      forceRenderNeeded = true;
      transportRevision += 1;
      visibleRequestGeneration += 1;
      nativePreviewScheduler.setVisibleGeneration();
      prefetchCenterKey = "";
      // An explicit seek is a new opportunity for native decode. Clear the
      // per-target circuit breaker without re-enabling retries every RAF.
      nativeBlockedKey = "";
      nativeFailureCount = 0;
      nativeRetryAt = 0;
    });

    scheduleNextFrame();
    return () => {
      isActive = false;
      unsubscribeClock();
      nativePreviewScheduler.dispose();
      nativeAnimatedStickerRenderer.dispose();
      if (thumbnailDebounceTimer) clearTimeout(thumbnailDebounceTimer);
      if (canvasEl) {
        const finalDataUrl = captureCanvasThumbnail(canvasEl, 640, 0.85);
        if (finalDataUrl && finalDataUrl !== useProjectStore.getState().project?.thumbnail) {
          useProjectStore.getState().updateProject({ thumbnail: finalDataUrl });
        }
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

  useEffect(() => {
    setActiveContext("program");
  }, [setActiveContext]);

  if (!project) return null;

  if (dimensions.width === 0 || dimensions.height === 0) {
    return (
      <div className="flex-1 bg-bg flex flex-col min-h-0 border-l border-t border-white/3">
        <div className="flex-1 flex items-center justify-center p-4 md:p-6 overflow-hidden relative bg-[#06080a]">
          <div ref={previewContainerCallback} className="w-full h-full flex items-center justify-center">
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
    <div data-preview-space="program" className="flex-1 bg-bg flex flex-col min-h-0 border-l border-t border-white/3">
      <div className="flex items-center px-4 h-10 shrink-0 gap-2 overflow-hidden">
        <span className="text-[13px] font-semibold text-text-primary tracking-tight leading-none">
          {isTauriRuntime() ? "Program Preview (Native)" : "Program Preview (Desktop required)"}
        </span>
        <span className="text-[13px] text-text-muted leading-none">
          — {isTauriRuntime() ? (nativeSurfacePresenting ? "wgpu Surface" : "Native readback") : "Open the desktop runtime"}
        </span>
        <button onClick={() => setShowSafeOverlay((s) => !s)} className={cn("ml-auto px-2 h-6 rounded text-[10px] font-medium transition-colors cursor-pointer", showSafeOverlay ? "bg-accent/20 text-accent" : "text-text-muted hover:text-text-primary hover:bg-white/6")}>
          Safe Zones
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center overflow-hidden bg-[#06080a] relative">
        <div ref={previewContainerCallback} onPointerDownCapture={handlePreviewPointerDownCapture} className={cn("w-full h-full flex items-center justify-center relative z-10 overflow-hidden", isPanning && "cursor-grabbing", spacePressed && !isPanning && "cursor-grab")}>
          <div ref={nativeSurfaceTargetRef} data-testid="program-preview-viewport" className="relative flex shrink-0 items-center justify-center overflow-visible shadow-[0_0_40px_rgba(0,0,0,0.36)]" style={{ width: displayWidth, height: displayHeight }}>
            <>
              {previewBackgroundLayer && (
                <div
                  data-testid="program-preview-background"
                  className={cn("absolute inset-0 z-0 pointer-events-none overflow-hidden", previewBackgroundLayer.className)}
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

              <TransformOverlay canvasWidth={canvasWidth} canvasHeight={canvasHeight} scale={scale} viewport={viewport} displayOffset={{ x: offsetX, y: offsetY }} displayWidth={displayWidth} displayHeight={displayHeight} currentTime={currentTime} visible={!isPlaying} />
              <SafeOverlay visible={showSafeOverlay} displayWidth={displayWidth} displayHeight={displayHeight} displayOffset={{ x: offsetX, y: offsetY}} />
              {karaokeOverlayEnabled && <KaraokeCaptions />}
            </>
          </div>
        </div>

        {isTauriRuntime() && NATIVE_PREVIEW_ONLY && nativeOnlyBlocked && (
          <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
            <div className="rounded-lg border border-accent/30 bg-black/80 px-4 py-3 text-center shadow-xl">
              <div className="text-sm font-semibold text-text-primary">Native-only proof mode</div>
              <div className="mt-1 max-w-xs text-xs text-text-muted">
                {nativeOnlyBlockers.length > 0 ? nativeOnlyBlockers.map((blocker) => (
                  <div key={blocker}>• {blocker}</div>
                )) : "This scene is waiting for a native wgpu surface or contains a graph feature not migrated yet."}
              </div>
            </div>
          </div>
        )}

        {clips.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none mx-auto" style={{ width: displayWidth, height: displayHeight }}>
            <div className="text-center space-y-3">
              <div className="text-sm font-medium text-text-muted">No clips in sequence</div>
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
          seek(time);
        }}
        formatTime={formatTime}
        onStepBack={() => {
          if (clips.length === 0) return;
          const targetTime = Math.max(0, currentTime - step);
          seek(targetTime);
        }}
        onStepForward={() => {
          if (clips.length === 0) return;
          const targetTime = Math.min(duration, currentTime + step);
          seek(targetTime);
        }}
        leftActions={
          <div className="flex items-center gap-1">
            <div className="relative" ref={speedMenuRef}>
              <PlaybackSpeedSelector playbackSpeed={playbackSpeed} speedMenuOpen={speedMenuOpen} setSpeedMenuOpen={setSpeedMenuOpen} setSpeed={setSpeed} />
            </div>
            <div className="w-px h-3 bg-white/10 mx-0.5" />
            <div className="relative" ref={qualityMenuRef}>
              <PlaybackQualitySelector previewQuality={previewQuality} qualityMenuOpen={qualityMenuOpen} setQualityMenuOpen={setQualityMenuOpen} setPreviewQuality={setPreviewQuality} />
            </div>
          </div>
        }
        rightActions={
          <>
            <div className="relative shrink-0" ref={aspectMenuRef}>
              <AspectSelector aspectMenuOpen={aspectMenuOpen} setAspectMenuOpen={setAspectMenuOpen} previewAspectPreset={previewAspectPreset} selectAspectPreset={selectAspectPreset} canvasWidth={canvasWidth} canvasHeight={canvasHeight} />
            </div>
            <button onClick={() => setPreviewScaleMode((m) => (m === "fit" ? "fill" : "fit"))} className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-white/6 transition-colors cursor-pointer">
              {previewScaleMode === "fit" ? <Expand className="w-3.5 h-3.5" /> : <Shrink className="w-3.5 h-3.5" />}
            </button>
            <div className="w-px h-4 bg-white/10 mx-1" />
            <VolumeControl isMuted={isMuted} setIsMuted={setIsMuted} volume={volume} setVolume={setVolume} />
          </>
        }
      />
    </div>
  );
};

/** @deprecated Import NativeProgramPreview. Kept temporarily for downstream integrations. */

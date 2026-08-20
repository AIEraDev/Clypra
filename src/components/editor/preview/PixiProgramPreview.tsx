import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Expand, Shrink } from "lucide-react";
import { usePlaybackClock, usePlaybackControls, useTransportControls, getPlaybackClock } from "@/hooks/usePlaybackClock";
import { useProjectStore } from "@/store/projectStore";
import { useTimelineStore } from "@/store/timelineStore";
import { useUIStore } from "@/store/uiStore";
import { useSettingsStore } from "@/store/settingsStore";
import { getActiveSessionOrNull, subscribeToSessionChanges } from "@/core/runtime/ProjectSession";
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
import { getPreviewMediaSyncClips } from "./previewMediaSync";
import { useAudioSyncEngine } from "@/hooks/useAudioSyncEngine";

import { type TelemetryStats } from "./TelemetryOverlay";
import { AspectSelector } from "./AspectSelector";
import { PlaybackSpeedSelector } from "./PlaybackSpeedSelector";
import { PlaybackQualitySelector } from "./PlaybackQualitySelector";
import { VolumeControl } from "./VolumeControl";
import { getCanvasBackgroundLayer } from "./canvasBackground";
import { captureCanvasThumbnail } from "@/lib/media/projectThumbnail";
import { getFrameIndexAtTime, getFrameStartTime } from "@/lib/utils/frameTime";
import {
  getNativePreviewSurfaceGeometry,
  hideNativeSurface,
  isTauriRuntime,
  presentNativeFrame,
  queueNativeFrame,
  registerNativeRasterAsset,
  probeNativeSurface,
  renderNativeFrame,
  resizeNativeSurface,
} from "@/lib/platform/tauri";

import { SmartOverlayRenderer } from "@/features/smart-overlays/renderer/SmartOverlayRenderer";
import type { SmartOverlayClip } from "@/types/smartOverlay";
import { KaraokeCaptions } from "@/components/captions/KaraokeCaptions";
import { useCaptionStore } from "@/store/captionStore";
import type { EvaluatedScene } from "@/core/evaluation/types";
import { makeBodyMaskCacheKey, segmentBodyMask } from "@/features/body-effects";


import { PixiSceneCompositor } from "@/core/render/pixiSceneCompositor";
import { evaluateTimelineSceneCached } from "@/core/evaluation/evaluator";
import {
  buildNativeFrameRequest,
  getNativeFrameRequestKey,
  isRenderableNativePreviewFrame,
} from "./nativeVideoPreview";
import { NativePreviewFrameScheduler, type NativePreviewRequestSource } from "./nativePreviewScheduler";
import {
  buildNativeTextRasterKey,
  rasterizeTextLayerForNative,
  type NativeTextRasterAsset,
} from "./nativeTextPreview";
import {
  NATIVE_PREVIEW_TRACE_ENABLED,
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

function traceNativePreview(event: string, details: Record<string, unknown> = {}): void {
  if (NATIVE_PREVIEW_TRACE_ENABLED) {
    console.debug(`[NativePreviewTrace] ${event}`, details);
  }
}

export const PixiProgramPreview: React.FC = () => {
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

  // High-performance Web Audio synchronization engine
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
  const [sessionReady, setSessionReady] = useState(false);
  const [compositorReady, setCompositorReady] = useState(false);
  const [nativeSurfaceReady, setNativeSurfaceReady] = useState(false);
  const [nativeSurfacePresenting, setNativeSurfacePresenting] = useState(false);
  const hasStartedPlaybackRef = useRef(false);

  const previewContainerRef = useRef<HTMLDivElement>(null);
  const nativeSurfaceTargetRef = useRef<HTMLDivElement>(null);
  const nativeSurfaceConfiguredRef = useRef(false);
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
  const compositorRef = useRef<PixiSceneCompositor | null>(null);
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
  const lastSyncedMediaHashRef = useRef<string>("");

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
  // over the displayed program viewport. It is configured only in Tauri; the
  // browser path remains entirely DOM/Pixi-owned.
  useEffect(() => {
    if (!isTauriRuntime() || !nativeSurfaceTargetRef.current || displayWidth <= 0 || displayHeight <= 0) {
      return;
    }

    let active = true;
    let syncInFlight = false;
    const syncSurface = async () => {
      if (!active || syncInFlight || !nativeSurfaceTargetRef.current) return;
      syncInFlight = true;
      try {
        const geometry = await getNativePreviewSurfaceGeometry(nativeSurfaceTargetRef.current);
        if (!active) return;
        if (nativeSurfaceConfiguredRef.current) {
          await resizeNativeSurface(geometry);
        } else {
          await probeNativeSurface(geometry);
          nativeSurfaceConfiguredRef.current = true;
        }
        if (active) setNativeSurfaceReady(true);
      } catch (error) {
        nativeSurfaceConfiguredRef.current = false;
        if (active) {
          setNativeSurfaceReady(false);
          traceNativePreview("native-surface-unavailable", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        syncInFlight = false;
      }
    };

    void syncSurface();
    const resizeObserver = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => void syncSurface())
      : null;
    resizeObserver?.observe(nativeSurfaceTargetRef.current);
    window.addEventListener("resize", syncSurface);

    return () => {
      active = false;
      resizeObserver?.disconnect();
      window.removeEventListener("resize", syncSurface);
      nativeSurfaceConfiguredRef.current = false;
      setNativeSurfaceReady(false);
      setNativeSurfacePresenting(false);
      void hideNativeSurface().catch(() => undefined);
    };
  }, [displayHeight, displayWidth]);

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
    hasStartedPlaybackRef.current = false;
    nativeDisplayedFrameRef.current = null;
  }, [project?.id]);

  useEffect(() => {
    if (clockState.state === "playing") {
      hasStartedPlaybackRef.current = true;
    }
  }, [clockState.state]);

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

  // ── Initialize PixiSceneCompositor ──────────────────────────────
  // Check session readiness and trigger compositor init
  useEffect(() => {
    const checkReadiness = () => {
      const session = getActiveSessionOrNull();
      const mediaPool = session?.getPreviewMediaPool();
      const isReady = !!(session && session.state === "active" && mediaPool);
      setSessionReady(isReady);
    };

    checkReadiness();

    const unsubscribe = subscribeToSessionChanges(() => {
      checkReadiness();
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Compositor initialization (canvas/project identity changes only)
  useEffect(() => {
    if (!canvasEl || !project || !sessionReady) return;

    // Skip if compositor already initialized
    if (compositorRef.current) return;

    let isActive = true;
    setCompositorReady(false);

    const session = getActiveSessionOrNull();
    const mediaPool = session?.getPreviewMediaPool();

    if (!mediaPool) {
      // Session/pool not ready yet - should not happen since sessionReady=true
      console.warn("[PreviewLifecycle] compositor-init: sessionReady=true but mediaPool is null");
      return;
    }

    const backingW = Math.round(displayWidth);
    const backingH = Math.round(displayHeight);

    try {
      const compositor = new PixiSceneCompositor(canvasEl, backingW, backingH, mediaPool);
      compositorRef.current = compositor;
      mediaPool.setCompositor(compositor);

      // The shared engine starts Pixi asynchronously. The render loop must not
      // compose against its intentional clear-frame state before init completes.
      void compositor.waitForReady().then(() => {
        if (isActive && compositorRef.current === compositor) {
          setCompositorReady(true);
        }
      }).catch((err) => {
        if (isActive) {
          console.error("[PixiProgramPreview] Pixi renderer failed to become ready:", err);
        }
      });
    } catch (err) {
      console.error("[PixiProgramPreview] Failed to initialize WebGL Compositor:", err);
    }

    return () => {
      isActive = false;
      setCompositorReady(false);
      mediaPool.setCompositor(null);
      if (compositorRef.current) {
        compositorRef.current.destroy();
        compositorRef.current = null;
      }
    };
  }, [canvasEl, project?.id, sessionReady]);

  // Compositor resize (dimensions change only)
  useEffect(() => {
    if (!compositorRef.current) return;

    const backingW = Math.round(displayWidth);
    const backingH = Math.round(displayHeight);

    try {
      compositorRef.current.resize(backingW, backingH);
    } catch (err) {
      console.error("[PixiProgramPreview] Failed to resize compositor:", err);
    }

  }, [displayWidth, displayHeight]);

  // ── Render loop ──────────────────────────────────────────────────
  useEffect(() => {
    if (!canvasEl || !project || !compositorReady || !compositorRef.current) return;

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
    // Tracks clip keys (id-mediaId) that have ever reported readyState > 2.
    // Resets when this effect restarts (project switch, canvas remount).
    // Used by the Bug 4 refinement to distinguish initial slow-load from mid-seek dips.
    const everReadyClipKeys = new Set<string>();
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
    // Native frame decode/presentation is asynchronous. A small measured
    // look-ahead keeps the frame that completes aligned with the audio clock
    // instead of presenting the frame that was current when decoding started.
    let nativePresentationLatencyMs = 0;
    let nativeSurfaceShown = false;
    let browserMediaPausedForNative = false;
    let lastNativePlaybackRequestKey = "";
    let nativeSurfaceFailureKey = "";
    let visibleRequestKey = "";
    let visibleRequestGeneration = 0;
    let prefetchCenterKey = "";
    let transportRevision = 0;
    let lastTraceClockState = "";
    const nativeTextRasterCache = new Map<string, Promise<NativeTextRasterAsset>>();
    const registeredNativeTextAssets = new Set<string>();
    const nativeTextAssetsById = new Map<string, NativeTextRasterAsset>();
    const nativeBodyMaskInFlight = new Map<string, Promise<NativeRasterLayerSnapshot | null>>();
    const nativeBodyMaskAssetsById = new Map<string, NativeRasterLayerSnapshot & { rgba: number[] }>();
    const registeredNativeBodyMaskAssets = new Set<string>();
    const maxNativeTextRasterCacheEntries = 96;
    const maxNativeBodyMaskCacheEntries = 90;

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
      } catch (error) {
        // Keep the full Pixi scene authoritative if the browser canvas or
        // Studio text engine cannot produce a native asset for this frame.
        traceNativePreview("native-text-raster-failed", {
          error: error instanceof Error ? error.message : String(error),
        });
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
            }).catch((error) => {
              traceNativePreview("native-body-mask-failed", {
                effectId: effect.effectId,
                error: error instanceof Error ? error.message : String(error),
              });
              return null;
            }).finally(() => {
              nativeBodyMaskInFlight.delete(assetId);
            });
            nativeBodyMaskInFlight.set(assetId, pending);
            void pending.then(() => {
              if (isActive) window.requestAnimationFrame(() => { void renderLoop(); });
            });
          }
        }
      }
      return assets;
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
      if (textAssets.length + maskAssets.length !== references.length) return false;
      await Promise.all([
        ...textAssets.map((asset) => ensureNativeTextAssetRegistered(asset, true)),
        ...maskAssets.map((asset) => ensureNativeBodyMaskAssetRegistered(asset, true)),
      ]);
      return true;
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
      const playbackStateChanged = lastRenderedPlaybackState !== playbackState;
      const isFirstFrame = lastRenderedFrameIndex === -1;

      const scene = evaluateTimelineSceneCached(frameStartTime, state.clips, state.tracks, state.mediaAssets, state.project, state.epoch, state.transitions);
      const nativeTextRasters = await rasterizeNativeTextLayers(scene);
      const nativeBodyMasks = await rasterizeNativeBodyMasks(
        scene,
        getActiveSessionOrNull()?.getPreviewVideoElements() ?? new Map(),
      );
      const nativeRasterLayers = [...nativeTextRasters, ...nativeBodyMasks];
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
            );
            const lookAheadTextRasters = await rasterizeNativeTextLayers(lookAheadScene);
            nativePlaybackRequest = buildNativeFrameRequest(
              lookAheadScene,
              `${state.project?.id ?? "unknown-project"}:${state.epoch}`,
              lookAheadFrame,
              frameRate,
              state.canvasWidth,
              state.canvasHeight,
              lookAheadTextRasters,
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
        nativeSurfaceFailureKey = "";
      }
      if (nativeRequestKey !== visibleRequestKey) {
        visibleRequestKey = nativeRequestKey;
        visibleRequestGeneration += 1;
        nativePreviewScheduler.setVisibleGeneration();
        prefetchCenterKey = "";
        traceNativePreview("target-change", {
          frameIndex,
          frameStartTime,
          playbackState,
          isSeeking: state.clock.isSeeking,
          hasNativeRequest: Boolean(nativeRequest),
          requestId: nativeRequest?.requestId ?? null,
          generation: visibleRequestGeneration,
          nativeBlocked: nativeRequestKey !== "" && nativeBlockedKey === nativeRequestKey,
        });
      }
      const targetGeneration = visibleRequestGeneration;
      // Do not hand the visible surface to native video until native audio has
      // supplied its first hardware-clock sample. Before that point the
      // browser/Pixi fallback remains synchronized to the pre-takeover clock;
      // switching surfaces early causes the exact play-toggle desync/jump.
      const nativeAudioClockReady = !isTauriRuntime() || state.clock.hasNativeClockPosition;
      const nativePlaybackPath = isTauriRuntime() && Boolean(nativePlaybackRequest) && isPlaying && nativeAudioClockReady;
      const nativePausedPath = isTauriRuntime() && Boolean(nativeRequest) && !isPlaying;
      const nativeSurfaceOwnsCurrentFrame = nativeSurfaceShown && lastNativePlaybackRequestKey === nativeRequestKey &&
        (!isPlaying || nativeAudioClockReady);
      const nativePausedSurfacePath = nativePausedPath && nativeSurfaceReady && nativeSurfaceFailureKey !== nativeRequestKey && !nativeSurfaceOwnsCurrentFrame;
      const nativeDirectSurfacePath = nativeSurfaceReady && Boolean(nativeRequest) && (
        nativePlaybackPath || nativePausedSurfacePath
      );
      if (nativeSurfaceShown && !nativeDirectSurfacePath && !nativeSurfaceOwnsCurrentFrame) {
        nativeSurfaceShown = false;
        browserMediaPausedForNative = false;
        lastNativePlaybackRequestKey = "";
        setNativeSurfacePresenting(false);
        void hideNativeSurface().catch(() => undefined);
      }
      const nativeRevision = `${state.project?.id ?? "unknown-project"}:${state.epoch}`;
      if (nativeRevision !== nativeContinuousObservedRevision) {
        nativeContinuousObservedRevision = nativeRevision;
        nativeContinuousFailureStreak = 0;
        nativeContinuousBlockedRevision = "";
      }
      const cachedNativeFrame = nativeRequestKey !== ""
        ? nativePreviewScheduler.getCached(nativeRequestKey)
        : null;
      const nativePausedReadbackPath = nativePausedPath && !nativePausedSurfacePath;
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

      const activeSetChanged = scene.metadata.activeMediaHash !== lastSyncedMediaHashRef.current;
      // Native paused preview owns decode and frame timing when the scene is
      // representable by the Rust/wgpu compositor. The hidden DOM pool is
      // synchronized only for playback or unsupported fallback compositions.
      const needsFallbackSync = nativePausedReadbackPath && !cachedNativeFrame && (isFirstFrame || nativeFrameNeedsRetry || activeSetChanged || epochChanged);
      const needsSync = isPlaying || needsFallbackSync || (!nativePausedPath && (activeSetChanged || epochChanged || isFirstFrame || playbackStateChanged || (!isPlaying && timeChanged)));

      // Continuous native presentation is intentionally non-blocking. The
      // render loop keeps the last accepted native frame while one request is
      // in flight, preventing native decode latency from stalling playback.
      if (
        nativeDirectSurfacePath &&
        (nativePlaybackRequest || nativeRequest) &&
        (isPlaying ? !cachedNativeFrame : true) &&
        nativeContinuousBlockedRevision !== nativeRevision &&
        nativeBlockedKey !== nativeRequestKey &&
        performance.now() >= nativeRetryAt &&
        !nativePlaybackInFlight
      ) {
        const requestToPresent = isPlaying ? nativePlaybackRequest : nativeRequest;
        if (!requestToPresent) {
          rafId = requestAnimationFrame(renderLoop);
          return;
        }
        const requestKey = getNativeFrameRequestKey(requestToPresent);
        if (requestKey === lastNativePlaybackRequestKey) {
          rafId = requestAnimationFrame(renderLoop);
          return;
        }
        lastNativePlaybackRequestKey = requestKey;
        const requestStartedAt = performance.now();
        const requestSource: NativePreviewRequestSource = {
          requestKey,
          frameIndex,
          request: requestToPresent,
        };
        nativePlaybackInFlight = (nativeSurfaceReady
          ? presentNativePlaybackFrame(requestToPresent).then((presentation) => {
            const elapsedMs = performance.now() - requestStartedAt;
            nativePresentationLatencyMs = nativePresentationLatencyMs > 0
              ? nativePresentationLatencyMs * 0.75 + elapsedMs * 0.25
              : elapsedMs;
            if (!presentation.presented) {
              if (!isPlaying) {
                nativeSurfaceFailureKey = nativeRequestKey;
              }
              lastNativePlaybackRequestKey = "";
              if (presentation.dropped) {
                nativeDroppedFrameCount += 1;
                traceNativePreview("native-playback-frame-dropped", {
                  frameIndex: presentation.frameIndex,
                  requestId: presentation.requestId,
                  audioPositionTicks: presentation.audioPositionTicks,
                  frameAgeTicks: presentation.frameAgeTicks,
                  droppedFrameCount: nativeDroppedFrameCount,
                });
              }
            } else if (isActive && renderStateRef.current.clock.state === playbackState) {
              nativeSurfaceShown = true;
              // The direct native surface is the exclusive owner of the base
              // video layer for playback and paused seeks. Leaving the Pixi
              // canvas visible underneath creates a second, slightly
              // different frame.
              setNativeSurfacePresenting(true);
            } else if (presentation.presented) {
              // The IPC request completed after the target changed. Do not
              // allow a stale direct frame to reappear above the current one.
              void hideNativeSurface().catch(() => undefined);
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
            if (!isPlaying) {
              nativeSurfaceFailureKey = nativeRequestKey;
            }
            nativeContinuousFailureStreak += 1;
            lastNativePlaybackRequestKey = "";
            if (nativeContinuousFailureStreak >= 3) {
              nativeContinuousBlockedRevision = nativeRevision;
            }
            nativeRetryAt = performance.now() + 250;
            if (nativeSurfaceShown) {
              nativeSurfaceShown = false;
              browserMediaPausedForNative = false;
              lastNativePlaybackRequestKey = "";
              setNativeSurfacePresenting(false);
              void hideNativeSurface().catch(() => undefined);
            }
            traceNativePreview("native-playback-frame-failed", {
              frameIndex: requestToPresent.frameTime.frameIndex,
              requestId: requestToPresent.requestId,
              error: error instanceof Error ? error.message : String(error),
              attempt: nativeContinuousFailureStreak,
              blocked: nativeContinuousBlockedRevision === nativeRevision,
            });
          })
          .finally(() => {
            nativePlaybackInFlight = null;
          });
      }

      const session = getActiveSessionOrNull();
      const mediaReadyRevision = session?.getPreviewMediaReadyRevision() ?? 0;
      const mediaReadyChanged = mediaReadyRevision !== lastRenderedMediaReadyRevision;

      if (needsSync && session && session.state === "active" && !nativeSurfaceShown) {
        try {
          session.syncPreviewMedia(getPreviewMediaSyncClips(state.clips, frameStartTime, state.transitions), state.mediaAssets, state.tracks, {
            time: frameStartTime,
            state: playbackState,
            speed: state.clock.speed,
            muted: true, // PreviewMediaPool DOM elements kept muted; AudioEngine handles all audible timeline output
            volume: 0,
            frameRate,
          });
          lastSyncedMediaHashRef.current = scene.metadata.activeMediaHash ?? "";
        } catch (error) {
          console.error(`[PixiProgramPreview] syncPreviewMedia error:`, error);
        }
      }

      // Once the native surface owns playback, stop the hidden browser video
      // elements too. Keeping them playing wastes decode time and can make
      // their readiness callbacks continuously invalidate the Pixi path.
      if (nativeSurfaceShown) {
        if (!browserMediaPausedForNative) {
          session?.pausePreviewMedia();
          browserMediaPausedForNative = true;
        }
      }

      // Bug 4 refinement: distinguish "never been ready" (initial slow-load) from
      // "temporarily not ready" (seeking after previous successful renders).
      // We only force re-renders for clips that have NEVER reported readyState > 2.
      // Clips that are merely seeking don't need forced re-renders — the compositor
      // handles absent/seeking frames gracefully. Forcing on every seek with multiple
      // stacked clips hammers composeFrame every RAF tick → GPU overload → hang.
      if (session && !nativePausedPath) {
        const videoElements = session.getPreviewVideoElements();
        const videoClips = state.clips.filter((c) => c.kind === "video");

        if (videoClips.length > 0) {
          let hasNeverReadyClip = false;
          for (const clip of videoClips) {
            const key = `${clip.id}-${clip.mediaId}`;
            const el = videoElements.get(key);
            if (el && el.readyState > 2) {
              // Clip has decoded data — record it and stop forcing re-renders for it
              everReadyClipKeys.add(key);
            } else if (!everReadyClipKeys.has(key)) {
              // Clip has never been ready — keep scheduling re-renders until it is
              hasNeverReadyClip = true;
            }
            // else: clip has been ready before but is temporarily seeking — no action
          }
          if (hasNeverReadyClip) forceRenderNeeded = true;
        }
      }

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

      if (needsRender && compositorRef.current && !nativeSurfaceShown) {
        const canvasDpr = window.devicePixelRatio || 1;
        // Bug 3 fix: read viewport transform values from renderStateRef rather than
        // from the effect's closure. This lets scale/offsetX/offsetY/canvasWidth/
        // canvasHeight change freely (pan, zoom, canvas resize) without causing the
        // render loop effect to tear down and restart.
        const viewportParams = {
          scale: state.scale,
          offsetX: state.offsetX,
          offsetY: state.offsetY,
          pixelRatio: canvasDpr,
          projectWidth: state.canvasWidth,
          projectHeight: state.canvasHeight,
        };

        const activeVideoElements = session?.getPreviewVideoElements() ?? new Map();
        const preferPosterFrame = !isPlaying && !hasStartedPlaybackRef.current && frameIndex === 0;

        try {
          // Hold the previous native image while a new seek is decoding. It
          // is visual continuity only; `cachedNativeFrame` remains the
          // separate exact-target readiness signal below.
          let exactNativeFrame = cachedNativeFrame;
          let nativeFrame = exactNativeFrame ?? ((nativePausedPath || nativePlaybackPath) ? nativeDisplayedFrameRef.current : null);
          const requestForRender = nativeRequest;

          // The native full-resolution poster is an enhancement, not the
          // first paint. Native FFmpeg/wgpu startup can take long enough that
          // waiting here leaves Pixi showing its clear frame. Compose the
          // existing poster immediately, then replace it below if the native
          // readback succeeds.
          if (preferPosterFrame) {
            await compositorRef.current.composeFrame(
              scene,
              viewportParams,
              activeVideoElements,
              undefined,
              new Map(),
              null,
              preferPosterFrame,
            );
          }

          const canUseNativePreview =
            isTauriRuntime() &&
            requestForRender !== null &&
            !cachedNativeFrame &&
            // Paused seeks may await an exact native frame. Continuous native
            // playback is scheduled separately above and never blocks this
            // render loop; the returned frame is validated before replacing
            // the existing Pixi/browser fallback.
            !isPlaying &&
            !nativeDirectSurfacePath &&
            performance.now() >= nativeRetryAt &&
            nativeBlockedKey !== nativeRequestKey;

          if (canUseNativePreview && requestForRender && !nativeDirectSurfacePath) {
            const requestStartedAt = performance.now();
            traceNativePreview("native-request-start", {
              frameIndex,
              requestId: requestForRender.requestId,
              requestKey: nativeRequestKey,
              generation: targetGeneration,
              cached: Boolean(cachedNativeFrame),
            });
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
                traceNativePreview("native-response-stale", {
                  frameIndex,
                  requestId: requestForRender.requestId,
                  elapsedMs: Math.round(performance.now() - requestStartedAt),
                  currentFrameIndex: getFrameIndexAtTime(renderStateRef.current.clock.time, frameRate),
                  currentState: renderStateRef.current.clock.state,
                  generation: targetGeneration,
                  currentGeneration: visibleRequestGeneration,
                });
                forceRenderNeeded = true;
                rafId = requestAnimationFrame(renderLoop);
                return;
              }
              exactNativeFrame = loadedFrame;
              nativeFrame = loadedFrame;
              nativeDisplayedFrameRef.current = loadedFrame;
              nativeRetryAt = 0;
              traceNativePreview("native-response-accepted", {
                frameIndex,
                requestId: requestForRender.requestId,
                elapsedMs: Math.round(performance.now() - requestStartedAt),
                bytes: loadedFrame.rgba.byteLength,
              });
            } catch (error) {
              // Keep the fallback visible for this render boundary, then
              // retry this exact request. One failed readback must not
              // permanently disable paused seeking.
              // Do not pass the previous native frame to Pixi here: that
              // would make a failed seek look successful but visually frozen.
              nativeFrame = null;
              if (nativeFailureKey !== nativeRequestKey) {
                nativeFailureKey = nativeRequestKey;
                nativeFailureCount = 0;
              }
              nativeFailureCount += 1;
              if (nativeFailureCount >= 3) {
                // Repeated invalid payloads are a native-renderer failure, not
                // a reason to hammer FFmpeg/wgpu every RAF. Fall back until the
                // user changes the target or explicitly seeks again.
                nativeBlockedKey = nativeRequestKey;
              }
              nativeRetryAt = performance.now() + 250;
              traceNativePreview("native-request-failed", {
                frameIndex,
                requestId: requestForRender.requestId,
                elapsedMs: Math.round(performance.now() - requestStartedAt),
                error: error instanceof Error ? error.message : String(error),
                retryInMs: 250,
                attempt: nativeFailureCount,
                blocked: nativeBlockedKey === nativeRequestKey,
              });
              console.warn("[PixiProgramPreview] Native video preview unavailable; using Pixi fallback:", error);
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
            rafId = requestAnimationFrame(renderLoop);
            return;
          }

          await compositorRef.current.composeFrame(
            scene,
            viewportParams,
            activeVideoElements,
            undefined, // resourceHandleMap (can be left undefined during preview)
            new Map(), // bodyMasks map
            nativeFrame,
            preferPosterFrame,
          );

          // Render active smart-overlay clips if any
          const currentTime = frameStartTime;
          const activeSmartClips = state.clips.filter(
            (c): c is SmartOverlayClip =>
              c.kind === "smart-overlay" &&
              currentTime >= c.startTime &&
              currentTime <= c.startTime + c.duration
          );

          const smartCanvas = smartOverlayCanvasRefObj.current;
          if (smartCanvas) {
            const ctx2d = smartCanvas.getContext("2d");
            if (ctx2d) {
              ctx2d.clearRect(0, 0, smartCanvas.width, smartCanvas.height);
              for (const smartClip of activeSmartClips) {
                const renderer = new SmartOverlayRenderer(smartClip);
                const relTime = currentTime - smartClip.startTime;
                renderer.draw(ctx2d, relTime, smartCanvas.width, smartCanvas.height);
              }
            }
          }

          if (!targetStillCurrent()) {
            forceRenderNeeded = true;
            rafId = requestAnimationFrame(renderLoop);
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
          if (state.clock.isSeeking || transportChanged) {
            traceNativePreview("compose-commit", {
              frameIndex,
              frameStartTime,
              playbackState,
              isSeeking: state.clock.isSeeking,
              nativeRequestId: nativeRequest?.requestId ?? null,
              hasExactNativeFrame: Boolean(exactNativeFrame),
              hasDisplayedNativeFrame: Boolean(nativeDisplayedFrameRef.current),
              nativeFrameReady,
              transportRevision,
            });
          }
          if (state.clock.isSeeking && nativeFrameReady) {
            traceNativePreview("seek-complete", { frameIndex, frameStartTime });
            state.clock.completeSeek();
          }

          // Live program preview thumbnail sync: capture frame snapshot when paused / seeking finished
          if (!playbackState && nativeFrameReady && !state.clock.isSeeking) {
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
          console.error("[PixiProgramPreview] composeFrame error:", err);
        }
      }

      rafId = requestAnimationFrame(renderLoop);
      } finally {
        renderInFlight = false;
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
      const clockState = clock.getState();
      if (clock.isSeeking || clockState.state !== lastTraceClockState) {
        traceNativePreview("clock-event", {
          time: clockState.time,
          frameIndex: getFrameIndexAtTime(clockState.time, clockState.frameRate),
          state: clockState.state,
          isSeeking: clock.isSeeking,
          transportRevision,
        });
      }
      lastTraceClockState = clockState.state;
    });

    rafId = requestAnimationFrame(renderLoop);
    return () => {
      isActive = false;
      unsubscribeClock();
      nativePreviewScheduler.dispose();
      if (thumbnailDebounceTimer) clearTimeout(thumbnailDebounceTimer);
      if (canvasEl) {
        const finalDataUrl = captureCanvasThumbnail(canvasEl, 640, 0.85);
        if (finalDataUrl && finalDataUrl !== useProjectStore.getState().project?.thumbnail) {
          useProjectStore.getState().updateProject({ thumbnail: finalDataUrl });
        }
      }
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
    // Bug 3 fix: viewport values (scale, offsetX, offsetY, canvasWidth, canvasHeight) are
    // now read from renderStateRef inside the loop, so they are NOT listed as deps here.
    // Bug 6 fix: project?.id instead of full project object (updateProject always creates
    // a new reference, so `project` as a dep would restart the loop on every store write).
    // sessionReady is required: the loop's early-return guard checks compositorRef.current,
    // which is only set by the compositor-init effect (which also deps on sessionReady).
    // Without sessionReady here the loop would return early on first run (no compositor yet)
    // and never re-trigger after the compositor is created. React runs effects in source
    // order so the compositor-init effect always fires before this one on the same dep change.
  }, [canvasEl, project?.id, sessionReady, compositorReady, nativeSurfaceReady]);

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
    <div className="flex-1 bg-bg flex flex-col min-h-0 border-l border-t border-white/3">
      <div className="flex items-center px-4 h-10 shrink-0 gap-2">
        <span className="text-[13px] font-semibold text-text-primary tracking-tight">
          {isTauriRuntime() ? "Program Preview (Native)" : "Program Preview (PixiJS)"}
        </span>
        <span className="text-[13px] text-text-muted">
          — {isTauriRuntime() ? (nativeSurfacePresenting ? "wgpu Surface" : "Native-first / fallback") : "WebGL Pipeline"}
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
                }}
              />

              <TransformOverlay canvasWidth={canvasWidth} canvasHeight={canvasHeight} scale={scale} viewport={viewport} displayOffset={{ x: offsetX, y: offsetY }} displayWidth={displayWidth} displayHeight={displayHeight} currentTime={currentTime} visible={!isPlaying} />
              <SafeOverlay visible={showSafeOverlay} displayWidth={displayWidth} displayHeight={displayHeight} displayOffset={{ x: offsetX, y: offsetY}} />
              {karaokeOverlayEnabled && <KaraokeCaptions />}
            </>
          </div>
        </div>

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
          traceNativePreview("seek-intent", {
            requestedTime: time,
            currentTime: clock.time,
            currentFrameIndex: getFrameIndexAtTime(clock.time, frameRate),
            frameRate,
          });
          seek(time);
        }}
        formatTime={formatTime}
        onStepBack={() => {
          if (clips.length === 0) return;
          const targetTime = Math.max(0, currentTime - step);
          traceNativePreview("step-intent", { direction: "back", targetTime, currentTime, frameRate });
          seek(targetTime);
        }}
        onStepForward={() => {
          if (clips.length === 0) return;
          const targetTime = Math.min(duration, currentTime + step);
          traceNativePreview("step-intent", { direction: "forward", targetTime, currentTime, frameRate });
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

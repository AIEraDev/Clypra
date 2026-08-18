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
import { isTauriRuntime, renderNativePreviewFrame, renderNativeVideoProjectFrame } from "@/lib/platform/tauri";

import { SmartOverlayRenderer } from "@/features/smart-overlays/renderer/SmartOverlayRenderer";
import type { SmartOverlayClip } from "@/types/smartOverlay";
import { KaraokeCaptions } from "@/components/captions/KaraokeCaptions";
import { useCaptionStore } from "@/store/captionStore";


import { PixiSceneCompositor } from "@/core/render/pixiSceneCompositor";
import { evaluateTimelineSceneCached } from "@/core/evaluation/evaluator";
import { buildNativeVideoProjectRequest, isRenderableNativePreviewFrame } from "./nativeVideoPreview";


const CANVAS_DIMENSIONS: Record<Exclude<AspectRatio, "original">, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "21:9": { width: 2520, height: 1080 },
  "4:3": { width: 1440, height: 1080 },
};

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
  useAudioSyncEngine({ volume, muted: isMuted });
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

  const previewContainerRef = useRef<HTMLDivElement>(null);
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
    let forceRenderNeeded = false;
    let lastRenderedFrameIndex = -1;
    let lastRenderedEpoch = -1;
    let lastRenderedPlaybackState: "playing" | "paused" | "stopped" = "stopped";
    let lastRenderedClips = renderStateRef.current.clips;
    let lastRenderedTracks = renderStateRef.current.tracks;
    let lastRenderedTransitions = renderStateRef.current.transitions;
    let lastRenderedProject = renderStateRef.current.project;
    // Tracks clip keys (id-mediaId) that have ever reported readyState > 2.
    // Resets when this effect restarts (project switch, canvas remount).
    // Used by the Bug 4 refinement to distinguish initial slow-load from mid-seek dips.
    const everReadyClipKeys = new Set<string>();
    let nativePreviewDisabled = false;

    const renderLoop = async () => {
      if (!isActive) return;

      const state = renderStateRef.current;
      const timeToRender = state.clock.time;
      const playbackState = state.clock.state;
      const isPlaying = playbackState === "playing";

      const frameRate = state.project?.frameRate ?? 30;
      const frameIndex = getFrameIndexAtTime(timeToRender, frameRate);
      const frameStartTime = getFrameStartTime(timeToRender, frameRate);

      const timeChanged = frameIndex !== lastRenderedFrameIndex;
      const epochChanged = state.epoch !== lastRenderedEpoch;
      const playbackStateChanged = lastRenderedPlaybackState !== playbackState;
      const isFirstFrame = lastRenderedFrameIndex === -1;

      const scene = evaluateTimelineSceneCached(frameStartTime, state.clips, state.tracks, state.mediaAssets, state.project, state.epoch, state.transitions);

      const activeSetChanged = scene.metadata.activeMediaHash !== lastSyncedMediaHashRef.current;
      const needsSync = activeSetChanged || epochChanged || isFirstFrame || playbackStateChanged || (!isPlaying && timeChanged) || isPlaying;

      const session = getActiveSessionOrNull();

      if (needsSync && session && session.state === "active") {
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

      // Bug 4 refinement: distinguish "never been ready" (initial slow-load) from
      // "temporarily not ready" (seeking after previous successful renders).
      // We only force re-renders for clips that have NEVER reported readyState > 2.
      // Clips that are merely seeking don't need forced re-renders — the compositor
      // handles absent/seeking frames gracefully. Forcing on every seek with multiple
      // stacked clips hammers composeFrame every RAF tick → GPU overload → hang.
      if (session) {
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

      const needsRender = isPlaying || timeChanged || epochChanged || isFirstFrame || forceRenderNeeded || hasActiveTransform || clipsChanged || tracksChanged || transitionsChanged || projectChanged;

      if (needsRender) {
        lastRenderedClips = state.clips;
        lastRenderedTracks = state.tracks;
        lastRenderedTransitions = state.transitions;
        lastRenderedProject = state.project;
        if (forceRenderNeeded) forceRenderNeeded = false;
      }

      if (needsRender && compositorRef.current) {
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
        const hasReadyHtmlVideo = scene.visualLayers.some((layer) => {
          if (layer.layerType !== "media" || layer.mediaType !== "video") return false;
          const element = activeVideoElements.get(`${layer.clipId}-${layer.mediaId}`);
          return Boolean(element && element.readyState >= 2 && element.videoWidth > 0 && element.videoHeight > 0);
        });

        try {
          let nativeFrame: { rgba: ArrayBuffer; width: number; height: number } | null = null;
          const nativeRequest = buildNativeVideoProjectRequest(scene);
          const canUseNativePreview =
            isTauriRuntime() &&
            nativeRequest !== null &&
            !nativePreviewDisabled &&
            // Native IPC/readback is deterministic for paused editing frames.
            // Never put an IPC decode/readback in the playback RAF path: the
            // HTML video element is the smooth playback source.
            !isPlaying &&
            // Do not let a native clear/partial frame replace the poster while
            // the WebView decoder is still loading the first visible frame.
            hasReadyHtmlVideo;

          if (canUseNativePreview && nativeRequest) {
            try {
              const [layer] = nativeRequest.layers;
              const isDirectFullCanvasVideo =
                nativeRequest.layers.length === 1 &&
                layer &&
                Math.abs(layer.x) < 0.5 &&
                Math.abs(layer.y) < 0.5 &&
                Math.abs(layer.width - nativeRequest.canvasWidth) < 0.5 &&
                Math.abs(layer.height - nativeRequest.canvasHeight) < 0.5 &&
                Math.abs(layer.rotation ?? 0) < 0.001 &&
                Math.abs((layer.opacity ?? 1) - 1) < 0.001 &&
                (layer.blendMode ?? "normal") === "normal";
              const rgba = isDirectFullCanvasVideo
                ? await renderNativePreviewFrame(layer.videoPath, layer.timeSecs, nativeRequest.canvasWidth, nativeRequest.canvasHeight)
                : await renderNativeVideoProjectFrame(nativeRequest);
              if (!isRenderableNativePreviewFrame(rgba, nativeRequest.canvasWidth, nativeRequest.canvasHeight)) {
                throw new Error("Native preview returned an empty or opaque-black frame");
              }
              nativeFrame = {
                rgba,
                width: nativeRequest.canvasWidth,
                height: nativeRequest.canvasHeight,
              };
              nativePreviewDisabled = false;
            } catch (error) {
              // Do not retry a failed native request on every media epoch. Seek and
              // loadeddata events advance the epoch, which otherwise creates a
              // tight native-decode failure loop and prevents the Pixi fallback
              // from getting a chance to present the HTML video frame.
              nativePreviewDisabled = true;
              console.warn("[PixiProgramPreview] Native video preview unavailable; using Pixi fallback:", error);
            }
          }

          await compositorRef.current.composeFrame(
            scene,
            viewportParams,
            activeVideoElements,
            undefined, // resourceHandleMap (can be left undefined during preview)
            new Map(), // bodyMasks map
            nativeFrame,
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

          // was in-flight (e.g. rapid project switch, React Strict Mode remount).
          // Without this, post-await code would write into a torn-down WebGL context.
          if (!isActive) return;

          lastRenderedFrameIndex = frameIndex;
          lastRenderedEpoch = state.epoch;
          lastRenderedPlaybackState = playbackState;

          if (state.clock.isSeeking) {
            state.clock.completeSeek();
          }

          // Live program preview thumbnail sync: capture frame snapshot when paused / seeking finished
          if (!playbackState) {
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
    };

    let thumbnailDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    const unsubscribeClock = clock.subscribe(() => {
      forceRenderNeeded = true;
    });

    rafId = requestAnimationFrame(renderLoop);
    return () => {
      isActive = false;
      unsubscribeClock();
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
  }, [canvasEl, project?.id, sessionReady, compositorReady]);

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
        <span className="text-[13px] font-semibold text-text-primary tracking-tight">Program Preview (PixiJS)</span>
        <span className="text-[13px] text-text-muted">— WebGL Pipeline</span>
        <button onClick={() => setShowSafeOverlay((s) => !s)} className={cn("ml-auto px-2 h-6 rounded text-[10px] font-medium transition-colors cursor-pointer", showSafeOverlay ? "bg-accent/20 text-accent" : "text-text-muted hover:text-text-primary hover:bg-white/6")}>
          Safe Zones
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center overflow-hidden bg-[#06080a] relative">
        <div ref={previewContainerCallback} onPointerDownCapture={handlePreviewPointerDownCapture} className={cn("w-full h-full flex items-center justify-center relative z-10 overflow-hidden", isPanning && "cursor-grabbing", spacePressed && !isPanning && "cursor-grab")}>
          <div data-testid="program-preview-viewport" className="relative flex shrink-0 items-center justify-center overflow-visible shadow-[0_0_40px_rgba(0,0,0,0.36)]" style={{ width: displayWidth, height: displayHeight }}>
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
          seek(time);
        }}
        formatTime={formatTime}
        onStepBack={() => {
          if (clips.length === 0) return;
          seek(Math.max(0, currentTime - step));
        }}
        onStepForward={() => {
          if (clips.length === 0) return;
          seek(Math.min(duration, currentTime + step));
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

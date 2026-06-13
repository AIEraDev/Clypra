import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Expand, Shrink } from "lucide-react";
import { usePlaybackClock, usePlaybackControls, useTransportControls, getPlaybackClock } from "@/hooks/usePlaybackClock";
import { useProjectStore } from "@/store/projectStore";
import { useTimelineStore } from "@/store/timelineStore";
import { useUIStore } from "@/store/uiStore";
import { useSettingsStore } from "@/store/settingsStore";
import { getFrameScheduler } from "@/core/scheduler/FrameScheduler";
import { getActiveSessionOrNull, subscribeToSessionChanges } from "@/core/runtime/ProjectSession";
import { useViewportState } from "@/hooks/useViewportController";
import { PreviewTransport } from "./PreviewTransport";
import { TransformOverlayMemoized as TransformOverlay } from "../transform/TransformOverlay";
import { SafeOverlay } from "../viewport/SafeOverlay";
import { useViewportKeyboardShortcuts, useViewportWheelZoom, useViewportPan } from "../viewport/ViewportControls";
import { calculateDisplayTransform } from "@/lib/utils/coordinateSystem";
import { GPUTextureCache } from "@/lib/cache/gpuTextureCache";
import { PreviewQualityManager, PreviewQualityTier } from "@/lib/preview/PreviewQualityManager";
import { cn } from "@/lib/utils";
import { AspectRatio, FilterClip } from "@/types";
import { formatTime } from "@/lib/utils/timeFormatting";
import { refitClipsForCanvasChange } from "@/lib/timeline/refitClips";
import { normalizeFilterIntensity, resolveFilterToIR } from "../../../core/render/filterIR";

import { TelemetryOverlay, type TelemetryStats } from "./TelemetryOverlay";
import { AspectSelector } from "./AspectSelector";
import { PlaybackSpeedSelector } from "./PlaybackSpeedSelector";
import { PlaybackQualitySelector } from "./PlaybackQualitySelector";
import { VolumeControl } from "./VolumeControl";

// Canvas dimensions for each preset (based on common resolutions)
const CANVAS_DIMENSIONS: Record<Exclude<AspectRatio, "original">, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
};

export const ProgramPreview: React.FC = () => {
  // =========================================================================
  // 1. SELECTORS & STATE SUBSCRIPTIONS (Strictly first)
  // =========================================================================
  const project = useProjectStore((s) => s.project);
  const updateProject = useProjectStore((s) => s.updateProject);
  const mediaAssets = useProjectStore((s) => s.mediaAssets);
  const tracks = useTimelineStore((s) => s.tracks);
  const clips = useTimelineStore((s) => s.clips);
  const transitions = useTimelineStore((s) => s.transitions);
  const epoch = useTimelineStore((s) => s.epoch);
  const clearSelection = useUIStore((s) => s.clearSelection);

  // Get viewport state from controller (throttled to 10fps to prevent render storms)
  const viewport = useViewportState();

  const activeSession = useSyncExternalStore(subscribeToSessionChanges, getActiveSessionOrNull, () => null);

  const previewQuality = useSettingsStore((s) => s.previewQuality);
  const setPreviewQuality = useSettingsStore((s) => s.setPreviewQuality);

  // =========================================================================
  // 2. CORE REACT & PLAYBACK HOOKS
  // =========================================================================
  const clockState = usePlaybackClock();
  const clock = getPlaybackClock();
  const { seek, setSpeed, setDuration, setFrameRate } = usePlaybackControls();
  const { play: transportPlay, pause: transportPause, setActiveContext } = useTransportControls();

  // =========================================================================
  // 3. STATE DECLARATIONS (useState)
  // =========================================================================
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(100);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [previewScaleMode, setPreviewScaleMode] = useState<"fit" | "fill">("fit");
  const [previewAspectPreset, setPreviewAspectPreset] = useState<AspectRatio>("original");
  const [aspectMenuOpen, setAspectMenuOpen] = useState(false);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [showTelemetry, setShowTelemetry] = useState(false);
  const [useCanvasPreview] = useState(true);
  const [showSafeOverlay, setShowSafeOverlay] = useState(false);
  const [telemetryStats, setTelemetryStats] = useState<TelemetryStats | null>(null);

  // Track render count for debugging (after state declarations)
  const renderCountRef = useRef(0);
  const prevDepsRef = useRef<any>({});
  renderCountRef.current++;

  const currentDeps = {
    projectId: project?.id,
    mediaAssetsLength: mediaAssets.length,
    tracksLength: tracks.length,
    clipsLength: clips.length,
    transitionsLength: transitions.length,
    epoch,
    previewViewportPanX: viewport.panX,
    previewViewportPanY: viewport.panY,
    previewViewportZoom: viewport.zoom,
    clockTime: clockState.time,
    clockState: clockState.state,
    clockSpeed: clockState.speed,
    dimensionsWidth: dimensions.width,
    dimensionsHeight: dimensions.height,
  };

  if (renderCountRef.current > 1) {
    const changes: string[] = [];
    const prev = prevDepsRef.current;
    Object.keys(currentDeps).forEach((key) => {
      const prevVal = prev[key];
      const currVal = (currentDeps as any)[key];
      if (prevVal !== currVal) {
        changes.push(`${key} (${JSON.stringify(prevVal)} → ${JSON.stringify(currVal)})`);
      }
    });
    console.log(`[ProgramPreview] Render #${renderCountRef.current} - Changed: ${changes.length > 0 ? changes.join(", ") : "unknown (no deps changed - likely setState or parent re-render)"}`);
  } else {
    console.log(`[ProgramPreview] Render #${renderCountRef.current} - Initial mount`);
  }
  prevDepsRef.current = currentDeps;

  // =========================================================================
  // 4. REF DECLARATIONS (useRef)
  // =========================================================================
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const canvasRef = useCallback((node: HTMLCanvasElement | null) => {
    setCanvasEl(node);
  }, []);
  const aspectMenuRef = useRef<HTMLDivElement>(null);
  const speedMenuRef = useRef<HTMLDivElement>(null);
  const qualityMenuRef = useRef<HTMLDivElement>(null);
  const gpuCacheRef = useRef<GPUTextureCache | null>(null);
  const gpuFallbackRef = useRef(false);
  const qualityManagerRef = useRef<PreviewQualityManager | null>(null);
  const qualityManagerSigRef = useRef<string>("");
  const telemetryRef = useRef(telemetryStats);
  const lastTelemetryFlushRef = useRef(0);
  const showTelemetryRef = useRef(showTelemetry);
  const droppedFramesRef = useRef(0);
  const maxDriftRef = useRef(0);
  const originalCanvasDimsRef = useRef<{ width: number; height: number } | null>(null);
  const prevDurationRef = useRef<number>(0);
  const prevFrameRateRef = useRef<number>(0);

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
    dpr: window.devicePixelRatio || 1,
    previewQuality,
  });

  // Sync refs on every render
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

  // =========================================================================
  // 5. VIEWPORT CONTROL HOOKS & DERIVATIONS
  // =========================================================================
  const canvasWidth = project?.canvasWidth ?? 1920;
  const canvasHeight = project?.canvasHeight ?? 1080;

  useViewportKeyboardShortcuts(canvasWidth, canvasHeight, dimensions.width, dimensions.height);
  useViewportWheelZoom(containerRef as React.RefObject<HTMLElement>);
  const { isPanning, spacePressed } = useViewportPan(containerRef as React.RefObject<HTMLElement>);

  // =========================================================================
  // 6. DERIVED MEMOIZED VALUES (useMemo)
  // =========================================================================
  const displayTransform = useMemo(() => {
    return calculateDisplayTransform({ width: canvasWidth, height: canvasHeight }, viewport, dimensions.width, dimensions.height, previewScaleMode);
  }, [canvasWidth, canvasHeight, viewport.panX, viewport.panY, viewport.zoom, dimensions.width, dimensions.height, previewScaleMode]);

  const { scale, offsetX, offsetY, displayWidth, displayHeight } = displayTransform;

  // Sync derived display width/height to the render state ref
  renderStateRef.current.displayWidth = displayWidth;
  renderStateRef.current.displayHeight = displayHeight;
  renderStateRef.current.canvasWidth = canvasWidth;
  renderStateRef.current.canvasHeight = canvasHeight;

  // =========================================================================
  // 7. EVENT HANDLERS & CALLBACKS (useCallback)
  // =========================================================================
  const handlePreviewPointerDownCapture = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
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

  // =========================================================================
  // 8. SIDE EFFECTS (useEffect & useLayoutEffect)
  // =========================================================================

  useEffect(() => {
    if (project && !originalCanvasDimsRef.current) {
      originalCanvasDimsRef.current = {
        width: project.canvasWidth,
        height: project.canvasHeight,
      };
    }
  }, [project?.id]);

  // Keep "original" dims in sync when changed via SettingsModal
  // (but NOT when changed via AspectSelector presets like 16:9, 9:16, etc.)
  useEffect(() => {
    if (!project || !originalCanvasDimsRef.current) return;
    // Only update if the current preset IS "original" — meaning the user
    // changed dimensions from SettingsModal while on the original preset
    if (project.aspectRatio === "original") {
      originalCanvasDimsRef.current = {
        width: project.canvasWidth,
        height: project.canvasHeight,
      };
    }
  }, [project?.canvasWidth, project?.canvasHeight, project?.aspectRatio]);

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
    const newDuration = Math.max(maxEndTime, 10);
    const newFrameRate = project.frameRate || 30;
    if (newDuration !== prevDurationRef.current) {
      setDuration(newDuration);
      prevDurationRef.current = newDuration;
    }
    if (newFrameRate !== prevFrameRateRef.current) {
      setFrameRate(newFrameRate);
      prevFrameRateRef.current = newFrameRate;
    }
  }, [project, clips, setDuration, setFrameRate]);

  useEffect(() => {
    if (!aspectMenuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (aspectMenuRef.current && !aspectMenuRef.current.contains(e.target as Node)) {
        setAspectMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [aspectMenuOpen]);

  useEffect(() => {
    if (!speedMenuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (speedMenuRef.current && !speedMenuRef.current.contains(e.target as Node)) {
        setSpeedMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [speedMenuOpen]);

  useEffect(() => {
    if (!qualityMenuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (qualityMenuRef.current && !qualityMenuRef.current.contains(e.target as Node)) {
        setQualityMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [qualityMenuOpen]);

  useEffect(() => {
    const updateDimensions = () => {
      if (!containerRef.current) return;
      const newWidth = containerRef.current.clientWidth;
      const newHeight = containerRef.current.clientHeight;

      // Only update if dimensions actually changed (avoid unnecessary re-renders)
      setDimensions((prev) => {
        if (prev.width === newWidth && prev.height === newHeight) {
          return prev; // Return same reference to prevent re-render
        }
        return { width: newWidth, height: newHeight };
      });
    };
    const resizeObserver = new ResizeObserver(updateDimensions);
    const handleFullscreenChange = () => {
      setTimeout(updateDimensions, 100);
      setTimeout(updateDimensions, 300);
    };
    if (containerRef.current) resizeObserver.observe(containerRef.current);
    window.addEventListener("resize", updateDimensions);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateDimensions);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
    };
  }, []);

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
  }, [project, canvasWidth, canvasHeight, displayWidth, displayHeight]);

  useEffect(() => {
    if (!useCanvasPreview || !canvasEl || gpuFallbackRef.current) return;
    if (gpuCacheRef.current) return;
    try {
      gpuCacheRef.current = new GPUTextureCache(canvasEl);
    } catch {
      gpuFallbackRef.current = true;
    }
  }, [useCanvasPreview, canvasEl]);

  useEffect(() => {
    return () => {
      if (gpuCacheRef.current) {
        gpuCacheRef.current.dispose();
        gpuCacheRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!useCanvasPreview || !canvasEl || !project) return;
    const canvas = canvasEl;
    if (displayWidth === 0 || displayHeight === 0) return;
    const canvasDpr = window.devicePixelRatio || 1;
    const backingW = Math.round(displayWidth * canvasDpr);
    const backingH = Math.round(displayHeight * canvasDpr);
    if (canvas.width !== backingW || canvas.height !== backingH) {
      canvas.width = backingW;
      canvas.height = backingH;
    }
    const gpuCache = gpuCacheRef.current;
    let ctx2d: CanvasRenderingContext2D | null = null;
    if (!gpuCache) {
      ctx2d = canvas.getContext("2d");
      if (ctx2d) {
        ctx2d.setTransform(canvasDpr, 0, 0, canvasDpr, 0, 0);
        ctx2d.clearRect(0, 0, displayWidth, displayHeight);
      }
    }
    const scheduler = getFrameScheduler();
    let rafId: number | null = null;
    let isActive = true;
    let isRendering = false;
    let lastJobId: string | null = null;
    let lastRenderedTime: number = -1;
    let lastRenderedEpoch: number = -1;
    const GPU_MEMORY_LIMIT_MB = 128;
    const renderLoop = () => {
      if (!isActive) return;

      const state = renderStateRef.current;
      const timeToRender = state.clock.time;
      const isPlaying = state.clockState.state === "playing";
      const timeChanged = timeToRender !== lastRenderedTime;
      const epochChanged = state.epoch !== lastRenderedEpoch;
      const needsRender = isPlaying || timeChanged || epochChanged;

      // Get the active track-level filter at the rendering time
      const getActiveFilterIR = (time: number) => {
        const filterTracks = state.tracks.filter((t: any) => t.type === "filter" && (t.visible ?? true));
        const filterTrackIds = new Set(filterTracks.map((t: any) => t.id));
        const activeFilterClips = state.clips
          .filter(
            (c: any) =>
              c.kind === "filter" &&
              filterTrackIds.has(c.trackId) &&
              c.startTime <= time &&
              time < c.startTime + c.duration
          )
          .sort((a: any, b: any) => {
            const trackA = state.tracks.findIndex((t: any) => t.id === a.trackId);
            const trackB = state.tracks.findIndex((t: any) => t.id === b.trackId);
            return trackA - trackB;
          });

        const activeClip = activeFilterClips[0] as FilterClip | undefined;
        if (activeClip && activeClip.kind === "filter") {
          return resolveFilterToIR(activeClip.mediaId, normalizeFilterIntensity(activeClip.intensity));
        }
        return undefined;
      };

      // Only render if something changed or we're playing
      // This prevents infinite RAF loops when idle
      if (!needsRender) {
        rafId = requestAnimationFrame(renderLoop);
        return;
      }

      rafId = requestAnimationFrame(renderLoop);
      if (isRendering) {
        droppedFramesRef.current++;
        return;
      }
      isRendering = true;
      lastRenderedTime = timeToRender;
      lastRenderedEpoch = state.epoch;
      scheduler.updateTimeline(state.clips, state.tracks, state.mediaAssets, state.project, state.epoch, state.transitions);
      const qm = qualityManagerRef.current;
      const qualityTier = qm ? qm.selectTierForInteraction(isPlaying, false, false, state.previewQuality) : PreviewQualityTier.Idle;
      const profile = qm ? qm.getRenderProfile(qualityTier) : { maxWidth: state.canvasWidth, maxHeight: state.canvasHeight, dprScale: state.dpr, useDpr: true };
      if (gpuCache) {
        const renderW = profile.maxWidth;
        const renderH = profile.maxHeight;
        const cacheKey = `preview:${state.project?.id}:${state.epoch}:${timeToRender.toFixed(3)}:${renderW}x${renderH}:${state.dpr}`;
        if (gpuCache.hasTexture(cacheKey)) {
          gpuCache.clear();
          const filterIR = getActiveFilterIR(timeToRender);
          gpuCache.renderTexture(cacheKey, 0, 0, state.displayWidth * state.dpr, state.displayHeight * state.dpr, filterIR);
          isRendering = false;
          return;
        }
      }
      if (lastJobId) scheduler.cancel(lastJobId);
      const session = getActiveSessionOrNull();
      const activeVideoElements = session?.getPreviewVideoElements() ?? new Map<string, HTMLVideoElement>();
      const jobId = scheduler.schedule({
        time: timeToRender,
        resolution: { width: profile.maxWidth, height: profile.maxHeight },
        pixelRatio: profile.useDpr ? profile.dprScale : 1.0,
        outputFormat: "imagebitmap",
        priority: "realtime",
        videoElements: activeVideoElements,
        skipFilters: !!gpuCache, // Skip applying track-level filters on CPU if WebGL GPU rendering is available
      });
      lastJobId = jobId;
      scheduler
        .wait(jobId)
        .then((result) => {
          isRendering = false;
          if (!isActive) return;
          const latestState = renderStateRef.current;
          if (result.data instanceof ImageBitmap) {
            if (gpuCache) {
              const cacheKey = `preview:${latestState.project?.id}:${latestState.epoch}:${timeToRender.toFixed(3)}:${profile.maxWidth}x${profile.maxHeight}:${latestState.dpr}`;
              gpuCache.uploadTexture(cacheKey, result.data, result.data.width, result.data.height);
              gpuCache.clear();
              const filterIR = getActiveFilterIR(timeToRender);
              gpuCache.renderTexture(cacheKey, 0, 0, latestState.displayWidth * latestState.dpr, latestState.displayHeight * latestState.dpr, filterIR);
              result.data.close();
              gpuCache.evictLRU(GPU_MEMORY_LIMIT_MB);
            } else if (ctx2d) {
              const bitmapW = result.data.width;
              const bitmapH = result.data.height;
              const fitScale = Math.min(latestState.displayWidth / bitmapW, latestState.displayHeight / bitmapH);
              const drawW = bitmapW * fitScale;
              const drawH = bitmapH * fitScale;
              const ox = (latestState.displayWidth - drawW) / 2;
              const oy = (latestState.displayHeight - drawH) / 2;
              ctx2d.clearRect(0, 0, latestState.displayWidth, latestState.displayHeight);
              ctx2d.drawImage(result.data, ox, oy, drawW, drawH);
              result.data.close();
            }
          }
          const stats = scheduler.getStats();
          telemetryRef.current = {
            avgEvaluationTimeMs: stats.avgEvaluationTimeMs,
            avgRasterTimeMs: stats.avgRasterTimeMs,
            avgTotalTimeMs: stats.avgTotalTimeMs,
            cacheHitRate: stats.cacheHitRate,
            active: stats.active,
            droppedFrames: droppedFramesRef.current,
            driftMagnitude: maxDriftRef.current,
          };
          const now = performance.now();
          if (showTelemetryRef.current && now - lastTelemetryFlushRef.current > 250) {
            lastTelemetryFlushRef.current = now;
            setTelemetryStats(telemetryRef.current);
            maxDriftRef.current = 0;
          }
        })
        .catch((error: Error) => {
          isRendering = false;
          if (error.message !== "Job cancelled" && isActive) console.error("Failed to render frame:", error);
        });
    };
    rafId = requestAnimationFrame(renderLoop);
    return () => {
      isActive = false;
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (lastJobId) scheduler.cancel(lastJobId);
    };
  }, [useCanvasPreview, project, canvasWidth, canvasHeight, displayWidth, displayHeight, canvasEl]);

  // ── Clear selection when playback starts ──────────────────────────────
  // Transform overlays should not be visible during playback
  useEffect(() => {
    if (clockState.state === "playing") {
      clearSelection();
    }
  }, [clockState.state, clearSelection]);

  // ── Handle page visibility changes ────────────────────────────────────
  // When tab goes to background, pause playback to prevent audio drift
  // Browser throttles RAF to ~1fps in background, but audio continues normally
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Page is hidden - pause to prevent drift
        if (clockState.state === "playing") {
          transportPause();
          // Store that we auto-paused due to visibility
          sessionStorage.setItem("clypra-auto-paused", "true");
        }
      } else {
        // Page is visible again - resume if we auto-paused
        const wasAutoPaused = sessionStorage.getItem("clypra-auto-paused");
        if (wasAutoPaused === "true") {
          sessionStorage.removeItem("clypra-auto-paused");
          transportPlay();
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      sessionStorage.removeItem("clypra-auto-paused");
    };
  }, [clockState.state, transportPause, transportPlay]);

  useLayoutEffect(() => {
    const session = activeSession;
    if (!session) return;
    try {
      session.syncPreviewMedia(clips, mediaAssets, tracks, {
        time: clock.time,
        state: clockState.state,
        speed: clockState.speed,
        muted: isMuted,
        volume,
      });
    } catch (error) {
      console.error(`[PreviewPanel ERROR] Exception calling syncPreviewMedia:`, error);
    }
  }, [activeSession, clips, mediaAssets, tracks, clockState.state, clockState.speed, isMuted, volume, clock.time, clockState.time]);

  if (!project) return null;

  if (dimensions.width === 0 || dimensions.height === 0) {
    return (
      <div className="flex-1 bg-bg flex flex-col min-h-0 rounded-tl-xl border-l border-t border-white/3">
        <div className="flex-1 flex items-center justify-center p-4 md:p-6 overflow-hidden relative bg-[#06080a]">
          <div ref={containerRef} className="w-full h-full flex items-center justify-center">
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
    <div className="flex-1 bg-bg flex flex-col min-h-0 rounded-tl-xl border-l border-t border-white/3">
      <div className="flex items-center px-4 h-10 shrink-0 gap-2">
        <span className="text-[13px] font-semibold text-text-primary tracking-tight">Program Preview</span>
        <span className="text-[13px] text-text-muted">— Timeline</span>
        <button onClick={() => setShowSafeOverlay((s) => !s)} className={cn("ml-auto px-2 h-6 rounded text-[10px] font-medium transition-colors cursor-pointer", showSafeOverlay ? "bg-accent/20 text-accent" : "text-text-muted hover:text-text-primary hover:bg-white/6")} title="Toggle Title/Action Safe Zones" aria-label="Toggle Title/Action Safe Zones">
          Safe Zones
        </button>
        <button onClick={() => setShowTelemetry((s) => !s)} className={cn("px-2 h-6 rounded text-[10px] font-medium transition-colors cursor-pointer", showTelemetry ? "bg-accent/20 text-accent" : "text-text-muted hover:text-text-primary hover:bg-white/6")} title="Toggle render telemetry" aria-label="Toggle render telemetry">
          Stats
        </button>
      </div>

      {/* ── Video Area ─────────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center overflow-hidden bg-[#06080a] relative">
        <div ref={containerRef} onPointerDownCapture={handlePreviewPointerDownCapture} className={cn("w-full h-full flex items-center justify-center relative z-10 overflow-hidden", isPanning && "cursor-grabbing", spacePressed && !isPanning && "cursor-grab")}>
          <div data-testid="program-preview-viewport" className="relative flex shrink-0 items-center justify-center overflow-hidden shadow-[0_0_40px_rgba(0,0,0,0.36)]" style={{ width: displayWidth, height: displayHeight }}>
            <>
              {/* Canvas-based preview (matches export rendering) */}
              <canvas
                ref={canvasRef}
                data-testid="program-preview-canvas"
                style={{
                  width: displayWidth,
                  height: displayHeight,
                  imageRendering: "auto",
                }}
                className="bg-black"
              />

              {/* Transform overlay for selected clips - only show when paused */}
              {!isPlaying && <TransformOverlay canvasWidth={canvasWidth} canvasHeight={canvasHeight} scale={scale} viewport={viewport} displayOffset={{ x: offsetX, y: offsetY }} displayWidth={displayWidth} displayHeight={displayHeight} currentTime={currentTime} />}

              {/* Title & Action Safe Areas Overlay */}
              <SafeOverlay visible={showSafeOverlay} displayWidth={displayWidth} displayHeight={displayHeight} displayOffset={{ x: offsetX, y: offsetY }} />
            </>
          </div>
        </div>

        {/* Professional empty state */}
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
              <div className="text-xs text-text-muted/70 mt-4">Import media or drag clips to timeline</div>
            </div>
          </div>
        )}

        {/* Telemetry Overlay */}
        <TelemetryOverlay showTelemetry={showTelemetry} telemetryStats={telemetryStats} />
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
            {/* Speed selection */}
            <div className="relative" ref={speedMenuRef}>
              <PlaybackSpeedSelector playbackSpeed={playbackSpeed} speedMenuOpen={speedMenuOpen} setSpeedMenuOpen={setSpeedMenuOpen} setSpeed={setSpeed} />
            </div>

            <div className="w-px h-3 bg-white/10 mx-0.5" />

            {/* Playback Quality selection */}
            <div className="relative" ref={qualityMenuRef}>
              <PlaybackQualitySelector previewQuality={previewQuality} qualityMenuOpen={qualityMenuOpen} setQualityMenuOpen={setQualityMenuOpen} setPreviewQuality={setPreviewQuality} />
            </div>
          </div>
        }
        rightActions={
          <>
            {/* Aspect menu */}
            <div className="relative shrink-0" ref={aspectMenuRef}>
              <AspectSelector aspectMenuOpen={aspectMenuOpen} setAspectMenuOpen={setAspectMenuOpen} previewAspectPreset={previewAspectPreset} selectAspectPreset={selectAspectPreset} canvasWidth={canvasWidth} canvasHeight={canvasHeight} />
            </div>

            <button onClick={() => setPreviewScaleMode((m) => (m === "fit" ? "fill" : "fit"))} className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-white/6 transition-colors cursor-pointer" title={previewScaleMode === "fit" ? "Fill preview — scale to cover (crop edges)" : "Fit preview — show entire frame (letterbox)"} aria-label={previewScaleMode === "fit" ? "Fill preview" : "Fit preview"}>
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

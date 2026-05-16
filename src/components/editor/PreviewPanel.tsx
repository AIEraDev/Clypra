/**
 * Resolve aspect ratio for "Original" preview mode.
 *
 * IMPORTANT: In professional NLEs, "Original" means the SEQUENCE aspect ratio,
 * NOT the source media aspect ratio. The sequence defines the render universe.
 *
 * The program monitor always visualizes sequence space, never adapts to clips.
 * This maintains stability for:
 * - Overlays and graphics
 * - Text positioning
 * - Motion graphics
 * - Transitions
 * - Export consistency
 *
 * If users want to see source media aspect ratio, they should use Source Preview mode.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Expand, Shrink, Volume2, VolumeX } from "lucide-react";
import { usePlaybackClock, usePlaybackControls, useTransportControls, getPlaybackClock } from "@/hooks/usePlaybackClock";
import { useProjectStore } from "@/store/projectStore";
import { useTimelineStore } from "@/store/timelineStore";
import { useUIStore } from "@/store/uiStore";
import { evaluateSceneCached } from "@/core/evaluation/evaluator";
import { getFrameScheduler } from "@/core/scheduler/FrameScheduler";
import { getActiveSessionOrNull } from "@/core/runtime/ProjectSession";
import { convertFileSrc } from "@tauri-apps/api/core";
import { SourcePreview } from "./SourcePreview";
import { PreviewTransport } from "./PreviewTransport";
import { TransformOverlay } from "./transform/TransformOverlay";
import { GPUTextureCache } from "@/lib/gpuTextureCache";
import { PreviewQualityManager, PreviewQualityTier } from "@/lib/preview/PreviewQualityManager";
import { cn } from "@/lib/utils";
import type { EvaluatedMediaLayer } from "@/core/evaluation/types";
import { AspectRatio, PREVIEW_ASPECT_LABEL } from "@/types";
import { AspectMenuRow } from "../ui/AspectRatio";
import { formatTime } from "@/lib/timeFormatting";

const PREVIEW_ASPECT_RATIO: Record<AspectRatio, number | null> = {
  original: null, // Uses project canvas
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "1:1": 1,
  "4:5": 4 / 5,
};

// Canvas dimensions for each preset (based on common resolutions)
const CANVAS_DIMENSIONS: Record<Exclude<AspectRatio, "original">, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
};

function previewAspectWidthOverHeight(preset: AspectRatio, canvasWidth: number, canvasHeight: number): number {
  const ch = Math.max(1, canvasHeight);
  if (preset === "original") {
    return canvasWidth / ch;
  }
  return PREVIEW_ASPECT_RATIO[preset] ?? canvasWidth / ch;
}

function resolveOriginalPreviewAspect(layers: readonly { mediaId: string }[], mediaAssets: Array<{ id: string; width?: number; height?: number }>, canvasWidth: number, canvasHeight: number): number {
  // Always return sequence aspect ratio
  // The sequence is the coordinate universe - it doesn't change based on clips
  return canvasWidth / Math.max(1, canvasHeight);
}

/** Largest rectangle with aspect W/H = R inside the panel. */
function previewViewportSize(panelWidth: number, panelHeight: number, widthOverHeight: number): { vw: number; vh: number } {
  const R = widthOverHeight;
  let vw = Math.min(panelWidth, panelHeight * R);
  let vh = vw / R;
  if (vh > panelHeight + 0.5) {
    vh = panelHeight;
    vw = vh * R;
  }
  return { vw: Math.max(1, vw), vh: Math.max(1, vh) };
}

function PreviewAspectShapeIcon({ widthOverHeight }: { widthOverHeight: number }) {
  const max = 22;
  const min = 8;
  let w: number;
  let h: number;
  if (widthOverHeight >= 1) {
    h = 12;
    w = Math.round(Math.min(max, Math.max(min, h * widthOverHeight)));
  } else {
    w = 12;
    h = Math.round(Math.min(max, Math.max(min, w / widthOverHeight)));
  }
  return <span className="inline-flex shrink-0 rounded-sm border border-border-soft bg-bg" style={{ width: w, height: h }} aria-hidden />;
}

export const PreviewPanel: React.FC = () => {
  const { previewMode } = useUIStore();

  // If in source mode, show SourcePreview
  if (previewMode === "source") {
    return <SourcePreview />;
  }

  // Otherwise show program (timeline) preview
  return <ProgramPreview />;
};

const ProgramPreview: React.FC = () => {
  // Imperative clock (throttled UI snapshots, 10fps)
  const clockState = usePlaybackClock();
  const { play, pause, seek, setSpeed, setDuration, setFrameRate } = usePlaybackControls();
  const { play: transportPlay, pause: transportPause, seek: transportSeek, setActiveContext } = useTransportControls();
  const clock = getPlaybackClock();

  const project = useProjectStore((s) => s.project);
  const updateProject = useProjectStore((s) => s.updateProject);
  const mediaAssets = useProjectStore((s) => s.mediaAssets);
  const tracks = useTimelineStore((s) => s.tracks);
  const clips = useTimelineStore((s) => s.clips);
  const epoch = useTimelineStore((s) => s.epoch);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(100);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  /** Bumps after program <video> metadata loads so we re-seek once duration is valid. */
  const [previewVideoReadyTick, setPreviewVideoReadyTick] = useState(0);
  /** fit = letterbox full canvas; fill = zoom canvas to cover panel (crop edges). */
  const [previewScaleMode, setPreviewScaleMode] = useState<"fit" | "fill">("fit");
  const [previewAspectPreset, setPreviewAspectPreset] = useState<AspectRatio>("original");
  const [aspectMenuOpen, setAspectMenuOpen] = useState(false);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const aspectMenuRef = useRef<HTMLDivElement>(null);
  const speedMenuRef = useRef<HTMLDivElement>(null);
  const [useCanvasPreview] = useState(true); // Canvas is authoritative visual output
  const gpuCacheRef = useRef<GPUTextureCache | null>(null);
  const gpuFallbackRef = useRef(false); // true if WebGL2 unavailable → use Canvas2D
  const qualityManagerRef = useRef<PreviewQualityManager | null>(null);
  const [showTelemetry, setShowTelemetry] = useState(false);
  const [telemetryStats, setTelemetryStats] = useState<{
    avgEvaluationTimeMs: number;
    avgRasterTimeMs: number;
    avgTotalTimeMs: number;
    cacheHitRate: number;
    active: number;
    droppedFrames: number;
    driftMagnitude: number;
  } | null>(null);
  const telemetryRef = useRef(telemetryStats);
  const lastTelemetryFlushRef = useRef(0);
  const showTelemetryRef = useRef(showTelemetry);
  showTelemetryRef.current = showTelemetry;

  const droppedFramesRef = useRef(0);
  const maxDriftRef = useRef(0);

  // Track original canvas dimensions when project loads
  const originalCanvasDimsRef = useRef<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (project && !originalCanvasDimsRef.current) {
      // Store original dimensions on first load
      originalCanvasDimsRef.current = {
        width: project.canvasWidth,
        height: project.canvasHeight,
      };
    }
  }, [project?.id]); // Only run when project changes

  // Sync preview aspect preset with project aspect ratio when project loads
  useEffect(() => {
    if (project?.aspectRatio) {
      setPreviewAspectPreset(project.aspectRatio);
    }
  }, [project?.id, project?.aspectRatio]); // Re-run when project changes

  // Initialize clock with project settings (only when they actually change)
  const prevDurationRef = useRef<number>(0);
  const prevFrameRateRef = useRef<number>(0);

  useEffect(() => {
    if (!project) return;

    // Calculate timeline duration from clips
    const maxEndTime = clips.reduce((max, clip) => {
      const endTime = clip.startTime + clip.duration;
      return Math.max(max, endTime);
    }, 0);

    const newDuration = Math.max(maxEndTime, 10); // Minimum 10 seconds
    const newFrameRate = project.frameRate || 30;

    // Only update if values actually changed
    if (newDuration !== prevDurationRef.current) {
      setDuration(newDuration);
      prevDurationRef.current = newDuration;
    }

    if (newFrameRate !== prevFrameRateRef.current) {
      setFrameRate(newFrameRate);
      prevFrameRateRef.current = newFrameRate;
    }
  }, [project, clips]);

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
    const updateDimensions = () => {
      if (!containerRef.current) return;
      setDimensions({ width: containerRef.current.clientWidth, height: containerRef.current.clientHeight });
    };

    const resizeObserver = new ResizeObserver(() => {
      updateDimensions();
      // Force canvas to re-render current frame after resize
      // The canvas rendering effect will restart due to displayWidth/displayHeight changes
    });

    // Also listen to window resize and fullscreen events for more reliable updates
    const handleResize = () => {
      updateDimensions();
    };

    const handleFullscreenChange = () => {
      // Delay to ensure layout has settled after fullscreen transition
      setTimeout(updateDimensions, 100);
      // Additional update after animation completes
      setTimeout(updateDimensions, 300);
    };

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
      setTimeout(updateDimensions, 0);
    }

    window.addEventListener("resize", handleResize);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange); // Safari

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", handleResize);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
    };
  }, [project]);

  // Scene evaluation (for UI and initial render)
  const scene = useMemo(() => evaluateSceneCached(clockState.time, clips, tracks, mediaAssets, project ?? null, epoch), [tracks, clips, mediaAssets, clockState.time, project, epoch]);

  // Video element management - separate from scene time updates
  // Create/destroy video elements based on clip composition only, not playback time
  const videoClips = useMemo(() => {
    return clips.filter((clip) => {
      const asset = mediaAssets.find((a) => a.id === clip.mediaId);
      return asset?.type === "video";
    });
  }, [clips, mediaAssets]);

  // Audio element management - separate from scene time updates
  // Create/destroy audio elements for audio-only clips
  const audioClips = useMemo(() => {
    return clips.filter((clip) => {
      const asset = mediaAssets.find((a) => a.id === clip.mediaId);
      return asset?.type === "audio";
    });
  }, [clips, mediaAssets]);

  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});

  // Calculate display dimensions for canvas
  const canvasWidth = project?.canvasWidth ?? 1920;
  const canvasHeight = project?.canvasHeight ?? 1080;
  const originalAspectR = resolveOriginalPreviewAspect(
    scene.visualLayers.filter((l) => l.layerType === "media"),
    mediaAssets,
    canvasWidth,
    canvasHeight,
  );
  const aspectR = previewAspectPreset === "original" ? originalAspectR : previewAspectWidthOverHeight(previewAspectPreset, canvasWidth, canvasHeight);
  const { vw, vh } = previewViewportSize(dimensions.width, dimensions.height, aspectR);
  const scaleFit = Math.min(vw / canvasWidth, vh / canvasHeight);
  const scaleFill = Math.max(vw / canvasWidth, vh / canvasHeight);
  const scale = previewScaleMode === "fit" ? scaleFit : scaleFill;
  const displayWidth = canvasWidth * scale;
  const displayHeight = canvasHeight * scale;

  // Preview Quality Manager — prevents 4K × DPR VRAM explosion
  const dpr = window.devicePixelRatio || 1;
  if (!qualityManagerRef.current && project) {
    qualityManagerRef.current = new PreviewQualityManager({
      sequenceWidth: canvasWidth,
      sequenceHeight: canvasHeight,
      viewportWidth: Math.floor(displayWidth),
      viewportHeight: Math.floor(displayHeight),
      dpr,
    });
  }
  if (qualityManagerRef.current) {
    qualityManagerRef.current.updateViewport(Math.floor(displayWidth), Math.floor(displayHeight), dpr);
  }

  // GPU cache initialization — create once, reuse across resizes and state changes.
  // GPU resources survive layout changes; only disposed on unmount.
  useEffect(() => {
    if (!useCanvasPreview || !canvasRef.current || gpuFallbackRef.current) return;

    // Already initialized — reuse existing cache
    if (gpuCacheRef.current) return;

    try {
      gpuCacheRef.current = new GPUTextureCache(canvasRef.current);
    } catch {
      // WebGL2 unavailable — fall back to Canvas2D permanently
      gpuFallbackRef.current = true;
    }
  }, [useCanvasPreview]);

  // GPU cache disposal — only on unmount
  useEffect(() => {
    return () => {
      if (gpuCacheRef.current) {
        gpuCacheRef.current.dispose();
        gpuCacheRef.current = null;
      }
    };
  }, []);

  // Canvas rendering - INDEPENDENT RAF LOOP (not tied to React state)
  // GPU-first: uploads ImageBitmaps as WebGL2 textures for zero-copy reuse.
  // Falls back to Canvas2D if WebGL2 is unavailable.
  useEffect(() => {
    if (!useCanvasPreview || !canvasRef.current || !project) return;

    const canvas = canvasRef.current;

    if (displayWidth === 0 || displayHeight === 0) return;

    // ── Resolve rendering context (GPU cache persists across re-runs) ──
    const gpuCache = gpuCacheRef.current;
    let ctx2d: CanvasRenderingContext2D | null = null;

    if (!gpuCache) {
      ctx2d = canvas.getContext("2d");
      if (ctx2d) {
        ctx2d.clearRect(0, 0, displayWidth, displayHeight);
      }
    }

    // Get scheduler and update timeline state
    const scheduler = getFrameScheduler();
    scheduler.updateTimeline(clips, tracks, mediaAssets, project, epoch);

    let rafId: number | null = null;
    let isActive = true;
    let isRendering = false;
    let lastJobId: string | null = null;

    // GPU memory limit for preview frame textures (128 MB)
    const GPU_MEMORY_LIMIT_MB = 128;

    // Independent render loop (reads clock imperatively)
    const renderLoop = () => {
      if (!isActive) return;

      // Schedule next tick regardless of whether we render this frame
      rafId = requestAnimationFrame(renderLoop);

      // Drop frame if still rendering a previous frame
      if (isRendering) {
        droppedFramesRef.current++;
        return;
      }

      isRendering = true;
      const timeToRender = clock.time;

      // Select quality tier based on playback/interaction state
      const qm = qualityManagerRef.current;
      const isPlaying = clockState.state === "playing";
      const qualityTier = qm ? qm.selectTierForInteraction(isPlaying, false, false) : PreviewQualityTier.Idle;
      const profile = qm ? qm.getRenderProfile(qualityTier) : { maxWidth: canvasWidth, maxHeight: canvasHeight, dprScale: dpr, useDpr: true };

      // Check GPU texture cache for this frame (skip scheduler entirely on cache hit)
      // Cache key uses render dimensions (what we render) not display dimensions (what we show)
      if (gpuCache) {
        const renderW = profile.maxWidth;
        const renderH = profile.maxHeight;
        const cacheKey = `preview:${epoch}:${timeToRender.toFixed(3)}:${renderW}x${renderH}:${dpr}`;
        if (gpuCache.hasTexture(cacheKey)) {
          gpuCache.clear();
          // Render full-resolution texture scaled down to display size
          gpuCache.renderTexture(cacheKey, 0, 0, displayWidth, displayHeight);
          isRendering = false;
          return;
        }
      }

      // Cancel previous job if still pending to prevent queue buildup
      if (lastJobId) {
        scheduler.cancel(lastJobId);
      }

      // Build map of active video elements to bypass resource decoding
      const activeVideoElements = new Map<string, HTMLVideoElement>();
      for (const [key, video] of Object.entries(videoRefs.current)) {
        if (video) {
          activeVideoElements.set(key, video);
        }
      }

      // Schedule frame render at quality-manager-capped resolution
      // Prevents 4K × DPR VRAM explosion while maintaining visual fidelity
      const jobId = scheduler.schedule({
        time: timeToRender,
        resolution: {
          width: profile.maxWidth,
          height: profile.maxHeight,
        },
        pixelRatio: profile.useDpr ? profile.dprScale : 1.0,
        outputFormat: "imagebitmap",
        priority: "realtime",
        videoElements: activeVideoElements,
      });
      lastJobId = jobId;

      scheduler
        .wait(jobId)
        .then((result) => {
          isRendering = false;
          if (!isActive) return;

          if (result.data instanceof ImageBitmap) {
            if (gpuCache) {
              // GPU path: upload capped-resolution bitmap as texture, render scaled down to display size
              const cacheKey = `preview:${epoch}:${timeToRender.toFixed(3)}:${profile.maxWidth}x${profile.maxHeight}:${dpr}`;
              gpuCache.uploadTexture(cacheKey, result.data, result.data.width, result.data.height);
              gpuCache.clear();
              // Scale down from full canvas resolution to display size
              gpuCache.renderTexture(cacheKey, 0, 0, displayWidth, displayHeight);
              result.data.close();

              // Evict LRU textures if GPU memory exceeds limit
              gpuCache.evictLRU(GPU_MEMORY_LIMIT_MB);
            } else if (ctx2d) {
              // Canvas2D fallback path: center bitmap with aspect-ratio preservation
              const bitmapW = result.data.width;
              const bitmapH = result.data.height;
              const fitScale = Math.min(displayWidth / bitmapW, displayHeight / bitmapH);
              const drawW = bitmapW * fitScale;
              const drawH = bitmapH * fitScale;
              const offsetX = (displayWidth - drawW) / 2;
              const offsetY = (displayHeight - drawH) / 2;
              ctx2d.clearRect(0, 0, displayWidth, displayHeight);
              ctx2d.drawImage(result.data, offsetX, offsetY, drawW, drawH);
              result.data.close();
            }
          }

          // Update telemetry (throttled to 4fps, only when visible)
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
          if (error.message !== "Job cancelled" && isActive) {
            console.error("Failed to render frame:", error);
          }
        });
    };

    // Start render loop
    rafId = requestAnimationFrame(renderLoop);

    // Cleanup: stop render loop and cancel pending jobs (GPU cache survives)
    return () => {
      isActive = false;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      if (lastJobId) {
        scheduler.cancel(lastJobId);
      }
    };
  }, [useCanvasPreview, clips, tracks, mediaAssets, project, epoch, clock, displayWidth, displayHeight, canvasWidth, canvasHeight]);

  // Cleanup video elements on component unmount only
  useEffect(() => {
    return () => {
      const session = getActiveSessionOrNull();
      Object.entries(videoRefs.current).forEach(([key, video]) => {
        if (!video) return;
        session?.unregisterVideoElement(key);
        video.pause();
        video.src = "";
        video.load();
      });
      videoRefs.current = {};
    };
  }, []);

  // Cleanup audio elements on component unmount only
  useEffect(() => {
    return () => {
      Object.entries(audioRefs.current).forEach(([key, audio]) => {
        if (!audio) return;
        audio.pause();
        audio.src = "";
        audio.load();
      });
      audioRefs.current = {};
    };
  }, []);

  // Sync video playback state (doesn't touch src)
  useEffect(() => {
    const currentClockTime = clock.time;

    Object.values(videoRefs.current).forEach((video) => {
      if (!video) return;

      const clipId = video.dataset.clipId;
      const mediaId = video.dataset.mediaId;
      const videoKey = `${clipId}-${mediaId}`;

      // Skip if video has no source or isn't ready
      if (!video.src || video.readyState < 2) {
        return;
      }

      // Audio settings
      video.muted = isMuted || volume === 0;
      video.volume = Math.max(0, Math.min(1, volume / 100));
      video.playbackRate = clockState.speed;

      // Set initial time when starting playback or when paused
      if (Number.isFinite(video.duration) && video.duration > 0) {
        const clip = clips.find((c) => c.id === clipId);

        if (clip) {
          const clipLocalTime = currentClockTime - clip.startTime;
          const trimIn = clip.trimIn || 0;
          const sourceTime = trimIn + clipLocalTime;
          const targetTime = Math.max(0, Math.min(sourceTime, Math.max(0, video.duration - 0.01)));

          if (clockState.state !== "playing") {
            video.currentTime = targetTime;
          } else if (video.paused) {
            video.currentTime = targetTime;
          }
        }
      }

      // Play/pause based on clock state
      if (clockState.state === "playing") {
        if (video.paused) {
          // Only try to play if video is ready
          if (video.readyState >= 3) {
            const playPromise = video.play();
            if (playPromise !== undefined) {
              playPromise
                .then(() => {})
                .catch((err) => {
                  if (err.name !== "AbortError") {
                    console.warn(`[PreviewPanel] Video ${videoKey} - play() failed:`, err);
                  }
                });
            }
          }
        }
      } else {
        if (!video.paused) {
          video.pause();
        }
      }
    });

    // NO cleanup here - videos persist across playback state changes
  }, [clockState.state, isMuted, volume, clockState.speed, clips, clock, previewVideoReadyTick]);

  // Continuous drift correction via RAF (replaces 250ms interval for frame-accurate sync)
  useEffect(() => {
    if (clockState.state !== "playing") return;

    let rafId: number | null = null;

    const syncLoop = () => {
      const currentClockTime = clock.time; // Fresh time every frame

      Object.values(videoRefs.current).forEach((video) => {
        if (!video) return;

        const clipId = video.dataset.clipId;
        const clip = clips.find((c) => c.id === clipId);
        if (!clip) return;

        const clipLocalTime = currentClockTime - clip.startTime;
        if (clipLocalTime < 0 || clipLocalTime > clip.duration) {
          if (!video.paused) video.pause();
          return;
        }

        const trimIn = clip.trimIn || 0;
        const sourceTime = trimIn + clipLocalTime;

        if (Number.isFinite(video.duration) && video.duration > 0 && video.readyState >= 3) {
          const targetTime = Math.max(0, Math.min(sourceTime, Math.max(0, video.duration - 0.01)));
          const drift = Math.abs(video.currentTime - targetTime);

          maxDriftRef.current = Math.max(maxDriftRef.current, drift);

          if ("preservesPitch" in video) {
            (video as any).preservesPitch = false;
          }

          if (drift < 0.1) {
            // <100ms: Perfect sync — just ensure correct playbackRate
            if (Math.abs(video.playbackRate - clockState.speed) > 0.01) {
              video.playbackRate = clockState.speed;
            }
          } else if (drift <= 0.3) {
            // 100ms - 300ms: Soft playbackRate correction
            const correctionSpeed = video.currentTime < targetTime ? clockState.speed * 1.02 : clockState.speed * 0.98;
            if (Math.abs(video.playbackRate - correctionSpeed) > 0.01) {
              video.playbackRate = correctionSpeed;
            }
          } else if (drift <= 0.6) {
            // 300ms - 600ms: Hard seek
            video.currentTime = targetTime;
            video.playbackRate = clockState.speed;
          } else {
            // >600ms: Playback recovery reset
            video.pause();
            video.currentTime = targetTime;
            video.playbackRate = clockState.speed;
            const p = video.play();
            if (p && typeof p.catch === "function") p.catch(console.error);
          }
        }
      });

      rafId = requestAnimationFrame(syncLoop);
    };

    rafId = requestAnimationFrame(syncLoop);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [clockState.state, clockState.speed, clips, clock]);

  // ── Audio Element Sync (Play/Pause/Seek) ──────────────────────────────────
  // Sync audio playback state with master clock
  useEffect(() => {
    const currentClockTime = clock.time;

    Object.values(audioRefs.current).forEach((audio) => {
      if (!audio) return;

      const clipId = audio.dataset.clipId;
      const mediaId = audio.dataset.mediaId;
      const audioKey = `${clipId}-${mediaId}`;

      // Skip if audio has no source or isn't ready
      if (!audio.src || audio.readyState < 2) {
        return;
      }

      // Audio settings
      audio.muted = isMuted || volume === 0;
      audio.volume = Math.max(0, Math.min(1, volume / 100));
      audio.playbackRate = clockState.speed;

      // Set initial time when starting playback or when paused
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        const clip = clips.find((c) => c.id === clipId);

        if (clip) {
          const clipLocalTime = currentClockTime - clip.startTime;
          const trimIn = clip.trimIn || 0;
          const sourceTime = trimIn + clipLocalTime;
          const targetTime = Math.max(0, Math.min(sourceTime, Math.max(0, audio.duration - 0.01)));

          if (clockState.state !== "playing") {
            audio.currentTime = targetTime;
          } else if (audio.paused) {
            audio.currentTime = targetTime;
          }
        }
      }

      // Play/pause based on clock state
      if (clockState.state === "playing") {
        if (audio.paused) {
          // Only try to play if audio is ready
          if (audio.readyState >= 3) {
            const playPromise = audio.play();
            if (playPromise !== undefined) {
              playPromise
                .then(() => {})
                .catch((err) => {
                  if (err.name !== "AbortError") {
                    console.warn(`[PreviewPanel] Audio ${audioKey} - play() failed:`, err);
                  }
                });
            }
          }
        }
      } else {
        if (!audio.paused) {
          audio.pause();
        }
      }
    });

    // NO cleanup here - audio elements persist across playback state changes
  }, [clockState.state, isMuted, volume, clockState.speed, clips, clock]);

  // ── Audio Drift Correction ────────────────────────────────────────────────
  // Continuous drift correction via RAF for frame-accurate audio sync
  useEffect(() => {
    if (clockState.state !== "playing") return;

    let rafId: number | null = null;

    const syncLoop = () => {
      const currentClockTime = clock.time; // Fresh time every frame

      Object.values(audioRefs.current).forEach((audio) => {
        if (!audio) return;

        const clipId = audio.dataset.clipId;
        const clip = clips.find((c) => c.id === clipId);
        if (!clip) return;

        const clipLocalTime = currentClockTime - clip.startTime;
        if (clipLocalTime < 0 || clipLocalTime > clip.duration) {
          if (!audio.paused) audio.pause();
          return;
        }

        const trimIn = clip.trimIn || 0;
        const sourceTime = trimIn + clipLocalTime;

        if (Number.isFinite(audio.duration) && audio.duration > 0 && audio.readyState >= 3) {
          const targetTime = Math.max(0, Math.min(sourceTime, Math.max(0, audio.duration - 0.01)));
          const drift = Math.abs(audio.currentTime - targetTime);

          if ("preservesPitch" in audio) {
            (audio as any).preservesPitch = false;
          }

          if (drift < 0.1) {
            // <100ms: Perfect sync — just ensure correct playbackRate
            if (Math.abs(audio.playbackRate - clockState.speed) > 0.01) {
              audio.playbackRate = clockState.speed;
            }
          } else if (drift <= 0.3) {
            // 100ms - 300ms: Soft playbackRate correction
            const correctionSpeed = audio.currentTime < targetTime ? clockState.speed * 1.02 : clockState.speed * 0.98;
            if (Math.abs(audio.playbackRate - correctionSpeed) > 0.01) {
              audio.playbackRate = correctionSpeed;
            }
          } else if (drift <= 0.6) {
            // 300ms - 600ms: Hard seek
            audio.currentTime = targetTime;
            audio.playbackRate = clockState.speed;
          } else {
            // >600ms: Playback recovery reset
            audio.pause();
            audio.currentTime = targetTime;
            audio.playbackRate = clockState.speed;
            const p = audio.play();
            if (p && typeof p.catch === "function") p.catch(console.error);
          }
        }
      });

      rafId = requestAnimationFrame(syncLoop);
    };

    rafId = requestAnimationFrame(syncLoop);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [clockState.state, clockState.speed, clips, clock]);

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

  const selectAspectPreset = (p: AspectRatio) => {
    setPreviewAspectPreset(p);
    setAspectMenuOpen(false);

    if (!project) return;

    // Handle "original" - restore to original canvas dimensions
    if (p === "original") {
      if (originalCanvasDimsRef.current) {
        updateProject({
          canvasWidth: originalCanvasDimsRef.current.width,
          canvasHeight: originalCanvasDimsRef.current.height,
          aspectRatio: "original",
        });
      }
    } else {
      // Update to preset dimensions
      const dims = CANVAS_DIMENSIONS[p];
      updateProject({
        canvasWidth: dims.width,
        canvasHeight: dims.height,
        aspectRatio: p,
      });
    }
  };

  // Derive UI values from clock state
  const currentTime = clockState.time;
  const duration = clockState.duration;
  const isPlaying = clockState.state === "playing";
  const playbackSpeed = clockState.speed;
  const frameRate = clockState.frameRate;
  const step = 1 / Math.max(1, frameRate);

  return (
    <div className="flex-1 bg-bg flex flex-col min-h-0 rounded-tl-xl border-l border-t border-white/3">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-center px-4 h-10 shrink-0 gap-2">
        <span className="text-[13px] font-semibold text-text-primary tracking-tight">Program Preview</span>
        <span className="text-[13px] text-text-muted">— Timeline</span>
        <button onClick={() => setShowTelemetry((s) => !s)} className={cn("ml-auto px-2 h-6 rounded text-[10px] font-medium transition-colors", showTelemetry ? "bg-accent/20 text-accent" : "text-text-muted hover:text-text-primary hover:bg-white/6")} title="Toggle render telemetry" aria-label="Toggle render telemetry">
          Stats
        </button>
      </div>

      {/* ── Video Area ─────────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center overflow-hidden bg-[#06080a] relative">
        <div className="absolute inset-0 checkerboard opacity-[0.15] pointer-events-none" />
        <div ref={containerRef} className="w-full h-full flex items-center justify-center relative z-10 overflow-hidden">
          <div data-testid="program-preview-viewport" className="relative flex shrink-0 items-center justify-center overflow-hidden shadow-[0_0_40px_rgba(0, 0, 0, 0.36)]" style={{ width: vw, height: vh }}>
            {useCanvasPreview ? (
              <>
                {/* Canvas-based preview (matches export rendering) */}
                <canvas
                  ref={canvasRef}
                  data-testid="program-preview-canvas"
                  width={displayWidth}
                  height={displayHeight}
                  style={{
                    width: displayWidth,
                    height: displayHeight,
                    imageRendering: "auto",
                  }}
                  className="bg-black"
                />

                {/* Transform overlay for selected clips */}
                <TransformOverlay canvasWidth={displayWidth} canvasHeight={displayHeight} scale={1} />

                {/* Hidden video elements for audio/video sync (ENGINE CLOCK IS MASTER). 
                    CRITICAL: Do NOT use width: 0, height: 0, or opacity: 0. 
                    Browsers throttle decoding for invisible videos, destroying A/V sync.
                    Keep them 1x1 pixel with near-zero opacity to force hardware decoding. 
                    
                    ARCHITECTURE: Video elements are keyed by clip+media ID and persist across time updates.
                    They are only created/destroyed when clips are added/removed, not on every frame. */}
                <div className="absolute top-0 left-0 pointer-events-none -z-10" style={{ width: "16px", height: "16px", opacity: 0.01, visibility: "hidden", overflow: "hidden" }}>
                  {videoClips.map((clip) => {
                    const asset = mediaAssets.find((a) => a.id === clip.mediaId);
                    if (!asset) return null;
                    const sourcePath = asset.path.startsWith("asset://") ? asset.path : convertFileSrc(asset.path);

                    return (
                      <video
                        key={`${clip.id}-${clip.mediaId}`}
                        data-media-id={clip.mediaId}
                        data-clip-id={clip.id}
                        ref={(el) => {
                          const key = `${clip.id}-${clip.mediaId}`;
                          const session = getActiveSessionOrNull();
                          if (el) {
                            videoRefs.current[key] = el;
                            session?.registerVideoElement(key, el);
                          } else if (videoRefs.current[key]) {
                            session?.unregisterVideoElement(key);
                            delete videoRefs.current[key];
                          }
                        }}
                        src={sourcePath}
                        muted={isMuted || volume === 0}
                        playsInline
                        preload="auto"
                        onLoadedMetadata={(e) => {
                          const video = e.currentTarget;
                          const key = `${clip.id}-${clip.mediaId}`;
                          setPreviewVideoReadyTick((n) => n + 1);
                        }}
                        onCanPlay={(e) => {
                          const video = e.currentTarget;
                          const key = `${clip.id}-${clip.mediaId}`;
                        }}
                        onError={(e) => {
                          const key = `${clip.id}-${clip.mediaId}`;
                          console.error(`[PreviewPanel] Video error - ${key}:`, e.currentTarget.error);
                        }}
                        className="w-full h-full"
                      />
                    );
                  })}
                </div>

                {/* Hidden audio elements for audio-only clips (ENGINE CLOCK IS MASTER).
                    ARCHITECTURE: Audio elements are keyed by clip+media ID and persist across time updates.
                    They are only created/destroyed when clips are added/removed, not on every frame. */}
                <div className="absolute top-0 left-0 pointer-events-none -z-10" style={{ width: "1px", height: "1px", opacity: 0, visibility: "hidden", overflow: "hidden" }}>
                  {audioClips.map((clip) => {
                    const asset = mediaAssets.find((a) => a.id === clip.mediaId);
                    if (!asset) return null;
                    const sourcePath = asset.path.startsWith("asset://") ? asset.path : convertFileSrc(asset.path);

                    return (
                      <audio
                        key={`${clip.id}-${clip.mediaId}`}
                        data-media-id={clip.mediaId}
                        data-clip-id={clip.id}
                        ref={(el) => {
                          const key = `${clip.id}-${clip.mediaId}`;
                          if (el) {
                            audioRefs.current[key] = el;
                          } else if (audioRefs.current[key]) {
                            delete audioRefs.current[key];
                          }
                        }}
                        src={sourcePath}
                        preload="auto"
                        onLoadedMetadata={(e) => {
                          const audio = e.currentTarget;
                          const key = `${clip.id}-${clip.mediaId}`;
                        }}
                        onCanPlay={(e) => {
                          const audio = e.currentTarget;
                          const key = `${clip.id}-${clip.mediaId}`;
                        }}
                        onError={(e) => {
                          const key = `${clip.id}-${clip.mediaId}`;
                          console.error(`[PreviewPanel] Audio error - ${key}:`, e.currentTarget.error);
                        }}
                      />
                    );
                  })}
                </div>
              </>
            ) : (
              // DOM-based preview (legacy, for comparison)
              <div data-testid="program-preview-canvas" className="relative shrink-0 bg-black" style={{ width: displayWidth, height: displayHeight }}>
                {scene.visualLayers.length === 0 ? (
                  <div className="absolute inset-0 flex items-center justify-center text-text-muted">Preview</div>
                ) : (
                  scene.visualLayers.map((layer) => {
                    // Render text layers
                    if (layer.layerType === "text") {
                      return (
                        <div
                          key={layer.layerId}
                          data-testid="preview-text-layer"
                          className="absolute overflow-hidden flex items-center justify-center"
                          style={{
                            left: layer.x * scale,
                            top: layer.y * scale,
                            width: layer.width * scale,
                            height: layer.height * scale,
                            opacity: Math.max(0, Math.min(1, layer.opacity > 1 ? layer.opacity / 100 : layer.opacity)),
                            transform: `rotate(${layer.rotation}deg)`,
                            transformOrigin: "center center",
                            zIndex: layer.zIndex + 1,
                          }}
                        >
                          <div
                            style={{
                              fontFamily: layer.fontFamily,
                              fontSize: `${layer.fontSize * scale}px`,
                              color: layer.color,
                              fontWeight: layer.fontWeight,
                              fontStyle: layer.fontStyle,
                              textAlign: layer.textAlign,
                              lineHeight: layer.lineHeight,
                              letterSpacing: `${layer.letterSpacing * scale}px`,
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                              width: "100%",
                              padding: "8px",
                            }}
                          >
                            {layer.text}
                          </div>
                        </div>
                      );
                    }

                    // Render media layers (video/image)
                    return (
                      <div
                        key={layer.layerId}
                        data-testid="preview-layer"
                        className="absolute overflow-hidden"
                        style={{
                          left: layer.x * scale,
                          top: layer.y * scale,
                          width: layer.width * scale,
                          height: layer.height * scale,
                          opacity: Math.max(0, Math.min(1, layer.opacity > 1 ? layer.opacity / 100 : layer.opacity)),
                          transform: `rotate(${layer.rotation}deg)`,
                          transformOrigin: "center center",
                          zIndex: layer.zIndex + 1,
                        }}
                      >
                        {layer.mediaType === "video" ? (
                          <video
                            data-media-id={layer.mediaId}
                            data-clip-id={layer.clipId}
                            ref={(el) => {
                              videoRefs.current[`${layer.clipId}-${layer.mediaId}`] = el;
                              if (el) {
                              }
                            }}
                            src={layer.sourcePath}
                            muted={isMuted || volume === 0}
                            playsInline
                            preload="auto"
                            onLoadedMetadata={(e) => {
                              const video = e.currentTarget;
                              setPreviewVideoReadyTick((n) => n + 1);
                            }}
                            onCanPlay={(e) => {
                              const video = e.currentTarget;
                            }}
                            onError={(e) => {
                              console.error(`[PreviewPanel] Video error (visual) - ${layer.clipId}-${layer.mediaId}:`, e.currentTarget.error);
                            }}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <img src={layer.posterFrame || layer.sourcePath} alt={layer.mediaId} className="w-full h-full object-cover" />
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>

        {/* Professional empty state - shows sequence context when no clips. Applied same width and height has canvas, so that it's always fit-in professionally*/}
        {clips.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none mx-auto" style={{ width: vw, height: vh }}>
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
        {showTelemetry && telemetryStats && (
          <div className="absolute top-4 left-4 z-20 bg-black/80 backdrop-blur-sm rounded-lg p-3 text-xs font-mono text-white/90 space-y-1 border border-white/10">
            <div className="font-semibold text-accent mb-2">Render Telemetry</div>
            <div className="flex justify-between gap-4">
              <span className="text-white/60">Eval:</span>
              <span>{telemetryStats.avgEvaluationTimeMs.toFixed(2)}ms</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-white/60">Raster:</span>
              <span>{telemetryStats.avgRasterTimeMs.toFixed(2)}ms</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-white/60">Total:</span>
              <span>{telemetryStats.avgTotalTimeMs.toFixed(2)}ms</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-white/60">Cache:</span>
              <span>{(telemetryStats.cacheHitRate * 100).toFixed(0)}%</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-white/60">Active:</span>
              <span>{telemetryStats.active}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-white/60">Dropped:</span>
              <span className={telemetryStats.droppedFrames > 0 ? "text-yellow-400" : ""}>{telemetryStats.droppedFrames}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-white/60">Max Drift:</span>
              <span className={telemetryStats.driftMagnitude > 0.04 ? "text-yellow-400" : ""}>{(telemetryStats.driftMagnitude * 1000).toFixed(0)}ms</span>
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
          if (clips.length === 0) return; // Disable playback when timeline is empty
          // Ensure program context is active before playing timeline
          setActiveContext?.("program");
          isPlaying ? transportPause() : transportPlay();
        }}
        onSeek={(time) => {
          if (clips.length === 0) return; // Disable seeking when timeline is empty
          seek(time);
        }}
        formatTime={formatTime}
        onStepBack={() => {
          if (clips.length === 0) return; // Disable frame stepping when timeline is empty
          seek(Math.max(0, currentTime - step));
        }}
        onStepForward={() => {
          if (clips.length === 0) return; // Disable frame stepping when timeline is empty
          seek(Math.min(duration, currentTime + step));
        }}
        leftActions={
          <div className="relative" ref={speedMenuRef}>
            <button onClick={() => setSpeedMenuOpen((o) => !o)} className="flex items-center gap-1 px-2 h-6 rounded text-[10px] font-medium text-text-muted hover:text-text-primary hover:bg-white/6 transition-colors" title="Playback speed" aria-expanded={speedMenuOpen}>
              <span className="max-w-18 truncate">{playbackSpeed}x</span>
              <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />
            </button>
            {speedMenuOpen && (
              <div className="absolute bottom-full right-0 z-50 mb-1 w-[140px] overflow-hidden rounded-lg border border-border bg-surface py-1 text-text-primary shadow-xl" role="listbox">
                <div className="px-1">
                  {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => (
                    <button
                      key={speed}
                      type="button"
                      role="option"
                      aria-selected={playbackSpeed === speed}
                      className={cn("flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-text-primary hover:bg-surface-raised", playbackSpeed === speed && "bg-surface-raised")}
                      onClick={() => {
                        setSpeed(speed);
                        setSpeedMenuOpen(false);
                      }}
                    >
                      <span className="flex w-5 shrink-0 justify-center">{playbackSpeed === speed ? <Check className="h-3.5 w-3.5 text-accent" /> : null}</span>
                      <span className="min-w-0 flex-1 truncate">{speed}x</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        }
        rightActions={
          <>
            {/* Aspect menu */}
            <div className="relative shrink-0" ref={aspectMenuRef}>
              <button onClick={() => setAspectMenuOpen((o) => !o)} className="flex items-center gap-1 px-2 h-6 rounded text-[10px] font-medium text-text-muted hover:text-text-primary hover:bg-white/6 transition-colors" title="Preview aspect ratio" aria-expanded={aspectMenuOpen}>
                <span className="max-w-18 truncate">{PREVIEW_ASPECT_LABEL[previewAspectPreset]}</span>
                <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />
              </button>
              {aspectMenuOpen && (
                <div className="absolute bottom-full right-0 z-50 mb-1 w-[200px] overflow-hidden rounded-lg border border-border bg-surface py-1 text-text-primary shadow-xl" role="listbox">
                  <div className="px-1">
                    <AspectMenuRow preset="original" selected={previewAspectPreset} onSelect={selectAspectPreset} icon={<PreviewAspectShapeIcon widthOverHeight={canvasWidth / Math.max(1, canvasHeight)} />} />
                  </div>
                  <div className="my-1 h-px bg-border" />
                  <div className="px-1">
                    {(["16:9", "9:16", "1:1", "4:5"] as const).map((p) => (
                      <AspectMenuRow key={p} preset={p} selected={previewAspectPreset} onSelect={selectAspectPreset} icon={<PreviewAspectShapeIcon widthOverHeight={PREVIEW_ASPECT_RATIO[p]!} />} />
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button onClick={() => setPreviewScaleMode((m) => (m === "fit" ? "fill" : "fit"))} className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-white/6 transition-colors" title={previewScaleMode === "fit" ? "Fill preview — scale to cover (crop edges)" : "Fit preview — show entire frame (letterbox)"} aria-label={previewScaleMode === "fit" ? "Fill preview" : "Fit preview"}>
              {previewScaleMode === "fit" ? <Expand className="w-3.5 h-3.5" /> : <Shrink className="w-3.5 h-3.5" />}
            </button>

            <div className="w-px h-4 bg-white/10 mx-1" />

            <button onClick={() => setIsMuted((m) => !m)} className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-white/6 transition-colors" title={isMuted ? "Unmute" : "Mute"} aria-label={isMuted ? "Unmute audio" : "Mute audio"}>
              {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>

            <input type="range" min="0" max="100" value={volume} onChange={(e) => setVolume(Number(e.target.value))} className="w-16 h-1 bg-surface-raised rounded-full appearance-none outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent cursor-pointer" />
          </>
        }
      />
    </div>
  );
};

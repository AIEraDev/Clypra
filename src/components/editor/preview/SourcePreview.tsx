import React, { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { Plus, X, RotateCcw, Play, Loader2 } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useUIStore } from "@/store/uiStore";
import { usePreviewMode } from "@/hooks/usePreviewMode";
import { getInsertIndexForNewTrack, useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import { createClipFromAsset } from "@/lib/timeline/timelineClip";
import { getActiveSessionOrNull } from "@/core/runtime/ProjectSession";
import { autoAdaptSequenceForFirstVisualClip } from "@/lib/sequence/sequenceAutoAspect";
import { DEFAULT_PLACEMENT_POLICY, resolveAddToTimelinePlacement, resolveDefaultFitModeForAsset } from "@/lib/timeline/placementPolicy";
import { getPlaybackClock } from "@/hooks/usePlaybackClock";
import type { SourcePlaybackContext } from "@/core/playback";
import type { MediaAsset } from "@/types";
import { GPUPreview } from "./GPUPreview";
import { PreviewTransport } from "./PreviewTransport";
import { createTextClip } from "@/lib/text/textClip";
import { TextSourcePreview } from "./TextSourcePreview";
import { useEffectsStore } from "@/features/text-effects/store/effectsStore";
import { useStickersStore } from "@/features/stickers/store/stickersStore";
import { VideoSourcePreview } from "./VideoSourcePreview";
import { AudioSourcePreview } from "./AudioSourcePreview";
import { ImageSourcePreview } from "./ImageSourcePreview";
import { StickerSourcePreview, type StickerSourcePreviewHandle } from "./StickerSourcePreview";

const isExternalOrDataUrl = (value: string) => value.startsWith("data:") || value.startsWith("http") || value.startsWith("asset://");

// GPU preview for scrubbing only (precise frame-accurate seeking)
// Use HTML5 video for playback (hardware decode, buffering, smooth playback)
const USE_GPU_PREVIEW = false;

export const SourcePreview: React.FC = () => {
  const { sourceAsset, sourceTextPreset, sourceInPoint, sourceOutPoint, markSourceIn, markSourceOut } = useUIStore();
  const { exitSourceMode } = usePreviewMode();
  const { tracks, clips, addClip, addTrack, insertTrackAt, getTimelineEndTime } = useTimelineStore();
  const { project, updateProject, addMediaAsset } = useProjectStore();
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const lottiePlayerRef = useRef<StickerSourcePreviewHandle>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [useGPU, setUseGPU] = useState(USE_GPU_PREVIEW && sourceAsset?.type === "video");
  const [gpuFailed, setGpuFailed] = useState(false);
  const sourceCtxRef = useRef<SourcePlaybackContext | null>(null);

  const [lottieData, setLottieData] = useState<object | null>(null);
  const [lottieError, setLottieError] = useState<string | null>(null);

  // Get source context from active session and bind media element
  useEffect(() => {
    if (sourceAsset?.type === "text") return;

    const session = getActiveSessionOrNull();
    const ctx = session?.sourceContext;
    if (!ctx) return;

    sourceCtxRef.current = ctx;

    // Bind appropriate media element
    if (sourceAsset?.type === "audio" && audioRef.current) {
      ctx.setMediaElement(audioRef.current);
    } else if (sourceAsset?.type === "video" && videoRef.current && !useGPU) {
      ctx.setMediaElement(videoRef.current);
    } else {
      ctx.setMediaElement(null);
    }

    // Subscribe to context state
    const unsub = ctx.subscribe((snapshot) => {
      setCurrentTime(snapshot.time);
      setDuration(snapshot.duration);
      setIsPlaying(snapshot.state === "playing");
    });

    return () => {
      unsub();
      ctx.setMediaElement(null);
      sourceCtxRef.current = null;
    };
  }, [sourceAsset?.id, sourceAsset?.type, useGPU]);

  // Virtual clock for text preview
  useEffect(() => {
    if (sourceAsset?.type !== "text") return;

    setDuration(3.0);
    setCurrentTime(0);
    setIsPlaying(false);
  }, [sourceAsset?.id, sourceAsset?.type]);

  useEffect(() => {
    if (sourceAsset?.type !== "text") return;
    if (!isPlaying) return;

    const timer = setInterval(() => {
      setCurrentTime((prev) => {
        if (prev >= 3.0) {
          setIsPlaying(false);
          return 3.0;
        }
        const next = prev + 0.016; // ~16ms steps
        if (next >= 3.0) {
          setIsPlaying(false);
          return 3.0;
        }
        return next;
      });
    }, 16);

    return () => clearInterval(timer);
  }, [isPlaying, sourceAsset?.type]);

  // Load Lottie JSON from cache on demand
  useEffect(() => {
    const isLottie = sourceAsset && sourceAsset.type === "image" && (sourceAsset.stickerFormat === "lottie" || sourceAsset.path?.endsWith(".json"));
    const lottiePath = sourceAsset?.stickerAnimationPath || sourceAsset?.path;
    if (!isLottie || !lottiePath) {
      setLottieData(null);
      setLottieError(null);
      return;
    }

    let active = true;
    setLottieError(null);

    import("@/features/stickers/cache/stickerCache")
      .then(({ stickerCacheManager }) => {
        return stickerCacheManager.readLottieJson(lottiePath);
      })
      .then((data) => {
        if (active) {
          setLottieData(data);
        }
      })
      .catch((err) => {
        if (active) {
          console.error("[SourcePreview] Failed to load Lottie JSON:", err);
          setLottieError("Failed to load Lottie preview");
        }
      });

    return () => {
      active = false;
    };
  }, [sourceAsset?.id, sourceAsset?.path, sourceAsset?.stickerAnimationPath, sourceAsset?.stickerFormat]);

  // Compute Lottie animation duration
  const lottieDuration = useMemo(() => {
    if (!lottieData) return 0;
    const { op, ip, fr } = lottieData as any;
    if (typeof op === "number" && typeof fr === "number" && fr > 0) {
      return (op - (ip || 0)) / fr;
    }
    return 3.0;
  }, [lottieData]);

  // Reset when asset changes
  useEffect(() => {
    setUseGPU(USE_GPU_PREVIEW && sourceAsset?.type === "video");
    setGpuFailed(false);
    const isLottie = sourceAsset && sourceAsset.type === "image" && (sourceAsset.stickerFormat === "lottie" || sourceAsset.path?.endsWith(".json"));
    if (isLottie) {
      setDuration(lottieDuration);
      setCurrentTime(0);
      setIsPlaying(true);
    }
  }, [sourceAsset?.id, lottieDuration, sourceAsset?.stickerFormat]);

  // Set duration when Lottie duration changes
  useEffect(() => {
    const isLottie = sourceAsset && sourceAsset.type === "image" && (sourceAsset.stickerFormat === "lottie" || sourceAsset.path?.endsWith(".json"));
    if (isLottie) {
      setDuration(lottieDuration);
    }
  }, [lottieDuration, sourceAsset?.path, sourceAsset?.stickerFormat]);

  // Keep Lottie play state in sync with isPlaying
  useEffect(() => {
    if (!lottiePlayerRef.current) return;
    if (isPlaying) {
      lottiePlayerRef.current.play();
    } else {
      lottiePlayerRef.current.pause();
    }
  }, [isPlaying]);

  // Virtual clock for Lottie playback
  useEffect(() => {
    const isLottie = sourceAsset && sourceAsset.type === "image" && (sourceAsset.stickerFormat === "lottie" || sourceAsset.path?.endsWith(".json"));
    if (!isLottie) return;
    if (!isPlaying) return;

    const timer = setInterval(() => {
      setCurrentTime((prev) => {
        if (prev >= duration) {
          if (lottiePlayerRef.current) {
            lottiePlayerRef.current.goToFrame(0);
          }
          return 0;
        }
        const next = prev + 0.016;
        if (next >= duration) {
          if (lottiePlayerRef.current) {
            lottiePlayerRef.current.goToFrame(0);
          }
          return 0;
        }

        if (lottiePlayerRef.current && lottieData) {
          const { fr } = lottieData as any;
          const frameRate = fr || 30;
          lottiePlayerRef.current.goToFrame(next * frameRate);
        }

        return next;
      });
    }, 16);

    return () => clearInterval(timer);
  }, [isPlaying, duration, lottieData, sourceAsset?.id, sourceAsset?.path, sourceAsset?.stickerFormat]);

  const handleSeek = useCallback(
    (time: number) => {
      if (sourceAsset?.type === "text") {
        setCurrentTime(Math.max(0, Math.min(time, 3.0)));
        return;
      }
      const isLottie = sourceAsset && sourceAsset.type === "image" && (sourceAsset.stickerFormat === "lottie" || sourceAsset.path?.endsWith(".json"));
      if (isLottie) {
        const targetTime = Math.max(0, Math.min(time, duration));
        setCurrentTime(targetTime);
        if (lottiePlayerRef.current && lottieData) {
          const { fr } = lottieData as any;
          const frameRate = fr || 30;
          lottiePlayerRef.current.goToFrame(targetTime * frameRate);
        }
        return;
      }
      sourceCtxRef.current?.seek(time);
    },
    [sourceAsset?.type, sourceAsset?.path, sourceAsset?.stickerFormat, duration, lottieData],
  );

  const handlePlayPause = useCallback(() => {
    if (sourceAsset?.type === "text") {
      setIsPlaying((prev) => {
        const next = !prev;
        if (next && currentTime >= 3.0) {
          setCurrentTime(0);
        }
        return next;
      });
      return;
    }
    const isLottie = sourceAsset && sourceAsset.type === "image" && (sourceAsset.stickerFormat === "lottie" || sourceAsset.path?.endsWith(".json"));
    if (isLottie) {
      setIsPlaying((prev) => {
        const next = !prev;
        if (next && currentTime >= duration) {
          setCurrentTime(0);
          if (lottiePlayerRef.current) {
            lottiePlayerRef.current.goToFrame(0);
          }
        }
        return next;
      });
      return;
    }
    const ctx = sourceCtxRef.current;
    if (!ctx) return;
    if (useGPU) {
      setIsPlaying((prev) => !prev);
    } else {
      const state = ctx.getState();
      if (state === "playing") {
        ctx.pause();
      } else {
        ctx.play();
      }
    }
  }, [useGPU, sourceAsset?.type, sourceAsset?.path, sourceAsset?.stickerFormat, currentTime, duration]);

  const handlePlayMarkedRegion = useCallback(() => {
    sourceCtxRef.current?.playMarkedRegion();
  }, []);

  const handleClearMarks = useCallback(() => {
    markSourceIn(null);
    markSourceOut(null);
    sourceCtxRef.current?.clearMarks();
  }, [markSourceIn, markSourceOut]);

  const handleMarkIn = useCallback(() => {
    const t = sourceCtxRef.current?.getTime() ?? 0;
    markSourceIn(t);
    sourceCtxRef.current?.setInPoint(t);
  }, [markSourceIn]);

  const handleMarkOut = useCallback(() => {
    const t = sourceCtxRef.current?.getTime() ?? 0;
    markSourceOut(t);
    sourceCtxRef.current?.setOutPoint(t);
  }, [markSourceOut]);

  if (!sourceAsset) return null;

  const handleAddToTimeline = async () => {
    if (!project) return;

    // Handle synthetic text assets differently
    if (sourceAsset.type === "text") {
      const sequenceEndTime = getTimelineEndTime();
      const playheadTime = getPlaybackClock().time;
      const startTime = Math.max(0, Math.min(playheadTime, Math.max(0, sequenceEndTime)));
      const firstUnlockedTextTrack = tracks.find((track) => track.type === "text" && !track.locked);
      let targetTrackId: string | null = firstUnlockedTextTrack?.id ?? null;

      if (!targetTrackId) {
        const latestTracks = useTimelineStore.getState().tracks;
        const insertIndex = getInsertIndexForNewTrack(latestTracks, "text");
        targetTrackId = insertTrackAt("text", insertIndex);
      }

      if (!targetTrackId) return;

      const preset = sourceTextPreset;

      // Extract styleId for text effects
      // IMPORTANT: The preset is the full TextEffectDefinition that was fetched during preview.
      // The preview flow (EffectGrid.handlePreview) calls TextEffectsApi.getFullEffect() which:
      //   1. Fetches the definition from the API
      //   2. Caches it in TextEffectsApi._effectsCache
      //   3. Syncs it to effectsStore.definitions[id]
      // This ensures the rasterizer will find the cached definition when rendering the clip.
      const styleId = preset.presetType === "effect" ? preset.id : undefined;

      // FIX (FINDING-016): Verify effect definition is loaded before creating clip
      // Get the effect definition for accurate bounding box calculation
      const effectDefinition = styleId ? useEffectsStore.getState().definitions[styleId] : undefined;

      // If styleId is present but definition is missing, show error
      if (styleId && !effectDefinition) {
        console.error("[SourcePreview] Text effect definition not loaded:", styleId);
        useProjectStore.getState().showToast("Failed to load text effect. Please try again.", "error");
        return;
      }

      // When adding a text effect, we should NOT override individual properties
      // because the rasterizer uses TextEffectBuilder.fromDefinition() which
      // reads all styling from the cached effect definition.
      // However, if individual properties (stroke, shadow, background) are explicitly
      // set to undefined/null, the rasterizer DISABLES them (see lines 395-416 in rasterizer.ts).
      //
      // Solution: Only pass properties that are truly user overrides, not properties
      // extracted from the effect definition itself.
      const textClip = createTextClip({
        trackId: targetTrackId,
        startTime,
        duration: 3.0,
        text: preset.text || "CLYPRA",
        canvasWidth: project?.canvasWidth || 1920,
        canvasHeight: project?.canvasHeight || 1080,
        // When styleId is present, the engine will use the effect definition for ALL styling
        // Do NOT pass fontFamily, color, fontSize, fontWeight, fontStyle, stroke, shadow, background
        // from the preset - let the definition be the source of truth
        styleId,
        templateId: preset.presetType === "template" ? preset.id : undefined,
        // Only fontSize is needed to calculate the text bounding box
        fontSize: preset.fontSize || (styleId ? 96 : 48),
        // Pass the effect definition for accurate bounding box calculation
        effectDefinition,
      });

      addClip(textClip);
      exitSourceMode(); // Auto-switches transport context

      return;
    }

    let mediaAsset = sourceAsset as MediaAsset;

    // Special handling for stickers added from preview
    if (mediaAsset.id.startsWith("sticker-")) {
      const stickerId = mediaAsset.id.replace("sticker-", "");
      const cachedSticker = useStickersStore.getState().getCachedSticker(stickerId);
      // Stickers are Lottie-only, use thumbnail for timeline
      if (cachedSticker && cachedSticker.localImagePath) {
        const appCache = await import("@tauri-apps/api/path").then((m) => m.appCacheDir());
        const absoluteImagePath = await import("@tauri-apps/api/path").then((m) => m.join(appCache, cachedSticker.localImagePath!));
        mediaAsset = {
          ...mediaAsset,
          path: absoluteImagePath,
        };
      }
    }

    const placement = resolveAddToTimelinePlacement({
      asset: mediaAsset,
      tracks,
      clips,
      playheadTime: getPlaybackClock().time,
      sequenceEndTime: getTimelineEndTime(),
    });
    let targetTrackId = placement.targetTrackId;
    if (placement.shouldCreateTrack || !targetTrackId) {
      const latestTracks = useTimelineStore.getState().tracks;
      const insertIndex = getInsertIndexForNewTrack(latestTracks, placement.trackType);
      targetTrackId = insertTrackAt(placement.trackType, insertIndex);
    }
    if (!targetTrackId) return;

    if (DEFAULT_PLACEMENT_POLICY.autoAdaptSequenceForFirstVisualClip) {
      autoAdaptSequenceForFirstVisualClip({
        project,
        existingClips: clips,
        asset: mediaAsset,
        updateProject,
      });
    }
    const nextProject = useProjectStore.getState().project;

    const newClip = createClipFromAsset({
      asset: mediaAsset,
      trackId: targetTrackId,
      startTime: placement.startTime,
      width: nextProject?.canvasWidth ?? project.canvasWidth,
      height: nextProject?.canvasHeight ?? project.canvasHeight,
      fitMode: resolveDefaultFitModeForAsset(mediaAsset),
    });

    const trimIn = sourceInPoint ?? 0;
    const trimOut = sourceOutPoint ?? newClip.duration;
    newClip.trimIn = trimIn;
    newClip.trimOut = trimOut;
    newClip.duration = trimOut - trimIn;

    // Only add to media assets if it's NOT from the audio library
    // Audio library items (id starts with "audio-library-") should only exist as clips
    if (!mediaAsset.id.startsWith("audio-library-")) {
      addMediaAsset(mediaAsset);
    }
    addClip(newClip);
    exitSourceMode(); // Auto-switches transport context
  };

  /** Format time as HH:MM:SS:FF (frame-accurate) */
  const formatTC = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const f = Math.floor((seconds % 1) * 30);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
  };

  // Calculate marked duration
  const markedDuration = sourceInPoint !== null && sourceOutPoint !== null ? sourceOutPoint - sourceInPoint : null;
  const hasMarks = sourceInPoint !== null || sourceOutPoint !== null;
  const hasCompleteMarks = sourceInPoint !== null && sourceOutPoint !== null;

  const sourcePath = sourceAsset.path ? (isExternalOrDataUrl(sourceAsset.path) ? sourceAsset.path : convertFileSrc(sourceAsset.path)) : "";
  const mediaLabel = sourceAsset.type === "video" ? "video" : sourceAsset.type === "audio" ? "audio" : sourceAsset.type === "text" ? "text" : "image";

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-bg">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 h-10 shrink-0 border-b border-border/50">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-semibold text-text-primary tracking-tight">Previewing</span>
          <span className="text-[13px] text-text-muted">— {mediaLabel}</span>
        </div>
        <button
          onClick={() => {
            exitSourceMode(); // Auto-switches transport context
          }}
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/6 transition-colors text-text-muted hover:text-text-primary"
          title="Close (Esc)"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ── Mark Info Bar ──────────────────────────────────────────── */}
      {hasMarks && (
        <div className="px-4 py-2 bg-surface/50 border-b border-border/30 flex items-center justify-between text-[11px]">
          <div className="flex items-center gap-4">
            {sourceInPoint !== null && (
              <div className="flex items-center gap-1.5">
                <span className="text-text-muted">In:</span>
                <span className="font-mono text-accent">{formatTC(sourceInPoint)}</span>
              </div>
            )}
            {sourceOutPoint !== null && (
              <div className="flex items-center gap-1.5">
                <span className="text-text-muted">Out:</span>
                <span className="font-mono text-accent">{formatTC(sourceOutPoint)}</span>
              </div>
            )}
            {hasCompleteMarks && markedDuration !== null && (
              <div className="flex items-center gap-1.5">
                <span className="text-text-muted">Duration:</span>
                <span className="font-mono text-text-primary font-semibold">{markedDuration.toFixed(2)}s</span>
              </div>
            )}
          </div>
          <button onClick={handleClearMarks} className="flex items-center gap-1 px-2 h-5 rounded text-[10px] font-medium text-text-muted hover:text-text-primary hover:bg-white/6 transition-colors" title="Clear marks">
            <RotateCcw className="w-3 h-3" />
            Clear
          </button>
        </div>
      )}

      {/* ── Video Area ─────────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center overflow-hidden checkerboard relative">
        <div className="w-full h-full flex items-center justify-center relative z-10">
          {sourceAsset.type === "video" ? (
            <VideoSourcePreview
              videoRef={videoRef}
              src={sourcePath}
              currentTime={currentTime}
              isPlaying={isPlaying}
              width={sourceAsset.width || 1920}
              height={sourceAsset.height || 1080}
              duration={sourceAsset.duration}
              useGPU={useGPU}
              gpuFailed={gpuFailed}
              onTimeUpdate={(time: number) => {
                setCurrentTime(time);
                if (time >= duration && duration > 0) {
                  setIsPlaying(false);
                }
              }}
            />
          ) : sourceAsset.type === "image" ? (
            sourceAsset.stickerFormat === "lottie" || sourceAsset.path?.endsWith(".json") ? (
              lottieError ? (
                <div className="text-red-400 text-xs">{lottieError}</div>
              ) : lottieData ? (
                <StickerSourcePreview ref={lottiePlayerRef} lottieData={lottieData} isPlaying={isPlaying} loop={true} speed={1} className="max-w-full max-h-full" />
              ) : (
                <div className="text-text-muted text-xs flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading preview...
                </div>
              )
            ) : (
              <ImageSourcePreview src={sourcePath} alt={sourceAsset.name} />
            )
          ) : sourceAsset.type === "text" ? (
            <TextSourcePreview preset={sourceTextPreset} />
          ) : (
            <AudioSourcePreview audioRef={audioRef} src={sourcePath} isPlaying={isPlaying} coverImage={sourceAsset.coverArt} audioName={sourceAsset.name} />
          )}
        </div>
      </div>

      {sourceAsset.type === "text" ? (
        <div className="flex items-center justify-between h-10 px-4 shrink-0 border-t border-border/30 bg-surface/30">
          <span className="text-[11px] text-text-muted font-medium select-none">Procedural Style Preview</span>
          <button onClick={handleAddToTimeline} className="flex items-center gap-1.5 px-3 h-7 rounded text-[11px] font-semibold bg-accent hover:bg-accent-soft active:scale-95 text-white cursor-pointer transition-all duration-150 shadow-sm" title="Add text to timeline">
            <Plus className="w-3.5 h-3.5" />
            Add to Timeline
          </button>
        </div>
      ) : (
        <PreviewTransport
          currentTime={currentTime}
          duration={duration}
          isPlaying={isPlaying}
          onPlayPause={handlePlayPause}
          onSeek={handleSeek}
          formatTime={formatTC}
          inPoint={sourceInPoint}
          outPoint={sourceOutPoint}
          rightActions={
            <>
              <button onClick={handleMarkIn} className={`px-2 h-6 rounded text-[10px] font-medium transition-colors cursor-pointer ${sourceInPoint !== null && Math.abs(currentTime - sourceInPoint) < 0.1 ? "bg-accent text-white" : "text-text-muted hover:text-text-primary hover:bg-white/6"}`} title="Mark In (I)">
                IN
              </button>
              <button onClick={handleMarkOut} className={`px-2 h-6 rounded text-[10px] font-medium transition-colors cursor-pointer ${sourceOutPoint !== null && Math.abs(currentTime - sourceOutPoint) < 0.1 ? "bg-accent text-white" : "text-text-muted hover:text-text-primary hover:bg-white/6"}`} title="Mark Out (O)">
                OUT
              </button>
              {hasCompleteMarks && (
                <button onClick={handlePlayMarkedRegion} className="flex items-center gap-1 px-2 h-6 rounded text-[10px] font-medium text-text-muted hover:text-text-primary hover:bg-white/6 transition-colors cursor-pointer" title="Play marked region">
                  <Play className="w-3 h-3" />
                  Play
                </button>
              )}
              <div className="w-px h-4 bg-white/10 mx-1" />
              {(() => {
                const isAddEnabled = sourceAsset.type === "image" || hasCompleteMarks;
                return (
                  <button onClick={handleAddToTimeline} disabled={!isAddEnabled} className={`flex items-center gap-1 px-2.5 h-6 rounded text-[10px] font-semibold transition-all ${isAddEnabled ? "bg-accent hover:bg-accent-soft text-white cursor-pointer" : "bg-text-muted/70 hover:bg-text-muted/90 text-white cursor-not-allowed"}`} title={isAddEnabled ? (sourceAsset.type === "image" ? "Add to Timeline" : `Add ${markedDuration?.toFixed(2)}s to Timeline`) : "Add to Track"}>
                    <Plus className="w-3 h-3" />
                    Add
                  </button>
                );
              })()}
            </>
          }
        />
      )}
    </div>
  );
};

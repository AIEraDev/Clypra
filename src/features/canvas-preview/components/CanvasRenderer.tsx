/**
 * CanvasRenderer - Main component that orchestrates the canvas-based video preview system
 */

import React, { useRef, useEffect, useMemo, useCallback, useState } from "react";
import { useTimelineStore } from "../../timeline/store/timelineStore";
import { VideoPool } from "../utils/VideoPool";
import { FrameResolver } from "../utils/FrameResolver";
import { SeekManager } from "../utils/SeekManager";
import { RenderEngine } from "../utils/RenderEngine";
import { FrameCache } from "../utils/FrameCache";
import { TimelineClock } from "../utils/TimelineClock";
import type { ActiveClip } from "../types/core";

export interface CanvasRendererProps {
  baseWidth: number;
  baseHeight: number;
  className?: string;
}

/**
 * CanvasRenderer component - Orchestrates multi-clip video preview rendering
 * Integrates with Timeline Engine v1 via Zustand store
 * Wrapped with React.memo to prevent unnecessary re-renders
 */
const CanvasRendererComponent: React.FC<CanvasRendererProps> = ({ baseWidth, baseHeight, className }) => {
  // State for dynamic canvas dimensions based on video aspect ratio
  const [canvasDimensions, setCanvasDimensions] = useState({ width: baseWidth, height: baseHeight });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const videoPoolRef = useRef<VideoPool | null>(null);
  const frameCacheRef = useRef<FrameCache | null>(null);
  const seekManagerRef = useRef<SeekManager | null>(null);
  const timelineClockRef = useRef<TimelineClock | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const lastRenderedTimeRef = useRef<number>(0);
  const isRenderingRef = useRef<boolean>(false);
  const pendingRenderAbortRef = useRef<(() => void) | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const activeClipsRef = useRef<ActiveClip[]>([]);
  const needsAudioStartRef = useRef<boolean>(false);

  const clips = useTimelineStore((state) => state.clips);
  const tracks = useTimelineStore((state) => state.tracks);
  const playhead = useTimelineStore((state) => state.playhead);
  const isPlaying = useTimelineStore((state) => state.isPlaying);
  const duration = useTimelineStore((state) => state.duration);

  const frameResolver = useMemo(() => {
    return new FrameResolver(clips, tracks);
  }, [clips, tracks]);

  // Detect video aspect ratio and update canvas dimensions (CapCut-style adaptive preview)
  useEffect(() => {
    if (clips.size === 0) {
      setCanvasDimensions({ width: baseWidth, height: baseHeight });
      return;
    }

    const firstClip = Array.from(clips.values()).find((clip) => clip.type === "video");
    if (!firstClip || !videoPoolRef.current) {
      return;
    }

    const detectAspectRatio = async () => {
      if (!firstClip) return; // TypeScript guard

      try {
        const video = await videoPoolRef.current!.getVideo(firstClip.sourceMediaPath);

        // Wait for metadata if not ready
        if (!video.videoWidth || !video.videoHeight) {
          await new Promise<void>((resolve, reject) => {
            const onLoaded = () => {
              video.removeEventListener("loadedmetadata", onLoaded);
              video.removeEventListener("error", onError);
              resolve();
            };
            const onError = () => {
              video.removeEventListener("loadedmetadata", onLoaded);
              video.removeEventListener("error", onError);
              reject(new Error("Video load error"));
            };
            video.addEventListener("loadedmetadata", onLoaded);
            video.addEventListener("error", onError);
            // Timeout after 5 seconds
            setTimeout(() => {
              video.removeEventListener("loadedmetadata", onLoaded);
              video.removeEventListener("error", onError);
              reject(new Error("Timeout waiting for video metadata"));
            }, 5000);
          });
        }

        const videoWidth = video.videoWidth;
        const videoHeight = video.videoHeight;

        if (videoWidth && videoHeight && videoWidth > 0 && videoHeight > 0) {
          const videoAspect = videoWidth / videoHeight;
          const baseAspect = baseWidth / baseHeight;

          let newWidth: number;
          let newHeight: number;

          if (videoAspect > baseAspect) {
            newWidth = baseWidth;
            newHeight = Math.round(baseWidth / videoAspect);
          } else {
            newHeight = baseHeight;
            newWidth = Math.round(baseHeight * videoAspect);
          }

          // Ensure dimensions are valid
          newWidth = Math.max(100, newWidth);
          newHeight = Math.max(100, newHeight);

          // Only update if dimensions actually changed (prevents unnecessary remounts)
          setCanvasDimensions((prev) => {
            if (prev.width === newWidth && prev.height === newHeight) {
              return prev; // No change, return same object to prevent re-render
            }
            return { width: newWidth, height: newHeight };
          });
        }
      } catch (error) {
        console.warn("Aspect ratio detection failed, using base dimensions:", error);
      }
    };

    detectAspectRatio();
  }, [clips, baseWidth, baseHeight]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const { width, height } = canvasDimensions;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    // Let CSS handle the display size via the className
    canvas.style.width = "";
    canvas.style.height = "";

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      console.error("Failed to get 2D context");
      return;
    }

    ctx.scale(dpr, dpr);
    contextRef.current = ctx;

    videoPoolRef.current = new VideoPool(10); // Max 10 videos
    frameCacheRef.current = new FrameCache(100); // Max 100 frames
    seekManagerRef.current = new SeekManager();
    timelineClockRef.current = new TimelineClock();

    // Initialize Web Audio API for audio playback
    try {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch (error) {
      console.error("Failed to initialize AudioContext:", error);
    }

    const handleContextLost = (event: Event) => {
      event.preventDefault();
      console.error("Canvas context lost");
    };

    const handleContextRestored = () => {
      console.log("Canvas context restored");
      const newCtx = canvas.getContext("2d");
      if (newCtx) {
        newCtx.scale(dpr, dpr);
        contextRef.current = newCtx;
        // Re-render current frame
        if (!isPlaying) {
          renderFrame(playhead);
        }
      }
    };

    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", handleContextRestored);

    return () => {
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored);

      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      videoPoolRef.current?.dispose();
      frameCacheRef.current?.dispose();
      seekManagerRef.current?.dispose();

      // Clean up audio context and elements
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }

      // Clean up audio elements
      audioElementsRef.current.forEach((audio) => {
        audio.pause();
        audio.src = "";
      });
      audioElementsRef.current.clear();

      // Clean up last rendered frame
      if (lastRenderedFrameRef.current) {
        lastRenderedFrameRef.current.close();
        lastRenderedFrameRef.current = null;
      }
    };
  }, [canvasDimensions]);

  useEffect(() => {
    if (frameCacheRef.current) {
      frameCacheRef.current.updateStateHash(clips, tracks);
      frameCacheRef.current.invalidate();
    }

    // Re-render current frame if not playing
    if (!isPlaying) {
      renderFrame(playhead);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips, tracks]);

  useEffect(() => {
    if (!isPlaying) {
      renderFrame(playhead);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playhead, isPlaying]);

  // Render initial frame when video is loaded (on mount)
  useEffect(() => {
    if (clips.size > 0 && !isPlaying) {
      renderFrame(playhead);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips.size]);

  useEffect(() => {
    // Set playback mode on SeekManager
    if (seekManagerRef.current) {
      seekManagerRef.current.setPlaybackMode(isPlaying);
    }

    if (isPlaying) {
      // Set flag to start audio once we have clips in renderFrame
      needsAudioStartRef.current = true;
      startRAFLoop();
    } else {
      needsAudioStartRef.current = false;
      stopRAFLoop();
      // Stop audio playback
      if (activeClipsRef.current.length > 0) {
        stopAudioPlayback(activeClipsRef.current);
      }
    }

    return () => {
      needsAudioStartRef.current = false;
      stopRAFLoop();
      if (activeClipsRef.current.length > 0) {
        stopAudioPlayback(activeClipsRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  /**
   * Setup separate audio element for a clip
   * CRITICAL: Audio elements are SEPARATE from video elements used for frames
   * Video elements stay PAUSED at all times
   */
  const setupAudioElement = (sourceMediaPath: string): HTMLAudioElement | null => {
    // Check if we already have an audio element for this source
    let audioElement = audioElementsRef.current.get(sourceMediaPath);

    if (!audioElement) {
      try {
        // Create separate audio element (NOT the video element!)
        audioElement = new Audio(sourceMediaPath);
        audioElement.preload = "auto";
        audioElement.volume = 1.0;

        // Disable preservesPitch to reduce audio artifacts during playback rate changes
        if ("preservesPitch" in audioElement) {
          (audioElement as any).preservesPitch = false;
        } else if ("mozPreservesPitch" in audioElement) {
          (audioElement as any).mozPreservesPitch = false;
        } else if ("webkitPreservesPitch" in audioElement) {
          (audioElement as any).webkitPreservesPitch = false;
        }

        // Cache the audio element
        audioElementsRef.current.set(sourceMediaPath, audioElement);
      } catch (error) {
        console.error("Failed to create audio element:", error);
        return null;
      }
    }

    return audioElement;
  };

  /**
   * Start audio playback for active clips
   * Uses SEPARATE audio elements, NOT the video elements
   *
   * CRITICAL:
   * - Video elements MUST stay paused at all times
   * - Audio is started ONCE and never seeked during playback
   * - All audio elements start simultaneously for perfect sync
   */
  const startAudioPlayback = async (clips: ActiveClip[]) => {
    if (clips.length === 0) {
      return;
    }

    // Get current timeline time to calculate correct audio start position
    const currentTimelineTime = useTimelineStore.getState().playhead;

    // Prepare all audio elements first
    const audioPromises = clips.map(async (clip) => {
      // CRITICAL: Ensure video element is PAUSED
      if (!clip.videoElement.paused) {
        clip.videoElement.pause();
      }

      const audioElement = setupAudioElement(clip.sourceMediaPath);

      if (audioElement) {
        // Calculate correct audio position based on timeline time
        // Formula: audioTime = sourceStart + (timelineTime - clipStartTime)
        const timeIntoClip = currentTimelineTime - clip.startTime;
        const audioStartTime = clip.sourceStart + timeIntoClip;

        // Seek audio to correct position (ONLY ONCE at start)
        audioElement.currentTime = audioStartTime;
        audioElement.playbackRate = 1.0; // Ensure normal playback rate

        // Wait for audio to be ready
        await new Promise<void>((resolve) => {
          if (audioElement.readyState >= 2) {
            resolve();
          } else {
            const onCanPlay = () => {
              audioElement.removeEventListener("canplay", onCanPlay);
              resolve();
            };
            audioElement.addEventListener("canplay", onCanPlay);
            setTimeout(() => {
              audioElement.removeEventListener("canplay", onCanPlay);
              resolve();
            }, 500);
          }
        });

        return audioElement;
      }
      return null;
    });

    // Wait for all audio to be ready
    const readyAudioElements = await Promise.all(audioPromises);

    // Start ALL audio elements simultaneously in the same frame
    await Promise.all(
      readyAudioElements
        .filter((audio): audio is HTMLAudioElement => audio !== null)
        .map((audio) =>
          audio.play().catch((error) => {
            console.error("Failed to start audio:", error);
          }),
        ),
    );
  };

  /**
   * Stop audio playback
   * Pauses separate audio elements
   */
  const stopAudioPlayback = (clips: ActiveClip[]) => {
    // Pause all audio elements
    for (const clip of clips) {
      const audioElement = audioElementsRef.current.get(clip.sourceMediaPath);
      if (audioElement && !audioElement.paused) {
        audioElement.pause();
      }
    }
  };

  /**
   * Start RAF loop for playback
   *
   * CRITICAL:
   * - Audio is the master clock during playback
   * - Timeline Clock uses AudioContext.currentTime as authority
   * - Video chases audio, never the other way around
   */
  const startRAFLoop = () => {
    // Cancel any pending RAF before starting new loop
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    // Configure timeline clock to use audio context as time source
    if (timelineClockRef.current && audioContextRef.current) {
      timelineClockRef.current.setAudioContext(audioContextRef.current);
    }

    // Start or resume the timeline clock
    if (timelineClockRef.current) {
      if (timelineClockRef.current.isClockRunning()) {
        timelineClockRef.current.resume();
      } else {
        timelineClockRef.current.start(playhead);
      }
    }

    const loop = () => {
      // Get authoritative time from Timeline Clock
      // (which uses AudioContext.currentTime when available)
      const currentTime = timelineClockRef.current?.getCurrentTime() ?? playhead;

      // Stop if we reached the end
      const maxTime = useTimelineStore.getState().duration;
      if (currentTime >= maxTime) {
        // Set playhead to exact end position
        useTimelineStore.getState().setPlayhead(maxTime);
        useTimelineStore.getState().setIsPlaying(false);
        // Render final frame
        renderFrame(maxTime);
        return;
      }

      // Update store with current time
      useTimelineStore.getState().setPlayhead(currentTime);

      // Render frame at current time
      // Video elements will seek to match audio time
      renderFrame(currentTime);

      rafIdRef.current = requestAnimationFrame(loop);
    };

    rafIdRef.current = requestAnimationFrame(loop);
  };

  /**
   * Stop RAF loop
   */
  const stopRAFLoop = () => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    // Pause the timeline clock
    if (timelineClockRef.current) {
      const pausedTime = timelineClockRef.current.pause();
      useTimelineStore.getState().setPlayhead(pausedTime);
    }
  };

  /**
   * Render a frame at the specified timeline time
   */
  const renderFrame = useCallback(
    async (timelineTime: number) => {
      if (!contextRef.current || !videoPoolRef.current || !frameCacheRef.current || !seekManagerRef.current) {
        return;
      }

      if (pendingRenderAbortRef.current) {
        pendingRenderAbortRef.current();
        pendingRenderAbortRef.current = null;
      }

      if (isRenderingRef.current) {
        // A render is already in progress, it will be cancelled by the abort signal
        console.debug("Cancelling in-progress render for new request");
      }

      isRenderingRef.current = true;

      // Create abort signal for this render operation
      let aborted = false;
      pendingRenderAbortRef.current = () => {
        aborted = true;
      };

      const ctx = contextRef.current;
      const videoPool = videoPoolRef.current;
      const frameCache = frameCacheRef.current;
      const seekManager = seekManagerRef.current;
      const renderEngine = new RenderEngine(ctx, canvasDimensions.width, canvasDimensions.height);

      const clampedTimelineTime = Math.max(0, Math.min(timelineTime, duration));

      try {
        // Resolve active clips first to see if we have any work to do
        const activeClipsWithoutVideo = frameResolver.getActiveClips(clampedTimelineTime);

        // If we have clips, we should try to load them even if pool is initializing
        if (videoPool.isInitializingPool() && activeClipsWithoutVideo.length === 0) {
          renderEngine.drawInitializingMessage();
          isRenderingRef.current = false;
          pendingRenderAbortRef.current = null;
          return;
        }

        // Check if render was cancelled
        if (aborted) {
          isRenderingRef.current = false;
          return;
        }

        const hasSeekingVideos = seekManager.hasSeekingVideos();

        if (hasSeekingVideos && lastRenderedFrameRef.current) {
          ctx.drawImage(lastRenderedFrameRef.current, 0, 0, canvasDimensions.width, canvasDimensions.height);
          renderEngine.drawLoadingIndicator("Seeking...");
          isRenderingRef.current = false;
          pendingRenderAbortRef.current = null;
          return;
        }

        // Note: Don't return early for hasLoadingVideos since metadata loading is now fast
        // and the actual video loading is handled later in the render pipeline

        // SKIP cache during playback to ensure fresh frames every tick
        const isPlayingNow = useTimelineStore.getState().isPlaying;
        const cachedFrame = !isPlayingNow ? frameCache.get(clampedTimelineTime) : null;

        if (cachedFrame) {
          // Check if render was cancelled before drawing
          if (aborted) {
            isRenderingRef.current = false;
            return;
          }

          ctx.drawImage(cachedFrame.bitmap, 0, 0, canvasDimensions.width, canvasDimensions.height);

          if (lastRenderedFrameRef.current) {
            lastRenderedFrameRef.current.close();
          }
          lastRenderedFrameRef.current = await createImageBitmap(canvasRef.current!);

          const frameAccuracy = Math.abs(clampedTimelineTime - lastRenderedTimeRef.current);
          lastRenderedTimeRef.current = clampedTimelineTime;

          if (frameAccuracy > 0.033) {
            console.warn("Frame accuracy drift detected:", {
              targetTime: clampedTimelineTime,
              lastRenderedTime: lastRenderedTimeRef.current,
              accuracy: frameAccuracy,
              threshold: 0.033,
            });
          }

          isRenderingRef.current = false;
          pendingRenderAbortRef.current = null;
          return;
        }

        // Check if render was cancelled
        if (aborted) {
          isRenderingRef.current = false;
          return;
        }

        if (activeClipsWithoutVideo.length === 0) {
          // Check if render was cancelled before clearing canvas
          if (aborted) {
            isRenderingRef.current = false;
            return;
          }

          renderEngine.drawNoClipsMessage();

          if (lastRenderedFrameRef.current) {
            lastRenderedFrameRef.current.close();
          }
          lastRenderedFrameRef.current = await createImageBitmap(canvasRef.current!);

          isRenderingRef.current = false;
          pendingRenderAbortRef.current = null;
          return;
        }

        const validClips = activeClipsWithoutVideo.filter((clip) => {
          if (!clip.id || !clip.sourceMediaPath || clip.duration <= 0) {
            console.warn("Invalid clip data, skipping:", {
              clipId: clip.id,
              sourcePath: clip.sourceMediaPath,
              duration: clip.duration,
            });
            return false;
          }
          return true;
        });

        if (validClips.length === 0) {
          // Check if render was cancelled
          if (aborted) {
            isRenderingRef.current = false;
            return;
          }

          // All clips invalid, display message
          renderEngine.drawNoClipsMessage();

          if (lastRenderedFrameRef.current) {
            lastRenderedFrameRef.current.close();
          }
          lastRenderedFrameRef.current = await createImageBitmap(canvasRef.current!);

          isRenderingRef.current = false;
          pendingRenderAbortRef.current = null;
          return;
        }

        // Check if render was cancelled before loading videos
        if (aborted) {
          isRenderingRef.current = false;
          return;
        }

        const clipsWithVideos = await Promise.all(
          validClips.map(async (clip) => {
            try {
              const video = await videoPool.getVideo(clip.sourceMediaPath);
              return { ...clip, videoElement: video } as ActiveClip;
            } catch (error) {
              console.error("Failed to load video for clip:", {
                clipId: clip.id,
                sourcePath: clip.sourceMediaPath,
                error: error instanceof Error ? error.message : "Unknown error",
              });

              const fileName = clip.sourceMediaPath.split("/").pop() || clip.sourceMediaPath;

              // Display error message on canvas
              renderEngine.drawVideoLoadError(fileName);

              return null;
            }
          }),
        );

        // Check if render was cancelled after loading videos
        if (aborted) {
          isRenderingRef.current = false;
          return;
        }

        // Filter out failed video loads
        const successfulClips = clipsWithVideos.filter((clip): clip is ActiveClip => clip !== null);

        if (successfulClips.length === 0) {
          // Check if render was cancelled
          if (aborted) {
            isRenderingRef.current = false;
            return;
          }

          // All videos failed to load, error already displayed
          isRenderingRef.current = false;
          pendingRenderAbortRef.current = null;
          return;
        }

        // Update active clips ref for audio management
        activeClipsRef.current = successfulClips;

        // Start audio if needed (first frame after play button pressed)
        if (needsAudioStartRef.current && successfulClips.length > 0) {
          needsAudioStartRef.current = false; // Only start once
          startAudioPlayback(successfulClips).catch((error) => {
            console.error("Failed to start audio:", error);
          });
        }

        for (const clip of successfulClips) {
          seekManager.cancelPendingSeeks(clip.videoElement);
        }

        // Check if render was cancelled before seeking
        if (aborted) {
          isRenderingRef.current = false;
          return;
        }

        await Promise.all(successfulClips.map((clip) => seekManager.seekIfNeeded(clip.videoElement, clip.clipTime)));

        // Check if render was cancelled after seeking
        if (aborted) {
          isRenderingRef.current = false;
          return;
        }

        renderEngine.renderFrame(successfulClips);

        const frameAccuracy = Math.abs(clampedTimelineTime - lastRenderedTimeRef.current);
        lastRenderedTimeRef.current = clampedTimelineTime;

        for (const clip of successfulClips) {
          const videoTimeAccuracy = Math.abs(clip.videoElement.currentTime - clip.clipTime);

          if (videoTimeAccuracy > 0.033) {
            console.warn("Video seek accuracy issue:", {
              clipId: clip.id,
              targetClipTime: clip.clipTime,
              actualVideoTime: clip.videoElement.currentTime,
              accuracy: videoTimeAccuracy,
              threshold: 0.033,
            });
          }
        }

        if (frameAccuracy > 0.033) {
          console.warn("Frame accuracy drift detected:", {
            targetTime: clampedTimelineTime,
            lastRenderedTime: lastRenderedTimeRef.current - frameAccuracy,
            accuracy: frameAccuracy,
            threshold: 0.033,
          });
        }

        // Check if render was cancelled before caching
        if (aborted) {
          isRenderingRef.current = false;
          return;
        }

        // Skip caching during playback to save memory and CPU
        if (!isPlayingNow) {
          const bitmap = await createImageBitmap(canvasRef.current!);
          frameCache.set(clampedTimelineTime, bitmap);
        }

        if (lastRenderedFrameRef.current) {
          lastRenderedFrameRef.current.close();
        }
        lastRenderedFrameRef.current = await createImageBitmap(canvasRef.current!);

        isRenderingRef.current = false;
        pendingRenderAbortRef.current = null;
      } catch (error) {
        console.error("Failed to render frame:", {
          timelineTime: clampedTimelineTime,
          error: error instanceof Error ? error.message : "Unknown error",
        });

        // Check if render was cancelled
        if (aborted) {
          isRenderingRef.current = false;
          return;
        }

        // Display error state (only if context is available)
        if (ctx && ctx.fillText) {
          ctx.fillStyle = "#000000";
          ctx.fillRect(0, 0, canvasDimensions.width, canvasDimensions.height);
          ctx.fillStyle = "#ff0000";
          ctx.font = "16px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText("Render error", canvasDimensions.width / 2, canvasDimensions.height / 2);
        }

        isRenderingRef.current = false;
        pendingRenderAbortRef.current = null;
      }
    },
    [frameResolver, canvasDimensions, duration],
  );

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <canvas
        ref={canvasRef}
        className={className}
        style={{
          maxWidth: "100%",
          maxHeight: "100%",
          aspectRatio: `${canvasDimensions.width}/${canvasDimensions.height}`,
        }}
        data-testid="canvas-renderer"
      />
    </div>
  );
};

export const CanvasRenderer = React.memo(CanvasRendererComponent);

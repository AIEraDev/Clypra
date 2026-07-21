/**
 * GPU-Accelerated Preview Component
 *
 * Replaces HTML5 video playback with GPU texture rendering for:
 * - Frame-perfect playback control
 * - Zero latency frame stepping
 * - Smooth looping (textures persist)
 * - Lower CPU usage
 *
 * Usage:
 * ```typescript
 * <GPUPreview
 *   videoPath="/path/to/video.mp4"
 *   currentTime={1.5}
 *   isPlaying={true}
 *   width={1920}
 *   height={1080}
 *   onTimeUpdate={(time) => setCurrentTime(time)}
 * />
 * ```
 */

import { useEffect, useRef, useState } from "react";
import { GPUTextureCache } from "@/lib/cache/gpuTextureCache";
import { globalGPUCache } from "@/lib/cache/globalGPUCache";
import { performanceMetrics } from "@/lib/utils/performanceMetrics";
import { generateId } from "@/lib/utils/id";
import { normalizePathForTauriInvoke } from "@/lib/platform/tauri";
import { t } from "@/i18n";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

interface HTML5VideoFallbackProps {
  videoPath: string;
  currentTime: number;
  isPlaying: boolean;
  width: number;
  height: number;
  onTimeUpdate?: (time: number) => void;
  className?: string;
}

function HTML5VideoFallback({ videoPath, currentTime, isPlaying, onTimeUpdate, className }: HTML5VideoFallbackProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Sync isPlaying state
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [isPlaying]);

  // Sync currentTime when not playing (scrubbing)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || isPlaying) return;

    if (Math.abs(video.currentTime - currentTime) > 0.1) {
      video.currentTime = currentTime;
    }
  }, [currentTime, isPlaying]);

  // Handle time update when playing
  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || !isPlaying || !onTimeUpdate) return;
    onTimeUpdate(video.currentTime);
  };

  return (
    <div className="relative w-full h-full flex items-center justify-center bg-black">
      <video
        ref={videoRef}
        src={videoPath}
        className={className}
        onTimeUpdate={handleTimeUpdate}
        playsInline
        muted
        style={{
          maxWidth: "100%",
          maxHeight: "100%",
          width: "auto",
          height: "auto",
          objectFit: "contain",
        }}
      />
    </div>
  );
}

export interface GPUPreviewProps {
  videoPath: string;
  currentTime: number;
  isPlaying: boolean;
  width: number;
  height: number;
  duration: number; // Pass duration from parent instead of fetching
  frameRate?: number;
  onTimeUpdate?: (time: number) => void;
  className?: string;
}

export function GPUPreview({ videoPath, currentTime, isPlaying, width, height, duration, frameRate = 30, onTimeUpdate, className }: GPUPreviewProps) {
  if (!isTauri) {
    return <HTML5VideoFallback videoPath={videoPath} currentTime={currentTime} isPlaying={isPlaying} width={width} height={height} onTimeUpdate={onTimeUpdate} className={className} />;
  }

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gpuCacheRef = useRef<GPUTextureCache | null>(null);
  const [useGPUCache, setUseGPUCache] = useState(false);
  const playbackTimerRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);
  const componentId = useRef(generateId("gpu-preview")).current;

  // Try to use global GPU cache first
  const useGlobalCache = typeof window !== "undefined" && globalGPUCache.isInitialized();

  // ── Initialize GPU cache ────────────────────────────────────────
  useEffect(() => {
    // Wait for canvas to be mounted
    if (!canvasRef.current) {
      return;
    }

    // Skip if already initialized
    if (gpuCacheRef.current) {
      return;
    }

    // Try to use global GPU cache first
    if (useGlobalCache) {
      const globalCache = globalGPUCache.getCache();
      if (globalCache) {
        gpuCacheRef.current = globalCache;
        setUseGPUCache(true);
        return;
      }
    }

    // Initialize local GPU cache
    try {
      gpuCacheRef.current = new GPUTextureCache(canvasRef.current);
      setUseGPUCache(true);
    } catch (err) {
      setUseGPUCache(false);
    }

    return () => {
      // Only dispose local cache, not global cache
      if (!useGlobalCache && gpuCacheRef.current) {
        gpuCacheRef.current.dispose();
        gpuCacheRef.current = null;
      }

      // Unregister from global cache
      if (useGlobalCache) {
        globalGPUCache.unregisterViewport(componentId);
      }
    };
  }, []); // Run once on mount

  // ── Render frame at current time ────────────────────────────────
  const renderFrame = async (time: number) => {
    if (!gpuCacheRef.current || !canvasRef.current) return;

    const cache = gpuCacheRef.current;
    const canvas = canvasRef.current;

    // Update canvas size if needed
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const textureKey = `${videoPath}:${time.toFixed(3)}:${width}x${height}`;

    // Check if texture already exists
    if (cache.hasTexture(textureKey)) {
      // Render from GPU cache (instant!)
      const renderStart = performance.now();
      cache.clear();
      cache.renderTexture(textureKey, 0, 0, width, height);
      const renderTime = performance.now() - renderStart;
      performanceMetrics.trackTextureRender(renderTime);
      return;
    }

    // Decode and upload new frame
    try {
      const decodeStart = performance.now();
      const { invoke } = await import("@tauri-apps/api/core");

      const rgbaBytes = await invoke<number[]>("decode_frame_gpu", {
        videoPath: normalizePathForTauriInvoke(videoPath),
        timeSecs: time,
        width,
        height,
      });

      const decodeTime = performance.now() - decodeStart;
      const uploadStart = performance.now();

      // Upload to GPU texture cache (once)
      cache.uploadTexture(textureKey, new Uint8Array(rgbaBytes), width, height);

      const uploadTime = performance.now() - uploadStart;

      // Track performance metrics
      performanceMetrics.trackTextureUpload(uploadTime);
      performanceMetrics.trackScrubLatency(decodeTime + uploadTime);

      // Render from GPU cache
      const renderStart = performance.now();
      cache.clear();
      cache.renderTexture(textureKey, 0, 0, width, height);
      const renderTime = performance.now() - renderStart;
      performanceMetrics.trackTextureRender(renderTime);

      // Register viewport with global cache
      if (useGlobalCache) {
        globalGPUCache.registerViewport(componentId, new Set([textureKey]), 10);
      }
    } catch (err) {
      // Frame render failed silently
    }
  };

  // ── Render current frame ────────────────────────────────────────
  useEffect(() => {
    if (!useGPUCache || !gpuCacheRef.current) return;

    renderFrame(currentTime);
  }, [currentTime, useGPUCache, videoPath, width, height]);

  // ── Playback loop ───────────────────────────────────────────────
  useEffect(() => {
    if (!isPlaying || !useGPUCache || duration === 0) {
      if (playbackTimerRef.current !== null) {
        cancelAnimationFrame(playbackTimerRef.current);
        playbackTimerRef.current = null;
      }
      return;
    }

    let animationFrameId: number;
    let lastTime = performance.now();

    const playbackLoop = () => {
      const now = performance.now();
      const deltaTime = (now - lastTime) / 1000; // Convert to seconds
      lastTime = now;

      // Calculate next frame time
      const nextTime = currentTime + deltaTime;

      // Loop back to start if reached end
      if (nextTime >= duration) {
        if (onTimeUpdate) {
          onTimeUpdate(0);
        }
      } else {
        if (onTimeUpdate) {
          onTimeUpdate(nextTime);
        }
      }

      // Continue playback loop
      animationFrameId = requestAnimationFrame(playbackLoop);
    };

    // Start playback loop
    animationFrameId = requestAnimationFrame(playbackLoop);

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [isPlaying, currentTime, duration, useGPUCache, onTimeUpdate]);

  return (
    <div className="relative w-full h-full flex items-center justify-center bg-black">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className={className}
        style={{
          maxWidth: "100%",
          maxHeight: "100%",
          width: "auto",
          height: "auto",
          objectFit: "contain",
        }}
      />

      {!useGPUCache && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-white text-sm">
          <div className="text-center">
            <div>{t("editor.preview.gpu.initializing")}</div>
            <div className="text-xs mt-2 opacity-60">{t("editor.preview.gpu.consoleDetails")}</div>
          </div>
        </div>
      )}
    </div>
  );
}

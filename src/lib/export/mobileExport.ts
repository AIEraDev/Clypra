import { evaluateTimelineSceneCached, clearEvaluationCache } from "../../core/evaluation/evaluator";
import { createPixiExportCompositor, destroyPixiExportCompositor, renderFrameWithPixi } from "./pixiExportRenderer";
import { VideoElementPool } from "../../core/resources/VideoElementPool";
import { getResourceCache } from "../../core/resources/ResourceCache";
import { resolveClipSourceTime } from "../../core/timeline/sourceTime";
import { getActiveAudioClips } from "../../core/timeline/audioClips";
import { platform } from "../../core/platform";
import type { VideoExportConfig, VideoExportResult } from "./videoExport";
import { MobileExportEncoder } from "./mobileExportEncoder";
import { ALL_TRANSITIONS } from "@clypra-studio/engine";
import { resolveTransitionDefinition, mergeTransitionParams } from "../../core/render/utils/transitionResolver";
import { t } from "@/i18n";

export async function exportVideoMobile(config: VideoExportConfig): Promise<VideoExportResult> {
  const { clips, tracks, transitions = [], assets, project, epoch, startTime, endTime, outputPath, frameRate = project?.frameRate || 30, width = project?.canvasWidth || 1920, height = project?.canvasHeight || 1080, onProgress, onSessionReady } = config;

  const startTimeMs = Date.now();
  const totalFrames = Math.round((endTime - startTime) * frameRate);
  const duration = endTime - startTime;

  if (totalFrames === 0) {
    throw new Error(t("system.export.noFrames"));
  }

  const audioClips = getActiveAudioClips(clips, tracks, assets, startTime, endTime);
  const hasAudio = audioClips.length > 0;

  // ─── Phase 1: Mixed Audio Rendering (OfflineAudioContext) ───
  let mixedAudioBuffer: AudioBuffer | null = null;
  if (hasAudio) {
    if (onProgress) {
      onProgress({ progress: 0, status: t("system.export.mobile.mixingAudio") });
    }
    
    try {
      const sampleRate = 48000;
      const ctx = new OfflineAudioContext(2, Math.max(1, sampleRate * duration), sampleRate);
      
      for (const clip of audioClips) {
        try {
          const resolvedPath = clip.path.startsWith("asset://") ? clip.path : platform.convertFileSrc(clip.path);
          const response = await fetch(resolvedPath);
          const arrayBuffer = await response.arrayBuffer();
          const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
          
          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          
          const gainNode = ctx.createGain();
          source.connect(gainNode).connect(ctx.destination);
          
          // Configure fades & volume
          gainNode.gain.setValueAtTime(0, clip.startTime);
          const startVal = clip.fadeIn && clip.fadeIn > 0 ? 0 : clip.volume;
          gainNode.gain.setValueAtTime(startVal, clip.startTime);
          
          if (clip.fadeIn && clip.fadeIn > 0) {
            gainNode.gain.linearRampToValueAtTime(clip.volume, clip.startTime + clip.fadeIn);
          }
          
          if (clip.fadeOut && clip.fadeOut > 0) {
            const fadeOutStart = clip.startTime + clip.duration - clip.fadeOut;
            gainNode.gain.setValueAtTime(clip.volume, fadeOutStart);
            gainNode.gain.linearRampToValueAtTime(0, clip.startTime + clip.duration);
          } else {
            gainNode.gain.setValueAtTime(clip.volume, clip.startTime + clip.duration);
          }
          
          source.start(clip.startTime, clip.trimIn, clip.duration);
        } catch (clipErr) {
          console.warn("[MobileExport] Failed to decode audio clip:", clip.path, clipErr);
        }
      }
      
      mixedAudioBuffer = await ctx.startRendering();
    } catch (err) {
      console.error("[MobileExport] Audio mixing failed:", err);
    }
  }

  // ─── Initialize WebCodecs Mobile Encoder ───
  const encoder = new MobileExportEncoder(width, height, frameRate, hasAudio && !!mixedAudioBuffer);

  // ─── Set up video pool and compositor ───
  const videoPool = new VideoElementPool({
    maxConcurrent: 5, // Conservative limit for mobile devices to prevent Out of Memory
    debug: false,
  });

  const pixiHandle = createPixiExportCompositor(width, height);
  await pixiHandle.compositor.waitForReady();

  // Pre-warm shaders
  if (transitions && transitions.length > 0) {
    for (const transition of transitions) {
      const resolved = resolveTransitionDefinition(transition.type, ALL_TRANSITIONS, transition.renderer);
      if (resolved) {
        const runtimeParams = {
          easing: transition.easing,
          ...(transition.metadata?.params as Record<string, any> || {}),
        };
        const mergedParams = mergeTransitionParams(resolved.definition.params, resolved.params, runtimeParams);
        pixiHandle.compositor.prewarmTransitionShader(resolved.definition, mergedParams);
      }
    }
  }

  let cancelled = false;
  let isCancelled = false;
  let isPaused = false;

  if (onSessionReady) {
    onSessionReady(async () => {
      isCancelled = true;
    });
  }

  // Monitor visibility state to handle backgrounding gracefully
  const handleVisibilityChange = () => {
    if (document.hidden) {
      isPaused = true;
      console.log("[MobileExport] Export paused due to app backgrounding");
    } else {
      isPaused = false;
      console.log("[MobileExport] Export resumed");
    }
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);

  let completedFrames = 0;

  try {
    // ─── Render and encode video frames ───
    for (let i = 0; i < totalFrames; i++) {
      // Pause loop if backgrounded
      while (isPaused && !isCancelled) {
        await new Promise(r => setTimeout(r, 200));
      }

      if (isCancelled) {
        cancelled = true;
        break;
      }

      const time = startTime + (i / frameRate);
      const frameVideoElements: HTMLVideoElement[] = [];

      try {
        const videoElements = new Map<string, HTMLVideoElement>();

        for (const clip of clips) {
          const asset = assets.find((a) => a.id === clip.mediaId);
          if (asset?.type !== "video") continue;

          const clipEnd = clip.startTime + clip.duration;
          if (time < clip.startTime || time >= clipEnd) continue;

          const { sourceTime } = resolveClipSourceTime(clip, time, {
            clampToRange: true,
            frameRate,
          });

          const resolvedPath = asset.path.startsWith("asset://") ? asset.path : platform.convertFileSrc(asset.path);
          const key = `${clip.id}-${clip.mediaId}`;
          try {
            const video = await videoPool.acquire(resolvedPath, sourceTime);
            videoElements.set(key, video);
            frameVideoElements.push(video);
          } catch (error) {
            for (const vid of frameVideoElements) {
              videoPool.releaseElement(vid);
            }
            throw new Error(t("system.export.videoAcquireFailed", { time, error: String(error) }));
          }
        }

        const scene = evaluateTimelineSceneCached(time, clips, tracks, assets, project, epoch, transitions);
        const imageData = await renderFrameWithPixi(pixiHandle, scene, videoElements);

        const timestampUs = Math.round((i / frameRate) * 1_000_000);
        await encoder.encodeFrame(imageData, timestampUs);
        completedFrames++;

        if (onProgress) {
          const progressPercent = Math.round((completedFrames / totalFrames) * 85); // 85% is video encoding, remaining is audio/sharing
          onProgress({
            progress: progressPercent,
            status: t("system.export.mobile.encodingVideoFrame", {
              current: completedFrames,
              total: totalFrames,
            }),
          });
        }
      } finally {
        for (const video of frameVideoElements) {
          videoPool.releaseElement(video);
        }
      }
    }

    if (!cancelled) {
      // ─── Phase 2: Encode Audio ───
      if (mixedAudioBuffer) {
        if (onProgress) {
          onProgress({ progress: 90, status: t("system.export.mobile.encodingAudio") });
        }
        await encoder.encodeAudioBuffer(mixedAudioBuffer);
      }

      // ─── Phase 3: Finalize MP4 Muxing ───
      if (onProgress) {
        onProgress({ progress: 95, status: t("system.export.mobile.finalizingMP4") });
      }
      const outputBlob = await encoder.finalize();

      // ─── Phase 4: Share / Save to Native Device ───
      if (onProgress) {
        onProgress({ progress: 98, status: t("system.export.mobile.sharingVideo") });
      }
      const filename = `${project?.name || t("system.export.defaultMobileName")}-${Date.now()}.mp4`;
      const sharedPath = await platform.saveAndShareVideo(outputBlob, filename);

      return {
        outputPath: sharedPath,
        totalFrames: completedFrames,
        totalTimeMs: Date.now() - startTimeMs,
        avgTimePerFrameMs: completedFrames > 0 ? (Date.now() - startTimeMs) / completedFrames : 0,
        cancelled: false,
      };
    }
  } catch (err) {
    console.error("[MobileExport] Export loop failed:", err);
    throw err;
  } finally {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    videoPool.clear();
    destroyPixiExportCompositor(pixiHandle);
    
    try {
      getResourceCache().clear();
      clearEvaluationCache();
    } catch (e) {
      console.warn("[MobileExport] Failed to clear post-export caches:", e);
    }
  }

  return {
    outputPath: "",
    totalFrames: completedFrames,
    totalTimeMs: Date.now() - startTimeMs,
    avgTimePerFrameMs: 0,
    cancelled: true,
  };
}

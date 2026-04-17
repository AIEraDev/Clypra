/**
 * Hook for generating filmstrip visualization from video files
 */

import { useEffect, useState, useRef } from "react";
import { VIDEO_CONFIG } from "../../../constants/config";
import type { FilmstripResult } from "../../../types";

const { FPS, FILMSTRIP } = VIDEO_CONFIG;

/**
 */
function drawFrameContain(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, dx: number, dy: number, dWidth: number, dHeight: number) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  ctx.fillStyle = "#0b0b0c";
  ctx.fillRect(dx, dy, dWidth, dHeight);
  if (!vw || !vh) return;
  const scale = Math.min(dWidth / vw, dHeight / vh);
  const w = vw * scale;
  const h = vh * scale;
  const x = dx + (dWidth - w) / 2;
  const y = dy + (dHeight - h) / 2;
  ctx.drawImage(video, x, y, w, h);
}

/**
 * Generate filmstrip of video thumbnails for timeline visualization
 * Cancels in-progress generation when source changes
 *
 * @param videoUrl - Path to video file (null to disable)
 * @param durationSec - Duration of the clip in seconds
 * @returns Filmstrip data URL and loading state
 */
export function useFilmstrip(videoUrl: string | null, durationSec: number): FilmstripResult {
  const [stripUrl, setStripUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    if (!videoUrl || durationSec <= 0) {
      setStripUrl(null);
      return;
    }

    // Create new abort controller for this request
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.src = videoUrl;

    const frames = Math.min(FILMSTRIP.MAX_FRAMES, Math.max(FILMSTRIP.MIN_FRAMES, Math.ceil((durationSec * FPS) / 8)));
    const cellW = FILMSTRIP.CELL_WIDTH;
    const cellH = FILMSTRIP.CELL_HEIGHT;
    const w = frames * cellW;
    const h = cellH;

    const seekTo = (t: number) =>
      new Promise<void>((resolve, reject) => {
        const onSeeked = () => {
          v.removeEventListener("seeked", onSeeked);
          v.removeEventListener("error", onErr);
          resolve();
        };
        const onErr = () => {
          v.removeEventListener("seeked", onSeeked);
          v.removeEventListener("error", onErr);
          reject(new Error("seek"));
        };
        v.addEventListener("seeked", onSeeked, { once: true });
        v.addEventListener("error", onErr, { once: true });
        v.currentTime = t;
      });

    void (async () => {
      try {
        await new Promise<void>((resolve, reject) => {
          v.onloadedmetadata = () => resolve();
          v.onerror = () => reject(new Error("meta"));
        });

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          setStripUrl(null);
          return;
        }

        const denom = Math.max(1, frames - 1);
        for (let i = 0; i < frames; i++) {
          if (abortController.signal.aborted) return;

          const t = Math.min((durationSec * i) / denom, Math.max(0, durationSec - 1 / FPS));
          await seekTo(t);
          drawFrameContain(ctx, v, i * cellW, 0, cellW, cellH);
          // Add separator lines between frames
          ctx.strokeStyle = "rgba(0,0,0,0.35)";
          ctx.lineWidth = 1;
          if (i > 0) {
            ctx.beginPath();
            ctx.moveTo(i * cellW + 0.5, 0);
            ctx.lineTo(i * cellW + 0.5, h);
            ctx.stroke();
          }
        }

        if (!abortController.signal.aborted) {
          setStripUrl(canvas.toDataURL("image/jpeg", FILMSTRIP.JPEG_QUALITY));
        }
      } catch {
        if (!abortController.signal.aborted) setStripUrl(null);
      } finally {
        if (!abortController.signal.aborted) setLoading(false);
      }
    })();

    return () => {
      abortController.abort();
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
      v.removeAttribute("src");
      v.load();
    };
  }, [videoUrl, durationSec]);

  return { stripUrl, loading };
}

import { invoke, Channel } from "@tauri-apps/api/core";
import type { DensityLevel, ThumbnailTile } from "../../types";
import { toNativePath } from "./pathConversion";

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Tauri `invoke` / FFmpeg need a native filesystem path.
 * Use centralized path conversion utility.
 * @deprecated Use toNativePath from pathConversion.ts directly
 */
export function normalizePathForTauriInvoke(inputPath: string): string {
  return toNativePath(inputPath);
}

// ─── Native FFmpeg Decoder Commands ───────────────────────────────────────
// All video operations use the native ffmpeg-next decoder

/**
 * Extract a single frame using the native decoder (fast path).
 * ~20-50ms first frame, ~3-15ms subsequent frames.
 * Returns base64-encoded WebP data URL.
 */
export async function decodeFrame(videoPath: string, timeSecs: number, width: number, height: number): Promise<string> {
  if (!isTauri()) {
    console.warn("[Tauri] decodeFrame bypassed: Non-Tauri environment.");
    return "data:image/png;base64,mockedDataURL";
  }
  return invoke<string>("decode_frame", {
    videoPath: toNativePath(videoPath),
    timeSecs,
    width,
    height,
  });
}

/**
 * Extract multiple frames using the native decoder with streaming, instead of sidecar FFmpeg. Much faster for batch extractions.
 */
export async function decodeFramesStreaming(videoPath: string, timestamps: number[], density: DensityLevel, width: number, height: number, duration: number, onTile: (tile: ThumbnailTile) => void): Promise<void> {
  if (!isTauri()) {
    console.warn("[Tauri] decodeFramesStreaming bypassed: Non-Tauri environment.");
    return;
  }
  const channel = new Channel<ThumbnailTile>();
  channel.onmessage = onTile;

  return invoke("decode_frames_streaming", {
    videoPath: toNativePath(videoPath),
    timestamps,
    density,
    width,
    height,
    duration,
    onTile: channel,
  });
}

/**
 * Release the native decoder for a video to free memory. Call this when a clip is removed from the project.
 */
export function releaseVideoDecoder(videoPath: string): void {
  if (!isTauri()) {
    console.warn("[Tauri] releaseVideoDecoder bypassed: Non-Tauri environment.");
    return;
  }
  invoke("release_video_decoder", {
    videoPath: toNativePath(videoPath),
  });
}

/**
 * Get render cache statistics (atlas hits, tier cache hits, decodes).
 * Useful for monitoring cache effectiveness.
 */
export async function getRenderCacheStats(): Promise<{
  atlas_hits: number;
  tier_cache_hits: number;
  decodes: number;
  total_requests: number;
}> {
  if (!isTauri()) {
    return {
      atlas_hits: 0,
      tier_cache_hits: 0,
      decodes: 0,
      total_requests: 0,
    };
  }
  return invoke("get_render_cache_stats");
}

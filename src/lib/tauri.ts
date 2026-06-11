import { invoke, Channel } from "@tauri-apps/api/core";
import type { DensityLevel, ThumbnailTile } from "../types";

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Tauri `invoke` / FFmpeg need a native filesystem path. The webview may use
 * `convertFileSrc` URLs (`asset://localhost/...`) or `file://` URLs elsewhere —
 * normalize back to a native FS path before calling Rust.
 */
export function normalizePathForTauriInvoke(inputPath: string): string {
  const p = inputPath.trim();

  // Handle http://asset.localhost/ or https://asset.localhost/
  if (
    p.startsWith("http://asset.localhost/") ||
    p.startsWith("https://asset.localhost/") ||
    p.startsWith("http://asset.localhost%2F") ||
    p.startsWith("https://asset.localhost%2F")
  ) {
    try {
      const url = new URL(p);
      let pathname = decodeURIComponent(url.pathname.replace(/\+/g, " "));
      if (pathname.startsWith("//")) {
        pathname = pathname.replace(/^\/+/, "/");
      }
      // Windows: http://asset.localhost/C:/... → /C:/...
      if (/^\/[A-Za-z]:/.test(pathname)) {
        pathname = pathname.slice(1);
      }
      return pathname;
    } catch {
      return p;
    }
  }

  // Handle asset://localhost/<encoded-path> produced by convertFileSrc on macOS/Linux
  if (p.startsWith("asset://localhost/") || p.startsWith("asset://localhost%2F")) {
    try {
      const url = new URL(p);
      let pathname = decodeURIComponent(url.pathname.replace(/\+/g, " "));
      if (pathname.startsWith("//")) {
        pathname = pathname.replace(/^\/+/, "/");
      }
      // Windows: asset://localhost/C:/... → /C:/...
      if (/^\/[A-Za-z]:/.test(pathname)) {
        pathname = pathname.slice(1);
      }
      return pathname;
    } catch {
      return p;
    }
  }

  // Handle asset://<encoded-path> (Windows variant: asset:///C:/...)
  if (p.startsWith("asset://")) {
    try {
      const url = new URL(p);
      let pathname = decodeURIComponent(url.pathname.replace(/\+/g, " "));
      if (pathname.startsWith("//")) {
        pathname = pathname.replace(/^\/+/, "/");
      }
      if (/^\/[A-Za-z]:/.test(pathname)) {
        pathname = pathname.slice(1);
      }
      return pathname;
    } catch {
      return p;
    }
  }

  if (!p.startsWith("file://")) {
    return p;
  }
  try {
    const url = new URL(p);
    let pathname = decodeURIComponent(url.pathname.replace(/\+/g, " "));
    if (pathname.startsWith("//")) {
      pathname = pathname.replace(/^\/+/, "/");
    }
    // Windows: file:///C:/Users/... → pathname often /C:/Users/...
    if (/^\/[A-Za-z]:/.test(pathname)) {
      pathname = pathname.slice(1);
    }
    return pathname;
  } catch {
    return p;
  }
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
    videoPath: normalizePathForTauriInvoke(videoPath),
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
    videoPath: normalizePathForTauriInvoke(videoPath),
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
    videoPath: normalizePathForTauriInvoke(videoPath),
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

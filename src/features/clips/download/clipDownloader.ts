/**
 * Clip Downloader
 *
 * Downloads a clip file from fileUrl, verifies its SHA-256 digest
 * using SubtleCrypto, writes it atomically (temp → rename) and
 * returns the absolute local path.
 *
 * Mirrors the stickerCache.downloadAndVerify pattern but as a
 * standalone utility (no React hooks — safe to call from async actions).
 *
 * Uses @tauri-apps/plugin-fs for atomic disk writes inside AppCache dir.
 */

import {
  BaseDirectory,
  mkdir,
  writeFile,
  rename,
  remove,
  exists,
} from "@tauri-apps/plugin-fs";
import { appCacheDir, join } from "@tauri-apps/api/path";
import {
  HashMismatchError,
  DownloadAbortedError,
  DiskFullError,
  type ClipItem,
} from "../types";

const CLIPS_CACHE_SUBDIR = "clips";

/** Compute SHA-256 of a Uint8Array and return lowercase hex string. */
async function sha256Hex(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Ensure the clips cache directory exists.
 * Safe to call multiple times — no-op if already created.
 */
async function ensureCacheDir(): Promise<void> {
  const dirExists = await exists(CLIPS_CACHE_SUBDIR, {
    baseDir: BaseDirectory.AppCache,
  });
  if (!dirExists) {
    await mkdir(CLIPS_CACHE_SUBDIR, {
      baseDir: BaseDirectory.AppCache,
      recursive: true,
    });
  }
}

/**
 * Write data atomically via a temp file + rename.
 * Cleans up the temp file on failure.
 */
async function writeAtomically(
  relativePath: string,
  data: Uint8Array,
): Promise<void> {
  const tempPath = `${relativePath}.tmp-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  try {
    await writeFile(tempPath, data, { baseDir: BaseDirectory.AppCache });
    await rename(tempPath, relativePath, {
      oldPathBaseDir: BaseDirectory.AppCache,
      newPathBaseDir: BaseDirectory.AppCache,
    });
  } catch (err) {
    // Clean up temp file — best effort
    try {
      await remove(tempPath, { baseDir: BaseDirectory.AppCache });
    } catch {
      // Preserve original error
    }
    // Surface disk-full as a typed error
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes("ENOSPC") ||
      msg.includes("QuotaExceeded") ||
      msg.includes("disk") ||
      msg.includes("space")
    ) {
      throw new DiskFullError(relativePath, err);
    }
    throw err;
  }
}

/**
 * Download a clip file, verify its SHA-256, write to AppCache atomically.
 *
 * @param item       The ClipItem from the catalog
 * @param signal     AbortController signal — throw DownloadAbortedError on abort
 * @param onProgress 0–100 progress callback
 * @returns          Absolute local filesystem path to the verified file
 */
export async function downloadClip(
  item: ClipItem,
  signal: AbortSignal,
  onProgress: (pct: number) => void,
): Promise<string> {
  await ensureCacheDir();

  // Relative path inside AppCache: clips/<sha256>.<ext>
  const ext = item.fileUrl.split(".").pop()?.split("?")[0] ?? "mp4";
  const relativePath = `${CLIPS_CACHE_SUBDIR}/${item.sha256}.${ext}`;

  // Check if already cached (content-addressed → sha256 is immutable key)
  const alreadyCached = await exists(relativePath, {
    baseDir: BaseDirectory.AppCache,
  });
  if (alreadyCached) {
    onProgress(100);
    const cacheBase = await appCacheDir();
    return await join(cacheBase, relativePath);
  }

  // ── Fetch ─────────────────────────────────────────────────────────────────
  let response: Response;
  try {
    response = await fetch(item.fileUrl, { signal });
  } catch (err) {
    if (signal.aborted) {
      throw new DownloadAbortedError(item.id);
    }
    throw err;
  }

  if (!response.ok) {
    throw new Error(
      `[ClipDownloader] HTTP ${response.status} downloading clip "${item.id}"`,
    );
  }

  // ── Stream into buffer with progress ─────────────────────────────────────
  const contentLength = Number(response.headers.get("Content-Length") ?? 0);
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error(`[ClipDownloader] No response body for clip "${item.id}"`);
  }

  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    if (signal.aborted) {
      reader.cancel();
      throw new DownloadAbortedError(item.id);
    }
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (contentLength > 0) {
      onProgress(Math.min(99, Math.round((received / contentLength) * 95)));
    }
  }

  // Merge chunks
  const totalBytes = chunks.reduce((n, c) => n + c.length, 0);
  const data = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }

  // ── SHA-256 verification ──────────────────────────────────────────────────
  onProgress(97);
  const digest = await sha256Hex(data);
  if (digest !== item.sha256) {
    throw new HashMismatchError(item.id);
  }

  // ── Atomic write ─────────────────────────────────────────────────────────
  onProgress(98);
  await writeAtomically(relativePath, data);
  onProgress(100);

  const cacheBase = await appCacheDir();
  return await join(cacheBase, relativePath);
}

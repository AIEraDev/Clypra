/**
 * Clip feature types (client-side)
 *
 * Mirrors the API's clip-manifest.v1.json schema.
 * MVP constraints:
 *   - Only CC0-1.0 and LicenseRef-Contributor-Grant allowed
 *   - license.releaseOnFile is always true (enforced server-side)
 *   - hasAlpha is always false (alpha clips out of MVP scope)
 *   - durationSec <= 15, bytes <= 15 MiB
 */

/** All valid browsing categories served by /clips */
export const CLIP_CATEGORIES = [
  "reaction",
  "applause",
  "shocked",
  "laughing",
  "football",
  "featured",
] as const;

export type ClipCategory = (typeof CLIP_CATEGORIES)[number];

/** MVP-allowed SPDX license identifiers */
export type ClipSpdx = "CC0-1.0" | "LicenseRef-Contributor-Grant";

/** Minimal license snapshot stored in the manifest index item */
export interface ClipLicense {
  /** SPDX identifier — only CC0-1.0 or contributor grant in MVP */
  spdx: ClipSpdx;
  /** Copyright holder / author name */
  author: string;
  /** Canonical source URL (optional for contributor-grant) */
  sourceUrl?: string;
  /**
   * Must be true for every shipped clip.
   * Clips showing identifiable people require a signed release even when CC0.
   */
  releaseOnFile: true;
}

/**
 * One item from the /clips API response.
 * This is what the client browses, downloads, and verifies.
 */
export interface ClipItem {
  id: string;
  title: string;
  category: ClipCategory | string;
  tags: string[];
  durationSec: number;
  width: number;
  height: number;
  /** WebP thumbnail for the grid tile */
  posterUrl: string;
  /** Small looping mp4/webm (<=480p, muted) for hover preview */
  previewUrl: string;
  /** Full-resolution file for download and export */
  fileUrl: string;
  /** SHA-256 hex of fileUrl content — verified client-side before import */
  sha256: string;
  /** File size in bytes */
  bytes: number;
  hasAudio: boolean;
  /** Always false in MVP (alpha clips not supported yet) */
  hasAlpha: false;
  license: ClipLicense;
  published?: boolean;
}

/** Download lifecycle states for a single clip */
export type ClipDownloadStatus =
  | "idle"
  | "downloading"
  | "ready"
  | "error";

export interface ClipDownloadState {
  clipId: string;
  status: ClipDownloadStatus;
  /** 0–100 progress percentage */
  progress: number;
  /** Absolute local path after a successful download */
  localPath?: string;
  /** Error message if status === "error" */
  error?: string;
}

/** Type guard — narrows unknown to ClipCategory */
export function isClipCategory(value: unknown): value is ClipCategory {
  return CLIP_CATEGORIES.includes(value as ClipCategory);
}

/** Type guard — narrows unknown to ClipItem (structural check) */
export function isClipItem(value: unknown): value is ClipItem {
  if (!value || typeof value !== "object") return false;
  const c = value as Partial<ClipItem>;
  return (
    typeof c.id === "string" &&
    typeof c.title === "string" &&
    typeof c.fileUrl === "string" &&
    typeof c.sha256 === "string" &&
    typeof c.bytes === "number" &&
    typeof c.license === "object" &&
    c.license !== null &&
    c.license.releaseOnFile === true
  );
}

/** Sentinel error types thrown by the downloader — caught in the add-to-timeline action */
export class HashMismatchError extends Error {
  readonly clipId: string;
  constructor(clipId: string) {
    super(`SHA-256 hash mismatch for clip "${clipId}". File may be corrupted.`);
    this.name = "HashMismatchError";
    this.clipId = clipId;
  }
}

export class DownloadAbortedError extends Error {
  readonly clipId: string;
  constructor(clipId: string) {
    super(`Download aborted for clip "${clipId}".`);
    this.name = "DownloadAbortedError";
    this.clipId = clipId;
  }
}

export class DiskFullError extends Error {
  readonly clipId: string;
  readonly underlyingCause?: unknown;
  constructor(clipId: string, underlyingCause?: unknown) {
    super(`Not enough disk space to download clip "${clipId}".`);
    this.name = "DiskFullError";
    this.clipId = clipId;
    this.underlyingCause = underlyingCause;
  }
}

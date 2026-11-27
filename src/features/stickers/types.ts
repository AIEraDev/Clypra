import type { StickerItem } from "@/features/stickers/api/stickersApi";

/** Formats that have an explicit placement and render-path decision. */
export type StickerFormat = "static" | "gif" | "lottie" | "animated-webp" | "apng";

export type StickerProviderId = "bundled" | "catalog" | "shapes" | "yours" | "giphy" | (string & {});

export interface StickerLicenseSnapshot {
  spdx: string;
  author: string;
  attributionRequired: boolean;
  sourceUrl?: string;
  attributionText?: string;
}

export type ShapeType =
  | "rectangle"
  | "rounded-rectangle"
  | "circle"
  | "ellipse"
  | "triangle"
  | "star"
  | "heart"
  | "arrow"
  | "line"
  | "speech-bubble"
  | "polygon";

/** Bounded, serializable parameters for generated shape stickers. */
export interface ShapeSpec {
  type: ShapeType;
  width: number;
  height: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  cornerRadius?: number;
  points?: number;
  innerRadius?: number;
  rotation?: number;
}

export interface StickerRef {
  providerId: StickerProviderId;
  itemId: string;
  /** SHA-256 of the complete stored primary artifact bytes. */
  contentHash?: string;
  /** Provider revision used to obtain the artifact. */
  revisionId?: string;
  format: StickerFormat;
  license?: StickerLicenseSnapshot;
  shape?: ShapeSpec;
}

export interface LottieStickerArtifact {
  kind: "lottie";
  format: "lottie";
  lottieData: Record<string, unknown>;
  localAnimationPath?: string;
  thumbnailPath?: string;
}

export type StaticStickerMimeType = "image/png" | "image/svg+xml" | "image/webp";

export interface StaticStickerArtifact {
  kind: "static";
  format: "static";
  localPath: string;
  mimeType: StaticStickerMimeType;
}

export interface AnimatedStickerArtifact {
  kind: "animated-image";
  format: "gif" | "animated-webp" | "apng";
  localPath: string;
  mimeType: "image/gif" | "image/webp" | "image/apng";
  durationMs?: number;
  frameCount?: number;
}

export interface ShapeStickerArtifact {
  kind: "shape";
  format: "lottie";
  shape: ShapeSpec;
  lottieData: Record<string, unknown>;
  localAnimationPath?: string;
  thumbnailPath?: string;
}

export interface ImportedStickerArtifact {
  kind: "imported";
  format: StickerFormat;
  localPath: string;
  mimeType: string;
}

export type StickerArtifact =
  | LottieStickerArtifact
  | StaticStickerArtifact
  | AnimatedStickerArtifact
  | ShapeStickerArtifact
  | ImportedStickerArtifact;

export type StickerUnavailableReason =
  | "storage-prohibited"
  | "unsupported-format"
  | "offline"
  | "missing";

export type StickerResolution =
  | { kind: "local"; artifact: StickerArtifact }
  | { kind: "unavailable"; reason: StickerUnavailableReason };

export interface StickerSection {
  id: string;
  label: string;
  providerId: StickerProviderId;
  itemCount?: number;
}

export interface StickerPage {
  items: StickerItem[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface StickerProvider {
  id: StickerProviderId;
  capabilities: {
    canStore: boolean;
    requiresNetwork: boolean;
    attributionRequired: boolean;
    formats: StickerFormat[];
  };
  sections(): Promise<StickerSection[]>;
  list(section: string, cursor?: string): Promise<StickerPage>;
  search(query: string, cursor?: string): Promise<StickerPage>;
  resolve(ref: StickerRef): Promise<StickerResolution>;
}

export function isStickerFormat(value: unknown): value is StickerFormat {
  return (
    value === "static" ||
    value === "gif" ||
    value === "lottie" ||
    value === "animated-webp" ||
    value === "apng"
  );
}

export function isStickerProviderId(value: unknown): value is StickerProviderId {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
}

export function isStickerRef(value: unknown): value is StickerRef {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StickerRef>;
  return (
    isStickerProviderId(candidate.providerId) &&
    typeof candidate.itemId === "string" &&
    candidate.itemId.length > 0 &&
    candidate.itemId.length <= 256 &&
    isStickerFormat(candidate.format)
  );
}

/**
 * Additive migration for projects written before StickerRef existed.
 * Starter ids are intentionally recognized by their stable bundled prefix so
 * this helper does not need to import the catalog or initialize the cache.
 */
export function migrateLegacyStickerRef(
  stickerSourceId: string | undefined,
  stickerFormat: "static" | "gif" | "lottie" | undefined,
): StickerRef | undefined {
  if (!stickerSourceId) return undefined;

  return {
    providerId: stickerSourceId.startsWith("starter-") ? "bundled" : "catalog",
    itemId: stickerSourceId,
    format: stickerFormat ?? "lottie",
  };
}

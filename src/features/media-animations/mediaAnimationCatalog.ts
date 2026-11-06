/**
 * mediaAnimationCatalog.ts — Media Animation Catalog Store
 *
 * Fetches published media animation presets from the Clypra API and exposes
 * them through the same external-store pattern used by animationCatalog.ts
 * so that MediaAnimationSection can use the same compileClipMotionKeyframes
 * compiler without any changes.
 *
 * Categories: "in" | "out" | "combo"
 * Track format returned by API: { property: "translateX"|"translateY", keyframes: [{ progress, value, easing }] }
 */

import { useEffect, useSyncExternalStore } from "react";
import { getApiBaseUrl, getApiHeaders } from "@/lib/api/apiUtils";
import type { MotionBehaviorCategory } from "@/types/motion";
import type {
  AnimationCatalogSnapshot,
  PhaseSnapshot,
  RemoteTextAnimationPreset,
} from "@/features/text-animations/animationCatalog";
import {
  mediaAnimationCacheManager,
  type AnimationManifest,
  type MediaAnimationPreset,
} from "./cache/mediaAnimationCache";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MediaAnimationCategory = "in" | "out" | "combo";

export interface MediaAnimationCategorySnapshot {
  presets: MediaAnimationPreset[];
  status: "idle" | "loading" | "ready" | "error";
  error?: string;
}

// ─── Module-level state ────────────────────────────────────────────────────────

const IDLE: MediaAnimationCategorySnapshot = { presets: [], status: "idle" };

const categorySnapshots: Record<
  MediaAnimationCategory,
  MediaAnimationCategorySnapshot
> = {
  in: { ...IDLE },
  out: { ...IDLE },
  combo: { ...IDLE },
};

// Per-category immutable snapshot map — rebuilt on every emit() so each
// category's reference changes only when its data actually changes.
// Stored separately from mergedSnapshot so useMediaAnimationCategory can
// return a stable reference per category without going through phases.
const categorySnapshotRefs: Record<
  MediaAnimationCategory,
  MediaAnimationCategorySnapshot
> = {
  in: { ...IDLE },
  out: { ...IDLE },
  combo: { ...IDLE },
};
const downloadedPresets = new Map<string, MediaAnimationPreset>();
const categoryRequests: Partial<Record<MediaAnimationCategory, Promise<void>>> =
  {};
const listeners = new Set<() => void>();

// Best-effort initialize the OS-level cache — no top-level await.
// After hydration completes, emit so consumers re-evaluate isCached() for all
// presets that were downloaded in a previous session.
mediaAnimationCacheManager
  .initialize()
  .then(() => emit())
  .catch(() => {});

// ─── Derived merged snapshot ─────────────────────────────────────────────────

function buildMergedSnapshot(): AnimationCatalogSnapshot {
  const seen = new Set<string>();
  const presets: RemoteTextAnimationPreset[] = [];

  for (const cat of ["in", "out", "combo"] as MediaAnimationCategory[]) {
    for (const p of categorySnapshots[cat].presets) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        presets.push(p);
      }
    }
  }
  for (const p of downloadedPresets.values()) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      presets.push(p);
    }
  }

  const statuses = (["in", "out", "combo"] as MediaAnimationCategory[]).map(
    (c) => categorySnapshots[c].status,
  );
  const status: AnimationCatalogSnapshot["status"] = statuses.some(
    (s) => s === "loading",
  )
    ? "loading"
    : statuses.some((s) => s === "ready")
      ? "ready"
      : statuses.some((s) => s === "error")
        ? "error"
        : "idle";

  // phases maps the three media animation categories into the PhaseSnapshot
  // shape. combo goes into the "loop" slot — "loop" is otherwise unused for
  // media animations — so each category has its own independent slot and
  // useMediaAnimationCategory can read the correct one per tab.
  const phases: Record<MotionBehaviorCategory, PhaseSnapshot> = {
    in: { ...categorySnapshots.in },
    out: { ...categorySnapshots.out },
    loop: { ...categorySnapshots.combo }, // combo stored here, read via "loop" key
  };

  return { presets, phases, status };
}

let mergedSnapshot: AnimationCatalogSnapshot = buildMergedSnapshot();

function emit(): void {
  // Rebuild per-category refs — only create a new object if the underlying
  // data actually changed, so useSyncExternalStore sees new references.
  for (const cat of ["in", "out", "combo"] as MediaAnimationCategory[]) {
    const current = categorySnapshots[cat];
    const ref = categorySnapshotRefs[cat];
    if (
      ref.status !== current.status ||
      ref.presets !== current.presets ||
      ref.error !== current.error
    ) {
      categorySnapshotRefs[cat] = { ...current };
    }
  }
  mergedSnapshot = buildMergedSnapshot();
  listeners.forEach((l) => l());
}

// ─── Normalization ───────────────────────────────────────────────────────────

function iconForDirection(direction: string | undefined): string {
  switch (direction) {
    case "left":
      return "ArrowLeft";
    case "right":
      return "ArrowRight";
    case "top":
      return "ArrowUp";
    case "bottom":
      return "ArrowDown";
    default:
      return "Sparkles";
  }
}

function normalizeMediaPreset(
  item: unknown,
  category: MediaAnimationCategory,
): MediaAnimationPreset | null {
  if (!item || typeof item !== "object") return null;
  const raw = item as Record<string, unknown>;

  const slug =
    typeof raw.slug === "string"
      ? raw.slug
      : typeof raw.id === "string"
        ? raw.id
        : null;
  const name = typeof raw.name === "string" ? raw.name : null;
  if (!slug || !name) return null;

  // tracks and durationFrames are not in summary; they come from the cached manifest
  const defaultDuration = 0.5;
  const direction =
    typeof raw.direction === "string" ? raw.direction : undefined;
  const thumbnailUrl =
    typeof raw.thumbnailUrl === "string" ? raw.thumbnailUrl : undefined;
  const previewUrl =
    typeof raw.previewUrl === "string" ? raw.previewUrl : undefined;
  const version = typeof raw.version === "string" ? raw.version : undefined;

  // "combo" maps to "in" as the compiler phase — combo presets are standalone in-place animations
  const phase: MotionBehaviorCategory = category === "out" ? "out" : "in";

  return {
    id: slug,
    name,
    phase,
    category: phase,
    subCategory: "Basic",
    tags: direction ? [direction] : [],
    description: typeof raw.description === "string" ? raw.description : name,
    defaultDuration,
    icon: iconForDirection(direction),
    tracks: [], // populated after manifest download
    minDuration: 0.3,
    maxDuration: 3.0,
    previewLoopDuration: defaultDuration,
    revisionId: version,
    thumbnailUrl,
    previewUrl,
  };
}

// ─── Fetch ───────────────────────────────────────────────────────────────────

export async function fetchMediaAnimationCategory(
  category: MediaAnimationCategory,
  force = false,
): Promise<void> {
  const inFlight = categoryRequests[category];
  if (inFlight) return inFlight;

  if (!force && categorySnapshots[category].status === "ready") return;

  const run = (async () => {
    const previous = categorySnapshots[category];
    categorySnapshots[category] = {
      ...previous,
      status: "loading",
      error: undefined,
    };
    emit();

    try {
      const url = `${getApiBaseUrl()}/media-animations?category=${category}&fields=summary`;
      const response = await fetch(url, {
        headers: getApiHeaders(),
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(
          `Media animation catalog fetch failed for "${category}" (${response.status})`,
        );
      }

      const payload: unknown = await response.json();
      // Response is either an array of animations or { items: [...] }
      const items: unknown[] = Array.isArray(payload)
        ? payload
        : Array.isArray((payload as Record<string, unknown>)?.items)
          ? (payload as { items: unknown[] }).items
          : [];

      const presets = items
        .map((item) => normalizeMediaPreset(item, category))
        .filter((p): p is MediaAnimationPreset => p !== null);

      categorySnapshots[category] = { presets, status: "ready" };
    } catch (error) {
      categorySnapshots[category] = {
        ...previous,
        status: "error",
        error:
          error instanceof Error
            ? error.message
            : "Unable to load media animation catalog",
      };
    } finally {
      categoryRequests[category] = undefined;
      emit();
    }
  })();

  categoryRequests[category] = run;
  return run;
}

// ─── External store API ───────────────────────────────────────────────────────

export function getMediaAnimationCatalogSnapshot(): AnimationCatalogSnapshot {
  return mergedSnapshot;
}

export function subscribeToMediaAnimationCatalog(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getMediaAnimationPreset(
  id: string | undefined,
): MediaAnimationPreset | undefined {
  if (!id) return undefined;
  const base =
    downloadedPresets.get(id) ??
    (mergedSnapshot.presets.find((p) => p.id === id) as
      | MediaAnimationPreset
      | undefined);
  if (!base) return undefined;

  // If we have a cached manifest in memory (either from this session's
  // download or eagerly loaded from disk on startup), merge its tracks.
  const version = base.revisionId;
  if (version) {
    const manifest = mediaAnimationCacheManager.manifests.get(
      `${id}@${version}`,
    );
    if (manifest) {
      return {
        ...base,
        tracks: manifest.tracks as MediaAnimationPreset["tracks"],
        defaultDuration:
          manifest.durationFrames / (manifest.frameRateNum || 30),
      };
    }
  }
  return base;
}

/**
 * Downloads and caches the full animation manifest for a preset.
 * After downloading, the manifest is stored in the singleton's `manifests`
 * map so getMediaAnimationPreset() can merge it synchronously.
 */
export async function downloadManifest(
  slug: string,
  version: string,
): Promise<AnimationManifest> {
  return mediaAnimationCacheManager.ensureDownloaded(
    slug,
    version,
    async () => {
      const url = `${getApiBaseUrl()}/media-animations/${encodeURIComponent(slug)}/manifest`;
      const response = await fetch(url, {
        headers: getApiHeaders(),
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(
          `Manifest fetch failed for "${slug}" (${response.status})`,
        );
      }
      return response.json() as Promise<AnimationManifest>;
    },
  );
}

// ─── React hooks ─────────────────────────────────────────────────────────────

/**
 * Returns the snapshot for a single category and triggers a lazy fetch the
 * first time that category tab is opened.
 */
export function useMediaAnimationCategory(
  category: MediaAnimationCategory,
): MediaAnimationCategorySnapshot {
  // Subscribe to the external store so React re-renders when emit() fires.
  // Read from categorySnapshotRefs — immutable copies rebuilt on every emit
  // only when data changes — so React's reference equality check works correctly.
  useSyncExternalStore(
    subscribeToMediaAnimationCatalog,
    getMediaAnimationCatalogSnapshot,
    getMediaAnimationCatalogSnapshot,
  );
  useEffect(() => {
    void fetchMediaAnimationCategory(category);
  }, [category]);
  return categorySnapshotRefs[category];
}

/**
 * Returns the merged catalog snapshot across all categories.
 * Used by compileClipMotionKeyframes as the catalog argument.
 */
export function useMediaAnimationCatalogSnapshot(): AnimationCatalogSnapshot {
  return useSyncExternalStore(
    subscribeToMediaAnimationCatalog,
    getMediaAnimationCatalogSnapshot,
    getMediaAnimationCatalogSnapshot,
  );
}

/**
 * mediaAnimationCatalog.ts
 *
 * Per-category fetch hook for the media animation catalog.
 * Each CategoryGrid mounts with its own hook instance for isolated fetch state.
 *
 * allPresets is a shared module-level map keyed by "id@category". A lightweight
 * listener set (catalogListeners) lets useMediaAnimationCatalogSnapshot stay
 * reactive — it re-renders MediaAnimationSection whenever new presets arrive so
 * that updateMotion always sees a populated catalog when the user clicks a preset.
 */

import { useState, useEffect, useSyncExternalStore } from "react";
import { getApiBaseUrl, getApiHeaders } from "@/lib/api/apiUtils";
import type { MotionBehaviorCategory } from "@/types/motion";
import type {
  AnimationCatalogSnapshot,
  RemoteTextAnimationPreset,
} from "@/features/text-animations/animationCatalog";
import {
  mediaAnimationCacheManager,
  type AnimationManifest,
  type MediaAnimationPreset,
} from "./cache/mediaAnimationCache";
import { MediaAnimationTelemetry } from "./telemetry/mediaAnimationTelemetry";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MediaAnimationCategory = "in" | "out" | "combo";

export interface MediaAnimationCategorySnapshot {
  presets: MediaAnimationPreset[];
  status: "idle" | "loading" | "ready" | "error";
  error?: string;
}

// ─── Shared preset map (for compiler lookups after manifest download) ─────────

const allPresets = new Map<string, MediaAnimationPreset>();

// ─── Catalog subscription (keeps useMediaAnimationCatalogSnapshot reactive) ───

const catalogListeners = new Set<() => void>();

function buildCatalogSnapshot(): AnimationCatalogSnapshot {
  const seen = new Set<string>();
  const presets: RemoteTextAnimationPreset[] = [];
  for (const preset of allPresets.values()) {
    if (!seen.has(preset.id)) {
      seen.add(preset.id);
      presets.push(preset as unknown as RemoteTextAnimationPreset);
    }
  }
  return {
    presets,
    phases: {
      in: {
        presets: presets.filter((p) => p.phase === "in"),
        status: "ready",
      },
      out: {
        presets: presets.filter((p) => p.phase === "out"),
        status: "ready",
      },
      loop: { presets: [], status: "ready" },
    },
    status: "ready",
  };
}

let cachedCatalogSnapshot: AnimationCatalogSnapshot = buildCatalogSnapshot();

export function notifyCatalogListeners(): void {
  cachedCatalogSnapshot = buildCatalogSnapshot();
  catalogListeners.forEach((l) => l());
}

function subscribeToCatalog(listener: () => void): () => void {
  catalogListeners.add(listener);
  return () => {
    catalogListeners.delete(listener);
  };
}

export function getCatalogSnapshot(): AnimationCatalogSnapshot {
  return cachedCatalogSnapshot;
}

// ─── Normalization ────────────────────────────────────────────────────────────

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

/**
 * Ensures track keyframes have valid, non-degenerate progress values.
 * Recovers from API manifests that collapsed all keyframe progress to 0.
 */
export function sanitizeTrackKeyframes(
  tracks: MediaAnimationPreset["tracks"],
): MediaAnimationPreset["tracks"] {
  if (!Array.isArray(tracks)) return [];
  return tracks.map((track) => {
    const rawKeyframes = track.keyframes ?? [];
    if (rawKeyframes.length < 2) return track;
    const isDegenerate =
      rawKeyframes.every((kf) => (kf.progress ?? 0) <= 0) ||
      (rawKeyframes[rawKeyframes.length - 1].progress ?? 0) <=
        (rawKeyframes[0].progress ?? 0);
    if (!isDegenerate) return track;

    const sanitizedKeyframes = rawKeyframes.map((kf, index) => ({
      ...kf,
      progress: index / (rawKeyframes.length - 1),
    }));
    return { ...track, keyframes: sanitizedKeyframes };
  });
}

function normalizeMediaPreset(
  item: unknown,
  category: MediaAnimationCategory,
): MediaAnimationPreset | null {
  if (!item || typeof item !== "object") return null;
  const raw = item as Record<string, unknown>;

  if (import.meta.env.DEV) {
    console.log(
      `[mediaAnimationCatalog] raw item (category="${category}"):`,
      raw,
    );
  }

  const slug =
    typeof raw.slug === "string"
      ? raw.slug
      : typeof raw.id === "string"
        ? raw.id
        : null;
  const name = typeof raw.name === "string" ? raw.name : null;
  if (!slug || !name) return null;

  const durationFrames =
    typeof raw.durationFrames === "number" ? raw.durationFrames : null;
  const defaultDuration = durationFrames !== null ? durationFrames / 30 : 0.5;
  const direction =
    typeof raw.direction === "string" ? raw.direction : undefined;
  const thumbnailUrl =
    typeof raw.thumbnailUrl === "string" ? raw.thumbnailUrl : undefined;
  const previewUrl =
    typeof raw.previewUrl === "string" ? raw.previewUrl : undefined;
  const version =
    typeof raw.activeVersion === "string"
      ? raw.activeVersion
      : typeof raw.version === "string"
        ? raw.version
        : undefined;

  // combo presets use the "in" compiler phase (standalone in-place animations)
  const phase: MotionBehaviorCategory = category === "out" ? "out" : "in";

  const preset: MediaAnimationPreset = {
    id: slug,
    name,
    phase,
    category: phase, // MotionBehaviorCategory doesn't include "combo"; combo maps to "in" phase
    subCategory: "Basic",
    tags: direction ? [direction] : [],
    description: typeof raw.description === "string" ? raw.description : name,
    defaultDuration,
    icon: iconForDirection(direction),
    tracks: sanitizeTrackKeyframes(
      Array.isArray(raw.tracks)
        ? (raw.tracks as MediaAnimationPreset["tracks"])
        : [],
    ),
    minDuration: 0.3,
    maxDuration: 3.0,
    previewLoopDuration: defaultDuration,
    revisionId: version,
    thumbnailUrl,
    previewUrl,
  };

  if (import.meta.env.DEV) {
    console.log(`[mediaAnimationCatalog] normalized:`, {
      id: preset.id,
      revisionId: preset.revisionId,
      phase: preset.phase,
      defaultDuration: preset.defaultDuration,
      tracksCount: preset.tracks.length,
    });
  }

  return preset;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Fetches presets for a single category. Each CategoryGrid instance gets its
 * own isolated state — no shared store, no bleed between tabs.
 * The parent keys CategoryGrid by category so this remounts fresh on tab switch.
 */
export function useMediaAnimationCategory(
  category: MediaAnimationCategory,
  enabled: boolean = true,
): MediaAnimationCategorySnapshot {
  const [snapshot, setSnapshot] = useState<MediaAnimationCategorySnapshot>({
    presets: [],
    status: "idle",
  });

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    setSnapshot({ presets: [], status: "loading" });

    const url = `${getApiBaseUrl()}/media-animations?category=${category}&fields=summary`;

    const t0 = performance.now();

    const run = async () => {
      try {
        const res = await fetch(url, {
          headers: getApiHeaders(),
          credentials: "include",
        });
        if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
        const httpStatus = res.status;
        const payload = (await res.json()) as unknown;

        if (cancelled) return;

        const items: unknown[] = Array.isArray(payload)
          ? payload
          : Array.isArray((payload as Record<string, unknown>)?.items)
            ? ((payload as Record<string, unknown>).items as unknown[])
            : [];

        const presets = items
          // Client-side guard: drop any item whose category doesn't match the
          // requested one. Protects against an API that returns unfiltered
          // data (e.g. missing auth header, edge-cache hit, future regression).
          .filter((item) => {
            const raw = item as Record<string, unknown>;
            return (
              typeof raw.category !== "string" || raw.category === category
            );
          })
          .map((item) => normalizeMediaPreset(item, category))
          .filter((p): p is MediaAnimationPreset => p !== null);

        // Key by id@category so each category keeps its own copy in the map
        // and later fetches for other categories don't overwrite this one.
        presets.forEach((p) => allPresets.set(`${p.id}@${category}`, p));
        // Notify subscribers so useMediaAnimationCatalogSnapshot re-renders.
        notifyCatalogListeners();

        if (import.meta.env.DEV) {
          console.log(
            `[useMediaAnimationCategory] category="${category}" → ${presets.length} presets`,
          );
        }
        setSnapshot({ presets, status: "ready" });
        MediaAnimationTelemetry.recordCatalogFetch({
          category,
          durationMs: Math.round(performance.now() - t0),
          presetCount: presets.length,
          status: "success",
          httpStatus,
        });
      } catch (err) {
        if (cancelled) return;
        console.error(`[useMediaAnimationCategory] fetch error:`, err);
        setSnapshot({
          presets: [],
          status: "error",
          error: (err as Error).message,
        });
        MediaAnimationTelemetry.recordCatalogFetch({
          category,
          durationMs: Math.round(performance.now() - t0),
          presetCount: 0,
          status: "error",
          error: (err as Error).message,
        });
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [category, enabled]);

  return snapshot;
}

// ─── Compiler support ─────────────────────────────────────────────────────────

/**
 * Looks up a preset by id and merges cached manifest tracks if available.
 * Used by compileClipMotionKeyframes.
 */
export function getMediaAnimationPreset(
  id: string | undefined,
): MediaAnimationPreset | undefined {
  if (!id) return undefined;
  // Search all categories — prefer "in" since most compiler lookups are for
  // in-phase presets, then fall back through the others.
  const base =
    allPresets.get(`${id}@in`) ??
    allPresets.get(`${id}@out`) ??
    allPresets.get(`${id}@combo`);
  if (!base) return undefined;

  const version = base.revisionId;
  if (version) {
    const manifest = mediaAnimationCacheManager.manifests.get(
      `${id}@${version}`,
    );
    if (manifest) {
      return {
        ...base,
        tracks: sanitizeTrackKeyframes(
          manifest.tracks as MediaAnimationPreset["tracks"],
        ),
        defaultDuration:
          manifest.durationFrames / (manifest.frameRateNum || 30),
      };
    }
  }
  return base;
}

/**
 * Reactive hook — returns the merged catalog snapshot and re-renders whenever
 * a category fetch completes and writes new presets into allPresets.
 * Uses useSyncExternalStore so MediaAnimationSection always has a fresh catalog
 * when the user clicks a preset, even if the fetch just finished.
 */
export function useMediaAnimationCatalogSnapshot(): AnimationCatalogSnapshot {
  return useSyncExternalStore(subscribeToCatalog, getCatalogSnapshot);
}

/**
 * Downloads and caches the full animation manifest for a preset, then
 * notifies catalog listeners so any component holding a catalogSnapshot
 * (e.g. MediaAnimationSection) re-renders with the manifest-merged tracks.
 */
export async function downloadManifest(
  slug: string,
  version: string,
): Promise<AnimationManifest> {
  const manifest = await mediaAnimationCacheManager.ensureDownloaded(
    slug,
    version,
    async () => {
      const url = `${getApiBaseUrl()}/media-animations/${encodeURIComponent(slug)}/manifest`;
      const response = await fetch(url, {
        headers: getApiHeaders(),
        credentials: "include",
      });
      if (!response.ok)
        throw new Error(
          `Manifest fetch failed for "${slug}" (${response.status})`,
        );
      return response.json() as Promise<AnimationManifest>;
    },
  );

  // Notify catalog subscribers so useMediaAnimationCatalogSnapshot re-renders
  // with the manifest-merged tracks. This ensures that any component that
  // builds a mergedCatalog (e.g. updateMotion in MediaAnimationSection) will
  // pick up the full tracks on the next render after download completes.
  notifyCatalogListeners();

  return manifest;
}

// Initialize disk cache on load
mediaAnimationCacheManager.initialize().catch(() => {});

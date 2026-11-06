/**
 * mediaAnimationCatalog.ts
 *
 * Simple per-category fetch hook for the media animation catalog.
 * Each CategoryGrid mounts with its own hook instance — no shared store,
 * no subscription machinery, no merged snapshots.
 *
 * The only shared module-level state is a flat preset map used by
 * getMediaAnimationPreset() so the motion compiler can look up tracks
 * after a manifest download.
 */

import { useState, useEffect } from "react";
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

// ─── Types ────────────────────────────────────────────────────────────────────

export type MediaAnimationCategory = "in" | "out" | "combo";

export interface MediaAnimationCategorySnapshot {
  presets: MediaAnimationPreset[];
  status: "idle" | "loading" | "ready" | "error";
  error?: string;
}

// ─── Shared preset map (for compiler lookups after manifest download) ─────────

const allPresets = new Map<string, MediaAnimationPreset>();

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

function normalizeMediaPreset(
  item: unknown,
  category: MediaAnimationCategory,
): MediaAnimationPreset | null {
  if (!item || typeof item !== "object") return null;
  const raw = item as Record<string, unknown>;

  console.log(
    `[mediaAnimationCatalog] raw item (category="${category}"):`,
    raw,
  );

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
    category: phase,
    subCategory: "Basic",
    tags: direction ? [direction] : [],
    description: typeof raw.description === "string" ? raw.description : name,
    defaultDuration,
    icon: iconForDirection(direction),
    tracks: Array.isArray(raw.tracks)
      ? (raw.tracks as MediaAnimationPreset["tracks"])
      : [],
    minDuration: 0.3,
    maxDuration: 3.0,
    previewLoopDuration: defaultDuration,
    revisionId: version,
    thumbnailUrl,
    previewUrl,
  };

  console.log(`[mediaAnimationCatalog] normalized:`, {
    id: preset.id,
    revisionId: preset.revisionId,
    phase: preset.phase,
    defaultDuration: preset.defaultDuration,
    tracksCount: preset.tracks.length,
  });

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

    fetch(url, { headers: getApiHeaders(), credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
        return res.json() as Promise<unknown>;
      })
      .then((payload) => {
        if (cancelled) return;
        const items: unknown[] = Array.isArray(payload)
          ? payload
          : Array.isArray((payload as any)?.items)
            ? (payload as any).items
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

        console.log(
          `[useMediaAnimationCategory] category="${category}" → ${presets.length} presets`,
        );
        setSnapshot({ presets, status: "ready" });
      })
      .catch((err) => {
        if (cancelled) return;
        console.error(`[useMediaAnimationCategory] fetch error:`, err);
        setSnapshot({ presets: [], status: "error", error: err.message });
      });

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
        tracks: manifest.tracks as MediaAnimationPreset["tracks"],
        defaultDuration:
          manifest.durationFrames / (manifest.frameRateNum || 30),
      };
    }
  }
  return base;
}

/**
 * Returns a merged catalog snapshot for the motion compiler.
 * Reads from the shared allPresets map populated by the hooks.
 */
export function useMediaAnimationCatalogSnapshot(): AnimationCatalogSnapshot {
  // Deduplicate by id — each preset may have up to 3 entries (id@in, id@out,
  // id@combo) but the compiler only needs one copy per id.
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
        presets: presets.filter((p) => (p as any).phase === "in"),
        status: "ready",
      },
      out: {
        presets: presets.filter((p) => (p as any).phase === "out"),
        status: "ready",
      },
      loop: { presets: [], status: "ready" },
    },
    status: "ready",
  };
}

/**
 * Downloads and caches the full animation manifest for a preset.
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
      if (!response.ok)
        throw new Error(
          `Manifest fetch failed for "${slug}" (${response.status})`,
        );
      return response.json() as Promise<AnimationManifest>;
    },
  );
}

// Initialize disk cache on load
mediaAnimationCacheManager.initialize().catch(() => {});

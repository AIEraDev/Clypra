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

// ─── Types ────────────────────────────────────────────────────────────────────

export type MediaAnimationCategory = "in" | "out" | "combo";

export interface MediaAnimationCategorySnapshot {
  presets: RemoteTextAnimationPreset[];
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

const downloadedPresets = new Map<string, RemoteTextAnimationPreset>();
const categoryRequests: Partial<Record<MediaAnimationCategory, Promise<void>>> =
  {};
const listeners = new Set<() => void>();

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

  // Reuse the PhaseSnapshot shape for compatibility with the compiler.
  // "loop" slot is unused for media animations — repurpose it for "combo"
  // so every MediaAnimationCategory has a stable, immutable snapshot slot
  // that React can diff on each emit().
  const phases: Record<MotionBehaviorCategory, PhaseSnapshot> = {
    in: { ...categorySnapshots.in },
    out: { ...categorySnapshots.out },
    loop: { ...categorySnapshots.combo },
  };

  return { presets, phases, status };
}

let mergedSnapshot: AnimationCatalogSnapshot = buildMergedSnapshot();

function emit(): void {
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
):
  | (RemoteTextAnimationPreset & { thumbnailUrl?: string; previewUrl?: string })
  | null {
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

  const tracks = Array.isArray(raw.tracks) ? raw.tracks : [];
  const durationFrames =
    typeof raw.durationFrames === "number" ? raw.durationFrames : 30;
  const direction =
    typeof raw.direction === "string" ? raw.direction : undefined;
  const thumbnailUrl =
    typeof raw.thumbnailUrl === "string" ? raw.thumbnailUrl : undefined;
  const previewUrl =
    typeof raw.previewUrl === "string" ? raw.previewUrl : undefined;
  const version = typeof raw.version === "string" ? raw.version : undefined;

  // "combo" maps to "in" as the compiler phase — combo presets are standalone in-place animations
  const phase: MotionBehaviorCategory = category === "out" ? "out" : "in";

  const defaultDuration = durationFrames / 30;

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
    tracks: tracks as RemoteTextAnimationPreset["tracks"],
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
      const url = `${getApiBaseUrl()}/media-animations?category=${category}`;
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
        : Array.isArray((payload as any)?.items)
          ? (payload as any).items
          : [];

      const presets = items
        .map((item) => normalizeMediaPreset(item, category))
        .filter((p): p is RemoteTextAnimationPreset => p !== null);

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
): RemoteTextAnimationPreset | undefined {
  if (!id) return undefined;
  return (
    downloadedPresets.get(id) ?? mergedSnapshot.presets.find((p) => p.id === id)
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
  const snapshot = useSyncExternalStore(
    subscribeToMediaAnimationCatalog,
    getMediaAnimationCatalogSnapshot,
    getMediaAnimationCatalogSnapshot,
  );
  useEffect(() => {
    void fetchMediaAnimationCategory(category);
  }, [category]);
  // Derive from the immutable store snapshot so React always sees a new
  // reference when the category's data changes, rather than reading the
  // mutable module-level object directly (which can return stale data).
  return snapshot.phases[
    category === "combo" ? "in" : category
  ] as MediaAnimationCategorySnapshot;
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

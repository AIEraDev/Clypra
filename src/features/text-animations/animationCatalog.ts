import { useEffect, useSyncExternalStore } from "react";
import { getApiBaseUrl, getApiHeaders } from "@/lib/api/apiUtils";
import type { KeyframeEasing } from "@/types/keyframes";
import type { MotionBehaviorCategory, MotionPresetMeta, MotionSubCategory } from "@/types/motion";

export type AnimationTrackProperty =
  | "opacity"
  | "scale"
  | "scaleX"
  | "scaleY"
  | "translateX"
  | "translateY"
  | "rotation"
  | "skewX"
  | "tracking"
  | "blur";

export interface AnimationTrackKeyframe {
  progress: number;
  value: number;
  easing?: string | { type: string };
}

export interface RemoteTextAnimationPreset extends MotionPresetMeta {
  id: string;
  phase: MotionBehaviorCategory;
  tracks: Array<{ property: AnimationTrackProperty; keyframes: AnimationTrackKeyframe[] }>;
  minDuration: number;
  maxDuration: number;
  previewLoopDuration: number;
  stagger?: { unit: "character" | "word" | "line" | "none"; overlap: number; order: string };
  procedural?: { type: string; intensity: number; frequency?: number };
  revisionId?: string;
  updatedAt?: number;
}

// ── Per-phase snapshot ────────────────────────────────────────────────────────

export interface PhaseSnapshot {
  presets: RemoteTextAnimationPreset[];
  status: "idle" | "loading" | "ready" | "error";
  error?: string;
}

// ── Merged catalog snapshot (external store shape) ────────────────────────────

export interface AnimationCatalogSnapshot {
  /** Flat merge of all fetched-phase presets + individually downloaded presets. */
  presets: RemoteTextAnimationPreset[];
  /** Per-phase granular status for UI loading/error states. */
  phases: Record<MotionBehaviorCategory, PhaseSnapshot>;
  /** Overall derived status. */
  status: "idle" | "loading" | "ready" | "error";
}

// ── Module-level state ────────────────────────────────────────────────────────

const IDLE_PHASE: PhaseSnapshot = { presets: [], status: "idle" };

const phaseSnapshots: Record<MotionBehaviorCategory, PhaseSnapshot> = {
  in: { ...IDLE_PHASE },
  out: { ...IDLE_PHASE },
  loop: { ...IDLE_PHASE },
};

/**
 * In-memory cache for individually downloaded preset revisions.
 * Keyed by preset id. Populated when a user clicks a preset card.
 * Not persisted to localStorage — lives for the current session only.
 */
const downloadedPresets = new Map<string, RemoteTextAnimationPreset>();

/** In-flight deduplication per phase — prevents duplicate network calls. */
const phaseRequests: Partial<Record<MotionBehaviorCategory, Promise<void>>> = {};

const listeners = new Set<() => void>();

// ── Derived merged snapshot ───────────────────────────────────────────────────

function buildMergedSnapshot(): AnimationCatalogSnapshot {
  // Merge all fetched phase presets; then layer in individually downloaded
  // presets so the compositor can always resolve a selected preset's tracks.
  const seen = new Set<string>();
  const presets: RemoteTextAnimationPreset[] = [];

  for (const phase of ["in", "out", "loop"] as MotionBehaviorCategory[]) {
    for (const p of phaseSnapshots[phase].presets) {
      if (!seen.has(p.id)) { seen.add(p.id); presets.push(p); }
    }
  }
  for (const p of downloadedPresets.values()) {
    if (!seen.has(p.id)) { seen.add(p.id); presets.push(p); }
  }

  const statuses = [phaseSnapshots.in.status, phaseSnapshots.out.status, phaseSnapshots.loop.status];
  const status: AnimationCatalogSnapshot["status"] =
    statuses.some((s) => s === "loading") ? "loading"
    : statuses.some((s) => s === "ready") ? "ready"
    : statuses.some((s) => s === "error") ? "error"
    : "idle";

  return { presets, phases: { ...phaseSnapshots }, status };
}

let mergedSnapshot: AnimationCatalogSnapshot = buildMergedSnapshot();

function emit() {
  mergedSnapshot = buildMergedSnapshot();
  listeners.forEach((l) => l());
}

// ── Normalization helpers ─────────────────────────────────────────────────────

function phaseOf(value: unknown): MotionBehaviorCategory | null {
  return value === "in" || value === "out" || value === "loop" ? value : null;
}

function categoryOf(value: unknown): MotionSubCategory {
  return value === "3D" || value === "Glitch" || value === "Motion" ? value : "Basic";
}

function iconForPreset(name: string, tags: string[]): string {
  const text = `${name} ${tags.join(" ")}`.toLowerCase();
  if (text.includes("zoom") || text.includes("scale")) return "ZoomIn";
  if (text.includes("flip") || text.includes("turn") || text.includes("rotation")) return "RotateCw";
  if (text.includes("wave") || text.includes("water") || text.includes("float")) return "Waves";
  if (text.includes("fade") || text.includes("shine")) return "Sun";
  if (text.includes("glitch") || text.includes("pixel") || text.includes("cyber")) return "Zap";
  if (text.includes("slide") || text.includes("flying") || text.includes("rush")) return "ArrowUp";
  return "Sparkles";
}

function normalizePreset(value: unknown): RemoteTextAnimationPreset | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const phase = phaseOf(raw.phase);
  if (!phase || typeof raw.id !== "string" || typeof raw.name !== "string" || !Array.isArray(raw.tracks)) return null;
  const tags = Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === "string") : [];
  const tracks = raw.tracks.filter((track): track is RemoteTextAnimationPreset["tracks"][number] =>
    !!track && typeof track === "object" && typeof (track as { property?: unknown }).property === "string" && Array.isArray((track as { keyframes?: unknown }).keyframes),
  ) as RemoteTextAnimationPreset["tracks"];
  return {
    id: raw.id,
    name: raw.name,
    phase,
    category: phase,
    subCategory: categoryOf(raw.category),
    tags,
    description: typeof raw.description === "string" ? raw.description : `${raw.name} ${phase} animation`,
    defaultDuration: typeof raw.defaultDuration === "number" ? raw.defaultDuration : 0.6,
    icon: iconForPreset(raw.name, tags),
    tracks,
    minDuration: typeof raw.minDuration === "number" ? raw.minDuration : 0.1,
    maxDuration: typeof raw.maxDuration === "number" ? raw.maxDuration : 5,
    previewLoopDuration: typeof raw.previewLoopDuration === "number" ? raw.previewLoopDuration : 1.2,
    stagger: raw.stagger as RemoteTextAnimationPreset["stagger"],
    procedural: raw.procedural as RemoteTextAnimationPreset["procedural"],
    revisionId: typeof raw.revisionId === "string" ? raw.revisionId : undefined,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : undefined,
  };
}

// ── Per-phase lazy fetch ──────────────────────────────────────────────────────

/**
 * Fetch the catalog index for a single phase on demand.
 * - Called when the user opens a tab (In / Out / Loop).
 * - In-flight requests are deduplicated — switching back before a fetch
 *   completes reuses the same Promise.
 * - Already-ready phases are served from the in-memory snapshot without
 *   re-fetching unless `force` is true.
 * - No localStorage: catalog lists are intentionally session-scoped.
 */
export async function fetchAnimationPhase(
  phase: MotionBehaviorCategory,
  force = false,
): Promise<void> {
  // Deduplicate concurrent calls for the same phase.
  const inFlight = phaseRequests[phase];
  if (inFlight) return inFlight;

  // Already loaded this session — skip unless forced.
  if (!force && phaseSnapshots[phase].status === "ready") return;

  const run = (async () => {
    const previous = phaseSnapshots[phase];
    phaseSnapshots[phase] = { ...previous, status: "loading", error: undefined };
    emit();
    try {
      const response = await fetch(
        `${getApiBaseUrl()}/text-animations/${phase}`,
        { headers: getApiHeaders(), credentials: "include" },
      );
      if (!response.ok) {
        throw new Error(`Catalog fetch failed for "${phase}" (${response.status})`);
      }
      const payload: unknown = await response.json();
      if (!Array.isArray(payload)) {
        throw new Error(`Invalid catalog payload for phase "${phase}"`);
      }
      const presets = payload.map(normalizePreset).filter(Boolean) as RemoteTextAnimationPreset[];
      phaseSnapshots[phase] = { presets, status: "ready" };
    } catch (error) {
      phaseSnapshots[phase] = {
        ...previous,
        status: "error",
        error: error instanceof Error ? error.message : "Unable to load animation catalog",
      };
    } finally {
      phaseRequests[phase] = undefined;
      emit();
    }
  })();

  phaseRequests[phase] = run;
  return run;
}

// ── Individual preset download via revision route ─────────────────────────────

/**
 * Download the full immutable preset definition via the revision route and
 * cache it in-memory for this session.
 *
 * Route: GET /text-animations/{category}/{id}/revisions/{revisionId}
 *
 * The `revisionId` is returned as part of the catalog index response.
 * If the catalog hasn't loaded the preset yet (e.g. user jumped directly to
 * a preset id), falls back to searching the merged snapshot for the revisionId.
 *
 * Returns the cached preset if already downloaded.
 */
export async function downloadAnimationPreset(
  preset: RemoteTextAnimationPreset,
): Promise<RemoteTextAnimationPreset | null> {
  // Return immediately if already cached this session.
  const cached = downloadedPresets.get(preset.id);
  if (cached) return cached;

  const { id, phase, revisionId } = preset;

  if (!revisionId) {
    // No revisionId in catalog entry — nothing to resolve from the revision route.
    // Store the catalog entry itself so the compositor can use its tracks.
    downloadedPresets.set(id, preset);
    emit();
    return preset;
  }

  try {
    const response = await fetch(
      `${getApiBaseUrl()}/text-animations/${phase}/${id}/revisions/${revisionId}`,
      { headers: getApiHeaders(), credentials: "include" },
    );
    if (!response.ok) {
      throw new Error(`Revision fetch failed for "${id}@${revisionId}" (${response.status})`);
    }
    const payload: unknown = await response.json();
    const full = normalizePreset(payload);
    if (!full) throw new Error(`Invalid revision payload for "${id}"`);

    downloadedPresets.set(id, full);
    emit(); // expose downloaded preset through merged snapshot
    return full;
  } catch (error) {
    console.error(`[AnimationCatalog] Failed to download preset "${id}":`, error);
    // Fall back to the catalog-index entry so the compositor isn't left empty.
    downloadedPresets.set(id, preset);
    emit();
    return preset;
  }
}

// ── External store API ────────────────────────────────────────────────────────

export function getTextAnimationCatalogSnapshot(): AnimationCatalogSnapshot {
  return mergedSnapshot;
}

export function subscribeToTextAnimationCatalog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Look up a preset by id — checks downloaded cache first, then merged snapshot. */
export function getTextAnimationPreset(id: string | undefined): RemoteTextAnimationPreset | undefined {
  if (!id) return undefined;
  return downloadedPresets.get(id) ?? mergedSnapshot.presets.find((p) => p.id === id);
}

/** Return all loaded presets for a given phase from the in-memory snapshot. */
export function getTextAnimationPresets(phase: MotionBehaviorCategory): RemoteTextAnimationPreset[] {
  return phaseSnapshots[phase].presets;
}

// ── React hooks ───────────────────────────────────────────────────────────────

/**
 * Returns the snapshot for a single phase and triggers a lazy fetch the first
 * time the phase is accessed (i.e. when the user opens that tab).
 * Re-renders only when state for any phase or the downloaded cache changes.
 */
export function useAnimationPhase(phase: MotionBehaviorCategory): PhaseSnapshot {
  useSyncExternalStore(
    subscribeToTextAnimationCatalog,
    getTextAnimationCatalogSnapshot,
    getTextAnimationCatalogSnapshot,
  );
  useEffect(() => {
    void fetchAnimationPhase(phase);
  }, [phase]);
  return phaseSnapshots[phase];
}

/**
 * Returns the merged catalog snapshot (all fetched phases + downloaded presets).
 * Used by the compositor / motionPresets compiler which needs cross-phase lookup.
 */
export function useTextAnimationCatalog(): AnimationCatalogSnapshot {
  return useSyncExternalStore(
    subscribeToTextAnimationCatalog,
    getTextAnimationCatalogSnapshot,
    getTextAnimationCatalogSnapshot,
  );
}

export function toKeyframeEasing(value: AnimationTrackKeyframe["easing"]): KeyframeEasing {
  if (typeof value !== "string") return "linear";
  const supported: KeyframeEasing[] = ["linear", "easeIn", "easeOut", "easeInOut", "easeInQuad", "easeOutQuad", "easeInCubic", "easeOutCubic", "easeInBack", "easeOutBack", "easeOutBounce"];
  return supported.includes(value as KeyframeEasing) ? value as KeyframeEasing : "linear";
}

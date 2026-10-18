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
  updatedAt?: number;
}

interface PersistedCatalog {
  version: 1;
  fetchedAt: number;
  etag?: string;
  presets: RemoteTextAnimationPreset[];
}

export interface AnimationCatalogSnapshot {
  presets: RemoteTextAnimationPreset[];
  status: "idle" | "loading" | "ready" | "stale" | "error";
  updatedAt?: number;
  error?: string;
}

const STORAGE_KEY = "clypra:text-animation-catalog:v1";
const CACHE_TTL_MS = 5 * 60 * 1000;
let snapshot: AnimationCatalogSnapshot = loadPersistedCatalog();
const listeners = new Set<() => void>();
let request: Promise<void> | null = null;

function emit() {
  listeners.forEach((listener) => listener());
}

function loadPersistedCatalog(): AnimationCatalogSnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { presets: [], status: "idle" };
    const cache = JSON.parse(raw) as PersistedCatalog;
    if (cache.version !== 1 || !Array.isArray(cache.presets)) return { presets: [], status: "idle" };
    return {
      presets: cache.presets.map(normalizePreset).filter(Boolean) as RemoteTextAnimationPreset[],
      status: Date.now() - cache.fetchedAt < CACHE_TTL_MS ? "ready" : "stale",
      updatedAt: cache.fetchedAt,
    };
  } catch {
    return { presets: [], status: "idle" };
  }
}

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
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : undefined,
  };
}

export function getTextAnimationCatalogSnapshot(): AnimationCatalogSnapshot {
  return snapshot;
}

export function subscribeToTextAnimationCatalog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getTextAnimationPreset(id: string | undefined): RemoteTextAnimationPreset | undefined {
  return snapshot.presets.find((preset) => preset.id === id);
}

export function getTextAnimationPresets(phase: MotionBehaviorCategory): RemoteTextAnimationPreset[] {
  return snapshot.presets.filter((preset) => preset.phase === phase);
}

export async function refreshTextAnimationCatalog(force = false): Promise<void> {
  if (request) return request;
  if (!force && snapshot.status === "ready" && snapshot.updatedAt && Date.now() - snapshot.updatedAt < CACHE_TTL_MS) return;

  request = (async () => {
    const previous = snapshot;
    snapshot = { ...previous, status: previous.presets.length ? "stale" : "loading", error: undefined };
    emit();
    try {
      const response = await fetch(`${getApiBaseUrl()}/text-animations/catalog`, {
        headers: getApiHeaders(),
        credentials: "include",
      });
      if (!response.ok) throw new Error(`Animation catalog request failed (${response.status})`);
      const payload: unknown = await response.json();
      if (!Array.isArray(payload)) throw new Error("Animation catalog payload is invalid");
      const presets = payload.map(normalizePreset).filter(Boolean) as RemoteTextAnimationPreset[];
      const fetchedAt = Date.now();
      const cache: PersistedCatalog = { version: 1, fetchedAt, etag: response.headers.get("ETag") ?? undefined, presets };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
      snapshot = { presets, status: "ready", updatedAt: fetchedAt };
    } catch (error) {
      snapshot = {
        ...previous,
        status: previous.presets.length ? "stale" : "error",
        error: error instanceof Error ? error.message : "Unable to load animation catalog",
      };
    } finally {
      request = null;
      emit();
    }
  })();
  return request;
}

export function useTextAnimationCatalog(): AnimationCatalogSnapshot {
  const current = useSyncExternalStore(
    subscribeToTextAnimationCatalog,
    getTextAnimationCatalogSnapshot,
    getTextAnimationCatalogSnapshot,
  );
  // Serve cached content immediately, while checking for a newer remote catalog.
  useEffect(() => {
    void refreshTextAnimationCatalog();
  }, []);
  return current;
}

export function toKeyframeEasing(value: AnimationTrackKeyframe["easing"]): KeyframeEasing {
  if (typeof value !== "string") return "linear";
  const supported: KeyframeEasing[] = ["linear", "easeIn", "easeOut", "easeInOut", "easeInQuad", "easeOutQuad", "easeInCubic", "easeOutCubic", "easeInBack", "easeOutBack", "easeOutBounce"];
  return supported.includes(value as KeyframeEasing) ? value as KeyframeEasing : "linear";
}

// src/features/text-effects/store/effectsStore.ts
import { create } from "zustand";
import type { EffectIndexItem, EffectFullDefinition } from "../types/types";
import { ClypraApi } from "../api/clypraApi";
import { builtInPresets } from "@clypra/engine";
import type { TextEffectConfig } from "@clypra/engine";
import { getTextEffectCache } from "../cache/persistentCache";

const API_BASE = "https://clypra-worker-api.abdulkabirmusa.com";
const API_KEY = import.meta.env.VITE_CLYPRA_API_KEY || "";

type BoundingBoxSpec = {
  paddingX: number;
  paddingY: number;
  mode?: "ink" | "panel";
};

type EffectDefinitionWithBounds = EffectFullDefinition & {
  boundingBox?: BoundingBoxSpec;
};

// Helper function to create headers with API key
const getHeaders = (): HeadersInit => {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    "X-Clypra-Client": "clypra-desktop-v1",
    "User-Agent": "Clypra-Desktop/1.0.0",
  };

  if (API_KEY) {
    headers["X-API-Key"] = API_KEY;
  }

  return headers;
};

function convertConfigToDefinition(preset: any): EffectDefinitionWithBounds {
  const cfg = preset.config;

  // Font
  const font = {
    family: cfg.fontFamily || "Poppins",
    weight: cfg.fontWeight || 700,
    style: (cfg.fontStyle || "normal") as "normal" | "italic",
    letterSpacing: cfg.letterSpacing || 0,
    lineHeight: cfg.lineHeight || 1.2,
  };

  // Fills
  const fills = [];
  if (cfg.fillType !== "none") {
    fills.push({
      type: cfg.fillType || "solid",
      color: cfg.fillColor || "#FFFFFF",
      gradient: cfg.fillGradientStops
        ? {
            angle: cfg.fillGradientAngle ?? 90,
            stops: cfg.fillGradientStops,
          }
        : undefined,
      patternType: cfg.patternType,
      perCharFillEnabled: cfg.perCharFillEnabled,
      charFillColors: cfg.charFillColors,
    });
  }

  // Strokes
  const strokes = [];
  if (cfg.strokeEnabled) {
    strokes.push({
      color: cfg.strokeColor || "#000000",
      width: cfg.strokeWidth || 0,
      position: cfg.strokePosition || "outside",
      opacity: cfg.strokeOpacity || 100,
      lineJoin: cfg.strokeLineJoin || "round",
      blur: cfg.strokeBlur || 0,
      type: cfg.strokeType || "single",
      colorSecondary: cfg.strokeColorSecondary,
      widthSecondary: cfg.strokeWidthSecondary,
      fadeRange: cfg.strokeFadeRange,
    });
  }

  // Shadows
  const shadows = [];
  if (cfg.shadowEnabled) {
    shadows.push({
      color: cfg.shadowColor || "#000000",
      blur: cfg.shadowBlur || 0,
      offsetX: cfg.shadowOffsetX || 0,
      offsetY: cfg.shadowOffsetY || 0,
      opacity: cfg.shadowOpacity || 80,
      type: cfg.shadowType || "drop",
    });
  }

  // Bevel
  let bevel = undefined;
  if (cfg.bevelEnabled) {
    bevel = {
      depth: cfg.bevelDepth || 5,
      highlightColor: cfg.bevelHighlight || "#FFFFFF",
      shadowColor: cfg.bevelShadow || "#000000",
      direction: cfg.bevelDirection || "bottom-right",
      coreColor: cfg.bevelCoreColor || "#000000",
      edgeColor: cfg.bevelEdgeColor || "#2A2A38",
      edgeWidth: cfg.bevelEdgeWidth || 0,
      blur: cfg.bevelBlur || 0,
      blurColor: cfg.bevelBlurColor || "#000000",
      perspectiveEnabled: cfg.bevelPerspectiveEnabled || false,
      vanishingPointX: cfg.bevelVanishingPointX || 40,
      vanishingPointY: cfg.bevelVanishingPointY || 80,
      focalLength: cfg.bevelFocalLength || 400,
    };
  }

  // Glows
  let glows = undefined;
  if (cfg.glowLayers) {
    glows = cfg.glowLayers
      .filter((g: any) => g.enabled)
      .map((g: any) => ({
        color: g.color,
        blur: g.blur,
        opacity: g.opacity,
        type: g.type,
        strength: g.strength,
        spread: g.spread,
      }));
  }

  // Panel
  let panel = undefined;
  if (cfg.panelEnabled) {
    panel = {
      color: cfg.panelColor || "#1E1E26",
      opacity: cfg.panelOpacity || 80,
      radius: cfg.panelRadius || 12,
      paddingX: cfg.panelPaddingX || 40,
      paddingY: cfg.panelPaddingY || 20,
      stroke: cfg.panelStrokeEnabled
        ? {
            color: cfg.panelStrokeColor || "#2A2A38",
            width: cfg.panelStrokeWidth || 2,
          }
        : undefined,
    };
  }

  // Stack
  let stack = undefined;
  if (cfg.stackEnabled) {
    stack = {
      count: cfg.stackCount || 3,
      offsetX: cfg.stackOffsetX || 10,
      offsetY: cfg.stackOffsetY || -10,
      opacityDecay: cfg.stackOpacityDecay || 20,
      color1: cfg.stackColor1,
      color2: cfg.stackColor2,
      color3: cfg.stackColor3,
      color4: cfg.stackColor4,
    };
  }

  return {
    id: preset.id,
    name: preset.name,
    category: preset.category,
    description: "",
    tags: [],
    boundingBox: calculateBoundingBox(cfg),
    font,
    fills,
    strokes,
    shadows,
    bevel,
    glows,
    panel,
    stack,
  };
}

function calculateBoundingBox(cfg: TextEffectConfig): BoundingBoxSpec {
  if (cfg.panelEnabled) {
    const strokeWidth = cfg.panelStrokeEnabled ? cfg.panelStrokeWidth || 0 : 0;
    return {
      mode: "panel",
      paddingX: (cfg.panelPaddingX || 0) + strokeWidth,
      paddingY: (cfg.panelPaddingY || 0) + strokeWidth,
    };
  }

  let paddingX = 0;
  let paddingY = 0;

  if (cfg.strokeEnabled) {
    paddingX = Math.max(paddingX, cfg.strokeWidth || 0);
    paddingY = Math.max(paddingY, cfg.strokeWidth || 0);
    paddingX += cfg.strokeBlur || 0;
    paddingY += cfg.strokeBlur || 0;
  }

  if (cfg.shadowEnabled) {
    paddingX = Math.max(paddingX, Math.abs(cfg.shadowOffsetX || 0) + (cfg.shadowBlur || 0));
    paddingY = Math.max(paddingY, Math.abs(cfg.shadowOffsetY || 0) + (cfg.shadowBlur || 0));
  }

  cfg.glowLayers?.forEach((glow) => {
    if (!glow.enabled) return;
    const glowPadding = (glow.blur || 0) + (glow.spread || 0);
    paddingX = Math.max(paddingX, glowPadding);
    paddingY = Math.max(paddingY, glowPadding);
  });

  if (cfg.bevelEnabled) {
    paddingX = Math.max(paddingX, cfg.bevelDepth || 0);
    paddingY = Math.max(paddingY, cfg.bevelDepth || 0);
    paddingX += cfg.bevelBlur || 0;
    paddingY += cfg.bevelBlur || 0;
  }

  if (cfg.stackEnabled) {
    paddingX = Math.max(paddingX, Math.abs((cfg.stackOffsetX || 0) * (cfg.stackCount || 1)));
    paddingY = Math.max(paddingY, Math.abs((cfg.stackOffsetY || 0) * (cfg.stackCount || 1)));
  }

  return {
    mode: "ink",
    paddingX: Math.max(10, Math.ceil(paddingX * 1.15)),
    paddingY: Math.max(10, Math.ceil(paddingY * 1.15)),
  };
}

const initialDefinitions = builtInPresets.reduce<Record<string, EffectDefinitionWithBounds>>((acc, preset) => {
  acc[preset.id] = convertConfigToDefinition(preset);
  return acc;
}, {});

interface EffectsState {
  // ── Phase 1: Grid index ─────────────────────────────────────────
  index: Record<string, EffectIndexItem[]>; // category → items
  indexLoading: boolean;
  indexError: string | null;

  // ── Phase 2: Full definitions ───────────────────────────────────
  definitions: Record<string, EffectDefinitionWithBounds>; // id → definition
  loadingId: string | null; // which card shows a spinner
  prefetchingIds: Set<string>; // silent background fetches

  // ── Selected effect ─────────────────────────────────────────────
  selectedEffect: EffectFullDefinition | null;
  selectedCategory: string | null;

  // ── Actions ─────────────────────────────────────────────────────
  loadCategory: (category: string) => Promise<void>;
  getDefinitionById: (id: string, category: string) => Promise<EffectFullDefinition>;
  selectEffect: (id: string, category: string) => Promise<void>;
  prefetchEffect: (id: string, category: string) => void; // fire and forget
  clearSelected: () => void;
  fetchDefinitionOnlyById: (id: string) => Promise<EffectFullDefinition>;
}

export const useEffectsStore = create<EffectsState>((set, get) => ({
  index: {},
  indexLoading: false,
  indexError: null,
  definitions: initialDefinitions,
  loadingId: null,
  prefetchingIds: new Set(),
  selectedEffect: null,
  selectedCategory: null,

  // ── loadCategory ──────────────────────────────────────────────
  // Called on panel open or tab switch
  // No-ops if category already in memory
  loadCategory: async (category) => {
    // Standardize category lookup (e.g. lowercase)
    const catKey = category.toLowerCase();
    if (get().index[catKey]) return;

    set({ indexLoading: true, indexError: null });

    try {
      const res = await fetch(`${API_BASE}/effects/${catKey}`, {
        cache: "reload",
        headers: getHeaders(),
      });

      // Handle 404 as empty category (category doesn't exist yet on API)
      if (res.status === 404) {
        set((state) => ({
          index: { ...state.index, [catKey]: [] },
          indexLoading: false,
        }));
        return;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as EffectIndexItem[];

      set((state) => ({
        index: { ...state.index, [catKey]: data },
        indexLoading: false,
      }));
    } catch (err) {
      set({
        indexLoading: false,
        indexError: "Failed to load effects. Tap to retry.",
      });
    }
  },

  getDefinitionById: async (id, category) => {
    // 1. Check memory cache (Zustand state)
    const cached = get().definitions[id];
    if (cached) return cached;

    // 2. Check built-in presets (bundled)
    const localPreset = builtInPresets.find((p) => p.id === id);
    if (localPreset) {
      const def = convertConfigToDefinition(localPreset);
      set((state) => ({
        definitions: { ...state.definitions, [id]: def },
      }));
      return def;
    }

    // 3. Check persistent cache (IndexedDB)
    const persistentCache = getTextEffectCache();
    const persistedDef = await persistentCache.get(id);
    if (persistedDef) {
      // Populate memory cache
      set((state) => ({
        definitions: { ...state.definitions, [id]: persistedDef },
      }));
      return persistedDef;
    }

    // 4. Fetch from API (last resort)
    const catKey = category.toLowerCase();
    const res = await fetch(`${API_BASE}/effects/${catKey}/${id}`, {
      cache: "reload",
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as EffectFullDefinition;

    // Store in all cache layers
    set((state) => ({
      definitions: { ...state.definitions, [id]: data },
    }));
    await persistentCache.set(id, data); // Persist to disk

    return data;
  },

  // ── selectEffect ─────────────────────────────────────────────
  // Called on card click
  // Shows spinner on card if definition not yet cached
  selectEffect: async (id, category) => {
    const catKey = category.toLowerCase();

    // Show loading state on the clicked card
    set({ loadingId: id });

    try {
      const data = await get().getDefinitionById(id, catKey);

      set({
        selectedEffect: data,
        selectedCategory: catKey,
        loadingId: null,
      });
    } catch (err) {
      set({ loadingId: null });
    }
  },

  // ── prefetchEffect ────────────────────────────────────────────
  // Called on 300ms hover hold — fire and forget, no loading state
  // Primes the cache so that selectEffect() is instant on click
  prefetchEffect: (id, category) => {
    const catKey = category.toLowerCase();
    const state = get();
    if (state.definitions[id]) return; // already cached
    if (state.prefetchingIds.has(id)) return; // already in flight

    set((s) => {
      const nextPrefetching = new Set(s.prefetchingIds);
      nextPrefetching.add(id);
      return { prefetchingIds: nextPrefetching };
    });

    fetch(`${API_BASE}/effects/${catKey}/${id}`, {
      cache: "reload",
      headers: getHeaders(),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: EffectFullDefinition) => {
        set((s) => {
          const nextPrefetching = new Set(s.prefetchingIds);
          nextPrefetching.delete(id);
          return {
            definitions: { ...s.definitions, [id]: data },
            prefetchingIds: nextPrefetching,
          };
        });
      })
      .catch(() => {
        set((s) => {
          const nextPrefetching = new Set(s.prefetchingIds);
          nextPrefetching.delete(id);
          return { prefetchingIds: nextPrefetching };
        });
      });
  },

  clearSelected: () => set({ selectedEffect: null, selectedCategory: null }),
  fetchDefinitionOnlyById: async (id) => {
    // 1. Check memory cache
    const cached = get().definitions[id];
    if (cached) return cached;

    // 2. Check built-in presets
    const localPreset = builtInPresets.find((p) => p.id === id);
    if (localPreset) {
      const def = convertConfigToDefinition(localPreset);
      set((state) => ({
        definitions: { ...state.definitions, [id]: def },
      }));
      return def;
    }

    // 3. Check persistent cache (IndexedDB)
    const persistentCache = getTextEffectCache();
    const persistedDef = await persistentCache.get(id);
    if (persistedDef) {
      set((state) => ({
        definitions: { ...state.definitions, [id]: persistedDef },
      }));
      return persistedDef;
    }

    // 4. Try finding in currently loaded category indexes
    const localIndexItem = Object.values(get().index)
      .flat()
      .find((x) => x.id === id);
    if (localIndexItem) {
      const def = await get().getDefinitionById(id, localIndexItem.category);
      return def;
    }

    // 5. Try global index
    let globalIndexItem = null;
    try {
      const globalIndex = await ClypraApi.getEffectsIndex();
      globalIndexItem = globalIndex.find((x) => x.id === id);
    } catch (e) {
      console.warn("[EffectsStore] Failed to load global effects index:", e);
    }

    if (globalIndexItem) {
      const def = await get().getDefinitionById(id, globalIndexItem.category);
      return def;
    }

    // 6. Fallback: Scan known categories
    const ALL_CATEGORIES = ["3d", "neon", "metallic", "glitch", "retro", "gradient", "grunge", "outline", "shadow", "elements", "luxury"];
    for (const cat of ALL_CATEGORIES) {
      try {
        const categoryManifest = await ClypraApi.getEffectsByCategory(cat);
        const found = categoryManifest.find((x) => x.id === id);
        if (found) {
          set((state) => ({
            index: { ...state.index, [cat]: categoryManifest },
          }));
          const def = await get().getDefinitionById(id, cat);
          return def;
        }
      } catch (err) {
        // Continue scanning
      }
    }

    throw new Error(`Effect with ID ${id} not found in index or any category manifest`);
  },
}));

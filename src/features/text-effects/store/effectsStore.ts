// src/features/text-effects/store/effectsStore.ts
import { create } from "zustand";
import type { EffectIndexItem, EffectFullDefinition } from "../types/types";
import { TextEffectsApi, TEXT_EFFECT_CATEGORIES } from "../api/textEffectsApi";
import { builtInPresets } from "@clypra/engine";
import { getTextEffectCache } from "../cache/persistentCache";
import { getApiHeaders, getApiBaseUrl } from "@/lib/api";
import { convertConfigToDefinition, convertRawConfigToDefinition, type EffectDefinitionWithBounds } from "../lib/definitionConversion";

const API_BASE = getApiBaseUrl();

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
      const res = await fetch(`${API_BASE}/text-effects/${catKey}`, {
        cache: "reload",
        headers: getApiHeaders(),
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
    console.log(`[EffectsStore:Cache] 🔍 Looking for effect: ${id}`);

    // 1. Check memory cache (Zustand state)
    const cached = get().definitions[id];
    if (cached) {
      console.log(`[EffectsStore:Cache] ✅ CACHE HIT (Memory) - Effect "${id}" loaded from in-memory cache`);
      return cached;
    }

    console.log(`[EffectsStore:Cache] ⚠️ Cache miss (Memory) - Effect "${id}" not in memory`);

    // 2. Check built-in presets (bundled)
    const localPreset = builtInPresets.find((p) => p.id === id);
    if (localPreset) {
      console.log(`[EffectsStore:Cache] ✅ CACHE HIT (Built-in) - Effect "${id}" found in built-in presets`);
      const def = convertConfigToDefinition(localPreset);
      set((state) => ({
        definitions: { ...state.definitions, [id]: def },
      }));
      return def;
    }

    console.log(`[EffectsStore:Cache] ⚠️ Cache miss (Built-in) - Effect "${id}" not in presets`);

    // 3. Check persistent cache (IndexedDB)
    const persistentCache = getTextEffectCache();
    const persistedDef = await persistentCache.get(id);
    if (persistedDef) {
      console.log(`[EffectsStore:Cache] ✅ CACHE HIT (IndexedDB) - Effect "${id}" loaded from persistent storage`);
      const definition = convertRawConfigToDefinition(persistedDef);
      // Populate memory cache
      set((state) => ({
        definitions: { ...state.definitions, [id]: definition },
      }));
      return definition;
    }

    console.log(`[EffectsStore:Cache] ⚠️ Cache miss (IndexedDB) - Effect "${id}" not in persistent storage`);
    console.log(`[EffectsStore:Cache] 🌐 Fetching from API: ${id} (category: ${category})`);

    // 4. Fetch from API (last resort)
    // API returns raw TextEffectConfig format (flat structure)
    const catKey = category.toLowerCase();
    const startTime = performance.now();
    const res = await fetch(`${API_BASE}/text-effects/${catKey}/${id}`, {
      cache: "reload",
      headers: getApiHeaders(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const fetchTime = (performance.now() - startTime).toFixed(2);

    console.log(`[EffectsStore:Cache] 📥 Fetched raw data from API for "${id}":`, data);
    const definition = convertRawConfigToDefinition(data);
    console.log(`[EffectsStore:Cache] ⚙️ Converted definition for cache for "${id}":`, definition);

    console.log(`[EffectsStore:Cache] ✅ API FETCH SUCCESS - Effect "${id}" downloaded in ${fetchTime}ms`);
    console.log(`[EffectsStore:Cache] 💾 Caching effect "${id}" to memory + IndexedDB`);

    // Store definition in all cache layers
    set((state) => ({
      definitions: { ...state.definitions, [id]: definition },
    }));
    await persistentCache.set(id, definition); // Persist to disk

    console.log(`[EffectsStore:Cache] ✅ CACHE SAVED - Effect "${id}" now available in all cache layers`);

    return definition;
  },

  // ── selectEffect ─────────────────────────────────────────────
  // Called on card click
  // Shows spinner on card if definition not yet cached
  selectEffect: async (id, category) => {
    console.log(`[EffectsStore:Select] 🎯 Selecting effect: ${id}`);
    const catKey = category.toLowerCase();

    // Show loading state on the clicked card
    set({ loadingId: id });

    try {
      const startTime = performance.now();
      const data = await get().getDefinitionById(id, catKey);
      const loadTime = (performance.now() - startTime).toFixed(2);

      console.log(`[EffectsStore:Select] ✅ Effect loaded in ${loadTime}ms`);

      set({
        selectedEffect: data,
        selectedCategory: catKey,
        loadingId: null,
      });
    } catch (err) {
      console.error(`[EffectsStore:Select] ❌ Failed to load effect ${id}:`, err);
      set({ loadingId: null });
    }
  },

  // ── prefetchEffect ────────────────────────────────────────────
  // Called on 300ms hover hold — fire and forget, no loading state
  // Primes the cache so that selectEffect() is instant on click
  prefetchEffect: (id, category) => {
    console.log(`[EffectsStore:Prefetch] 🔮 Prefetching effect: ${id}`);
    const catKey = category.toLowerCase();
    const state = get();
    if (state.definitions[id]) {
      console.log(`[EffectsStore:Prefetch] ⏭️ Skipped - already cached: ${id}`);
      return; // already cached
    }
    if (state.prefetchingIds.has(id)) {
      console.log(`[EffectsStore:Prefetch] ⏭️ Skipped - already prefetching: ${id}`);
      return; // already in flight
    }

    set((s) => {
      const nextPrefetching = new Set(s.prefetchingIds);
      nextPrefetching.add(id);
      return { prefetchingIds: nextPrefetching };
    });

    console.log(`[EffectsStore:Prefetch] 🌐 Starting background fetch: ${id}`);
    const startTime = performance.now();

    fetch(`${API_BASE}/text-effects/${catKey}/${id}`, {
      cache: "reload",
      headers: getApiHeaders(),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        const prefetchTime = (performance.now() - startTime).toFixed(2);
        console.log(`[EffectsStore:Prefetch] ✅ Prefetch complete for ${id} in ${prefetchTime}ms`);
        console.log(`[EffectsStore:Prefetch] 📥 Prefetched raw data from API for "${id}":`, data);

        const definition = convertRawConfigToDefinition(data);
        console.log(`[EffectsStore:Prefetch] ⚙️ Converted prefetch definition for "${id}":`, definition);

        set((s) => {
          const nextPrefetching = new Set(s.prefetchingIds);
          nextPrefetching.delete(id);
          return {
            definitions: { ...s.definitions, [id]: definition },
            prefetchingIds: nextPrefetching,
          };
        });
      })
      .catch((error) => {
        console.error(`[EffectsStore:Prefetch] ❌ Prefetch failed for ${id}:`, error);
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
      const definition = convertRawConfigToDefinition(persistedDef);
      set((state) => ({
        definitions: { ...state.definitions, [id]: definition },
      }));
      return definition;
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
      const globalIndex = await TextEffectsApi.getEffectsIndex();
      globalIndexItem = globalIndex.find((x) => x.id === id);
    } catch (e) {
      console.warn("[EffectsStore] Failed to load global effects index:", e);
    }

    if (globalIndexItem) {
      const def = await get().getDefinitionById(id, globalIndexItem.category);
      return def;
    }

    // 6. Fallback: Scan known categories
    const ALL_CATEGORIES = TEXT_EFFECT_CATEGORIES;
    for (const cat of ALL_CATEGORIES) {
      try {
        const categoryManifest = await TextEffectsApi.getEffectsByCategory(cat);
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

// src/features/text-effects/store/effectsStore.test.ts
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffectsStore } from "./effectsStore";
import { TextEffectsApi } from "../api/textEffectsApi";
import { getTextEffectCache } from "../cache/persistentCache";

// Mock the persistent cache
vi.mock("../cache/persistentCache", () => ({
  getTextEffectCache: vi.fn(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  })),
}));

const mockIndexItems = [
  {
    id: "solaris-ink",
    name: "Solaris Ink",
    category: "metallic",
    isPremium: false,
    previewType: "static",
    thumbnailUrl: "https://raw.githubusercontent.com/AIEraDev/clypra-api/main/data/thumbnails/solaris-ink.png",
  },
];

const mockFullDefinition = {
  id: "solaris-ink",
  name: "Solaris Ink",
  category: "metallic",
  isPremium: false,
  previewType: "static",
  thumbnailUrl: "https://raw.githubusercontent.com/AIEraDev/clypra-api/main/data/thumbnails/solaris-ink.png",
  font: {
    family: "Montserrat",
    weight: 700,
    style: "normal",
    letterSpacing: 1,
    lineHeight: 1.2,
  },
  fills: [],
  strokes: [],
  shadows: [],
};

describe("useEffectsStore", () => {
  beforeEach(() => {
    // Reset store state
    useEffectsStore.setState({
      index: {},
      indexLoading: false,
      indexError: null,
      definitions: {},
      loadingId: null,
      prefetchingIds: new Set(),
      selectedEffect: null,
      selectedCategory: null,
    });
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("getDefinitionById - normalizes flat definitions loaded from persistent cache", async () => {
    const rawCachedDef = {
      id: "cached-neon",
      name: "Cached Neon",
      category: "neon",
      fontFamily: "Bebas Neue",
      fontWeight: 700,
      fillType: "none",
      strokeEnabled: true,
      strokeColor: "#ffffff",
      strokeWidth: 8,
      glowLayers: [{ enabled: true, color: "#ff1744", blur: 24, opacity: 80, type: "outer" }],
    };
    vi.mocked(getTextEffectCache).mockReturnValueOnce({
      get: vi.fn().mockResolvedValue(rawCachedDef),
      set: vi.fn().mockResolvedValue(undefined),
    } as any);

    const def = await useEffectsStore.getState().getDefinitionById("cached-neon", "neon");

    expect(def.font.family).toBe("Bebas Neue");
    expect(def.fills).toEqual([]);
    expect(def.strokes[0]).toMatchObject({ color: "#ffffff", width: 8 });
    expect(def.glows?.[0]).toMatchObject({ color: "#ff1744", blur: 24 });
    expect(useEffectsStore.getState().definitions["cached-neon"]).toBe(def);
  });

  test("loadCategory - success and state mapping", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockIndexItems,
    } as any);

    await useEffectsStore.getState().loadCategory("metallic");

    const state = useEffectsStore.getState();
    expect(state.indexLoading).toBe(false);
    expect(state.indexError).toBeNull();
    expect(state.index["metallic"]).toEqual(mockIndexItems);
    expect(fetchMock).toHaveBeenCalledWith("https://clypra-worker-api.abdulkabirmusa.com/text-effects/metallic", expect.any(Object));
  });

  test("loadCategory - failure", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as any);

    await useEffectsStore.getState().loadCategory("metallic");

    const state = useEffectsStore.getState();
    expect(state.indexLoading).toBe(false);
    expect(state.indexError).toBe("Failed to load effects. Tap to retry.");
    expect(state.index["metallic"]).toBeUndefined();
  });

  test("selectEffect - from network when not cached", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockFullDefinition,
    } as any);

    const selectPromise = useEffectsStore.getState().selectEffect("solaris-ink", "metallic");

    // Check in-flight loading state
    expect(useEffectsStore.getState().loadingId).toBe("solaris-ink");

    await selectPromise;

    const state = useEffectsStore.getState();
    expect(state.loadingId).toBeNull();
    expect(state.definitions["solaris-ink"]).toEqual(mockFullDefinition);
    expect(state.selectedEffect).toEqual(mockFullDefinition);
    expect(state.selectedCategory).toBe("metallic");
  });

  test("selectEffect - converts flat API config without replacing explicit zero values", async () => {
    const fetchMock = vi.mocked(fetch);
    const flatConfig = {
      id: "zero-neon",
      name: "Zero Neon",
      category: "neon",
      description: "Flat config with explicit zeros",
      tags: ["strict"],
      text: "NEON",
      fontFamily: "Bebas Neue",
      fontWeight: 700,
      fontStyle: "normal",
      fontSize: 100,
      letterSpacing: 0,
      lineHeight: 1.2,
      fillType: "none",
      fillColor: "#FFFFFF",
      fillGradientAngle: 0,
      fillGradientStops: [],
      strokeEnabled: true,
      strokeColor: "#FFFFFF",
      strokeWidth: 0,
      strokePosition: "outside",
      strokeOpacity: 0,
      strokeLineJoin: "round",
      strokeBlur: 0,
      glowLayers: [{ enabled: true, color: "#FF174D", blur: 60, opacity: 80, type: "outer", strength: 1, spread: 0 }],
      shadowEnabled: true,
      shadowColor: "#000000",
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      shadowOpacity: 0,
      shadowType: "drop",
      bevelEnabled: true,
      bevelDepth: 0,
      bevelHighlight: "#FFFFFF",
      bevelShadow: "#000000",
      bevelDirection: "bottom-right",
      bevelEdgeWidth: 0,
      bevelBlur: 0,
      bevelVanishingPointX: 0,
      bevelVanishingPointY: 0,
      stackEnabled: true,
      stackCount: 0,
      stackOffsetX: 0,
      stackOffsetY: 0,
      stackOpacityDecay: 0,
      panelEnabled: true,
      panelColor: "#000000",
      panelOpacity: 0,
      panelRadius: 0,
      panelPaddingX: 0,
      panelPaddingY: 0,
      panelStrokeEnabled: true,
      panelStrokeColor: "#FFFFFF",
      panelStrokeWidth: 0,
      canvasWidth: 800,
      canvasHeight: 200,
      textPosX: "center",
      textPosY: "middle",
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => flatConfig,
    } as any);

    await useEffectsStore.getState().selectEffect("zero-neon", "neon");

    const def = useEffectsStore.getState().selectedEffect as any;
    expect(def.font.letterSpacing).toBe(0);
    expect(def.fontSize).toBe(100);
    expect(def.canvasWidth).toBe(800);
    expect(def.strokes[0].width).toBe(0);
    expect(def.strokes[0].opacity).toBe(0);
    expect(def.shadows[0].blur).toBe(0);
    expect(def.shadows[0].offsetX).toBe(0);
    expect(def.shadows[0].offsetY).toBe(0);
    expect(def.shadows[0].opacity).toBe(0);
    expect(def.bevel.depth).toBe(0);
    expect(def.bevel.edgeWidth).toBe(0);
    expect(def.bevel.blur).toBe(0);
    expect(def.bevel.vanishingPointX).toBe(0);
    expect(def.bevel.vanishingPointY).toBe(0);
    expect(def.stack.count).toBe(0);
    expect(def.stack.offsetX).toBe(0);
    expect(def.stack.offsetY).toBe(0);
    expect(def.stack.opacityDecay).toBe(0);
    expect(def.panel.opacity).toBe(0);
    expect(def.panel.radius).toBe(0);
    expect(def.panel.paddingX).toBe(0);
    expect(def.panel.paddingY).toBe(0);
    expect(def.panel.stroke.width).toBe(0);
    expect(def.boundingBox).toEqual({ mode: "panel", paddingX: 0, paddingY: 0 });
  });

  test("selectEffect - instant from cache", async () => {
    const fetchMock = vi.mocked(fetch);
    useEffectsStore.setState({
      definitions: { "solaris-ink": mockFullDefinition as any },
    });

    await useEffectsStore.getState().selectEffect("solaris-ink", "metallic");

    const state = useEffectsStore.getState();
    expect(state.selectedEffect).toEqual(mockFullDefinition);
    expect(state.selectedCategory).toBe("metallic");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("prefetchEffect - background fetch hold to cache", async () => {
    const fetchMock = vi.mocked(fetch);

    // Create a deferred promise to control when fetch resolves
    let resolveFetch: any;
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });

    fetchMock.mockReturnValueOnce(
      fetchPromise.then(() => ({
        ok: true,
        json: async () => mockFullDefinition,
      })) as any,
    );

    useEffectsStore.getState().prefetchEffect("solaris-ink", "metallic");

    // prefetchingIds should record active background requests
    expect(useEffectsStore.getState().prefetchingIds.has("solaris-ink")).toBe(true);

    // Resolve network request
    resolveFetch();

    // Wait for event loop ticks
    await new Promise((r) => setTimeout(r, 10));

    const state = useEffectsStore.getState();
    expect(state.prefetchingIds.has("solaris-ink")).toBe(false);
    expect(state.definitions["solaris-ink"]).toEqual(mockFullDefinition);
  });

  test("clearSelected - resets state", () => {
    useEffectsStore.setState({
      selectedEffect: mockFullDefinition as any,
      selectedCategory: "metallic",
    });

    useEffectsStore.getState().clearSelected();

    const state = useEffectsStore.getState();
    expect(state.selectedEffect).toBeNull();
    expect(state.selectedCategory).toBeNull();
  });

  test("resolves built-in presets synchronously even when cache is reset", async () => {
    // Reset cache to simulate a completely fresh store or empty cache
    useEffectsStore.setState({ definitions: {} });

    // Try fetching only by ID
    const def = await useEffectsStore.getState().fetchDefinitionOnlyById("premium-sticker");

    expect(def).toBeDefined();
    expect(def.id).toBe("premium-sticker");
    expect(def.name).toBe("STICKER");
    expect(def.font.family).toBe("Arial Rounded MT Bold");
  });

  test("fetchDefinitionOnlyById - falls back to local loaded indexes first", async () => {
    const fetchMock = vi.mocked(fetch);

    // Start with clean state - reset definitions to only include built-in presets (empty for test)
    useEffectsStore.setState({
      definitions: {}, // Clear any cached definitions
      index: {
        metallic: [
          {
            id: "solaris-ink",
            name: "Solaris Ink",
            category: "metallic",
          } as any,
        ],
      },
    });

    // Mock fetch for getDefinitionById
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockFullDefinition,
    } as any);

    const def = await useEffectsStore.getState().fetchDefinitionOnlyById("solaris-ink");

    expect(def).toEqual(mockFullDefinition);
    // When an item is in the loaded index, getDefinitionById is called which fetches from API
    expect(fetchMock).toHaveBeenCalledWith("https://clypra-worker-api.abdulkabirmusa.com/text-effects/metallic/solaris-ink", expect.any(Object));
  });

  test("fetchDefinitionOnlyById - falls back to category scanning if not in global index", async () => {
    const fetchMock = vi.mocked(fetch);

    // 1. global index fetch fails or doesn't have it
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [], // Empty global index
    } as any);

    // 2. Scanning categories: first few categories return 404/empty, outline returns the match
    // ALL_CATEGORIES order: ["3d", "neon", "metallic", "glitch", "retro", "gradient", "grunge", "outline", ...]
    // 3d (not found)
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 } as any);
    // neon (not found)
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 } as any);
    // metallic (not found)
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 } as any);
    // glitch (not found)
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 } as any);
    // retro (not found)
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 } as any);
    // gradient (not found)
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 } as any);
    // grunge (not found)
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 } as any);
    // outline (found!)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: "arctic-monolith", name: "Arctic Monolith", category: "outline" }],
    } as any);
    // 3. fetch definition for outline/arctic-monolith
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "arctic-monolith", name: "Arctic Monolith", category: "outline", font: {}, fills: [], strokes: [], shadows: [] }),
    } as any);

    const def = await useEffectsStore.getState().fetchDefinitionOnlyById("arctic-monolith");

    expect(def.id).toBe("arctic-monolith");
    expect(def.category).toBe("outline");

    // Check that category index was cached in state
    expect(useEffectsStore.getState().index["outline"]).toBeDefined();
    expect(useEffectsStore.getState().index["outline"][0].id).toBe("arctic-monolith");
  });

  test("TextEffectsApi.getFullEffect - automatically updates useEffectsStore definitions", async () => {
    const fetchMock = vi.mocked(fetch);
    const mockDef = {
      id: "arctic-monolith",
      name: "Arctic Monolith",
      category: "outline",
      font: {},
      fills: [],
      strokes: [],
      shadows: [],
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockDef,
    } as any);

    // Call API helper
    const data = await TextEffectsApi.getFullEffect("outline", "arctic-monolith");

    expect(data).toEqual(mockDef);

    // Ensure definition was synced into store cache
    const cachedStoreDef = useEffectsStore.getState().definitions["arctic-monolith"];
    expect(cachedStoreDef).toBeDefined();
    expect(cachedStoreDef.name).toBe("Arctic Monolith");
  });

  test("TextEffectsApi.getFullEffect - normalizes flat API payload before caching", async () => {
    const fetchMock = vi.mocked(fetch);
    const rawDef = {
      id: "neon-crimson",
      name: "Neon Crimson",
      category: "neon",
      fontFamily: "Bebas Neue",
      fontWeight: 700,
      fillType: "none",
      strokeEnabled: true,
      strokeColor: "#ffffff",
      strokeWidth: 10,
      glowLayers: [{ enabled: true, color: "#ff1744", blur: 32, opacity: 85, type: "outer" }],
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => rawDef,
    } as any);

    const data = await TextEffectsApi.getFullEffect("neon", "neon-crimson");
    const cachedStoreDef = useEffectsStore.getState().definitions["neon-crimson"];

    expect(data.font.family).toBe("Bebas Neue");
    expect(data.fills).toEqual([]);
    expect(data.strokes[0]).toMatchObject({ color: "#ffffff", width: 10 });
    expect(data.glows?.[0]).toMatchObject({ color: "#ff1744", blur: 32 });
    expect(cachedStoreDef).toBe(data);
    expect(cachedStoreDef.font.family).toBe("Bebas Neue");
  });
});

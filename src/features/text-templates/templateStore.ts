import { create } from "zustand";
import { TemplateDefinition, TemplateCustomization, TemplateCategory, RenderedFrameSequence } from "./types";
import { renderToFrameSequence } from "./FrameRenderer";
import { TextEffectsApi } from "@/features/text-effects/api/textEffectsApi";
import { ALL_TEMPLATES } from "./templates/index";
import { getCached, setCached, prefetchAndCache } from "@/lib/cache/apiCache";

interface TemplateState {
  templates: TemplateDefinition[];
  selectedTemplate: TemplateDefinition | null;
  customization: TemplateCustomization;
  isRendering: boolean;
  isLoading: boolean;
  isApiConnected: boolean;
  renderProgress: number; // 0–100
  activeCategory: TemplateCategory | "all";
  searchQuery: string;

  // Actions
  loadTemplates: () => Promise<void>;
  selectTemplate: (template: TemplateDefinition | null) => Promise<void>;
  updateCustomization: (partial: Partial<TemplateCustomization>) => void;
  setCategory: (category: TemplateCategory | "all") => void;
  setSearchQuery: (query: string) => void;
  startRender: () => Promise<RenderedFrameSequence>;
  cancelRender: () => void;
  preloadTemplatesAndFontsForClips: (clips: any[]) => Promise<void>;
  reset: () => void;
}

let renderCancelToken = { cancelled: false };

export const useTemplateStore = create<TemplateState>((set, get) => ({
  templates: [],
  selectedTemplate: null,
  customization: {
    primaryText: "Clypra",
    secondaryText: "",
    accentText: "",
  },
  isRendering: false,
  isLoading: false,
  isApiConnected: false,
  renderProgress: 0,
  activeCategory: "all",
  searchQuery: "",

  loadTemplates: async () => {
    set({ isLoading: true });

    try {
      // Use unified cache with prefetch
      const apiTemplates = await prefetchAndCache("text-templates:index", () => TextEffectsApi.getTemplatesIndex());

      set({
        templates: apiTemplates,
        isApiConnected: true,
        isLoading: false,
      });
    } catch (err) {
      console.warn("[Clypra:TemplateStore] Failed to fetch templates from API, falling back to static templates:", err);
      set({
        templates: ALL_TEMPLATES,
        isApiConnected: false,
        isLoading: false,
      });
    }
  },

  selectTemplate: async (template) => {
    if (!template) {
      set({
        selectedTemplate: null,
        customization: { primaryText: "Clypra", secondaryText: "", accentText: "" },
      });
      return;
    }

    let loadedTemplate = { ...template };

    // Check if template data is already loaded
    const templateData = loadedTemplate.templateData || loadedTemplate.lottieData;
    if (!templateData) {
      // Try to load from unified cache first
      const cacheKey = `text-templates:${loadedTemplate.category}:${loadedTemplate.id}:${(loadedTemplate as any).revisionId || "latest"}` as const;
      const cachedData = getCached<any>(cacheKey);

      if (cachedData) {
        loadedTemplate.templateData = cachedData;
        loadedTemplate.lottieData = cachedData;

        // Update store cache
        set((state) => ({
          templates: state.templates.map((t) => (t.id === loadedTemplate.id ? { ...t, templateData: cachedData, lottieData: cachedData } : t)),
        }));
      } else {
        // Cache miss - fetch from API
        try {
          set({ isLoading: true });
          const revisionId = (loadedTemplate as any).revisionId;
          const data = revisionId
            ? await TextEffectsApi.getTemplateData(loadedTemplate.category, loadedTemplate.id, { revisionId })
            : await TextEffectsApi.getTemplateData(loadedTemplate.category, loadedTemplate.id);
          loadedTemplate.templateData = data;
          loadedTemplate.lottieData = data;

          // Cache the fetched data
          setCached(cacheKey, data);

          // Update store cache
          set((state) => ({
            templates: state.templates.map((t) => (t.id === loadedTemplate.id ? { ...t, templateData: data, lottieData: data } : t)),
            isLoading: false,
          }));
        } catch (err) {
          console.error(`[Clypra:TemplateStore] Failed to load template data for template ${loadedTemplate.id}:`, err);
          set({ isLoading: false });

          // Fallback to static templates
          const fallback = ALL_TEMPLATES.find((t) => t.id === loadedTemplate.id);
          const fallbackData = fallback?.templateData || fallback?.lottieData;
          if (fallbackData) {
            loadedTemplate.templateData = fallbackData;
            loadedTemplate.lottieData = fallbackData;
          } else {
            loadedTemplate.templateData = {};
            loadedTemplate.lottieData = {};
          }
        }
      }
    }

    // Initialize customisation with defaults from the selected template
    const fullTemplate = loadedTemplate.templateData || loadedTemplate.lottieData || loadedTemplate;
    const textLayers = (fullTemplate.layers || []).filter((l: any) => l.kind === "text") as any[];
    const primary = textLayers.find((tl) => tl.role === "primary")?.content || "Clypra";
    const secondary = textLayers.find((tl) => tl.role === "secondary")?.content || "";
    const accent = textLayers.find((tl) => tl.role === "accent")?.content || "";

    set({
      selectedTemplate: loadedTemplate,
      customization: {
        primaryText: primary,
        secondaryText: secondary,
        accentText: accent,
      },
    });
  },

  updateCustomization: (partial) => {
    set((state) => ({
      customization: {
        ...state.customization,
        ...partial,
      },
    }));
  },

  setCategory: (category) => {
    set({ activeCategory: category });
  },

  setSearchQuery: (query) => {
    set({ searchQuery: query });
  },

  startRender: async (): Promise<RenderedFrameSequence> => {
    const selected = get().selectedTemplate;
    if (!selected) {
      throw new Error("No template selected for rendering");
    }

    set({ isRendering: true, renderProgress: 0 });
    renderCancelToken.cancelled = false;
    const activeToken = renderCancelToken;

    try {
      // 1. Prepare customizable Template object
      let data = selected.templateData || selected.lottieData || selected;

      // Ensure template data is dynamically fetched if we bypass standard select
      if (!data.layers || data.layers.length === 0) {
        try {
          data = await TextEffectsApi.getTemplateData(selected.category, selected.id);
        } catch (e) {
          // Fallback to static meta
          const staticFallback = ALL_TEMPLATES.find((t) => t.id === selected.id);
          data = staticFallback?.templateData || staticFallback?.lottieData || staticFallback || selected;
        }
      }

      // 2. Perform the frame-by-frame render
      const sequence = await renderToFrameSequence(data, get().customization, (progress) => {
        if (activeToken.cancelled) {
          throw new Error("Render cancelled by user");
        }
        set({ renderProgress: progress });
      });

      set({ isRendering: false, renderProgress: 100 });
      return sequence;
    } catch (err: any) {
      set({ isRendering: false, renderProgress: 0 });
      throw err;
    }
  },

  cancelRender: () => {
    renderCancelToken.cancelled = true;
    set({ isRendering: false, renderProgress: 0 });
  },

  preloadTemplatesAndFontsForClips: async (clips: any[]) => {
    if (!clips?.length) return;

    // Filter clips that have templateId
    const templateIds = Array.from(new Set(clips.map((clip) => clip?.templateId).filter((id): id is string => typeof id === "string" && id.length > 0)));

    if (templateIds.length === 0) return;

    try {
      // 1. Ensure templates list is loaded (check cache first)
      let templates = get().templates;
      if (templates.length === 0) {
        await get().loadTemplates();
        templates = get().templates;
      }

      // 2. Fetch template data for each missing template (check cache first)
      const fontDescriptors: { family: string; weight: number; style: "normal" | "italic" }[] = [];

      await Promise.all(
        templateIds.map(async (id) => {
          const rawTemplate = templates.find((t) => t.id === id);
          if (!rawTemplate) return;

          let templateData = rawTemplate.templateData || rawTemplate.lottieData;

          if (!templateData) {
            // Try unified cache first
            const cacheKey = `text-templates:${rawTemplate.category}:${id}:${(rawTemplate as any).revisionId || "latest"}` as const;
            const cachedData = getCached<any>(cacheKey);

            if (cachedData) {
              templateData = cachedData;

              // Update store cache
              set((state) => ({
                templates: state.templates.map((t) => (t.id === id ? { ...t, templateData: cachedData, lottieData: cachedData } : t)),
              }));
            } else {
              // Cache miss - fetch from API
              try {
                const revisionId = (rawTemplate as any).revisionId;
                templateData = revisionId
                  ? await TextEffectsApi.getTemplateData(rawTemplate.category, rawTemplate.id, { revisionId })
                  : await TextEffectsApi.getTemplateData(rawTemplate.category, rawTemplate.id);

                // Cache the fetched data
                setCached(cacheKey, templateData);

                // Update store cache
                set((state) => ({
                  templates: state.templates.map((t) => (t.id === id ? { ...t, templateData, lottieData: templateData } : t)),
                }));

                import("@/store/timelineStore")
                  .then(({ useTimelineStore }) => {
                    useTimelineStore.getState().incrementEpoch();
                  })
                  .catch(() => {});
              } catch (err) {
                console.error(`[Clypra:TemplateStore] Preload failed for template ${id}:`, err);
                return;
              }
            }
          }

          // Collect fonts from template layers
          if (templateData && templateData.layers) {
            for (const layer of templateData.layers) {
              if (layer.kind === "text" && layer.fontFamily) {
                fontDescriptors.push({
                  family: layer.fontFamily,
                  weight: layer.fontWeight || 400,
                  style: "normal" as const,
                });
              }
            }
          }
        }),
      );

      // 3. Preload all collected fonts
      if (fontDescriptors.length > 0) {
        const { getFontLoader } = await import("@/core/fonts/FontLoader");
        try {
          await getFontLoader().ensureFonts(fontDescriptors);
          const { useTimelineStore } = await import("@/store/timelineStore");
          useTimelineStore.getState().incrementEpoch();
        } catch (fontErr) {
          console.warn("[Clypra:TemplateStore] Failed to preload template fonts:", fontErr);
        }
      }
    } catch (err) {
      console.warn("[Clypra:TemplateStore] Preload templates and fonts failed:", err);
    }
  },

  reset: () => {
    get().cancelRender();
    set({
      selectedTemplate: null,
      customization: {
        primaryText: "Clypra",
        secondaryText: "",
        accentText: "",
      },
      isRendering: false,
      renderProgress: 0,
      activeCategory: "all",
      searchQuery: "",
    });
  },
}));

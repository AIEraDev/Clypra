import { describe, it, expect, vi, beforeEach } from "vitest";
import { useTemplateStore } from "../templateStore";
import { TextEffectsApi } from "@/features/text-effects/api/textEffectsApi";
import { getFontLoader } from "@/core/fonts/FontLoader";

vi.mock("@/features/text-effects/api/textEffectsApi", () => ({
  TextEffectsApi: {
    getTemplatesIndex: vi.fn(),
    getTemplateData: vi.fn(),
  },
}));

vi.mock("@/core/fonts/FontLoader", () => ({
  getFontLoader: vi.fn(() => ({
    ensureFonts: vi.fn(),
  })),
}));

describe("TemplateStore Preloading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTemplateStore.setState({
      templates: [],
      selectedTemplate: null,
      customization: { primaryText: "Clypra", secondaryText: "", accentText: "" },
    });
  });

  it("should preload templates and their fonts successfully", async () => {
    const mockTemplatesIndex = [
      { id: "tpl-1", label: "Template 1", category: "lower-third" },
    ];
    const mockTemplateData = {
      id: "tpl-1",
      category: "lower-third",
      layers: [
        { kind: "text", fontFamily: "Roboto", fontWeight: 700 },
        { kind: "shape" },
      ],
    };

    vi.mocked(TextEffectsApi.getTemplatesIndex).mockResolvedValue(mockTemplatesIndex as any);
    vi.mocked(TextEffectsApi.getTemplateData).mockResolvedValue(mockTemplateData as any);

    const mockFontLoaderInstance = {
      ensureFonts: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(getFontLoader).mockReturnValue(mockFontLoaderInstance as any);

    const clips = [
      { id: "clip-1", templateId: "tpl-1" },
    ];

    await useTemplateStore.getState().preloadTemplatesAndFontsForClips(clips);

    // Verify index is loaded
    expect(TextEffectsApi.getTemplatesIndex).toHaveBeenCalled();

    // Verify template data is fetched
    expect(TextEffectsApi.getTemplateData).toHaveBeenCalledWith("lower-third", "tpl-1");

    // Verify store cache is updated
    const cached = useTemplateStore.getState().templates.find(t => t.id === "tpl-1");
    expect(cached?.templateData).toEqual(mockTemplateData);

    // Verify fonts are preloaded
    expect(mockFontLoaderInstance.ensureFonts).toHaveBeenCalledWith([
      { family: "Roboto", weight: 700, style: "normal" },
    ]);
  });

  it("fetches a full revision when the catalog only contains a summary", async () => {
    const summary = { id: "tpl-summary", label: "Summary", category: "callout", revisionId: "rev-2", thumbnailUrl: "thumb.png" };
    const full = {
      id: "tpl-summary",
      category: "callout",
      duration: 2,
      layers: [{ id: "title", kind: "text", content: "Loaded", x: 0, y: 0, width: 300, height: 80 }],
    };
    vi.mocked(TextEffectsApi.getTemplateData).mockResolvedValue(full as any);
    useTemplateStore.setState({ templates: [summary as any] });

    await useTemplateStore.getState().selectTemplate(summary as any);

    expect(TextEffectsApi.getTemplateData).toHaveBeenCalledWith("callout", "tpl-summary", { revisionId: "rev-2" });
    expect(useTemplateStore.getState().selectedTemplate?.templateData).toEqual(full);
  });
});

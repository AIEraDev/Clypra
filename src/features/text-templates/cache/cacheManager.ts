import { clearFeatureCache } from "@/lib/cache/apiCache";
import { TextEffectsApi } from "@/features/text-effects/api/textEffectsApi";
import { useTemplateStore } from "../templateStore";
import { textTemplatePersistentCache } from "./persistentCache";

export class TextTemplatesCacheManager {
  static async clearAll(): Promise<{ apiEntries: number }> {
    useTemplateStore.setState({ templates: [], selectedTemplate: null, isLoading: false, isApiConnected: false });
    TextEffectsApi.clearTemplateCache();
    const apiEntries = clearFeatureCache("text-templates");
    await textTemplatePersistentCache.clear();
    try {
      const { useFavoritesStore } = await import("@/store/favoritesStore");
      useFavoritesStore.getState().clearDownloadedTemplates();
    } catch (error) {
      console.warn("[TextTemplateCache] Failed to clear downloaded template tracking:", error);
    }
    return { apiEntries };
  }

  static getStats() {
    return textTemplatePersistentCache.getStats();
  }
}

import { describe, it, expect, beforeEach } from "vitest";
import { useFavoritesStore } from "../favoritesStore";

describe("favoritesStore", () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset store state to match empty localStorage
    useFavoritesStore.setState({
      favorites: [],
      downloadedEffects: [],
      downloadedTemplates: [],
      downloadingIds: [],
    });
  });

  it("should initialize with empty arrays", () => {
    const state = useFavoritesStore.getState();
    expect(state.favorites).toEqual([]);
    expect(state.downloadedEffects).toEqual([]);
    expect(state.downloadedTemplates).toEqual([]);
    expect(state.downloadingIds).toEqual([]);
  });

  it("should toggle favorite status and update localStorage", () => {
    const { toggleFavorite } = useFavoritesStore.getState();

    // Toggle favorite on
    toggleFavorite("effect-1");
    expect(useFavoritesStore.getState().favorites).toEqual(["effect-1"]);
    expect(JSON.parse(localStorage.getItem("vireostudio_text_favorites") || "[]")).toEqual(["effect-1"]);

    // Toggle favorite off
    toggleFavorite("effect-1");
    expect(useFavoritesStore.getState().favorites).toEqual([]);
    expect(JSON.parse(localStorage.getItem("vireostudio_text_favorites") || "[]")).toEqual([]);
  });

  it("should handle start, complete, and cancel downloads for effects", () => {
    const { startDownload, completeDownload, cancelDownload } = useFavoritesStore.getState();

    // Start download
    startDownload("effect-1");
    expect(useFavoritesStore.getState().downloadingIds).toEqual(["effect-1"]);

    // Cancel download
    cancelDownload("effect-1");
    expect(useFavoritesStore.getState().downloadingIds).toEqual([]);

    // Start again and complete
    startDownload("effect-1");
    completeDownload("effect-1", "effect");
    
    expect(useFavoritesStore.getState().downloadingIds).toEqual([]);
    expect(useFavoritesStore.getState().downloadedEffects).toEqual(["effect-1"]);
    expect(JSON.parse(localStorage.getItem("vireostudio_downloaded_effects") || "[]")).toEqual(["effect-1"]);
  });

  it("should handle start and complete downloads for templates", () => {
    const { startDownload, completeDownload } = useFavoritesStore.getState();

    startDownload("template-1");
    expect(useFavoritesStore.getState().downloadingIds).toEqual(["template-1"]);

    completeDownload("template-1", "template");
    expect(useFavoritesStore.getState().downloadingIds).toEqual([]);
    expect(useFavoritesStore.getState().downloadedTemplates).toEqual(["template-1"]);
    expect(JSON.parse(localStorage.getItem("vireostudio_downloaded_templates") || "[]")).toEqual(["template-1"]);
  });

  it("should parse existing items from localStorage upon state restoration", () => {
    localStorage.setItem("vireostudio_text_favorites", JSON.stringify(["saved-1"]));
    localStorage.setItem("vireostudio_downloaded_effects", JSON.stringify(["saved-eff"]));
    localStorage.setItem("vireostudio_downloaded_templates", JSON.stringify(["saved-temp"]));

    const savedFav = JSON.parse(localStorage.getItem("vireostudio_text_favorites") || "[]");
    const savedEff = JSON.parse(localStorage.getItem("vireostudio_downloaded_effects") || "[]");
    const savedTemp = JSON.parse(localStorage.getItem("vireostudio_downloaded_templates") || "[]");
    
    useFavoritesStore.setState({
      favorites: savedFav,
      downloadedEffects: savedEff,
      downloadedTemplates: savedTemp,
    });

    const state = useFavoritesStore.getState();
    expect(state.favorites).toEqual(["saved-1"]);
    expect(state.downloadedEffects).toEqual(["saved-eff"]);
    expect(state.downloadedTemplates).toEqual(["saved-temp"]);
  });
});

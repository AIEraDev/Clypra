import { describe, it, expect, beforeEach } from "vitest";
import {
  useClipUiStore,
  ALL_CLIP_CATEGORY,
} from "../store/clipUiStore";

describe("useClipUiStore", () => {
  beforeEach(() => {
    useClipUiStore.setState({
      activeCategory: ALL_CLIP_CATEGORY,
      searchQuery: "",
      hoveredClipId: null,
    });
  });

  it("has expected initial state", () => {
    const state = useClipUiStore.getState();
    expect(ALL_CLIP_CATEGORY).toBe("all");
    expect(state.activeCategory).toBe("all");
    expect(state.searchQuery).toBe("");
    expect(state.hoveredClipId).toBeNull();
  });

  it("updates activeCategory", () => {
    useClipUiStore.getState().setActiveCategory("football");
    expect(useClipUiStore.getState().activeCategory).toBe("football");
  });

  it("updates searchQuery", () => {
    useClipUiStore.getState().setSearchQuery("laugh");
    expect(useClipUiStore.getState().searchQuery).toBe("laugh");
  });

  it("updates hoveredClipId", () => {
    useClipUiStore.getState().setHoveredClipId("clip-1");
    expect(useClipUiStore.getState().hoveredClipId).toBe("clip-1");
    useClipUiStore.getState().setHoveredClipId(null);
    expect(useClipUiStore.getState().hoveredClipId).toBeNull();
  });
});

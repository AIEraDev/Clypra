import { beforeEach, describe, expect, it } from "vitest";
import { useStickerUiStore } from "@/features/stickers/store/stickerUiStore";

describe("sticker browsing UI state", () => {
  beforeEach(() => {
    useStickerUiStore.setState({
      activeSubTab: "stickers",
      searchQuery: "",
      activeCategory: "all",
      yoursFilter: "recent",
      scrollTop: 0,
    });
  });

  it("keeps browsing choices in the session store instead of component state", () => {
    const store = useStickerUiStore.getState();
    store.setActiveSubTab("yours");
    store.setSearchQuery("spark");
    store.setActiveCategory("celebration");
    store.setYoursFilter("favorites");
    store.setScrollTop(240);

    expect(useStickerUiStore.getState()).toMatchObject({
      activeSubTab: "yours",
      searchQuery: "spark",
      activeCategory: "celebration",
      yoursFilter: "favorites",
      scrollTop: 240,
    });
  });
});

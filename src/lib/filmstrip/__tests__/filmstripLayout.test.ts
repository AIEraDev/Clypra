import { describe, expect, it } from "vitest";
import { getFilmstripRenderWindow, getFilmstripTileSlots } from "../filmstripLayout";
import { SpatialTier } from "../../renderEngine/types";

describe("getFilmstripRenderWindow", () => {
  it("keeps the raster surface bounded at deep zoom", () => {
    const window = getFilmstripRenderWindow({
      clipStartTime: 0,
      clipWidthPx: 35_600,
      trimIn: 0,
      trimOut: 89,
      viewportScrollLeft: 20_000,
      viewportWidth: 2_200,
      pixelsPerSecond: 400,
    });

    expect(window.isVisible).toBe(true);
    expect(window.leftPx).toBe(18_900);
    expect(window.widthPx).toBe(4_400);
    expect(window.trimIn).toBeCloseTo(47.25, 5);
    expect(window.trimOut).toBeCloseTo(58.25, 5);
  });

  it("moves the bounded surface when the viewport scrolls", () => {
    const first = getFilmstripRenderWindow({
      clipStartTime: 0,
      clipWidthPx: 10_000,
      trimIn: 0,
      trimOut: 100,
      viewportScrollLeft: 0,
      viewportWidth: 1_000,
      pixelsPerSecond: 100,
    });
    const second = getFilmstripRenderWindow({
      clipStartTime: 0,
      clipWidthPx: 10_000,
      trimIn: 0,
      trimOut: 100,
      viewportScrollLeft: 2_000,
      viewportWidth: 1_000,
      pixelsPerSecond: 100,
    });

    expect(second.leftPx).toBeGreaterThan(first.leftPx);
    expect(second.trimIn).toBeGreaterThan(first.trimIn);
  });
});

describe("getFilmstripTileSlots", () => {
  it("uses deterministic fixed-width slots for exact addresses", () => {
    const slots = getFilmstripTileSlots({
      addresses: [0, 5, 10].map((timestamp, tileIndex) => ({
        clipId: "clip-1",
        zoomTier: SpatialTier.L1,
        tileIndex,
        timestamp,
      })),
      clipWidthPx: 100,
      trimIn: 0,
      trimOut: 10,
      tileWidthPx: 50,
    });

    expect(slots.map((slot) => [slot.leftPx, slot.widthPx])).toEqual([
      [0, 10],
      [50, 10],
      [100, 10],
    ]);
  });

  it("ensures consecutive tiles are contiguous with zero gaps", () => {
    const pps = 100; // 100 px/s
    const addresses = [0, 1, 2, 3, 4].map((timestamp, tileIndex) => ({
      clipId: "clip-1",
      zoomTier: SpatialTier.L1, // interval = 1.0s
      tileIndex,
      timestamp,
    }));

    const slots = getFilmstripTileSlots({
      addresses,
      clipWidthPx: 500,
      trimIn: 0,
      trimOut: 5,
      tileWidthPx: 50,
      pixelsPerSecond: pps,
    });

    expect(slots).toHaveLength(5);
    for (let i = 0; i < slots.length - 1; i++) {
      // Current tile right edge MUST equal next tile left edge (ZERO GAPS!)
      const currentRight = slots[i].leftPx + slots[i].widthPx;
      const nextLeft = slots[i + 1].leftPx;
      expect(currentRight).toBeCloseTo(nextLeft, 4);
    }
  });

  it("maintains rock-solid timeline world-space coordinate invariance across arbitrary scroll positions", () => {
    // 60s clip at 50px/s => 3000px wide. Tiles generated every 1s.
    const addresses = Array.from({ length: 60 }, (_, i) => ({
      clipId: "clip-scroll-test",
      zoomTier: SpatialTier.L1,
      tileIndex: i,
      timestamp: i * 1.0,
    }));

    const pps = 50;
    const clipTrimIn = 0;
    const clipTrimOut = 60;
    const tileWidthPx = 50;

    // Simulate 3 different scroll positions: 0px, 237px, and 1420px
    const scrollPositions = [0, 237, 1420];

    for (const renderWindowLeftPx of scrollPositions) {
      const renderWindowTrimIn = clipTrimIn + renderWindowLeftPx / pps;
      const renderWindowTrimOut = renderWindowTrimIn + 1000 / pps; // 1000px viewport

      const slots = getFilmstripTileSlots({
        addresses,
        clipWidthPx: 3000,
        trimIn: renderWindowTrimIn,
        trimOut: renderWindowTrimOut,
        tileWidthPx,
        pixelsPerSecond: pps,
        renderWindowLeftPx,
        clipTrimIn,
      });

      expect(slots.length).toBeGreaterThan(0);

      // Invariant: For EVERY visible slot, (renderWindowLeftPx + slot.leftPx) MUST EQUAL (timestamp - clipTrimIn) * pps
      for (const slot of slots) {
        const physicalWorldX = renderWindowLeftPx + slot.leftPx;
        const expectedWorldX = (slot.address.timestamp - clipTrimIn) * pps;
        expect(physicalWorldX).toBeCloseTo(expectedWorldX, 4);
      }
    }
  });

  it("seamlessly includes boundary-straddling tiles without blank gaps", () => {
    const addresses = [0, 1, 2, 3, 4, 5].map((timestamp, tileIndex) => ({
      clipId: "clip-1",
      zoomTier: SpatialTier.L1,
      tileIndex,
      timestamp,
    }));

    // Viewport starts at 0.4s (between tile 0 at 0.0s and tile 1 at 1.0s)
    const slots = getFilmstripTileSlots({
      addresses,
      clipWidthPx: 300,
      trimIn: 0.4,
      trimOut: 3.2,
      tileWidthPx: 50,
      pixelsPerSecond: 50,
      renderWindowLeftPx: 20, // 0.4s * 50 = 20px
      clipTrimIn: 0,
    });

    // Tile 0 (0.0s) spans [0.0s, 1.0s], which covers [0.4s, 1.0s] => MUST be present!
    const tile0 = slots.find((s) => s.address.timestamp === 0);
    expect(tile0).toBeDefined();
    // Tile 0's canvas leftPx should be (0 - 0)*50 - 20 = -20px (clipped to canvas edge)
    expect(tile0?.leftPx).toBe(-20);
  });
});

import { describe, expect, it, vi } from "vitest";
import { resolveTextBackgroundGeometry } from "../backgroundGeometry";
import { calculateTextClipSize, effectBleed } from "../textClip";

describe("text background geometry", () => {
  it("CLY-TEXT-031: keeps legacy single-padding projects visually stable", () => {
    expect(resolveTextBackgroundGeometry({ padding: 18 })).toMatchObject({
      paddingX: 18,
      paddingY: 18,
      opacity: 100,
      yOffset: 50,
      style: "rectangle",
    });
  });

  it("CLY-TEXT-032: resolves Width and Height independently for render and bounds", () => {
    const background = { padding: 8, width: 36, height: 12, opacity: 45 };
    expect(resolveTextBackgroundGeometry(background)).toMatchObject({
      paddingX: 36,
      paddingY: 12,
      opacity: 45,
    });
    // Raster safety bleed may be larger than the visible panel, but it must
    // preserve the independent horizontal/vertical authored values.
    expect(effectBleed({ background })).toMatchObject({ x: 42, y: 14 });

    const sized = calculateTextClipSize({
      text: "Panel",
      fontFamily: "Inter",
      fontSize: 48,
      background,
      canvasWidth: 1920,
    });
    // 36px authored panel padding and the Studio renderer's fixed 16px safe
    // inset on each side must be persisted in the box. No raster-only
    // heuristic may inflate one horizontal side of the selection.
    expect(sized.width).toBeGreaterThanOrEqual(sized.measuredWidth + 104);
    expect(sized.height).toBeGreaterThan(48 + 20);
    expect(sized.bounds.selectionInset).toBe(0);
  });

  it("clamps persisted inspector values to safe renderer ranges", () => {
    expect(
      resolveTextBackgroundGeometry({
        padding: -1,
        width: -20,
        height: Number.NaN,
        opacity: 500,
        yOffset: -1,
      }),
    ).toMatchObject({ paddingX: 0, paddingY: 0, opacity: 100, yOffset: 0 });
  });

  it("CLY-TEXT-035: includes stroke in a multiline background's authored bounds", () => {
    const sized = calculateTextClipSize({
      text: "HEY GUYS,\nABDULKABIR",
      fontFamily: "Inter",
      fontSize: 96,
      stroke: { width: 20 },
      background: { padding: 8, width: 18, height: 12 },
      canvasWidth: 1920,
    });

    // The visible panel encloses the painted stroke, rather than leaving it
    // outside the persisted selection layout.
    expect(sized.width - sized.measuredWidth).toBeGreaterThanOrEqual(76);
    expect(sized.height).toBeGreaterThan(96 * 2 + 64);
  });

  it("CLY-TEXT-038: measures project-font bounds on Studio's OffscreenCanvas path", () => {
    const createElement = vi.spyOn(document, "createElement");
    const offscreenFactory = vi.fn(function () {
      return {
        getContext: () => ({
          font: "",
          letterSpacing: "0px",
          measureText: () => ({ width: 600, actualBoundingBoxAscent: 80 }),
        }),
      };
    });
    vi.stubGlobal("OffscreenCanvas", offscreenFactory);

    try {
      calculateTextClipSize({
        text: "ABDULKABIR",
        fontFamily: "Project Font",
        fontSize: 96,
        background: { padding: 8, width: 18, height: 12 },
        canvasWidth: 1920,
      });

      expect(offscreenFactory).toHaveBeenCalledWith(1, 1);
      expect(createElement).not.toHaveBeenCalledWith("canvas");
    } finally {
      createElement.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

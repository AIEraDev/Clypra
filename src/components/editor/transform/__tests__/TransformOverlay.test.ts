import { describe, expect, it, vi } from "vitest";
import * as ProjectSession from "@/core/runtime/ProjectSession";
import * as NativeTextPreview from "@/components/editor/preview/nativeTextPreview";
import {
  buildTransformStartClip,
  calculateScaledTextTransform,
  calculateTextResizeFontSize,
  getCompactCornerOutset,
  getVisibleTransformHandles,
  getHitTestCandidates,
  isClipActiveAtTime,
  shouldScaleTextFontForHandle,
  getUpdatedConformForClipBounds,
  resolveOverlayBaseVisualBounds,
  resolveClipVisualBounds,
  resolveVisualDragGeometry,
} from "../TransformOverlay";
import { getCursorForHandle } from "../calculator";
import type { TextClip, TransformHandle, TransformState } from "@/types";

describe("TransformOverlay resize policy", () => {
  it("keeps expanded point-text raster bounds visual while dragging authored geometry", () => {
    const authoredStart = {
      x: 400,
      y: 300,
      width: 160,
      height: 80,
      rotation: 0,
    };
    const visualStart = { x: 120, y: 260, width: 840, height: 180 };

    // CLY-TEXT-018: Raleway-like italic point text can expand substantially
    // outside its authored box. A pointer-down must not publish that expanded
    // box back to the native preview or history command.
    expect(
      resolveVisualDragGeometry(
        {
          ...authoredStart,
          visualX: visualStart.x,
          visualY: visualStart.y,
        },
        authoredStart,
        visualStart,
      ),
    ).toEqual(visualStart);

    const movedAuthored = {
      x: 640,
      y: 390,
      width: 160,
      height: 80,
      rotation: 0,
      visualX: 360,
      visualY: 350,
    };
    expect(
      resolveVisualDragGeometry(movedAuthored, authoredStart, visualStart),
    ).toEqual({ x: 360, y: 350, width: 840, height: 180 });
    expect(movedAuthored).toMatchObject({
      x: 640,
      y: 390,
      width: 160,
      height: 80,
    });
  });

  it("CLY-BUG-021: freezes the selection box base while a native text snapshot moves", () => {
    const clip = {
      id: "expanded-title",
      kind: "text",
      x: 400,
      y: 300,
      width: 754,
      height: 65,
    } as TextClip;
    const pointerDownVisualBounds = {
      x: 200,
      y: 292,
      width: 983,
      height: 96,
    };

    // A cropped native snapshot must never replace the editor text layout box
    // after a completed edit; it is a draw optimisation, not transform state.
    const getActiveSession = vi
      .spyOn(ProjectSession, "getActiveSessionOrNull")
      .mockReturnValue({
        nativeRasterBridge: {
          getTextVisualSnapshot: () => ({
            x: 420,
            y: 382,
            displayWidth: 983,
            displayHeight: 96,
            pivotX: 911.5,
            pivotY: 430,
            selectionBoundsTight: true,
          }),
          getTextSnapshot: () => ({
            x: 420,
            y: 382,
            displayWidth: 983,
            displayHeight: 96,
          }),
        },
      } as any);

    expect(
      resolveOverlayBaseVisualBounds(
        clip,
        1920,
        1080,
        pointerDownVisualBounds,
      ),
    ).toEqual(pointerDownVisualBounds);

    expect(resolveOverlayBaseVisualBounds(clip, 1920, 1080)).toEqual({
      x: 400,
      y: 300,
      width: 754,
      height: 65,
      pivotX: 777,
      pivotY: 332.5,
      source: "layout-box",
    });

    getActiveSession.mockRestore();
  });

  it("scales text font size for every resize handle", () => {
    const resizeHandles: TransformHandle[] = ["n", "s", "e", "w", "nw", "ne", "sw", "se"];

    for (const handle of resizeHandles) {
      expect(shouldScaleTextFontForHandle(handle)).toBe(true);
    }
  });

  it("does not scale text font size for move or rotate", () => {
    expect(shouldScaleTextFontForHandle("move")).toBe(false);
    expect(shouldScaleTextFontForHandle("rotate")).toBe(false);
  });

  it("uses the matching diagonal cursor for each corner handle", () => {
    expect(getCursorForHandle("nw")).toBe("nwse-resize");
    expect(getCursorForHandle("se")).toBe("nwse-resize");
    expect(getCursorForHandle("ne")).toBe("nesw-resize");
    expect(getCursorForHandle("sw")).toBe("nesw-resize");
  });

  it("uses the edited axis when calculating resized text font size", () => {
    const start = { width: 200, height: 100 };

    expect(calculateTextResizeFontSize(40, "e", start, { width: 300, height: 100 })).toBe(60);
    expect(calculateTextResizeFontSize(40, "s", start, { width: 200, height: 150 })).toBe(60);
    expect(calculateTextResizeFontSize(40, "se", start, { width: 300, height: 130 })).toBe(60);
  });

  it("CLY-BUG-027: keeps corner-only handles for compact text without midpoint targets", () => {
    expect(getVisibleTransformHandles(240, 100)).toEqual(["nw", "ne", "sw", "se"]);
    expect(getVisibleTransformHandles(240, 35)).toEqual(["nw", "ne", "sw", "se"]);
    expect(getVisibleTransformHandles(35, 240)).toEqual(["nw", "ne", "sw", "se"]);
    expect(getVisibleTransformHandles(24, 24)).toEqual(["nw", "ne", "sw", "se"]);
    expect(getCompactCornerOutset(240, 35)).toEqual({ x: 0, y: 0 });
    expect(getCompactCornerOutset(16, 10)).toEqual({ x: 6, y: 9 });
  });

  it("scales the perpendicular text box dimension for side resize handles", () => {
    const start = { x: 10, y: 20, width: 200, height: 100 };

    expect(calculateScaledTextTransform("e", start, { x: 10, width: 300 }, 1.5)).toMatchObject({
      x: 10,
      width: 300,
      y: -5,
      height: 150,
    });

    expect(calculateScaledTextTransform("s", start, { y: 20, height: 150 }, 1.5)).toMatchObject({
      x: -40,
      width: 300,
      y: 20,
      height: 150,
    });
  });

  it("preserves text fields when rebuilding the drag-start clip for resize math", () => {
    const selectedClip: TextClip = {
      id: "text-1",
      kind: "text",
      trackId: "track-1",
      mediaId: "",
      startTime: 0,
      duration: 5,
      trimIn: 0,
      trimOut: 5,
      x: 10,
      y: 20,
      width: 320,
      height: 90,
      opacity: 1,
      rotation: 0,
      aspectRatioLocked: false,
      sourceAspectRatio: 320 / 90,
      text: "MY TEXT",
      fontFamily: "Inter, system-ui, sans-serif",
      fontSize: 48,
      fontWeight: "bold",
      color: "#ffffff",
      align: "center",
      valign: "middle",
      lineHeight: 1.2,
      paddingX: 16,
      paddingY: 16,
    };
    const activeTransform: TransformState = {
      clipId: "text-1",
      handle: "e",
      startTransform: {
        x: 10,
        y: 20,
        width: 320,
        height: 90,
        rotation: 0,
      },
      startMousePos: { x: 330, y: 65 },
      aspectRatioLocked: false,
      sourceAspectRatio: 320 / 90,
    };

    const startClip = buildTransformStartClip(
      {
        ...selectedClip,
        x: 15,
        width: 360,
      },
      activeTransform,
    );

    expect(startClip.kind).toBe("text");
    expect((startClip as TextClip).text).toBe("MY TEXT");
    expect((startClip as TextClip).fontSize).toBe(48);
    expect(startClip.x).toBe(10);
    expect(startClip.width).toBe(320);
  });
});

describe("TransformOverlay visibility policy", () => {
  it("shows selected handles only while the selected clip is active at the playhead", () => {
    const clip = { startTime: 3, duration: 5 };

    expect(isClipActiveAtTime(clip, 2.999)).toBe(false);
    expect(isClipActiveAtTime(clip, 3)).toBe(true);
    expect(isClipActiveAtTime(clip, 7.999)).toBe(true);
    expect(isClipActiveAtTime(clip, 8)).toBe(false);
  });
});

describe("TransformOverlay hit testing", () => {
  const tracks = [
    { id: "text-track", type: "text", visible: true },
    { id: "image-track", type: "video", visible: true },
    { id: "hidden-track", type: "image", visible: false },
  ] as any;

  const clip = (id: string, trackId: string, startTime = 0, duration = 10) =>
    ({
      id,
      trackId,
      startTime,
      duration,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    }) as any;

  it("returns the visually topmost active layer first", () => {
    const candidates = getHitTestCandidates(
      [
        clip("image", "image-track"),
        clip("text", "text-track"),
        clip("inactive", "text-track", 10, 5),
        clip("hidden", "hidden-track"),
      ],
      tracks,
      5,
      50,
      50,
    );

    expect(candidates.map((candidate) => candidate.id)).toEqual(["text", "image"]);
  });

  it("follows persisted compositor z-order within one track", () => {
    const candidates = getHitTestCandidates(
      [
        { ...clip("front", "text-track"), zIndex: 1 },
        { ...clip("back", "text-track"), zIndex: 0 },
      ],
      tracks,
      5,
      50,
      50,
    );

    expect(candidates.map((candidate) => candidate.id)).toEqual(["front", "back"]);
  });

  it("resolves conformed clip bounds accurately during hit testing", () => {
    const conformedImage = {
      ...clip("image-conformed", "image-track"),
      conform: {
        mode: "fit" as const,
        sourceWidth: 1920,
        sourceHeight: 1080,
      },
    };
    const textOnTop = {
      ...clip("text-top", "text-track"),
      x: 100,
      y: 100,
      width: 400,
      height: 200,
    };

    const candidates = getHitTestCandidates(
      [conformedImage, textOnTop],
      tracks,
      5,
      200,
      150,
      1920,
      1080,
    );

    expect(candidates.map((c) => c.id)).toEqual(["text-top", "image-conformed"]);
  });

  it("filters out audio and effect clips from hit testing", () => {
    const audioClip = {
      ...clip("audio", "text-track"),
      kind: "audio",
    };
    const filterClip = {
      ...clip("filter", "text-track"),
      kind: "filter",
    };
    const textClip = {
      ...clip("text", "text-track"),
      kind: "text",
    };

    const candidates = getHitTestCandidates(
      [audioClip, filterClip, textClip],
      tracks,
      5,
      50,
      50,
    );

    expect(candidates.map((c) => c.id)).toEqual(["text"]);
  });
});

describe("getUpdatedConformForClipBounds", () => {
  it("calculates correct userScale and offsets for conformed media clip bounds", () => {
    const clip = {
      id: "clip-1",
      kind: "video",
      conform: {
        mode: "fit" as const,
        sourceWidth: 1920,
        sourceHeight: 1080,
        userScale: 1,
        userOffsetX: 0,
        userOffsetY: 0,
      },
    } as any;

    const canvasWidth = 1920;
    const canvasHeight = 1080;

    // Resized clip bounds: half width, shifted right/down
    const newWidth = 960;
    const newHeight = 540;
    const newX = 480;
    const newY = 270;

    const updatedConform = getUpdatedConformForClipBounds(
      clip,
      newX,
      newY,
      newWidth,
      newHeight,
      canvasWidth,
      canvasHeight
    );

    expect(updatedConform).toBeDefined();
    expect(updatedConform.userScale).toBe(0.5); // Width went from 1920 to 960
    expect(updatedConform.userOffsetX).toBe(0); // Center is still at 960 (canvasWidth/2)
    expect(updatedConform.userOffsetY).toBe(0); // Center is still at 540 (canvasHeight/2)
  });
});

describe("resolveClipVisualBounds", () => {
  it("returns standard clip bounds when no conform or template is present", () => {
    const clip = {
      id: "plain-clip",
      x: 50,
      y: 100,
      width: 400,
      height: 300,
    } as any;

    const bounds = resolveClipVisualBounds(clip, 1920, 1080);
    expect(bounds).toEqual({ x: 50, y: 100, width: 400, height: 300 });
  });

  it("CLY-TEXT-017: never uses an unbounded legacy texture as a plain-text selection", () => {
    const getActiveSession = vi.spyOn(ProjectSession, "getActiveSessionOrNull").mockReturnValue({
      nativeRasterBridge: {
        getTextSnapshot: vi.fn(() => ({
          x: 120,
          y: 84,
          displayWidth: 840,
          displayHeight: 180,
        })),
      },
    } as never);

    const bounds = resolveClipVisualBounds({
      id: "expanded-title",
      kind: "text",
      x: 400,
      y: 300,
      width: 160,
      height: 80,
    } as any, 1920, 1080);

    expect(bounds).toEqual({
      x: 400,
      y: 300,
      width: 160,
      height: 80,
      pivotX: 480,
      pivotY: 340,
      source: "layout-box",
    });
    getActiveSession.mockRestore();
  });

  it("CLY-TEXT-024: keeps selection geometry on the layout box when the native texture is cropped", () => {
    const getActiveSession = vi.spyOn(ProjectSession, "getActiveSessionOrNull").mockReturnValue({
      nativeRasterBridge: {
        getTextVisualSnapshot: vi.fn(() => ({
          x: 168,
          y: 212,
          displayWidth: 704,
          displayHeight: 58,
          pivotX: 520,
          pivotY: 240,
          selectionBoundsTight: true,
        })),
        getTextSnapshot: vi.fn(() => ({
          x: 120,
          y: 180,
          displayWidth: 800,
          displayHeight: 120,
        })),
      },
    } as never);

    const bounds = resolveClipVisualBounds({
      id: "tight-title",
      kind: "text",
      x: 200,
      y: 200,
      width: 704,
      height: 58,
    } as any, 1920, 1080);

    expect(bounds).toEqual({
      x: 200,
      y: 200,
      width: 704,
      height: 58,
      pivotX: 552,
      pivotY: 229,
      source: "layout-box",
    });
    getActiveSession.mockRestore();
  });

  it("CLY-TEXT-023: rejects retained native text geometry after canvas handoff", () => {
    const getActiveSession = vi.spyOn(ProjectSession, "getActiveSessionOrNull").mockReturnValue({
      nativeRasterBridge: {
        getTextVisualSnapshot: vi.fn(() => ({
          x: 120,
          y: 84,
          displayWidth: 840,
          displayHeight: 180,
          pivotX: 540,
          pivotY: 174,
          selectionBoundsTight: true,
        })),
      },
    } as never);

    // The native child surface can remain visible briefly while a paused
    // canvas handoff is pending. Its snapshot must not rotate the DOM overlay.
    expect(
      resolveClipVisualBounds({
        id: "handoff-title",
        kind: "text",
        x: 400,
        y: 300,
        width: 160,
        height: 80,
      } as any, 1920, 1080, "dom-canvas"),
    ).toEqual({
      x: 400,
      y: 300,
      width: 160,
      height: 80,
      pivotX: 480,
      pivotY: 340,
      source: "layout-box",
    });
    getActiveSession.mockRestore();
  });

  it("CLY-TEXT-019: uses the same layout box when browser canvas paints text", () => {
    const getActiveSession = vi
      .spyOn(ProjectSession, "getActiveSessionOrNull")
      .mockReturnValue(null);
    const getBrowserSnapshot = vi
      .spyOn(NativeTextPreview, "getBrowserTextVisualSnapshot")
      .mockReturnValue({
        x: 120,
        y: 84,
        displayWidth: 840,
        displayHeight: 180,
        pivotX: 540,
        pivotY: 174,
        selectionBoundsTight: true,
      });

    const bounds = resolveClipVisualBounds({
      id: "expanded-title",
      kind: "text",
      x: 400,
      y: 300,
      width: 160,
      height: 80,
    } as any, 1920, 1080);

    expect(bounds).toEqual({
      x: 400,
      y: 300,
      width: 160,
      height: 80,
      pivotX: 480,
      pivotY: 340,
      source: "layout-box",
    });
    getBrowserSnapshot.mockRestore();
    getActiveSession.mockRestore();
  });

  it("CLY-TEXT-020: presenter handoff cannot change the text layout box", () => {
    const getActiveSession = vi
      .spyOn(ProjectSession, "getActiveSessionOrNull")
      .mockReturnValue({
        nativeRasterBridge: {
          getTextSnapshot: vi.fn(() => ({
            x: 100,
            y: 100,
            displayWidth: 100,
            displayHeight: 50,
          })),
        },
      } as never);
    const getBrowserSnapshot = vi
      .spyOn(NativeTextPreview, "getBrowserTextVisualSnapshot")
      .mockReturnValue({
        x: 120,
        y: 84,
        displayWidth: 840,
        displayHeight: 180,
        pivotX: 540,
        pivotY: 174,
        selectionBoundsTight: true,
      });

    expect(
      resolveClipVisualBounds({
        id: "presenter-handoff-title",
        kind: "text",
        x: 400,
        y: 300,
        width: 160,
        height: 80,
      } as any, 1920, 1080),
    ).toEqual({
      x: 400,
      y: 300,
      width: 160,
      height: 80,
      pivotX: 480,
      pivotY: 340,
      source: "layout-box",
    });

    getBrowserSnapshot.mockRestore();
    getActiveSession.mockRestore();
  });

  it("resolves adaptive prominent visual badge bounds for a text-template clip under content-aware scaling", () => {
    const templateClip = {
      id: "template-1",
      kind: "text-template",
      x: 0,
      y: 0,
      width: 1080,
      height: 1920,
      templateSnapshot: {
        schemaVersion: "1.0.0",
        id: "badge-template",
        name: "Badge",
        document: {
          canvas: { width: 1920, height: 1080 },
          nodes: [
            { id: "box", type: "shape", x: 760, y: 440, width: 400, height: 200 },
          ],
        },
      },
    } as any;

    // Portrait canvas: 1080 x 1920
    // Content-aware scaling targets ~62% width coverage on portrait canvas:
    // targetContentWidth = 1080 * 0.62 = 669.6
    // scale = 669.6 / 400 = 1.674
    // Visual badge: width = 400 * 1.674 = 669.6, height = 200 * 1.674 = 334.8
    // Centered: x = 205.24, y = 792.56
    const bounds = resolveClipVisualBounds(templateClip, 1080, 1920);
    expect(bounds.x).toBeCloseTo(205.24, 1);
    expect(bounds.y).toBeCloseTo(792.56, 1);
    expect(bounds.width).toBeCloseTo(669.6, 1);
    expect(bounds.height).toBeCloseTo(334.8, 1);
  });
});

describe("Text template hit testing", () => {
  const tracks = [
    { id: "template-track", type: "text", visible: true },
    { id: "video-track", type: "video", visible: true },
  ] as any;

  const backgroundVideo = {
    id: "bg-video",
    trackId: "video-track",
    kind: "video",
    startTime: 0,
    duration: 10,
    x: 0,
    y: 0,
    width: 1080,
    height: 1920,
  } as any;

  const templateClip = {
    id: "template-badge",
    trackId: "template-track",
    kind: "text-template",
    startTime: 0,
    duration: 10,
    x: 0,
    y: 0,
    width: 1080,
    height: 1920,
    templateSnapshot: {
      schemaVersion: "1.0.0",
      id: "badge-template",
      name: "Badge",
      document: {
        canvas: { width: 1920, height: 1080 },
        nodes: [
          { id: "box", type: "shape", x: 760, y: 440, width: 400, height: 200 },
        ],
      },
    },
  } as any;

  it("selects the template clip when clicking inside the visual badge bounds", () => {
    // Inside badge: x = 427.5 .. 652.5, y = 903.75 .. 1016.25
    const candidates = getHitTestCandidates(
      [backgroundVideo, templateClip],
      tracks,
      5,
      500,
      950,
      1080,
      1920,
    );

    expect(candidates[0]?.id).toBe("template-badge");
  });

  it("does not select the template clip when clicking outside its badge bounds in the empty margin", () => {
    // Outside badge (top of screen): (100, 100)
    const candidates = getHitTestCandidates(
      [backgroundVideo, templateClip],
      tracks,
      5,
      100,
      100,
      1080,
      1920,
    );

    // Should only hit the background video, not the text template
    expect(candidates.map((c) => c.id)).toEqual(["bg-video"]);
  });

  it("resolves content-bounded text-template clip dimensions directly without layout offset", () => {
    const tightTemplateClip = {
      id: "tight-template",
      trackId: "template-track",
      kind: "text-template",
      x: 340,
      y: 900,
      width: 400,
      height: 120,
    } as any;

    const bounds = resolveClipVisualBounds(tightTemplateClip, 1080, 1920);
    expect(bounds).toEqual({
      x: 340,
      y: 900,
      width: 400,
      height: 120,
    });
  });
});


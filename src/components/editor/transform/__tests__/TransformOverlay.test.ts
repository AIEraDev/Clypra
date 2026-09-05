import { describe, expect, it } from "vitest";
import {
  buildTransformStartClip,
  calculateScaledTextTransform,
  calculateTextResizeFontSize,
  getHitTestCandidates,
  isClipActiveAtTime,
  shouldScaleTextFontForHandle,
  getUpdatedConformForClipBounds,
  resolveClipVisualBounds,
} from "../TransformOverlay";
import { getCursorForHandle } from "../calculator";
import type { TextClip, TransformHandle, TransformState } from "@/types";

describe("TransformOverlay resize policy", () => {
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
});


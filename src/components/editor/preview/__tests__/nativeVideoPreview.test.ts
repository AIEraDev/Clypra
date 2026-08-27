import { describe, expect, it } from "vitest";
import type { EvaluatedMediaLayer, EvaluatedScene } from "@/core/evaluation/types";
import {
  buildNativeFrameRequest,
  buildNativeVideoProjectRequest,
  getNativePreviewBlockers,
  getNativeFrameRequestKey,
  isRenderableNativePreviewFrame,
} from "../nativeVideoPreview";
import { buildNativeImageAssetId } from "@/core/render/nativeRasterAssetIds";

function makeVideoLayer(overrides: Partial<EvaluatedMediaLayer> = {}): EvaluatedMediaLayer {
  return {
    layerId: "clip-1",
    clipId: "clip-1",
    role: "primary",
    clipKind: "video",
    zIndex: 0,
    trackIndex: 0,
    layerType: "media",
    mediaId: "asset-1",
    mediaType: "video",
    sourcePath: "/Users/test/clip.mp4",
    sourceTime: 2,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    rotation: 0,
    opacity: 1,
    inTransition: false,
    blendMode: "normal",
    ...overrides,
  };
}

function makeScene(
  visualLayers: EvaluatedScene["visualLayers"],
  transitions: EvaluatedScene["transitions"] = [],
  canvasBackground: EvaluatedScene["metadata"]["canvasBackground"] = undefined,
): EvaluatedScene {
  return {
    visualLayers,
    audioLayers: [],
    transitions,
    metadata: {
      time: 2,
      canvasWidth: 1920,
      canvasHeight: 1080,
      frameRate: 30,
      isGap: false,
      canvasBackground,
      activeMediaHash: "video",
    },
  } as EvaluatedScene;
}

describe("buildNativeVideoProjectRequest", () => {
  it("maps a supported two-video transition into the native graph", () => {
    const outgoing = makeVideoLayer({ layerId: "outgoing", clipId: "outgoing" });
    const incoming = makeVideoLayer({ layerId: "incoming", clipId: "incoming", sourcePath: "/Users/test/next.mp4" });
    const request = buildNativeVideoProjectRequest(makeScene([outgoing, incoming], [{
      transitionId: "transition-1",
      type: "dissolve",
      renderer: "dissolve",
      progress: 0.5,
      duration: 1,
      outgoingLayer: "outgoing",
      incomingLayer: "incoming",
      blendMode: "normal",
    }]));

    expect(request?.transition).toEqual({
      outgoingLayer: "outgoing",
      incomingLayer: "incoming",
      transitionType: "cross-dissolve",
      progress: 0.5,
      feather: 0.1,
      intensity: 1,
    });
  });

  it("preserves authored fade-through-color parameters in the native graph", () => {
    const outgoing = makeVideoLayer({ layerId: "outgoing", clipId: "outgoing" });
    const incoming = makeVideoLayer({ layerId: "incoming", clipId: "incoming" });
    const request = buildNativeVideoProjectRequest(makeScene([outgoing, incoming], [{
      transitionId: "fade-black",
      type: "fade",
      renderer: "fade",
      params: { color: "#000000" },
      progress: 0.5,
      duration: 1,
      outgoingLayer: "outgoing",
      incomingLayer: "incoming",
      blendMode: "normal",
    }] as any));

    expect(request?.transition).toMatchObject({
      transitionType: "fade-through-color",
      fadeColor: [0, 0, 0, 1],
    });
  });

  it("maps creative transitions into native shader modes", () => {
    const outgoing = makeVideoLayer({ layerId: "outgoing", clipId: "outgoing" });
    const incoming = makeVideoLayer({ layerId: "incoming", clipId: "incoming" });
    const request = buildNativeVideoProjectRequest(makeScene([outgoing, incoming], [{
      transitionId: "transition-1",
      type: "glitch",
      renderer: "glitch",
      progress: 0.5,
      duration: 1,
      outgoingLayer: "outgoing",
      incomingLayer: "incoming",
      blendMode: "normal",
    }]));

    expect(request?.transition?.transitionType).toBe("glitch");
  });

  it("does not report blockers for native creative transitions", () => {
    const outgoing = makeVideoLayer({ layerId: "outgoing", clipId: "outgoing" });
    const incoming = makeVideoLayer({ layerId: "incoming", clipId: "incoming" });
    expect(getNativePreviewBlockers(makeScene([outgoing, incoming], [{
      transitionId: "transition-1",
      type: "glitch",
      renderer: "glitch",
      progress: 0.5,
      duration: 1,
      outgoingLayer: "outgoing",
      incomingLayer: "incoming",
      blendMode: "normal",
    }]))).not.toContain("The active transition is not implemented in the native compositor.");
  });

  it("maps the published iris reveal transition to the native iris shader", () => {
    const outgoing = makeVideoLayer({ layerId: "outgoing", clipId: "outgoing" });
    const incoming = makeVideoLayer({ layerId: "incoming", clipId: "incoming" });
    const request = buildNativeVideoProjectRequest(makeScene([outgoing, incoming], [{
      transitionId: "iris-reveal",
      type: "fade",
      renderer: "iris-reveal",
      progress: 0.5,
      duration: 1,
      outgoingLayer: "outgoing",
      incomingLayer: "incoming",
      blendMode: "normal",
    }]));

    expect(request?.transition?.transitionType).toBe("iris-wipe");
  });

  it("maps diagonal wipes and slide pushes into native transition modes", () => {
    const outgoing = makeVideoLayer({ layerId: "outgoing", clipId: "outgoing" });
    const incoming = makeVideoLayer({ layerId: "incoming", clipId: "incoming" });
    const diagonal = buildNativeVideoProjectRequest(makeScene([outgoing, incoming], [{
      transitionId: "transition-diagonal",
      type: "fade",
      renderer: "wipe-diagonal",
      progress: 0.4,
      duration: 1,
      outgoingLayer: "outgoing",
      incomingLayer: "incoming",
      blendMode: "normal",
    }]));
    const slide = buildNativeVideoProjectRequest(makeScene([outgoing, incoming], [{
      transitionId: "transition-slide",
      type: "fade",
      renderer: "slide-left",
      progress: 0.4,
      duration: 1,
      outgoingLayer: "outgoing",
      incomingLayer: "incoming",
      blendMode: "normal",
    }]));

    expect(diagonal?.transition?.transitionType).toBe("wipe-diagonal");
    expect(slide?.transition?.transitionType).toBe("slide-left");

    const vertical = buildNativeVideoProjectRequest(makeScene([outgoing, incoming], [{
      transitionId: "transition-slide-up",
      type: "fade",
      renderer: "slide-up",
      progress: 0.4,
      duration: 1,
      outgoingLayer: "outgoing",
      incomingLayer: "incoming",
      blendMode: "normal",
    }]));
    expect(vertical?.transition?.transitionType).toBe("slide-up");
  });

  it("keeps custom iris geometry off native until the timeline persists it", () => {
    const outgoing = makeVideoLayer({ layerId: "outgoing", clipId: "outgoing" });
    const incoming = makeVideoLayer({ layerId: "incoming", clipId: "incoming" });
    expect(buildNativeVideoProjectRequest(makeScene([outgoing, incoming], [{
      transitionId: "iris-reveal",
      type: "fade",
      renderer: "iris-reveal",
      params: { centerX: 0.25, centerY: 0.5, shape: "circle" },
      progress: 0.5,
      duration: 1,
      outgoingLayer: "outgoing",
      incomingLayer: "incoming",
      blendMode: "normal",
    }] as any))).toBeNull();
  });

  it("routes static sticker image clips through an alpha-preserving native raster layer", () => {
    const layer = makeVideoLayer({
      layerId: "sticker-static",
      clipId: "sticker-static",
      clipKind: "sticker",
      mediaType: "image",
      stickerFormat: "static",
      sourcePath: "/Users/test/sticker.png",
    });
    const request = buildNativeVideoProjectRequest(makeScene([layer]), [{
      assetId: "native-image:sticker-static:source",
      width: layer.width,
      height: layer.height,
      x: layer.x,
      y: layer.y,
      rotation: layer.rotation,
      opacity: layer.opacity,
      zIndex: layer.zIndex,
      blendMode: layer.blendMode,
      isText: false,
    }]);

    expect(request?.layers).toEqual([]);
    expect(request?.rasterLayers?.[0].assetId).toBe("native-image:sticker-static:source");
  });

  it("routes animated GIF stickers through the native FFmpeg media layer", () => {
    const request = buildNativeVideoProjectRequest(makeScene([makeVideoLayer({
      clipKind: "sticker",
      mediaType: "image",
      stickerFormat: "gif",
      sourcePath: "/Users/test/sticker.gif",
    })]));

    expect(request?.layers[0]).toMatchObject({
      videoPath: "/Users/test/sticker.gif",
      timeSecs: 2,
    });
  });

  it("keeps animated sticker formats out of the native media path", () => {
    expect(buildNativeVideoProjectRequest(makeScene([makeVideoLayer({
      clipKind: "sticker",
      mediaType: "image",
      stickerFormat: "lottie",
      sourcePath: "/Users/test/sticker.json",
    })]))).toBeNull();
  });

  it("composes an evaluated Lottie sticker from a registered native raster asset", () => {
    const sticker = makeVideoLayer({
      layerId: "sticker-1",
      clipId: "sticker-1",
      clipKind: "sticker",
      mediaType: "image",
      stickerFormat: "lottie",
      sourcePath: "/Users/test/sticker.json",
      x: 240,
      y: 120,
      width: 320,
      height: 320,
      zIndex: 4,
    });
    const request = buildNativeVideoProjectRequest(makeScene([sticker]), [{
      assetId: "native-sticker:sticker-1:12:320x320",
      width: 320,
      height: 320,
      x: 240,
      y: 120,
      rotation: 0,
      opacity: 1,
      zIndex: 4,
      blendMode: "normal",
      isText: false,
    }]);

    expect(request?.layers).toEqual([]);
    expect(request?.rasterLayers?.[0]).toMatchObject({
      assetId: "native-sticker:sticker-1:12:320x320",
      x: 240,
      y: 120,
    });
  });

  it("accepts a raster-only native scene for overlay and text mockups", () => {
    const request = buildNativeVideoProjectRequest(makeScene([]), [{
      assetId: "native-overlay:sample",
      width: 64,
      height: 64,
      x: 928,
      y: 508,
      rotation: 0,
      opacity: 1,
      zIndex: 1,
      blendMode: "normal",
      isText: false,
    }]);

    expect(request?.layers).toEqual([]);
    expect(request?.rasterLayers?.[0].assetId).toBe("native-overlay:sample");
  });

  it("uses a registered native raster background for non-solid canvas backgrounds", () => {
    const request = buildNativeVideoProjectRequest(makeScene([], [], {
      type: "gradient",
      color: "#000000",
      opacity: 1,
      isTransparent: false,
      gradient: { type: "linear", angle: 135, stops: [{ color: "#111111", offset: 0 }, { color: "#222222", offset: 100 }] },
    }), [{
      assetId: "native-background:2:{gradient}",
      width: 1920,
      height: 1080,
      x: 0,
      y: 0,
      rotation: 0,
      opacity: 1,
      zIndex: -1_000_000,
      blendMode: "normal",
      isText: false,
    }]);

    expect(request?.clearColor).toEqual([0, 0, 0, 0]);
    expect(request?.rasterLayers?.[0].assetId).toBe("native-background:2:{gradient}");
  });

  it("maps evaluated video layers into a project-sized native request", () => {
    const layer = makeVideoLayer({ x: 100, y: 50, width: 640, height: 360, zIndex: 7 });

    expect(buildNativeVideoProjectRequest(makeScene([layer]))).toEqual({
      canvasWidth: 1920,
      canvasHeight: 1080,
      clearColor: [0, 0, 0, 1],
      layers: [{
        layerId: "clip-1",
        videoPath: "/Users/test/clip.mp4",
        timeSecs: 2,
        x: 100,
        y: 50,
        width: 640,
        height: 360,
        rotation: 0,
        opacity: 1,
        zIndex: 7,
        blendMode: "normal",
      }],
    });
  });

  it("accepts Tauri v2 asset-origin URLs for native decoding", () => {
    const request = buildNativeVideoProjectRequest(makeScene([
      makeVideoLayer({ sourcePath: "http://asset.localhost/%2FUsers%2Ftest%2Fclip.mp4", adjustments: {} }),
    ]));

    expect(request?.layers[0].videoPath).toBe("http://asset.localhost/%2FUsers%2Ftest%2Fclip.mp4");
  });

  it("rejects unsupported scenes at the native boundary", () => {
    expect(buildNativeVideoProjectRequest(makeScene([
      makeVideoLayer({ filter: { id: "filter", name: "blur", intensity: 1 } }),
    ]))).toBeNull();
    const image = makeVideoLayer({ layerId: "image-1", mediaId: "image-1", mediaType: "image", sourceTime: 0 });
    expect(buildNativeVideoProjectRequest(makeScene([makeVideoLayer(), image]))).toBeNull();
    expect(getNativePreviewBlockers(makeScene([image]))).toContain(
      "Still image image-1 is waiting for its alpha-preserving native raster frame.",
    );
  });

  it("composes a still image only when its registered native raster is available", () => {
    const image = makeVideoLayer({
      layerId: "image-1",
      clipId: "image-1",
      mediaId: "image-1",
      mediaType: "image",
      sourcePath: "/Users/test/logo.png",
      x: 320,
      y: 180,
      width: 640,
      height: 360,
      zIndex: 3,
    });
    const raster = {
      assetId: buildNativeImageAssetId("/Users/test/logo.png", 640, 360),
      width: 640,
      height: 360,
      x: 320,
      y: 180,
      rotation: 0,
      opacity: 1,
      zIndex: 3,
      blendMode: "normal" as const,
      isText: false,
    };
    const request = buildNativeVideoProjectRequest(makeScene([image]), [raster]);

    expect(request?.layers).toEqual([]);
    expect(request?.rasterLayers).toEqual([raster]);
    expect(getNativePreviewBlockers(makeScene([image]), [raster])).toEqual([]);
  });

  it("does not drop unsupported active track filters from the native scene", () => {
    expect(buildNativeVideoProjectRequest({
      ...makeScene([makeVideoLayer()]),
      activeFilter: { id: "unsupported-blur", name: "Blur", intensity: 1 },
    })).toBeNull();
  });

  it("maps canonical built-in filter-track presets into native grading", () => {
    const layer = makeVideoLayer({
      filter: { id: "filter-sepia", name: "Sepia", intensity: 0.75 },
    });
    const request = buildNativeVideoProjectRequest({
      ...makeScene([layer]),
      activeFilter: { id: "filter-sepia", name: "Sepia", intensity: 0.75 },
    });

    expect(request?.layers[0].colorGrade).toMatchObject({ sepia: 0.75 });
  });

  it("composes native text layers alongside native video", () => {
    const textLayer = {
      ...makeVideoLayer({ layerId: "title", clipId: "title", mediaId: "title", zIndex: 1 }),
      layerType: "text",
      text: "Clypra Native Text",
      fontFamily: "Inter",
      fontSize: 48,
    } as never;

    const request = buildNativeVideoProjectRequest(
      makeScene([makeVideoLayer({ zIndex: 0 }), textLayer])
    );

    expect(request?.layers[0].zIndex).toBe(0);
    expect(request?.textLayers).toBeDefined();
    expect(request?.textLayers?.[0].text).toBe("Clypra Native Text");
  });

  it("propagates deterministic solid canvas backgrounds", () => {
    const scene = {
      ...makeScene([makeVideoLayer()]),
      metadata: {
        ...makeScene([makeVideoLayer()]).metadata,
        canvasBackground: { type: "solid", color: "#336699", opacity: 0.5, isTransparent: false },
      },
    } as EvaluatedScene;
    expect(buildNativeVideoProjectRequest(scene)?.clearColor).toEqual([
      0x33 / 255,
      0x66 / 255,
      0x99 / 255,
      0.5,
    ]);
  });

  it("keeps backgrounds without a registered native asset off the native path", () => {
    for (const type of ["gradient", "shader"] as const) {
      const scene = {
        ...makeScene([makeVideoLayer()]),
        metadata: {
          ...makeScene([makeVideoLayer()]).metadata,
          canvasBackground: { type } as never,
        },
      } as EvaluatedScene;
      expect(buildNativeVideoProjectRequest(scene)).toBeNull();
    }
  });

  it("composes a native media background below the timeline layers", () => {
    const request = buildNativeVideoProjectRequest(makeScene([], [], {
      type: "media",
      mediaUrl: "/Users/test/background.mp4",
      opacity: 0.4,
      isTransparent: false,
    }));

    expect(request?.clearColor).toEqual([0, 0, 0, 0]);
    expect(request?.layers).toHaveLength(1);
    expect(request?.layers[0]).toMatchObject({
      layerId: "__native-background-media",
      videoPath: "/Users/test/background.mp4",
      opacity: 0.4,
      zIndex: -1_000_000,
    });
  });

  it("maps supported color adjustments to the native grade shader", () => {
    const request = buildNativeVideoProjectRequest(makeScene([
      makeVideoLayer({
        adjustments: {
          exposure: 0.5,
          contrast: 0.2,
          saturation: -0.3,
          temperature: 0.1,
          tint: -0.2,
          brightness: 0.15,
          sepia: 0.2,
          grayscale: 0.1,
          hue: 30,
          vignette: 0.4,
          invert: true,
        },
      }),
    ]));

    expect(request?.layers[0].colorGrade).toEqual({
      exposure: 0.5,
      contrast: 1.2,
      saturation: 0.7,
      temperature: 0.1,
      tint: -0.2,
      brightness: 0.15,
      sepia: 0.2,
      grayscale: 0.1,
      hueRotate: (30 * Math.PI) / 180,
      vignette: 0.4,
      invert: 1,
      grainIntensity: 0,
      grainSize: 1,
      lutIntensity: 1,
      lutSize: 33,
      blurStrength: 0,
      blurRadius: 0,
      pixelateSize: 0,
      scanlineCount: 0,
      scanlineIntensity: 0,
      rgbSplitX: 0,
      rgbSplitY: 0,
      vibranceAmount: 0,
      vibranceProtectedHueR: 0.91,
      vibranceProtectedHueG: 0.69,
      vibranceProtectedHueB: 0.55,
      lift: 0,
      crossProcessAmount: 0,
      channelMixR: 0,
      channelMixG: 0,
      channelMixB: 0,
      channelMixEnabled: 0,
      duotoneDarkR: 0,
      duotoneDarkG: 0,
      duotoneDarkB: 0,
      duotoneLightR: 1,
      duotoneLightG: 1,
      duotoneLightB: 1,
      duotoneEnabled: 0,
      shadowTintR: 1,
      shadowTintG: 1,
      shadowTintB: 1,
      shadowTintStrength: 0,
      highlightTintR: 1,
      highlightTintG: 1,
      highlightTintB: 1,
      highlightTintStrength: 0,
      splitBalance: 0.5,
      glowColorR: 1,
      glowColorG: 1,
      glowColorB: 1,
      glowStrength: 0,
      glowRadius: 0,
      flashColorR: 1,
      flashColorG: 1,
      flashColorB: 1,
      flashStrength: 0,
      flickerStrength: 0,
      strobeFrequency: 0,
      strobeTime: 0,
      strobeStrength: 0,
      lightLeakColorR: 1,
      lightLeakColorG: 0.7843137255,
      lightLeakColorB: 0.3921568627,
      lightLeakStrength: 0,
      lightLeakAngle: Math.PI / 4,
      lightLeakTime: 0,
    });
  });

  it("maps lift and cross-process controls into the native grade shader", () => {
    const request = buildNativeVideoProjectRequest(makeScene([
      makeVideoLayer({ adjustments: { lift: 0.2, crossProcess: { amount: 0.4 } } }),
    ]));
    expect(request?.layers[0].colorGrade).toMatchObject({
      lift: 0.2,
      crossProcessAmount: 0.4,
    });
  });

  it("maps channel mix, duotone, and split-tone controls into native grading", () => {
    const request = buildNativeVideoProjectRequest(makeScene([
      makeVideoLayer({
        adjustments: {
          channelMix: { r: 0.2, g: 0.7, b: 0.1 },
          duotone: { darkColor: "#101820", lightColor: "#f0d080" },
          splitTone: {
            shadowColor: "#203040",
            shadowStrength: 0.4,
            highlightColor: "#ffe0b0",
            highlightStrength: 0.3,
            balance: 0.6,
          },
        } as never,
      }),
    ]));
    expect(request?.layers[0].colorGrade).toMatchObject({
      channelMixR: 0.2,
      channelMixG: 0.7,
      channelMixB: 0.1,
      channelMixEnabled: 1,
      duotoneEnabled: 1,
      shadowTintStrength: 0.4,
      highlightTintStrength: 0.3,
      splitBalance: 0.6,
    });
  });

  it("maps deterministic film grain into the native grade shader", () => {
    const request = buildNativeVideoProjectRequest(makeScene([
      makeVideoLayer({ adjustments: { grain: { intensity: 0.2, size: 1.5 } } }),
    ]));
    expect(request?.layers[0].colorGrade).toMatchObject({ grainIntensity: 0.2, grainSize: 1.5 });
  });

  it("maps protected-hue vibrance into the native grade shader", () => {
    const request = buildNativeVideoProjectRequest(makeScene([
      makeVideoLayer({ adjustments: { vibrance: { amount: 0.35, protectedHue: "#336699" } } }),
    ]));
    expect(request?.layers[0].colorGrade).toMatchObject({
      vibranceAmount: 0.35,
      vibranceProtectedHueR: 0x33 / 255,
      vibranceProtectedHueG: 0x66 / 255,
      vibranceProtectedHueB: 0x99 / 255,
    });
  });

  it("maps the bounded blur effect into the native compositor", () => {
    const request = buildNativeVideoProjectRequest(makeScene([
      makeVideoLayer({ effects: [{ effectId: "fx-blur", renderer: "blur", type: "video_effect", intensity: 0.5, localTime: 0, parameters: { blur: 12 } }] }),
    ]));
    expect(request?.layers[0].colorGrade).toMatchObject({ blurStrength: 1, blurRadius: 6 });
  });

  it("maps the existing radial, zoom, and motion blur fallbacks into bounded native blur", () => {
    const request = buildNativeVideoProjectRequest(makeScene([
      makeVideoLayer({ effects: [
        { effectId: "fx-radial", renderer: "radial_blur", type: "video_effect", intensity: 0.25, localTime: 0, parameters: { blurAmount: 16 } },
        { effectId: "fx-zoom", renderer: "zoom_blur", type: "video_effect", intensity: 0.5, localTime: 0, parameters: { blurAmount: 10 } },
        { effectId: "fx-motion", renderer: "motion_blur", type: "video_effect", intensity: 0.2, localTime: 0, parameters: { blurAmount: 8 } },
      ] }),
    ]));
    expect(request?.layers[0].colorGrade).toMatchObject({ blurStrength: 1, blurRadius: 10.6 });
  });

  it("maps regular glow into the native bounded blur-plus-add pass", () => {
    const request = buildNativeVideoProjectRequest(makeScene([
      makeVideoLayer({ effects: [
        { effectId: "fx-glow", renderer: "glow", type: "video_effect", intensity: 0.5, localTime: 0, parameters: { glowAmount: 16, glowIntensity: 0.8, glowColor: "#336699" } },
      ] }),
    ]));
    expect(request?.layers[0].colorGrade).toMatchObject({
      glowColorR: 0x33 / 255,
      glowColorG: 0x66 / 255,
      glowColorB: 0x99 / 255,
      glowStrength: 0.4,
      glowRadius: 8,
    });
  });

  it("maps flash, flicker, and strobe into deterministic native temporal controls", () => {
    const request = buildNativeVideoProjectRequest(makeScene([
      makeVideoLayer({ effects: [
        { effectId: "fx-flash", renderer: "flash", type: "video_effect", intensity: 0.5, localTime: 0, parameters: { flashColor: "#336699", flashIntensity: 0.8 } },
        { effectId: "fx-flicker", renderer: "flicker", type: "video_effect", intensity: 0.25, localTime: 0, parameters: { flickerAmount: 0.6 } },
        { effectId: "fx-strobe", renderer: "strobe", type: "video_effect", intensity: 0.4, localTime: 0.75, parameters: { frequency: 12, flashIntensity: 0.7 } },
      ] }),
    ]));
    expect(request?.layers[0].colorGrade).toMatchObject({
      flashColorR: 0x33 / 255,
      flashColorG: 0x66 / 255,
      flashColorB: 0x99 / 255,
      flashStrength: 0.4,
      flickerStrength: 0.15,
      strobeFrequency: 12,
      strobeTime: 0.75,
      strobeStrength: 0.27999999999999997,
    });
  });

  it("maps light-leak overlays into the native animated grade", () => {
    const request = buildNativeVideoProjectRequest(makeScene([
      makeVideoLayer({
        effects: [{
          effectId: "light-leak",
          type: "video_effect",
          renderer: "light_leak",
          parameters: { leakColor: "#804020", leakIntensity: 0.6, angle: 90 },
          intensity: 0.5,
          localTime: 1.25,
        }],
      }),
    ]));
    expect(request?.layers[0].colorGrade).toMatchObject({
      lightLeakColorR: 128 / 255,
      lightLeakColorG: 64 / 255,
      lightLeakColorB: 32 / 255,
      lightLeakStrength: 0.3,
      lightLeakAngle: Math.PI / 2,
      lightLeakTime: 1.25,
    });
  });

  it("binds a registered segmentation mask to native body glow", () => {
    const request = buildNativeVideoProjectRequest(
      makeScene([makeVideoLayer({
        effects: [{
          effectId: "fx-body-glow",
          renderer: "body_glow",
          type: "body_effect",
          parameters: { glowColor: "#00ffff", glowRadius: 18, glowIntensity: 0.75 },
          intensity: 0.8,
          localTime: 1.5,
        }],
      })]),
      [{
        assetId: "clip-1_fx-body-glow",
        width: 1920,
        height: 1080,
        x: 0,
        y: 0,
        rotation: 0,
        opacity: 0,
        zIndex: -2147483648,
        blendMode: "normal",
        isMask: true,
      }],
    );

    expect(request?.layers[0].bodyEffect).toEqual({
      maskAssetId: "clip-1_fx-body-glow",
      renderer: "body_glow",
      colorR: 0,
      colorG: 1,
      colorB: 1,
      strength: 0.6000000000000001,
      radius: 14.4,
      time: 1.5,
    });
  });

  it("maps body particles to the native mask-driven particle pass", () => {
    const request = buildNativeVideoProjectRequest(
      makeScene([makeVideoLayer({
        effects: [{
          effectId: "fx-body-particles",
          renderer: "body_particles",
          type: "body_effect",
          parameters: { particleColor: "#ff8000", particleCount: 120 },
          intensity: 0.5,
          localTime: 2,
        }],
      })]),
      [{
        assetId: "clip-1_fx-body-particles",
        width: 1920,
        height: 1080,
        x: 0,
        y: 0,
        rotation: 0,
        opacity: 0,
        zIndex: -2147483648,
        blendMode: "normal",
        isMask: true,
      }],
    );

    expect(request?.layers[0].bodyEffect).toEqual({
      maskAssetId: "clip-1_fx-body-particles",
      renderer: "body_particles",
      colorR: 1,
      colorG: 128 / 255,
      colorB: 0,
      strength: 0.5,
      radius: 40,
      time: 2,
    });
  });

  it("maps deterministic stylized shader effects into native grading", () => {
    const request = buildNativeVideoProjectRequest(makeScene([
      makeVideoLayer({ effects: [
        { effectId: "fx-pixelate", renderer: "pixelate", type: "video_effect", intensity: 0.5, localTime: 0, parameters: { pixelSize: 20 } },
        { effectId: "fx-scanlines", renderer: "scanlines", type: "video_effect", intensity: 0.4, localTime: 0, parameters: { scanlineCount: 100 } },
        { effectId: "fx-rgb", renderer: "rgb-split", type: "video_effect", intensity: 0.25, localTime: 0, parameters: { splitDistance: 8 } },
      ] }),
    ]));
    expect(request?.layers[0].colorGrade).toMatchObject({
      pixelateSize: 10,
      scanlineCount: 100,
      scanlineIntensity: 0.4,
      rgbSplitX: 2,
      rgbSplitY: 2,
    });
  });

  it("maps bounded glitch effects into the native sampling contract", () => {
    const request = buildNativeVideoProjectRequest(makeScene([makeVideoLayer({
      effects: [{
        effectId: "glitch",
        renderer: "glitch",
        type: "video_effect",
        intensity: 0.8,
        localTime: 1.25,
        parameters: { glitchIntensity: 70, sliceCount: 8, colorOffset: 14 },
      }],
    })]));

    expect(request?.layers[0].colorGrade?.glitchIntensity).toBeCloseTo(0.56, 6);
    expect(request?.layers[0].colorGrade?.glitchTime).toBeCloseTo(1.25, 6);
    expect(request?.layers[0].colorGrade?.glitchSliceCount).toBe(8);
    expect(request?.layers[0].colorGrade?.glitchColorShift).toBeCloseTo(11.2, 6);
  });

  it("maps distortion effects into the native sampling contract", () => {
    const request = buildNativeVideoProjectRequest(makeScene([makeVideoLayer({
      effects: [{
        effectId: "wave",
        renderer: "wave",
        type: "video_effect",
        intensity: 0.75,
        localTime: 0.5,
        parameters: { amount: 0.12, frequency: 9 },
      }],
    })]));

    expect(request?.layers[0].colorGrade?.distortionType).toBe(1);
    expect(request?.layers[0].colorGrade?.distortionStrength).toBeCloseTo(0.09, 6);
    expect(request?.layers[0].colorGrade?.distortionTime).toBeCloseTo(0.5, 6);
    expect(request?.layers[0].colorGrade?.distortionFrequency).toBe(9);
  });

  it("maps deterministic VHS and CRT controls into the native grading pass", () => {
    const request = buildNativeVideoProjectRequest(makeScene([
      makeVideoLayer({ effects: [
        { effectId: "fx-vhs", renderer: "vhs", type: "video_effect", intensity: 0.5, localTime: 0, parameters: { scanlineCount: 100, colorOffset: 6, noiseAmount: 0.2 } },
        { effectId: "fx-crt", renderer: "crt", type: "video_effect", intensity: 0.25, localTime: 0, parameters: { scanlineCount: 140 } },
      ] }),
    ]));
    expect(request?.layers[0].colorGrade).toMatchObject({
      scanlineCount: 140,
      scanlineIntensity: 0.5,
      rgbSplitX: 3,
      rgbSplitY: 3,
      grainIntensity: 0.1,
      vignette: 0.25,
    });
  });

  it("rejects unsupported structured color controls until native resources exist", () => {
    expect(buildNativeVideoProjectRequest(makeScene([
      makeVideoLayer({ adjustments: { halation: { color: "#ff0000", threshold: 0.8, intensity: 0.2 } } as never }),
    ]))).toBeNull();
  });

  it("maps procedural fire, particles, and dust into the native shader contract", () => {
    const scene = makeScene([makeVideoLayer({
      effects: [
        { effectId: "fire", renderer: "fire", type: "video_effect", intensity: 0.8, localTime: 1.25, parameters: { fireHeight: 0.5, particleCount: 64, fireColor1: "#ff0000", fireColor2: "#ff8800", fireColor3: "#ffff00" } },
        { effectId: "particles", renderer: "particles", type: "video_effect", intensity: 0.6, localTime: 2.5, parameters: { particleCount: 80, particleSize: 4, driftSpeed: 1.5, fadeEffect: true, particleColor: "#336699" } },
        { effectId: "dust_particles", renderer: "dust_particles", type: "video_effect", intensity: 0.2, localTime: 0.5, parameters: {} },
      ],
    })]);

    const request = buildNativeVideoProjectRequest(scene);
    expect(request?.layers[0].colorGrade).toMatchObject({
      fireParams: [0.5, 64, 0.8, 1.25],
      fireColor1: [1, 0, 0, 0],
      fireColor2: [1, 136 / 255, 0, 0],
      fireColor3: [1, 1, 0, 0],
      particleParams: [80, 4, 1.5, 0.6],
      particleColor: [51 / 255, 102 / 255, 153 / 255, 1.5],
      particleTime: 2.5,
    });
    expect(getNativePreviewBlockers(scene)).not.toContain(
      'Video effect "fire" on media layer clip-1 has no native compositor implementation.',
    );
  });

  it("maps supported MPG v2 color stacks into the native grade", () => {
    const scene = makeScene([makeVideoLayer({
      filter: {
        id: "mpg-stack",
        name: "MPG Stack",
        intensity: 1,
        pipeline: "v2",
        effectStack: [
          { type: "Brightness", params: { brightness: 0.1 } },
          { type: "Contrast", params: { contrast: 0.2 } },
          { type: "GaussianBlur", params: { blur: 4 } },
        ],
      } as never,
    })]);

    expect(buildNativeVideoProjectRequest(scene)?.layers[0].colorGrade).toMatchObject({
      brightness: 0.1,
      contrast: 1.2,
      blurStrength: 1,
      blurRadius: 4,
    });
    expect(getNativePreviewBlockers(scene)).not.toContain(
      'Filter "mpg-stack" on media layer clip-1 contains MPG v2 nodes that are not supported by the native compositor.',
    );
  });

  it("reports unsupported MPG v2 nodes as an explicit native blocker", () => {
    const scene = makeScene([makeVideoLayer({
      filter: {
        id: "mpg-stack",
        name: "MPG Stack",
        intensity: 1,
        pipeline: "v2",
        effectStack: [{ type: "unsupported_shader_node" }],
      } as never,
    })]);

    expect(getNativePreviewBlockers(scene)).toContain(
      'Filter "mpg-stack" on media layer clip-1 contains MPG v2 nodes that are not supported by the native compositor.',
    );
  });

  it("carries a registered clip LUT binding into the native request", () => {
    const request = buildNativeVideoProjectRequest(makeScene([
      makeVideoLayer({
        colorGrade: {
          exposure: 0,
          contrast: 1,
          saturation: 1,
          temperature: 0,
          tint: 0,
          lutIntensity: 0.65,
          lutSize: 33,
          hasLut: 1,
          lutId: "lut-clip-1",
        },
      }),
    ]));

    expect(request?.layers[0].colorGrade).toMatchObject({
      lutId: "lut-clip-1",
      lutIntensity: 0.65,
      lutSize: 33,
    });
  });
});

describe("isRenderableNativePreviewFrame", () => {
  it("accepts a legitimate opaque black video frame", () => {
    expect(isRenderableNativePreviewFrame(new Uint8Array([0, 0, 0, 255]).buffer, 1, 1)).toBe(true);
  });

  it("accepts a visible opaque pixel", () => {
    expect(isRenderableNativePreviewFrame(new Uint8Array([12, 24, 36, 255]).buffer, 1, 1)).toBe(true);
  });

  it("rejects invalid byte lengths", () => {
    expect(isRenderableNativePreviewFrame(new Uint8Array([12, 24, 36]).buffer, 1, 1)).toBe(false);
  });
});

describe("buildNativeFrameRequest", () => {
  it("uses integer frame addressing and includes the project revision", () => {
    const request = buildNativeFrameRequest(makeScene([makeVideoLayer({ sourceTime: 2.25 })]), "project-1:7", 67, 30, 960, 540);

    expect(request).toMatchObject({
      contractVersion: 2,
      requestId: "project-1:7:67:960x540",
      frameTime: { frameIndex: 67, ticks: 2_233_333, timescale: 1_000_000 },
      project: { projectRevision: "project-1:7" },
      outputWidth: 960,
      outputHeight: 540,
    });
    expect(request?.project.videoLayers[0].sourceTime).toEqual({
      frameIndex: 68,
      ticks: 2_250_000,
      timescale: 1_000_000,
    });
  });

  it("does not serialize raster bytes into the per-frame scheduler key", () => {
    const imageLayer = {
      ...makeVideoLayer({ layerId: "sticker", clipId: "sticker", mediaId: "sticker" }),
      layerType: "media",
      mediaType: "image",
    } as never;
    const request = buildNativeFrameRequest(
      makeScene([makeVideoLayer(), imageLayer]),
      "project-1:7",
      67,
      30,
      960,
      540,
      [{
        assetId: "native-image:sticker:abcd1234",
        rgba: Array.from({ length: 32 * 32 * 4 }, () => 255),
        width: 32,
        height: 32,
        x: 10,
        y: 20,
        rotation: 0,
        opacity: 1,
        zIndex: 1,
        blendMode: "normal",
      }],
    );

    const key = getNativeFrameRequestKey(request!);
    expect(key).not.toContain("255,255,255,255");
    expect(key).toContain("native-image:sticker:abcd1234");
  });

  it("reuses a rendered frame across seek generations and scheduling modes", () => {
    const request = buildNativeFrameRequest(makeScene([makeVideoLayer()]), "project-1:7", 67, 30, 960, 540)!;
    const first = getNativeFrameRequestKey({
      ...request,
      generation: 1,
      mode: "seek",
      requestedAtMs: 100,
      scrubVelocityPxPerSecond: 240,
    });
    const second = getNativeFrameRequestKey({
      ...request,
      generation: 2,
      mode: "playback-lookahead",
      requestedAtMs: 200,
      scrubVelocityPxPerSecond: 0,
    });

    expect(second).toBe(first);
  });

  it("keeps resolved native text styling, karaoke runs, and template data typed", () => {
    const textLayer = {
      ...makeVideoLayer(),
      layerId: "title",
      clipId: "title",
      layerType: "text",
      text: "Hello world",
      fontFamily: "Inter Variable",
      fontSize: 48,
      color: "#ffffff",
      fontWeight: 700,
      fontStyle: "italic",
      textAlign: "center",
      verticalAlign: "bottom",
      lineHeight: 1.2,
      letterSpacing: 2,
      stroke: { color: "#00ffff", width: 3 },
      shadow: { color: "#000000aa", blur: 8, offsetX: 2, offsetY: 4 },
      background: { color: "#00000088", padding: 12, borderRadius: 8 },
      runs: [{ text: "Hello ", highlighted: false }, { text: "world", highlighted: true }],
      templateId: "lower-third",
      customization: { accent: "#00ffff" },
      styleId: "neon-glow",
    } as never;
    const request = buildNativeFrameRequest(makeScene([textLayer]), "project-1:7", 67, 30, 1920, 1080)!;
    const text = request.project.textLayers?.[0];

    expect(text).toMatchObject({
      fontWeight: "700",
      fontStyle: "italic",
      verticalAlign: "bottom",
      strokeWidth: 3,
      shadowBlur: 8,
      background: { padding: 12, borderRadius: 8 },
      templateId: "lower-third",
      templateData: { accent: "#00ffff" },
    });
    expect(text?.runs?.find((run) => run.highlighted)?.text).toBe("world");
  });
});

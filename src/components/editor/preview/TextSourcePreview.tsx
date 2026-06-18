import React, { useRef, useEffect, useCallback } from "react";
import { LottiePlayer } from "@/features/text-templates/LottiePlayer";
import { renderTextEffectCore, type TextEffectConfig, _buildConfig } from "@clypra/engine";
import { getFontLoader } from "@/core/fonts/FontLoader";

// Effects are designed for this banner canvas size (800×200).
const PREVIEW_CANVAS_W = 800;
const PREVIEW_CANVAS_H = 200;

interface TextSourcePreviewProps {
  preset: (TextEffectConfig & { presetType?: "effect" | "template" }) | null;
}

const normalizePreviewFontWeight = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(900, Math.max(100, Math.round(value / 100) * 100));
  }

  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return normalizePreviewFontWeight(numeric);
    }

    const normalized = value.trim().toLowerCase().replace(/[\s_-]/g, "");
    if (normalized === "thin") return 100;
    if (normalized === "extralight" || normalized === "ultralight") return 200;
    if (normalized === "light") return 300;
    if (normalized === "normal" || normalized === "regular") return 400;
    if (normalized === "medium") return 500;
    if (normalized === "semibold" || normalized === "demibold") return 600;
    if (normalized === "bold") return 700;
    if (normalized === "extrabold" || normalized === "ultrabold") return 800;
    if (normalized === "black" || normalized === "heavy") return 900;
  }

  return 700;
};

export const resolveTextSourcePreviewConfig = (preset: any): TextEffectConfig => {
  // Built-in presets are nested TextEffectDefinition structures, while API presets can be flat TextEffectConfig structures.
  // Normalize them into the exact config shape consumed by renderTextEffectCore.
  const isNested = !!preset?.font;
  const config = isNested ? _buildConfig(preset, preset.text || "CLYPRA", preset.fontSize || 100, PREVIEW_CANVAS_W, PREVIEW_CANVAS_H) : preset;

  return {
    ...config,
    text: config.text || "CLYPRA",
    effectName: config.effectName || config.name || preset?.name || "Effect",
    fontFamily: config.fontFamily || preset?.font?.family || preset?.fontFamily || "Inter Variable",
    fontWeight: normalizePreviewFontWeight(config.fontWeight ?? preset?.font?.weight ?? preset?.fontWeight),
    fontStyle: config.fontStyle || preset?.font?.style || preset?.fontStyle || "normal",
    letterSpacing: config.letterSpacing ?? preset?.font?.letterSpacing ?? preset?.letterSpacing ?? 0,
    lineHeight: config.lineHeight ?? preset?.font?.lineHeight ?? preset?.lineHeight ?? 1.2,
    glowLayers: config.glowLayers || [],
  };
};

export const TextSourcePreview: React.FC<TextSourcePreviewProps> = ({ preset }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mountedRef = useRef(true);

  console.log("[TextSourcePreview] Component render", {
    hasPreset: !!preset,
    presetId: (preset as any)?.id,
    presetName: (preset as any)?.name,
  });

  const setCanvasRef = useCallback((node: HTMLCanvasElement | null) => {
    console.log("[TextSourcePreview] Canvas ref callback", { hasNode: !!node });
    (canvasRef as { current: HTMLCanvasElement | null }).current = node;
    if (node) {
      // Get device pixel ratio for high-DPI displays
      const dpr = window.devicePixelRatio || 1;

      // Set logical size via CSS
      node.style.width = `${PREVIEW_CANVAS_W}px`;
      node.style.height = `${PREVIEW_CANVAS_H}px`;

      // Set actual canvas buffer size accounting for DPI (but keep at 1:1 for text effects)
      // Text effects are designed at 800×200, so we render at that exact size
      node.width = PREVIEW_CANVAS_W;
      node.height = PREVIEW_CANVAS_H;

      console.log("[TextSourcePreview] Canvas setup", {
        logicalWidth: PREVIEW_CANVAS_W,
        logicalHeight: PREVIEW_CANVAS_H,
        bufferWidth: node.width,
        bufferHeight: node.height,
        dpr,
      });
    }
  }, []);

  useEffect(() => {
    console.log("[TextSourcePreview] Mount effect");
    mountedRef.current = true;
    return () => {
      console.log("[TextSourcePreview] Unmount effect");
      mountedRef.current = false;
    };
  }, []);

  const isTemplate = preset?.presetType === "template" || !!(preset as any)?.lottieData;
  const isEffect = !isTemplate && (preset?.presetType === "effect" || !!(preset as any)?.fontFamily);

  console.log("[TextSourcePreview] Type check", { isTemplate, isEffect });

  useEffect(() => {
    console.log("[TextSourcePreview] Render effect", {
      hasCanvas: !!canvasRef.current,
      isEffect,
      hasPreset: !!preset,
    });

    const canvas = canvasRef.current;
    if (!canvas || !isEffect || !preset) {
      console.log("[TextSourcePreview] Skipping render - requirements not met");
      return;
    }

    console.log("[TextSourcePreview] Starting render process");
    let aborted = false;

    const effectConfig = resolveTextSourcePreviewConfig(preset);

    console.log("[TextSourcePreview] 🎨 Rendering preview using config:", effectConfig);

    console.log("[TextSourcePreview] Raw preset fontFamily:", (preset as any).fontFamily);
    console.log("[TextSourcePreview] Full preset keys:", Object.keys(preset as any).slice(0, 15));
    console.log("[TextSourcePreview] Canvas dimensions from preset:", {
      canvasWidth: (preset as any).canvasWidth,
      canvasHeight: (preset as any).canvasHeight,
      fontSize: (preset as any).fontSize,
    });
    console.log(
      "[TextSourcePreview] Glow layers:",
      (preset as any).glowLayers?.map((g: any) => ({
        enabled: g.enabled,
        blur: g.blur,
        spread: g.spread,
        color: g.color,
        type: g.type,
      })),
    );

    console.log("[TextSourcePreview] Config check:", {
      hasFontFamily: !!effectConfig.fontFamily,
      hasEffectName: !!effectConfig.effectName,
      hasGlowLayers: Array.isArray(effectConfig.glowLayers),
      fontFamily: effectConfig.fontFamily,
      fontWeight: effectConfig.fontWeight,
      fontStyle: effectConfig.fontStyle,
      letterSpacing: effectConfig.letterSpacing,
      lineHeight: effectConfig.lineHeight,
    });

    async function start() {
      if (effectConfig.fontFamily) {
        try {
          const fontFace = `${effectConfig.fontStyle || "normal"} ${effectConfig.fontWeight || 700} 16px "${effectConfig.fontFamily}"`;
          await getFontLoader().ensureFont({
            family: effectConfig.fontFamily,
            weight: effectConfig.fontWeight || 700,
            style: effectConfig.fontStyle || "normal",
          });
          if (typeof document !== "undefined" && document.fonts) {
            await document.fonts.load(fontFace);
            if (!document.fonts.check(fontFace)) {
              console.warn("[TextSourcePreview] Exact preview font variant is not available:", fontFace);
            }
          }
        } catch (error) {
          console.warn("[TextSourcePreview] Font load failed:", error);
        }
      }

      if (typeof document !== "undefined" && document.fonts) {
        await document.fonts.ready;
      }

      if (aborted || !mountedRef.current) return;

      const ctx = canvas!.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, PREVIEW_CANVAS_W, PREVIEW_CANVAS_H);

      try {
        renderTextEffectCore(ctx, effectConfig);
        console.log("[TextSourcePreview] ✅ Rendered:", (effectConfig as any).id);
      } catch (error) {
        console.error("[TextSourcePreview] ❌ Error:", error);
        ctx.fillStyle = "#ff0000";
        ctx.font = "14px Arial";
        ctx.textAlign = "center";
        ctx.fillText("Render Error", PREVIEW_CANVAS_W / 2, PREVIEW_CANVAS_H / 2);
      }
    }

    start();

    return () => {
      aborted = true;
    };
  }, [preset, isEffect]);

  if (!preset) return null;

  if (isTemplate) {
    return (
      <div className="w-full aspect-video bg-black flex items-center justify-center relative p-8 shadow-[0_0_40px_rgba(0,0,0,0.8)] border border-white/5 overflow-hidden">
        <LottiePlayer lottieData={(preset as any).injectedData || (preset as any).lottieData} autoplay={true} loop={true} className="w-full h-full object-contain" />
      </div>
    );
  }

  return (
    <div className="w-full flex items-center justify-center relative overflow-hidden checkerboard" style={{ aspectRatio: `${PREVIEW_CANVAS_W} / ${PREVIEW_CANVAS_H}` }}>
      <canvas
        ref={setCanvasRef}
        style={{
          width: `${PREVIEW_CANVAS_W}px`,
          height: `${PREVIEW_CANVAS_H}px`,
          maxWidth: "100%",
          maxHeight: "100%",
          objectFit: "contain",
        }}
        className="block select-none pointer-events-none"
      />
    </div>
  );
};

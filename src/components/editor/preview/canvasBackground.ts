import type { CSSProperties } from "react";
import type { CanvasBackgroundConfig } from "@/types";

const DEFAULT_BACKGROUND: CanvasBackgroundConfig = {
  type: "solid",
  color: "#000000",
  opacity: 1,
  isTransparent: false,
};

const TRANSPARENT_CHECKERBOARD =
  "url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" viewBox=\"0 0 16 16\"><rect width=\"8\" height=\"8\" fill=\"%231a1a24\"/><rect x=\"8\" width=\"8\" height=\"8\" fill=\"%2312121a\"/><rect y=\"8\" width=\"8\" height=\"8\" fill=\"%2312121a\"/><rect x=\"8\" y=\"8\" width=\"8\" height=\"8\" fill=\"%231a1a24\"/></svg>')";

const SHADER_BASE_DURATION_SECONDS: Record<NonNullable<CanvasBackgroundConfig["shader"]>["presetId"], number> = {
  liquid_aurora: 18,
  neon_grid: 12,
  particle_dust: 20,
  gradient_wave: 14,
};

type CanvasBackgroundLayer = {
  className: string;
  style: CSSProperties;
};

function clampOpacity(opacity: unknown): number {
  return typeof opacity === "number" && Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1;
}

function buildGradient(config: CanvasBackgroundConfig): string {
  const gradient = config.gradient;
  const start = gradient?.stops?.[0]?.color || "#1e1e2d";
  const end = gradient?.stops?.[1]?.color || "#000000";

  if (gradient?.type === "radial") {
    return `radial-gradient(circle, ${start}, ${end})`;
  }

  return `linear-gradient(${gradient?.angle ?? 135}deg, ${start}, ${end})`;
}

export function getCanvasBackgroundLayer(config?: CanvasBackgroundConfig): CanvasBackgroundLayer {
  const bgConfig = config || DEFAULT_BACKGROUND;

  if (bgConfig.isTransparent) {
    return {
      className: "",
      style: {
        background: TRANSPARENT_CHECKERBOARD,
        opacity: 1,
      },
    };
  }

  const opacity = clampOpacity(bgConfig.opacity);

  if (bgConfig.type === "gradient") {
    return {
      className: "",
      style: {
        background: buildGradient(bgConfig),
        opacity,
      },
    };
  }

  if (bgConfig.type === "shader") {
    const presetId = bgConfig.shader?.presetId || "liquid_aurora";
    const speed = Math.max(0.1, bgConfig.shader?.speed ?? 1);
    const intensity = Math.max(0, bgConfig.shader?.intensity ?? 1);
    const duration = SHADER_BASE_DURATION_SECONDS[presetId] / speed;

    return {
      className: `clypra-canvas-bg-shader clypra-canvas-bg-shader-${presetId}`,
      style: {
        opacity,
        animationDuration: `${duration}s`,
        "--clypra-bg-intensity": String(intensity),
      } as CSSProperties,
    };
  }

  if (bgConfig.type === "media" && bgConfig.mediaUrl) {
    return {
      className: "",
      style: {
        backgroundImage: `url("${bgConfig.mediaUrl}")`,
        backgroundPosition: "center",
        backgroundSize: "cover",
        opacity,
      },
    };
  }

  return {
    className: "",
    style: {
      background: bgConfig.color || "#000000",
      opacity,
    },
  };
}

import type { CanvasBackgroundConfig } from "@/types";

const DEFAULT_BACKGROUND: CanvasBackgroundConfig = {
  type: "solid",
  color: "#000000",
  opacity: 1,
  isTransparent: false,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function opacityOf(config: CanvasBackgroundConfig): number {
  return clamp(typeof config.opacity === "number" && Number.isFinite(config.opacity) ? config.opacity : 1, 0, 1);
}

function fillRadial(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string): void {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

function drawShaderBackground(ctx: CanvasRenderingContext2D, config: CanvasBackgroundConfig, width: number, height: number, time: number): void {
  const preset = config.shader?.presetId ?? "liquid_aurora";
  const speed = Math.max(0.1, config.shader?.speed ?? 1);
  const intensity = Math.max(0, config.shader?.intensity ?? 1);
  const t = time * speed;

  if (preset === "neon_grid") {
    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, "#12071f");
    bg.addColorStop(0.52, "#1f1235");
    bg.addColorStop(1, "#05070d");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    fillRadial(ctx, width * 0.5, height * (0.22 + Math.sin(t * 0.7) * 0.05), Math.max(width, height) * 0.34, `rgba(245, 158, 11, ${0.55 * intensity})`);
    const grid = 42;
    ctx.lineWidth = 1;
    for (let x = ((t * 24) % grid) - grid; x < width + grid; x += grid) {
      ctx.strokeStyle = `rgba(236, 72, 153, ${0.2 * intensity})`;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = ((t * 18) % grid) - grid; y < height + grid; y += grid) {
      ctx.strokeStyle = `rgba(34, 211, 238, ${0.22 * intensity})`;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    return;
  }

  if (preset === "particle_dust") {
    const bg = ctx.createLinearGradient(0, 0, width, height);
    bg.addColorStop(0, "#09090b");
    bg.addColorStop(0.55, "#172033");
    bg.addColorStop(1, "#050814");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    fillRadial(ctx, width * (0.55 + Math.sin(t * 0.25) * 0.08), height * 0.42, Math.max(width, height) * 0.35, `rgba(59, 130, 246, ${0.34 * intensity})`);
    for (let i = 0; i < 90; i++) {
      const seed = i * 12.9898;
      const x = (Math.sin(seed) * 43758.5453) % 1;
      const y = (Math.cos(seed) * 24634.6345) % 1;
      const px = ((x < 0 ? x + 1 : x) * width + Math.sin(t * 0.4 + i) * 18) % width;
      const py = ((y < 0 ? y + 1 : y) * height + Math.cos(t * 0.32 + i) * 14) % height;
      ctx.fillStyle = `rgba(255, 255, 255, ${0.18 * intensity})`;
      ctx.beginPath();
      ctx.arc(px, py, i % 5 === 0 ? 1.6 : 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }

  if (preset === "gradient_wave") {
    const bg = ctx.createLinearGradient(0, 0, width, height);
    bg.addColorStop(0, "#06131f");
    bg.addColorStop(0.5, "#111827");
    bg.addColorStop(1, "#1b1022");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    fillRadial(ctx, width * (0.3 + Math.sin(t * 0.35) * 0.12), height * 0.38, Math.max(width, height) * 0.48, `rgba(14, 165, 233, ${0.62 * intensity})`);
    fillRadial(ctx, width * (0.78 + Math.cos(t * 0.28) * 0.08), height * 0.52, Math.max(width, height) * 0.46, `rgba(249, 115, 22, ${0.54 * intensity})`);
    fillRadial(ctx, width * 0.68, height * (0.62 + Math.sin(t * 0.3) * 0.1), Math.max(width, height) * 0.38, `rgba(168, 85, 247, ${0.58 * intensity})`);
    return;
  }

  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, "#050816");
  bg.addColorStop(0.42, "#111827");
  bg.addColorStop(1, "#07111f");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  fillRadial(ctx, width * (0.18 + Math.sin(t * 0.32) * 0.08), height * 0.24, Math.max(width, height) * 0.42, `rgba(34, 211, 238, ${0.8 * intensity})`);
  fillRadial(ctx, width * (0.82 + Math.cos(t * 0.27) * 0.08), height * 0.22, Math.max(width, height) * 0.38, `rgba(244, 114, 182, ${0.72 * intensity})`);
  fillRadial(ctx, width * 0.55, height * (0.78 + Math.sin(t * 0.25) * 0.07), Math.max(width, height) * 0.42, `rgba(132, 204, 22, ${0.48 * intensity})`);
}

export function drawCanvasBackground(
  ctx: CanvasRenderingContext2D,
  config: CanvasBackgroundConfig | undefined,
  width: number,
  height: number,
  time = 0,
): void {
  const bgConfig = config ?? DEFAULT_BACKGROUND;
  ctx.clearRect(0, 0, width, height);

  if (bgConfig.isTransparent) return;

  ctx.save();
  ctx.globalAlpha = opacityOf(bgConfig);

  if (bgConfig.type === "gradient") {
    const stops = bgConfig.gradient?.stops ?? [
      { color: "#1e1e2d", offset: 0 },
      { color: "#000000", offset: 100 },
    ];
    const start = stops[0]?.color ?? "#1e1e2d";
    const end = stops[1]?.color ?? "#000000";
    const gradient =
      bgConfig.gradient?.type === "radial"
        ? ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height) / 1.35)
        : (() => {
            const angle = ((bgConfig.gradient?.angle ?? 135) * Math.PI) / 180;
            const x = Math.cos(angle) * width;
            const y = Math.sin(angle) * height;
            return ctx.createLinearGradient(width / 2 - x / 2, height / 2 - y / 2, width / 2 + x / 2, height / 2 + y / 2);
          })();
    gradient.addColorStop(0, start);
    gradient.addColorStop(1, end);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  } else if (bgConfig.type === "shader") {
    drawShaderBackground(ctx, bgConfig, width, height, time);
  } else {
    ctx.fillStyle = bgConfig.color || "#000000";
    ctx.fillRect(0, 0, width, height);
  }

  ctx.restore();
}

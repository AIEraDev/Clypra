import React, { useRef, useEffect } from "react";
import type { VideoScopePayload, ScopeType } from "@/types/scopes";

interface VideoScopeCanvasProps {
  payload?: VideoScopePayload;
  scopeType: ScopeType;
  width?: number;
  height?: number;
}

export const VideoScopeCanvas: React.FC<VideoScopeCanvasProps> = ({
  payload,
  scopeType,
  width = 320,
  height = 240,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear background
    ctx.fillStyle = "#0c0d10";
    ctx.fillRect(0, 0, width, height);

    if (!payload) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
      ctx.font = "11px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Waiting for frame telemetry...", width / 2, height / 2);
      return;
    }

    if (scopeType === "histogram" && payload.histogram) {
      renderHistogram(ctx, payload.histogram, width, height);
    } else if (scopeType === "waveform" && payload.waveform) {
      renderWaveform(ctx, payload.waveform, width, height);
    } else if (scopeType === "rgb_parade" && payload.rgbParade) {
      renderRgbParade(ctx, payload.rgbParade, width, height);
    } else if (scopeType === "vectorscope" && payload.vectorscope) {
      renderVectorscope(ctx, payload.vectorscope, width, height);
    }
  }, [payload, scopeType, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="rounded bg-black border border-white/10 shadow-inner"
    />
  );
};

function renderHistogram(
  ctx: CanvasRenderingContext2D,
  hist: NonNullable<VideoScopePayload["histogram"]>,
  w: number,
  h: number
) {
  const padding = 16;
  const plotW = w - padding * 2;
  const plotH = h - padding * 2;
  const max = Math.max(hist.maxBinCount, 1);

  // Background Grid Lines
  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.lineWidth = 1;
  for (let i = 1; i <= 3; i++) {
    const y = padding + plotH * (1 - i / 4);
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(w - padding, y);
    ctx.stroke();
  }

  const drawChannel = (bins: number[], stroke: string, fill: string) => {
    ctx.beginPath();
    ctx.moveTo(padding, padding + plotH);
    for (let i = 0; i < 256; i++) {
      const x = padding + (i / 255) * plotW;
      const count = bins[i] || 0;
      const y = padding + plotH - (count / max) * plotH;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(padding + plotW, padding + plotH);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();

    ctx.beginPath();
    for (let i = 0; i < 256; i++) {
      const x = padding + (i / 255) * plotW;
      const count = bins[i] || 0;
      const y = padding + plotH - (count / max) * plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  };

  drawChannel(hist.red, "#ef4444", "rgba(239, 68, 68, 0.15)");
  drawChannel(hist.green, "#22c55e", "rgba(34, 197, 94, 0.15)");
  drawChannel(hist.blue, "#3b82f6", "rgba(59, 130, 246, 0.15)");
  drawChannel(hist.luma, "#ffffff", "rgba(255, 255, 255, 0.08)");

  // Axis Labels
  ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
  ctx.font = "9px Inter, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("0 (Shadows)", padding, h - 4);
  ctx.textAlign = "center";
  ctx.fillText("128 (Mids)", w / 2, h - 4);
  ctx.textAlign = "right";
  ctx.fillText("255 (Highlights)", w - padding, h - 4);
}

function renderWaveform(
  ctx: CanvasRenderingContext2D,
  grid: NonNullable<VideoScopePayload["waveform"]>,
  w: number,
  h: number
) {
  const padding = 16;
  const plotW = w - padding * 2;
  const plotH = h - padding * 2;

  // Offscreen density rendering
  const imgData = ctx.createImageData(grid.width, grid.height);
  const data = imgData.data;
  for (let i = 0; i < grid.data.length; i++) {
    const density = grid.data[i];
    const offset = i * 4;
    if (density > 0) {
      // Green phosphor color grading
      data[offset] = Math.min(255, density * 2); // R
      data[offset + 1] = 255; // G
      data[offset + 2] = Math.min(255, density * 3); // B
      data[offset + 3] = density; // A
    }
  }

  // Draw bitmap stretched to plot area
  const offscreen = document.createElement("canvas");
  offscreen.width = grid.width;
  offscreen.height = grid.height;
  const offCtx = offscreen.getContext("2d");
  if (offCtx) {
    offCtx.putImageData(imgData, 0, 0);
    ctx.drawImage(offscreen, padding, padding, plotW, plotH);
  }

  // IRE Scale Graticule (0 to 100 IRE)
  const ireLevels = [
    { ire: 100, label: "100 IRE", color: "rgba(239, 68, 68, 0.4)" },
    { ire: 75, label: "75", color: "rgba(255, 255, 255, 0.15)" },
    { ire: 50, label: "50", color: "rgba(255, 255, 255, 0.15)" },
    { ire: 25, label: "25", color: "rgba(255, 255, 255, 0.15)" },
    { ire: 0, label: "0 IRE", color: "rgba(59, 130, 246, 0.4)" },
  ];

  ctx.font = "8px Inter, sans-serif";
  for (const { ire, label, color } of ireLevels) {
    const y = padding + plotH * (1.0 - ire / 100.0);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(w - padding, y);
    ctx.stroke();

    ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
    ctx.textAlign = "right";
    ctx.fillText(label, padding - 2, y + 3);
  }
}

function renderRgbParade(
  ctx: CanvasRenderingContext2D,
  parade: NonNullable<VideoScopePayload["rgbParade"]>,
  w: number,
  h: number
) {
  const padding = 16;
  const totalW = w - padding * 2;
  const plotH = h - padding * 2;
  const channelW = Math.floor((totalW - 8) / 3);

  const drawParadeChannel = (
    channelData: number[],
    xOffset: number,
    colorR: number,
    colorG: number,
    colorB: number,
    label: string
  ) => {
    const imgData = ctx.createImageData(parade.width, parade.height);
    const data = imgData.data;
    for (let i = 0; i < channelData.length; i++) {
      const density = channelData[i];
      const offset = i * 4;
      if (density > 0) {
        data[offset] = colorR;
        data[offset + 1] = colorG;
        data[offset + 2] = colorB;
        data[offset + 3] = density;
      }
    }

    const offscreen = document.createElement("canvas");
    offscreen.width = parade.width;
    offscreen.height = parade.height;
    const offCtx = offscreen.getContext("2d");
    if (offCtx) {
      offCtx.putImageData(imgData, 0, 0);
      ctx.drawImage(offscreen, xOffset, padding, channelW, plotH);
    }

    // Border and Label
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.strokeRect(xOffset, padding, channelW, plotH);

    ctx.fillStyle = `rgb(${colorR}, ${colorG}, ${colorB})`;
    ctx.font = "9px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(label, xOffset + channelW / 2, padding - 4);
  };

  drawParadeChannel(parade.red, padding, 239, 68, 68, "Red");
  drawParadeChannel(parade.green, padding + channelW + 4, 34, 197, 94, "Green");
  drawParadeChannel(parade.blue, padding + (channelW + 4) * 2, 59, 130, 246, "Blue");
}

function renderVectorscope(
  ctx: CanvasRenderingContext2D,
  grid: NonNullable<VideoScopePayload["vectorscope"]>,
  w: number,
  h: number
) {
  const size = Math.min(w, h) - 24;
  const cx = w / 2;
  const cy = h / 2;
  const radius = size / 2;

  // Graticule Circles (20%, 40%, 60%, 80%, 100% Saturation)
  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.lineWidth = 1;
  for (const factor of [0.2, 0.4, 0.6, 0.8, 1.0]) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius * factor, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Crosshairs
  ctx.beginPath();
  ctx.moveTo(cx - radius, cy);
  ctx.lineTo(cx + radius, cy);
  ctx.moveTo(cx, cy - radius);
  ctx.lineTo(cx, cy + radius);
  ctx.stroke();

  // Skin Tone Line (I-Axis at 123 degrees)
  const skinAngleRad = (123.0 * Math.PI) / 180.0;
  ctx.strokeStyle = "rgba(251, 146, 60, 0.6)"; // Amber skin tone indicator
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(skinAngleRad) * radius, cy - Math.sin(skinAngleRad) * radius);
  ctx.stroke();

  // Density Points Image
  const imgData = ctx.createImageData(grid.width, grid.height);
  const data = imgData.data;
  for (let i = 0; i < grid.data.length; i++) {
    const density = grid.data[i];
    const offset = i * 4;
    if (density > 0) {
      data[offset] = 250;
      data[offset + 1] = 204;
      data[offset + 2] = 21; // Yellow phosphor
      data[offset + 3] = density;
    }
  }

  const offscreen = document.createElement("canvas");
  offscreen.width = grid.width;
  offscreen.height = grid.height;
  const offCtx = offscreen.getContext("2d");
  if (offCtx) {
    offCtx.putImageData(imgData, 0, 0);
    ctx.drawImage(offscreen, cx - radius, cy - radius, size, size);
  }

  // Color Bar Target Boxes (R, Mg, B, Cy, G, Yl)
  const targets = [
    { label: "R", angle: 104, color: "#ef4444" },
    { label: "Mg", angle: 61, color: "#ec4899" },
    { label: "B", angle: 347, color: "#3b82f6" },
    { label: "Cy", angle: 284, color: "#06b6d4" },
    { label: "G", angle: 241, color: "#22c55e" },
    { label: "Yl", angle: 167, color: "#eab308" },
  ];

  ctx.font = "8px Inter, sans-serif";
  for (const { label, angle, color } of targets) {
    const rad = (angle * Math.PI) / 180.0;
    const tx = cx + Math.cos(rad) * radius * 0.75;
    const ty = cy - Math.sin(rad) * radius * 0.75;

    ctx.strokeStyle = color;
    ctx.strokeRect(tx - 3, ty - 3, 6, 6);

    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.fillText(label, tx, ty - 5);
  }
}

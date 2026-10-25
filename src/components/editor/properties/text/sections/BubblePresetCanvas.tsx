/**
 * BubblePresetCanvas.tsx
 *
 * Canvas-based preset card renderer for Clypra's Text Bubble system.
 *
 * Invariant:
 * The editor preset of bubble uses an HTML5 Canvas element, NOT HTML document
 * elements (divs/spans/clip-paths), ensuring 1:1 parity with the Canvas/GPU
 * compositor.
 */

import React, { useEffect, useRef } from "react";
import { renderBubbleBackground } from "@/core/render/bubbleRenderer";
import type { BubblePreset } from "../../data/bubblePresets";

interface BubblePresetCanvasProps {
  preset: BubblePreset;
  size?: number;
  className?: string;
}

export const BubblePresetCanvas: React.FC<BubblePresetCanvasProps> = ({
  preset,
  size = 56,
  className = "",
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || preset.isReset) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Reset transform & clear
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size, size);

    // Margin around bubble
    const padX = 5;
    const padY = 7;
    const drawW = size - padX * 2;
    const drawH = size - padY * 2;

    // Render the authentic bubble background on canvas
    renderBubbleBackground(ctx, preset.id, padX, padY, drawW, drawH, {
      color: preset.background?.color || "#ffffff",
      opacity: preset.background?.opacity ?? 1,
      borderRadius: preset.background?.borderRadius
        ? Math.min(preset.background.borderRadius, 6)
        : 4,
    });

    // Render miniature sample text onto canvas if available
    if (preset.sampleText) {
      const textColor =
        preset.defaultTextStyle?.color || preset.textColor || "#111827";
      const isItalic = preset.defaultTextStyle?.fontStyle === "italic";
      const isUnderline =
        preset.defaultTextStyle?.textDecoration === "underline";

      ctx.save();
      ctx.fillStyle = textColor;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `${isItalic ? "italic " : ""}bold 8px sans-serif`;

      // Extract brief display text (up to 9 characters)
      const firstLine = preset.sampleText.split("\n")[0].trim();
      const displayText =
        firstLine.length > 9 ? firstLine.slice(0, 8) + "…" : firstLine;

      const textX = size / 2;
      const textY = size / 2;

      ctx.fillText(displayText, textX, textY);

      if (isUnderline) {
        const metrics = ctx.measureText(displayText);
        ctx.strokeStyle = textColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(textX - metrics.width / 2, textY + 5);
        ctx.lineTo(textX + metrics.width / 2, textY + 5);
        ctx.stroke();
      }

      ctx.restore();
    }
  }, [preset, size]);

  if (preset.isReset) return null;

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      data-testid={`bubble-canvas-${preset.id}`}
      data-bubble-preset-canvas="true"
      className={`w-full h-full object-contain pointer-events-none select-none ${className}`}
    />
  );
};

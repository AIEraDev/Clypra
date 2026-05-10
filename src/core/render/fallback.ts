/**
 * Fallback rendering strategies when no content exists at a time.
 *
 * Professional NLEs handle gaps gracefully:
 * - Black frames
 * - Freeze frames
 * - Placeholder content
 * - Previous frame hold
 */

import type { RenderStack } from "../compositor/types";

export type FallbackStrategy = "black" | "freeze" | "placeholder" | "transparent";

/**
 * Fallback frame data when no content exists.
 */
export interface FallbackFrame {
  type: FallbackStrategy;
  color?: string; // For black/colored backgrounds
  message?: string; // For placeholder text
  previousFrame?: ImageData; // For freeze frame
}

/**
 * Get fallback frame for a time with no content.
 *
 * @param time - Timeline time with no content
 * @param strategy - Fallback strategy to use
 * @param previousStack - Previous render stack (for freeze frame)
 * @returns Fallback frame data
 */
export function getFallbackFrame(time: number, strategy: FallbackStrategy = "black", previousStack?: RenderStack): FallbackFrame {
  switch (strategy) {
    case "black":
      return {
        type: "black",
        color: "#000000",
      };

    case "transparent":
      return {
        type: "transparent",
        color: "transparent",
      };

    case "placeholder":
      return {
        type: "placeholder",
        message: `No content at ${time.toFixed(2)}s`,
      };

    case "freeze":
      // Hold previous frame if available
      if (previousStack && previousStack.hasContent) {
        return {
          type: "freeze",
          message: "Frozen frame",
        };
      }
      // Fall back to black if no previous frame
      return {
        type: "black",
        color: "#000000",
      };

    default:
      return {
        type: "black",
        color: "#000000",
      };
  }
}

/**
 * Render a fallback frame to a canvas context.
 *
 * @param ctx - Canvas 2D context
 * @param width - Canvas width
 * @param height - Canvas height
 * @param fallback - Fallback frame data
 */
export function renderFallbackToCanvas(ctx: CanvasRenderingContext2D, width: number, height: number, fallback: FallbackFrame): void {
  switch (fallback.type) {
    case "black":
    case "transparent":
      ctx.fillStyle = fallback.color || "#000000";
      ctx.fillRect(0, 0, width, height);
      break;

    case "placeholder":
      // Black background with text
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = "#666666";
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(fallback.message || "No content", width / 2, height / 2);
      break;

    case "freeze":
      // Previous frame should already be on canvas
      // Just add a subtle indicator
      ctx.fillStyle = "rgba(255, 255, 0, 0.1)";
      ctx.fillRect(0, 0, width, height);
      break;
  }
}

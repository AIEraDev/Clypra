/**
 * bubbleRenderer.ts
 *
 * Dedicated Canvas2D Bubble Renderer for Clypra's Text Appearance System.
 *
 * Canonical rendering implementation is shared via @clypra-studio/engine
 * to guarantee 100% pixel and behavior parity between Desktop and Studio.
 */

export {
  renderBubbleBackground,
  drawTornPaper,
  drawSpeechBubble,
  drawThoughtCloud,
  drawComicBurst,
  drawRibbonBanner,
  pseudoNoise,
} from "@clypra-studio/engine";

export type { BubbleRenderOptions } from "@clypra-studio/engine";

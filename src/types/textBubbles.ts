/**
 * textBubbles.ts
 *
 * Canonical schema contract and layout resolver for Clypra's
 * Text Bubble & Caption Preset System.
 *
 * Sourced canonically from @clypra-studio/engine to ensure 100%
 * shared contract between Clypra Desktop and Clypra Studio.
 */

import type React from "react";
import type { TextBubblePreset as EngineTextBubblePreset } from "@clypra-studio/engine";

export { resolveBubbleLayout } from "@clypra-studio/engine";
export type {
  TextBubbleCategory,
  BubbleRenderMode,
  TextBubblePadding,
  TextBubbleLayout,
} from "@clypra-studio/engine";

export interface TextBubblePreset extends Omit<EngineTextBubblePreset, "renderPreview"> {
  renderPreview?: (active: boolean) => React.ReactNode;
}

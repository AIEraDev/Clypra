/**
 * Canonical resolution of text template control values.
 *
 * Single Source of Truth (SSOT) across all template rasterization paths:
 *   - Main-thread Canvas renderer (`textRasterizer.ts`)
 *   - OffscreenCanvas worker client (`templateRasterizerWorkerClient.ts`)
 *   - Template instantiator & clip evaluator (`textClip.ts`)
 *   - Video frame exporter (`FrameRenderer.ts`)
 *
 * Re-exported from `@clypra-studio/engine` to maintain SSOT.
 */

export {
  resolveTemplateControlValues,
  type ResolveTemplateControlValuesOptions,
  type TemplateCustomization,
} from "@clypra-studio/engine";

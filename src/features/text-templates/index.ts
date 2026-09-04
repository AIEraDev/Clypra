/**
 * Text Templates Feature
 * Public exports for text template functionality
 */

export { useTemplateStore } from "./templateStore";
export { TextTemplatesCacheManager } from "./cache/cacheManager";
export { textTemplatePersistentCache } from "./cache/persistentCache";
export { renderToFrameSequence, renderFrameSequenceToTauri } from "./FrameRenderer";
export { TemplatePreviewPlayer, type TemplatePreviewPlayerHandle } from "./TemplatePreviewPlayer";

export type { TemplateDefinition } from "./types";

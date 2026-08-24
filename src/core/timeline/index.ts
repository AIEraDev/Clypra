/**
 * Timeline core module - bridge between store and compositor.
 */

export { toCompositorClip, toCompositorClips, fromCompositorClip, inferRoleFromTrackPosition } from "./adapter";
export { legacyClipToTimelineItem, legacyClipsToTimelineItems, timelineItemToLegacyClip } from "./items";
export { resolveClipSourceTime, resolveTimelineItemSourceTime } from "./sourceTime";
export { getActiveAudioClips } from "./audioClips";
export { expandCompoundClips, isCompoundClip, hasTransitionReference } from "./compoundClips";
export type { ExportAudioClipConfig } from "./audioClips";
export * from "./bezier";
export * from "./speedRamp";

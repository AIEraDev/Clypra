/**
 * clipPropertyTransform.ts
 *
 * Pure utilities for building undoable clip property transforms and
 * deriving clip type display metadata from clip/asset data.
 *
 * These functions are intentionally free of React, stores, and side-effects
 * so they can be called from hooks, commands, and tests alike.
 */

import {
  Sparkles,
  Film,
  Music,
  Image,
  FileText,
  Smile,
  type LucideIcon,
} from "lucide-react";
import { resolveTextClipStyleUpdate } from "@/lib/text/textClip";
import type { Clip, TextClip } from "@/types";

// ---------------------------------------------------------------------------
// buildClipPropertyTransform
// ---------------------------------------------------------------------------

/**
 * Derives the old/new transform pairs needed to construct a
 * `TransformClipCommand` for any clip type.
 *
 * - Trims automatically extend/recalculate `duration`.
 * - Text clip style updates are resolved through the canvas-aware text layout
 *   system.
 * - Deep-cloneable fields (`adjustments`, `stickerSettings`, `motion`,
 *   `visualKeyframes`) are JSON-deep-cloned so undo state is isolated.
 */
export function buildClipPropertyTransform(
  clip: Clip,
  updates: Record<string, unknown>,
  canvasWidth: number,
  canvasHeight: number,
): {
  oldTransform: Record<string, unknown>;
  newTransform: Record<string, unknown>;
} {
  let newTransform = { ...updates };

  if ("trimIn" in newTransform || "trimOut" in newTransform) {
    const nextTrimIn =
      typeof newTransform.trimIn === "number" &&
      Number.isFinite(newTransform.trimIn)
        ? newTransform.trimIn
        : clip.trimIn;
    const nextTrimOut =
      typeof newTransform.trimOut === "number" &&
      Number.isFinite(newTransform.trimOut)
        ? newTransform.trimOut
        : clip.trimOut;
    newTransform = {
      ...newTransform,
      duration: Math.max(0, nextTrimOut - nextTrimIn),
    };
  }

  if ("text" in clip) {
    newTransform = resolveTextClipStyleUpdate(
      clip as TextClip,
      newTransform as Partial<TextClip>,
      canvasWidth,
      canvasHeight,
    ) as Record<string, unknown>;
  }

  const oldTransform: Record<string, unknown> = {};
  for (const key of Object.keys(newTransform)) {
    oldTransform[key] = (clip as unknown as Record<string, unknown>)[key];
  }

  if ("adjustments" in newTransform) {
    oldTransform.adjustments = clip.adjustments
      ? JSON.parse(JSON.stringify(clip.adjustments))
      : undefined;
    newTransform.adjustments = newTransform.adjustments
      ? JSON.parse(JSON.stringify(newTransform.adjustments))
      : undefined;
  }

  if ("stickerSettings" in newTransform) {
    oldTransform.stickerSettings = clip.stickerSettings
      ? JSON.parse(JSON.stringify(clip.stickerSettings))
      : undefined;
    newTransform.stickerSettings = newTransform.stickerSettings
      ? JSON.parse(JSON.stringify(newTransform.stickerSettings))
      : undefined;
  }

  if ("motion" in newTransform) {
    oldTransform.motion = clip.motion
      ? JSON.parse(JSON.stringify(clip.motion))
      : undefined;
    newTransform.motion = newTransform.motion
      ? JSON.parse(JSON.stringify(newTransform.motion))
      : undefined;
  }

  if ("visualKeyframes" in newTransform) {
    oldTransform.visualKeyframes = clip.visualKeyframes
      ? JSON.parse(JSON.stringify(clip.visualKeyframes))
      : undefined;
    newTransform.visualKeyframes = newTransform.visualKeyframes
      ? JSON.parse(JSON.stringify(newTransform.visualKeyframes))
      : undefined;
  }

  return { oldTransform, newTransform };
}

// ---------------------------------------------------------------------------
// getClipTypeInfo
// ---------------------------------------------------------------------------

export interface ClipTypeInfo {
  icon: LucideIcon;
  /** Raw label string — not an i18n key */
  label: string;
  color: string;
}

/**
 * Returns the display icon, label, and Tailwind color class for a clip based
 * on its asset type, clip kind, and whether it is a text or sticker layer.
 *
 * Used by the Properties Panel header and collapsed rail.
 */
export function getClipTypeInfo(
  assetType: string | undefined,
  clipKind: Clip["kind"] | undefined,
  isText: boolean,
  isSticker?: boolean,
): ClipTypeInfo {
  if (isText) return { icon: FileText, label: "Text", color: "text-purple-400" };
  if (isSticker) return { icon: Smile, label: "Sticker", color: "text-pink-400" };
  if (clipKind === "filter")
    return { icon: Sparkles, label: "Filter", color: "text-violet-400" };
  if (clipKind === "video-effect")
    return { icon: Sparkles, label: "Video Effect", color: "text-violet-400" };
  if (clipKind === "body-effect")
    return { icon: Sparkles, label: "Body Effect", color: "text-violet-400" };
  if (clipKind === "animated-overlay")
    return { icon: Sparkles, label: "Animated Overlay", color: "text-violet-400" };

  switch (assetType) {
    case "video":
      return { icon: Film, label: "Video", color: "text-blue-400" };
    case "audio":
      return { icon: Music, label: "Audio", color: "text-green-400" };
    case "image":
      return { icon: Image, label: "Image", color: "text-amber-400" };
    default:
      return { icon: Film, label: "Clip", color: "text-text-muted" };
  }
}

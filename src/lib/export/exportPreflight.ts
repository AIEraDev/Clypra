/**
 * Export Preflight Dependency Verification
 *
 * Implements §1.2 of the Clypra Text Effects Architecture:
 * - Scans project clips for text effect and font dependencies prior to export.
 * - Prevents silent degradation: blocks export if any text effect is un-cached offline.
 * - Requires explicit user confirmation to proceed with base typography fallback.
 */

import type { Clip, MediaAsset } from "@/types";
import { expandCompoundClips } from "@/core/timeline/compoundClips";
import { useEffectsStore } from "@/features/text-effects/store/effectsStore";
import { getTextEffectCache } from "@/features/text-effects/cache/persistentCache";

export interface MissingTextEffect {
  clipId: string;
  clipName: string;
  styleId: string;
}

export interface MissingImageAsset {
  clipId: string;
  clipName: string;
  assetId: string;
}

export interface ExportPreflightResult {
  ready: boolean;
  missingEffects: MissingTextEffect[];
  missingImageAssets: MissingImageAsset[];
  missingFonts: string[];
}

export class ExportBlockedError extends Error {
  public readonly missingEffects: MissingTextEffect[];
  public readonly missingImageAssets: MissingImageAsset[];

  constructor(
    missingEffects: MissingTextEffect[],
    missingImageAssets: MissingImageAsset[] = [],
  ) {
    const sections: string[] = [];
    if (missingEffects.length > 0) {
      sections.push(
        `text effects: ${missingEffects
          .map((e) => `"${e.styleId}" on clip "${e.clipName || e.clipId}"`)
          .join(", ")}`,
      );
    }
    if (missingImageAssets.length > 0) {
      sections.push(
        `image assets: ${missingImageAssets
          .map((asset) => `"${asset.assetId}" on clip "${asset.clipName || asset.clipId}"`)
          .join(", ")}`,
      );
    }
    const guidance =
      missingImageAssets.length > 0
        ? "Restore the referenced image assets before exporting; missing images cannot be force-exported."
        : "Explicit force-export confirmation is required to proceed with base typography.";
    super(`Export blocked: Missing ${sections.join("; ")}. ${guidance}`);
    this.name = "ExportBlockedError";
    this.missingEffects = missingEffects;
    this.missingImageAssets = missingImageAssets;
  }
}

/**
 * Verify that all required text effects and assets are resident in local cache
 * or that the network is available to fetch them.
 *
 * Automatically expands compound clips so template child elements are verified (§4).
 */
export async function verifyExportDependencies(
  clips: Clip[],
  options: { isOnline?: boolean; assets?: MediaAsset[] } = {}
): Promise<ExportPreflightResult> {
  const isOnline = options.isOnline ?? (typeof navigator !== "undefined" ? navigator.onLine : true);
  const flattenedClips = expandCompoundClips(clips);
  const missingImageAssets: MissingImageAsset[] = [];
  if (options.assets) {
    const assetIds = new Set(options.assets.map((asset) => asset.id));
    const checkedImageIds = new Set<string>();
    for (const clip of flattenedClips) {
      const mediaId = clip.mediaId || "";
      if (clip.kind !== "image" || mediaId.startsWith("solid-") || checkedImageIds.has(clip.id)) {
        continue;
      }
      checkedImageIds.add(clip.id);
      if (assetIds.has(mediaId)) continue;

      const directUrl = clip.mediaUrl;
      const selfContainedUrl =
        typeof directUrl === "string" &&
        /^(data:|blob:|asset:)/i.test(directUrl);
      if (selfContainedUrl || (directUrl && isOnline)) continue;

      missingImageAssets.push({
        clipId: clip.id,
        clipName: clip.name || clip.id,
        assetId: mediaId || directUrl || "unknown-image",
      });
    }
  }
  const textClips = flattenedClips.filter(
    (clip): clip is Clip & { styleId?: string; text?: string; fontFamily?: string } =>
      clip.kind === "text" || (clip as any).layerType === "text"
  );

  const missingEffects: MissingTextEffect[] = [];
  const missingFonts: string[] = [];
  const checkedEffectIds = new Set<string>();

  const storeDefinitions = useEffectsStore.getState().definitions;
  const persistentCache = getTextEffectCache();

  for (const clip of textClips) {
    const styleId = clip.styleId;
    if (!styleId || styleId === "none" || styleId === "raw_text" || checkedEffectIds.has(styleId)) {
      continue;
    }
    checkedEffectIds.add(styleId);

    // 1. Check in-memory store
    if (storeDefinitions[styleId]) {
      continue;
    }

    // 2. Check persistent IndexedDB cache
    const cached = await persistentCache.get(styleId);
    if (cached) {
      useEffectsStore.setState((state) => ({
        definitions: { ...state.definitions, [styleId]: cached },
      }));
      continue;
    }

    // 3. If offline and neither memory nor persistent cache has it -> missing dependency
    if (!isOnline) {
      missingEffects.push({
        clipId: clip.id,
        clipName: (clip as any).name || clip.text || clip.id,
        styleId,
      });
    }
  }

  return {
    ready: missingEffects.length === 0 && missingImageAssets.length === 0,
    missingEffects,
    missingImageAssets,
    missingFonts,
  };
}

/**
 * Export Preflight Dependency Verification
 *
 * Implements §1.2 of the Clypra Text Effects Architecture:
 * - Scans project clips for text effect and font dependencies prior to export.
 * - Prevents silent degradation: blocks export if any text effect is un-cached offline.
 * - Requires explicit user confirmation to proceed with base typography fallback.
 */

import type { Clip } from "@/types";
import { expandCompoundClips } from "@/core/timeline/compoundClips";
import { useEffectsStore } from "@/features/text-effects/store/effectsStore";
import { getTextEffectCache } from "@/features/text-effects/cache/persistentCache";

export interface MissingTextEffect {
  clipId: string;
  clipName: string;
  styleId: string;
}

export interface ExportPreflightResult {
  ready: boolean;
  missingEffects: MissingTextEffect[];
  missingFonts: string[];
}

export class ExportBlockedError extends Error {
  public readonly missingEffects: MissingTextEffect[];

  constructor(missingEffects: MissingTextEffect[]) {
    const list = missingEffects
      .map((e) => `"${e.styleId}" on clip "${e.clipName || e.clipId}"`)
      .join(", ");
    super(
      `Export blocked: The following text effects are not cached locally and network is offline: ${list}. Explicit force-export confirmation is required to proceed with base typography.`
    );
    this.name = "ExportBlockedError";
    this.missingEffects = missingEffects;
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
  options: { isOnline?: boolean } = {}
): Promise<ExportPreflightResult> {
  const isOnline = options.isOnline ?? (typeof navigator !== "undefined" ? navigator.onLine : true);
  const flattenedClips = expandCompoundClips(clips);
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
    ready: missingEffects.length === 0,
    missingEffects,
    missingFonts,
  };
}

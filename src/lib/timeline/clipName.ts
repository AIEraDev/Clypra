import type { Clip, MediaAsset } from "@/types";

/**
 * Returns the user-facing name for a timeline clip.
 *
 * Timeline clips normally inherit their source asset name, but older projects
 * and generated clips may not have a name persisted on the clip itself.
 */
export function getClipDisplayName(
  clip: Pick<Clip, "name" | "mediaId">,
  mediaAssets: Pick<MediaAsset, "id" | "name">[] = [],
): string {
  const clipName = clip.name?.trim();
  if (clipName) return clipName;

  const assetName = mediaAssets.find((asset) => asset.id === clip.mediaId)?.name?.trim();
  return assetName || "Untitled clip";
}

/**
 * Formats a concise, NLE-style success message for one or more clip edits.
 * Names are useful for a single edit; counts keep multi-clip feedback compact.
 */
export function formatSplitMessage(results: Array<{ success: boolean; clipName?: string }>): string {
  const successful = results.filter((result) => result.success);
  if (successful.length === 0) return "Split failed";

  if (successful.length === 1) {
    return `Split “${successful[0].clipName || "Untitled clip"}”`;
  }

  const names = [...new Set(successful.map((result) => result.clipName).filter(Boolean))] as string[];
  if (names.length === 1) return `Split ${successful.length} clips named “${names[0]}”`;
  return `Split ${successful.length} clips`;
}

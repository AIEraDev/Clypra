/**
 * useVideoThumbnail
 *
 * Returns a data URL for the first frame of the video asset associated with
 * the given timeline clip ID. Returns null when:
 *   - no clip ID is provided
 *   - the clip has no media asset
 *   - the asset path has not been probed yet (empty string)
 *   - the Tauri runtime is unavailable (web fallback)
 *   - frame extraction fails for any reason
 *
 * The returned URL is stable across re-renders until the asset path changes.
 */

import { useState, useEffect } from "react";
import { useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import { decodeFrame, isTauriRuntime } from "@/lib/platform/tauri";

export function useVideoThumbnail(
  clipId: string | null | undefined,
): { thumbnailUrl: string | null } {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);

  const clip = useTimelineStore((s) =>
    clipId ? s.clips.find((c) => c.id === clipId) : undefined,
  );

  const asset = useProjectStore((s) =>
    clip && "mediaId" in clip && clip.mediaId
      ? (s.mediaAssets ?? []).find((a) => a.id === (clip as { mediaId: string }).mediaId)
      : undefined,
  );

  // Stable key: re-fetch only when the resolved asset path changes
  const assetPath = asset?.path ?? null;

  useEffect(() => {
    if (!assetPath) {
      setThumbnailUrl(null);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        if (!isTauriRuntime()) {
          // Web / test environment — degrade gracefully
          if (!cancelled) setThumbnailUrl(null);
          return;
        }
        const url = await decodeFrame(assetPath, 0, 128, 72);
        if (!cancelled) setThumbnailUrl(url);
      } catch {
        if (!cancelled) setThumbnailUrl(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [assetPath]);

  return { thumbnailUrl };
}

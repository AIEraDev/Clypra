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
import { renderNativePreviewFrame, isTauriRuntime } from "@/lib/platform/tauri";

export function useVideoThumbnail(clipId: string | null | undefined): {
  thumbnailUrl: string | null;
} {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);

  const clip = useTimelineStore((s) =>
    clipId ? s.clips.find((c) => c.id === clipId) : undefined,
  );

  const asset = useProjectStore((s) =>
    clip?.mediaId
      ? (s.mediaAssets ?? []).find((a) => a.id === clip.mediaId)
      : undefined,
  );

  const assetPath = asset?.path && asset.path !== "" ? asset.path : null;

  useEffect(() => {
    if (!assetPath || !isTauriRuntime()) {
      setThumbnailUrl(null);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const rgba = await renderNativePreviewFrame(assetPath, 0, 128, 72);
        if (cancelled) return;

        const clamped = new Uint8ClampedArray(rgba);
        const imageData = new ImageData(clamped, 128, 72);
        const bitmap = await createImageBitmap(imageData);
        if (cancelled) {
          bitmap.close();
          return;
        }

        const canvas = document.createElement("canvas");
        canvas.width = 128;
        canvas.height = 72;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          bitmap.close();
          return;
        }
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();

        const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
        if (!cancelled) setThumbnailUrl(dataUrl);
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

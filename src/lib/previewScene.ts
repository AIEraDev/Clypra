import type { Clip, MediaAsset, Project, Track } from "../types";
import { convertFileSrc } from "@tauri-apps/api/core";

export interface PreviewLayer {
  clipId: string;
  trackId: string;
  mediaId: string;
  mediaType: "video" | "image";
  sourcePath: string;
  posterFrame?: string;
  sourceTime: number;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  rotation: number;
  zIndex: number;
}

export interface PreviewScene {
  layers: PreviewLayer[];
}

interface ResolvePreviewSceneParams {
  tracks: Track[];
  clips: Clip[];
  assets: MediaAsset[];
  time: number;
  project: Project | null;
}

export const resolvePreviewScene = ({ tracks, clips, assets, time }: ResolvePreviewSceneParams): PreviewScene => {
  const trackIndexMap = new Map(tracks.map((track, index) => [track.id, index]));
  const trackMap = new Map(tracks.map((track) => [track.id, track]));
  const assetMap = new Map(assets.map((asset) => [asset.id, asset]));

  const active = clips
    .filter((clip) => {
      const track = trackMap.get(clip.trackId);
      if (!track || !track.visible) return false;
      const clipEnd = clip.startTime + clip.duration;
      // Include the exact end time so the last frame is visible
      return time >= clip.startTime && time <= clipEnd;
    })
    .map((clip) => {
      const asset = assetMap.get(clip.mediaId);
      if (!asset || (asset.type !== "video" && asset.type !== "image")) return null;
      const sourceTime = clip.trimIn + (time - clip.startTime);

      // Convert file paths to Tauri-compatible URLs
      const sourcePath = asset.path ? convertFileSrc(asset.path) : asset.posterFrame || "";
      if (!sourcePath) return null;

      return {
        clip,
        asset,
        sourceTime,
        sourcePath,
      };
    })
    .filter((item): item is { clip: Clip; asset: MediaAsset; sourceTime: number; sourcePath: string } => Boolean(item))
    .sort((a, b) => {
      const ta = trackIndexMap.get(a.clip.trackId) ?? 0;
      const tb = trackIndexMap.get(b.clip.trackId) ?? 0;
      if (ta !== tb) return ta - tb;
      if (a.clip.startTime !== b.clip.startTime) return a.clip.startTime - b.clip.startTime;
      return a.clip.id.localeCompare(b.clip.id);
    });

  return {
    layers: active.map(({ clip, asset, sourceTime, sourcePath }, index) => ({
      clipId: clip.id,
      trackId: clip.trackId,
      mediaId: clip.mediaId,
      mediaType: asset.type === "video" ? "video" : "image",
      sourcePath,
      posterFrame: asset.posterFrame,
      sourceTime,
      x: clip.x,
      y: clip.y,
      width: clip.width,
      height: clip.height,
      opacity: clip.opacity,
      rotation: clip.rotation,
      zIndex: index,
    })),
  };
};

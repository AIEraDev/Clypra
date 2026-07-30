import type { AspectRatio, MediaAsset, Project, Clip } from "@/types";

const ASPECT_DIMENSIONS: Record<AspectRatio, { width: number; height: number }> = {
  original: { width: 1920, height: 1080 },
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "21:9": { width: 2520, height: 1080 },
  "4:3": { width: 1440, height: 1080 },
};

function chooseClosestAspect(width: number, height: number): AspectRatio {
  const ratio = width / Math.max(1, height);
  const candidates: Array<{ aspect: AspectRatio; ratio: number }> = [
    { aspect: "16:9", ratio: 16 / 9 },
    { aspect: "9:16", ratio: 9 / 16 },
    { aspect: "1:1", ratio: 1 },
    { aspect: "4:5", ratio: 4 / 5 },
    { aspect: "21:9", ratio: 21 / 9 },
    { aspect: "4:3", ratio: 4 / 3 },
  ];

  let best = candidates[0];
  let bestDelta = Math.abs(ratio - best.ratio);
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i];
    const delta = Math.abs(ratio - c.ratio);
    if (delta < bestDelta) {
      best = c;
      bestDelta = delta;
    }
  }
  return best.aspect;
}

/**
 * CapCut-style sequence policy:
 * If timeline is empty and first inserted media is visual, auto-adapt sequence
 * aspect ratio to the media orientation/aspect.
 */
export function autoAdaptSequenceForFirstVisualClip(params: {
  project: Project | null;
  existingClips: Clip[];
  asset: MediaAsset;
  updateProject: (updates: Partial<Project>) => void;
}): void {
  const { project, existingClips, asset, updateProject } = params;
  if (!project) return;
  if (existingClips.length > 0) return;
  if (asset.type !== "video" && asset.type !== "image") return;
  if (!asset.width || !asset.height || asset.width <= 0 || asset.height <= 0) return;

  const nextAspect = chooseClosestAspect(asset.width, asset.height);
  const nextDims = ASPECT_DIMENSIONS[nextAspect];

  if (project.aspectRatio === nextAspect && project.canvasWidth === nextDims.width && project.canvasHeight === nextDims.height) return;

  updateProject({
    aspectRatio: nextAspect,
    canvasWidth: nextDims.width,
    canvasHeight: nextDims.height,
  });
}
